import type { Session } from '@supabase/supabase-js';
import { DEMO_VIEWER_ID } from '@/lib/demoData';
import { isDemoMode, supabase } from '@/lib/supabase';

let pending: Promise<Session> | null = null;

/**
 * The current session, creating an anonymous one on first use (Supabase "Anonymous sign-ins").
 * Concurrent callers share one sign-in, so a double tap never creates two accounts.
 */
export function ensureSession(): Promise<Session> {
  if (isDemoMode) return Promise.resolve({ access_token: 'demo', user: { id: DEMO_VIEWER_ID } } as Session);
  pending ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    const { data: created, error } = await supabase.auth.signInAnonymously();
    if (error || !created.session) throw new Error('Could not start a session. Check that anonymous sign-ins are enabled.');
    return created.session;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** The signed-in user's id, or null when there is no session yet. Never creates one. */
export async function currentUserId(): Promise<string | null> {
  if (isDemoMode) return DEMO_VIEWER_ID;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
