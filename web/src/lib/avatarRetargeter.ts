import * as THREE from 'three';
import type { FaceLandmarkerResult, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { MotionFrame } from '@/types/avatar';

/**
 * Motion capture <-> rig, as two pure functions.
 *
 * Conventions (the avatar copies the camera image as-is, it does not mirror it):
 *  - head = [pitch, yaw, roll] in radians, three.js axes with the avatar facing +Z (towards the viewer):
 *    pitch +  = looking down, yaw + = turning towards the viewer's right, roll + = tilting counter-clockwise on screen.
 *  - hands = MediaPipe normalised wrist [x, y, z]: x right and y down across the image (0..1), z depth (smaller = nearer).
 */

const SHAPE_FLOOR = 0.01; // weights below this are dropped from the stored frame
const NEUTRAL_SHAPE = '_neutral'; // MediaPipe's extra category; it is not an ARKit shape and no avatar has a target for it
const WRIST = 0; // index of the wrist in MediaPipe's 21 hand landmarks
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export type ExtractOptions = {
  /** Set true if the image given to MediaPipe was horizontally flipped: its hand labels are then inverted, so swap them back. */
  mirroredInput?: boolean;
};

const ZERO_HEAD: [number, number, number] = [0, 0, 0];

/** True when the face landmarker found a face with usable head pose and blendshapes. */
export function hasTrackedFace(face: FaceLandmarkerResult): boolean {
  return face.facialTransformationMatrixes.length > 0 && (face.faceBlendshapes[0]?.categories.length ?? 0) > 0;
}

/** Head rotation from MediaPipe's 4x4 face transform (column-major, includes scale and translation). */
function headFromMatrix(data: number[]): [number, number, number] {
  if (data.length !== 16) return ZERO_HEAD;
  const m = new THREE.Matrix4().fromArray(data);
  const quaternion = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3()); // drops the scale that would skew a plain Euler read
  const e = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ'); // yaw first, then pitch, then roll: stable for heads
  return [round3(e.x), round3(e.y), round3(e.z)];
}

/** One wrist per hand. If the detector reports two hands with the same label, the more confident one wins. */
function wristsFromHands(hands: HandLandmarkerResult, mirrored: boolean): { left?: [number, number, number]; right?: [number, number, number] } {
  const best: { left?: { score: number; p: [number, number, number] }; right?: { score: number; p: [number, number, number] } } = {};
  hands.landmarks.forEach((landmarks, i) => {
    const wrist = landmarks[WRIST];
    const label = hands.handedness[i]?.[0];
    if (!wrist || !label) return;
    const isLeft = (label.categoryName === 'Left') !== mirrored;
    const key = isLeft ? 'left' : 'right';
    if (!best[key] || label.score > best[key].score) best[key] = { score: label.score, p: [round3(wrist.x), round3(wrist.y), round3(wrist.z)] };
  });
  return { left: best.left?.p, right: best.right?.p };
}

/**
 * Turns one frame of MediaPipe output into the compact record that gets stored.
 * With no face in the frame the head is [0, 0, 0] and `shapes` is empty; use `hasTrackedFace` to skip such frames.
 */
export function extractMotionFrame(
  faceResult: FaceLandmarkerResult,
  handResult: HandLandmarkerResult,
  timestampSec: number,
  options: ExtractOptions = {},
): MotionFrame {
  const matrix = faceResult.facialTransformationMatrixes[0];
  const shapes: Record<string, number> = {};
  for (const c of faceResult.faceBlendshapes[0]?.categories ?? []) {
    // Filter on the raw score so a value like 0.0099 is not rounded up past the floor.
    if (c.categoryName !== NEUTRAL_SHAPE && c.score >= SHAPE_FLOOR) shapes[c.categoryName] = round3(c.score);
  }
  const { left, right } = wristsFromHands(handResult, options.mirroredInput ?? false);
  const frame: MotionFrame = { t: round3(timestampSec), head: matrix ? headFromMatrix(matrix.data) : [...ZERO_HEAD], shapes };
  if (left) frame.leftHand = left;
  if (right) frame.rightHand = right;
  return frame;
}

/* ------------------------------------------------------------------ rig side */

export type ApplyOptions = {
  /** Fraction of the way to the new pose per call, 0..1. 1 snaps, ~0.5 smooths a 30 FPS stream. Default 0.5. */
  smoothing?: number;
  /** How far the wrist target may travel from rest, in the parent's units, for a hand crossing the whole image. */
  handRange?: { x: number; y: number; z: number };
};

