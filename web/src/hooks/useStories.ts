'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeMedia, toMediaInput, uploadMedia } from '@/lib/r2Upload';
import { ensureSession } from '@/lib/session';
import { groupStories, type StoryGroup, type StoryRow } from '@/lib/storyGroups';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
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
    if (isSupabaseConfigured) {
      fetchGroups()
        .then((groups) => { if (aliveRef.current) { setStoryGroups(groups); setError(null); } })
        .catch((e: unknown) => { if (aliveRef.current) setError(e instanceof Error ? e.message : 'Could not load stories.'); })
        .finally(() => { if (aliveRef.current) setIsLoading(false); });
    }
    return () => { aliveRef.current = false; };
  }, []);

  const postStory = useCallback(
    async (payload: RecordedSnapPayload | MaskRecordingPayload): Promise<string> => {
      const input = toMediaInput(payload);
      const { mode, avatarId } = describeMedia(input);
      const session = await ensureSession();
      const uploaded = await uploadMedia(session.access_token, input, '1d');
      const id = crypto.randomUUID();
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

  return { storyGroups, isLoading, error, refreshStories, postStory };
}
