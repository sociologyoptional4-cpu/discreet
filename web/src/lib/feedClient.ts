import { getActiveGenomeId, setActiveGenomeId } from '@/lib/brain/brainClient';
import { ensureSession } from '@/lib/session';
import type { FeedPage } from '@/types/feed';

export async function nextFeedPage(cursor: string | null, ids: string[], topics: string[], previous: string | null, signal?: AbortSignal): Promise<FeedPage> {
  const session = await ensureSession();
  const genomeId = getActiveGenomeId();
  const response = await fetch('/api/feed', {
    method: 'POST', signal,
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      ...(genomeId ? { 'x-vybe-genome': genomeId } : {}),
    },
    body: JSON.stringify({
      cursor,
      seen_post_ids: ids,
      session_downrank_topics: topics.slice(-256),
      previous_id: previous,
      ...(genomeId ? { genome_id: genomeId } : {}),
    }),
  });
  if (!response.ok) throw new Error('Could not load the feed.');
  const data = (await response.json()) as FeedPage;
  setActiveGenomeId(data.genomeId ?? response.headers.get('x-vybe-genome'));
  return data;
}

export function counterTakeUrl(topic: string | null) {
  return topic?.trim() ? '/record?topic=' + encodeURIComponent(topic.trim().slice(0, 160)) : '/record';
}
