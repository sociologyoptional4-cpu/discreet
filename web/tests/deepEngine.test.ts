import assert from 'node:assert/strict';
import test from 'node:test';
import { HebbianVibeGraph } from '../src/lib/deepEngine/hebbianGraph.ts';
import { MarkovActionPredictor } from '../src/lib/deepEngine/markovPredictor.ts';
import { computeMicroSignalReward } from '../src/lib/deepEngine/microSignals.ts';
import { RotatingBloomFilter } from '../src/lib/deepEngine/rotatingBloom.ts';
import { rankPoolLocally, type PoolPostItem } from '../src/lib/localBrain/localRanker.ts';

test('RotatingBloomFilter rotates at 10,000 items, maintains <1% FPR, and round-trips state', () => {
  const bloom = new RotatingBloomFilter();
  for (let i = 0; i < 10_005; i++) {
    bloom.add(`post-${i}`);
  }
  // Rotated after 10,000 items so activeCount reset to 5 while previous retains prior gen
  assert.equal(bloom.getActiveCount(), 5);
  assert.equal(bloom.has('post-0'), true);
  assert.equal(bloom.has('post-9999'), true);
  assert.equal(bloom.has('post-10004'), true);

  let falsePositives = 0;
  for (let i = 0; i < 1000; i++) {
    if (bloom.has(`unseen-item-${i}`)) falsePositives++;
  }
  assert.ok(falsePositives < 20, `Expected <2% FPR across 2 gens, got ${falsePositives}/1000`);

  const snap = bloom.exportState();
  const restored = new RotatingBloomFilter();
  restored.importState(snap);
  assert.equal(restored.has('post-10004'), true);
  assert.equal(restored.has('post-42'), true);
});

test('computeMicroSignalReward enforces AFK loop cap, fast-skip penalty, and deceleration brake bonus', () => {
  const fastSkip = computeMicroSignalReward({
    watchMs: 800,
    durationMs: 15_000,
    activeLoops: 0,
    entryVelocityPxMs: 0.4,
    exitVelocityPxMs: 1.8,
    openedComments: false,
    heldScreen: false,
    afkDetected: false,
  });
  assert.equal(fastSkip, -0.6);

  const afkReward = computeMicroSignalReward({
    watchMs: 15_000,
    durationMs: 15_000,
    activeLoops: 10,
    entryVelocityPxMs: 0.2,
    exitVelocityPxMs: 0,
    openedComments: false,
    heldScreen: false,
    afkDetected: true,
  });
  const activeReward = computeMicroSignalReward({
    watchMs: 15_000,
    durationMs: 15_000,
    activeLoops: 2,
    entryVelocityPxMs: 1.5,
    exitVelocityPxMs: 0.3,
    openedComments: true,
    heldScreen: true,
    afkDetected: false,
  });
  assert.equal(afkReward, 0.5);
  assert.ok(activeReward > afkReward + 0.3);
});

test('MarkovActionPredictor suppresses predictions below 0.55 and predicts confidently above it', () => {
  const markov = new MarkovActionPredictor();
  markov.record('SWIPE_NEXT');
  markov.record('OPEN_COMMENTS');
  // Too few observations -> Laplace smoothing keeps confidence < 0.55
  assert.equal(markov.predictNext(0.55), null);

  for (let i = 0; i < 8; i++) {
    markov.record('SWIPE_NEXT');
    markov.record('OPEN_COMMENTS');
  }
  markov.record('SWIPE_NEXT');
  const pred = markov.predictNext(0.55);
  assert.ok(pred);
  assert.equal(pred.action, 'OPEN_COMMENTS');
  assert.ok(pred.confidence >= 0.55);
});

test('HebbianVibeGraph caps at 128 nodes x 8 edges and wires back-to-back positive tags', () => {
  const hebbian = new HebbianVibeGraph();
  hebbian.observe('rain', 0.8);
  hebbian.observe('shayari', 0.9);
  assert.ok(hebbian.getAffinityBoost('rain', 'shayari') > 0.1);

  for (let i = 0; i < 160; i++) {
    hebbian.observe(`tag-${i}`, 0.7);
  }
  assert.ok(hebbian.getNodeCount() <= 128);

  for (let j = 0; j < 20; j++) {
    hebbian.observe('hub', 0.8);
    hebbian.observe(`spoke-${j}`, 0.8);
  }
  assert.ok(hebbian.getEdgeCount('hub') <= 8);

  // Wire into rankPoolLocally with RotatingBloomFilter
  const bloom = new RotatingBloomFilter();
  bloom.add('seen-via-bloom');
  const pool: PoolPostItem[] = [
    { id: 'seen-via-bloom', creatorId: 'c1', ageHours: 1, pheromoneRaw: 50, alpha: 20, beta: 1 },
    { id: 'fresh-1', creatorId: 'c2', ageHours: 1, pheromoneRaw: 5, alpha: 4, beta: 2, tag: 'shayari' },
  ];
  const ranked = rankPoolLocally(pool, null, new Set(), undefined, () => 0.5, {
    seenFilter: bloom,
    hebbianBoostOf: (tag) => hebbian.getAffinityBoost('rain', tag),
  });
  assert.deepEqual(
    ranked.map((p) => p.id),
    ['fresh-1'],
  );
});
