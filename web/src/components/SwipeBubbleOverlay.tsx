'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

type Props = { trigger: string | number; direction?: 'up' | 'down'; kind?: 'swipe' | 'like'; className?: string };
const COLORS = ['#9de9f2', '#ffd1b6', '#c8b9ff', '#ffb9d6', '#fff0bb', '#b8ead7', '#d5caff', '#aee3ff', '#f7c5d1'];
export function SwipeBubbleOverlay({ trigger, direction = 'up', kind = 'swipe', className = '' }: Props) {
  const reduce = useReducedMotion();
  if (reduce || !trigger) return null;
  const count = kind === 'like' ? 4 : 8;
  const key = `${trigger}-${kind}`;
  return <div aria-hidden className={`pointer-events-none absolute inset-0 z-30 overflow-hidden ${className}`}><AnimatePresence mode="sync">{Array.from({ length: count }, (_, i) => {
    const x = kind === 'like' ? 48 + (i - 1.5) * 5 : 8 + (i * 37) % 84;
    const delay = i * 0.035;
    return <motion.i key={`${key}-${i}`} className="absolute block rounded-full border border-white/90" style={{ left: `${x}%`, bottom: kind === 'like' ? '28%' : '-8%', width: kind === 'like' ? 13 + (i % 2) * 5 : 23 + (i * 7) % 25, height: kind === 'like' ? 13 + (i % 2) * 5 : 23 + (i * 7) % 25, background: `radial-gradient(circle at 30% 25%, white 0 8%, ${COLORS[i]}aa 30%, ${COLORS[i]}28 72%, white 90%)`, boxShadow: `inset 0 1px 5px #ffffff, 0 4px 12px ${COLORS[i]}70` }} initial={{ opacity: 0, y: 16, scale: 0.45 }} animate={{ opacity: [0, 0.88, 0], y: direction === 'up' ? -220 - i * 9 : -180 - i * 7, x: Math.sin(i * 2.2) * 22, scale: [0.45, 1.08, 1.18] }} transition={{ duration: kind === 'like' ? 0.62 : 0.72, delay, ease: 'easeOut' }} />;
  })}</AnimatePresence></div>;
}
