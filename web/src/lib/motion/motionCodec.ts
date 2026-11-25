import {
  ARKIT_52_COUNT,
  EYE_BLINK_LEFT_INDEX,
  EYE_BLINK_RIGHT_INDEX,
  EYE_SHAPE_MAX_INDEX,
} from './arkit52.ts';

/**
 * VMT1 binary motion-token codec.
 * Header: 12 bytes
 *   [0..3]  Magic: 'VMT1' (0x56, 0x4D, 0x54, 0x31)
 *   [4]     Version: 1
 *   [5]     Flags: bit 0 = delta-encoded frames
 *   [6..7]  FPS (Uint16 LE)
 *   [8..11] FrameCount (Uint32 LE)
 * Frame: 58 bytes
 *   [0..51] 52 Uint8 blendshape weights (0..255)
 *   [52..57] 3 Int16 LE head Euler angles [pitch, yaw, roll] in radians * 10000
 */
export const VMT_MAGIC_0 = 0x56; // V
export const VMT_MAGIC_1 = 0x4d; // M
export const VMT_MAGIC_2 = 0x54; // T
export const VMT_MAGIC_3 = 0x31; // 1
export const VMT_VERSION = 1;
export const VMT_HEADER_BYTES = 12;
export const VMT_FRAME_BYTES = 58;
export const VMT_FLAG_DELTA = 1;
const EULER_SCALE = 10_000;
const MAX_RAD_INT16 = 3.2767;

export interface MotionTrackInput {
  fps: number;
  /** Flattened or array-of-frames blendshape weights (each length 52, values 0..1). */
  frames: readonly Float32Array[];
  /** Head Euler angles [pitch, yaw, roll] in radians for each frame. */
  headPoses: readonly [number, number, number][];
}

export interface DecodedMotionTrack {
  version: number;
  fps: number;
  frameCount: number;
  /** Flat Uint8Array of length frameCount * 52 (0..255 quantized weights). */
  weights: Uint8Array;
  /** Flat Int16Array of length frameCount * 3 (radians * 10000). */
  headPoses: Int16Array;
}

export interface EmaSmoothingState {
  weights: Float32Array;
  headEuler: [number, number, number];
  initialized: boolean;
}

export interface SampleOptions {
  eyeAlpha?: number;
  faceAlpha?: number;
  headAlpha?: number;
  /** Suppresses single-frame accidental blink drops by clamping tiny blink jitter < 0.08. */
  blinkNoiseFloor?: number;
}

export function createEmaSmoothingState(): EmaSmoothingState {
  return {
    weights: new Float32Array(ARKIT_52_COUNT),
    headEuler: [0, 0, 0],
    initialized: false,
  };
}

function clampUnit(v: number): number {
  return Number.isFinite(v) ? (v <= 0 ? 0 : v >= 1 ? 1 : v) : 0;
}

function clampRad(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v <= -MAX_RAD_INT16 ? -MAX_RAD_INT16 : v >= MAX_RAD_INT16 ? MAX_RAD_INT16 : v;
}

/** Packs 1 frame (58 bytes): 52 Uint8 blendshapes + 3 Int16 LE Euler angles. */
export function packFrame(
  view: DataView,
  offset: number,
  weights: Float32Array | readonly number[],
  headEuler: readonly [number, number, number],
): void {
  for (let i = 0; i < ARKIT_52_COUNT; i += 1) {
    view.setUint8(offset + i, Math.round(clampUnit(weights[i] ?? 0) * 255));
  }
  view.setInt16(offset + 52, Math.round(clampRad(headEuler[0]) * EULER_SCALE), true);
  view.setInt16(offset + 54, Math.round(clampRad(headEuler[1]) * EULER_SCALE), true);
  view.setInt16(offset + 56, Math.round(clampRad(headEuler[2]) * EULER_SCALE), true);
}

