'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { motion, useReducedMotion } from 'framer-motion';
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type * as THREE from 'three';
import { GLBMotionAvatar } from '@/components/playable/GLBMotionAvatar';
import { decodeMotionTrack, type DecodedMotionTrack } from '@/lib/motion/motionCodec';
import type { PlayableAvatarConfig, PlayableFontStyle, PlayableScenePreset, PlayableSceneRecipe } from '@/types/playable';

type Props = { recipe: PlayableSceneRecipe; isActive: boolean; isMuted: boolean };

class AvatarErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? (this.props.fallback ?? null) : this.props.children;
  }
}

const LOOK_AT_Y = 1.1;
const PARTICLES = 180;

/** Deterministic pseudo-random numbers, so a scene looks the same on every render and nothing impure runs in render. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeParticles(seed: number): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) {
    out[i * 3] = (random() - 0.5) * 14;
    out[i * 3 + 1] = random() * 10;
    out[i * 3 + 2] = (random() - 0.5) * 14;
  }
  return out;
}

/** Slowly circles the camera around the scene until the viewer takes over with Explore 3D (OrbitControls then mounts). */
function AutoOrbit({ speed }: { speed: number }) {
  useFrame(({ camera }, delta) => {
    const { x, y, z } = camera.position;
    const radius = Math.hypot(x, z);
    const angle = Math.atan2(x, z) + delta * speed * 0.35;
    camera.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    camera.lookAt(0, LOOK_AT_Y, 0);
  });
  return null;
}

function PlayableAvatar({ config }: { config: PlayableAvatarConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.elapsedTime;
    const baseY = config.position[1] + (config.animation === 'sit' ? -0.35 : 0);
    if (config.animation === 'dance') {
      group.position.y = baseY + Math.abs(Math.sin(t * 4.5)) * 0.18;
      group.rotation.y = Math.sin(t * 2.2) * 0.35;
    } else if (config.animation === 'wave') {
      group.position.y = baseY + Math.sin(t * 2.5) * 0.05;
      if (rightArmRef.current) rightArmRef.current.rotation.z = 2.4 + Math.sin(t * 7) * 0.45;
    } else {
      group.position.y = baseY + Math.sin(t * (config.animation === 'sit' ? 1.5 : 2)) * (config.animation === 'sit' ? 0.02 : 0.06);
    }
  });

  return (
    <group ref={groupRef} position={config.position}>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.28, 0.55, 8, 16]} />
        <meshStandardMaterial color={config.primaryColor} roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.62, 0]}>
        <sphereGeometry args={[0.26, 20, 20]} />
        <meshStandardMaterial color="#fde68a" roughness={0.4} />
      </mesh>
      {[-0.09, 0.09].map((x) => (
        <mesh key={x} position={[x, 1.66, 0.22]}>
          <sphereGeometry args={[0.032, 10, 10]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
      ))}
      <mesh position={[-0.42, 0.95, 0]} rotation={[0, 0, 0.25]}>
        <capsuleGeometry args={[0.08, 0.38, 6, 12]} />
        <meshStandardMaterial color={config.primaryColor} roughness={0.4} />
      </mesh>
      <mesh ref={rightArmRef} position={[0.42, 0.95, 0]} rotation={[0, 0, -0.25]}>
        <capsuleGeometry args={[0.08, 0.38, 6, 12]} />
        <meshStandardMaterial color={config.primaryColor} roughness={0.4} />
      </mesh>
    </group>
  );
}

const CLOUDS: readonly [number, number, number, number][] = [
  [0, -0.2, 0, 1.8], [-1.3, -0.35, 0.4, 1.2], [1.3, -0.35, -0.3, 1.3], [-3.2, 1.8, -4, 1.4], [3.5, 2.4, -5, 1.6],
];
const SKYLINE: readonly number[] = [-5, -3, -1.5, 2, 4.5];

function Particles({ positions, color, size, pointsRef }: { positions: Float32Array; color: string; size: number; pointsRef?: React.RefObject<THREE.Points | null> }) {
  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={size} color={color} transparent opacity={0.8} />
    </points>
  );
}

