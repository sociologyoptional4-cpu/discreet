'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ensureSession } from '@/lib/session';
import { isDemoMode } from '@/lib/supabase';

const EXPLORED_STORAGE_KEY = 'vybe_explored_lenses_v1';
const MYSTERY_DATE_KEY = 'vybe_mystery_lens_date_v1';

export type LensExplorerToastData = {
  id: number;
  title: string;
  xp: number;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useLensGamification() {
  const [exploredIds, setExploredIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(EXPLORED_STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const [mysteryUsedToday, setMysteryUsedToday] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(MYSTERY_DATE_KEY) === todayKey();
    } catch {
      return false;
    }
  });

  const [sessionCount, setSessionCount] = useState(0);
  const [toast, setToast] = useState<LensExplorerToastData | null>(null);
  const [mysteryBurstActive, setMysteryBurstActive] = useState(false);

  const sessionTriedRef = useRef(new Set<string>());
  const toastTimerRef = useRef<number | null>(null);

  const syncXpToBackend = useCallback(async (xp: number) => {
    if (isDemoMode || xp <= 0) return;
    try {
      const token = await ensureSession();
      if (!token) return;
      await fetch('/api/feed/xp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ xp }),
        keepalive: true,
      });
    } catch {
      // non-fatal XP sync failure
    }
  }, []);

  const showToast = useCallback((title: string, xp: number) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), title, xp });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const recordLensTry = useCallback(
    (lensId: string) => {
      if (!lensId || lensId === 'clean' || lensId === 'none' || lensId === '__mystery__') return;

      let awardedXp = 0;
      if (!exploredIds.has(lensId)) {
        awardedXp += 5;
        const next = new Set(exploredIds);
        next.add(lensId);
        setExploredIds(next);
        try {
          window.localStorage.setItem(EXPLORED_STORAGE_KEY, JSON.stringify(Array.from(next)));
        } catch {
          // ignore
        }
      }

      if (!sessionTriedRef.current.has(lensId)) {
        sessionTriedRef.current.add(lensId);
        const count = sessionTriedRef.current.size;
        setSessionCount(count);
        if (count === 3) {
          awardedXp += 25;
          showToast('Lens Explorer (3/3)', 25);
        } else if (awardedXp > 0) {
          showToast('New Lens Discovered', awardedXp);
        }
      } else if (awardedXp > 0) {
        showToast('New Lens Discovered', awardedXp);
      }

      if (awardedXp > 0) {
        void syncXpToBackend(awardedXp);
      }
    },
    [exploredIds, showToast, syncXpToBackend]
  );

  const triggerMysteryUnlock = useCallback(
    <T extends { id: string }>(pool: T[]): T | null => {
      if (pool.length === 0) return null;
      const unexplored = pool.filter((item) => !exploredIds.has(item.id));
      const candidates = unexplored.length > 0 ? unexplored : pool;
      const picked = candidates[Math.floor(Math.random() * candidates.length)];

      setMysteryBurstActive(true);
      window.setTimeout(() => setMysteryBurstActive(false), 550);

      if (!mysteryUsedToday) {
        setMysteryUsedToday(true);
        try {
          window.localStorage.setItem(MYSTERY_DATE_KEY, todayKey());
        } catch {
          // ignore
        }
        showToast('Daily Mystery Lens', 20);
        void syncXpToBackend(20);
      } else {
        showToast('Mystery Shuffle', 5);
        void syncXpToBackend(5);
      }

      return picked;
    },
    [exploredIds, mysteryUsedToday, showToast, syncXpToBackend]
  );

  return {
    exploredIds,
    mysteryUsedToday,
    sessionCount,
    toast,
    mysteryBurstActive,
    recordLensTry,
    triggerMysteryUnlock,
  };
}

export function LensExplorerToast({ toast }: { toast: LensExplorerToastData | null }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: -16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          role="status"
          className="pointer-events-none absolute left-1/2 top-[max(4.4rem,calc(env(safe-area-inset-top)+3.6rem))] z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/95 bg-white/85 px-3.5 py-1.5 text-xs font-extrabold text-slate-900 shadow-lg backdrop-blur-xl"
        >
          <span>✨ {toast.title}</span>
          <span className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-black text-white">
            +{toast.xp} XP
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MysteryBurstOverlay({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: [0, 0.95, 0], scale: [0.7, 1.25, 1.45] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-25 bg-[radial-gradient(circle_at_center,rgba(244,114,182,0.45),rgba(139,92,246,0.28),transparent_70%)]"
        />
      )}
    </AnimatePresence>
  );
}
