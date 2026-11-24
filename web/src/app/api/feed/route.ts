import { diversifyFeed } from '@/lib/feedRanker';
import { authenticate, isUuid } from '@/lib/server/request';
import type { PublicPost } from '@/types/social';

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.seen_post_ids) || body.seen_post_ids.length > 24000 || !body.seen_post_ids.every(isUuid)
    || !Array.isArray(body.session_downrank_topics) || body.session_downrank_topics.length > 256
    || !body.session_downrank_topics.every((v: unknown) => typeof v === 'string' && v.length <= 160)) {
    return Response.json({ error: 'Invalid feed session.' }, { status: 400 });
  }
  const cursor = body.cursor ?? new Date().toISOString();
  const limit = body.limit ?? 16;
  if (typeof cursor !== 'string' || !Number.isFinite(Date.parse(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 40
    || (body.previous_id != null && !isUuid(body.previous_id))) {
    return Response.json({ error: 'Invalid cursor or page size.' }, { status: 400 });
  }
  const [ranked, previous] = await Promise.all([
    auth.client.rpc('get_ranked_feed', {
      p_user_id: auth.userId, p_cursor: cursor, p_limit: Math.min(100, limit * 4),
      p_seen_ids: body.seen_post_ids, p_downrank_topics: body.session_downrank_topics,
    }),
    body.previous_id ? auth.client.from('public_posts').select('user_id,topic_entity,mode,emotion_tag').eq('id', body.previous_id).maybeSingle() : null,
  ]);
  if (ranked.error || previous?.error) return Response.json({ error: 'Could not load feed.' }, { status: 503 });
  const posts = diversifyFeed(ranked.data as PublicPost[], limit, previous?.data ?? null);
  return Response.json({ posts, cursor, hasMore: posts.length > 0 }, { headers: { 'Cache-Control': 'private, no-store' } });
}
