'use client';
import { AnimatePresence, motion } from 'framer-motion';

export type FeedMilestone = { key: number; emoji: string; label: string; xp: number };
type Props = {
  /** Progress through the current level, 0 to 1. */
  progress: number;
  milestone: FeedMilestone | null;
};

/** A 2 px glowing XP line on the top edge, plus a small pill when a milestone is hit. The parent clears the pill. */
export function FeedGamificationHUD({ progress, milestone }: Props) {
  const value = Math.min(1, Math.max(0, progress));
  return (
    <>
      <div role="progressbar" aria-label="Session vibe XP" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[2px] bg-white/10">
        <motion.div className="h-full origin-left bg-[linear-gradient(90deg,#67e8f9,#c4b5fd,#f9a8d4,#86efac)] shadow-[0_0_8px_#c4b5fd]"
          initial={false} animate={{ scaleX: value }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} />
      </div>
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
