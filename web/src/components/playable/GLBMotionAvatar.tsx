'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  ARKIT_52_COUNT,
  ARKIT_52_INDEX,
  EYE_BLINK_LEFT_INDEX,
  EYE_BLINK_RIGHT_INDEX,
} from '@/lib/motion/arkit52';
import {
  createEmaSmoothingState,
  sampleMotionFrame,
  type DecodedMotionTrack,
} from '@/lib/motion/motionCodec';

interface MorphBinding {
  influences: number[];
  morphIdx: number;
  arkitIdx: number;
}

interface HeadBoneBinding {
  bone: THREE.Object3D;
  restX: number;
  restY: number;
  restZ: number;
}

export interface GLBMotionAvatarProps {
  /** URL to any readymade ARKit/RPM/Mixamo `.glb` avatar. */
  glbUrl: string;
  /** Decoded `VMT1` motion track driving the avatar. */
  track: DecodedMotionTrack | null;
  /** Master audio ref; `audioRef.current.currentTime` drives lip-sync with zero drift. */
  audioRef?: RefObject<HTMLAudioElement | null>;
  /** Direct audio element alternative. */
  audioElement?: HTMLAudioElement | null;
  /** Active/playing state for fallback clock and micro-idle breathing. */
  isActive?: boolean;
  position?: [number, number, number];
  scale?: number;
}

const HEAD_BONE_PATTERN = /(^|:|_)(head|j_bip_c_head)$/i;
const NECK_BONE_PATTERN = /(^|:|_)(neck|j_bip_c_neck)$/i;

/**
 * Drives any readymade `.glb` avatar from a decoded `VMT1` motion track,
 * cloning via `SkeletonUtils.clone` to preserve `SkinnedMesh` bone bindings,
 * auto-binding ARKit morph targets + head bone once, and adding subtle idle breathing.
 */
export function GLBMotionAvatar({
  glbUrl,
  track,
  audioRef,
  audioElement,
  isActive = true,
  position = [0, -1.25, 0],
  scale = 1.25,
}: GLBMotionAvatarProps) {
  const gltf = useGLTF(glbUrl);
  const scene = useMemo(() => cloneSkeleton(gltf.scene), [gltf.scene]);

  const morphBindingsRef = useRef<MorphBinding[]>([]);
  const headBoneRef = useRef<HeadBoneBinding | null>(null);
  const smoothingRef = useRef(createEmaSmoothingState());
  const weightsBufRef = useRef(new Float32Array(ARKIT_52_COUNT));
  const headEulerRef = useRef<[number, number, number]>([0, 0, 0]);
  const fallbackClockRef = useRef(0);

  useEffect(() => {
    const foundBindings: MorphBinding[] = [];
    let headCandidate: THREE.Object3D | null = null;
    let neckCandidate: THREE.Object3D | null = null;

    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        for (const [key, morphIdx] of Object.entries(obj.morphTargetDictionary)) {
          const arkitIdx = ARKIT_52_INDEX.get(key);
          if (arkitIdx !== undefined && morphIdx !== undefined) {
            foundBindings.push({
              influences: obj.morphTargetInfluences,
              morphIdx,
              arkitIdx,
            });
          }
        }
      }
      if (!headCandidate && HEAD_BONE_PATTERN.test(obj.name)) {
        headCandidate = obj;
      } else if (!neckCandidate && NECK_BONE_PATTERN.test(obj.name)) {
        neckCandidate = obj;
      }
    });

    const chosen = (headCandidate ?? neckCandidate) as THREE.Object3D | null;
    morphBindingsRef.current = foundBindings;
    headBoneRef.current = chosen
      ? {
          bone: chosen,
          restX: chosen.rotation.x,
          restY: chosen.rotation.y,
          restZ: chosen.rotation.z,
        }
      : null;
    smoothingRef.current.initialized = false;
    fallbackClockRef.current = 0;
  }, [scene, track, isActive]);

  useFrame(({ clock }, delta) => {
    const head = headBoneRef.current;
    if (!track || track.frameCount === 0) {
      // Micro-idle breathing when no track is loaded
      if (head) {
        const t = clock.elapsedTime;
        head.bone.rotation.set(
          head.restX + Math.sin(t * 1.5) * 0.025,
          head.restY + Math.sin(t * 0.9) * 0.03,
          head.restZ,
        );
      }
      return;
    }

    const audio = audioRef?.current ?? audioElement ?? null;
    let timeSec = 0;
    if (audio && !audio.paused && Number.isFinite(audio.currentTime)) {
      timeSec = audio.currentTime;
    } else if (isActive) {
      const durationSec = track.frameCount / Math.max(1, track.fps);
      fallbackClockRef.current = (fallbackClockRef.current + delta) % Math.max(0.1, durationSec);
      timeSec = fallbackClockRef.current;
    } else {
      // Subtle micro-idle breathing while paused
      if (head) {
        const t = clock.elapsedTime;
        head.bone.rotation.set(
          head.restX + Math.sin(t * 1.4) * 0.02,
          head.restY + Math.sin(t * 0.8) * 0.025,
          head.restZ,
        );
      }
      return;
    }

    const weights = weightsBufRef.current;
    const euler = headEulerRef.current;
    sampleMotionFrame(track, timeSec, weights, euler, smoothingRef.current);

    // Blink symmetry guard: softly blend slight left/right blink sensor differences
    const blinkL = weights[EYE_BLINK_LEFT_INDEX];
    const blinkR = weights[EYE_BLINK_RIGHT_INDEX];
    if (Math.abs(blinkL - blinkR) < 0.2) {
      const avgBlink = (blinkL + blinkR) * 0.5;
      weights[EYE_BLINK_LEFT_INDEX] = avgBlink;
      weights[EYE_BLINK_RIGHT_INDEX] = avgBlink;
    }

    const bindings = morphBindingsRef.current;
    for (let i = 0; i < bindings.length; i += 1) {
      const b = bindings[i];
      b.influences[b.morphIdx] = weights[b.arkitIdx];
    }

    if (head) {
      head.bone.rotation.set(
        head.restX + euler[0] * 0.85,
        head.restY + euler[1] * 0.85,
        head.restZ + euler[2] * 0.7,
      );
    }
  });

  return <primitive object={scene} position={position} scale={scale} />;
}
