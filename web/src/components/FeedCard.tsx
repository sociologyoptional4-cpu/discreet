'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Play } from 'lucide-react';
import { SwipeBubbleOverlay } from '@/components/SwipeBubbleOverlay';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';
import { FollowButton, ShareOrb, SoundOrb } from '@/components/feed/FeedControls';
import type { SocialActions } from '@/hooks/useSocialActions';
import { useNegativeFeedback } from '@/hooks/useNegativeFeedback';
import { STUDIO_BACKDROP } from '@/lib/avatars';
import { playCue } from '@/lib/chat/spatialAudio';
import type { FeedItem } from '@/types/social';

export type FeedCardProps = {
  item: FeedItem;
  active: boolean;
  /** Close enough to the screen that a video should be loaded. */
  near: boolean;
  expanded: boolean;
  paused: boolean;
  soundOn: boolean;
  social: SocialActions;
  onExpand: () => void;
  onCollapse: () => void;
  onTogglePause: () => void;
  onToggleSound: () => void;
  onShare: () => void;
  onCounterTake: () => void;
  onNotInterested: () => void;
  /** After a few seconds of uninterrupted watching the overlays fade back so the video takes over. */
  dimmed: boolean;
  /** Every reaction (emoji tap or double-tap like), with where it happened, so the feed can burst and glow. */
  onReact: (emoji: string, x: number, y: number) => void;
};

const HEART = '❤️';
/** Only R2 serves videos with CORS headers; asking any other host for CORS would stop the video loading. */
const R2_HOST = /\.r2\.dev$/;
const corsSafe = (src: string): boolean => {
  try {
    const host = new URL(src).hostname;
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    return R2_HOST.test(host) || (!!base && host === new URL(base).hostname);
  } catch {
    return false;
  }
};
const stop = (event: MouseEvent): void => event.stopPropagation();

/**
 * One full-screen post, video first: only the creator, a one-line caption and three glass controls float at the top. Reactions live behind the left edge (EdgeEmojiArc). Tap pauses, double-tap likes, long-press hides.
 */
