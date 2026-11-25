'use client';

import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { ARKIT_52_COUNT, extractBlendshapeWeights } from './arkit52';

const MEDIAPIPE_VERSION = '1.2.3';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const CAPTURE_INTERVAL_MS = 50; // 20 fps battery-safe capture throttle

export interface TrackedFaceSample {
  faceDetected: boolean;
  weights: Float32Array;
  headEuler: [number, number, number];
  timestampMs: number;
}

/**
 * Extracts [pitch, yaw, roll] Euler angles (XYZ order) from a column-major 4x4 transformation matrix.
 */
function matrixToEulerXYZ(m: Float32Array | number[], out: [number, number, number]): void {
  if (m.length < 16) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  // Normalize column vectors to strip any scale component
  const c0x = m[0], c0y = m[1], c0z = m[2];
  const c1x = m[4], c1y = m[5], c1z = m[6];
  const c2x = m[8], c2y = m[9], c2z = m[10];

  const s0 = Math.hypot(c0x, c0y, c0z) || 1;
  const s1 = Math.hypot(c1x, c1y, c1z) || 1;
  const s2 = Math.hypot(c2x, c2y, c2z) || 1;

  const r00 = c0x / s0;
  const r01 = c1x / s1, r11 = c1y / s1, r21 = c1z / s1;
  const r02 = c2x / s2, r12 = c2y / s2, r22 = c2z / s2;

  const sy = Math.max(-1, Math.min(1, r02));
  const yaw = Math.asin(sy);
  let pitch = 0;
  let roll = 0;

  if (Math.abs(sy) < 0.99999) {
    pitch = Math.atan2(-r12, r22);
    roll = Math.atan2(-r01, r00);
  } else {
    pitch = Math.atan2(r21, r11);
    roll = 0;
  }

  // Clamp subtle resting jitter
  out[0] = Number.isFinite(pitch) ? pitch : 0;
  out[1] = Number.isFinite(yaw) ? yaw : 0;
  out[2] = Number.isFinite(roll) ? roll : 0;
}

export class FaceMotionTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastCaptureMs = 0;
  private lastVideoTs = 0;
  private readonly weightsBuf = new Float32Array(ARKIT_52_COUNT);
  private readonly eulerBuf: [number, number, number] = [0, 0, 0];

  async init(): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('FaceMotionTracker can only initialize in a browser environment.');
    }
    if (this.landmarker) return;

    const { FaceLandmarker: LandmarkerCtor, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);

    try {
      this.landmarker = await LandmarkerCtor.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    } catch {
      this.landmarker = await LandmarkerCtor.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    }
  }

  /**
   * Processes a video frame at most once every 50ms (20fps).
   * Returns `null` when throttled or when the video is not ready.
   */
  detectThrottled(video: HTMLVideoElement, nowMs = performance.now()): TrackedFaceSample | null {
    if (!this.landmarker || video.readyState < 2 || !video.videoWidth) {
      return null;
    }
    if (nowMs - this.lastCaptureMs < CAPTURE_INTERVAL_MS) {
      return null;
    }
    this.lastCaptureMs = nowMs;

    const ts = Math.max(nowMs, this.lastVideoTs + 1);
    this.lastVideoTs = ts;

    const result = this.landmarker.detectForVideo(video, ts);
    const categories = result.faceBlendshapes?.[0]?.categories;
    const matrix = result.facialTransformationMatrixes?.[0]?.data;

    if (!categories || categories.length === 0) {
      this.weightsBuf.fill(0);
      this.eulerBuf[0] = 0;
      this.eulerBuf[1] = 0;
      this.eulerBuf[2] = 0;
      return {
        faceDetected: false,
        weights: this.weightsBuf,
        headEuler: this.eulerBuf,
        timestampMs: ts,
      };
    }

    extractBlendshapeWeights(categories, this.weightsBuf);
    if (matrix) {
      matrixToEulerXYZ(matrix, this.eulerBuf);
    } else {
      this.eulerBuf[0] = 0;
      this.eulerBuf[1] = 0;
      this.eulerBuf[2] = 0;
    }

    return {
      faceDetected: true,
      weights: this.weightsBuf,
      headEuler: this.eulerBuf,
      timestampMs: ts,
    };
  }

  close(): void {
    try {
      this.landmarker?.close();
    } catch {
      // ignore close errors
    } finally {
      this.landmarker = null;
    }
  }
}
