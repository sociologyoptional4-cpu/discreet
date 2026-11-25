import 'server-only';
import { getSupabaseAdmin } from './admin';
import type { ChatParticipant, SharedPostPreview } from '@/types/chat';

type UserRow = { id: string; username: string; avatar_id: string; custom_avatar_url?: string | null; vibe_level?: number | null };

export const toParticipant = (row: UserRow | null | undefined): ChatParticipant => ({
  id: row?.id ?? '',
  username: row?.username ?? 'unknown',
  avatarId: row?.avatar_id ?? 'cyber_monk',
  avatarUrl: row?.custom_avatar_url ?? null,
  vibeLevel: row?.vibe_level ?? 1,
});

/** Previews of live, non-Incog posts only; any other id is simply absent from the result. */
export async function fetchPostPreviews(ids: readonly string[]): Promise<Map<string, SharedPostPreview>> {
  const map = new Map<string, SharedPostPreview>();
  if (ids.length === 0) return map;
  const { data } = await getSupabaseAdmin()
    .from('posts')
    .select('id, thumbnail_url, ai_summary, post_format')
    .in('id', [...new Set(ids)])
    .eq('is_incog', false)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  for (const row of data ?? []) {
    map.set(row.id as string, { id: row.id, thumbnail_url: row.thumbnail_url ?? null, caption: row.ai_summary ?? null, post_format: row.post_format ?? 'video' });
  }
  return map;
}
