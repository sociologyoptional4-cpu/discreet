import type { DiversityContext } from '@/types/feed';
import type { PublicPost } from '@/types/social';

const normalize = (topic: string | null) => topic?.trim().toLowerCase() || null;

function compatible(post: PublicPost, last: DiversityContext) {
  const topic = normalize(post.topic_entity);
  return (!post.user_id || post.user_id !== last.user_id) && (!topic || topic !== normalize(last.topic_entity));
}

/** The RPC supplies relevance order. Prefer variety amongst the first few eligible candidates. */
export function diversifyFeed(candidates: PublicPost[], limit: number, previous: DiversityContext | null): PublicPost[] {
  const pool = [...new Map(candidates.map((post) => [post.id, post])).values()];
  const result: PublicPost[] = [];
  let last = previous;
  while (pool.length && result.length < limit) {
    let best = -1;
    let topScore = -Infinity;
    let eligible = 0;
    for (let i = 0; i < pool.length && eligible < 5; i++) {
      const post = pool[i];
      if (last && !compatible(post, last)) continue;
      const score = Number(last?.mode !== post.mode) + Number(Boolean(post.emotion_tag && last?.emotion_tag !== post.emotion_tag)) - eligible * 0.55;
      eligible++;
      if (score > topScore) { best = i; topScore = score; }
    }
    // In a homogeneous pool a strict ban would hide the rest of the catalog.
    // Prefer a different creator, then a different topic, then the highest ranked remaining post.
    if (best < 0 && last) {
      const prior = last;
      best = pool.findIndex(row => row.user_id !== prior.user_id);
      if (best < 0) best = pool.findIndex(row => normalize(row.topic_entity) !== normalize(prior.topic_entity));
    }
    if (best < 0) best = 0;
    const [selected] = pool.splice(best, 1);
    result.push(selected);
    last = selected;
  }
  return result;
}
