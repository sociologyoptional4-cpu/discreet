'use client';

import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

type Props = {
  children: ReactNode;
  axis?: 'vertical' | 'horizontal';
  className?: string;
  /** The element that scrolls. Without it the page (window) scroll is tracked, which never moves inside the feed. */
  container?: RefObject<HTMLElement | null>;
  /**
   * Turns the effect off. Needed while a child is position:fixed (an expanded feed card): a transform or filter on any
   * ancestor would trap it inside this box instead of the viewport.
   */
  disabled?: boolean;
};

const blurAt = (p: number): string => {
  const edge = Math.abs(p - 0.5) - 0.15;
  return edge <= 0 ? 'none' : `blur(${Math.min(2, (edge / 0.35) * 2).toFixed(2)}px)`;
};

function WarpDriver({
  axis,
  container,
  target,
  tilt,
  scale,
  filter,
}: {
  axis: 'vertical' | 'horizontal';
  container?: RefObject<HTMLElement | null>;
  target: RefObject<HTMLDivElement | null>;
  tilt: MotionValue<number>;
  scale: MotionValue<number>;
  filter: MotionValue<string>;
}) {
  const { scrollYProgress, scrollXProgress } = useScroll({
    container,
    target,
    axis: axis === 'vertical' ? 'y' : 'x',
    offset: ['start end', 'end start'],
  });
  const progress = axis === 'vertical' ? scrollYProgress : scrollXProgress;
  const spring = { stiffness: 280, damping: 26 };
  const rawTilt = useSpring(useTransform(progress, [0, 0.5, 1], [10, 0, -10]), spring);
  const rawScale = useSpring(useTransform(progress, [0, 0.5, 1], [0.93, 1, 0.93]), spring);

  useLayoutEffect(() => {
    tilt.jump(rawTilt.get());
    scale.jump(rawScale.get());
    filter.jump(blurAt(progress.get()));
    const u1 = rawTilt.on('change', (v) => tilt.set(v));
    const u2 = rawScale.on('change', (v) => scale.set(v));
    const u3 = progress.on('change', (v) => filter.set(blurAt(v)));
    return () => {
      u1();
      u2();
      u3();
      tilt.jump(0);
      scale.jump(1);
      filter.jump('none');
    };
  }, [rawTilt, rawScale, progress, tilt, scale, filter]);

  return null;
}

/** Subtle scroll-linked bend, shrink and blur as a card leaves the centre. Compositor-only properties. */
export function LiquidWarpCard({ children, axis = 'vertical', className = '', container, disabled = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const off = disabled || Boolean(reduce);
  const tilt = useMotionValue(0);
  const scale = useMotionValue(1);
  const filter = useMotionValue('none');

  return (
    <div className={className} style={off ? undefined : { perspective: 1200 }}>
      <motion.div
        ref={ref}
        className="relative size-full"
        style={
          off
            ? { rotateX: 0, rotateY: 0, scale: 1, filter: 'none' }
            : { rotateX: axis === 'vertical' ? tilt : 0, rotateY: axis === 'horizontal' ? tilt : 0, scale, filter }
        }
      >
        {children}
      </motion.div>
      {!off && <WarpDriver axis={axis} container={container} target={ref} tilt={tilt} scale={scale} filter={filter} />}
    </div>
  );
}
