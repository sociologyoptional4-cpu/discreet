import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hapticTick } from '../src/lib/haptics.ts';

test('rapid flicks tick once per 90 ms window', () => {
  assert.equal(hapticTick(10_000), true);
  assert.equal(hapticTick(10_040), false);
  assert.equal(hapticTick(10_095), true);
});
