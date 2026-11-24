import { PERSONA_LIMITS, type PersonaStyle } from '../types/persona.ts';
import type { MotionFrame } from '../types/avatar.ts';

/**
 * Turns calibration frames into a PersonaStyle. Pure: the same frames always give the same style.
 * The frames may come from several clips glued together (each clip's `t` restarts at 0), so a gap in time between two
 * neighbouring frames is never treated as movement.
 */

/** Hand speed, in image-widths per second, that maps to the bottom, the neutral middle and the top of the range. */
const SPEED_FOR_MIN = 0; // → 0.6 (barely moves)
const SPEED_FOR_MAX = 0.6; // → 1.8 (very animated)
const SPEED_MIN_MULTIPLIER = 0.6;
const SPEED_MAX_MULTIPLIER = 1.8;
const MAX_SAMPLE_SPEED = 3; // faster than this in one step is a tracking glitch (a hand swapped or lost), not a gesture
const NOISE_SPEED = 0.06; // slower than this is landmark jitter on a hand that is not really moving
const MAX_STEP_SECONDS = 0.35; // a bigger gap means a clip boundary or a long dropout

/** Average of the three facial peaks (jaw, smile, brow) that maps to the bottom and top of the expressiveness range. */
const PEAK_FOR_MIN = 0;
const PEAK_FOR_MAX = 0.5;
const GAIN_MIN = 0.8;
const GAIN_MAX = 1.5;

/** One hand has to move this much more than the other to count as the dominant one. */
const DOMINANCE_RATIO = 1.3;
const MIN_HAND_TRAVEL = 0.05; // total travel below this (image widths) means the hand was effectively still

type Vec3 = [number, number, number];
type HandKey = 'leftHand' | 'rightHand';
type Samples = { t: number; p: Vec3 }[];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const lerp = (v: number, inMin: number, inMax: number, outMin: number, outMax: number): number =>
  outMin + ((clamp(v, inMin, inMax) - inMin) / (inMax - inMin)) * (outMax - outMin);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `q` in 0..1, with linear interpolation between the two nearest values. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Wrist positions of one hand, in order. Consecutive frames with identical numbers are one real detection held over
 * (the recorder runs the hand model on every second frame), so only the first of each run is kept.
 */
function handSamples(frames: readonly MotionFrame[], key: HandKey): Samples {
  const samples: Samples = [];
  for (const frame of frames) {
    const p = frame[key];
    if (!p) continue;
    const last = samples[samples.length - 1];
    if (last && frame.t >= last.t && distance(last.p, p) === 0) continue;
    samples.push({ t: frame.t, p });
  }
  return samples;
}

/** Speeds (image-widths per second) and total distance between neighbouring samples of one hand. */
function handMovement(samples: Samples): { speeds: number[]; travel: number } {
  const speeds: number[] = [];
  let travel = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0 || dt > MAX_STEP_SECONDS) continue; // clip boundary or dropout
    const d = distance(samples[i].p, samples[i - 1].p);
    const speed = d / dt;
    if (speed > MAX_SAMPLE_SPEED) continue;
    if (speed < NOISE_SPEED) {
      speeds.push(0);
      continue;
    }
    speeds.push(speed);
    travel += d;
  }
  return { speeds, travel };
}

function dominantHandFrom(left: number, right: number): PersonaStyle['dominantHand'] {
  if (left < MIN_HAND_TRAVEL && right < MIN_HAND_TRAVEL) return 'both';
  if (left >= right * DOMINANCE_RATIO && left >= MIN_HAND_TRAVEL) return 'left';
  if (right >= left * DOMINANCE_RATIO && right >= MIN_HAND_TRAVEL) return 'right';
  return 'both';
}

export function analyzeCalibrationFrames(frames: readonly MotionFrame[], now: Date = new Date()): PersonaStyle {
  // Resting head tilt: the middle value of each axis, which ignores nods and glances.
  const tilt = PERSONA_LIMITS.restingHeadTilt;
  const restingHeadTilt: Vec3 = [0, 1, 2].map((axis) =>
    round3(clamp(median(frames.map((f) => f.head[axis])), tilt.min, tilt.max)),
  ) as Vec3;

  // Gesture energy and dominant hand.
  const left = handMovement(handSamples(frames, 'leftHand'));
  const right = handMovement(handSamples(frames, 'rightHand'));
  const speeds = [...left.speeds, ...right.speeds];
  const averageSpeed = speeds.length > 0 ? speeds.reduce((sum, s) => sum + s, 0) / speeds.length : null;
  // No hand was ever seen: stay neutral instead of calling the speaker slow.
  const handSpeedMultiplier = averageSpeed === null ? 1 : lerp(averageSpeed, SPEED_FOR_MIN, SPEED_FOR_MAX, SPEED_MIN_MULTIPLIER, SPEED_MAX_MULTIPLIER);

  // Expressiveness: how far the face goes at its liveliest (90th percentile ignores one-off spikes).
  const peak = (read: (shapes: Record<string, number>) => number): number => percentile(frames.map((f) => read(f.shapes)), 0.9);
  const jaw = peak((s) => s.jawOpen ?? 0);
  const smile = peak((s) => ((s.mouthSmileLeft ?? 0) + (s.mouthSmileRight ?? 0)) / 2);
  const brow = peak((s) => s.browInnerUp ?? 0);
  const expressionGain = frames.length === 0 ? 1 : lerp((jaw + smile + brow) / 3, PEAK_FOR_MIN, PEAK_FOR_MAX, GAIN_MIN, GAIN_MAX);

  return {
    handSpeedMultiplier: round2(handSpeedMultiplier),
    expressionGain: round2(expressionGain),
    restingHeadTilt,
    dominantHand: dominantHandFrom(left.travel, right.travel),
    calibratedAt: now.toISOString(),
  };
}
