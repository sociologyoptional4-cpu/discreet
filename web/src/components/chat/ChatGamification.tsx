'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';
import {
  QUEST_EVENT, STREAK_TIER_META, XP_REWARD, dayKey, levelFor, questFor, questSnapshot, readProgress, readQuest,
  streakTier, writeProgress, writeQuest, type LevelInfo, type XpEvent,
} from '@/lib/chat/gamification';
import type { StreakStatus } from '@/types/chat';

const TIER_STYLE = {
  spark: 'bg-cyan-50 text-cyan-700 shadow-[0_0_14px_rgba(34,211,238,.45)]',
  flame: 'bg-orange-50 text-orange-700 shadow-[0_0_14px_rgba(251,146,60,.45)]',
  prism: 'text-violet-800 shadow-[0_0_16px_rgba(167,139,250,.5)] bg-[conic-gradient(from_0deg,#fde68a,#fbcfe8,#c4b5fd,#a5f3fc,#bbf7d0,#fde68a)] bg-[length:200%_200%] animate-[prism-shift_4s_linear_infinite]',
  crown: 'bg-gradient-to-br from-amber-100 to-yellow-300 text-amber-900 shadow-[0_0_18px_rgba(251,191,36,.6)]',
} as const;

/** Streak chip whose look evolves with the streak length; shows ⌛ when it is about to expire. */
export function StreakBadge({ count, status, shield = false, compact = false }: { count: number; status: StreakStatus; shield?: boolean; compact?: boolean }) {
  const reduce = useReducedMotion();
  const tier = streakTier(count);
  if (tier === 'none') return null;
  const meta = STREAK_TIER_META[tier];
  const expiring = status === 'expiring_soon';
  const label = `${count}-day streak, ${meta.label}${expiring ? ', expiring soon' : ''}${shield ? ', streak shield available' : ''}`;
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${TIER_STYLE[tier]}`}>
      <motion.span aria-hidden animate={reduce ? undefined : tier === 'flame' || tier === 'prism' ? { scale: [1, 1.15, 0.95, 1.1, 1], rotate: [0, -6, 4, -3, 0] } : { scale: [1, 1.12, 1] }}
        transition={{ duration: tier === 'spark' ? 1.6 : 1.1, repeat: Infinity, ease: 'easeInOut' }} className="inline-block">
        {meta.emoji}
      </motion.span>
      {count}
      {!compact && expiring && <span aria-hidden>⌛</span>}
      {!compact && shield && <span aria-hidden>🛡️</span>}
    </span>
  );
}

/** Relationship XP for one chat, stored on this device. `award` returns nothing; level-ups surface as `levelUp`. */
export function useChatXp(conversationId: string, streakActive: boolean) {
  const [xp, setXp] = useState(() => readProgress(conversationId).xp);
  const [levelUp, setLevelUp] = useState<LevelInfo | null>(null);
  const xpRef = useRef(xp);

  const add = useCallback((amount: number, streakDay?: string) => {
    const before = levelFor(xpRef.current);
    const next = xpRef.current + amount;
    xpRef.current = next;
    const saved = readProgress(conversationId);
    writeProgress(conversationId, { xp: next, streakDay: streakDay ?? saved.streakDay });
    setXp(next);
    const after = levelFor(next);
    if (after.level > before.level) setLevelUp(after);
  }, [conversationId]);

  const award = useCallback((event: XpEvent) => add(XP_REWARD[event]), [add]);

  // Keeping the streak alive pays once per day.
  useEffect(() => {
    if (!streakActive) return;
    const today = dayKey(new Date());
    if (readProgress(conversationId).streakDay === today) return;
    const t = setTimeout(() => add(XP_REWARD.streak, today), 600);
    return () => clearTimeout(t);
  }, [streakActive, conversationId, add]);

  return { xp, info: levelFor(xp), award, addBonus: add, levelUp, dismissLevelUp: () => setLevelUp(null) };
}

/** Slim frosted XP bar for the thread header. */
export function VibeMeter({ info, xp }: { info: LevelInfo; xp: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Level ${info.level}: ${info.name}, ${xp} XP${info.next ? ` of ${info.next}` : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(info.progress * 100)}>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">Lvl {info.level} · {info.name}</span>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/[.06] shadow-inner">
        <motion.span className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-cyan-300 via-violet-400 to-pink-300"
          initial={false} animate={{ scaleX: Math.max(0.03, info.progress) }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </span>
    </div>
  );
}

const CONFETTI = ['#67e8f9', '#c4b5fd', '#f9a8d4', '#fde68a', '#86efac'];

/** Celebration sheet with a confetti burst when a chat crosses into a new level. */
export function LevelUpModal({ info, onClose }: { info: LevelInfo | null; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [pieces] = useState(() => Array.from({ length: 28 }, (_, i) => ({ x: (Math.random() - 0.5) * 340, y: -120 - Math.random() * 260, r: Math.random() * 540, c: CONFETTI[i % CONFETTI.length], d: Math.random() * 0.2 })));
  useEffect(() => {
    if (!info) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [info, onClose]);
  return (
    <AnimatePresence>
      {info && (
        <motion.div role="dialog" aria-modal="true" aria-labelledby="level-up-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/20 p-6 backdrop-blur-sm">
          {!reduce && pieces.map((p, i) => (
            <motion.span key={i} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-1.5 rounded-sm" style={{ background: p.c }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }} animate={{ x: p.x, y: [0, p.y, p.y + 420], opacity: [1, 1, 0], rotate: p.r }} transition={{ duration: 1.8, delay: p.d, ease: 'easeOut' }} />
          ))}
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.7, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="relative w-full max-w-xs rounded-[32px] border border-white/90 bg-white/80 p-6 text-center shadow-[0_24px_60px_rgba(15,23,42,.18)] backdrop-blur-2xl">
            <Emoji3D emoji="🎉" size={72} className="mx-auto" />
            <p className="mt-3 text-xs font-bold uppercase tracking-[.2em] text-violet-500">Level {info.level} unlocked</p>
            <h2 id="level-up-title" className="mt-1 text-2xl font-black text-slate-900">{info.name}</h2>
            <p className="mt-1 text-sm text-slate-500">Your vibe with this chat just levelled up.</p>
            <button type="button" autoFocus onClick={onClose} className="mt-5 min-h-11 w-full rounded-full bg-slate-900 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400">Let’s go</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const subscribeQuest = (cb: () => void) => {
  window.addEventListener(QUEST_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(QUEST_EVENT, cb); window.removeEventListener('storage', cb); };
};

/** Dismissible daily goal with a progress ring, for the top of /chats. */
export function DailyQuestPill() {
  const snapshot = useSyncExternalStore(subscribeQuest, questSnapshot, () => null);
  if (snapshot === null) return null; // server render: storage is unknown
  const today = snapshot.slice(0, snapshot.indexOf('|'));
  const quest = questFor(today);
  const state = readQuest(today);
  if (state.dismissed) return null;
  const progress = Math.min(1, state.count / quest.goal);
  const R = 11;
  const C = 2 * Math.PI * R;
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="acrylic-pill mx-4 mt-3 flex items-center gap-3 py-1.5 pl-1.5 pr-2">
      <span className="relative flex size-9 shrink-0 items-center justify-center">
        <svg aria-hidden viewBox="0 0 28 28" className="absolute inset-0 -rotate-90">
          <circle cx="14" cy="14" r={R} fill="none" stroke="rgba(15,23,42,.08)" strokeWidth="3" />
          <motion.circle cx="14" cy="14" r={R} fill="none" stroke="url(#quest-ring)" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} initial={false} animate={{ strokeDashoffset: C * (1 - progress) }} />
          <defs><linearGradient id="quest-ring"><stop stopColor="#67e8f9" /><stop offset="1" stopColor="#c084fc" /></linearGradient></defs>
        </svg>
        <span aria-hidden className="text-sm">{state.claimed ? '✅' : '🎯'}</span>
      </span>
      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">
        {state.claimed ? 'Quest done' : quest.label} <span className="font-bold text-violet-600">• +{quest.reward} XP</span>
        <span className="sr-only">, {state.count} of {quest.goal}</span>
      </p>
      <button type="button" aria-label="Dismiss today’s quest" onClick={() => writeQuest({ ...state, dismissed: true })} className="flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700">✕</button>
    </motion.div>
  );
}
