import { ensureSession } from '@/lib/session';
import type { FeedPage } from '@/types/feed';

export async function nextFeedPage(cursor: string | null, ids: string[], topics: string[], previous: string | null, signal?: AbortSignal): Promise<FeedPage> {
  const session = await ensureSession();
  const response = await fetch('/api/feed', {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cursor, seen_post_ids: ids, session_downrank_topics: topics.slice(-256), previous_id: previous }),
  });
  if (!response.ok) throw new Error('Could not load the feed.');
  return response.json();
}

export function counterTakeUrl(topic: string | null) {
  return topic?.trim() ? '/record?topic=' + encodeURIComponent(topic.trim().slice(0, 160)) : '/record';
}
