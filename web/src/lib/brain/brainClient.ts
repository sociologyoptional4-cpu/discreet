'use client';

import type { SwipeTelemetry } from '@/lib/brain/recursiveBrain';
import { ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';

export type QueuedBrainSignal = SwipeTelemetry & { postId: string };

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 20_000;
const queue: QueuedBrainSignal[] = [];

let active = 0;
let token: string | undefined;
let account: string | undefined;
let sending = false;
let activeGenomeId: string | null = null;
let dispose: (() => void) | undefined;

export function setActiveGenomeId(id: string | null | undefined): void {
  if (typeof id === 'string' && id.length > 0) activeGenomeId = id;
}

export function getActiveGenomeId(): string | null {
  return activeGenomeId;
}

async function flushBrainSignals(): Promise<void> {
  if (sending || queue.length === 0 || !token) return;
  sending = true;
  const batch = queue.splice(0, 25);
  try {
    const res = await fetch('/api/brain/signal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        genomeId: activeGenomeId,
        signals: batch,
      }),
      keepalive: true,
    });
    if (!res.ok) {
      queue.unshift(...batch);
      if (queue.length > 100) queue.length = 100;
    }
  } catch {
    queue.unshift(...batch);
    if (queue.length > 100) queue.length = 100;
  } finally {
    sending = false;
  }
}

function beaconBrainSignals(): void {
  if (queue.length === 0 || !token) return;
  const batch = queue.splice(0, 25);
  const blob = new Blob(
    [JSON.stringify({ token, genomeId: activeGenomeId, signals: batch })],
    { type: 'application/json' },
  );
  if (!navigator.sendBeacon?.('/api/brain/signal', blob)) {
    queue.unshift(...batch);
    void flushBrainSignals();
  }
}

export function startBrainSignals(): () => void {
  if (isDemoMode) return () => {};
  active++;
  if (active === 1) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (account && account !== session?.user.id) queue.splice(0);
      account = session?.user.id;
      token = session?.access_token;
    });
    void ensureSession().catch(() => {});
    const flushIntervalMs = Math.round(FLUSH_INTERVAL_MS * (0.8 + Math.random() * 0.4));
    const timer = window.setInterval(() => void flushBrainSignals(), flushIntervalMs);
    const onVisibility = () => {
      if (document.hidden) beaconBrainSignals();
      else void flushBrainSignals();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', beaconBrainSignals);
    dispose = () => {
      beaconBrainSignals();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', beaconBrainSignals);
      data.subscription.unsubscribe();
    };
  }
  return () => {
    if (--active === 0) dispose?.();
  };
}

/**
 * Queues a swipe's watch/skip/rewatch telemetry and flushes in batches of 5 (or via sendBeacon on tab hide)
 * so Postgres avoids hot-row lock contention on every single swipe.
 */
export function queueBrainSwipe(signal: QueuedBrainSignal): void {
  if (isDemoMode || !active) return;
  if (queue.length >= 100) queue.shift();
  queue.push(signal);
  if (queue.length >= BATCH_SIZE) {
    void flushBrainSignals();
  }
}
