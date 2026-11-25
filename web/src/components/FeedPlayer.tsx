'use client';
import { LayoutGroup } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AvatarPickerRail } from '@/components/AvatarPickerRail';
import { MaskPlayback } from '@/components/MaskPlayback';
import { fetchMotionTrack } from '@/lib/mocap/motionCodec';
import type { AvatarId } from '@/types/avatar';
import { FeedCard } from '@/components/FeedCard';
import { LiquidWarpCard } from '@/components/LiquidWarpCard';
import { SwipeBubbleOverlay } from '@/components/SwipeBubbleOverlay';
import { ComboBurstLayer, useComboBurst } from '@/components/chat/EmojiReactionSystem';
import { AIFeedNudge, type FeedNudge } from '@/components/feed/AIFeedNudge';
import { AuroraEdgeGlow } from '@/components/feed/AuroraEdgeGlow';
import { CommentsDrawer } from '@/components/feed/CommentsDrawer';
import { FeedGamificationHUD, type FeedMilestone } from '@/components/feed/FeedGamificationHUD';
import { useFeedEngine } from '@/hooks/useFeedEngine';
import { trackPost } from '@/lib/telemetry';
import { counterTakeUrl } from '@/lib/feedClient';
import { useSocialActions } from '@/hooks/useSocialActions';
import { findConversationWith } from '@/lib/chatData';
import { setImmersive } from '@/lib/immersive';
import { ensureSession } from '@/lib/session';
import { handleShare } from '@/lib/share';
import { playCue, primeAudio } from '@/lib/chat/spatialAudio';
import type { FeedItem } from '@/types/social';

const ACTIVE_RATIO = 0.6;
const PEEK_PX = 0;
const GAP_PX = 0;

type Props = { items: FeedItem[]; paginate: boolean; snapshot: string };

/** Session-only XP: nothing is stored, a fresh visit starts at zero. */
const XP = { watch: 5, react: 10, milestone: 20 } as const;
const LEVEL_XP = 100;
const WATCH_MILESTONE = 5;
const REACT_MILESTONE = 3;
const NUDGE_AFTER = 3;
const MILESTONE_MS = 2000;
const NUDGE_MS = 8000;

/** The next post ahead from a creator you follow, if any: the AI nudge points at it. */
function followedAhead(items: FeedItem[], from: number): FeedItem | undefined {
  return items.slice(from + 1).find((i) => i.following && !i.is_incog && i.creator_username);
}

/**
 * Vertical snap feed of rounded cards on a black background. One card is "active" (the one in view) and only that
 * card may own the shared WebGL canvas, so the feed never holds more than one context however far you scroll.
 * Tapping a card expands it to full screen; the navigation hides while it is open.
 */
