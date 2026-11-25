'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaskPlayback } from '@/components/MaskPlayback';
import { fetchMotionTrack } from '@/lib/mocap/motionCodec';
import { FeedCard } from '@/components/FeedCard';
import { ComboBurstLayer, useComboBurst } from '@/components/chat/EmojiReactionSystem';
import { AIFeedNudge, type FeedNudge } from '@/components/feed/AIFeedNudge';
import { AuroraEdgeGlow } from '@/components/feed/AuroraEdgeGlow';
import { CommentsDrawer } from '@/components/feed/CommentsDrawer';
import { ShareToChatSheet } from '@/components/feed/ShareToChatSheet';
import { EdgeEmojiArc } from '@/components/feed/EdgeEmojiArc';
import { FeedGamificationHUD, type FeedMilestone } from '@/components/feed/FeedGamificationHUD';
import { LiquidGlassNav } from '@/components/feed/LiquidGlassNav';
import { FALLBACK_RGB, useVideoAmbientColor } from '@/hooks/useVideoAmbientColor';
import { AVATAR_META } from '@/lib/avatars';
import { useFeedEngine } from '@/hooks/useFeedEngine';
import { useFeedPrefetch } from '@/hooks/useFeedPrefetch';
import { trackPost } from '@/lib/telemetry';
import { counterTakeUrl } from '@/lib/feedClient';
import { useSocialActions } from '@/hooks/useSocialActions';
import { setImmersive } from '@/lib/immersive';
import { handleShare } from '@/lib/share';
import { primeAudio } from '@/lib/chat/spatialAudio';
import { hapticTick } from '@/lib/haptics';
import { feedPrefetcher } from '@/lib/media/feedPrefetcher';
import { isImageUrl } from '@/lib/media/mediaKind';
import { prefetchLivingHtml } from '@/lib/living/livingHtmlCache';
import { parseLivingPostRecipe } from '@/lib/living/livingPostValidator';
import { markSlideActive, recordFirstFrame } from '@/lib/media/ttff';
import { bufferedAheadSeconds, createVideoPool, disposeVideoPool, isAudible, liveVideo, resumeLiveVideo, unlockPool, unmuteLiveVideo, VideoPoolContext, watchPool } from '@/lib/media/videoPool';
import type { FeedItem } from '@/types/social';

const ACTIVE_RATIO = 0.6;
/** Background prefetch waits until the playing video has this much buffered ahead. */
const MIN_BUFFER_AHEAD_S = 3;
const NON_VIDEO_FORMATS: ReadonlySet<string> = new Set(['image', 'recipe_avatar', 'recipe_shayari', 'living_post']);

/** Mask posts keep audio in `media_url`; 3D scenes and images have no video to warm. */
const prefetchUrlOf = (item: FeedItem): string | null =>
  item.mode === 'mask' || (item.post_format && NON_VIDEO_FORMATS.has(item.post_format)) || isImageUrl(item.media_url) ? null : item.media_url || null;
const PEEK_PX = 0;
const GAP_PX = 0;

type Props = { items: FeedItem[]; paginate: boolean; snapshot: string };

/** Session-only XP: nothing is stored, a fresh visit starts at zero. */
const XP = { milestone: 20 } as const;
const DIM_AFTER_MS = 3500;
const WATCH_MILESTONE = 5;
const REACT_MILESTONE = 3;
const NUDGE_AFTER = 3;
const MILESTONE_MS = 2000;
const NUDGE_MS = 8000;

