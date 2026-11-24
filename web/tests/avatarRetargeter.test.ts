import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { FaceLandmarkerResult, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { applyMotionFrameToRig, extractMotionFrame, hasTrackedFace, resetRigCache } from '../src/lib/avatarRetargeter.ts';
import type { MotionFrame } from '../src/types/avatar.ts';

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const face = (categories: { categoryName: string; score: number }[], matrix?: number[]): FaceLandmarkerResult =>
  ({
    faceLandmarks: [[]],
    faceBlendshapes: categories.length ? [{ categories, headIndex: 0, headName: '' }] : [],
    facialTransformationMatrixes: matrix ? [{ rows: 4, columns: 4, data: matrix }] : [],
  }) as unknown as FaceLandmarkerResult;

const hands = (list: { label: 'Left' | 'Right'; score: number; x: number; y: number; z: number }[]): HandLandmarkerResult =>
  ({
    landmarks: list.map((h) => [{ x: h.x, y: h.y, z: h.z }]),
    worldLandmarks: [],
    handedness: list.map((h) => [{ categoryName: h.label, score: h.score, index: 0, displayName: '' }]),
    handednesses: [],
  }) as unknown as HandLandmarkerResult;

const noHands = hands([]);

test('blendshapes are rounded to 3 places, tiny ones and _neutral are dropped', () => {
  const f = extractMotionFrame(
    face([
      { categoryName: '_neutral', score: 0.9 },
      { categoryName: 'jawOpen', score: 0.123456 },
      { categoryName: 'mouthSmileLeft', score: 0.0099 },
      { categoryName: 'eyeBlinkLeft', score: 0.01 },
    ]),
    noHands,
    1.23456,
  );
  assert.deepEqual(f.shapes, { jawOpen: 0.123, eyeBlinkLeft: 0.01 });
  assert.equal(f.t, 1.235);
});

test('head angles are recovered from a scaled, translated face matrix', () => {
  const rot = new THREE.Euler(0.2, 0.4, -0.1, 'YXZ'); // pitch, yaw, roll
  const m = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, -30), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(12, 12, 12));
  const f = extractMotionFrame(face([{ categoryName: 'jawOpen', score: 0.5 }], Array.from(m.toArray())), noHands, 0);
  near(f.head[0], 0.2);
  near(f.head[1], 0.4);
  near(f.head[2], -0.1);
});

test('a frame with no face has a neutral head and no shapes', () => {
  const r = face([]);
  assert.equal(hasTrackedFace(r), false);
  const f = extractMotionFrame(r, noHands, 0);
  assert.deepEqual(f.head, [0, 0, 0]);
  assert.deepEqual(f.shapes, {});
});

test('wrists are assigned by label, the confident hand wins, and mirrored input swaps them', () => {
  const h = hands([
    { label: 'Left', score: 0.6, x: 0.1111, y: 0.2, z: -0.05 },
    { label: 'Left', score: 0.9, x: 0.8, y: 0.5, z: 0.01 },
    { label: 'Right', score: 0.8, x: 0.3, y: 0.4, z: 0 },
  ]);
  const f = extractMotionFrame(face([]), h, 0);
  assert.deepEqual(f.leftHand, [0.8, 0.5, 0.01]);
  assert.deepEqual(f.rightHand, [0.3, 0.4, 0]);
  const swapped = extractMotionFrame(face([]), h, 0, { mirroredInput: true });
  assert.deepEqual(swapped.rightHand, [0.8, 0.5, 0.01]);
  assert.deepEqual(swapped.leftHand, [0.3, 0.4, 0]);
  assert.equal('leftHand' in extractMotionFrame(face([]), noHands, 0), false);
});

/* ---- rig ---- */

function makeRig() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry());
  mesh.morphTargetDictionary = { jawOpen: 0, mouthSmileLeft: 1, customSmile: 2 };
  mesh.morphTargetInfluences = [0, 0, 0.7];
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  head.quaternion.setFromEuler(new THREE.Euler(0.3, 0, 0));
  const left = new THREE.Bone();
  left.name = 'mixamorig:LeftHand';
  left.position.set(0.5, 1, 0);
  const right = new THREE.Bone();
  right.name = 'RightHand';
  right.position.set(-0.5, 1, 0);
  hips.add(head, left, right);
  root.add(mesh, hips);
  return { root, mesh, head, left, right };
}

const frame = (over: Partial<MotionFrame>): MotionFrame => ({ t: 0, head: [0, 0, 0], shapes: {}, ...over });

test('shapes ease in, absent shapes fade out, unrelated morph targets are left alone', () => {
  const { root, mesh } = makeRig();
  applyMotionFrameToRig(root, frame({ shapes: { jawOpen: 1 } }), { smoothing: 1 });
  assert.equal(mesh.morphTargetInfluences?.[0], 1);
  applyMotionFrameToRig(root, frame({}), { smoothing: 0.5 }); // jawOpen no longer in the frame
  assert.equal(mesh.morphTargetInfluences?.[0], 0.5);
  applyMotionFrameToRig(root, frame({}), { smoothing: 0.5 });
  assert.equal(mesh.morphTargetInfluences?.[0], 0.25);
  assert.equal(mesh.morphTargetInfluences?.[2], 0.7); // never part of a frame, never touched
});

test('head rotation is applied on top of the bone rest pose, for mixamo-prefixed names too', () => {
  const { root, head } = makeRig();
  applyMotionFrameToRig(root, frame({ head: [0, 0.5, 0] }), { smoothing: 1 });
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0, 'YXZ')));
  assert.ok(head.quaternion.angleTo(expected) < 1e-6);
});

test('hands move from rest by where they are in the image and return to rest when they leave the frame', () => {
  const { root, left, right } = makeRig();
  applyMotionFrameToRig(root, frame({ leftHand: [1, 0.5, 0] }), { smoothing: 1, handRange: { x: 0.6, y: 0.5, z: 0.4 } });
  near(left.position.x, 0.5 + 0.3);
  near(left.position.y, 1);
  assert.deepEqual(right.position.toArray(), [-0.5, 1, 0]); // right hand was never in a frame: still at rest
  applyMotionFrameToRig(root, frame({}), { smoothing: 1 });
  near(left.position.x, 0.5);
});

test('smoothing moves part of the way and is clamped to 0..1', () => {
  const { root, mesh } = makeRig();
  applyMotionFrameToRig(root, frame({ shapes: { jawOpen: 1 } }), { smoothing: 5 }); // clamped to 1
  assert.equal(mesh.morphTargetInfluences?.[0], 1);
  applyMotionFrameToRig(root, frame({ shapes: { jawOpen: 0 } }), { smoothing: -2 }); // clamped to 0: no movement
  assert.equal(mesh.morphTargetInfluences?.[0], 1);
});

test('resetRigCache picks up bones added after the first call', () => {
  const { root } = makeRig();
  applyMotionFrameToRig(root, frame({}), { smoothing: 1 });
  const extra = new THREE.Mesh(new THREE.BoxGeometry());
  extra.morphTargetDictionary = { jawOpen: 0 };
  extra.morphTargetInfluences = [0];
  root.add(extra);
  applyMotionFrameToRig(root, frame({ shapes: { jawOpen: 1 } }), { smoothing: 1 });
  assert.equal(extra.morphTargetInfluences[0], 0); // stale cache ignores the new mesh
  resetRigCache(root);
  applyMotionFrameToRig(root, frame({ shapes: { jawOpen: 1 } }), { smoothing: 1 });
  assert.equal(extra.morphTargetInfluences[0], 1);
});
