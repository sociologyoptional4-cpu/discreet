'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MaskPlayback } from '@/components/MaskPlayback';
import { PrivacyCamera } from '@/components/PrivacyCamera';
import { useStories, useStoryReceipts } from '@/hooks/useStories';
import { AVATAR_META, isAvatarId } from '@/lib/avatars';
import { currentUserId } from '@/lib/session';
import type { Story, StoryGroup } from '@/lib/storyGroups';
import { REACTION_MESSAGE, STORY_REACTIONS, sendStoryReaction, type StoryReaction } from '@/lib/storyReactions';
import { isSupabaseConfigured } from '@/lib/supabase';

const STORY_SECONDS = 8; // a story's length is not stored, so each one plays for a fixed time (clips loop within it)
const TICK_MS = 100;

const SEEN_KEY = 'vybe:stories-seen';
const SEEN_EVENT = 'vybe:stories-seen-change';
const seenSnapshot = () => (typeof window === 'undefined' ? '' : window.localStorage.getItem(SEEN_KEY) ?? '');
const subscribeSeen = (cb: () => void) => {
  window.addEventListener(SEEN_EVENT, cb);
  return () => window.removeEventListener(SEEN_EVENT, cb);
};
/** Remembers on this device which stories were opened, so their ring turns grey. Keeps the newest 300 ids. */
function markSeen(ids: readonly string[]): void {
  try {
    const seen = new Set(seenSnapshot().split(',').filter(Boolean));
    for (const id of ids) seen.add(id);
    window.localStorage.setItem(SEEN_KEY, [...seen].slice(-300).join(','));
    window.dispatchEvent(new Event(SEEN_EVENT));
  } catch { /* storage unavailable: rings just stay bright */ }
}

type StripProps = { adding: boolean; onAddingChange: (adding: boolean) => void };

/** The row of active 24-hour stories, an "Add Story" orb, and a full-screen viewer with reactions. */
export function StoryStrip({ adding, onAddingChange }: StripProps) {
  const { storyGroups, isLoading, error, postStory } = useStories();
  const [viewingGroup, setViewingGroup] = useState<number | null>(null);
  const seenRaw = useSyncExternalStore(subscribeSeen, seenSnapshot, () => '');
  const reduce = useReducedMotion();

  if (!isSupabaseConfigured) return null;
  const seen = new Set(seenRaw.split(','));

  return (
    <section aria-label="Stories">
      <ul className="flex gap-3 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none]">
        <li className="shrink-0">
          <button type="button" onClick={() => onAddingChange(true)} className="flex w-[72px] flex-col items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <span aria-hidden className="relative flex size-16 items-center justify-center rounded-full border border-white/90 bg-white/80 text-2xl font-light text-slate-700 shadow-[0_10px_24px_rgba(196,181,253,.55),0_4px_14px_rgba(254,205,211,.6)] backdrop-blur-xl">
              <span className="absolute inset-1 rounded-full bg-[radial-gradient(circle_at_30%_25%,#fff,transparent_60%)]" />
              <span className="relative">+</span>
            </span>
            Add Story
          </button>
        </li>
        {storyGroups.map((group, index) => {
          const unseen = group.stories.some((st) => !seen.has(st.id));
          return (
            <li key={group.userId} className="shrink-0">
              <button type="button" onClick={() => { markSeen(group.stories.map((st) => st.id)); setViewingGroup(index); }}
                aria-label={`View ${group.username}'s story, ${group.stories.length} ${group.stories.length === 1 ? 'clip' : 'clips'}${unseen ? ', new' : ''}`}
                className="flex w-[72px] flex-col items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                <span aria-hidden className="relative flex size-16 items-center justify-center">
                  {unseen ? (
                    <motion.span className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#67e8f9,#a78bfa,#fdba74,#f9a8d4,#67e8f9)] shadow-[0_0_16px_rgba(167,139,250,.45)]"
                      animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }} />
                  ) : (
                    <span className="absolute inset-0 rounded-full bg-slate-300/70" />
                  )}
                  <span className="absolute inset-[3px] rounded-full bg-[#F2F4F7]" />
                  <span className="relative flex size-[54px] items-center justify-center rounded-full text-sm font-black text-white shadow-[inset_-4px_-5px_10px_rgba(0,0,0,.15),inset_4px_4px_8px_rgba(255,255,255,.6)]"
                    style={{ background: avatarAccent(group.avatarId) }}>
                    {group.username.slice(0, 2).toUpperCase()}
                  </span>
                </span>
                <span className={`w-full truncate ${unseen ? '' : 'text-slate-400'}`}>{group.username}</span>
              </button>
            </li>
          );
        })}
        {isLoading && [0, 1, 2].map((i) => <li key={i} aria-hidden className="size-16 shrink-0 animate-pulse rounded-full bg-white/70" />)}
      </ul>
      {error && <p role="alert" className="px-4 text-xs font-medium text-rose-600">{error}</p>}

      {adding && (
        <div role="dialog" aria-modal="true" aria-label="Add a story" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="w-[min(100vw,calc(100dvh*9/16))]">
            <PrivacyCamera onClose={() => onAddingChange(false)} onSubmitMedia={async (payload) => { await postStory(payload); }} submitLabel="Post story" />
          </div>
        </div>
      )}

      {viewingGroup !== null && storyGroups.length > 0 && (
        <StoryViewer groups={storyGroups} startGroup={Math.min(viewingGroup, storyGroups.length - 1)} onClose={() => setViewingGroup(null)} />
      )}
    </section>
  );
}

