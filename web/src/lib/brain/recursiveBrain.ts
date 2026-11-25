import { updateTasteVector } from './tasteVector.ts';

export { updateTasteVector };

export const SURVIVOR_IMPRESSION_DECAY = 0.5;

export interface AlgoGenome {
  id: string;
  generation: number;
  wVibe: number;
  wPheromone: number;
  wExplore: number;
  decayLambda: number;
  impressions: number;
  cumulativeReward: number;
}

export interface CandidatePost {
  id: string;
  creatorId?: string | null;
  vibeSimilarity: number; // 0..1 from pgvector cosine similarity
  pheromoneRaw: number;   // weighted engagement sum
  ageHours: number;
  alpha: number;          // Thompson Sampling successes
  beta: number;           // Thompson Sampling skips
}

export interface SwipeTelemetry {
  watchRatio: number; // 0..1+ (e.g. 1.5 = watched 1.5x)
  rewatched: boolean;
  shared: boolean;
  liked: boolean;
  fastSkip: boolean;  // swiped away in < 2 seconds
}

export interface SwipeSignalDeltas {
  reward: number;
  alphaDelta: number;
  betaDelta: number;
  pheromoneDelta: number;
}

/**
 * Computes a bounded reward signal `r` in `[-0.5, 1.0]` from a single swipe.
 */
export function computeSwipeReward(t: SwipeTelemetry): number {
  if (t.fastSkip && t.watchRatio < 0.2) return -0.5;
  let reward = Math.min(1.0, Math.max(0, t.watchRatio)) * 0.55;
  if (t.rewatched) reward += 0.25;
  if (t.liked) reward += 0.1;
  if (t.shared) reward += 0.2;
  return Math.min(1.0, Math.max(-0.5, reward));
}

export function computeSignalDeltas(t: SwipeTelemetry): SwipeSignalDeltas {
  const reward = computeSwipeReward(t);
  const alphaDelta = reward > 0.15 ? Number((0.4 + reward * 0.8).toFixed(4)) : 0;
  const betaDelta = t.fastSkip ? 1.2 : reward < 0 ? 0.6 : reward < 0.2 ? 0.25 : 0;
  const pheromoneDelta = Number(
    Math.max(
      0,
      Math.min(1.5, Math.max(0, t.watchRatio)) * 0.5 +
        (t.rewatched ? 0.8 : 0) +
        (t.liked ? 0.5 : 0) +
        (t.shared ? 1.2 : 0)
    ).toFixed(4)
  );
  return { reward, alphaDelta, betaDelta, pheromoneDelta };
}

/**
 * Stigmergy pheromone with exponential time-decay mapped smoothly into `[0, 1)`.
 */
export function computeDecayedPheromone(
  pheromoneRaw: number,
  ageHours: number,
  decayLambda: number
): number {
  const safeAge = Math.max(0, ageHours);
  const score = Math.max(0, pheromoneRaw) / Math.pow(safeAge + 2, decayLambda);
  return 1 - Math.exp(-score);
}

