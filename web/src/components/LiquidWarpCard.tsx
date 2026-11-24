'use client';

import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

/** Subtle scroll-linked card depth. It animates only compositor-friendly transforms and filter. */
export function LiquidWarpCard({ children, axis = 'vertical', className = '' }: { children: ReactNode; axis?: 'vertical' | 'horizontal'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center', 'end start'] });
  const tilt = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], axis === 'vertical' ? [8, 0, -8] : [0, 0, 0]), { stiffness: 280, damping: 26 });
  const scale = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [0.93, 1, 0.93]), { stiffness: 280, damping: 26 });
  const blur = useTransform(scrollYProgress, [0, 0.5, 1], ['blur(2px)', 'blur(0px)', 'blur(2px)']);
  return <motion.div ref={ref} className={className} style={reduce ? undefined : { perspective: 1200, rotateX: axis === 'vertical' ? tilt : undefined, rotateY: axis === 'horizontal' ? tilt : undefined, scale, filter: blur, transformStyle: 'preserve-3d' }}>{children}</motion.div>;
}
