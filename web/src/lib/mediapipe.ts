import { FaceDetector, FaceLandmarker, FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>; // not exported by the package
type Delegate = 'GPU' | 'CPU';
type Closable = { close(): void };

// WASM and JS must come from the same release, so this is pinned to the installed package version.
const MEDIAPIPE_VERSION = '1.2.3';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models';
const FACE_MODEL = `${MODEL_BASE}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const SEGMENTER_MODEL = `${MODEL_BASE}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`;
const FACE_LANDMARKER_MODEL = `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const HAND_LANDMARKER_MODEL = `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;

// The shared WASM fileset is stored as a promise so concurrent callers share one load and a failure can be retried.
let fileset: Promise<WasmFileset> | null = null;
const getFileset = (): Promise<WasmFileset> => {
  const mine: Promise<WasmFileset> = FilesetResolver.forVisionTasks(WASM_BASE).catch((e: unknown) => {
    if (fileset === mine) fileset = null;
    throw e;
  });
  fileset ??= mine;
  return fileset;
};

/** Try the GPU delegate first; if it cannot initialise on this device, fall back to CPU. */
async function withDelegateFallback<T>(create: (delegate: Delegate) => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch {
    return create('CPU');
  }
}

/** One lazily created, shareable model. `dispose` is safe when nothing is loaded or a load is still in flight. */
function lazyModel<T extends Closable>(create: (vision: WasmFileset, delegate: Delegate) => Promise<T>) {
  let loading: Promise<T> | null = null;
  return {
    get(): Promise<T> {
      if (loading) return loading;
      const mine: Promise<T> = getFileset()
        .then((vision) => withDelegateFallback((delegate) => create(vision, delegate)))
        .catch((e: unknown) => {
          if (loading === mine) loading = null; // allow a retry after a network failure
          throw e;
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
        /* the load failed, so there is nothing to close */
      }
    },
  };
}

const faceDetector = lazyModel((vision, delegate) =>
  FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'VIDEO',
  }),
);

const imageSegmenter = lazyModel((vision, delegate) =>
  ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  }),
);

/** Face mesh with 52 ARKit-style blendshapes and the head's 4x4 transformation matrix (drives the avatar). */
const faceLandmarker = lazyModel((vision, delegate) =>
  FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  }),
);

const handLandmarker = lazyModel((vision, delegate) =>
  HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
  }),
);

export const getFaceDetector = (): Promise<FaceDetector> => faceDetector.get();
export const getImageSegmenter = (): Promise<ImageSegmenter> => imageSegmenter.get();
export const getFaceLandmarker = (): Promise<FaceLandmarker> => faceLandmarker.get();
export const getHandLandmarker = (): Promise<HandLandmarker> => handLandmarker.get();

/** Frees every model. Safe to call when nothing is loaded, twice in a row, or while a load is still in flight. */
export async function disposeMediaPipe(): Promise<void> {
  fileset = null;
  await Promise.all([faceDetector.dispose(), imageSegmenter.dispose(), faceLandmarker.dispose(), handLandmarker.dispose()]);
}