function SceneEnvironment({ preset, accentColor }: { preset: PlayableScenePreset; accentColor: string }) {
  const rainRef = useRef<THREE.Points>(null);
  const emberRef = useRef<THREE.Points>(null);
  const fireLightRef = useRef<THREE.PointLight>(null);
  const particles = useMemo(() => makeParticles(preset.length * 7919), [preset]);

  useFrame(({ clock }, delta) => {
    const moving = preset === 'neon_rain' ? rainRef.current : preset === 'cozy_campfire' ? emberRef.current : null;
    if (moving) {
      const position = moving.geometry.attributes.position as THREE.BufferAttribute;
      const fall = preset === 'neon_rain';
      for (let i = 0; i < position.count; i++) {
        let y = position.getY(i) + (fall ? -delta * 8 : delta * 1.1);
        if (fall && y < 0) y = 10;
        if (!fall && y > 5) y = 0.2;
        position.setY(i, y);
      }
      position.needsUpdate = true;
    }
    if (fireLightRef.current) fireLightRef.current.intensity = 2.4 + Math.sin(clock.elapsedTime * 12) * 0.4;
  });

  if (preset === 'midnight_rooftop') {
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[6, 32]} /><meshStandardMaterial color="#0f172a" roughness={0.85} /></mesh>
        <mesh position={[3, 5.5, -8]}><sphereGeometry args={[1.1, 24, 24]} /><meshBasicMaterial color="#e0e7ff" /></mesh>
        {SKYLINE.map((x, i) => (
          <mesh key={x} position={[x, 1.5 + (i % 3), -7]}>
            <boxGeometry args={[1.2, 3 + (i % 3) * 1.5, 1.2]} />
            <meshStandardMaterial color="#1e1b4b" roughness={0.9} />
          </mesh>
        ))}
        <Particles positions={particles} color="#c7d2fe" size={0.07} />
      </group>
    );
  }
  if (preset === 'neon_rain') {
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[24, 24]} /><meshStandardMaterial color="#020617" roughness={0.15} metalness={0.8} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[1.6, 1.72, 48]} /><meshBasicMaterial color={accentColor} /></mesh>
        <Particles positions={particles} color={accentColor} size={0.09} pointsRef={rainRef} />
      </group>
    );
  }
  if (preset === 'pastel_clouds') {
    return (
      <group>
        {CLOUDS.map(([x, y, z, r]) => (
          <mesh key={`${x}${y}${z}`} position={[x, y, z]}><sphereGeometry args={[r, 18, 18]} /><meshStandardMaterial color="#fff1f2" roughness={0.9} /></mesh>
        ))}
      </group>
    );
  }
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[6.5, 32]} /><meshStandardMaterial color="#1c1917" roughness={0.95} /></mesh>
      <mesh position={[0.4, 0.25, 0.2]}><coneGeometry args={[0.35, 0.7, 8]} /><meshBasicMaterial color="#fb923c" /></mesh>
      <pointLight ref={fireLightRef} position={[0.4, 0.9, 0.2]} color="#fb923c" distance={9} intensity={2.5} />
      <Particles positions={particles} color="#fdba74" size={0.07} pointsRef={emberRef} />
    </group>
  );
}

const PRESET_BG: Record<PlayableScenePreset, string> = {
  midnight_rooftop: 'from-slate-950 via-indigo-950 to-slate-900',
  neon_rain: 'from-slate-950 via-cyan-950 to-slate-950',
  pastel_clouds: 'from-rose-200 via-pink-200 to-indigo-200',
  cozy_campfire: 'from-stone-950 via-orange-950/60 to-stone-950',
};
const FONT_CLASS: Record<PlayableFontStyle, string> = { serif: 'font-serif', sans: 'font-sans', mono: 'font-mono' };

/**
 * One interactive 3D mini-world. Mount it only for the active feed slide: phones allow very few WebGL contexts, and
 * R3F releases the context when this unmounts. Scrolling stays vertical until the viewer taps Explore 3D.
 */
