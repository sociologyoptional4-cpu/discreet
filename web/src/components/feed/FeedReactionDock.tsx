'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { useId, useState, type FormEvent, type MouseEvent } from 'react';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';

export type FeedTag = { label: string; onClick?: () => void };
export type FeedReaction = { emoji: string; count: number; pressed: boolean };
export type FeedToast = { id: number; who: string; emoji: string };

type Props = {
  toasts: FeedToast[];
  tags: FeedTag[];
  reactions: FeedReaction[];
  onReact: (emoji: string, x: number, y: number) => void;
  /** Null hides the input's send action and shows `vibePlaceholder` as a read-only hint. */
  onVibe: ((text: string) => void) | null;
  vibePlaceholder: string;
};

const compact = (n: number): string => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
const POP = { type: 'spring', stiffness: 400, damping: 20 } as const;
const MAX_VIBE = 500;

/** Bottom of a post: fading reaction toasts, topic pills, one row of emoji counters and a single "Add a vibe" pill. */
export function FeedReactionDock({ toasts, tags, reactions, onReact, onVibe, vibePlaceholder }: Props) {
  const [text, setText] = useState('');
  const inputId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !onVibe) return;
    onVibe(value);
    setText('');
  };
  const tap = (emoji: string) => (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onReact(emoji, box.left + box.width / 2, box.top);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul aria-live="polite" className="flex min-h-0 flex-col items-start gap-1.5">
        <AnimatePresence initial={false}>
          {toasts.slice(-2).map((t) => (
            <motion.li key={t.id} layout initial={{ opacity: 0, x: -16, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, filter: 'blur(4px)' }} transition={POP}
              className="flex items-center gap-1.5 rounded-full bg-black/35 py-1 pl-3 pr-1.5 text-xs font-semibold backdrop-blur-md">
              {t.who} <span className="text-white/60">• sent</span> <Emoji3D emoji={t.emoji} size={18} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {tags.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {tags.map((tag) => {
            const cls = 'shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-md';
            return tag.onClick
              ? <button key={tag.label} type="button" onClick={tag.onClick} className={`${cls} transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white`}>{tag.label}</button>
              : <span key={tag.label} className={cls}>{tag.label}</span>;
          })}
        </div>
      )}

      <div role="group" aria-label="Reactions" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
        {reactions.map((r) => (
          <motion.button key={r.emoji} type="button" onClick={tap(r.emoji)} aria-pressed={r.pressed} aria-label={`React ${r.emoji}${r.count ? `, ${r.count}` : ''}`}
            whileTap={{ scale: 0.82 }} whileHover={{ y: -2 }} transition={POP}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums backdrop-blur-md focus-visible:outline-2 focus-visible:outline-white ${r.pressed ? 'border-white/40 bg-white/25' : 'border-white/10 bg-black/30'}`}>
            <motion.span key={`${r.emoji}-${r.count}`} initial={{ scale: r.count ? 1.35 : 1 }} animate={{ scale: 1 }} transition={POP} className="flex">
              <Emoji3D emoji={r.emoji} size={20} />
            </motion.span>
            {r.count > 0 && compact(r.count)}
          </motion.button>
        ))}
      </div>

      <form onSubmit={submit} className="flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-black/30 pl-4 pr-1.5 backdrop-blur-md focus-within:border-white/40">
        <label className="sr-only" htmlFor={inputId}>Add a vibe</label>
        <input id={inputId} value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_VIBE))} readOnly={!onVibe} placeholder={vibePlaceholder} enterKeyHint="send" autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/55 focus:outline-none" />
        {onVibe && (
          <button type="submit" disabled={!text.trim()} aria-label="Send vibe" className="flex size-8 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white">
            <SendHorizontal aria-hidden className="size-[18px]" />
          </button>
        )}
      </form>
    </div>
  );
}
