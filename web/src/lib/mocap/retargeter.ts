import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { FaceLandmarkerResult, HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import type { MotionFrame } from '@/types/avatar';

/* -------------------------------------------------------------------------- */
/* 1-Euro Filter (adaptive low-pass: zero micro-jitter at rest, snappy motion) */
/* -------------------------------------------------------------------------- */

export class OneEuroFilter {
  private prevX: number | null = null;
  private prevDx = 0;
  private prevT: number | null = null;

  constructor(
    private readonly minCutoff = 1.4,
    private readonly beta = 0.08,
    private readonly dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tSec: number): number {
    if (this.prevX === null || this.prevT === null) {
      this.prevX = x;
      this.prevT = tSec;
      return x;
    }
    const dt = Math.max(1 / 240, tSec - this.prevT);
    const dx = (x - this.prevX) / dt;
    const ed = this.alpha(this.dCutoff, dt);
    const dxHat = ed * dx + (1 - ed) * this.prevDx;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.prevX;
    this.prevX = xHat;
    this.prevDx = dxHat;
    this.prevT = tSec;
    return xHat;
  }

  reset(): void {
    this.prevX = null;
    this.prevDx = 0;
    this.prevT = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Web Audio API Lip-Sync Fallback                                            */
/* -------------------------------------------------------------------------- */

export class AudioLipSyncAnalyser {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;

  connect(stream: MediaStream | null): void {
    this.dispose();
    if (!stream || typeof AudioContext === 'undefined' || stream.getAudioTracks().length === 0) return;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      this.ctx = ctx;
      this.analyser = analyser;
      this.source = source;
      this.bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      this.dispose();
    }
  }

  /** Returns normalized [0..1] vocal energy for `jawOpen` / `aa` fallback. */
  sampleJawOpen(): number {
    if (!this.analyser || !this.bins) return 0;
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
    this.analyser.getByteFrequencyData(this.bins);
    // Focus on human speech formants (~300Hz..3kHz bins)
    let sum = 0;
    const start = 2;
    const end = Math.min(this.bins.length, 28);
    for (let i = start; i < end; i++) sum += this.bins[i];
    const avg = sum / Math.max(1, end - start) / 255;
    return Math.min(1, Math.max(0, (avg - 0.06) * 2.4));
  }

  dispose(): void {
    this.source?.disconnect();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.bins = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Landmark -> MotionFrame Solver                                             */
/* -------------------------------------------------------------------------- */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export class MotionSolver {
  private readonly headFilters = [new OneEuroFilter(1.6, 0.12), new OneEuroFilter(1.6, 0.12), new OneEuroFilter(1.6, 0.12)];
  private readonly handFilters = {
    left: [new OneEuroFilter(1.8, 0.15), new OneEuroFilter(1.8, 0.15), new OneEuroFilter(1.8, 0.15)],
    right: [new OneEuroFilter(1.8, 0.15), new OneEuroFilter(1.8, 0.15), new OneEuroFilter(1.8, 0.15)],
  };
  private lastValidFaceAt = -1;
  private lastHead: [number, number, number] = [0, 0, 0];

  solve(
    face: FaceLandmarkerResult,
    pose: PoseLandmarkerResult | null,
    hand: HandLandmarkerResult | null,
    tSec: number,
    options: { mirrored?: boolean; audioJawFallback?: number } = {},
  ): MotionFrame {
    const mirrored = options.mirrored ?? true;
    const mirrorSign = mirrored ? -1 : 1;
    const shapes: Record<string, number> = {};
    const hasFace = (face.faceBlendshapes?.[0]?.categories?.length ?? 0) > 0;

    let head: [number, number, number] = [...this.lastHead] as [number, number, number];

    if (hasFace) {
      this.lastValidFaceAt = tSec;
      const matrix = face.facialTransformationMatrixes?.[0]?.data;
      if (matrix && matrix.length >= 16) {
        const m = new THREE.Matrix4().fromArray(matrix);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        m.decompose(pos, quat, scale);
        const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
        const raw: [number, number, number] = [
          clamp(euler.x, -0.55, 0.55),
          clamp(euler.y * mirrorSign, -0.75, 0.75),
          clamp(euler.z * mirrorSign, -0.45, 0.45),
        ];
        head = [
          round3(this.headFilters[0].filter(raw[0], tSec)),
          round3(this.headFilters[1].filter(raw[1], tSec)),
          round3(this.headFilters[2].filter(raw[2], tSec)),
        ];
        this.lastHead = head;
      }

      for (const cat of face.faceBlendshapes[0].categories) {
        if (cat.categoryName === '_neutral' || cat.score < 0.01) continue;
        shapes[cat.categoryName] = round3(clamp(cat.score, 0, 1));
      }
    } else {
      // Procedural idle breathing & audio lip-sync fallback when face leaves frame
      const fade = this.lastValidFaceAt >= 0 ? Math.max(0, 1 - (tSec - this.lastValidFaceAt) * 1.5) : 0;
      head = [
        round3(this.lastHead[0] * fade + Math.sin(tSec * 1.2) * 0.03),
        round3(this.lastHead[1] * fade),
        round3(this.lastHead[2] * fade + Math.cos(tSec * 0.9) * 0.02),
      ];
      if ((options.audioJawFallback ?? 0) > 0.02) {
        shapes.jawOpen = round3(options.audioJawFallback!);
      }
    }

    // Upper-body wrist targets from HandLandmarker (preferred) or PoseLandmarker fallback
    let leftHand: [number, number, number] | undefined;
    let rightHand: [number, number, number] | undefined;

    if (hand?.landmarks?.length) {
      hand.landmarks.forEach((lm, idx) => {
        const wrist = lm[0];
        if (!wrist) return;
        const rawLabel = hand.handednesses?.[idx]?.[0]?.categoryName ?? (idx === 0 ? 'Left' : 'Right');
        const side = mirrored ? (rawLabel === 'Left' ? 'right' : 'left') : rawLabel === 'Left' ? 'left' : 'right';
        const fx = mirrored ? 1 - wrist.x : wrist.x;
        const filtered: [number, number, number] = [
          round3(this.handFilters[side][0].filter(clamp(fx, 0, 1), tSec)),
          round3(this.handFilters[side][1].filter(clamp(wrist.y, 0, 1), tSec)),
          round3(this.handFilters[side][2].filter(clamp(wrist.z, -0.5, 0.5), tSec)),
        ];
        if (side === 'left') leftHand = filtered;
        else rightHand = filtered;
      });
    } else if (pose?.landmarks?.[0]?.length) {
      const p = pose.landmarks[0];
      const lw = p[15];
      const rw = p[16];
      if (lw && (lw.visibility ?? 0) > 0.45) {
        const x = mirrored ? 1 - lw.x : lw.x;
        const target: [number, number, number] = [
          round3(this.handFilters.left[0].filter(clamp(x, 0, 1), tSec)),
          round3(this.handFilters.left[1].filter(clamp(lw.y, 0, 1), tSec)),
          round3(this.handFilters.left[2].filter(clamp(lw.z, -0.5, 0.5), tSec)),
        ];
        if (mirrored) rightHand = target;
        else leftHand = target;
      }
      if (rw && (rw.visibility ?? 0) > 0.45) {
        const x = mirrored ? 1 - rw.x : rw.x;
        const target: [number, number, number] = [
          round3(this.handFilters.right[0].filter(clamp(x, 0, 1), tSec)),
          round3(this.handFilters.right[1].filter(clamp(rw.y, 0, 1), tSec)),
          round3(this.handFilters.right[2].filter(clamp(rw.z, -0.5, 0.5), tSec)),
        ];
        if (mirrored) leftHand = target;
        else rightHand = target;
      }
    }

    const frame: MotionFrame = { t: round3(tSec), head, shapes };
    if (leftHand) frame.leftHand = leftHand;
    if (rightHand) frame.rightHand = rightHand;
    return frame;
  }

  reset(): void {
    this.headFilters.forEach((f) => f.reset());
    this.handFilters.left.forEach((f) => f.reset());
    this.handFilters.right.forEach((f) => f.reset());
    this.lastValidFaceAt = -1;
    this.lastHead = [0, 0, 0];
  }
}

/* -------------------------------------------------------------------------- */
/* VRM 0.x / 1.0 Humanoid Bone & Expression Retargeter                        */
/* -------------------------------------------------------------------------- */

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

function slerpBone(vrm: VRM, boneName: VRMHumanBoneName, x: number, y: number, z: number, alpha: number): void {
  const node = vrm.humanoid?.getNormalizedBoneNode(boneName);
  if (!node) return;
  _euler.set(x, y, z, 'YXZ');
  _quat.setFromEuler(_euler);
  node.quaternion.slerp(_quat, alpha);
}

/** Applies a MotionFrame + procedural idle breathing/blinking + SpringBone update to a VRM instance. */
export function applyMotionToVRM(
  vrm: VRM,
  frame: MotionFrame | null,
  deltaSec: number,
  elapsedSec: number,
): void {
  const alpha = 1 - Math.exp(-deltaSec * 18);
  const shapes = frame?.shapes ?? {};
  const s = (name: string): number => shapes[name] ?? 0;

  // Head & Neck / Spine subtle follow
  const hx = frame?.head[0] ?? Math.sin(elapsedSec * 1.1) * 0.025;
  const hy = frame?.head[1] ?? 0;
  const hz = frame?.head[2] ?? 0;

  slerpBone(vrm, 'head', hx * 0.72, hy * 0.72, hz * 0.72, alpha);
  slerpBone(vrm, 'neck', hx * 0.28, hy * 0.28, hz * 0.28, alpha);
  slerpBone(vrm, 'spine', Math.sin(elapsedSec * 1.3) * 0.015 + hx * 0.08, hy * 0.12, 0, alpha);

  // Arms from normalized wrist targets (clamped to natural human angles)
  if (frame?.leftHand) {
    const [lx, ly] = frame.leftHand;
    const raise = clamp((0.75 - ly) * 1.8, -0.35, 1.35);
    const out = clamp((0.5 - lx) * 1.2, -0.3, 0.9);
    slerpBone(vrm, 'leftUpperArm', -raise * 0.55, 0, 1.15 - raise * 0.9 - out * 0.35, alpha);
    slerpBone(vrm, 'leftLowerArm', 0, -clamp(raise * 0.9, 0.1, 1.6), 0, alpha);
  } else {
    slerpBone(vrm, 'leftUpperArm', 0.05, 0, 1.18 + Math.sin(elapsedSec * 1.2) * 0.02, alpha);
    slerpBone(vrm, 'leftLowerArm', 0, -0.18, 0, alpha);
  }

  if (frame?.rightHand) {
    const [rx, ry] = frame.rightHand;
    const raise = clamp((0.75 - ry) * 1.8, -0.35, 1.35);
    const out = clamp((rx - 0.5) * 1.2, -0.3, 0.9);
    slerpBone(vrm, 'rightUpperArm', -raise * 0.55, 0, -1.15 + raise * 0.9 + out * 0.35, alpha);
    slerpBone(vrm, 'rightLowerArm', 0, clamp(raise * 0.9, 0.1, 1.6), 0, alpha);
  } else {
    slerpBone(vrm, 'rightUpperArm', 0.05, 0, -1.18 - Math.sin(elapsedSec * 1.2) * 0.02, alpha);
    slerpBone(vrm, 'rightLowerArm', 0, 0.18, 0, alpha);
  }

  // VRM Expressions (handles both VRM 1.0 & VRM 0.x preset names via ExpressionManager)
  const expr = vrm.expressionManager;
  if (expr) {
    const autoBlink = !frame ? (Math.sin(elapsedSec * 1.7) > 0.985 ? 1 : 0) : 0;
    const blinkL = clamp(s('eyeBlinkLeft') || autoBlink, 0, 1);
    const blinkR = clamp(s('eyeBlinkRight') || autoBlink, 0, 1);
    const jaw = clamp(s('jawOpen'), 0, 1);
    const smile = clamp((s('mouthSmileLeft') + s('mouthSmileRight')) * 0.5, 0, 1);
    const pucker = clamp(s('mouthPucker'), 0, 1);
    const browDown = clamp((s('browDownLeft') + s('browDownRight')) * 0.5, 0, 1);
    const surprised = clamp(s('browInnerUp') * 0.7 + s('eyeWideLeft') * 0.3, 0, 1);

    const setExpr = (name: string, val: number) => {
      if (expr.getExpression(name)) expr.setValue(name, val);
    };
    setExpr('blinkLeft', blinkL);
    setExpr('blinkRight', blinkR);
    setExpr('blink', (blinkL + blinkR) * 0.5);
    setExpr('aa', clamp(jaw * (1 - pucker * 0.6), 0, 1));
    setExpr('ou', clamp(pucker * 0.85, 0, 1));
    setExpr('ih', clamp(smile * 0.55 * (1 - jaw * 0.4), 0, 1));
    setExpr('happy', smile);
    setExpr('angry', browDown);
    setExpr('surprised', surprised);
    expr.update();
  }

  vrm.update(deltaSec);
}
