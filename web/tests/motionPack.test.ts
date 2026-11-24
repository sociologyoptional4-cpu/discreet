import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameIndexAt, gzipSizeBytes, measureMotionKB } from '../src/lib/motionPack.ts';
import type { MotionFrame } from '../src/types/avatar.ts';

test('frameIndexAt follows the spec formula and never leaves the array', () => {
  assert.equal(frameIndexAt(0, 30, 100), 0);
  assert.equal(frameIndexAt(1, 30, 100), 30);
  assert.equal(frameIndexAt(1.049, 30, 100), 31);
  assert.equal(frameIndexAt(3.3, 30, 100), 99); // past the end clamps to the last frame
  assert.equal(frameIndexAt(-0.5, 30, 100), 0); // a negative clock clamps to the first
  assert.equal(frameIndexAt(5, 30, 0), 0); // empty track
});

test('gzip size is smaller than the JSON it compresses', async () => {
  const frames: MotionFrame[] = Array.from({ length: 600 }, (_, i) => ({
    t: i / 30,
    head: [0.1, -0.2, 0.01],
    shapes: { jawOpen: 0.3 + (i % 5) / 100, mouthSmileLeft: 0.2, eyeBlinkLeft: 0.05 },
  }));
  const raw = new TextEncoder().encode(JSON.stringify(frames)).length;
  const gz = await gzipSizeBytes(JSON.stringify(frames));
  assert.ok(gz > 0 && gz < raw / 3, `gzip ${gz} vs raw ${raw}`);
  const kb = await measureMotionKB(frames);
  assert.ok(Math.abs(kb - gz / 1024) < 0.06);
});
