'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import type { SearchResult } from '@/types/social';

type Mood = 'joy' | 'angry' | 'surprised' | 'sad' | 'chill';
const MOODS: { id: Mood; label: string; color: string; face: string }[] = [
  { id: 'joy', label: 'Joyful', color: '#7ED957', face: '⌣' },
  { id: 'angry', label: 'Rant', color: '#B84A5E', face: '⌢' },
  { id: 'surprised', label: 'Surprised', color: '#9B87F5', face: 'o' },
  { id: 'sad', label: 'Disappointed', color: '#91A9E8', face: '⌢' },
  { id: 'chill', label: 'Chill', color: '#7CC6FE', face: '–' },
];

export function EmotionDiscoveryHub({ reviews, selected, onSelect }: { reviews: SearchResult[]; selected: Mood | 'all'; onSelect: (mood: Mood | 'all') => void }) {
  const [active, setActive] = useState(0); const reduce = useReducedMotion();
  const mood = MOODS[active];
  const count = (key: Mood) => reviews.filter((r) => r.emotion_tag === key).length;
  return <section className="rounded-[26px] border border-white/75 bg-white/55 p-4 shadow-[0_10px_32px_rgba(15,23,42,.06)] backdrop-blur-xl" aria-label="Emotion breakdown">
    <div className="flex items-center justify-between">
      <div><p className="text-[10px] font-semibold tracking-[.16em] text-slate-500">COMMUNITY VIBE</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{mood.label} reviews</h2></div>
      <motion.button type="button" aria-label={`Filter ${mood.label} reviews`} aria-pressed={selected === mood.id} onClick={() => onSelect(selected === mood.id ? 'all' : mood.id)} className="relative grid size-[72px] place-items-center rounded-full border border-white/80" style={{ background: `radial-gradient(circle at 32% 25%, white, ${mood.color} 65%, ${mood.color}80)`, boxShadow: `inset -6px -8px 14px ${mood.color}70, 0 8px 20px ${mood.color}55` }} animate={reduce ? undefined : { y: [0, -3, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} onTouchStart={(e) => { e.currentTarget.dataset.x = String(e.touches[0]?.clientX ?? 0); }} onTouchEnd={(e) => { const start = Number(e.currentTarget.dataset.x ?? 0); const end = e.changedTouches[0]?.clientX ?? start; if (Math.abs(end - start) > 24) setActive((i) => (i + (end < start ? 1 : -1) + MOODS.length) % MOODS.length); }}>
        <span aria-hidden className="text-2xl font-black text-slate-800">{mood.face}</span><span className="absolute -bottom-2 rounded-full border border-white bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">{count(mood.id)}</span>
      </motion.button>
    </div>
    <div className="mt-5 grid grid-cols-5 gap-2">
      {MOODS.map((item) => { const n = count(item.id); const chosen = selected === item.id; return <button key={item.id} type="button" aria-pressed={chosen} onClick={() => { setActive(MOODS.indexOf(item)); onSelect(chosen ? 'all' : item.id); }} className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-[10px] text-slate-600 focus-visible:outline-2 focus-visible:outline-slate-800">
        <span className="flex h-14 w-5 flex-col-reverse gap-0.5 overflow-hidden rounded-full bg-slate-200/70 p-[2px]">{Array.from({ length: 5 }, (_, i) => <i key={i} className="flex-1 rounded-full" style={{ backgroundColor: i < Math.min(5, Math.ceil(n / Math.max(1, reviews.length) * 5)) ? item.color : 'transparent' }} />)}</span>
        <span className="truncate">{item.label}</span><span className={`grid size-7 place-items-center rounded-full ${chosen ? 'text-white' : 'bg-white text-slate-600'}`} style={chosen ? { backgroundColor: item.color } : undefined}>{n}</span>
      </button>; })}
    </div>
  </section>;
}
