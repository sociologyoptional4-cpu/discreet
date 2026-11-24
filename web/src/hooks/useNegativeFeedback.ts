'use client';
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** A scroll or a tap on an existing control never counts as negative feedback. */
export function useNegativeFeedback(feedback: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const suppress = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  return {
    onPointerDown: (event: PointerEvent) => {
      cancel();
      suppress.current = false;
      if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button,a,[role=link]')) return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => { suppress.current = true; feedback(); }, 600);
    },
    onPointerMove: (event: PointerEvent) => {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) cancel();
    },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onClickCapture: (event: MouseEvent) => {
      if (suppress.current) { suppress.current = false; event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenu: (event: MouseEvent) => {
      if (suppress.current) event.preventDefault();
    },
  };
}
