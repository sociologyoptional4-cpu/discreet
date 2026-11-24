'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { ClayEmotionOrb } from '@/components/ClayEmotionOrb';
import { EMOTION_META, METER_BUCKETS, countBuckets, type MeterBucket } from '@/lib/emotions';
import type { SearchResult } from '@/types/social';

const SEGMENTS = 8;
const ORB = 150;
const SPACING = 172; // neighbours sit just past the sheet's edges, so only part of them peeks in
const BAR_LABEL: Record<MeterBucket, string> = { joy: 'happy', angry: 'angry', surprised: 'surprised', chill: 'chill' };

type Props = { reviews: SearchResult[]; selected: MeterBucket | 'all'; onSelect: (bucket: MeterBucket | 'all') => void };

/**
 * Emotion overview for a search: swipe between clay emotion orbs (the headline follows), then a vibe meter with one
 * segmented bar per emotion. The round button under a bar filters the reviews to that emotion.
 */
export function EmotionDiscoveryHub({ reviews, selected, onSelect }: Props) {
  const reduce = useReducedMotion();
  const dragged = useRef(false);
  const counts = countBuckets(reviews);
  const dominant = METER_BUCKETS.reduce((best, b) => (counts[b] > counts[best] ? b : best), METER_BUCKETS[0]);
  const [index, setIndex] = useState(() => METER_BUCKETS.indexOf(selected === 'all' ? dominant : selected));
  const active = METER_BUCKETS[index];
  const max = Math.max(1, ...METER_BUCKETS.map((b) => counts[b]));
  const go = (next: number) => setIndex(Math.min(METER_BUCKETS.length - 1, Math.max(0, next)));
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 280, damping: 26 };

  return (
    <section aria-label="How people feel" className="text-slate-900">
      <AnimatePresence mode="wait" initial={false}>
        <motion.h2
          key={active}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="text-center text-2xl font-bold tracking-tight"
          aria-live="polite"
        >
          {EMOTION_META[active].headline}
        </motion.h2>
      </AnimatePresence>
      <p className="mt-1 text-center text-xs text-slate-500">{counts[active]} of {reviews.length} reviews</p>

      <motion.div
        className="relative mt-3 h-[190px] cursor-grab touch-pan-y overflow-hidden active:cursor-grabbing"
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.35}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          if (Math.abs(info.offset.x) > 40) go(index + (info.offset.x < 0 ? 1 : -1));
          setTimeout(() => { dragged.current = false; }, 0);
        }}
        role="group"
        aria-roledescription="carousel"
        aria-label="Emotions"
        onKeyDown={(e) => { if (e.key === 'ArrowRight') go(index + 1); if (e.key === 'ArrowLeft') go(index - 1); }}
        tabIndex={0}
      >
        {METER_BUCKETS.map((bucket, i) => {
          const offset = i - index;
          return (
            <motion.button
              key={bucket}
              type="button"
              onClick={() => {
                if (dragged.current) return;
                if (offset === 0) onSelect(selected === bucket ? 'all' : bucket);
                else setIndex(i);
              }}
              aria-label={offset === 0 ? `${EMOTION_META[bucket].plural}: ${counts[bucket]} reviews. ${selected === bucket ? 'Show all' : 'Show only these'}` : `Show ${EMOTION_META[bucket].plural}`}
              aria-pressed={offset === 0 ? selected === bucket : undefined}
              className="absolute left-1/2 top-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-800"
              style={{ marginLeft: -ORB / 2, perspective: 900 }}
              initial={false}
              animate={{ x: offset * SPACING, scale: offset === 0 ? 1 : 0.78, rotateY: offset * -10, filter: offset === 0 ? 'blur(0px)' : 'blur(1.5px)', opacity: Math.abs(offset) > 1 ? 0 : 1 }}
              transition={spring}
            >
              <motion.span className="block" animate={reduce || offset !== 0 ? undefined : { y: [0, -5, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
                <ClayEmotionOrb emotion={bucket} size={ORB} />
              </motion.span>
            </motion.button>
          );
        })}
      </motion.div>

      <div role="group" aria-label="Vibe meter" className="mx-auto mt-2 grid max-w-xs grid-cols-4 gap-3">
        {METER_BUCKETS.map((bucket, i) => {
          const { color } = EMOTION_META[bucket];
          const filled = counts[bucket] === 0 ? 0 : Math.max(1, Math.round((counts[bucket] / max) * SEGMENTS));
          const on = selected === bucket;
          return (
            <div key={bucket} className="flex flex-col items-center gap-1.5">
              <span className="text-sm font-bold tabular-nums">{String(counts[bucket]).padStart(2, '0')}</span>
              <span aria-hidden className="flex h-28 w-7 flex-col-reverse gap-[3px] rounded-full bg-white/70 p-[3px] shadow-[inset_0_2px_6px_rgba(15,23,42,.08)]">
                {Array.from({ length: SEGMENTS }, (_, s) => (
                  <motion.i
                    key={s}
                    className="block flex-1 rounded-full"
                    initial={false}
                    animate={{ backgroundColor: s < filled ? color : 'rgba(148,163,184,0.18)', opacity: s < filled ? 1 - (filled - 1 - s) * 0.06 : 1 }}
                    transition={{ duration: 0.25, delay: reduce ? 0 : s * 0.02 }}
                  />
                ))}
              </span>
              <span className="text-[11px] text-slate-500">{BAR_LABEL[bucket]}</span>
              <button
                type="button"
                aria-pressed={on}
                aria-label={on ? `Showing ${BAR_LABEL[bucket]} reviews. Show all` : `Show ${BAR_LABEL[bucket]} reviews`}
                onClick={() => { setIndex(i); onSelect(on ? 'all' : bucket); }}
                className="acrylic-pill grid size-9 place-items-center focus-visible:outline-2 focus-visible:outline-slate-800"
                style={on ? { background: color, color: '#fff' } : undefined}
              >
                <Play aria-hidden className="size-3.5 fill-current" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
