/**
 * Canonical 52 ARKit blendshape names matching MediaPipe FaceLandmarker
 * and Ready Player Me / ARKit `.glb` morphTargetDictionary keys.
 * Pure TypeScript — zero React, DOM, or path-alias dependencies.
 */
export const ARKIT_52_SHAPES = [
  'eyeBlinkLeft',
  'eyeLookDownLeft',
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeSquintLeft',
  'eyeWideLeft',
  'eyeBlinkRight',
  'eyeLookDownRight',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeSquintRight',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;

export type ArkitBlendshapeName = (typeof ARKIT_52_SHAPES)[number];

export const ARKIT_52_COUNT = 52;

export const ARKIT_52_INDEX: ReadonlyMap<string, number> = new Map(
  ARKIT_52_SHAPES.map((name, index) => [name, index]),
);

/** Indices 0..13 are eye/blink/gaze shapes that benefit from faster EMA response. */
export const EYE_SHAPE_MAX_INDEX = 13;
export const EYE_BLINK_LEFT_INDEX = 0;
export const EYE_BLINK_RIGHT_INDEX = 7;

export interface BlendshapeCategoryLike {
  categoryName: string;
  score: number;
}

/**
 * Copies MediaPipe `faceBlendshapes[0].categories` into a canonical 52-float array.
 * Reuses `out` when supplied to avoid per-frame allocations.
 */
export function extractBlendshapeWeights(
  categories: readonly BlendshapeCategoryLike[],
  out: Float32Array = new Float32Array(ARKIT_52_COUNT),
): Float32Array {
  out.fill(0);
  for (let i = 0; i < categories.length; i += 1) {
    const cat = categories[i];
    const idx = ARKIT_52_INDEX.get(cat.categoryName);
    if (idx !== undefined) {
      const s = cat.score;
      out[idx] = s > 0 ? (s < 1 ? s : 1) : 0;
    }
  }
  return out;
}
