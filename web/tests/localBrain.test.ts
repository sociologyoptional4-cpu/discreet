import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cosineSimInt8,
  LOCAL_VECTOR_DIM,
  quantizeToInt8,
  updateLocalTaste,
} from '../src/lib/localBrain/quantizedVector.ts';
import { rankPoolLocally, type PoolPostItem } from '../src/lib/localBrain/localRanker.ts';

function makeNormalized64(hotIdx: number): Float32Array {
  const v = new Float32Array(LOCAL_VECTOR_DIM);
  v[hotIdx % LOCAL_VECTOR_DIM] = 0.9;
  v[(hotIdx + 1) % LOCAL_VECTOR_DIM] = 0.43589;
  return v;
}

test('quantizeToInt8 shrinks Float32 to 64-byte Int8 and preserves cosine similarity', () => {
  const vA = makeNormalized64(3);
  const vB = makeNormalized64(3);
  const vC = makeNormalized64(25);

  const qA = quantizeToInt8(vA);
  const qB = quantizeToInt8(vB);
  const qC = quantizeToInt8(vC);

  assert.equal(qA.length, LOCAL_VECTOR_DIM);
  assert.equal(qA.BYTES_PER_ELEMENT, 1);

  const simSame = cosineSimInt8(vA, qB);
  const simDiff = cosineSimInt8(vA, qC);
  assert.ok(simSame > 0.99, `Expected >0.99, got ${simSame}`);
  assert.ok(simDiff < 0.6, `Expected <0.6, got ${simDiff}`);
});

test('updateLocalTaste ignores cold-start negative skips and updates on positive reward', () => {
  const postVec = quantizeToInt8(makeNormalized64(7));
  assert.equal(updateLocalTaste(null, postVec, -0.5), null);
  assert.equal(updateLocalTaste(null, postVec, 0), null);

  const taste = updateLocalTaste(null, postVec, 0.8);
  assert.ok(taste);
  assert.equal(taste.length, LOCAL_VECTOR_DIM);
  assert.ok(cosineSimInt8(taste, postVec) > 0.99);

  const otherVec = quantizeToInt8(makeNormalized64(21));
  const pulled = updateLocalTaste(taste, otherVec, 0.9, 0.25);
  assert.ok(pulled);
  assert.ok(cosineSimInt8(pulled, otherVec) > cosineSimInt8(taste, otherVec));
});

test('rankPoolLocally filters seenIds and enforces 3-slide Creator Spacing Guard', () => {
  const taste = makeNormalized64(0);
  const qMatch = Array.from(quantizeToInt8(makeNormalized64(0)));
  const qOther = Array.from(quantizeToInt8(makeNormalized64(18)));

  const pool: PoolPostItem[] = [
    { id: 'seen-1', creatorId: 'c1', ageHours: 0.1, pheromoneRaw: 100, alpha: 50, beta: 1, vibeInt8: qMatch },
    { id: 'c1-a', creatorId: 'c1', ageHours: 1, pheromoneRaw: 20, alpha: 10, beta: 2, vibeInt8: qMatch },
    { id: 'c1-b', creatorId: 'c1', ageHours: 1, pheromoneRaw: 19, alpha: 10, beta: 2, vibeInt8: qMatch },
    { id: 'c1-c', creatorId: 'c1', ageHours: 1, pheromoneRaw: 18, alpha: 10, beta: 2, vibeInt8: qMatch },
    { id: 'c2-a', creatorId: 'c2', ageHours: 2, pheromoneRaw: 5, alpha: 4, beta: 2, vibeInt8: qOther },
    { id: 'c3-a', creatorId: 'c3', ageHours: 2, pheromoneRaw: 4, alpha: 4, beta: 2, vibeInt8: qOther },
    { id: 'c4-a', creatorId: 'c4', ageHours: 2, pheromoneRaw: 3, alpha: 4, beta: 2, vibeInt8: qOther },
  ];

  const ranked = rankPoolLocally(pool, taste, new Set(['seen-1']), undefined, () => 0.5);
  assert.equal(ranked.some((p) => p.id === 'seen-1'), false);
  assert.deepEqual(
    ranked.slice(0, 4).map((p) => p.creatorId),
    ['c1', 'c2', 'c3', 'c4'],
  );
  // Deferred c1-b and c1-c still appear after spacing
  assert.equal(ranked.length, 6);
});
