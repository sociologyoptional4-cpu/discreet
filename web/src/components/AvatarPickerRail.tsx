'use client';

import { Plus } from 'lucide-react';
import type { AvatarId } from '@/types/avatar';
import { AVATAR_IDS, AVATAR_META } from '@/lib/avatars';

type Props = { selected: AvatarId; onSelect: (id: AvatarId) => void; disabled?: boolean; orientation?: 'horizontal' | 'vertical'; className?: string };

/**
 * One-tap character switcher: clay swatches (CSS, not WebGL, so it never adds a 3D context) plus a frosted + pill.
 * Vertical, it floats on the right edge of the viewfinder or feed card.
 */
export function AvatarPickerRail({ selected, onSelect, disabled = false, orientation = 'horizontal', className = '' }: Props) {
  const vertical = orientation === 'vertical';
  return (
    <div role="radiogroup" aria-label="Choose your avatar" aria-orientation={orientation} className={`flex items-center gap-2 rounded-full border border-white/80 bg-white/65 p-1.5 shadow-lg backdrop-blur-xl ${vertical ? 'flex-col' : ''} ${className}`}>
      {AVATAR_IDS.map((id) => {
        const meta = AVATAR_META[id];
        const active = id === selected;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={meta.label}
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); onSelect(id); }}
            className={`grid size-10 place-items-center rounded-full border text-[11px] font-bold text-slate-800 transition-transform focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-50 motion-reduce:transition-none ${active ? 'scale-110 border-white ring-2 ring-slate-900/20' : 'border-white/70'}`}
            style={{ background: `radial-gradient(circle at 32% 26%, white, ${meta.accent} 60%, ${meta.accent}aa)`, boxShadow: `inset -4px -5px 9px ${meta.accent}88` }}
          >
            {meta.label.split(' ').map((w) => w[0]).join('')}
          </button>
        );
      })}
      <span aria-hidden className="acrylic-pill grid size-9 place-items-center text-[10px] font-bold text-slate-600"><Plus className="size-4" /></span>
    </div>
  );
}
