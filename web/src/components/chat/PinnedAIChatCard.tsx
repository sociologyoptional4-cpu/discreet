'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, ChevronRight } from 'lucide-react';

const QUICK_STARTERS = [
  { label: '✨ Script a review', prompt: 'Help me script a 15-second honest product review' },
  { label: '🎭 Roast my vibe', prompt: 'Give me a funny playful roast to start my day' },
  { label: '💬 Just chill & chat', prompt: 'Hey! Just bored, lets talk about something random' },
];

export function PinnedAIChatCard() {
  const [lastPreview] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('vybe_ai_chat_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          const last = parsed?.[parsed.length - 1];
          if (last?.content) return last.content;
        }
      } catch {
        // Ignore
      }
    }
    return 'Always here • Ask, vent, or script a review';
  });

  return (
    <div className="space-y-2.5">
      <Link href="/chats/ai" className="block">
        <motion.div
          whileTap={{ scale: 0.97 }}
          className="relative overflow-hidden rounded-[24px] p-[1.5px] bg-gradient-to-r from-cyan-300/80 via-violet-300/80 to-amber-200/80 shadow-[0_10px_28px_rgba(124,108,255,0.12)]"
        >
          <div className="flex items-center gap-3.5 rounded-[22.5px] bg-white/85 backdrop-blur-xl px-4 py-3.5">
            <div className="relative h-12 w-12 shrink-0">
              <motion.div
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="h-12 w-12 rounded-full bg-gradient-to-tr from-cyan-300 via-violet-300 to-rose-200 p-[2px] shadow-inner flex items-center justify-center"
              >
                <div className="h-5 w-8 rounded-full bg-[#181826] flex items-center justify-center gap-1.5 shadow-sm">
                  <motion.span
                    animate={{ scaleY: [1, 0.15, 1] }}
                    transition={{ duration: 0.22, repeat: Infinity, repeatDelay: 3.4 }}
                    className="h-2 w-1 rounded-full bg-cyan-200"
                  />
                  <motion.span
                    animate={{ scaleY: [1, 0.15, 1] }}
                    transition={{ duration: 0.22, repeat: Infinity, repeatDelay: 3.4 }}
                    className="h-2 w-1 rounded-full bg-cyan-200"
                  />
                </div>
              </motion.div>
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-white" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[15px] text-[#111827] tracking-tight">
                  Vybe AI
                </span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100/90 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                  <Sparkles className="h-2.5 w-2.5" /> AI
                </span>
              </div>
              <p className="truncate text-[13px] text-slate-500 mt-0.5">{lastPreview}</p>
            </div>

            <div className="h-8 w-8 rounded-full bg-slate-100/80 flex items-center justify-center text-slate-500">
              <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </motion.div>
      </Link>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {QUICK_STARTERS.map((item) => (
          <Link
            key={item.label}
            href={`/chats/ai?prompt=${encodeURIComponent(item.prompt)}`}
            className="shrink-0 rounded-full bg-white/75 backdrop-blur-md border border-white/90 px-3 py-1.5 text-[12px] font-medium text-slate-700 shadow-sm hover:bg-white transition"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
