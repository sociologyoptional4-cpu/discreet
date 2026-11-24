'use client';
import { motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

const REPLY_AT = 48;
const LONG_PRESS_MS = 450;

type Props = { children: ReactNode; onReply: () => void; onReact: () => void; disabled?: boolean };

/** Drag right past 48px to reply (springs back); long-press or double-tap to open reactions. */
export function SwipeableMessageBubble({ children, onReply, onReact, disabled = false }: Props) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const hint = useTransform(x, [0, REPLY_AT], [0, 1]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragged = useRef(false);
  const pressed = useRef(false); // a long-press or drag must not also count as a tap on the bubble
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };

  if (disabled) return <>{children}</>;
  return (
    <div className="relative">
      <motion.span aria-hidden style={{ opacity: hint, scale: hint }} className="absolute left-0 top-1/2 -translate-y-1/2 text-lg">↩️</motion.span>
      <motion.div
        style={{ x }}
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.55 }}
        dragSnapToOrigin
        dragTransition={{ bounceStiffness: 500, bounceDamping: 28 }}
        onDragStart={() => { dragged.current = true; clear(); }}
        onDragEnd={(_, info) => { if (info.offset.x > REPLY_AT) onReply(); setTimeout(() => { dragged.current = false; }, 0); }}
        onPointerDown={() => { dragged.current = false; clear(); pressed.current = false; timer.current = setTimeout(() => { if (!dragged.current) { pressed.current = true; onReact(); } }, LONG_PRESS_MS); }}
        onClickCapture={(e) => { if (pressed.current || dragged.current) { e.stopPropagation(); pressed.current = false; } }}
        onPointerUp={clear}
        onPointerCancel={clear}
        onPointerLeave={clear}
        onDoubleClick={onReact}
        onContextMenu={(e) => { e.preventDefault(); onReact(); }}
        className="touch-pan-y select-none [-webkit-touch-callout:none]"
      >
        {children}
      </motion.div>
    </div>
  );
}
