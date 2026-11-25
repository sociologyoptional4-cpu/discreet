import { NextResponse } from 'next/server';
import { parsePgVector } from '@/lib/brain/tasteVector';
import { DEFAULT_LOCAL_WEIGHTS, type LocalGenomeWeights } from '@/lib/localBrain/localRanker';
import { quantizeToInt8 } from '@/lib/localBrain/quantizedVector';
import { getSupabaseAdmin } from '@/lib/server/admin';
import type { PublicPost } from '@/types/social';

const POOL_LIMIT = 150;

export async function GET() {
  try {
    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data: publicRows, error: pubErr } = await admin
      .from('public_posts')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(POOL_LIMIT);

    if (pubErr || !publicRows) {
      return NextResponse.json(
        { pool: [], generatedAt: Date.now() },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const posts = publicRows as PublicPost[];
    const ids = posts.map((p) => p.id);

    const [{ data: brainRows }, { data: metricRows }, { data: genomeRows }] = await Promise.all([
      ids.length > 0
        ? admin
            .from('posts')
            .select('id, vibe_embedding, alpha_score, beta_score, pheromone_score')
            .in('id', ids)
        : Promise.resolve({ data: [] }),
      ids.length > 0
        ? admin.from('post_metrics').select('post_id, shares, rewatches').in('post_id', ids)
        : Promise.resolve({ data: [] }),
      admin
        .from('algo_genomes')
        .select('w_vibe, w_pheromone, w_explore, decay_lambda')
        .eq('is_active', true)
        .order('cumulative_reward', { ascending: false })
        .limit(1),
    ]);

    const topGenome = (genomeRows as Array<{
      w_vibe: number | null;
      w_pheromone: number | null;
      w_explore: number | null;
      decay_lambda: number | null;
    }> | null)?.[0];

    const weights: LocalGenomeWeights = topGenome
      ? {
          wVibe: Number(topGenome.w_vibe ?? DEFAULT_LOCAL_WEIGHTS.wVibe),
          wPheromone: Number(topGenome.w_pheromone ?? DEFAULT_LOCAL_WEIGHTS.wPheromone),
          wExplore: Number(topGenome.w_explore ?? DEFAULT_LOCAL_WEIGHTS.wExplore),
          decayLambda: Number(topGenome.decay_lambda ?? DEFAULT_LOCAL_WEIGHTS.decayLambda),
        }
      : { ...DEFAULT_LOCAL_WEIGHTS };

    const brainMap = new Map<
      string,
      { vibeInt8?: number[]; alpha: number; beta: number; pheromone: number }
    >();
    for (const r of (brainRows ?? []) as Array<{
      id: string;
      vibe_embedding: unknown;
      alpha_score: number | null;
      beta_score: number | null;
      pheromone_score: number | null;
    }>) {
      const parsed = parsePgVector(r.vibe_embedding);
      brainMap.set(r.id, {
        vibeInt8: parsed ? Array.from(quantizeToInt8(parsed)) : undefined,
        alpha: Number(r.alpha_score ?? 2),
        beta: Number(r.beta_score ?? 2),
        pheromone: Number(r.pheromone_score ?? 1),
      });
    }

    const metricMap = new Map<string, { shares: number; rewatches: number }>();
    for (const m of (metricRows ?? []) as Array<{
      post_id: string;
      shares: number | null;
      rewatches: number | null;
    }>) {
      metricMap.set(m.post_id, {
        shares: Number(m.shares ?? 0),
        rewatches: Number(m.rewatches ?? 0),
      });
    }

    const nowMs = Date.now();
    const pool = posts.map((post) => {
      const brain = brainMap.get(post.id);
      const metrics = metricMap.get(post.id);
      const createdMs = Date.parse(post.created_at);
      const ageHours = Number.isFinite(createdMs) ? Math.max(0, (nowMs - createdMs) / 3_600_000) : 0;
      const pheromoneRaw =
        (brain?.pheromone ?? 1) +
        0.35 * (post.likes_count ?? 0) +
        0.6 * (metrics?.shares ?? 0) +
        0.4 * (metrics?.rewatches ?? 0);

      return {
        id: post.id,
        creatorId: post.user_id ?? '',
        ageHours: Number(ageHours.toFixed(2)),
        pheromoneRaw: Number(pheromoneRaw.toFixed(3)),
        alpha: brain?.alpha ?? 2,
        beta: brain?.beta ?? 2,
        vibeInt8: brain?.vibeInt8,
        post,
      };
    });

    return NextResponse.json(
      { pool, weights, generatedAt: Date.now() },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { pool: [], generatedAt: Date.now() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