/** Unpacks 1 frame (58 bytes) into preallocated `outWeights` and `outHeadEuler`. */
export function unpackFrame(
  view: DataView,
  offset: number,
  outWeights: Float32Array,
  outHeadEuler: [number, number, number],
): void {
  for (let i = 0; i < ARKIT_52_COUNT; i += 1) {
    outWeights[i] = view.getUint8(offset + i) / 255;
  }
  outHeadEuler[0] = view.getInt16(offset + 52, true) / EULER_SCALE;
  outHeadEuler[1] = view.getInt16(offset + 54, true) / EULER_SCALE;
  outHeadEuler[2] = view.getInt16(offset + 56, true) / EULER_SCALE;
}

async function gzipCompress(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return raw;
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const stream = new Blob([copy]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream("gzip") is not available in this runtime.');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encodes a recorded motion track into `VMT1` binary format, optionally applying
 * lossless byte-delta encoding and native `gzip` compression.
 */
export async function encodeMotionTrack(
  track: MotionTrackInput,
  options: { gzip?: boolean; delta?: boolean } = {},
): Promise<Uint8Array> {
  const frameCount = Math.min(track.frames.length, track.headPoses.length);
  const useDelta = options.delta ?? true;
  const useGzip = options.gzip ?? true;

  const raw = new Uint8Array(VMT_HEADER_BYTES + frameCount * VMT_FRAME_BYTES);
  const view = new DataView(raw.buffer);

  raw[0] = VMT_MAGIC_0;
  raw[1] = VMT_MAGIC_1;
  raw[2] = VMT_MAGIC_2;
  raw[3] = VMT_MAGIC_3;
  raw[4] = VMT_VERSION;
  raw[5] = useDelta ? VMT_FLAG_DELTA : 0;
  view.setUint16(6, Math.max(1, Math.min(240, Math.round(track.fps))), true);
  view.setUint32(8, frameCount, true);

  for (let f = 0; f < frameCount; f += 1) {
    packFrame(view, VMT_HEADER_BYTES + f * VMT_FRAME_BYTES, track.frames[f], track.headPoses[f]);
  }

  if (useDelta && frameCount > 1) {
    // Delta-encode frame bytes in-place backwards so frame 0 remains intact and each byte stores (cur - prev) & 0xff
    for (let f = frameCount - 1; f >= 1; f -= 1) {
      const curBase = VMT_HEADER_BYTES + f * VMT_FRAME_BYTES;
      const prevBase = curBase - VMT_FRAME_BYTES;
      for (let b = 0; b < VMT_FRAME_BYTES; b += 1) {
        raw[curBase + b] = (raw[curBase + b] - raw[prevBase + b]) & 0xff;
      }
    }
  }

  if (!useGzip) return raw;
  try {
    return await gzipCompress(raw);
  } catch {
    return raw;
  }
}

/**
 * Decodes a `VMT1` binary or gzipped `.vmt` buffer into flat typed arrays
 * for zero-allocation 60fps playback.
 */
export async function decodeMotionTrack(input: Uint8Array): Promise<DecodedMotionTrack> {
  const isGzip = input.byteLength >= 2 && input[0] === 0x1f && input[1] === 0x8b;
  const raw = isGzip ? await gzipDecompress(input) : input;

  if (raw.byteLength < VMT_HEADER_BYTES) {
    throw new Error('Invalid VMT1 motion track: buffer too short.');
  }
  if (
    raw[0] !== VMT_MAGIC_0 ||
    raw[1] !== VMT_MAGIC_1 ||
    raw[2] !== VMT_MAGIC_2 ||
    raw[3] !== VMT_MAGIC_3
  ) {
    throw new Error('Invalid VMT1 motion track: bad magic header.');
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = raw[4];
  const flags = raw[5];
  const fps = view.getUint16(6, true);
  const frameCount = view.getUint32(8, true);

  const expectedLength = VMT_HEADER_BYTES + frameCount * VMT_FRAME_BYTES;
  if (raw.byteLength < expectedLength) {
    throw new Error('Invalid VMT1 motion track: truncated frame payload.');
  }

  const working = new Uint8Array(raw.subarray(0, expectedLength));
  if ((flags & VMT_FLAG_DELTA) !== 0 && frameCount > 1) {
    for (let f = 1; f < frameCount; f += 1) {
      const curBase = VMT_HEADER_BYTES + f * VMT_FRAME_BYTES;
      const prevBase = curBase - VMT_FRAME_BYTES;
      for (let b = 0; b < VMT_FRAME_BYTES; b += 1) {
        working[curBase + b] = (working[curBase + b] + working[prevBase + b]) & 0xff;
      }
    }
  }

  const workingView = new DataView(working.buffer);
  const weights = new Uint8Array(frameCount * ARKIT_52_COUNT);
  const headPoses = new Int16Array(frameCount * 3);

  for (let f = 0; f < frameCount; f += 1) {
    const srcOffset = VMT_HEADER_BYTES + f * VMT_FRAME_BYTES;
    weights.set(working.subarray(srcOffset, srcOffset + ARKIT_52_COUNT), f * ARKIT_52_COUNT);
    const poseOffset = f * 3;
    headPoses[poseOffset] = workingView.getInt16(srcOffset + 52, true);
    headPoses[poseOffset + 1] = workingView.getInt16(srcOffset + 54, true);
    headPoses[poseOffset + 2] = workingView.getInt16(srcOffset + 56, true);
  }

  return { version, fps, frameCount, weights, headPoses };
}

/**
 * Samples a decoded track at `timeSec` using zero-allocation linear interpolation
 * (e.g., 20fps -> 60fps) + optional EMA anti-jitter smoothing.
 */
export function sampleMotionFrame(
  track: DecodedMotionTrack,
  timeSec: number,
  outWeights: Float32Array,
  outHeadEuler: [number, number, number],
  smoothing?: EmaSmoothingState,
  options: SampleOptions = {},
): void {
  if (track.frameCount <= 0) {
    outWeights.fill(0);
    outHeadEuler[0] = 0;
    outHeadEuler[1] = 0;
    outHeadEuler[2] = 0;
    return;
  }

  const safeTime = timeSec > 0 && Number.isFinite(timeSec) ? timeSec : 0;
  const exactFrame = Math.min(safeTime * track.fps, track.frameCount - 1);
  const idxA = Math.min(Math.floor(exactFrame), track.frameCount - 1);
  const idxB = Math.min(idxA + 1, track.frameCount - 1);
  const alpha = exactFrame - idxA;

  const baseA = idxA * ARKIT_52_COUNT;
  const baseB = idxB * ARKIT_52_COUNT;
  const poseA = idxA * 3;
  const poseB = idxB * 3;

  const eyeAlpha = options.eyeAlpha ?? 0.6;
  const faceAlpha = options.faceAlpha ?? 0.45;
  const headAlpha = options.headAlpha ?? 0.25;
  const blinkFloor = options.blinkNoiseFloor ?? 0.08;

  for (let i = 0; i < ARKIT_52_COUNT; i += 1) {
    const a = track.weights[baseA + i];
    const b = track.weights[baseB + i];
    let target = (a + (b - a) * alpha) / 255;

    if ((i === EYE_BLINK_LEFT_INDEX || i === EYE_BLINK_RIGHT_INDEX) && target < blinkFloor) {
      target = 0;
    }

    if (smoothing) {
      if (!smoothing.initialized) {
        smoothing.weights[i] = target;
      } else {
        const factor = i <= EYE_SHAPE_MAX_INDEX ? eyeAlpha : faceAlpha;
        smoothing.weights[i] += (target - smoothing.weights[i]) * factor;
      }
      outWeights[i] = smoothing.weights[i];
    } else {
      outWeights[i] = target;
    }
  }

  for (let axis = 0; axis < 3; axis += 1) {
    const a = track.headPoses[poseA + axis] / EULER_SCALE;
    const b = track.headPoses[poseB + axis] / EULER_SCALE;
    const target = a + (b - a) * alpha;
    if (smoothing) {
      if (!smoothing.initialized) {
        smoothing.headEuler[axis] = target;
      } else {
        smoothing.headEuler[axis] += (target - smoothing.headEuler[axis]) * headAlpha;
      }
      outHeadEuler[axis] = smoothing.headEuler[axis];
    } else {
      outHeadEuler[axis] = target;
    }
  }

  if (smoothing && !smoothing.initialized) {
    smoothing.initialized = true;
  }
}