export function FeedCard(props: FeedCardProps) {
  const { item, active, near, expanded, paused, soundOn, social, onExpand, onTogglePause, onToggleSound, onShare, onReact } = props;
  const longPress = useNegativeFeedback(props.onNotInterested);
  const reduceMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const missingMedia = !item.media_url || failedUrl === item.media_url;
  const fallback = item.transcript || item.ai_summary || 'Media unavailable';
  const [likeBurst, setLikeBurst] = useState(0);
  const [tapHeart, setTapHeart] = useState<{ id: number; x: number; y: number } | null>(null);
  const toastSeq = useRef(0);
  const like = social.likeView(item);
  const creatorId = item.user_id;
  const follow = creatorId ? social.followView(creatorId, { following: item.following, followers: item.creator_followers_count ?? 0 }) : null;
  const isOwn = creatorId !== null && social.viewerId === creatorId;
  const name = item.is_incog ? (item.incog_alias ?? 'Anon') : `@${item.creator_username}`;

  const react = (emoji: string, x: number, y: number) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(emoji === HEART ? [16, 26, 20] : 12);
      } catch {
        // ignore
      }
    }
    playCue(emoji === HEART ? 'heart_burst' : 'sticker_send', 0);
    if (emoji === HEART) {
      void social.toggleLike(item.id, like.liked);
      if (like.liked) return; // unliking is not a reaction
      setLikeBurst((n) => n + 1);
    }
    onReact(emoji, x, y);
  };
  const doubleTapLike = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const id = ++toastSeq.current;
    setTapHeart({ id, x: event.clientX - rect.left, y: event.clientY - rect.top });
    window.setTimeout(() => setTapHeart((h) => (h?.id === id ? null : h)), 850);
    if (!like.liked) {
      react(HEART, event.clientX, event.clientY);
    } else {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([16, 26, 20]);
        } catch {
          // ignore
        }
      }
      playCue('heart_burst', 0);
      onReact(HEART, event.clientX, event.clientY);
    }
  };
  const open = (event: KeyboardEvent) => {
    if (event.shiftKey && event.key === 'F10') { event.preventDefault(); props.onNotInterested(); return; }
    if (!expanded && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onExpand();
    }
  };

  return (
    <motion.div
      layout
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}
      style={{ borderRadius: 0 }}
      className="absolute inset-0 overflow-hidden bg-black text-white"
      {...longPress}
      onClick={() => { if (!soundOn) onToggleSound(); onTogglePause(); }}
      onDoubleClick={doubleTapLike}
      onKeyDown={open}
      role="article"
      tabIndex={0}
      aria-label={`Post ${item.topic_entity ? `about ${item.topic_entity}` : ''} by ${name}`}
    >
      <SwipeBubbleOverlay trigger={likeBurst} kind="like" />
      <AnimatePresence>
        {tapHeart && (
          <motion.div
            key={tapHeart.id}
            initial={{ opacity: 0, scale: 0.2, rotate: -14, y: 0 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.2, 1.38, 1.1, 0.95], rotate: [-14, 10, -4, 0], y: -64 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.78, ease: 'easeOut' }}
            style={{ left: tapHeart.x - 42, top: tapHeart.y - 42 }}
            aria-hidden
            className="pointer-events-none absolute z-40 flex flex-col items-center"
          >
            <Emoji3D emoji="💖" size={84} />
            <span className="-mt-1 rounded-full bg-gradient-to-r from-rose-500 to-violet-500 px-2.5 py-0.5 text-[11px] font-black text-white shadow-lg">
              +10 VIBE XP ⚡
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div data-mask-slot className="absolute inset-0">
        {item.mode === 'mask' ? (
          active ? null : (
            <div className="size-full" style={{ background: STUDIO_BACKDROP[item.avatar_id ?? 'cyber_monk'] }} />
          )
        ) : near && !missingMedia ? (
          <PostVideo src={item.media_url} onFailure={() => setFailedUrl(item.media_url)} active={active} paused={paused} soundOn={soundOn} barRef={barRef} />
        ) : null}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-black/60 via-black/25 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/45 to-transparent" />

      {paused && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md"><Play className="size-8 fill-white" /></div>
      )}

      {/* hairline playback progress */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-white/15">
        <div data-feed-progress ref={barRef} className="h-full origin-left bg-white/80" style={{ transform: 'scaleX(0)' }} />
      </div>

      <header className={`absolute inset-x-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+0.5rem)] flex items-start gap-3 transition-opacity duration-700 ${props.dimmed ? 'opacity-65' : 'opacity-100'}`} onClick={stop}>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2">
            {item.is_incog || !item.creator_username
              ? <span className="truncate text-[15px] font-bold drop-shadow">{name}</span>
              : <Link href={`/profile/${item.creator_username}`} className="truncate text-[15px] font-bold drop-shadow hover:underline">{name}</Link>}
            {follow && !isOwn && creatorId && (
              <FollowButton following={follow.following} onToggle={() => void social.toggleFollow(creatorId, follow.following, item.id)} />
            )}
          </div>
          <p className="mt-1 line-clamp-1 text-[13px] leading-snug text-white/85 drop-shadow">
            {missingMedia ? fallback : item.ai_summary ?? (item.topic_entity ? `A take on ${item.topic_entity}` : 'New review')}
            {item.topic_entity && (
              <button type="button" onClick={props.onCounterTake} className="ml-1.5 font-semibold text-white hover:underline">#{item.topic_entity.replace(/\s+/g, '_').toLowerCase()}</button>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <SoundOrb soundOn={soundOn} playing={active && !paused} onToggle={onToggleSound} />
            <ShareOrb onShare={onShare} />
          </div>
        </div>
      </header>
    </motion.div>
  );
}

/** Plays only while active; neighbouring cards keep a paused, preloaded video so a swipe starts instantly. */
function PostVideo({ src, active, paused, soundOn, barRef, onFailure }: { onFailure: () => void; src: string; active: boolean; paused: boolean; soundOn: boolean; barRef: RefObject<HTMLElement | null> }): ReactNode {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active && !paused) void video.play().catch(() => {});
    else video.pause();
  }, [active, paused, src]);
  return (
    <video
      ref={ref}
      src={src}
      onError={onFailure}
      playsInline
      loop
      autoPlay={active}
      muted={!soundOn || !active}
      preload="auto"
      crossOrigin={corsSafe(src) ? 'anonymous' : undefined}
      className="size-full object-cover"
      onTimeUpdate={(e) => {
        const bar = barRef.current;
        const { currentTime, duration } = e.currentTarget;
        if (bar && Number.isFinite(duration) && duration > 0) bar.style.transform = `scaleX(${Math.min(1, currentTime / duration)})`;
      }}
    />
  );
}