export function FeedPlayer({ items: initial, paginate, snapshot }: Props) {
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { items, active, index: activeIndex, select, playback, notInterested } = useFeedEngine(initial, paginate, snapshot);
  const [maskHost, setMaskHost] = useState<HTMLDivElement | null>(null);
  const maskBar = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = document.createElement('div');
    host.style.display = 'contents';
    hostRef.current = host;
    // The microtask avoids scheduling a second synchronous render during passive effect setup.
    queueMicrotask(() => { if (hostRef.current === host) setMaskHost(host); });
    return () => { hostRef.current = null; host.remove(); };
  }, []);
  useLayoutEffect(() => {
    if (!maskHost || active?.mode !== 'mask') return;
    const card = scrollerRef.current?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(active.id)}"]`);
    const slot = card?.querySelector<HTMLElement>('[data-mask-slot]');
    if (!slot) return;
    // Keep React's portal target and WebGL context stable when its containing card changes.
    const host = hostRef.current;
    if (!host) return;
    slot.appendChild(host);
    maskBar.current = card?.querySelector<HTMLElement>('[data-feed-progress]') ?? null;
    return () => { host.remove(); maskBar.current = null; };
  }, [maskHost, active]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [style, setStyle] = useState<{ postId: string; avatarId: AvatarId } | null>(null);
  const styleFor = (item: FeedItem): AvatarId | null => (style?.postId === item.id ? style.avatarId : item.avatar_id);
  const [swipe, setSwipe] = useState<{ id: string; direction: 'up' | 'down' } | null>(null);
  const previousIndex = useRef<number | null>(null);
  const social = useSocialActions();
  const burst = useComboBurst();
  const [pulse, setPulse] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [xp, setXp] = useState(0);
  const [milestone, setMilestone] = useState<FeedMilestone | null>(null);
  const [nudge, setNudge] = useState<FeedNudge | null>(null);
  const [dimmed, setDimmed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const watched = useRef(new Set<string>());
  const reacted = useRef(0);
  const nudged = useRef(false);

  const celebrate = (emoji: string, label: string) => {
    const key = Date.now();
    setXp((v) => v + XP.milestone);
    setMilestone({ key, emoji, label, xp: XP.milestone });
    setTimeout(() => setMilestone((m) => (m?.key === key ? null : m)), MILESTONE_MS);
  };

  const activeId = active?.id;
  const expanded = expandedId !== null;
  const commentsOpen = commentsPostId !== null;

  useEffect(() => {
    const next = items[activeIndex + 1];
    if (!next || next.mode !== 'mask' || !next.motion_url) return;
    const ctrl = new AbortController();
    void fetchMotionTrack(next.motion_url, ctrl.signal);
    return () => ctrl.abort();
  }, [items, activeIndex]);

  useEffect(() => {
    if (activeIndex < 0) return;
    if (previousIndex.current !== null && previousIndex.current !== activeIndex && activeId) {
      const now = Date.now();
      setSwipe({ id: `${activeId}-${now}`, direction: activeIndex > previousIndex.current ? 'up' : 'down' });
      setPulse(now);
      setPickerOpen(false);
      // Soft haptic vibration + subtle tactile audio cue on every card swipe
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(15);
        } catch {
          // ignore
        }
      }
      playCue('swipe_tick', 0);
      // Each post earns XP once, so scrolling back and forth (or a scroll that flickers between two cards) can't farm it.
      if (!watched.current.has(activeId)) {
        watched.current.add(activeId);
        setXp((v) => v + XP.watch);
        if (watched.current.size % WATCH_MILESTONE === 0) {
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try {
              navigator.vibrate([20, 35, 25]);
            } catch {
              // ignore
            }
          }
          celebrate('🔥', `${watched.current.size}x Vibe Streak`);
        }
      }
      const target = !nudged.current && watched.current.size >= NUDGE_AFTER ? followedAhead(items, activeIndex) : undefined;
      if (target) {
        nudged.current = true;
        const id = `${target.id}-${now}`;
        setNudge({ id, cta: 'Watch', message: `Oh, you're vibing with this — @${target.creator_username} ki nayi video aayi hai, dekhein?` });
        setTimeout(() => setNudge((n) => (n?.id === id ? null : n)), NUDGE_MS);
      }
    }
    previousIndex.current = activeIndex;
    // celebrate only sets state; items is read for the nudge target at the moment of the swipe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeIndex]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting && e.intersectionRatio >= ACTIVE_RATIO);
        const id = visible?.target.getAttribute('data-post-id');
        if (id) select(id);
      },
      { root: scroller, threshold: [ACTIVE_RATIO] },
    );
    scroller.querySelectorAll('[data-post-id]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items, select]);

  useEffect(() => {
    setImmersive('feed-card', expanded);
    return () => setImmersive('feed-card', false);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpandedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 2500);
  };

  const share = async (item: FeedItem) => {
    const url = `${window.location.origin}/feed?postId=${item.id}`;
    // Incog posts never name their creator, not even in the share text.
    const title = item.is_incog || !item.creator_username ? 'A review on Vybe' : `A review by @${item.creator_username} on Vybe`;
    const result = await handleShare({ title, text: item.ai_summary ?? undefined, url });
    if (result === 'copied' || result === 'shared') trackPost(item.id, 'share');
    if (result === 'copied') flash('Link copied');
    else if (result === 'failed') flash('Could not share this post');
  };

  /**
   * A typed vibe goes to the creator as a chat draft when you already talk; otherwise to their profile, where a chat
   * request with a reason can be sent (the text cannot travel there, so the toast says so).
   */
  const sendVibe = async (item: FeedItem, text: string) => {
    if (!item.user_id || !item.creator_username) return;
    try {
      const session = await ensureSession();
      const existing = await findConversationWith(session.user.id, item.user_id);
      if (existing?.status === 'accepted') {
        router.push(`/chats/${existing.id}?draft=${encodeURIComponent(text)}`);
        return;
      }
    } catch {
      // fall through to the profile
    }
    trackPost(item.id, 'profile_visit');
    flash(`Send @${item.creator_username} a chat request first`);
    router.push(`/profile/${item.creator_username}`);
  };

  const react = (emoji: string, x: number, y: number) => {
    burst.fire(emoji, x, y);
    setPulse(Date.now());
    setXp((v) => v + XP.react);
    reacted.current += 1;
    if (reacted.current % REACT_MILESTONE === 0) celebrate('💖', `${reacted.current} reactions`);
  };

  const jumpTo = (postId: string) => {
    setNudge(null);
    scrollerRef.current?.querySelector(`[data-post-id="${CSS.escape(postId)}"]`)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div onPointerDownCapture={primeAudio} onTouchStartCapture={primeAudio} className="relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden bg-black text-white">
      {maskHost && active?.mode === 'mask' && createPortal(
        <>
          <MaskPlayback avatarId={styleFor(active)} motionUrl={active.motion_url} audioUrl={active.media_url} soundOn={soundOn} paused={pausedId === active.id} barRef={maskBar}
            onPlayback={playback} />
          {/* Try the clip on another character, opened from the PiP card. Local only: the post itself is unchanged. */}
          {pickerOpen && (
            <AvatarPickerRail orientation="vertical" className="absolute right-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+6.25rem)] z-10 scale-90" selected={styleFor(active) ?? 'cyber_monk'} onSelect={(id) => setStyle({ postId: active.id, avatarId: id })} />
          )}
        </>, maskHost,
      )}
      <LayoutGroup>
        <div
          ref={scrollerRef}
          role="feed"
          aria-label="Posts"
          tabIndex={0}
          className={`h-dvh snap-y snap-mandatory overscroll-y-contain [scrollbar-width:none] focus-visible:outline-none ${expanded || commentsOpen ? 'overflow-hidden' : 'overflow-y-auto'}`}
          style={{ scrollSnapType: 'y mandatory', paddingBlock: PEEK_PX }}
        >
          {items.map((item, index) => {
            const near = Math.abs(index - activeIndex) <= 1;
            return (
            <article
              key={item.id}
              data-post-id={item.id}
              onPlayingCapture={() => { if (item.id === activeId) playback(true); }}
              onPauseCapture={() => { if (item.id === activeId) playback(false); }}
              onWaitingCapture={() => { if (item.id === activeId) playback(false); }}
              aria-posinset={index + 1}
              aria-setsize={items.length}
              className="relative w-full snap-center snap-always"
              style={{ height: `calc(100dvh - ${PEEK_PX * 2}px)`, marginBottom: GAP_PX }}
            >
              <LiquidWarpCard axis="vertical" className="absolute inset-0" container={scrollerRef} disabled={item.id === expandedId}>
              <FeedCard
                item={item}
                active={item.id === activeId}
                near={near}
                isNext={index === activeIndex + 1}
                expanded={item.id === expandedId}
                paused={pausedId === item.id}
                soundOn={soundOn}
                social={social}
                onExpand={() => { setExpandedId(item.id); setSoundOn(true); }}
                onCollapse={() => setExpandedId(null)}
                onTogglePause={() => setPausedId((p) => (p === item.id ? null : item.id))}
                onToggleSound={() => setSoundOn((on) => !on)}
                onCounterTake={() => router.push(counterTakeUrl(item.topic_entity))}
                onNotInterested={() => { notInterested(item); flash('Not interested'); }}
                onShare={() => void share(item)}
                dimmed={dimmed}
                onReact={react}
                commentsCount={commentCounts[item.id] ?? item.comments_count ?? 0}
                onOpenComments={() => setCommentsPostId(item.id)}
              />
              </LiquidWarpCard>
            </article>
            );
          })}
        </div>
        <SwipeBubbleOverlay trigger={swipe?.id ?? ''} direction={swipe?.direction} />
      </LayoutGroup>
      <AuroraEdgeGlow emotion={active?.emotion_tag} pulse={pulse} />
      <FeedGamificationHUD progress={(xp % LEVEL_XP) / LEVEL_XP} milestone={milestone} />
      <AIFeedNudge nudge={nudge} onDismiss={() => setNudge(null)}
        onAction={() => { const target = followedAhead(items, activeIndex); if (target) jumpTo(target.id); else setNudge(null); }} />
      <CommentsDrawer
        postId={commentsPostId}
        initialCount={commentsPostId ? (commentCounts[commentsPostId] ?? active?.comments_count ?? 0) : 0}
        onClose={() => setCommentsPostId(null)}
        onCountChange={(pid, count) => setCommentCounts((prev) => (prev[pid] === count ? prev : { ...prev, [pid]: count }))}
      />
      <ComboBurstLayer bursts={burst.bursts} />

      {(note || social.error) && (
        <p role="status" className="fixed inset-x-0 top-6 z-[60] mx-auto w-fit max-w-[90%] rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-md">
          {note ?? social.error}
          {social.error && !note && <button type="button" onClick={social.clearError} className="ml-2 underline">Dismiss</button>}
        </p>
      )}
    </div>
  );
}
