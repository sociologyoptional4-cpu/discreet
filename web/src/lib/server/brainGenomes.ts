import 'server-only';
import type { AlgoGenome } from '@/lib/brain/recursiveBrain';
import { getSupabaseAdmin } from '@/lib/server/admin';

const CACHE_TTL_MS = 30_000;

const FALLBACK_GENOME: AlgoGenome = {
  id: '00000000-0000-4000-8000-000000000000',
  generation: 1,
  wVibe: 0.4,
  wPheromone: 0.4,
  wExplore: 0.2,
  decayLambda: 1.35,
  impressions: 0,
  cumulativeReward: 0,
};

let cachedGenomes: AlgoGenome[] | null = null;
let cachedAt = 0;

export function invalidateGenomeCache(): void {
  cachedGenomes = null;
  cachedAt = 0;
}

export async function getActiveGenomes(): Promise<AlgoGenome[]> {
  if (cachedGenomes && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedGenomes;
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('algo_genomes')
      .select('id, generation, w_vibe, w_pheromone, w_explore, decay_lambda, impressions, cumulative_reward')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      cachedGenomes = data.map((row) => ({
        id: String(row.id),
        generation: Number(row.generation ?? 1),
        wVibe: Number(row.w_vibe ?? 0.4),
        wPheromone: Number(row.w_pheromone ?? 0.4),
        wExplore: Number(row.w_explore ?? 0.2),
        decayLambda: Number(row.decay_lambda ?? 1.35),
        impressions: Number(row.impressions ?? 0),
        cumulativeReward: Number(row.cumulative_reward ?? 0),
      }));
      cachedAt = Date.now();
      return cachedGenomes;
    }
  } catch {
    // Fall back to default balanced genome
  }

  return [FALLBACK_GENOME];
}
