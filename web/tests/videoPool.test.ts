import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSilentWav } from '../src/lib/media/videoPool.ts';

test('the silent placeholder is a valid, silent 16-bit mono WAV', () => {
  const wav = buildSilentWav(0.2, 8000);
  const view = new DataView(wav.buffer);
  const text = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.equal(view.getUint32(40, true), wav.length - 44);
  assert.ok(wav.slice(44).every((byte) => byte === 0));
});

test('the placeholder is small enough to embed as a data URI', () => {
  assert.ok(buildSilentWav().length < 4000);
});
