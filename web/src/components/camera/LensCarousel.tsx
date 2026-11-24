'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type CarouselOrbItem = {
  id: string;
  name: string;
  iconUrl?: string;
  swatch?: string;
  badge?: string;
  isMystery?: boolean;
  isSnap?: boolean;
  isUnexplored?: boolean;
};

type LensCarouselProps = {
  items: CarouselOrbItem[];
  activeId: string;
  onSelect: (id: string) => void;
  shutterButton: ReactNode;
};

const NAME_MS = 2000;
const SETTLE_MS = 140;
const SPRING = { type: 'spring', stiffness: 380, damping: 28 } as const;

/**
 * One row of lens orbs with the shutter ring in the middle. The active lens sits inside the shutter; scrolling the
 * row (or swiping the viewfinder) snaps the orb nearest the centre into it. The lens name floats above for 2 s.
 */
export function LensCarousel({ items, activeId, onSelect, shutterButton }: LensCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const showName = Boolean(activeItem && activeItem.id !== 'clean' && activeItem.id !== 'none' && activeItem.id !== 'filter:clean');

  useEffect(() => {
    const target = scrollerRef.current?.querySelector<HTMLElement>(`[data-orb-id="${CSS.escape(activeId)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeId]);

  useEffect(() => () => { if (settleTimer.current !== null) window.clearTimeout(settleTimer.current); }, []);

  /** After a manual scroll settles, the orb closest to the centre becomes the lens. */
  const onScroll = () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
      let best: { id: string; d: number } | null = null;
      for (const orb of el.querySelectorAll<HTMLElement>('[data-orb-id]')) {
        const box = orb.getBoundingClientRect();
        const d = Math.abs(box.left + box.width / 2 - mid);
        if (!best || d < best.d) best = { id: orb.dataset.orbId ?? '', d };
      }
      if (best && best.id && best.id !== activeId) onSelect(best.id);
    }, SETTLE_MS);
  };

  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className="flex h-5 items-center justify-center">
        <AnimatePresence mode="wait">
          {showName && activeItem && (
            <motion.p key={activeItem.id} aria-live="polite"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: [0, 1, 1, 0], y: 0 }} exit={{ opacity: 0 }}
              transition={{ opacity: { duration: NAME_MS / 1000 + 0.6, times: [0, 0.1, 0.8, 1] }, y: SPRING }}
              className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,.6)]">
              {activeItem.name}
              {activeItem.isSnap && <span className="rounded-full bg-white/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide backdrop-blur">Snap</span>}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div ref={scrollerRef} onScroll={onScroll} role="listbox" aria-label="Lenses" aria-activedescendant={`orb-${activeId}`}
        className="no-scrollbar flex w-full snap-x snap-mandatory items-center gap-3 overflow-x-auto px-[calc(50%-36px)] py-2">
        {items.map((item) => {
          if (item.id === activeId) {
            return <div key={item.id} id={`orb-${item.id}`} role="option" aria-selected data-orb-id={item.id} className="flex shrink-0 snap-center items-center justify-center">{shutterButton}</div>;
          }
          return (
            <motion.button key={item.id} id={`orb-${item.id}`} role="option" aria-selected={false} type="button" data-orb-id={item.id} onClick={() => onSelect(item.id)} aria-label={item.name}
              whileTap={{ scale: 0.88 }} transition={SPRING}
              className={`relative flex size-12 shrink-0 snap-center items-center justify-center rounded-full border border-white/25 bg-black/25 shadow-sm backdrop-blur-xl will-change-transform focus-visible:outline-2 focus-visible:outline-white ${item.isMystery ? 'mystery-orb' : ''}`}>
              {item.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- lens thumbnails come from the Camera Kit CDN at runtime
                <img src={item.iconUrl} alt="" loading="lazy" decoding="async" width={44} height={44} className="size-11 rounded-full object-cover" />
              ) : item.swatch ? (
                <span aria-hidden className="size-10 rounded-full border border-white/40 shadow-inner" style={{ background: item.swatch }} />
              ) : (
                <span aria-hidden className="text-xl">{item.badge ?? '✨'}</span>
              )}
              {item.isUnexplored && !item.isMystery && (
                <span aria-hidden className="absolute right-0 top-0 size-2.5 animate-pulse rounded-full bg-gradient-to-tr from-cyan-300 to-violet-400 shadow-[0_0_8px_#67e8f9] ring-1 ring-white/80" />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
