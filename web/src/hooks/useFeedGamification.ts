'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';

export type FeedGamificationState = {
  vibeXp: number;
  vibeLevel: number;
  dailyWatchStreak: number;
  sessionStreak: number;
  lastAward: { amount: number; reason: string; id: number } | null;
};

const XP_WATCH_75 = 5;
const XP_REACTION = 3;
const XP_NUDGE_CLICK = 10;
const XP_STREAK_5 = 20;
const FLUSH_INTERVAL_MS = 15_000;

export function useFeedGamification() {
  const [state, setState] = useState<FeedGamificationState>({
    vibeXp: 0,
    vibeLevel: 1,
    dailyWatchStreak: 0,
    sessionStreak: 0,
    lastAward: null,
  });

  const pendingXpRef = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const watchedIdsRef = useRef(new Set<string>());
  const flushingRef = useRef(false);

  const flushXp = useCallback(async (useBeacon = false) => {
    const amount = pendingXpRef.current;
    const token = tokenRef.current;
    if (isDemoMode || amount <= 0 || !token) return;

    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      pendingXpRef.current = 0;
      const blob = new Blob([JSON.stringify({ xp: amount, token })], { type: 'application/json' });
      const queued = navigator.sendBeacon('/api/feed/xp', blob);
      if (!queued) pendingXpRef.current += amount;
      return;
    }

    if (flushingRef.current) return;
    flushingRef.current = true;
    pendingXpRef.current = 0;
    try {
      const res = await fetch('/api/feed/xp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ xp: amount }),
        keepalive: true,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          vibe_xp?: number;
          vibe_level?: number;
          daily_watch_streak?: number;
        };
        setState((prev) => ({
          ...prev,
          vibeXp: Math.max(prev.vibeXp, data.vibe_xp ?? prev.vibeXp),
          vibeLevel: data.vibe_level ?? prev.vibeLevel,
          dailyWatchStreak: data.daily_watch_streak ?? prev.dailyWatchStreak,
        }));
      } else {
        pendingXpRef.current += amount;
      }
    } catch {
      pendingXpRef.current += amount;
    } finally {
      flushingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isDemoMode) return;
    let alive = true;
    void ensureSession()
      .then(async (session) => {
        if (!alive) return;
        tokenRef.current = session.access_token;
        const { data } = await supabase
          .from('users')
          .select('vibe_xp,vibe_level,daily_watch_streak')
          .eq('id', session.user.id)
          .maybeSingle();
        if (alive && data) {
          setState((prev) => ({
            ...prev,
            vibeXp: data.vibe_xp ?? prev.vibeXp,
            vibeLevel: data.vibe_level ?? prev.vibeLevel,
            dailyWatchStreak: data.daily_watch_streak ?? prev.dailyWatchStreak,
          }));
        }
      })
      .catch(() => {});

    const timer = window.setInterval(() => {
      void flushXp(false);
    }, FLUSH_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushXp(true);
    };
    const onPageHide = () => {
      void flushXp(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void flushXp(true);
    };
  }, [flushXp]);

  const award = useCallback((amount: number, reason: string, extraStreak?: number) => {
    pendingXpRef.current += amount;
    setState((prev) => {
      const nextXp = prev.vibeXp + amount;
      return {
        ...prev,
        vibeXp: nextXp,
        vibeLevel: Math.max(1, Math.floor(nextXp / 100) + 1),
        sessionStreak: extraStreak ?? prev.sessionStreak,
        lastAward: { amount, reason, id: Date.now() },
      };
    });
  }, []);

  const recordWatchProgress = useCallback(
    (postId: string, completionRate: number) => {
      if (completionRate < 0.75 || watchedIdsRef.current.has(postId)) return;
      watchedIdsRef.current.add(postId);
      setState((prev) => {
        const nextStreak = prev.sessionStreak + 1;
        const streakBonus = nextStreak > 0 && nextStreak % 5 === 0 ? XP_STREAK_5 : 0;
        const total = XP_WATCH_75 + streakBonus;
        pendingXpRef.current += total;
        const nextXp = prev.vibeXp + total;
        return {
          ...prev,
          vibeXp: nextXp,
          vibeLevel: Math.max(1, Math.floor(nextXp / 100) + 1),
          sessionStreak: nextStreak,
          lastAward: {
            amount: total,
            reason: streakBonus > 0 ? '5-video streak bonus!' : 'Watched clip',
            id: Date.now(),
          },
        };
      });
    },
    [],
  );

  const awardReaction = useCallback(() => {
    award(XP_REACTION, 'Reaction');
  }, [award]);

  const awardNudgeClick = useCallback(() => {
    award(XP_NUDGE_CLICK, 'AI Nudge');
  }, [award]);

  return {
    ...state,
    recordWatchProgress,
    awardReaction,
    awardNudgeClick,
    flushXp,
  };
}