/**
 * Marsaglia & Tsang Gamma sampler -> exact `Beta(alpha, beta)` for Thompson Sampling.
 */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, rng) * Math.pow(Math.max(1e-9, rng()), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(Math.max(1e-9, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

export function sampleBeta(
  alpha: number,
  beta: number,
  rng: () => number = Math.random
): number {
  const a = Math.max(0.5, alpha);
  const b = Math.max(0.5, beta);
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x + y === 0 ? 0.5 : x / (x + y);
}

/**
 * Scores and ranks top candidates using the assigned `AlgoGenome`,
 * applying a Creator Spacing Guard so the same creator never appears back-to-back within 3 slides.
 */
export function rankCandidates(
  candidates: readonly CandidatePost[],
  genome: AlgoGenome,
  rng: () => number = Math.random
): Array<{ id: string; score: number }> {
  const scored = candidates
    .map((post) => {
      const vibe = Math.min(1, Math.max(0, post.vibeSimilarity));
      const pheromone = computeDecayedPheromone(
        post.pheromoneRaw,
        post.ageHours,
        genome.decayLambda
      );
      const explore = sampleBeta(post.alpha, post.beta, rng);

      const score =
        genome.wVibe * vibe +
        genome.wPheromone * pheromone +
        genome.wExplore * explore;

      return { id: post.id, creatorId: post.creatorId ?? null, score };
    })
    .sort((a, b) => b.score - a.score);

  const pool = [...scored];
  const spaced: Array<{ id: string; score: number }> = [];
  const recentCreators: string[] = [];

  while (pool.length > 0) {
    let pickIdx = pool.findIndex(
      (item) => !item.creatorId || !recentCreators.includes(item.creatorId)
    );
    if (pickIdx < 0) pickIdx = 0;
    const [chosen] = pool.splice(pickIdx, 1);
    spaced.push({ id: chosen.id, score: chosen.score });
    if (chosen.creatorId) {
      recentCreators.push(chosen.creatorId);
      if (recentCreators.length > 3) recentCreators.shift();
    }
  }

  return spaced;
}

/**
 * Deterministically assigns a sticky genome for a viewer session key so fitness is measured cleanly.
 */
export function pickStickyGenome(genomes: readonly AlgoGenome[], sessionKey: string): AlgoGenome {
  let h = 2166136261;
  for (let i = 0; i < sessionKey.length; i++) {
    h ^= sessionKey.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return genomes[h % genomes.length];
}

/**
 * Trimurti Meta-Evolution:
 * Keeps top 50% genomes (Sthiti), drops bottom 50% (Laya), applies 0.5x decay to survivors'
 * accumulated stats so new trends still compete (Fix #5), and spawns mutated children (Srishti).
 */
export function evolveGenomes(
  genomes: readonly AlgoGenome[],
  rng: () => number = Math.random
): { survivors: AlgoGenome[]; children: Omit<AlgoGenome, 'id'>[]; retiredIds: string[] } {
  if (genomes.length < 2) {
    return { survivors: [...genomes], children: [], retiredIds: [] };
  }

  const scored = [...genomes].sort((a, b) => {
    const fitA = a.impressions > 0 ? a.cumulativeReward / a.impressions : 0;
    const fitB = b.impressions > 0 ? b.cumulativeReward / b.impressions : 0;
    return fitB - fitA;
  });

  const split = Math.max(1, Math.floor(scored.length / 2));
  const survivors = scored.slice(0, split).map((parent) => ({
    ...parent,
    impressions: Math.floor(parent.impressions * SURVIVOR_IMPRESSION_DECAY),
    cumulativeReward: Number((parent.cumulativeReward * SURVIVOR_IMPRESSION_DECAY).toFixed(4)),
  }));
  const retiredIds = scored.slice(split).map((g) => g.id);

  const jitter = (val: number, scale: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val + (rng() * 2 - 1) * scale));

  const children: Omit<AlgoGenome, 'id'>[] = survivors.map((parent) => {
    const rawVibe = jitter(parent.wVibe, 0.08, 0.1, 0.8);
    const rawPhero = jitter(parent.wPheromone, 0.08, 0.1, 0.8);
    const rawExp = jitter(parent.wExplore, 0.08, 0.05, 0.6);
    const sum = rawVibe + rawPhero + rawExp;

    const wVibe = Number((rawVibe / sum).toFixed(4));
    const wPheromone = Number((rawPhero / sum).toFixed(4));
    const wExplore = Number((1 - wVibe - wPheromone).toFixed(4));

    return {
      generation: parent.generation + 1,
      wVibe,
      wPheromone,
      wExplore,
      decayLambda: Number(jitter(parent.decayLambda, 0.12, 0.8, 2.2).toFixed(3)),
      impressions: 0,
      cumulativeReward: 0,
    };
  });

  return { survivors, children, retiredIds };
}
