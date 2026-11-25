import { pickStickyGenome, rankCandidates, type CandidatePost } from '@/lib/brain/recursiveBrain';
import { diversifyFeed } from '@/lib/feedRanker';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { getActiveGenomes } from '@/lib/server/brainGenomes';
import { authenticate, isUuid } from '@/lib/server/request';
import type { PublicPost } from '@/types/social';

interface BrainCandidateRow {
  post: PublicPost;
  vibe_similarity: number;
  pheromone_raw: number;
  age_hours: number;
  alpha_score: number;
  beta_score: number;
}

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

  const genomes = await getActiveGenomes();
  const requestedGenomeId = isUuid(body.genome_id)
    ? body.genome_id
    : isUuid(request.headers.get('x-vybe-genome'))
      ? request.headers.get('x-vybe-genome')!
      : null;
  const genome =
    (requestedGenomeId ? genomes.find((g) => g.id === requestedGenomeId) : undefined) ??
    pickStickyGenome(genomes, `${auth.userId}:${new Date().toISOString().slice(0, 10)}`);

  const [brainCandidates, previous] = await Promise.all([
    getSupabaseAdmin().rpc('get_brain_feed_candidates', {
      p_user_id: auth.userId,
      p_seen_ids: body.seen_post_ids,
      p_downrank_topics: body.session_downrank_topics.map((t: string) => t.toLowerCase()),
      p_limit: Math.min(60, Math.max(50, limit * 3)),
    }),
    body.previous_id
      ? auth.client.from('public_posts').select('user_id,topic_entity,mode,emotion_tag').eq('id', body.previous_id).maybeSingle()
      : null,
  ]);

  if (previous?.error) return Response.json({ error: 'Could not load feed.' }, { status: 503 });

  let rankedPosts: PublicPost[] | null = null;
  const candidateRows = !brainCandidates.error && Array.isArray(brainCandidates.data)
    ? (brainCandidates.data as BrainCandidateRow[])
    : null;

  if (candidateRows && candidateRows.length > 0) {
    const postById = new Map<string, PublicPost>();
    const candidates: CandidatePost[] = [];
    for (const row of candidateRows) {
      if (!row?.post?.id) continue;
      postById.set(row.post.id, row.post);
      candidates.push({
        id: row.post.id,
        vibeSimilarity: Number(row.vibe_similarity ?? 0.5),
        pheromoneRaw: Number(row.pheromone_raw ?? 1),
        ageHours: Number(row.age_hours ?? 0),
        alpha: Number(row.alpha_score ?? 2),
        beta: Number(row.beta_score ?? 2),
      });
    }
    const order = rankCandidates(candidates, genome);
    rankedPosts = order
      .map((entry) => postById.get(entry.id))
      .filter((p): p is PublicPost => Boolean(p));
  } else {
    const fallback = await auth.client.rpc('get_ranked_feed', {
      p_user_id: auth.userId,
      p_cursor: cursor,
      p_limit: Math.min(100, limit * 4),
      p_seen_ids: body.seen_post_ids,
      p_downrank_topics: body.session_downrank_topics,
    });
    if (fallback.error) return Response.json({ error: 'Could not load feed.' }, { status: 503 });
    rankedPosts = fallback.data as PublicPost[];
  }

  const posts = diversifyFeed(rankedPosts, limit, previous?.data ?? null);
  return Response.json(
    { posts, cursor, hasMore: posts.length > 0, genomeId: genome.id },
    { headers: { 'Cache-Control': 'private, no-store', 'x-vybe-genome': genome.id } },
  );
}
