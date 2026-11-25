'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Play } from 'lucide-react';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';
import { CommentOrb, FollowButton, ShareOrb, SoundOrb } from '@/components/feed/FeedControls';
import type { SocialActions } from '@/hooks/useSocialActions';
import { useNegativeFeedback } from '@/hooks/useNegativeFeedback';
import { STUDIO_BACKDROP } from '@/lib/avatars';
import { playCue } from '@/lib/chat/spatialAudio';
import { isCorsSafeMediaUrl } from '@/lib/media/corsSafe';
import { isImageUrl } from '@/lib/media/mediaKind';
import { attachVideo, markLive, playVideo, POOL_SIZE, setVideoMuted, VideoPoolContext, watchSilence } from '@/lib/media/videoPool';
import { parsePlayableRecipe } from '@/types/playable';
import type { FeedItem } from '@/types/social';

/** The 3D engine loads only when an active slide actually is a playable scene. */
const PlayableSceneCanvas = dynamic(() => import('@/components/playable/PlayableSceneCanvas'), { ssr: false });

export type FeedCardProps = {
  item: FeedItem;
  active: boolean;
  /** Close enough to the screen that a video should be loaded (`Math.abs(index - activeIndex) <= 1`). */
  near: boolean;
  /** Position in the feed; picks which pooled video element this card uses. */
  index: number;
  expanded: boolean;
  paused: boolean;
  soundOn: boolean;
  social: SocialActions;
  onExpand: () => void;
  onCollapse: () => void;
  onTogglePause: () => void;
  onToggleSound: () => void;
  /** The browser refused to autoplay with sound: the feed flips to muted so the sound control tells the truth. */
  onSoundBlocked: () => void;
  onShare: () => void;
  onCounterTake: () => void;
  onNotInterested: () => void;
  /** After a few seconds of uninterrupted watching the overlays fade back so the video takes over. */
  dimmed: boolean;
  /** Every reaction (emoji tap or double-tap like), with where it happened, so the feed can burst and glow. */
  onReact: (emoji: string, x: number, y: number) => void;
  commentsCount?: number;
  onOpenComments?: () => void;
};

const HEART = '❤️';
const stop = (event: MouseEvent): void => event.stopPropagation();

/**
 * One full-screen post, video first: only the creator, a one-line caption and three glass controls float at the top. Reactions live behind the left edge (EdgeEmojiArc). Tap pauses, double-tap likes, long-press hides.
 */