/** The next post ahead from a creator you follow, if any: the AI nudge points at it. */
/** Tint for posts with no readable video frame (3D posts, other hosts): the creator's avatar colour. */
function accentFallback(item: FeedItem | null | undefined): string {
  const accent = item?.creator_avatar_id ? AVATAR_META[item.creator_avatar_id].accent : null;
  const m = accent?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : FALLBACK_RGB;
}

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
  const [videoPool] = useState(() => (typeof document === 'undefined' ? null : createVideoPool()));
  useEffect(() => () => { if (videoPool) disposeVideoPool(videoPool); }, [videoPool]);
  const { items, active, index: activeIndex, select, playback, notInterested } = useFeedEngine(initial, paginate, snapshot);
  useFeedPrefetch({
    items,
    activeIndex,
    urlOf: prefetchUrlOf,
    pauseGate: () => {
      const live = videoPool ? liveVideo(videoPool) : null;
      return live !== null && bufferedAheadSeconds(live) < MIN_BUFFER_AHEAD_S;
    },
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const offset of [1, 2]) {
        const next = items[activeIndex + offset];
        if (next?.post_format === 'living_post') {
          const parsed = parseLivingPostRecipe(next.recipe_data);
          if (parsed?.livingHtmlUrl) prefetchLivingHtml(parsed.livingHtmlUrl);
        }
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [items, activeIndex]);
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
  const [sharePost, setSharePost] = useState<FeedItem | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [audible, setAudible] = useState(false);
  const [playBlocked, setPlayBlocked] = useState(false);
  const unlockAudio = () => {
    primeAudio();
    if (!videoPool) return;
    unlockPool(videoPool);
    resumeLiveVideo(videoPool, soundOn);
  };
  /** Turning sound on happens right here, inside the tap, because browsers only allow it from a gesture. */
  const requestSound = () => {
    setSoundOn(true);
    if (videoPool) unmuteLiveVideo(videoPool, () => setSoundOn(false));
  };
  const [note, setNote] = useState<string | null>(null);
  const previousIndex = useRef<number | null>(null);
  const social = useSocialActions();
  const burst = useComboBurst();
  const [pulse, setPulse] = useState(0);
  const [milestone, setMilestone] = useState<FeedMilestone | null>(null);
  const [nudge, setNudge] = useState<FeedNudge | null>(null);
  const watched = useRef(new Set<string>());
  const reacted = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [touchSeq, setTouchSeq] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setDimmed(true), DIM_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [touchSeq, active?.id]);
  useVideoAmbientColor(rootRef, scrollerRef, active?.mode === 'mask' ? undefined : active?.id, accentFallback(active));
  const nudged = useRef(false);

  const celebrate = (emoji: string, label: string) => {
    const key = Date.now();
    setMilestone({ key, emoji, label, xp: XP.milestone });
    setTimeout(() => setMilestone((m) => (m?.key === key ? null : m)), MILESTONE_MS);
  };

  const activeId = active?.id;
  useEffect(() => {
    if (!videoPool) return;
    let timer: number | undefined;
    const update = () => queueMicrotask(() => {
      const live = liveVideo(videoPool);
      setAudible(live ? isAudible(live) : false);
      window.clearTimeout(timer);
      if (live?.paused) timer = window.setTimeout(() => setPlayBlocked(liveVideo(videoPool)?.paused === true), 800);
      else setPlayBlocked(false);
    });
    update();
    const stop = watchPool(videoPool, update);
    return () => { stop(); window.clearTimeout(timer); };
  }, [videoPool, activeId, soundOn]);
  useEffect(() => { if (activeId) markSlideActive(activeId); }, [activeId]);
  const expanded = expandedId !== null;
  const usesPooledVideo = active ? prefetchUrlOf(active) !== null : false;
  const activePaused = pausedId !== null && pausedId === activeId;
  /** What the sound control shows: for video posts the real state of the playing element, not just what was asked for. */
  const soundShown = soundOn && (usesPooledVideo ? audible || activePaused : true);
  const toggleSound = () => { if (soundShown) setSoundOn(false); else requestSound(); };
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
      setPulse(now);
      setNavOpen(false);
      // One silent haptic tick per settled video; no swipe sound.
      hapticTick(now);
      // Each post earns XP once, so scrolling back and forth (or a scroll that flickers between two cards) can't farm it.
      if (!watched.current.has(activeId)) {
        watched.current.add(activeId);
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

  const react = (emoji: string, x: number, y: number) => {
    burst.fire(emoji, x, y);
    setPulse(Date.now());
    reacted.current += 1;
    if (reacted.current % REACT_MILESTONE === 0) celebrate('💖', `${reacted.current} reactions`);
  };

  /** Reactions from the edge wheel: the heart is the real like, every emoji bursts. */
  const arcReact = (emoji: string, x: number, y: number) => {
    if (!active) return;
    if (emoji === '❤️' && !social.likeView(active).liked) void social.toggleLike(active.id, false);
    react(emoji, x, y);
  };

  /** Any touch brings the overlays back; they dim again after a stretch of uninterrupted watching. */
  const wake = () => {
    setDimmed(false);
    setTouchSeq((n) => n + 1);
  };

  const jumpTo = (postId: string) => {
    setNudge(null);
    scrollerRef.current?.querySelector(`[data-post-id="${CSS.escape(postId)}"]`)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <VideoPoolContext.Provider value={videoPool}>
    <div ref={rootRef} onPointerDownCapture={() => { unlockAudio(); wake(); }} onPointerUpCapture={unlockAudio} onTouchStartCapture={unlockAudio} onTouchEndCapture={unlockAudio} onClickCapture={unlockAudio}
      className="relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden bg-black text-white [--feed-accent-rgb:165_180_252]">
      {maskHost && active?.mode === 'mask' && createPortal(
        <>
          <MaskPlayback avatarId={active.avatar_id} motionUrl={active.motion_url} audioUrl={active.media_url} soundOn={soundOn} paused={pausedId === active.id} barRef={maskBar}
            onPlayback={playback} />
        </>, maskHost,
      )}
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
            onPlayingCapture={() => { if (item.id === activeId) { playback(true); recordFirstFrame(item.id, !!item.media_url && feedPrefetcher.isPrefetched(item.media_url)); } }}
            onPauseCapture={() => { if (item.id === activeId) playback(false); }}
            onWaitingCapture={() => { if (item.id === activeId) playback(false); }}
            aria-posinset={index + 1}
            aria-setsize={items.length}
            className="relative w-full snap-center snap-always"
            style={{ height: `calc(100dvh - ${PEEK_PX * 2}px)`, marginBottom: GAP_PX }}
          >
            <FeedCard
                item={item}
                active={item.id === activeId}
                near={near}
                index={index}
                expanded={item.id === expandedId}
                paused={pausedId === item.id}
                soundOn={soundOn}
                soundShown={soundShown}
                onRequestSound={requestSound}
                playBlocked={playBlocked && item.id === activeId && usesPooledVideo}
                social={social}
                onExpand={() => { setExpandedId(item.id); setSoundOn(true); }}
                onCollapse={() => setExpandedId(null)}
                onTogglePause={() => setPausedId((p) => (p === item.id ? null : item.id))}
                onToggleSound={toggleSound}
                onSoundBlocked={() => setSoundOn(false)}
                onCounterTake={() => router.push(counterTakeUrl(item.topic_entity))}
                onNotInterested={() => { notInterested(item); flash('Not interested'); }}
                onShare={() => setSharePost(item)}
                dimmed={dimmed}
                onReact={react}
                commentsCount={commentCounts[item.id] ?? item.comments_count ?? 0}
                onOpenComments={() => setCommentsPostId(item.id)}
              />
            </article>
            );
          })}
        </div>
      <AuroraEdgeGlow emotion={active?.emotion_tag} pulse={pulse} />
      <FeedGamificationHUD milestone={milestone} />
      <EdgeEmojiArc rootRef={rootRef} onReact={arcReact} disabled={!active} />
      <LiquidGlassNav open={navOpen} onOpenChange={setNavOpen} />
      <AIFeedNudge nudge={nudge} onDismiss={() => setNudge(null)}
        onAction={() => { const target = followedAhead(items, activeIndex); if (target) jumpTo(target.id); else setNudge(null); }} />
      <CommentsDrawer
        postId={commentsPostId}
        initialCount={commentsPostId ? (commentCounts[commentsPostId] ?? active?.comments_count ?? 0) : 0}
        onClose={() => setCommentsPostId(null)}
        onCountChange={(pid, count) => setCommentCounts((prev) => (prev[pid] === count ? prev : { ...prev, [pid]: count }))}
      />
      <ShareToChatSheet post={sharePost} onClose={() => setSharePost(null)} onShareLink={(item) => void share(item)} />
      <ComboBurstLayer bursts={burst.bursts} />

      {(note || social.error) && (
        <p role="status" className="fixed inset-x-0 top-6 z-[60] mx-auto w-fit max-w-[90%] rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-md">
          {note ?? social.error}
          {social.error && !note && <button type="button" onClick={social.clearError} className="ml-2 underline">Dismiss</button>}
        </p>
      )}
    </div>
    </VideoPoolContext.Provider>
  );
}
