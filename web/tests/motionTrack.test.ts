import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMotionTrack } from '../src/lib/motionTrack.ts';

const frame = { t: 0, head: [0, 0.1, 0], shapes: { jawOpen: 0.4 }, leftHand: [0.2, 0.3, -0.1] };

test('accepts a well-formed track', () => {
  const track = parseMotionTrack({ fps: 30, avatarId: 'neon_bot', frames: [frame, { ...frame, t: 0.033 }] });
  assert.equal(track?.frames.length, 2);
  assert.deepEqual(track?.frames[0].leftHand, [0.2, 0.3, -0.1]);
});

test('rejects unknown avatars, bad fps and empty or malformed frames', () => {
  assert.equal(parseMotionTrack({ fps: 30, avatarId: 'hacker', frames: [frame] }), null);
  assert.equal(parseMotionTrack({ fps: 0, avatarId: 'neon_bot', frames: [frame] }), null);
  assert.equal(parseMotionTrack({ fps: 30, avatarId: 'neon_bot', frames: [] }), null);
  assert.equal(parseMotionTrack({ fps: 30, avatarId: 'neon_bot', frames: [{ ...frame, head: [0, 0] }] }), null);
  assert.equal(parseMotionTrack({ fps: 30, avatarId: 'neon_bot', frames: [{ ...frame, shapes: { jawOpen: 'wide' } }] }), null);
  assert.equal(parseMotionTrack({ fps: 30, avatarId: 'neon_bot', frames: [{ ...frame, t: Number.NaN }] }), null);
  assert.equal(parseMotionTrack('nope'), null);
  assert.equal(parseMotionTrack(null), null);
});
