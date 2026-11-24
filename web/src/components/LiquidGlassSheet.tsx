'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export function LiquidGlassSheet({ children, className = '', open = true }: { children: ReactNode; className?: string; open?: boolean }) {
  const reduce = useReducedMotion();
  return <motion.section initial={false} animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 14, scale: 0.98 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 24 }} className={`rounded-[28px] border border-white/80 bg-white/55 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl ${className}`}>{children}</motion.section>;
}