export default function PlayableSceneCanvas({ recipe, isActive, isMuted }: Props) {
  const reduceMotion = useReducedMotion();
  const [exploring, setExploring] = useState(false);
  const [motionTrack, setMotionTrack] = useState<DecodedMotionTrack | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { camera, lighting, avatar, avatarGlbUrl, motionTrackUrl, textOverlay, scenePreset, audioUrl } = recipe;

  useEffect(() => {
    if (!motionTrackUrl) return;
    const ctrl = new AbortController();
    fetch(motionTrackUrl, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('Failed to load .vmt track'))))
      .then((buf) => decodeMotionTrack(new Uint8Array(buf)))
      .then((decoded) => {
        if (!ctrl.signal.aborted) setMotionTrack(decoded);
      })
      .catch(() => {});
    return () => {
      ctrl.abort();
      setMotionTrack(null);
    };
  }, [motionTrackUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.muted = isMuted;
    if (isActive) audio.play().catch(() => {});
    else audio.pause();
  }, [isActive, isMuted, audioUrl]);

  // While exploring, the card must not read drags and taps as pause, like or long-press "not interested".
  const contain = (event: { stopPropagation: () => void }) => { if (exploring) event.stopPropagation(); };

  return (
    <div
      className={`relative size-full overflow-hidden bg-gradient-to-b ${PRESET_BG[scenePreset]}`}
      style={{ touchAction: exploring ? 'none' : 'pan-y' }}
      onPointerDown={contain} onPointerUp={contain} onClick={contain} onDoubleClick={contain}
      data-playable-scene={scenePreset}
    >
      {audioUrl && <audio ref={audioRef} src={audioUrl} loop playsInline crossOrigin="anonymous" />}

      <Canvas dpr={[1, 1.5]} camera={{ fov: camera.fov, position: camera.initialPos, near: 0.1, far: 60 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
        <fogExp2 attach="fog" args={[lighting.ambientColor, lighting.fogDensity]} />
        <ambientLight color={lighting.ambientColor} intensity={lighting.intensity} />
        <directionalLight position={[4, 8, 5]} color={lighting.accentColor} intensity={1.4} />
        <SceneEnvironment preset={scenePreset} accentColor={lighting.accentColor} />
        {avatarGlbUrl && motionTrack ? (
          <AvatarErrorBoundary fallback={avatar ? <PlayableAvatar config={avatar} /> : null}>
            <Suspense fallback={null}>
              <GLBMotionAvatar
                glbUrl={avatarGlbUrl}
                track={motionTrack}
                audioRef={audioRef}
                isActive={isActive}
                position={avatar?.position ?? [0, -1.25, 0]}
              />
            </Suspense>
          </AvatarErrorBoundary>
        ) : (
          avatar && <PlayableAvatar config={avatar} />
        )}
        {exploring
          ? <OrbitControls enableZoom={false} enablePan={false} target={[0, LOOK_AT_Y, 0]} minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2.05} />
          : <AutoOrbit speed={reduceMotion ? 0 : camera.autoOrbitSpeed} />}
      </Canvas>

      {textOverlay && (
        <div className="pointer-events-none absolute inset-x-6 bottom-28 z-10 flex flex-col items-center text-center">
          {textOverlay.lines.map((line) => (
            <p key={line} className={`${FONT_CLASS[textOverlay.fontStyle]} text-lg font-medium leading-relaxed tracking-wide`}
              style={{ color: textOverlay.color, textShadow: textOverlay.glow ? `0 0 18px ${lighting.accentColor}` : '0 2px 8px rgba(0,0,0,.45)' }}>
              {line}
            </p>
          ))}
        </div>
      )}

      {!exploring && (
        <motion.p aria-hidden className="pointer-events-none absolute bottom-[4.25rem] left-4 z-20 rounded-full border border-white/20 bg-black/35 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md"
          initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: 3.5, times: [0, 0.8, 1] }}>
          Tap Explore 3D to look around
        </motion.p>
      )}
      <button type="button" aria-pressed={exploring}
        onClick={(event) => { event.stopPropagation(); setExploring((on) => !on); navigator.vibrate?.(12); }}
        onPointerDown={(event) => event.stopPropagation()}
        className={`absolute bottom-6 left-4 z-20 min-h-9 rounded-full border px-3.5 text-xs font-semibold backdrop-blur-md transition focus-visible:outline-2 focus-visible:outline-white ${exploring ? 'border-white/60 bg-white text-slate-950 shadow-lg' : 'border-white/25 bg-black/35 text-white hover:bg-black/50'}`}>
        {exploring ? 'Exit 3D' : 'Explore 3D'}
      </button>
    </div>
  );
}
