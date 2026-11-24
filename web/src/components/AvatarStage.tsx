'use client';
import { Component, Suspense, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { applyMotionFrameToRig } from '@/lib/avatarRetargeter';
import { STUDIO_BACKDROP } from '@/lib/avatars';
import type { AvatarId, MotionFrame } from '@/types/avatar';

type Props = {
  avatarId: AvatarId;
  /**
   * The latest captured or played-back frame. Another part of the app writes it; this component only reads it inside
   * `useFrame`, so the animation never causes a React render.
   */
  currentFrameRef: RefObject<MotionFrame | null>;
};

type Theme = { skin: string; body: string; accent: string; rim: string };
const THEMES: Record<AvatarId, Theme> = {
  cyber_monk: { skin: '#d8ccff', body: '#241a45', accent: '#22d3ee', rim: '#22d3ee' },
  street_artist: { skin: '#ffc9a3', body: '#26262b', accent: '#ff3df0', rim: '#ff3df0' },
  cozy_bear: { skin: '#b07a4f', body: '#d97706', accent: '#f2c49b', rim: '#fbbf24' },
  neon_bot: { skin: '#7ef3ff', body: '#12202b', accent: '#39ff88', rim: '#39ff88' },
};

/** Frame-rate independent easing: about 0.3 per frame at 60 FPS, and the same speed at any other rate. */
const ease = (delta: number): number => 1 - Math.exp(-delta * 22);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

/* -------------------------------------------------------------- GLB path */

const missingGlb = new Set<AvatarId>(['cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot']); // use the procedural set; no GLB downloads or extra waiting states

class GlbBoundary extends Component<{ id: AvatarId; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    missingGlb.add(this.props.id);
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A rigged `.glb`, scaled to the frame and driven through the retargeter (ARKit morph targets, `Head`, hands). */
function GlbAvatar({ avatarId, currentFrameRef }: Props) {
  const { scene } = useGLTF(`/avatars/${avatarId}.glb`);
  const model = useMemo(() => {
    const copy = cloneRig(scene); // each stage gets its own skeleton, the cached original is never mutated
    const box = new THREE.Box3().setFromObject(copy);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const scale = 1.3 / Math.max(size.y, 0.001);
    copy.scale.setScalar(scale);
    copy.position.set(-centre.x * scale, -centre.y * scale + 0.05, -centre.z * scale);
    return copy;
  }, [scene]);

  useFrame((_, delta) => {
    const frame = currentFrameRef.current;
    if (frame) applyMotionFrameToRig(model, frame, { smoothing: ease(delta) });
  });
  return <primitive object={model} />;
}

const GAME4_NODE: Record<AvatarId, string> = {
  cyber_monk: 'Character_Instance_3',
  street_artist: 'Character_Instance_2',
  cozy_bear: 'Character_Instance',
  neon_bot: 'Character',
};

function Game4Avatar({ avatarId, currentFrameRef }: Props) {
  const { scene } = useGLTF('/models/game4/character_pack.glb');
  const modelRef = useRef<THREE.Object3D>(null);
  const source = scene.getObjectByName(GAME4_NODE[avatarId]);
  const model = useMemo(() => {
    if (!source) return null;
    const copy = cloneRig(source);
    copy.position.set(0, 0, 0); // drop its spot in the pack, or the centring below aims at the wrong place
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const scale = 1.3 / Math.max(size.y, 0.001);
    copy.scale.setScalar(scale);
    copy.position.set(-centre.x * scale, -box.min.y * scale - 0.45, -centre.z * scale);
    return copy;
  }, [source]);
  useFrame((_, delta) => {
    const frame = currentFrameRef.current;
    const renderedModel = modelRef.current;
    if (!renderedModel || !frame) return;
    renderedModel.rotation.x = THREE.MathUtils.damp(renderedModel.rotation.x, frame.head[0] * 0.45, 8, delta);
    renderedModel.rotation.y = THREE.MathUtils.damp(renderedModel.rotation.y, frame.head[1] * 0.7, 8, delta);
    renderedModel.rotation.z = THREE.MathUtils.damp(renderedModel.rotation.z, frame.head[2] * 0.45, 8, delta);
  });
  return model ? <primitive ref={modelRef} object={model} /> : null;
}

/* ------------------------------------------------------ procedural avatar */

const Material = ({ color, glow = 0, opacity = 1, roughness = 0.6, clearcoat = 0.25 }: { color: string; glow?: number; opacity?: number; roughness?: number; clearcoat?: number }) => (
  <meshPhysicalMaterial color={color} emissive={glow ? color : '#000000'} emissiveIntensity={glow} roughness={roughness} metalness={0.06} clearcoat={clearcoat} clearcoatRoughness={0.24} transparent={opacity < 1} opacity={opacity} />
);

const HAND_REST = { x: 0.3, y: -0.12, z: 0.22 };
const HAND_X_LIMIT = 0.43; // keeps floating hands inside a 9:16 frame at this camera distance

/**
 * Stand-in character built from primitives. It reads the same frame as a real rig and moves its parts directly:
 * head rotation, blinking, brows, jaw and mouth, and two floating hands.
 */
export function ProceduralAvatar({ avatarId, currentFrameRef }: Props) {
  const theme = THEMES[avatarId];
  const head = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const chin = useRef<THREE.Mesh>(null);
  const opening = useRef<THREE.Mesh>(null);
  const cornerL = useRef<THREE.Mesh>(null);
  const cornerR = useRef<THREE.Mesh>(null);
  const handL = useRef<THREE.Group>(null); // the avatar's left hand is on the viewer's right
  const handR = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const nextBlink = useRef(3.4); // first idle blink; later ones are rescheduled 3–5 s apart at random

  useFrame(({ clock, pointer }, delta) => {
    const frame = currentFrameRef.current;
    const k = ease(delta);
    const shape = (name: string): number => frame?.shapes[name] ?? 0;
    const to = (current: number, target: number): number => lerp(current, target, k);

    if (head.current) {
      head.current.rotation.order = 'YXZ';
      head.current.rotation.x = to(head.current.rotation.x, frame?.head[0] ?? 0);
      head.current.rotation.y = to(head.current.rotation.y, frame?.head[1] ?? 0);
      head.current.rotation.z = to(head.current.rotation.z, frame?.head[2] ?? 0);
    }
    // Eyes squash flat to blink and widen a little; brows lift with browInnerUp and drop with browDown.
    for (const [eye, side] of [[eyeL, 'Left'], [eyeR, 'Right']] as const) {
      if (eye.current) eye.current.scale.y = to(eye.current.scale.y, 1 - shape(`eyeBlink${side}`) * 0.92 + shape(`eyeWide${side}`) * 0.25);
    }
    for (const [brow, side] of [[browL, 'Left'], [browR, 'Right']] as const) {
      if (!brow.current) continue;
      const lift = shape('browInnerUp') * 0.04 + shape(`browOuterUp${side}`) * 0.03 - shape(`browDown${side}`) * 0.04;
      brow.current.position.y = to(brow.current.position.y, 0.115 + lift);
      brow.current.rotation.z = to(brow.current.rotation.z, (side === 'Left' ? -1 : 1) * (shape(`browDown${side}`) - shape('browInnerUp')) * 0.35);
    }
    // Jaw drops, the mouth opening grows, the corners rise with a smile and pull in with a pucker.
    const jawOpen = shape('jawOpen');
    const pucker = shape('mouthPucker');
    if (chin.current) chin.current.position.y = to(chin.current.position.y, -0.05 - jawOpen * 0.075);
    if (opening.current) {
      const smile = (shape('mouthSmileLeft') + shape('mouthSmileRight')) / 2;
      opening.current.scale.y = to(opening.current.scale.y, 0.08 + jawOpen * 0.5);
      opening.current.scale.x = to(opening.current.scale.x, 0.5 * (1 + smile * 0.35 - pucker * 0.4));
    }
    if (cornerL.current) cornerL.current.position.y = to(cornerL.current.position.y, shape('mouthSmileLeft') * 0.035);
    if (cornerR.current) cornerR.current.position.y = to(cornerR.current.position.y, shape('mouthSmileRight') * 0.035);

    // Hands float with a gentle bob and follow the wrist; a hand that leaves the frame eases back to rest.
    const t = clock.elapsedTime;
    if (root.current) {
      root.current.position.y = Math.sin(t * 1.15) * 0.018;
      root.current.rotation.y = to(root.current.rotation.y, pointer.x * 0.055);
      root.current.rotation.x = to(root.current.rotation.x, -pointer.y * 0.025);
    }
    if (t > nextBlink.current + 0.25) nextBlink.current = t + 3 + Math.random() * 2;
    const blink = Math.max(0, 1 - Math.abs(t - nextBlink.current - 0.1) / 0.1);
    if (!frame) for (const eye of [eyeL, eyeR]) if (eye.current) eye.current.scale.y = to(eye.current.scale.y, 1 - blink * 0.9);
    for (const [hand, p, side, phase] of [[handL, frame?.leftHand, 1, 0], [handR, frame?.rightHand, -1, 1.7]] as const) {
      const g = hand.current;
      if (!g) continue;
      const x = side * HAND_REST.x + (p ? (p[0] - 0.5) * 0.5 : 0);
      const y = HAND_REST.y + (p ? -(p[1] - 0.5) * 0.6 : 0) + Math.sin(t * 1.6 + phase) * 0.008;
      g.position.x = to(g.position.x, clamp(x, -HAND_X_LIMIT, HAND_X_LIMIT));
      g.position.y = to(g.position.y, clamp(y, -0.5, 0.55));
      g.position.z = to(g.position.z, HAND_REST.z);
    }
  });

  const robot = avatarId === 'neon_bot';
  return (
    <group ref={root}>
      {/* body */}
      <mesh position={[0, -0.42, 0]}>
        <capsuleGeometry args={[0.2, 0.3, 8, 16]} />
        <Material color={theme.body} />
      </mesh>
      {avatarId === 'cozy_bear' && (
        <mesh position={[0, -0.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.15, 0.05, 12, 24]} />
          <Material color="#b45309" />
        </mesh>
      )}

      <group ref={head} position={[0, 0.22, 0]}>
        {robot ? (
          <mesh>
            <boxGeometry args={[0.5, 0.46, 0.46, 3, 3, 3]} />
            <Material color={theme.skin} glow={0.25} />
          </mesh>
        ) : (
          <mesh scale={[1, 1.05, 1]}>
            <sphereGeometry args={[0.27, 32, 24]} />
            <Material color={theme.skin} roughness={0.75} clearcoat={0.08} />
          </mesh>
        )}

        {/* eyes: bot has LED eyes, everyone else white eyeballs with pupils */}
        {([[eyeL, 1], [eyeR, -1]] as const).map(([ref, side]) => (
          <mesh key={side} ref={ref} position={[side * 0.095, 0.04, 0.22]}>
            {robot ? <boxGeometry args={[0.07, 0.06, 0.03]} /> : <sphereGeometry args={[0.04, 16, 12]} />}
            {robot ? <Material color={theme.accent} glow={2.2} roughness={0.2} clearcoat={0.9} /> : <Material color="#ffffff" roughness={0.2} clearcoat={0.9} />}
            {!robot && (
              <mesh position={[0, 0, 0.03]}>
                <sphereGeometry args={[0.019, 12, 8]} />
                <Material color="#111111" />
              </mesh>
            )}
          </mesh>
        ))}
        <mesh ref={browL} position={[0.095, 0.115, 0.235]}>
          <boxGeometry args={[0.09, 0.016, 0.016]} />
          <Material color={robot ? theme.accent : '#2a1a12'} glow={robot ? 1.2 : 0} />
        </mesh>
        <mesh ref={browR} position={[-0.095, 0.115, 0.235]}>
          <boxGeometry args={[0.09, 0.016, 0.016]} />
          <Material color={robot ? theme.accent : '#2a1a12'} glow={robot ? 1.2 : 0} />
        </mesh>
        <mesh position={[0, -0.02, 0.265]}>
          <sphereGeometry args={[0.024, 12, 8]} />
          <Material color={theme.accent} />
        </mesh>

        {/* mouth: dark opening, a chin that drops with the jaw, and two corners that rise with a smile */}
        <group position={[0, -0.1, 0.225]}>
          <mesh ref={opening} scale={[0.5, 0.08, 0.2]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <Material color="#2a0710" />
          </mesh>
          <mesh ref={chin} position={[0, -0.05, -0.02]} scale={[1, 0.55, 0.85]}>
            <sphereGeometry args={[0.075, 16, 12]} />
            <Material color={theme.skin} glow={robot ? 0.25 : 0} />
          </mesh>
          <mesh ref={cornerL} position={[0.06, 0, 0.005]}>
            <sphereGeometry args={[0.011, 8, 6]} />
            <Material color="#2a0710" />
          </mesh>
          <mesh ref={cornerR} position={[-0.06, 0, 0.005]}>
            <sphereGeometry args={[0.011, 8, 6]} />
            <Material color="#2a0710" />
          </mesh>
        </group>

        {avatarId === 'cyber_monk' && <MonkGear accent={theme.accent} hood={theme.body} />}
        {avatarId === 'street_artist' && <ArtistGear accent={theme.accent} />}
        {avatarId === 'cozy_bear' && <BearGear skin={theme.skin} inner={theme.accent} />}
        {robot && <BotGear accent={theme.accent} />}
      </group>

      {([[handL, 1], [handR, -1]] as const).map(([ref, side]) => (
        <group key={side} ref={ref} position={[side * HAND_REST.x, HAND_REST.y, HAND_REST.z]}>
          <mesh>
            <sphereGeometry args={[0.05, 16, 12]} />
            <Material color={theme.accent} glow={0.3} />
          </mesh>
          <mesh position={[side * 0.045, 0.025, 0.01]}>
            <sphereGeometry args={[0.022, 10, 8]} />
            <Material color={theme.accent} glow={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Hood with an open front and a glowing cyan visor across the eyes. */
function MonkGear({ accent, hood }: { accent: string; hood: string }) {
  return (
    <>
      <mesh position={[0, 0.02, -0.01]} rotation={[-0.2, 0, 0]}>
        <sphereGeometry args={[0.3, 32, 24, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.72]} />
        <meshStandardMaterial color={hood} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.04, 0.245]}>
        <boxGeometry args={[0.4, 0.075, 0.045]} />
        <Material color={accent} glow={1.6} opacity={0.6} />
      </mesh>
    </>
  );
}

/** Tilted cap and neon headphones. */
function ArtistGear({ accent }: { accent: string }) {
  return (
    <>
      <group position={[0, 0.1, 0]} rotation={[0, 0, 0.2]}>
        <mesh>
          <sphereGeometry args={[0.285, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Material color="#ff7a1a" />
        </mesh>
        <mesh position={[0, 0.0, 0.22]} rotation={[0, Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.02, 24, 1, false, 0, Math.PI]} />
          <Material color="#ff7a1a" />
        </mesh>
      </group>
      <mesh position={[0, 0.03, 0]}>
        <torusGeometry args={[0.31, 0.012, 8, 32, Math.PI]} />
        <Material color={accent} glow={1.5} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[side * 0.3, 0.03, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.05, 20]} />
          <Material color={accent} glow={1.2} />
        </mesh>
      ))}
    </>
  );
}

/** Round ears and a soft muzzle. */
function BearGear({ skin, inner }: { skin: string; inner: string }) {
  return (
    <>
      {[1, -1].map((side) => (
        <mesh key={side} position={[side * 0.2, 0.25, 0]}>
          <sphereGeometry args={[0.085, 16, 12]} />
          <Material color={skin} />
          <mesh position={[0, 0, 0.05]}>
            <sphereGeometry args={[0.045, 12, 8]} />
            <Material color={inner} />
          </mesh>
        </mesh>
      ))}
      <mesh position={[0, -0.06, 0.2]} scale={[1.15, 0.8, 0.7]}>
        <sphereGeometry args={[0.1, 20, 14]} />
        <Material color={inner} />
      </mesh>
    </>
  );
}

/** A holographic antenna: a mast, a glowing tip and a translucent cone of light above it. */
function BotGear({ accent }: { accent: string }) {
  return (
    <>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
        <Material color={accent} />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.025, 12, 8]} />
        <Material color={accent} glow={2.5} />
      </mesh>
      <mesh position={[0, 0.47, 0]}>
        <coneGeometry args={[0.07, 0.14, 16, 1, true]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.5} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------ stage */

/** Backs the camera off on frames narrower than 9:16, so the character and its hands are not cropped at the sides. */
function FitCamera() {
  useFrame(({ camera, size }) => {
    const target = 2.4 * Math.max(1, 0.5625 / (size.width / size.height));
    if (Math.abs(camera.position.z - target) > 0.001) camera.position.z = target;
  });
  return null;
}

function Character(props: Props) {
  const stand = <ProceduralAvatar {...props} />;
  return (
    <GlbBoundary key={props.avatarId} id={props.avatarId} fallback={stand}>
      <Suspense fallback={null}>
        <Game4Avatar {...props} />
      </Suspense>
    </GlbBoundary>
  );
}

/**
 * The one and only WebGL canvas. By default it is a 9:16 frame; with `fill` it fills its parent instead (the feed card
 * decides the shape). Mount a single AvatarStage at a time: browsers allow only a handful of WebGL contexts.
 * The canvas is transparent over a muted studio gradient chosen by character.
 */
export function AvatarStage({ avatarId, currentFrameRef, fill = false }: Props & { fill?: boolean }) {
  return (
    <div className={`relative overflow-hidden ${fill ? 'size-full' : 'aspect-[9/16] w-full'}`} style={{ background: STUDIO_BACKDROP[avatarId] }}>
      <Canvas dpr={[1, 2]} gl={{ alpha: true }} camera={{ position: [0, 0.2, 2.4], fov: 38 }} style={{ position: 'absolute', inset: 0 }} aria-label="3D avatar">
        <FitCamera />
        <ambientLight intensity={1.0} />
        <directionalLight position={[1.5, 2.5, 3]} intensity={2.2} />
        <directionalLight position={[-2, 1.2, -2]} intensity={3} color={THEMES[avatarId].rim} />
        <Character avatarId={avatarId} currentFrameRef={currentFrameRef} />
      </Canvas>
    </div>
  );
}
