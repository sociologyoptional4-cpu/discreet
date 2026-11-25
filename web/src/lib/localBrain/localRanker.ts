import { cosineSimInt8 } from './quantizedVector.ts';

export interface PoolPostItem {
  id: string;
  creatorId: string;
  ageHours: number;
  pheromoneRaw: number;
  alpha: number;
  beta: number;
  vibeInt8?: number[]; // 64-element Int8 array from edge JSON
  tag?: string | null;
}

export interface RankPoolOptions {
  seenFilter?: { has: (id: string) => boolean };
  hebbianBoostOf?: (tag: string) => number;
}

export interface LocalGenomeWeights {
  wVibe: number;
  wPheromone: number;
  wExplore: number;
  decayLambda: number;
}

export const DEFAULT_LOCAL_WEIGHTS: LocalGenomeWeights = {
  wVibe: 0.45,
  wPheromone: 0.35,
  wExplore: 0.20,
  decayLambda: 1.35,
};

/**
 * Ranks the edge-cached pool 100% locally on the user's phone:
 * 1. Excludes already-seen posts
 * 2. Scores via Vibe Similarity + Decayed Pheromone + Lightweight Exploration
 * 3. Enforces Creator Spacing (no back-to-back posts from the same creator within 3 slides)
 */
export function rankPoolLocally<T extends PoolPostItem>(
  pool: readonly T[],
  userTaste: Float32Array | null,
  seenIds: ReadonlySet<string>,
  weights: LocalGenomeWeights = DEFAULT_LOCAL_WEIGHTS,
  rng: () => number = Math.random,
  options?: RankPoolOptions
): T[] {
  const unseen = pool.filter((p) => !seenIds.has(p.id) && !options?.seenFilter?.has(p.id));
  const candidates = unseen.length > 0 ? unseen : [...pool];

  const scored = candidates
    .map((post) => {
      const vibe =
        userTaste && post.vibeInt8 && post.vibeInt8.length > 0
          ? cosineSimInt8(userTaste, Int8Array.from(post.vibeInt8))
          : 0.5;

      const decayed =
        Math.max(0, post.pheromoneRaw) /
        Math.pow(Math.max(0, post.ageHours) + 2, weights.decayLambda);
      const pheromone = 1 - Math.exp(-decayed);

      // Fast local exploration jitter weighted by uncertainty
      const mean = post.alpha / Math.max(1, post.alpha + post.beta);
      const uncertainty = 1 / Math.sqrt(Math.max(1, post.alpha + post.beta));
      const explore = Math.min(1, Math.max(0, mean + (rng() - 0.5) * uncertainty));
      const hebbianBoost = post.tag && options?.hebbianBoostOf ? options.hebbianBoostOf(post.tag) * 0.12 : 0;

      const score =
        weights.wVibe * vibe +
        weights.wPheromone * pheromone +
        weights.wExplore * explore +
        hebbianBoost;

      return { post, score };
    })
    .sort((a, b) => b.score - a.score);

  // Creator Spacing Guard: prevent same non-empty creator within last 3 slides
  const ordered: T[] = [];
  const deferred: T[] = [];
  const recentCreators: string[] = [];

  for (const { post } of scored) {
    if (post.creatorId && recentCreators.includes(post.creatorId)) {
      deferred.push(post);
      continue;
    }
    ordered.push(post);
    if (post.creatorId) {
      recentCreators.push(post.creatorId);
      if (recentCreators.length > 3) recentCreators.shift();
    }
  }

  return ordered.concat(deferred);
}
