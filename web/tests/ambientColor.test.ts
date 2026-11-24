import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_RGB, accentFromPixels } from '../src/hooks/useVideoAmbientColor.ts';

const frame = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray(Array.from({ length: 64 }, () => [r, g, b, a]).flat());

test('a green frame gives a green-dominant accent', () => {
  const [r, g, b] = accentFromPixels(frame(40, 120, 50)).split(' ').map(Number);
  assert.ok(g > r && g > b);
});

test('a fully transparent frame falls back to the pastel tint', () => {
  assert.equal(accentFromPixels(frame(0, 0, 0, 0)), FALLBACK_RGB);
});
