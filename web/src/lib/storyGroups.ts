import type { PrivacyMode } from '../types/privacy.ts';

export type Story = {
  id: string;
  user_id: string;
  mode: PrivacyMode;
  avatar_id: string | null;
  media_url: string;
  motion_url: string | null;
  expires_at: string;
  created_at: string;
};

export type StoryRow = Story & { creator: { username: string; avatar_id: string } | { username: string; avatar_id: string }[] | null };

/** One creator's live stories, oldest first so they play in the order they were posted. */
export type StoryGroup = { userId: string; username: string; avatarId: string; stories: Story[]; latestAt: string };

/** Groups stories by creator; the creator with the newest story comes first. Expired stories are dropped. */
export function groupStories(rows: readonly StoryRow[], now: number): StoryGroup[] {
  const groups = new Map<string, StoryGroup>();
  for (const row of [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (new Date(row.expires_at).getTime() <= now) continue;
    const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
    const story: Story = { id: row.id, user_id: row.user_id, mode: row.mode, avatar_id: row.avatar_id, media_url: row.media_url, motion_url: row.motion_url, expires_at: row.expires_at, created_at: row.created_at };
    const group = groups.get(row.user_id) ?? { userId: row.user_id, username: creator?.username ?? 'unknown', avatarId: creator?.avatar_id ?? 'cyber_monk', stories: [], latestAt: row.created_at };
    group.stories.push(story);
    group.latestAt = row.created_at;
    groups.set(row.user_id, group);
  }
  return [...groups.values()].sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
}
