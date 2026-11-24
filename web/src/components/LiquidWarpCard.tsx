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
   * Turns the effect off. Needed while a child is position:fixed (an expanded feed card): a transform on any
   * ancestor would trap it inside this box instead of the viewport.
   */
  disabled?: boolean;
};

function WarpDriver({
  axis,
  container,
  target,
  tilt,
  scale,
  opacity,
  radius,
}: {
  axis: 'vertical' | 'horizontal';
  container?: RefObject<HTMLElement | null>;
  target: RefObject<HTMLDivElement | null>;
  tilt: MotionValue<number>;
  scale: MotionValue<number>;
  opacity: MotionValue<number>;
  radius: MotionValue<number>;
}) {
  const { scrollYProgress, scrollXProgress } = useScroll({
    container,
    target,
    axis: axis === 'vertical' ? 'y' : 'x',
    offset: ['start end', 'end start'],
  });
  const progress = axis === 'vertical' ? scrollYProgress : scrollXProgress;
  const spring = { stiffness: 320, damping: 28, mass: 0.7 };
  const rawTilt = useSpring(useTransform(progress, [0, 0.5, 1], [14, 0, -14]), spring);
  const rawScale = useSpring(useTransform(progress, [0, 0.5, 1], [0.89, 1, 0.89]), spring);
  const rawOpacity = useTransform(progress, [0, 0.35, 0.5, 0.65, 1], [0.55, 1, 1, 1, 0.55]);
  const rawRadius = useTransform(progress, [0, 0.44, 0.5, 0.56, 1], [32, 0, 0, 0, 32]);

  useLayoutEffect(() => {
    tilt.jump(rawTilt.get());
    scale.jump(rawScale.get());
    opacity.jump(rawOpacity.get());
    radius.jump(rawRadius.get());
    const u1 = rawTilt.on('change', (v) => tilt.set(v));
    const u2 = rawScale.on('change', (v) => scale.set(v));
    const u3 = rawOpacity.on('change', (v) => opacity.set(v));
    const u4 = rawRadius.on('change', (v) => radius.set(v));
    return () => {
      u1();
      u2();
      u3();
      u4();
      tilt.jump(0);
      scale.jump(1);
      opacity.jump(1);
      radius.jump(0);
    };
  }, [rawTilt, rawScale, rawOpacity, rawRadius, tilt, scale, opacity, radius]);

  return null;
}

/**
 * Pure GPU-composited 3D card depth, spring scale, and dynamic corner rounding during swipe.
 * Avoids CSS `filter: blur()` on video elements so mobile scrolling runs at locked 60-120fps.
 */
export function LiquidWarpCard({ children, axis = 'vertical', className = '', container, disabled = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const off = disabled || Boolean(reduce);
  const tilt = useMotionValue(0);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(1);
  const radius = useMotionValue(0);

  return (
    <div className={className} style={off ? undefined : { perspective: 1100 }}>
      <motion.div
        ref={ref}
        className="relative size-full overflow-hidden will-change-transform"
        style={
          off
            ? { rotateX: 0, rotateY: 0, scale: 1, opacity: 1, borderRadius: 0 }
            : {
                rotateX: axis === 'vertical' ? tilt : 0,
                rotateY: axis === 'horizontal' ? tilt : 0,
                scale,
                opacity,
                borderRadius: radius,
              }
        }
      >
        {children}
      </motion.div>
      {!off && (
        <WarpDriver
          axis={axis}
          container={container}
          target={ref}
          tilt={tilt}
          scale={scale}
          opacity={opacity}
          radius={radius}
        />
      )}
    </div>
  );
}
