'use client';
import { Camera, Droplets, Ghost, ShieldCheck, VenetianMask, type LucideIcon } from 'lucide-react';
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

/** Compact Light-Theme Frosted Acrylic mode pill pinned to the top safe area. */
export function ModeSelector({ activeMode, onSelectMode, disabled = false, className = '' }: Props) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex justify-center px-14 ${className}`}>
      <div
        role="radiogroup"
        aria-label="Camera and privacy mode"
        aria-disabled={disabled}
        className={`pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/90 bg-white/75 p-1 text-slate-900 shadow-lg backdrop-blur-xl no-scrollbar transition-opacity ${
          disabled ? 'opacity-50' : ''
        }`}
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
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed ${
                active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-white/60'
              }`}
            >
              <Icon aria-hidden className="size-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
