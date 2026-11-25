import assert from 'node:assert/strict';
import test from 'node:test';
import { ARKIT_52_COUNT, ARKIT_52_SHAPES, extractBlendshapeWeights } from '../src/lib/motion/arkit52.ts';
import {
  createEmaSmoothingState,
  decodeMotionTrack,
  encodeMotionTrack,
  packFrame,
  sampleMotionFrame,
  unpackFrame,
  VMT_FRAME_BYTES,
  VMT_HEADER_BYTES,
} from '../src/lib/motion/motionCodec.ts';

test('ARKIT_52_SHAPES has 52 unique canonical blendshape names', () => {
  assert.equal(ARKIT_52_SHAPES.length, ARKIT_52_COUNT);
  assert.equal(new Set(ARKIT_52_SHAPES).size, 52);

  const out = extractBlendshapeWeights([
    { categoryName: 'jawOpen', score: 0.75 },
    { categoryName: 'eyeBlinkLeft', score: 1.5 }, // should clamp to 1
    { categoryName: '_neutral', score: 0.9 }, // ignored
  ]);
  assert.equal(out.length, 52);
  assert.equal(out[0], 1); // eyeBlinkLeft
  assert.equal(out[17], 0.75); // jawOpen
});

test('packFrame and unpackFrame preserve Uint8 weights and Int16 Euler poses within quantization bounds', () => {
  const buf = new ArrayBuffer(VMT_FRAME_BYTES);
  const view = new DataView(buf);
  const weights = new Float32Array(52);
  weights[0] = 0.5;
  weights[17] = 0.85;
  weights[51] = 1.4; // clamped to 1

  const pose: [number, number, number] = [0.25, -0.4, 0.12];
  packFrame(view, 0, weights, pose);

  const outW = new Float32Array(52);
  const outPose: [number, number, number] = [0, 0, 0];
  unpackFrame(view, 0, outW, outPose);

  assert.ok(Math.abs(outW[0] - 0.5) <= 1 / 255);
  assert.ok(Math.abs(outW[17] - 0.85) <= 1 / 255);
  assert.equal(outW[51], 1);
  assert.ok(Math.abs(outPose[0] - 0.25) < 0.0002);
  assert.ok(Math.abs(outPose[1] - -0.4) < 0.0002);
  assert.ok(Math.abs(outPose[2] - 0.12) < 0.0002);
});

test('15s @ 20fps (300 frames) VMT1 raw is < 20 KB and gzip round-trips cleanly', async () => {
  const fps = 20;
  const frameCount = 300;
  const frames: Float32Array[] = [];
  const headPoses: [number, number, number][] = [];

  for (let f = 0; f < frameCount; f += 1) {
    const t = f / fps;
    const w = new Float32Array(52);
    w[17] = Math.max(0, Math.sin(t * 4) * 0.6); // jawOpen
    w[23] = 0.3 + 0.2 * Math.sin(t * 1.5); // mouthSmileLeft
    frames.push(w);
    headPoses.push([Math.sin(t) * 0.15, Math.cos(t * 0.8) * 0.2, 0.03]);
  }

  const raw = await encodeMotionTrack({ fps, frames, headPoses }, { gzip: false, delta: true });
  assert.equal(raw.byteLength, VMT_HEADER_BYTES + frameCount * VMT_FRAME_BYTES);
  assert.ok(raw.byteLength < 20 * 1024, `Expected < 20KB, got ${raw.byteLength}`);

  const gz = await encodeMotionTrack({ fps, frames, headPoses }, { gzip: true, delta: true });
  assert.ok(gz.byteLength < raw.byteLength, `Expected gzip (${gz.byteLength}) < raw (${raw.byteLength})`);

  const decoded = await decodeMotionTrack(gz);
  assert.equal(decoded.fps, 20);
  assert.equal(decoded.frameCount, 300);

  // Verify mid-frame 60fps linear interpolation at t = 0.025s (halfway between frame 0 and 1)
  const outW = new Float32Array(52);
  const outPose: [number, number, number] = [0, 0, 0];
  sampleMotionFrame(decoded, 0.025, outW, outPose);

  const expectedSmile = (decoded.weights[23] + decoded.weights[52 + 23]) / 2 / 255;
  assert.ok(Math.abs(outW[23] - expectedSmile) < 0.001);

  // Verify EMA smoothing moves gradually toward target
  const ema = createEmaSmoothingState();
  sampleMotionFrame(decoded, 0, outW, outPose, ema);
  const firstYaw = outPose[1];
  sampleMotionFrame(decoded, 1.0, outW, outPose, ema, { headAlpha: 0.25 });
  assert.notEqual(outPose[1], firstYaw);
});
