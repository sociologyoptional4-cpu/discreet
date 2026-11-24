'use client';
import { useId } from 'react';
import { Ghost } from 'lucide-react';

type Props = { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean };

/** Incog Burner switch: the post shows a random Anon_XXXXX alias instead of the creator and is deleted after 24 hours. */
export function IncogToggle({ checked, onChange, disabled = false }: Props) {
  const labelId = useId();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3">
      <Ghost aria-hidden className={`size-5 shrink-0 ${checked ? 'text-violet-300' : 'text-white/60'}`} />
      <p id={labelId} className="flex-1 text-sm font-medium leading-snug text-white">
        Incog Burner
        <span className="block text-xs font-normal text-white/65">Hide my @username &amp; auto-delete in 24h</span>
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 motion-reduce:transition-none disabled:opacity-50 ${checked ? 'bg-violet-500' : 'bg-white/25'}`}
      >
        <span aria-hidden className={`absolute left-1 top-1 size-6 rounded-full bg-white transition-transform motion-reduce:transition-none ${checked ? 'translate-x-6' : ''}`} />
      </button>
    </div>
  );
}
