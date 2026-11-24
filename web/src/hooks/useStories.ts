'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeMedia, toMediaInput, uploadMedia } from '@/lib/r2Upload';
import { ensureSession } from '@/lib/session';
import { sendStoryReaction } from '@/lib/storyReactions';
import { groupStories, type StoryGroup, type StoryRow } from '@/lib/storyGroups';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { RecordedSnapPayload } from '@/types/privacy';

export type { StoryGroup };

const COLUMNS = 'id, user_id, mode, avatar_id, media_url, motion_url, expires_at, created_at, creator:users!user_id(username, avatar_id)';

export type Stories = {
  /** Live (under 24 hours old) stories, one group per creator, the creator who posted last first. */
  storyGroups: StoryGroup[];
  isLoading: boolean;
  error: string | null;
  refreshStories: () => Promise<void>;
  replyToStory: typeof sendStoryReaction;
  /** Uploads the clip to R2 (1-day prefix) and publishes it as a story. Resolves with the new story's id. */
  postStory: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<string>;
};

async function fetchGroups(): Promise<StoryGroup[]> {
  const now = Date.now();
  const { data, error } = await supabase.from('stories').select(COLUMNS).gt('expires_at', new Date(now).toISOString()).order('created_at', { ascending: true });
  if (error) throw new Error('Could not load stories.');
  return groupStories(data as unknown as StoryRow[], now);
}

/** Everyone's live stories, grouped by creator, plus posting your own. */
export function useStories(): Stories {
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refreshStories = useCallback(async () => {
    try {
      const groups = await fetchGroups();
      if (!aliveRef.current) return;
      setStoryGroups(groups);
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'Could not load stories.');
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!isSupabaseConfigured) return;
    let stopped = false;
    let sequence = 0;
    const sync = () => {
      const next = ++sequence;
      void fetchGroups().then(groups => {
        if (!stopped && next === sequence) { setStoryGroups(groups); setError(null); }
      }).catch((e: unknown) => {
        if (!stopped && next === sequence) setError(e instanceof Error ? e.message : 'Could not load stories.');
      }).finally(() => { if (!stopped) setIsLoading(false); });
    };
    sync();
    const channel = supabase.channel('stories:' + safeRandomUUID())
      .on('postgres_changes', {event:'*', schema:'public', table:'stories'}, sync)
      .subscribe(status => { if (status === 'SUBSCRIBED') sync(); });
    const timer = setInterval(sync, 60000);
    return () => { stopped = true; aliveRef.current = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const expiries = storyGroups.flatMap(group => group.stories.map(s => Date.parse(s.expires_at)));
    if (!expiries.length) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setStoryGroups(groups => groups.map(group => ({...group, stories:group.stories.filter(s => Date.parse(s.expires_at) > now)})).filter(g => g.stories.length));
    }, Math.max(1, Math.min(...expiries) - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [storyGroups]);

  const postStory = useCallback(
    async (payload: RecordedSnapPayload | MaskRecordingPayload): Promise<string> => {
      const input = toMediaInput(payload);
      const { mode, avatarId } = describeMedia(input);
      const session = await ensureSession();
      const uploaded = await uploadMedia(session.access_token, input, '1d');
      const id = safeRandomUUID();
      // The database sets the 24-hour expiry itself; the client cannot make a story last longer.
      const { error: insertError } = await supabase.from('stories').insert({
        id, user_id: session.user.id, mode, avatar_id: avatarId, media_url: uploaded.mediaUrl, motion_url: uploaded.motionUrl,
      });
      if (insertError) throw new Error('Could not post your story. Try again.');
      await refreshStories();
      return id;
    },
    [refreshStories],
  );

  return { storyGroups, isLoading, error, refreshStories, postStory, replyToStory: sendStoryReaction };
}

export type StoryViewerReceipt = { viewer_id: string; viewed_at: string; viewer: {username:string} | null };

/** One receipt per viewer, with a live list available only to the story owner. */
export function useStoryReceipts(storyId: string | undefined, ownerId: string | undefined, viewerId: string | null) {
  const [receipts, setReceipts] = useState<{id: string; rows: StoryViewerReceipt[]} | null>(null);
  useEffect(() => {
    if (!storyId || !ownerId || !viewerId) return;
    let alive = true;
    if (ownerId !== viewerId) {
      const record = () => {
        if (document.visibilityState === 'visible') void supabase.from('story_views').upsert(
          {story_id:storyId, viewer_id:viewerId}, {onConflict:'story_id,viewer_id', ignoreDuplicates:true}
        ).then();
      };
      record();
      document.addEventListener('visibilitychange', record);
      window.addEventListener('online', record);
      return () => { document.removeEventListener('visibilitychange', record); window.removeEventListener('online', record); };
    }
    let revision = 0;
    const update = async () => {
      const version = ++revision;
      const rows: StoryViewerReceipt[] = [];
      for (let offset = 0; alive && revision === version; offset += 500) {
        const {data,error} = await supabase.from('story_views').select('viewer_id,viewed_at,viewer:users!viewer_id(username)')
          .eq('story_id',storyId).order('viewed_at').order('viewer_id').range(offset, offset + 499);
        if (error || !data || !alive || revision !== version) return;
        rows.push(...data as unknown as StoryViewerReceipt[]);
        if (data.length < 500) break;
      }
      if (alive && revision === version) setReceipts({id:storyId, rows});
    };
    let refreshTimer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void update(), 150); };
    void update();
    const channel = supabase.channel('story-views:' + storyId + ':' + safeRandomUUID())
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'story_views', filter:'story_id=eq.' + storyId}, schedule)
      .subscribe(status => { if (status === 'SUBSCRIBED') schedule(); });
    return () => { alive = false; clearTimeout(refreshTimer); void supabase.removeChannel(channel); };
  }, [storyId, ownerId, viewerId]);
  return ownerId === viewerId && receipts?.id === storyId ? receipts?.rows ?? [] : [];
}
