'use client';
import { useId } from 'react';
import type { ExpiryTier } from '@/types/privacy';

const EXPIRY: { tier: ExpiryTier; label: string }[] = [
  { tier: '1d', label: '1 Day' },
  { tier: '1w', label: '1 Week' },
  { tier: '1y', label: '1 Year' },
  { tier: 'never', label: 'Never' },
];

type Props = { value: ExpiryTier; onChange: (tier: ExpiryTier) => void };

/** "Delete this snap after" pills, shared by the video preview and the 3D mask preview. */
export function ExpirySelector({ value, onChange }: Props) {
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className="mb-2 text-xs font-medium text-white/60">Delete this snap after</p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {EXPIRY.map(({ tier, label }) => (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={value === tier}
            onClick={() => onChange(tier)}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 motion-reduce:transition-none ${
              value === tier ? 'bg-white text-[#0A0A0A]' : 'border border-white/15 bg-white/10 text-white/85 hover:bg-white/15'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {value === 'never' && <p className="mt-2 text-xs text-white/60">Free accounts keep up to 5 permanent posts.</p>}
    </div>
  );
}
