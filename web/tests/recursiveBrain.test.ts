import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeDecayedPheromone,
  computeSignalDeltas,
  computeSwipeReward,
  evolveGenomes,
  pickStickyGenome,
  rankCandidates,
  sampleBeta,
  SURVIVOR_IMPRESSION_DECAY,
  type AlgoGenome,
} from '../src/lib/brain/recursiveBrain.ts';
import {
  computeSemanticHashVector384,
  cosineSimilarity,
  formatPgVector,
  parsePgVector,
  updateTasteVector,
  VIBE_VECTOR_DIM,
} from '../src/lib/brain/tasteVector.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('computeSwipeReward bounds output to [-0.5, 1.0]', () => {
  const skip = computeSwipeReward({
    watchRatio: 0.05,
    rewatched: false,
    shared: false,
    liked: false,
    fastSkip: true,
  });
  assert.equal(skip, -0.5);

  const maxEngage = computeSwipeReward({
    watchRatio: 2.5,
    rewatched: true,
    shared: true,
    liked: true,
    fastSkip: false,
  });
  assert.equal(maxEngage, 1.0);

  const deltas = computeSignalDeltas({
    watchRatio: 0.05,
    rewatched: false,
    shared: false,
    liked: false,
    fastSkip: true,
  });
  assert.equal(deltas.alphaDelta, 0);
  assert.ok(deltas.betaDelta > 1.0);
});

test('computeDecayedPheromone decays monotonically with ageHours and stays in [0, 1)', () => {
  const fresh = computeDecayedPheromone(12, 0.1, 1.35);
  const older = computeDecayedPheromone(12, 12, 1.35);
  const ancient = computeDecayedPheromone(12, 120, 1.35);
  assert.ok(fresh > older && older > ancient);
  assert.ok(fresh < 1 && ancient > 0);
});

test('sampleBeta draws higher means for larger alpha than beta', () => {
  const rng = mulberry32(42);
  let sumHigh = 0;
  let sumLow = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    sumHigh += sampleBeta(20, 2, rng);
    sumLow += sampleBeta(2, 20, rng);
  }
  assert.ok(sumHigh / N > 0.8);
  assert.ok(sumLow / N < 0.2);
});

test('updateTasteVector enforces L2 normalization and cold-start repulsion on fast skip (Fix #3)', () => {
  const postVec = computeSemanticHashVector384('gaming fortnite montage');
  const normPost = Math.sqrt(postVec.reduce((acc, v) => acc + v * v, 0));
  assert.ok(Math.abs(normPost - 1) < 1e-4);

  // Zero-reward first interaction leaves taste null
  assert.equal(updateTasteVector(null, postVec, 0), null);

  // Cold-start fast-skip (-0.5) initializes taste opposite the skipped post vector
  const repelled = updateTasteVector(null, postVec, -0.5);
  assert.ok(repelled);
  assert.ok(cosineSimilarity(repelled, postVec) < -0.99);

  // Positive signal pulls taste toward another topic
  const rainVec = computeSemanticHashVector384('barish shayari night rain');
  const updated = updateTasteVector(repelled, rainVec, 1.0, 0.5);
  assert.ok(updated);
  assert.ok(cosineSimilarity(updated, rainVec) > cosineSimilarity(repelled, rainVec));
});

test('semantic hash 384 vector round-trips pgvector formatting and clusters related topics', () => {
  const a = computeSemanticHashVector384('barish shayari monsoon rain');
  const b = computeSemanticHashVector384('barish night shayari rain');
  const c = computeSemanticHashVector384('gpu overclock benchmark rtx');

  assert.equal(a.length, VIBE_VECTOR_DIM);
  assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c));

  const parsed = parsePgVector(formatPgVector(a));
  assert.ok(parsed);
  assert.ok(cosineSimilarity(a, parsed) > 0.9999);
});

test('evolveGenomes keeps top performers, applies 0.5x survivor decay (Fix #5), and normalizes children to 1.0', () => {
  const genomes: AlgoGenome[] = [
    { id: 'g1', generation: 1, wVibe: 0.5, wPheromone: 0.3, wExplore: 0.2, decayLambda: 1.3, impressions: 400, cumulativeReward: 280 },
    { id: 'g2', generation: 1, wVibe: 0.4, wPheromone: 0.4, wExplore: 0.2, decayLambda: 1.35, impressions: 400, cumulativeReward: 200 },
    { id: 'g3', generation: 1, wVibe: 0.3, wPheromone: 0.5, wExplore: 0.2, decayLambda: 1.45, impressions: 400, cumulativeReward: 80 },
    { id: 'g4', generation: 1, wVibe: 0.2, wPheromone: 0.2, wExplore: 0.6, decayLambda: 1.2, impressions: 400, cumulativeReward: -40 },
  ];

  const { survivors, children, retiredIds } = evolveGenomes(genomes, mulberry32(7));
  assert.deepEqual(
    survivors.map((s) => s.id),
    ['g1', 'g2'],
  );
  assert.deepEqual(retiredIds, ['g3', 'g4']);
  assert.equal(survivors[0].impressions, Math.floor(400 * SURVIVOR_IMPRESSION_DECAY));
  assert.equal(survivors[0].cumulativeReward, 280 * SURVIVOR_IMPRESSION_DECAY);

  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.generation, 2);
    assert.equal(child.impressions, 0);
    assert.equal(child.cumulativeReward, 0);
    const sum = child.wVibe + child.wPheromone + child.wExplore;
    assert.ok(Math.abs(sum - 1) < 1e-3, `Expected sum 1.0, got ${sum}`);
  }

  const ranked = rankCandidates(
    [
      { id: 'low', vibeSimilarity: 0.1, pheromoneRaw: 0.2, ageHours: 24, alpha: 1, beta: 10 },
      { id: 'high', vibeSimilarity: 0.95, pheromoneRaw: 25, ageHours: 0.5, alpha: 25, beta: 2 },
    ],
    genomes[0],
    mulberry32(99),
  );
  assert.equal(ranked[0].id, 'high');
  assert.equal(pickStickyGenome(genomes, 'user-1:2026-11-25').id, pickStickyGenome(genomes, 'user-1:2026-11-25').id);
});
