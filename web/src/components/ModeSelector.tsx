'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, ChevronDown, Droplets, Ghost, ShieldCheck, VenetianMask, type LucideIcon } from 'lucide-react';
import type { PrivacyMode } from '@/types/privacy';

export type CameraMode = 'normal' | PrivacyMode;

const MODES: { mode: CameraMode; label: string; hint: string; Icon: LucideIcon }[] = [
  { mode: 'normal', label: 'Normal', hint: 'Face + AR', Icon: Camera },
  { mode: 'mask', label: 'Mask 3D', hint: 'Avatar', Icon: VenetianMask },
  { mode: 'blur', label: 'Blur', hint: 'Product POV', Icon: Droplets },
  { mode: 'shadow', label: 'Shadow', hint: 'Silhouette', Icon: Ghost },
  { mode: 'noface', label: 'NoFace', hint: 'Strict Guard', Icon: ShieldCheck },
];

type Props = {
  activeMode: CameraMode;
  onSelectMode: (mode: CameraMode) => void;
  disabled?: boolean;
  className?: string;
};

const SPRING = { type: 'spring', stiffness: 380, damping: 28 } as const;
const GLASS = 'border border-white/15 bg-black/30 text-white shadow-sm backdrop-blur-xl';

/**
 * Smoked-glass mode switcher pinned to the top safe area. Collapsed it shows only the current mode; a tap unfolds
 * every mode in a row that scrolls inside the space between the side buttons, so nothing is ever clipped.
 */
export function ModeSelector({ activeMode, onSelectMode, disabled = false, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const current = MODES.find((m) => m.mode === activeMode) ?? MODES[0];
  return (
    <div onClick={(e) => e.stopPropagation()} className={`pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex justify-center px-16 ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        {open && !disabled ? (
          <motion.div key="open" role="radiogroup" aria-label="Camera and privacy mode"
            initial={{ opacity: 0, scaleX: 0.6 }} animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0, scaleX: 0.7 }} transition={SPRING}
            className={`pointer-events-auto flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 no-scrollbar ${GLASS}`}>
            {MODES.map(({ mode, label, hint, Icon }) => {
              const active = mode === activeMode;
              return (
                <button key={mode} type="button" role="radio" aria-checked={active} aria-label={`${label}, ${hint}`}
                  onClick={() => { onSelectMode(mode); setOpen(false); }}
                  className="relative flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-white">
                  {active && <motion.span layoutId="mode-pill" transition={SPRING} aria-hidden className="absolute inset-0 rounded-full bg-white" />}
                  <motion.span whileTap={{ scale: 0.8 }} className={`relative flex ${active ? 'text-slate-950' : 'text-white/85'}`}><Icon aria-hidden className="size-4" /></motion.span>
                  {active && <span className="relative whitespace-nowrap text-slate-950">{label}</span>}
                </button>
              );
            })}
          </motion.div>
        ) : (
          <motion.button key="closed" type="button" disabled={disabled} onClick={() => setOpen(true)} aria-haspopup="true" aria-expanded={false}
            aria-label={`Mode: ${current.label}, ${current.hint}. Change mode`}
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: disabled ? 0.5 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING}
            className={`pointer-events-auto flex min-h-10 items-center gap-1 rounded-full px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed ${GLASS}`}>
            <motion.span key={current.mode} initial={{ scale: 0.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={SPRING} className="flex"><current.Icon aria-hidden className="size-4" /></motion.span>
            <ChevronDown aria-hidden className="size-3.5 opacity-70" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
