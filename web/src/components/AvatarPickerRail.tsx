'use client';

import { Plus } from 'lucide-react';
import type { AvatarId } from '@/types/avatar';
import { AVATAR_IDS, AVATAR_META } from '@/lib/avatars';

/** Compact selector that uses CSS-rendered vinyl-like avatar swatches to avoid spawning extra WebGL contexts. */
export function AvatarPickerRail({ selected, onSelect, disabled = false }: { selected: AvatarId; onSelect: (id: AvatarId) => void; disabled?: boolean }) {
  return <div role="radiogroup" aria-label="Choose your avatar" className="flex items-center gap-2 rounded-full border border-white/80 bg-white/65 p-1.5 shadow-lg backdrop-blur-xl">
    {AVATAR_IDS.map((id) => {
      const meta = AVATAR_META[id]; const active = id === selected;
      return <button key={id} type="button" role="radio" aria-checked={active} aria-label={meta.label} disabled={disabled} onClick={() => onSelect(id)} className={`grid size-10 place-items-center rounded-full border text-[11px] font-bold transition-transform disabled:opacity-50 ${active ? 'scale-110 border-white ring-2 ring-slate-900/15' : 'border-white/70'}`} style={{ background: `radial-gradient(circle at 32% 26%, white, ${meta.accent} 60%, ${meta.accent}aa)` }}>{meta.label.split(' ').map((w) => w[0]).join('')}</button>;
    })}
    <span aria-hidden className="grid size-9 place-items-center rounded-full border border-white/80 bg-white/70 text-slate-600"><Plus className="size-4" /></span>
  </div>;
}
