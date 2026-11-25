'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, MessageCircle, Share2, VolumeX } from 'lucide-react';
import { useState } from 'react';

const SPRING = { type: 'spring', stiffness: 420, damping: 22 } as const;
const ORB = 'relative flex size-10 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_6px_18px_rgba(0,0,0,.25)] backdrop-blur-md focus-visible:outline-2 focus-visible:outline-white';
const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
};

/** Glass Follow pill with a shimmer sweep; following morphs it to a check and pops six sparks. */
export function FollowButton({ following, onToggle }: { following: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  const [burst, setBurst] = useState(0);
  const tap = () => {
    vibrate(15);
    if (!following) setBurst((n) => n + 1);
    onToggle();
  };
  return (
    <motion.button type="button" onClick={tap} aria-pressed={following} layout whileTap={{ scale: 0.9 }} transition={SPRING}
      className={`relative flex h-[1.625rem] shrink-0 items-center gap-1 overflow-hidden rounded-full border px-2.5 text-[15px] font-bold leading-none backdrop-blur-md focus-visible:outline-2 focus-visible:outline-white ${following ? 'border-white/20 bg-white/10 text-white/85' : 'border-white/35 bg-white/20 text-white shadow-[0_0_18px_rgba(255,255,255,.25)]'}`}>
      {!following && !reduce && (
        <motion.span aria-hidden className="pointer-events-none absolute inset-y-0 w-8 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent"
          initial={{ x: -40 }} animate={{ x: 120 }} transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.8, ease: 'easeInOut' }} />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(following)} initial={{ y: 12, opacity: 0, scale: 0.6 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -12, opacity: 0 }} transition={SPRING} className="relative flex items-center gap-1">
          {following ? <><Check aria-hidden className="size-4" />Following</> : 'Follow'}
        </motion.span>
      </AnimatePresence>
      {burst > 0 && !reduce && (
        <span key={burst} aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <motion.span key={i} className="absolute left-1/2 top-1/2 size-1.5 rounded-full bg-gradient-to-tr from-cyan-200 to-fuchsia-300"
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }} animate={{ x: Math.cos(a) * 26, y: Math.sin(a) * 18, opacity: 0, scale: 0.3 }} transition={{ duration: 0.55, ease: 'easeOut' }} />
            );
          })}
        </span>
      )}
    </motion.button>
  );
}

/** Glass orb: three live equaliser bars while sound plays, a crossed speaker when muted. */
export function SoundOrb({ soundOn, playing, onToggle }: { soundOn: boolean; playing: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.button type="button" onClick={() => { vibrate(10); onToggle(); }} aria-pressed={soundOn} aria-label={soundOn ? 'Mute' : 'Turn sound on'} whileTap={{ scale: 0.86 }} transition={SPRING} className={ORB}>
      <AnimatePresence mode="wait" initial={false}>
        {soundOn ? (
          <motion.span key="eq" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={SPRING} className="flex h-4 items-end gap-[3px]">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="w-[3px] origin-bottom rounded-full bg-white"
                style={{ height: 16 }}
                animate={reduce || !playing ? { scaleY: 0.35 } : { scaleY: [0.3, 1, 0.5, 0.85, 0.3] }}
                transition={reduce || !playing ? SPRING : { duration: 0.9 + i * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }} />
            ))}
          </motion.span>
        ) : (
          <motion.span key="mute" initial={{ rotate: -40, scale: 0.4, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 40, scale: 0.4, opacity: 0 }} transition={SPRING} className="flex">
            <VolumeX aria-hidden className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/** Glass orb whose arrow tilts and launches on tap, with a glow ring. */
export function ShareOrb({ onShare }: { onShare: () => void }) {
  const [launch, setLaunch] = useState(0);
  return (
    <motion.button type="button" aria-label="Share this post" whileTap={{ scale: 0.86, rotate: -12 }} transition={SPRING} className={ORB}
      onClick={() => { vibrate(10); setLaunch((n) => n + 1); onShare(); }}>
      <span aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-full ring-1 ring-white/30 shadow-[0_0_14px_rgba(255,255,255,.25)]" />
      <motion.span key={launch} className="flex" initial={launch ? { x: 0, y: 0, rotate: 0 } : false}
        animate={launch ? { x: [0, 6, -2, 0], y: [0, -8, 3, 0], rotate: [0, 18, -6, 0] } : undefined} transition={{ duration: 0.55, ease: 'easeOut' }}>
        <Share2 aria-hidden className="size-4" />
      </motion.span>
    </motion.button>
  );
}

/** Minimal translucent glass Comment Orb with live comments_count badge. */
export function CommentOrb({ count = 0, onOpen }: { count?: number; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label={`Comments (${count})`}
      whileTap={{ scale: 0.86 }}
      transition={SPRING}
      className={ORB}
      onClick={() => {
        vibrate(10);
        onOpen();
      }}
    >
      <MessageCircle aria-hidden className="size-4" />
      {count > 0 && (
        <span className="pointer-events-none absolute -right-1.5 -top-1 flex min-w-[18px] items-center justify-center rounded-full border border-white/80 bg-white/90 px-1 text-[10px] font-extrabold tabular-nums text-slate-900 shadow">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </motion.button>
  );
}