const avatarAccent = (avatarId: string): string => (isAvatarId(avatarId) ? AVATAR_META[avatarId].accent : '#c4b5fd');

type Position = { group: number; story: number };

function StoryViewer({ groups, startGroup, onClose }: { groups: StoryGroup[]; startGroup: number; onClose: () => void }) {
  const [pos, setPos] = useState<Position>({ group: startGroup, story: 0 });
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const group = groups[Math.min(pos.group, groups.length - 1)];
  const story: Story | undefined = group.stories[Math.min(pos.story, group.stories.length - 1)];

  const viewers = useStoryReceipts(story?.id, story?.user_id, viewerId);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{y:number;at:number} | null>(null);
  const suppressClick = useRef(false);
  const begin = (y: number) => {
    touch.current = {y,at:performance.now()};
    suppressClick.current = false;
    setPaused(true);
  };
  const end = (y: number) => {
    if (!touch.current) return;
    const distance = y - touch.current.y;
    suppressClick.current = performance.now() - touch.current.at > 250 || Math.abs(distance) > 35;
    touch.current = null;
    setPaused(false);
    if (distance > 70) onClose();
  };

  useEffect(() => {
    let alive = true;
    void currentUserId().then((id) => { if (alive) setViewerId(id); });
    return () => { alive = false; };
  }, []);

  const next = useCallback(() => {
    setNote(null);
    setPos((p) => {
      const g = groups[Math.min(p.group, groups.length - 1)];
      if (p.story + 1 < g.stories.length) return { group: p.group, story: p.story + 1 };
      if (p.group + 1 < groups.length) return { group: p.group + 1, story: 0 };
      return p; // last story of the last group: handled below
    });
    const last = pos.group >= groups.length - 1 && pos.story + 1 >= group.stories.length;
    if (last) onClose();
  }, [groups, pos, group, onClose]);

  const previous = useCallback(() => {
    setNote(null);
    setPos((p) => {
      if (p.story > 0) return { group: p.group, story: p.story - 1 };
      if (p.group > 0) return { group: p.group - 1, story: groups[p.group - 1].stories.length - 1 };
      return p;
    });
  }, [groups]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, next, previous]);

  const react = async (reaction: StoryReaction) => {
    if (!story || sending) return;
    setSending(true);
    try {
      const result = await sendStoryReaction(story.user_id, story.id, reaction);
      setNote(result === 'sent' ? `${REACTION_MESSAGE.sent} ${reaction}` : REACTION_MESSAGE[result]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not send your reaction.');
    } finally {
      setSending(false);
    }
  };

  if (!story) return null;
  const isOwn = viewerId !== null && viewerId === story.user_id;

  return (
    <div role="dialog" aria-modal="true" aria-label={`${group.username}'s story`} className="fixed inset-0 z-50 flex items-center justify-center bg-black text-white">
      <div className="relative h-full w-[min(100vw,calc(100dvh*9/16))] overflow-hidden">
        <StoryPlayer paused={paused} key={story.id} story={story} index={pos.story} count={group.stories.length} onDone={next} />

        {/* Tap zones: the left third goes back, the rest goes forward. */}
        <button type="button" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); begin(e.clientY); }} onPointerUp={e => end(e.clientY)} onPointerCancel={() => { touch.current = null; setPaused(false); }} onClick={() => { if (!suppressClick.current) previous(); suppressClick.current = false; }} aria-label="Previous story" className="absolute inset-y-16 left-0 z-10 w-1/3" />
        <button type="button" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); begin(e.clientY); }} onPointerUp={e => end(e.clientY)} onPointerCancel={() => { touch.current = null; setPaused(false); }} onClick={() => { if (!suppressClick.current) next(); suppressClick.current = false; }} aria-label="Next story" className="absolute inset-y-16 right-0 z-10 w-2/3" />

        <div className="absolute inset-x-0 top-5 z-20 flex items-center justify-between px-3 pt-[env(safe-area-inset-top)]">
          <span className="rounded bg-black/50 px-2 py-1 text-sm font-semibold">@{group.username}</span>
          <button type="button" onClick={onClose} aria-label="Close story" className="min-h-11 min-w-11 rounded bg-black/50 px-3 text-sm">Close</button>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {(note || isOwn) && <p role="status" className="rounded bg-black/70 px-3 py-1 text-sm">{note ?? `${viewers.length} views${viewers.length ? ' · ' + viewers.map(v => '@' + (v.viewer?.username ?? 'unknown')).join(', ') : ''}`}</p>}
          {!isOwn && (
            <div className="flex gap-3" role="group" aria-label="React to this story">
              {STORY_REACTIONS.map((emoji) => (
                <button key={emoji} type="button" disabled={sending} onClick={() => void react(emoji)} aria-label={`React ${emoji}`} className="size-12 rounded-full bg-black/50 text-2xl disabled:opacity-50">
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One story: its media, a segment per clip in the group, and a timer that calls `onDone` when its time is up. */
function StoryPlayer({ story, index, count, onDone, paused }: { paused: boolean; story: Story; index: number; count: number; onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (paused) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === 'visible') elapsedRef.current += now - last;
      last = now;
      const ms = elapsedRef.current;
      if (ms >= STORY_SECONDS * 1000) {
        clearInterval(id);
        doneRef.current();
      } else {
        setElapsed(ms);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <>
      {story.mode === 'mask' ? (
        <MaskPlayback avatarId={isAvatarId(story.avatar_id) ? story.avatar_id : null} motionUrl={story.motion_url} audioUrl={story.media_url} paused={paused} soundOn />
      ) : (
        <StoryVideo src={story.media_url} paused={paused} />
      )}
      <ol aria-label={`Clip ${index + 1} of ${count}`} className="absolute inset-x-2 top-2 z-20 flex gap-1 pt-[env(safe-area-inset-top)]">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="h-1 flex-1 overflow-hidden rounded bg-white/30">
            <div className="h-full bg-white" style={{ width: `${i < index ? 100 : i === index ? (elapsed / (STORY_SECONDS * 1000)) * 100 : 0}%` }} />
          </li>
        ))}
      </ol>
    </>
  );
}

function StoryVideo({ src, paused }: { src: string; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) { video.pause(); return; }
    video.play().catch(() => {
      video.muted = true; // sound is refused without a recent tap; a muted story is better than a frozen one
      void video.play().catch(() => {});
    });
  }, [src, paused]);
  return <video ref={ref} src={src} playsInline autoPlay loop className="size-full object-cover" />;
}