export function FeedCard(props: FeedCardProps) {
  const { item, active, near, expanded, paused, soundOn, social, onExpand, onTogglePause, onToggleSound, onShare, onReact } = props;
  const longPress = useNegativeFeedback(props.onNotInterested);
  const reduceMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const recipe = useMemo(
    () => (item.post_format === 'recipe_avatar' || item.post_format === 'recipe_shayari' ? parsePlayableRecipe(item.recipe_data) : null),
    [item.post_format, item.recipe_data],
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [stillFailedUrl, setStillFailedUrl] = useState<string | null>(null);
  // Photo posts are still images. A video that fails to load is tried as an image once (older photo posts were saved
  // under a video file name), and only then reported as unavailable.
  const asStill = isImageUrl(item.media_url) || failedUrl === item.media_url;
  const missingMedia = !item.media_url || (asStill && stillFailedUrl === item.media_url);
  const fallback = item.transcript || item.ai_summary || 'Media unavailable';
  const [tapHeart, setTapHeart] = useState<{ id: number; x: number; y: number } | null>(null);
  const toastSeq = useRef(0);
  const like = social.likeView(item);
  const creatorId = item.user_id;
  const creatorHandle = item.creator_username;
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
      onClick={() => {
        if (!soundOn) {
          onToggleSound();
          return;
        }
        onTogglePause();
      }}
      onDoubleClick={doubleTapLike}
      onKeyDown={open}
      role="article"
      tabIndex={0}
      aria-label={`Post ${item.topic_entity ? `about ${item.topic_entity}` : ''} by ${name}`}
    >
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
        {recipe ? (
          active ? (
            <PlayableSceneCanvas recipe={recipe} isActive={active} isMuted={!soundOn} />
          ) : item.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnail_url} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <div aria-hidden className="size-full bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-900" />
          )
        ) : item.mode === 'mask' ? (
          active ? null : (
            <div className="size-full" style={{ background: STUDIO_BACKDROP[item.avatar_id ?? 'cyber_monk'] }} />
          )
        ) : near && !missingMedia && asStill ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.media_url} alt={item.ai_summary ?? ''} className="size-full object-cover" onError={() => setStillFailedUrl(item.media_url)} decoding="async" />
        ) : near && !missingMedia ? (
          <PostVideo
            src={item.media_url}
            thumbnailUrl={item.thumbnail_url}
            onFailure={() => setFailedUrl(item.media_url)}
            active={active}
            slot={props.index}
            paused={paused}
            soundOn={soundOn}
            onSoundBlocked={props.onSoundBlocked}
            barRef={barRef}
          />
        ) : item.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnail_url} alt="" className="size-full object-cover" loading="lazy" />
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
            {follow && !isOwn && creatorId && creatorHandle && (
              <FollowButton following={follow.following} onToggle={() => void social.toggleFollow({ id: creatorId, username: creatorHandle }, follow.following, item.id)} />
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
            {props.onOpenComments && (
              <CommentOrb count={props.commentsCount ?? item.comments_count ?? 0} onOpen={props.onOpenComments} />
            )}
          </div>
        </div>
      </header>
    </motion.div>
  );
}

/** Plays a post through one of the feed's three persistent <video> elements, moved into this card while it is near. */
function PostVideo({
  src,
  thumbnailUrl,
  slot,
  active,
  paused,
  soundOn,
  barRef,
  onFailure,
  onSoundBlocked,
}: {
  onFailure: () => void;
  onSoundBlocked: () => void;
  src: string;
  thumbnailUrl?: string | null;
  slot: number;
  active: boolean;
  paused: boolean;
  soundOn: boolean;
  barRef: RefObject<HTMLElement | null>;
}): ReactNode {
  const pool = useContext(VideoPoolContext);
  const video = pool?.[slot % POOL_SIZE] ?? null;
  const host = useRef<HTMLDivElement>(null);
  const [readyToShow, setReadyToShow] = useState(false);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !video) return;
    return attachVideo(video, el, src, isCorsSafeMediaUrl(src));
  }, [video, src]);

  useEffect(() => {
    if (!video) return;
    const onPlaying = () => setReadyToShow(true);
    const onLoaded = () => { if (video.readyState >= 3) setReadyToShow(true); };
    const onTime = () => {
      const bar = barRef.current;
      const { currentTime, duration } = video;
      if (bar && Number.isFinite(duration) && duration > 0) bar.style.transform = `scaleX(${Math.min(1, currentTime / duration)})`;
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('error', onFailure);
    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('error', onFailure);
    };
  }, [video, barRef, onFailure]);

  useEffect(() => {
    if (!video) return;
    markLive(video, active && !paused);
    setVideoMuted(video, !soundOn || !active);
    return () => markLive(video, false);
  }, [video, active, paused, soundOn]);

  useEffect(() => {
    if (!video || !active || !soundOn) return;
    return watchSilence(video, onSoundBlocked);
  }, [video, active, soundOn, onSoundBlocked]);

  useEffect(() => {
    if (!video) return;
    if (active && !paused) {
      playVideo(video, soundOn, onSoundBlocked);
    } else {
      video.pause();
    }
    // onSoundBlocked only reports a refused autoplay and must not restart playback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, active, paused, soundOn, src]);

  return (
    <div className="relative size-full bg-black">
      <div ref={host} className="absolute inset-0" />
      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt=""
          className={`pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-200 ${
            readyToShow && active ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
    </div>
  );
}
