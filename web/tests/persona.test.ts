import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonaStyle } from '../src/types/persona.ts';

const good = { handSpeedMultiplier: 1.2, expressionGain: 1.1, restingHeadTilt: [0.05, -0.1, 0], dominantHand: 'right', calibratedAt: '2026-11-24T10:00:00.000Z' };

test('accepts a valid persona style', () => {
  assert.deepEqual(parsePersonaStyle(good)?.restingHeadTilt, [0.05, -0.1, 0]);
});

test('rejects out-of-range, wrong-type and malformed styles', () => {
  assert.equal(parsePersonaStyle({ ...good, handSpeedMultiplier: 3 }), null);
  assert.equal(parsePersonaStyle({ ...good, expressionGain: 0.5 }), null);
  assert.equal(parsePersonaStyle({ ...good, restingHeadTilt: [0, 0] }), null);
  assert.equal(parsePersonaStyle({ ...good, restingHeadTilt: [0, 2, 0] }), null);
  assert.equal(parsePersonaStyle({ ...good, dominantHand: 'feet' }), null);
  assert.equal(parsePersonaStyle({ ...good, calibratedAt: 5 }), null);
  assert.equal(parsePersonaStyle(null), null);
});
