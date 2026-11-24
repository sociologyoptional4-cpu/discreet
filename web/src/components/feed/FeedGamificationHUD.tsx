'use client';
import { AnimatePresence, motion } from 'framer-motion';

export type FeedMilestone = { key: number; emoji: string; label: string; xp: number };
type Props = { milestone: FeedMilestone | null };

/** A small glass pill when a milestone is hit. The parent clears it. */
export function FeedGamificationHUD({ milestone }: Props) {
  return (
    <>
      <AnimatePresence>
        {milestone && (
          <motion.p key={milestone.key} role="status" initial={{ opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="pointer-events-none absolute left-1/2 top-[calc(max(0.75rem,env(safe-area-inset-top))+0.25rem)] z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/25 bg-white/15 px-3.5 py-1.5 text-xs font-bold text-white shadow-[0_8px_24px_rgba(0,0,0,.25)] backdrop-blur-xl">
            {milestone.emoji} {milestone.label} • +{milestone.xp} XP
          </motion.p>
        )}
      </AnimatePresence>
    </>
  );
}
