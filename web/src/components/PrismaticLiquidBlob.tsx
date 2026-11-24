'use client';

import { motion, useReducedMotion } from 'framer-motion';

type Props = { state: 'idle' | 'active' | 'processing'; size?: 'sm' | 'md' | 'lg' };
const SIZE = { sm: 'size-12', md: 'size-20', lg: 'size-32' } as const;
export function PrismaticLiquidBlob({ state, size = 'md' }: Props) {
  const reduce = useReducedMotion();
  const active = state !== 'idle';
  return <motion.span aria-hidden className={`liquid-morph relative isolate block ${SIZE[size]}`} animate={reduce ? undefined : { scale: active ? [1, 1.08, 1] : [1, 1.025, 1], rotate: active ? [0, 8, -8, 0] : 0 }} transition={{ duration: state === 'processing' ? 1.5 : 4, repeat: active && !reduce ? Infinity : 0, ease: 'easeInOut' }} style={{ background: 'radial-gradient(circle at 32% 28%, #fff 0%, #c5f4ff 25%, #d8c9ff 60%, #ffd5bc 100%)', boxShadow: 'inset -8px -10px 18px #8b80d433, inset 6px 7px 14px #ffffffd9, 0 12px 28px #8c89b52e' }}><i className="prism-spin absolute -inset-1 -z-10 rounded-[inherit] bg-[conic-gradient(from_10deg,#8ceeff,#ffcfb5,#c3a8ff,#ffaad9,#8ceeff)] opacity-70 blur-md" /></motion.span>;
}
