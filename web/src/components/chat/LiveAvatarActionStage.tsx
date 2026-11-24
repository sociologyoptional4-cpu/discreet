'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { useRef, useState } from 'react';
import type { Group } from 'three';
import { Character } from '@/components/AvatarStage';
import type { AvatarAction } from '@/lib/chat/stickerRegistry';
import type { AvatarId, MotionFrame } from '@/types/avatar';

export const ACTION_SECONDS = 2.8;

export type StageEvent = { action: AvatarAction; fromSelf: boolean; key: number };

type Props = {
  me: AvatarId;
  other: AvatarId;
  event: StageEvent | null;
  /** In the hangout room both avatars stand on a pedestal and emote in place; otherwise the sender flies in and out. */
  room: boolean;
  tiltX: MotionValue<number>;
  tiltY: MotionValue<number>;
  className?: string;
};

const DUO: readonly AvatarAction[] = ['duo_dance', 'high_five'];
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The single shared WebGL canvas of a chat thread. Callers mount it only while an action plays or the room is open,
 * so between actions there is no canvas and no GPU work at all.
 */
export function LiveAvatarActionStage({ me, other, event, room, tiltX, tiltY, className = '' }: Props) {
  const [lost, setLost] = useState(false);
  const sender = event && !event.fromSelf ? other : me;
  const receiver = sender === me ? other : me;
  const duo = room || (event !== null && DUO.includes(event.action));
  return (
    <div className={className} aria-hidden>
      {!lost && (
        <Canvas dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }} camera={{ position: [0, 0.25, 3.1], fov: 38 }}
          style={{ position: 'absolute', inset: 0 }}
          onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setLost(true); })}>
          <ambientLight intensity={1.1} />
          <directionalLight position={[1.5, 2.5, 3]} intensity={2} />
          <directionalLight position={[-2, 1.5, -2]} intensity={1.6} color="#c4b5fd" />
          <ParallaxCamera tiltX={tiltX} tiltY={tiltY} />
          {room && <Pedestal />}
          <Rig avatarId={sender} slot={duo ? -1 : 0} event={event} room={room} lead />
          {duo && <Rig avatarId={receiver} slot={1} event={event} room={room} lead={false} />}
        </Canvas>
      )}
    </div>
  );
}

function ParallaxCamera({ tiltX, tiltY }: { tiltX: MotionValue<number>; tiltY: MotionValue<number> }) {
  useFrame(({ camera }) => {
    camera.position.x = tiltX.get() * 0.55;
    camera.position.y = 0.25 - tiltY.get() * 0.3;
    camera.lookAt(0, -0.05, 0);
  });
  return null;
}

function Pedestal() {
  return (
    <group position={[0, -0.98, 0]}>
      <mesh receiveShadow>
        <cylinderGeometry args={[1.25, 1.35, 0.14, 64]} />
        <meshPhysicalMaterial color="#efeaff" roughness={0.18} clearcoat={1} clearcoatRoughness={0.1} transmission={0.25} thickness={0.4} />
      </mesh>
      <mesh position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.18, 64]} />
        <meshBasicMaterial color="#a5f3fc" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

/** Moves one character with springy keyframes; the character itself idles (breathes, blinks) on a null frame. */
function Rig({ avatarId, slot, event, room, lead }: { avatarId: AvatarId; slot: -1 | 0 | 1; event: StageEvent | null; room: boolean; lead: boolean }) {
  const group = useRef<Group>(null);
  const idle = useRef<MotionFrame | null>(null);
  const started = useRef<{ key: number; at: number } | null>(null);
  const baseX = slot * 0.58;

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const now = clock.getElapsedTime();
    if (event && started.current?.key !== event.key) started.current = { key: event.key, at: now };
    const t = event && started.current ? now - started.current.at : Infinity;
    const playing = t < ACTION_SECONDS;
    let x = baseX, y = -0.1, z = 0, ry = slot * -0.25, rz = 0, s = room ? 0.82 : 0.9;

    if (!room) {
      // Fly in from far behind, hold for the gesture, then retreat.
      const inP = easeOut(clamp01(t / 0.7));
      const outP = clamp01((t - 2.15) / 0.65);
      z = -3 + inP * 3.4 - outP * 3.6;
      s *= 0.6 + inP * 0.4;
      if (!playing) z = -6;
    }
    if (playing && event) {
      const p = t - 0.6;
      switch (event.action) {
        case 'poke_knock': if (lead && p > 0) z += Math.max(0, Math.sin(p * 14)) * 0.35 * (p < 1 ? 1 : 0); break;
        case 'send_heart': y += Math.abs(Math.sin(t * 6)) * 0.12; ry += clamp01(p / 1.2) * Math.PI * 2; break;
        case 'duo_dance': y += Math.abs(Math.sin(t * 8)) * 0.12; rz = Math.sin(t * 8) * 0.18; ry += Math.sin(t * 4) * 0.4; break;
        case 'high_five': x = baseX * (1 - 0.35 * Math.sin(clamp01(p / 1.2) * Math.PI)); rz = -slot * 0.25 * Math.sin(clamp01(p / 1.2) * Math.PI); break;
        case 'wave': rz = Math.sin(t * 10) * 0.12; y += Math.abs(Math.sin(t * 5)) * 0.05; break;
        case 'chill': rz = Math.sin(t * 2) * 0.06; y -= 0.03 + Math.sin(t * 2) * 0.03; break;
      }
    }
    g.position.set(x, y, z);
    g.rotation.set(0, ry, rz);
    g.scale.setScalar(s);
  });

  return (
    <group ref={group} position={[baseX, -0.1, room ? 0 : -6]}>
      <Character avatarId={avatarId} currentFrameRef={idle} />
    </group>
  );
}
