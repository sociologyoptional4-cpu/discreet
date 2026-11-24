'use client';
import { Droplets, Ghost, ShieldCheck, VenetianMask, type LucideIcon } from 'lucide-react';
import type { PrivacyMode } from '@/types/privacy';

const MODES: { mode: PrivacyMode; label: string; hint: string; Icon: LucideIcon }[] = [
  { mode: 'mask', label: 'Mask 3D', hint: 'Avatar', Icon: VenetianMask },
  { mode: 'blur', label: 'Blur', hint: 'Product POV', Icon: Droplets },
  { mode: 'shadow', label: 'Shadow', hint: 'Silhouette', Icon: Ghost },
  { mode: 'noface', label: 'NoFace', hint: 'Strict Guard', Icon: ShieldCheck },
];

type Props = {
  activeMode: PrivacyMode;
  onSelectMode: (mode: PrivacyMode) => void;
  /** True while recording: the mode cannot change mid-clip. */
  disabled?: boolean;
  className?: string;
};

/** Floating glass pill. Place inside a `relative` parent; it pins itself to the top safe area. */
export function ModeSelector({ activeMode, onSelectMode, disabled = false, className = '' }: Props) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex justify-center px-3 ${className}`}>
      <div
        role="radiogroup"
        aria-label="Privacy mode"
        aria-disabled={disabled}
        className={`pointer-events-auto flex max-w-full gap-1 rounded-full border border-white/15 bg-white/10 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-opacity motion-reduce:transition-none ${disabled ? 'opacity-50' : ''}`}
      >
        {MODES.map(({ mode, label, hint, Icon }) => {
          const active = mode === activeMode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${label}, ${hint}`}
              disabled={disabled}
              onClick={() => onSelectMode(mode)}
              className={`flex min-h-11 min-w-11 flex-col items-center justify-center rounded-full px-2.5 py-1.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 motion-reduce:transition-none disabled:cursor-not-allowed ${
                active ? 'bg-white text-[#0A0A0A]' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold leading-none">
                <Icon aria-hidden className="size-4" />
                {label}
              </span>
              <span className={`mt-0.5 text-[10px] leading-none ${active ? 'text-[#0A0A0A]/70' : 'text-white/60'}`}>{hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
