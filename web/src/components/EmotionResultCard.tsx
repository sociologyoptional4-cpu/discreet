'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { handleShare } from '@/lib/share';

const MOODS = [
  { id: 'joy', name: 'Joyful', color: '#7ED957' },
  { id: 'angry', name: 'Rants', color: '#B84A5E' },
  { id: 'surprised', name: 'Surprised', color: '#9B87F5' },
  { id: 'chill', name: 'Chill', color: '#7CC6FE' },
];

export function EmotionResultCard({ username, counts, dominant }: { username: string; counts: Record<string, number>; dominant: string }) {
  const [status, setStatus] = useState('');
  const share = async () => {
    const result = await handleShare({ title: `${username}'s creator vibe`, text: 'My creator vibe on Vybe', url: window.location.href });
    setStatus(result === 'copied' ? 'Link copied' : result === 'failed' ? 'Could not share this vibe' : '');
  };
  return <section className="relative mt-5 w-full overflow-hidden rounded-[26px] border border-white/85 bg-white/70 p-5 text-left shadow-[0_14px_40px_rgba(15,23,42,.07)] backdrop-blur-2xl">
    <span className="text-[10px] font-semibold tracking-[0.18em] text-slate-500">CREATOR VIBE</span>
    <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{dominant === 'angry' ? 'Brutally Honest' : dominant === 'surprised' ? 'Curious Discoverer' : dominant === 'sad' ? 'Thoughtful Critic' : dominant === 'chill' ? 'Calm Reviewer' : 'Joyful Reviewer'}</h2>
    <div className="mt-5 grid grid-cols-4 gap-2">
      {MOODS.map((mood) => <div key={mood.name} className="relative flex min-h-[74px] flex-col items-center justify-center overflow-hidden rounded-2xl bg-white/55">
        <span aria-hidden className="absolute size-12 rounded-full opacity-25 blur-lg" style={{ backgroundColor: mood.color }} />
        <strong className="relative text-lg tabular-nums text-slate-900">{String(counts[mood.id] ?? 0).padStart(2, '0')}</strong><span className="relative text-[10px] text-slate-500">{mood.name}</span>
      </div>)}
    </div>
    <button type="button" onClick={() => void share()} className="acrylic-pill mt-4 inline-flex min-h-11 items-center gap-2 bg-sky-100/70 px-4 text-sm font-semibold"><Share2 className="size-4" /> Share vibe</button>
    {status && <span role="status" className="ml-3 text-xs text-slate-500">{status}</span>}
  </section>;
}
