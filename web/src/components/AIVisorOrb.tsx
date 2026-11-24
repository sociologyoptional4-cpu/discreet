'use client';

import { motion, useReducedMotion } from 'framer-motion';

type Props = { state: 'idle' | 'listening' | 'thinking' | 'happy'; size?: 'sm' | 'md' | 'lg' };
const SIZE = { sm: 'size-14', md: 'size-24', lg: 'size-36' } as const;

/** Lightweight CSS visor companion: no canvas or downloaded model. */
export function AIVisorOrb({ state, size = 'md' }: Props) {
  const reduce = useReducedMotion();
  const active = state === 'listening' || state === 'thinking';
  return (
    <motion.div
      role="img"
      aria-label={`Vybe assistant ${state}`}
      className={`relative isolate ${SIZE[size]} rounded-full`}
      animate={reduce ? undefined : { y: active ? [0, -5, 0] : [0, -3, 0], scale: active ? [1, 1.045, 1] : [1, 1.02, 1] }}
      transition={{ duration: active ? 1.8 : 4.2, repeat: reduce ? 0 : Infinity, ease: 'easeInOut' }}
      style={{ background: 'radial-gradient(circle at 31% 25%, #fff 0%, #d8f6ff 24%, #c9c8ff 58%, #ffd8cb 100%)', boxShadow: 'inset -12px -16px 24px #9d9be744, inset 8px 8px 18px #ffffffcc, 0 18px 38px #8274b42b' }}
    >
      <motion.span aria-hidden className="absolute inset-[26%_13%] flex items-center justify-center gap-[15%] rounded-full border border-white/60 bg-slate-900 shadow-[inset_0_3px_10px_rgba(255,255,255,0.18),0_8px_18px_rgba(50,45,80,0.25)]">
        {[0, 1].map((eye) => <motion.i key={eye} className="block h-[18%] w-[13%] rounded-full bg-cyan-100 shadow-[0_0_12px_#a5f3fc]" animate={reduce ? undefined : { scaleY: [1, 1, 0.12, 1, 1] }} transition={{ duration: 4.3, delay: eye ? 0.12 : 0, repeat: Infinity, times: [0, 0.88, 0.92, 0.96, 1] }} />)}
      </motion.span>
      <motion.span aria-hidden className="pointer-events-none absolute -inset-2 -z-10 rounded-full border border-white/55" animate={active && !reduce ? { scale: [0.94, 1.12, 0.94], opacity: [0.4, 0.8, 0.4], rotate: 360 } : { scale: 1, opacity: 0.25 }} transition={{ duration: state === 'thinking' ? 3 : 2, repeat: active && !reduce ? Infinity : 0, ease: 'linear' }} />
      <span className="sr-only">{state}</span>
    </motion.div>
  );
}
