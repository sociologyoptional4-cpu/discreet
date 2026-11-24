'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { REACTION_EMOJIS } from '@/lib/chat/messageFormat';

/** Microsoft Fluent 3D emoji (MIT), served from jsDelivr. Anything else, or a failed load, falls back to the native glyph. */
const FLUENT: Record<string, string> = {
  '🔥': 'Fire/3D/fire_3d.png',
  '😍': 'Smiling face with heart-eyes/3D/smiling_face_with_heart-eyes_3d.png',
  '😂': 'Face with tears of joy/3D/face_with_tears_of_joy_3d.png',
  '❤️': 'Red heart/3D/red_heart_3d.png',
  '💀': 'Skull/3D/skull_3d.png',
  '😮': 'Face with open mouth/3D/face_with_open_mouth_3d.png',
  '🥹': 'Face holding back tears/3D/face_holding_back_tears_3d.png',
  '👋': 'Waving hand/Default/3D/waving_hand_3d_default.png',
  '🎉': 'Party popper/3D/party_popper_3d.png',
  '💖': 'Sparkling heart/3D/sparkling_heart_3d.png',
  '✨': 'Sparkles/3D/sparkles_3d.png',
  '👻': 'Ghost/3D/ghost_3d.png',
};
const FLUENT_BASE = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/';
const failed = new Set<string>();

export function Emoji3D({ emoji, size = 28, className = '' }: { emoji: string; size?: number; className?: string }) {
  const path = FLUENT[emoji];
  const [broken, setBroken] = useState(() => !path || failed.has(emoji));
  if (broken) return <span role="img" aria-label={emoji} className={`inline-block leading-none ${className}`} style={{ fontSize: size * 0.86 }}>{emoji}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny CDN sprites; next/image would need remote config and adds nothing here
    <img src={FLUENT_BASE + encodeURI(path)} alt={emoji} width={size} height={size} loading="lazy" decoding="async" draggable={false}
      onError={() => { failed.add(emoji); setBroken(true); }} className={`inline-block select-none drop-shadow-[0_4px_6px_rgba(15,23,42,.18)] ${className}`} />
  );
}

const POP = { type: 'spring', stiffness: 400, damping: 20 } as const;

/** The floating frosted pill of six reactions shown above a message. */
export function ReactionPill({ onPick, onClose, align = 'start' }: { onPick: (emoji: string) => void; onClose: () => void; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => window.addEventListener('pointerdown', away), 0);
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return (
    <motion.div ref={ref} role="toolbar" aria-label="React to message" initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={POP}
      className={`absolute -top-14 z-30 flex gap-0.5 rounded-full border border-white/90 bg-white/80 p-1.5 shadow-[0_12px_30px_rgba(15,23,42,.14)] backdrop-blur-xl ${align === 'end' ? 'right-0' : 'left-0'}`}>
      {REACTION_EMOJIS.map((emoji, i) => (
        <motion.button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => onPick(emoji)}
          initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...POP, delay: i * 0.03 }} whileHover={{ scale: 1.25, y: -4 }} whileTap={{ scale: 0.85 }}
          className="flex size-10 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-violet-400">
          <Emoji3D emoji={emoji} size={30} />
        </motion.button>
      ))}
    </motion.div>
  );
}

type Burst = { id: number; emoji: string; x: number; y: number; particles: { dx: number; rise: number; rot: number; size: number; delay: number; bubble: boolean }[] };

/** Fires rising emoji/bubble explosions. `fire` takes viewport coordinates (defaults to screen centre). */
export function useComboBurst() {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const next = useRef(0);
  const fire = useCallback((emoji: string, x?: number, y?: number) => {
    const id = ++next.current;
    const count = 8 + Math.floor(Math.random() * 5);
    const particles = Array.from({ length: count }, () => ({
      dx: (Math.random() - 0.5) * 260, rise: 220 + Math.random() * 260, rot: (Math.random() - 0.5) * 70,
      size: 26 + Math.random() * 22, delay: Math.random() * 0.18, bubble: Math.random() < 0.3,
    }));
    const px = x ?? (typeof window === 'undefined' ? 0 : window.innerWidth / 2);
    const py = y ?? (typeof window === 'undefined' ? 0 : window.innerHeight * 0.62);
    setBursts((list) => [...list.slice(-3), { id, emoji, x: px, y: py, particles }]);
    setTimeout(() => setBursts((list) => list.filter((b) => b.id !== id)), 1900);
  }, []);
  return { bursts, fire };
}

export function ComboBurstLayer({ bursts }: { bursts: Burst[] }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <AnimatePresence>
        {bursts.flatMap((b) => b.particles.map((p, i) => (
          <motion.span key={`${b.id}-${i}`} className="absolute will-change-transform" style={{ left: b.x, top: b.y }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.3, rotate: 0 }}
            animate={{ x: p.dx, y: -p.rise, opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 0.8], rotate: p.rot }}
            transition={{ duration: 1.5, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}>
            {p.bubble
              ? <span className="block rounded-full border border-white/80 bg-[conic-gradient(from_120deg,#a5f3fc66,#c4b5fd66,#fbcfe866,#a5f3fc66)] backdrop-blur-sm" style={{ width: p.size * 0.8, height: p.size * 0.8 }} />
              : <Emoji3D emoji={b.emoji} size={p.size} />}
          </motion.span>
        )))}
      </AnimatePresence>
    </div>
  );
}

/** Small stacked chips under a bubble showing reactions received; tapping one adds another (a combo). */
export function ReactionChips({ emojis, onTap }: { emojis: string[]; onTap: (emoji: string, x: number, y: number) => void }) {
  if (emojis.length === 0) return null;
  const counts = [...emojis.reduce((m, e) => m.set(e, (m.get(e) ?? 0) + 1), new Map<string, number>())];
  return (
    <div className="-mt-2 flex gap-1">
      {counts.map(([emoji, count]) => (
        <motion.button key={emoji} type="button" layout initial={{ scale: 0 }} animate={{ scale: 1 }} transition={POP} aria-label={`${emoji} ${count}, tap to add`}
          onClick={(e) => onTap(emoji, e.clientX, e.clientY)}
          className="flex items-center gap-0.5 rounded-full border border-white/90 bg-white/85 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur">
          <Emoji3D emoji={emoji} size={16} />{count > 1 && count}
        </motion.button>
      ))}
    </div>
  );
}
