'use client';

import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

export type DeviceTier = 'low' | 'mid' | 'high';

export type VisionProfile = {
  tier: DeviceTier;
  targetFps: number;
  enablePose: boolean;
  enableHands: boolean;
  handEveryNFrames: number;
};

export type VisionModels = {
  face: FaceLandmarker;
  pose: PoseLandmarker | null;
  hand: HandLandmarker | null;
  profile: VisionProfile;
};

export type VisionSnapshot = {
  face: FaceLandmarkerResult;
  pose: PoseLandmarkerResult | null;
  hand: HandLandmarkerResult | null;
};

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
type Delegate = 'GPU' | 'CPU';
type Closable = { close(): void };

const MEDIAPIPE_VERSION = '1.2.3';
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models';
const FACE_MODEL = `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const POSE_MODEL = `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;
const HAND_MODEL = `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;

/** Detects device compute tier to scale MediaPipe inference rate and optional hand tracking. */
export function detectVisionProfile(): VisionProfile {
  if (typeof navigator === 'undefined') {
    return { tier: 'mid', targetFps: 24, enablePose: true, enableHands: true, handEveryNFrames: 2 };
  }
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (cores <= 2 || mem <= 2) {
    return { tier: 'low', targetFps: 20, enablePose: true, enableHands: false, handEveryNFrames: 4 };
  }
  if (mobile || cores <= 4 || mem <= 4) {
    return { tier: 'mid', targetFps: 24, enablePose: true, enableHands: true, handEveryNFrames: 2 };
  }
  return { tier: 'high', targetFps: 30, enablePose: true, enableHands: true, handEveryNFrames: 2 };
}

let filesetPromise: Promise<WasmFileset> | null = null;
function getFileset(): Promise<WasmFileset> {
  const mine = FilesetResolver.forVisionTasks(WASM_CDN).catch((err: unknown) => {
    if (filesetPromise === mine) filesetPromise = null;
    throw err;
  });
  filesetPromise ??= mine;
  return filesetPromise;
}

async function withDelegateFallback<T>(create: (delegate: Delegate) => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch {
    return create('CPU');
  }
}

function lazyModel<T extends Closable>(create: (vision: WasmFileset, delegate: Delegate) => Promise<T>) {
  let loading: Promise<T> | null = null;
  return {
    get(): Promise<T> {
      if (loading) return loading;
      const mine = getFileset()
        .then((vision) => withDelegateFallback((delegate) => create(vision, delegate)))
        .catch((err: unknown) => {
          if (loading === mine) loading = null;
          throw err;
        });
      loading = mine;
      return mine;
    },
    async dispose(): Promise<void> {
      const current = loading;
      loading = null;
      if (!current) return;
      try {
        (await current).close();
      } catch {
        /* model failed to load; nothing to close */
      }
    },
  };
}

const faceLandmarker = lazyModel((vision, delegate) =>
  FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  }),
);

const poseLandmarker = lazyModel((vision, delegate) =>
  PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  }),
);

const handLandmarker = lazyModel((vision, delegate) =>
  HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
  }),
);

/** Loads the tier-appropriate MediaPipe Vision models. Pose/hand degrade gracefully if unavailable. */
export async function loadVisionModels(profile = detectVisionProfile()): Promise<VisionModels> {
  const [face, pose, hand] = await Promise.all([
    faceLandmarker.get(),
    profile.enablePose ? poseLandmarker.get().catch(() => null) : Promise.resolve(null),
    profile.enableHands ? handLandmarker.get().catch(() => null) : Promise.resolve(null),
  ]);
  return { face, pose, hand, profile };
}

/** Releases all MediaPipe WASM/GPU resources cleanly. */
export async function disposeVisionEngine(): Promise<void> {
  filesetPromise = null;
  await Promise.all([faceLandmarker.dispose(), poseLandmarker.dispose(), handLandmarker.dispose()]);
}
