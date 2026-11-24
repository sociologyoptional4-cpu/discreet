'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
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
  category: 'snap' | 'studio';
  onCategoryChange: (next: 'snap' | 'studio') => void;
  snapCount: number;
  studioCount: number;
  items: CarouselOrbItem[];
  activeId: string;
  onSelect: (id: string) => void;
  shutterButton: ReactNode;
};

export function LensCarousel({
  category,
  onCategoryChange,
  snapCount,
  studioCount,
  items,
  activeId,
  onSelect,
  shutterButton,
}: LensCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [nameBadge, setNameBadge] = useState<{ name: string; isSnap: boolean } | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];

  useEffect(() => {
    if (!activeItem || activeItem.id === 'clean' || activeItem.id === 'none' || activeItem.isMystery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setNameBadge({ name: activeItem.name, isSnap: Boolean(activeItem.isSnap) });
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = window.setTimeout(() => setNameBadge(null), 1800);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeItem]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-orb-id="${CSS.escape(activeId)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeId]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {/* Floating Lens Name Pill (auto-fades after 1.8s) */}
      <div className="flex min-h-7 items-center justify-center">
        <AnimatePresence mode="wait">
          {nameBadge && (
            <motion.div
              key={`${nameBadge.name}-${nameBadge.isSnap}`}
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1.5 rounded-full border border-white/90 bg-white/80 px-3 py-1 text-xs font-bold text-slate-900 shadow-md backdrop-blur-xl"
            >
              <span>{nameBadge.name}</span>
              {nameBadge.isSnap && (
                <span className="rounded-full bg-amber-300/90 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-950">
                  by Snapchat
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Category Switcher Pill */}
      <div className="flex items-center gap-1 rounded-full border border-white/90 bg-white/75 p-1 text-slate-900 shadow backdrop-blur-xl">
        <button
          type="button"
          onClick={() => onCategoryChange('snap')}
          className={`rounded-full px-3 py-1 text-[11px] font-extrabold transition ${
            category === 'snap' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700'
          }`}
        >
          Snap AR ({snapCount})
        </button>
        <button
          type="button"
          onClick={() => onCategoryChange('studio')}
          className={`rounded-full px-3 py-1 text-[11px] font-extrabold transition ${
            category === 'studio' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700'
          }`}
        >
          Studio FX ({studioCount})
        </button>
      </div>

      {/* Shutter-Integrated Horizontal Frosted Orb Carousel */}
      <div className="relative flex w-full items-center justify-center py-1">
        <div
          ref={scrollerRef}
          className="no-scrollbar flex w-full snap-x snap-mandatory items-center gap-3 overflow-x-auto px-[calc(50%-24px)] py-2"
        >
          {items.map((item) => {
            const isSelected = item.id === activeId;
            if (isSelected) {
              return (
                <div
                  key={item.id}
                  data-orb-id={item.id}
                  className="relative flex shrink-0 snap-center items-center justify-center"
                >
                  {shutterButton}
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                data-orb-id={item.id}
                onClick={() => onSelect(item.id)}
                aria-label={item.name}
                className={`relative flex size-12 shrink-0 snap-center items-center justify-center rounded-full border border-white/90 bg-white/75 shadow-md backdrop-blur-xl transition-transform duration-200 hover:scale-110 active:scale-95 ${
                  item.isMystery
                    ? 'bg-gradient-to-tr from-pink-200 via-amber-100 to-cyan-200 ring-2 ring-white/90'
                    : ''
                }`}
              >
                {item.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt={item.name}
                    loading="lazy"
                    className="size-10 rounded-full object-cover"
                  />
                ) : item.swatch ? (
                  <span
                    aria-hidden
                    className="size-9 rounded-full border border-white/90 shadow-inner"
                    style={{ background: item.swatch }}
                  />
                ) : (
                  <span className="text-lg">{item.badge ?? '✨'}</span>
                )}

                {item.isUnexplored && !item.isMystery && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-3 rounded-full border border-white bg-gradient-to-tr from-fuchsia-400 via-violet-400 to-cyan-300 shadow"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
