'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, Heart, MessageCircle, Pause, Play, Share2, Volume2, VolumeX } from 'lucide-react';
import { MaskPlayback } from '@/components/MaskPlayback';
import { SwipeBubbleOverlay } from '@/components/SwipeBubbleOverlay';
import type { SocialActions } from '@/hooks/useSocialActions';
import { AVATAR_META, STUDIO_BACKDROP } from '@/lib/avatars';
import type { FeedItem, Sentiment } from '@/types/social';

const compact = (n: number): string => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
const SENTIMENT: Record<Sentiment, { dot: string; label: string }> = {
  positive: { dot: 'bg-emerald-400', label: 'Positive' },
  negative: { dot: 'bg-rose-400', label: 'Negative' },
  neutral: { dot: 'bg-white/50', label: 'Neutral' },
};

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
  onMessage: () => void;
};

const glass = 'flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/15 focus-visible:outline-2 focus-visible:outline-white';
const stop = (event: MouseEvent): void => event.stopPropagation();

/**
 * One post. Collapsed it is a rounded card with two lines of text, a heart and a hairline progress bar; tapping it
 * expands the same element to full screen (so the video or the 3D canvas never reloads) with the creator and three actions.
 */
export function FeedCard(props: FeedCardProps) {
  const { item, active, near, expanded, paused, soundOn, social, onExpand, onCollapse, onTogglePause, onToggleSound, onShare, onMessage } = props;
  const reduceMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const [likeBurst, setLikeBurst] = useState(0);
  const like = social.likeView(item);
  const creatorId = item.user_id;
  const follow = creatorId ? social.followView(creatorId, { following: item.following, followers: item.creator_followers_count ?? 0 }) : null;
  const isOwn = creatorId !== null && social.viewerId === creatorId;
  const sentiment = item.sentiment ? SENTIMENT[item.sentiment] : null;
  const name = item.is_incog ? (item.incog_alias ?? 'Anon') : `@${item.creator_username}`;
  const accent = item.creator_avatar_id ? AVATAR_META[item.creator_avatar_id].accent : '#ffffff';

  const toggleLike = (event: MouseEvent) => {
    stop(event);
    if (!like.liked) setLikeBurst(Date.now());
    void social.toggleLike(item.id, like.liked);
  };
  const doubleTapLike = (event: MouseEvent) => {
    event.preventDefault();
    if (!like.liked) { setLikeBurst(Date.now()); void social.toggleLike(item.id, false); }
  };
  const open = (event: KeyboardEvent) => {
    if (!expanded && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onExpand();
    }
  };

  const heart = (
    <button type="button" onClick={toggleLike} aria-pressed={like.liked} aria-label={like.liked ? `Unlike. ${like.count} likes` : `Like. ${like.count} likes`} className={`${glass} size-12`}>
      <Heart key={String(like.liked)} aria-hidden className={`size-6 ${like.liked ? 'heart-pop fill-rose-500 text-rose-500' : 'text-white'}`} />
    </button>
  );
  const pauseOrb = (size: string) => (
    <button type="button" onClick={(e) => { stop(e); onTogglePause(); }} aria-label={paused ? 'Play' : 'Pause'} className={`flex items-center justify-center rounded-full border border-white/30 bg-slate-900/70 text-white shadow-[0_8px_22px_rgba(0,0,0,.2)] backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-white ${size}`}>
      {paused ? <Play aria-hidden className="size-5 fill-white" /> : <Pause aria-hidden className="size-5 fill-white" />}
    </button>
  );

  return (
    <motion.div
      layout
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}
      style={{ borderRadius: expanded ? 0 : 28 }}
      className={`${expanded ? 'fixed inset-0 z-50' : 'absolute inset-0'} overflow-hidden bg-black text-white`}
      onClick={expanded ? onTogglePause : onExpand}
      onDoubleClick={doubleTapLike}
      onKeyDown={open}
      role={expanded ? undefined : 'button'}
      tabIndex={expanded ? undefined : 0}
      aria-label={expanded ? undefined : `Open post ${item.topic_entity ? `about ${item.topic_entity}` : ''} by ${name}`}
    >
      <SwipeBubbleOverlay trigger={likeBurst} kind="like" />
      <div className="absolute inset-0">
        {item.mode === 'mask' ? (
          active ? (
            <MaskPlayback key={item.id} avatarId={item.avatar_id} motionUrl={item.motion_url} audioUrl={item.media_url} soundOn={soundOn} paused={paused} barRef={barRef} />
          ) : (
            <div className="size-full" style={{ background: STUDIO_BACKDROP[item.avatar_id ?? 'cyber_monk'] }} />
          )
        ) : near ? (
          <PostVideo src={item.media_url} active={active} paused={paused} soundOn={soundOn} barRef={barRef} />
        ) : null}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
      {expanded && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent" />}

      {expanded && paused && (
        <div aria-hidden className={`${glass} pointer-events-none absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2`}><Play className="size-8 fill-white" /></div>
      )}

      {/* hairline progress */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-white/20">
        <div ref={barRef} className="h-full origin-left bg-white" style={{ transform: 'scaleX(0)' }} />
      </div>

      {!expanded ? (
        <>
          <div className="absolute bottom-6 left-5 right-24 flex flex-col gap-0.5">
            <span className="truncate text-[17px] font-medium leading-tight">{item.topic_entity ? `#${item.topic_entity}` : 'New review'}</span>
            <span className="truncate text-sm text-white/70">{name}</span>
          </div>
          <div className="absolute bottom-5 right-4 flex flex-col items-center gap-2">
            {heart}
            <span className="text-xs font-medium tabular-nums" aria-hidden>{compact(like.count)}</span>
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">{pauseOrb('size-11')}</div>
        </>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduceMotion ? 0 : 0.15, duration: reduceMotion ? 0 : 0.25 }}>
          <div className="absolute inset-x-0 top-0 flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]" onClick={stop}>
            <button type="button" onClick={onCollapse} aria-label="Back to the feed" className={`${glass} size-11`}><ArrowLeft aria-hidden className="size-5" /></button>
            <span aria-hidden className="flex size-9 items-center justify-center rounded-full border text-xs font-bold" style={{ borderColor: accent, color: accent }}>
              {name.replace('@', '').slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}{item.is_incog ? ' • Incog' : ''}</span>
            {follow && !isOwn && creatorId && (
              <button
                type="button"
                onClick={() => void social.toggleFollow(creatorId, follow.following)}
                aria-pressed={follow.following}
                className={`min-h-9 rounded-full px-4 text-sm font-medium backdrop-blur-md ${follow.following ? 'border border-white/30 bg-white/10' : 'bg-white text-black'}`}
              >
                {follow.following ? 'Following' : 'Follow'}
              </button>
            )}
            <button type="button" onClick={onToggleSound} aria-pressed={soundOn} aria-label={soundOn ? 'Mute' : 'Turn sound on'} className={`${glass} size-9`}>
              {soundOn ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4" />}
            </button>
          </div>

          <div className="absolute bottom-8 left-5 right-24 flex flex-col gap-1.5" onClick={stop}>
            <span className="text-lg font-medium leading-tight">{item.topic_entity ? `#${item.topic_entity}` : 'New review'}</span>
            {item.ai_summary && <p className="line-clamp-2 text-sm text-white/85">{item.ai_summary}</p>}
            {sentiment && (
              <span className="flex items-center gap-1.5 text-xs text-white/75">
                <span aria-hidden className={`size-2 rounded-full ${sentiment.dot}`} /> {sentiment.label}
              </span>
            )}
          </div>

          <div className="absolute bottom-7 right-4 flex flex-col items-center gap-3" onClick={stop}>
            <div className="flex flex-col items-center gap-1">
              {heart}
              <span className="text-xs font-medium tabular-nums" aria-hidden>{compact(like.count)}</span>
            </div>
            {creatorId && !isOwn && (
              <button type="button" onClick={onMessage} aria-label={`Message ${name}`} className={`${glass} size-12`}><MessageCircle aria-hidden className="size-6" /></button>
            )}
            <button type="button" onClick={onShare} aria-label="Share this post" className={`${glass} size-12`}><Share2 aria-hidden className="size-6" /></button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/** Plays only while active; neighbouring cards keep a paused, preloaded video so a swipe starts instantly. */
function PostVideo({ src, active, paused, soundOn, barRef }: { src: string; active: boolean; paused: boolean; soundOn: boolean; barRef: RefObject<HTMLElement | null> }): ReactNode {
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
      playsInline
      loop
      autoPlay={active}
      muted={!soundOn || !active}
      preload="auto"
      className="size-full object-cover"
      onTimeUpdate={(e) => {
        const bar = barRef.current;
        const { currentTime, duration } = e.currentTarget;
        if (bar && Number.isFinite(duration) && duration > 0) bar.style.transform = `scaleX(${Math.min(1, currentTime / duration)})`;
      }}
    />
  );
}

