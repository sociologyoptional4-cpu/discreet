'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';

export const ARC_EMOJIS = ['😍', '❤️', '😂', '🔥', '😮', '💀'] as const;
const EDGE_PX = 44;
const PULL_PX = 28;
const RADIUS = 160;
const BULGE = 92;
const STEP = (24 * Math.PI) / 180;
/** Arc slots around the vertical centre: x bulges right in the middle, y spreads up and down. */
const SLOTS = ARC_EMOJIS.map((_, i) => {
  const a = (i - (ARC_EMOJIS.length - 1) / 2) * STEP;
  return { x: RADIUS * Math.cos(a) - RADIUS + BULGE, y: RADIUS * Math.sin(a) };
});
const SPRING = { type: 'spring', stiffness: 380, damping: 26 } as const;
const tick = (ms = 10) => { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms); };

type Props = {
  /** The feed shell: a pull that starts within 44 px of its left edge opens the wheel. */
  rootRef: RefObject<HTMLElement | null>;
  onReact: (emoji: string, x: number, y: number) => void;
  disabled?: boolean;
};

/**
 * Reactions hidden behind the left edge. Pull right from the edge (or tap the light sliver) and a curved wheel of
 * emoji glides out; slide along it to focus one, release or tap to send, tap anywhere else to put it away.
 */
export function EdgeEmojiArc({ rootRef, onReact, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const centreY = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || disabled) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      const box = root.getBoundingClientRect();
      start = e.clientX - box.left < EDGE_PX ? { x: e.clientX, y: e.clientY } : null;
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (dx > PULL_PX && dx > Math.abs(e.clientY - start.y)) {
        start = null;
        tick(12);
        setOpen(true);
      }
    };
    const up = () => { start = null; };
    root.addEventListener('pointerdown', down, { passive: true });
    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerup', up, { passive: true });
    root.addEventListener('pointercancel', up, { passive: true });
    return () => {
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
    };
  }, [rootRef, disabled]);

  const setFocused = (i: number | null) => {
    if (i === focusRef.current) return;
    focusRef.current = i;
    setFocus(i);
    if (i !== null) tick(10);
  };
  const close = () => { setFocused(null); setOpen(false); };
  const send = (i: number) => {
    const box = rootRef.current?.getBoundingClientRect();
    const x = (box?.left ?? 0) + SLOTS[i].x + 28;
    const y = centreY.current + SLOTS[i].y;
    onReact(ARC_EMOJIS[i], x, y);
    close();
  };
  /** The emoji nearest the finger, if the finger is over the wheel. */
  const slotAt = (e: ReactPointerEvent<HTMLDivElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    centreY.current = box.top + box.height / 2;
    if (e.clientX - box.left > BULGE + 80) return null;
    const dy = e.clientY - centreY.current;
    let best = 0;
    SLOTS.forEach((s, i) => { if (Math.abs(s.y - dy) < Math.abs(SLOTS[best].y - dy)) best = i; });
    return Math.abs(SLOTS[best].y - dy) < 48 ? best : null;
  };

  return (
    <>
      {!open && !disabled && (
        <button type="button" onClick={() => { tick(12); setOpen(true); }} aria-label="Open reactions"
          className="group absolute left-0 top-1/2 z-30 flex h-24 w-6 -translate-y-1/2 items-center focus-visible:outline-none">
          <span aria-hidden className="ml-1 h-10 w-1 rounded-full bg-white/35 shadow-[0_0_10px_rgba(255,255,255,.45)] transition-all group-hover:h-14 group-hover:bg-white/60 group-focus-visible:bg-white" />
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div key="arc" role="dialog" aria-label="Reactions" className="absolute inset-0 z-40 touch-none select-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFocused(slotAt(e)); }}
            onPointerMove={(e) => { if (e.buttons) setFocused(slotAt(e)); }}
            onPointerUp={(e) => { const i = slotAt(e); if (i === null) close(); else send(i); }}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
            <motion.div aria-hidden className="absolute inset-y-0 left-0 w-64 bg-[radial-gradient(70%_45%_at_0%_50%,rgba(0,0,0,.45),transparent_75%)]"
              initial={{ x: -80 }} animate={{ x: 0 }} exit={{ x: -80 }} transition={SPRING} />
            <svg aria-hidden className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 overflow-visible" width="200" height="340" viewBox="0 -170 200 340">
              <motion.path d={`M ${SLOTS[0].x - 6} ${SLOTS[0].y - 30} A ${RADIUS} ${RADIUS} 0 0 1 ${SLOTS[SLOTS.length - 1].x - 6} ${SLOTS[SLOTS.length - 1].y + 30}`}
                fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, ease: 'easeOut' }} />
            </svg>
            <div className="absolute left-0 top-1/2">
              {ARC_EMOJIS.map((emoji, i) => {
                const active = focus === i;
                return (
                  <motion.button key={emoji} type="button" aria-label={`React ${emoji}`} tabIndex={0}
                    onClick={(e) => { if (e.detail === 0) send(i); }}
                    initial={{ x: -70, y: SLOTS[i].y, opacity: 0, scale: 0.5 }}
                    animate={{ x: SLOTS[i].x, y: SLOTS[i].y, opacity: 1, scale: active ? 1.35 : 1 }}
                    exit={{ x: -70, opacity: 0, scale: 0.5, transition: { duration: 0.18 } }}
                    transition={{ ...SPRING, delay: open && focus === null ? i * 0.03 : 0 }}
                    className="absolute -mt-6 flex size-12 items-center justify-center rounded-full border border-white/25 bg-white/15 backdrop-blur-md will-change-transform focus-visible:outline-2 focus-visible:outline-white">
                    {active && <motion.span layoutId="arc-halo" aria-hidden className="absolute -inset-1.5 rounded-full bg-[radial-gradient(circle,rgba(167,243,252,.55),rgba(196,181,253,.25)_60%,transparent_72%)] shadow-[0_0_22px_rgba(165,243,252,.65)]" />}
                    <span className="relative flex"><Emoji3D emoji={emoji} size={30} /></span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
