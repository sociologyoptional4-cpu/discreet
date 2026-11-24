import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCalibrationFrames, median, percentile } from '../src/lib/personaAnalyzer.ts';
import { parsePersonaStyle } from '../src/types/persona.ts';
import type { MotionFrame } from '../src/types/avatar.ts';

const NOW = new Date('2026-11-24T10:00:00.000Z');
const frame = (t: number, extra: Partial<MotionFrame> = {}): MotionFrame => ({ t, head: [0, 0, 0], shapes: {}, ...extra });
/** 5 seconds at 30 FPS. */
const clip = (make: (i: number, t: number) => Partial<MotionFrame>): MotionFrame[] =>
  Array.from({ length: 150 }, (_, i) => frame(i / 30, make(i, i / 30)));

test('median and percentile', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(percentile([0, 10], 0.5), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
});

test('no frames gives a neutral, valid style', () => {
  const style = analyzeCalibrationFrames([], NOW);
  assert.deepEqual(style, { handSpeedMultiplier: 1, expressionGain: 1, restingHeadTilt: [0, 0, 0], dominantHand: 'both', calibratedAt: NOW.toISOString() });
  assert.ok(parsePersonaStyle(style));
});

test('resting head tilt is the median, so a nod does not move it', () => {
  const frames = clip((i) => ({ head: i % 10 === 0 ? [0.9, 0, 0] : [0.1, -0.2, 0.05] }));
  assert.deepEqual(analyzeCalibrationFrames(frames, NOW).restingHeadTilt, [0.1, -0.2, 0.05]);
});

test('a hand that moves a lot is fast and dominant; a still hand reads as calm', () => {
  const waving = clip((_, t) => ({ rightHand: [0.5 + 0.2 * Math.sin(t * 8), 0.5, 0] }));
  const fast = analyzeCalibrationFrames(waving, NOW);
  assert.equal(fast.dominantHand, 'right');
  assert.ok(fast.handSpeedMultiplier > 1.5, `speed ${fast.handSpeedMultiplier}`);

  const still = analyzeCalibrationFrames(clip((i) => ({ leftHand: [0.5 + (i % 2) * 0.001, 0.5, 0] })), NOW);
  assert.equal(still.dominantHand, 'both');
  assert.ok(still.handSpeedMultiplier < 0.8, `speed ${still.handSpeedMultiplier}`);
});

test('both hands moving alike is "both"; left clearly bigger is "left"', () => {
  const both = clip((_, t) => ({ leftHand: [0.3 + 0.1 * Math.sin(t * 6), 0.5, 0], rightHand: [0.7 + 0.1 * Math.cos(t * 6), 0.5, 0] }));
  assert.equal(analyzeCalibrationFrames(both, NOW).dominantHand, 'both');
  const left = clip((_, t) => ({ leftHand: [0.3 + 0.2 * Math.sin(t * 6), 0.5, 0], rightHand: [0.7 + 0.02 * Math.sin(t * 6), 0.5, 0] }));
  assert.equal(analyzeCalibrationFrames(left, NOW).dominantHand, 'left');
});

test('held hand detections and clip boundaries do not count as movement or speed', () => {
  // The hand model ran every other frame, so every position appears twice; the second clip restarts at t = 0.
  const held = (offset: number) => clip((i) => ({ rightHand: [0.5 + offset, 0.5 + Math.floor(i / 2) * 0.002, 0] }));
  const doubled = analyzeCalibrationFrames([...held(0), ...held(0.3)], NOW);
  const single = analyzeCalibrationFrames(held(0), NOW);
  assert.equal(doubled.handSpeedMultiplier, single.handSpeedMultiplier);
});

test('expression gain rises with how far the face goes', () => {
  const flat = analyzeCalibrationFrames(clip(() => ({ shapes: { jawOpen: 0.02 } })), NOW).expressionGain;
  const lively = analyzeCalibrationFrames(clip((i) => ({ shapes: { jawOpen: i % 3 ? 0.6 : 0.1, mouthSmileLeft: 0.5, mouthSmileRight: 0.5, browInnerUp: 0.5 } })), NOW).expressionGain;
  assert.ok(flat < 0.9, `flat ${flat}`);
  assert.ok(lively > 1.3 && lively <= 1.5, `lively ${lively}`);
});

test('output is always inside the persona limits', () => {
  const wild = clip((i) => ({ head: [5, -5, 5], shapes: { jawOpen: 1, mouthSmileLeft: 1, mouthSmileRight: 1, browInnerUp: 1 }, rightHand: [i % 2, (i + 1) % 2, 0] }));
  assert.ok(parsePersonaStyle(analyzeCalibrationFrames(wild, NOW)));
});
