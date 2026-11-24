'use client';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { AIVisorOrb } from '@/components/AIVisorOrb';

export type FeedNudge = { id: string; message: string; cta: string };
type Props = {
  nudge: FeedNudge | null;
  onAction: (nudge: FeedNudge) => void;
  onDismiss: () => void;
};

const DISMISS_PX = 60;

/** The Vybe assistant's floating suggestion. Swipe it up or sideways to dismiss. */
export function AIFeedNudge({ nudge, onAction, onDismiss }: Props) {
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y < -DISMISS_PX || Math.abs(info.offset.x) > DISMISS_PX * 1.5) onDismiss();
  };
  return (
    <AnimatePresence>
      {nudge && (
        <motion.aside key={nudge.id} aria-label="Vybe AI suggestion" drag dragSnapToOrigin dragElastic={0.6} onDragEnd={onDragEnd}
          initial={{ opacity: 0, y: -40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -40, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          className="absolute inset-x-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+2.5rem)] z-40 flex cursor-grab touch-none items-center gap-3 rounded-3xl border border-white/95 bg-white/80 p-2.5 pr-3 text-[#111827] shadow-2xl backdrop-blur-2xl active:cursor-grabbing">
          <AIVisorOrb state="happy" size="sm" />
          <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{nudge.message}</p>
          <button type="button" onClick={() => onAction(nudge)} onPointerDownCapture={(e) => e.stopPropagation()}
            className="shrink-0 rounded-full bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-[0_6px_16px_rgba(167,139,250,.45)] focus-visible:outline-2 focus-visible:outline-violet-400">
            {nudge.cta} →
          </button>
          <button type="button" onClick={onDismiss} aria-label="Dismiss suggestion" className="sr-only focus:not-sr-only">Dismiss</button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