const DEFAULT_SMOOTHING = 0.5;
const DEFAULT_HAND_RANGE = { x: 0.6, y: 0.5, z: 0.4 };

type Rest = { position: THREE.Vector3; quaternion: THREE.Quaternion };
type Rig = {
  meshes: THREE.Mesh[];
  head: THREE.Object3D | null;
  leftHand: THREE.Object3D | null;
  rightHand: THREE.Object3D | null;
  rest: Map<THREE.Object3D, Rest>;
  driven: Map<THREE.Mesh, Set<string>>; // morph targets we have touched, so they can fade back to 0 when no longer in a frame
};

const rigs = new WeakMap<THREE.Object3D, Rig>();

/** Bone names differ between exporters: `Head`, `mixamorigHead`, `mixamorig:Head`. */
const normaliseName = (name: string): string => name.replace(/^mixamorig:?/i, '').toLowerCase();

function findRig(root: THREE.Object3D): Rig {
  const cached = rigs.get(root);
  if (cached) return cached;
  const rig: Rig = { meshes: [], head: null, leftHand: null, rightHand: null, rest: new Map(), driven: new Map() };
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).morphTargetDictionary && (o as THREE.Mesh).morphTargetInfluences) rig.meshes.push(o as THREE.Mesh);
    const n = normaliseName(o.name);
    // `head`/`lefthand`/`righthand` match both bones and target groups; first match wins so hair/headband bones don't steal it.
    if (n === 'head' && !rig.head) rig.head = o;
    else if (n === 'lefthand' && !rig.leftHand) rig.leftHand = o;
    else if (n === 'righthand' && !rig.rightHand) rig.rightHand = o;
  });
  for (const o of [rig.head, rig.leftHand, rig.rightHand]) if (o) rig.rest.set(o, { position: o.position.clone(), quaternion: o.quaternion.clone() });
  rigs.set(root, rig);
  return rig;
}

/** Forget the cached bone and mesh lookup, for example after swapping the avatar's children. */
export function resetRigCache(root: THREE.Object3D): void {
  rigs.delete(root);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Eases the rig towards `frame`. Call it every render frame; it moves each value a fraction of the way
 * so jitter in the capture does not show. Missing shapes fade to 0 and missing hands return to rest.
 */
export function applyMotionFrameToRig(rootObject: THREE.Object3D, frame: MotionFrame, options: ApplyOptions = {}): void {
  const k = clamp01(options.smoothing ?? DEFAULT_SMOOTHING);
  const range = options.handRange ?? DEFAULT_HAND_RANGE;
  const rig = findRig(rootObject);

  // Face: drive every target in the frame, plus any we drove before that is now absent (it was below the floor).
  for (const mesh of rig.meshes) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences) continue;
    let driven = rig.driven.get(mesh);
    if (!driven) rig.driven.set(mesh, (driven = new Set()));
    for (const name of Object.keys(frame.shapes)) if (name in dict) driven.add(name);
    for (const name of driven) {
      const index = dict[name];
      influences[index] = THREE.MathUtils.lerp(influences[index], frame.shapes[name] ?? 0, k);
    }
  }

  // Head: the captured rotation is applied on top of the bone's own rest rotation.
  if (rig.head) {
    const rest = rig.rest.get(rig.head);
    if (rest) {
      const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(frame.head[0], frame.head[1], frame.head[2], 'YXZ'));
      rig.head.quaternion.slerp(rest.quaternion.clone().multiply(delta), k);
    }
  }

  // Hands: wrist offset from rest, from where the hand is in the image. A hand that left the frame eases back to rest.
  const moveHand = (obj: THREE.Object3D | null, p: [number, number, number] | undefined) => {
    const rest = obj && rig.rest.get(obj);
    if (!obj || !rest) return;
    const target = rest.position.clone();
    if (p) {
      target.x += (p[0] - 0.5) * range.x;
      target.y -= (p[1] - 0.5) * range.y; // image y runs down, scene y runs up
      target.z -= p[2] * range.z; // MediaPipe z shrinks as the hand nears the camera
    }
    obj.position.lerp(target, k);
  };
  moveHand(rig.leftHand, frame.leftHand);
  moveHand(rig.rightHand, frame.rightHand);
}
