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
import { useFeedEngine } from '@/hooks/useFeedEngine';
import { trackPost } from '@/lib/telemetry';
import { counterTakeUrl } from '@/lib/feedClient';
import { useSocialActions } from '@/hooks/useSocialActions';
import { findConversationWith } from '@/lib/chatData';
import { setImmersive } from '@/lib/immersive';
import { ensureSession } from '@/lib/session';
import { handleShare } from '@/lib/share';
import type { FeedItem } from '@/types/social';

const ACTIVE_RATIO = 0.6;
const PEEK_PX = 0;
const GAP_PX = 0;

type Props = { items: FeedItem[]; paginate: boolean; snapshot: string };

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
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false); // browsers allow sound only after a tap, so the feed starts muted
  const [note, setNote] = useState<string | null>(null);
  const [style, setStyle] = useState<{ postId: string; avatarId: AvatarId } | null>(null);
  const styleFor = (item: FeedItem): AvatarId | null => (style?.postId === item.id ? style.avatarId : item.avatar_id);
  const [swipe, setSwipe] = useState<{ id: string; direction: 'up' | 'down' } | null>(null);
  const previousIndex = useRef<number | null>(null);
  const social = useSocialActions();

  const activeId = active?.id;
  const expanded = expandedId !== null;

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
      setSwipe({ id: `${activeId}-${Date.now()}`, direction: activeIndex > previousIndex.current ? 'up' : 'down' });
    }
    previousIndex.current = activeIndex;
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

  /** Opens the chat if you already talk; otherwise the profile, where a request with a reason can be sent. */
  const message = async (item: FeedItem) => {
    if (!item.user_id || !item.creator_username) return;
    try {
      const session = await ensureSession();
      const existing = await findConversationWith(session.user.id, item.user_id);
      if (existing?.status !== 'accepted') trackPost(item.id, 'profile_visit');
      router.push(existing?.status === 'accepted' ? `/chats/${existing.id}` : `/profile/${item.creator_username}`);
    } catch {
      trackPost(item.id, 'profile_visit');
      router.push(`/profile/${item.creator_username}`);
    }
  };

  return (
    <div className="relative h-dvh w-full bg-black text-white">
      {maskHost && active?.mode === 'mask' && createPortal(
        <>
          <MaskPlayback avatarId={styleFor(active)} motionUrl={active.motion_url} audioUrl={active.media_url} soundOn={soundOn} paused={pausedId === active.id} barRef={maskBar}
            onPlayback={playback} />
          {/* Try the clip on another character. Local only: the post itself is unchanged. */}
          <AvatarPickerRail orientation="vertical" className="absolute right-3 top-[18%] z-10 scale-90" selected={styleFor(active) ?? 'cyber_monk'} onSelect={(id) => setStyle({ postId: active.id, avatarId: id })} />
        </>, maskHost,
      )}
      <LayoutGroup>
        <div
          ref={scrollerRef}
          role="feed"
          aria-label="Posts"
          tabIndex={0}
          className={`h-dvh snap-y snap-mandatory overscroll-y-contain [scrollbar-width:none] focus-visible:outline-none ${expanded ? 'overflow-hidden' : 'overflow-y-auto'}`}
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
              <LiquidWarpCard axis="vertical" className="absolute inset-0" container={scrollerRef} disabled>
              <FeedCard
                item={item}
                active={item.id === activeId}
                near={near}
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
                onMessage={() => void message(item)}
              />
              </LiquidWarpCard>
            </article>
            );
          })}
        </div>
        <SwipeBubbleOverlay trigger={swipe?.id ?? ''} direction={swipe?.direction} />
      </LayoutGroup>

      {(note || social.error) && (
        <p role="status" className="fixed inset-x-0 top-6 z-[60] mx-auto w-fit max-w-[90%] rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-md">
          {note ?? social.error}
          {social.error && !note && <button type="button" onClick={social.clearError} className="ml-2 underline">Dismiss</button>}
        </p>
      )}
    </div>
  );
}
