import { timingSafeEqual } from 'node:crypto';
import { evolveGenomes, type AlgoGenome } from '@/lib/brain/recursiveBrain';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { invalidateGenomeCache } from '@/lib/server/brainGenomes';
import { json } from '@/lib/server/request';

export const maxDuration = 60;

const MIN_IMPRESSIONS_FOR_EVOLUTION = 200;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) return false;
  const header = request.headers.get('authorization');
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleEvolution(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const force = new URL(request.url).searchParams.get('force') === '1';
  const admin = getSupabaseAdmin();

  const { data: rows, error } = await admin
    .from('algo_genomes')
    .select('id, generation, w_vibe, w_pheromone, w_explore, decay_lambda, impressions, cumulative_reward')
    .eq('is_active', true);

  if (error || !rows || rows.length < 2) {
    return json({ evolved: false, reason: 'Not enough active genomes to evolve.' }, error ? 503 : 200);
  }

  const mapped: AlgoGenome[] = rows.map((row) => ({
    id: String(row.id),
    generation: Number(row.generation ?? 1),
    wVibe: Number(row.w_vibe),
    wPheromone: Number(row.w_pheromone),
    wExplore: Number(row.w_explore),
    decayLambda: Number(row.decay_lambda),
    impressions: Number(row.impressions ?? 0),
    cumulativeReward: Number(row.cumulative_reward ?? 0),
  }));

  if (!force && mapped.some((g) => g.impressions < MIN_IMPRESSIONS_FOR_EVOLUTION)) {
    return json({
      evolved: false,
      reason: `Waiting for >= ${MIN_IMPRESSIONS_FOR_EVOLUTION} impressions per active genome.`,
      genomes: mapped.length,
    });
  }

  const result = evolveGenomes(mapped);

  if (result.retiredIds.length > 0) {
    await admin.from('algo_genomes').update({ is_active: false }).in('id', result.retiredIds);
  }

  for (const survivor of result.survivors) {
    await admin
      .from('algo_genomes')
      .update({
        impressions: survivor.impressions,
        cumulative_reward: survivor.cumulativeReward,
      })
      .eq('id', survivor.id);
  }

  if (result.children.length > 0) {
    await admin.from('algo_genomes').insert(
      result.children.map((child) => ({
        generation: child.generation,
        w_vibe: child.wVibe,
        w_pheromone: child.wPheromone,
        w_explore: child.wExplore,
        decay_lambda: child.decayLambda,
        impressions: child.impressions,
        cumulative_reward: child.cumulativeReward,
        is_active: true,
      })),
    );
  }

  invalidateGenomeCache();

  return json({
    evolved: true,
    survivors: result.survivors.length,
    children: result.children.length,
    retiredIds: result.retiredIds,
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleEvolution(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleEvolution(request);
}
