'use client';
import { ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';
import type { EventName, PostEvent } from '@/types/feed';

const queue: PostEvent[] = [];
let active = 0;
let token: string | undefined;
let account: string | undefined;
let sending = false;
const BATCH = 80;

function acknowledge(batch: PostEvent[]) {
  const ids = new Set(batch.map(event => event.id));
  for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1);
}

async function flush() {
  if (sending || !queue.length || !token) return;
  sending = true;
  const batch = queue.slice(0, BATCH);
  try {
    const response = await fetch('/api/telemetry', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }), keepalive: true,
    });
    if (response.ok) acknowledge(batch);
  } catch { /* Retain the stable event IDs for the next flush. */ }
  finally { sending = false; }
}

function beacon() {
  if (!queue.length || !token) return;
  const part = queue.slice(0, BATCH);
  const blob = new Blob([JSON.stringify({ events: part, token })], { type: 'application/json' });
  // Keep the batch for an acknowledged retry when the page resumes. SQL deduplicates by ID.
  if (!navigator.sendBeacon?.('/api/telemetry', blob)) void flush();
}

let dispose: (() => void) | undefined;
export function startTelemetry() {
  if (isDemoMode) return () => {};
  active++;
  if (active === 1) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (account && account !== session?.user.id) queue.splice(0);
      account = session?.user.id;
      token = session?.access_token;
    });
    void ensureSession().catch(() => {});
    const timer = window.setInterval(flush, 5000);
    const visibility = () => { if (document.hidden) beacon(); else void flush(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', beacon);
    dispose = () => {
      beacon();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', beacon);
      data.subscription.unsubscribe();
    };
  }
  return () => { if (--active === 0) dispose?.(); };
}

export function trackPost(postId: string, event: EventName, value = 1) {
  if (isDemoMode || !active || !Number.isFinite(value)) return;
  if (queue.length >= 2000) queue.shift();
  queue.push({ id: crypto.randomUUID(), post_id: postId, event_type: event, value });
  if (queue.length >= BATCH) void flush();
}
