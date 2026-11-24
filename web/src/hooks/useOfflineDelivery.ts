'use client';
import { useEffect } from 'react';
import { runOutbox } from '@/lib/offlineQueue';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/** Resume durable sends throughout the app, including a fresh visit outside the original thread. */
export function useOfflineDelivery() {
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let stop: (() => void) | undefined;
    let activeUser: string | undefined;
    const {data} = supabase.auth.onAuthStateChange((_event, session) => {
      if (activeUser === session?.user.id) return;
      stop?.();
      activeUser = session?.user.id;
      if (activeUser) {
        // Supabase invokes auth callbacks under its session lock. Start after it releases the lock.
        const user = activeUser;
        const timer = setTimeout(() => {
          stop = runOutbox(user, () => {}); // Storage/network failures retry on the next wake.
        }, 0);
        stop = () => clearTimeout(timer);
      }
    });
    return () => { data.subscription.unsubscribe(); stop?.(); };
  }, []);
}
