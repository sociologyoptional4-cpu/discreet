'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptConversation, declineConversation, fetchConversations, requestConversation } from '@/lib/chatData';
import { splitConversations, type ConversationItem } from '@/lib/conversations';
import { currentUserId } from '@/lib/session';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';

const REFRESH_DELAY_MS = 250;
const DEFAULT_AI_SCOUTS = [
  '11111111-1111-4111-8111-111111111201',
  '11111111-1111-4111-8111-111111111202',
  '11111111-1111-4111-8111-111111111203',
] as const;

export type Conversations = {
  /** Requests other people sent, waiting for an answer. */
  incoming: ConversationItem[];
  /** Accepted chats, most recent message first. */
  accepted: ConversationItem[];
  isLoading: boolean;
  error: string | null;
  accept: (id: string) => Promise<boolean>;
  decline: (id: string) => Promise<boolean>;
};

/** The chat inbox. It refreshes itself when a request arrives, is accepted, or a new message moves a chat up. */
export function useConversations(): Conversations {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const viewerRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seededRef = useRef(false);

  const reload = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      let next = await fetchConversations(viewer);
      if (next.length === 0 && !seededRef.current) {
        seededRef.current = true;
        await Promise.all(
          DEFAULT_AI_SCOUTS.map((scoutId) => requestConversation(viewer, scoutId, 'Wave 👋').catch(() => null))
        );
        next = await fetchConversations(viewer);
      }
      if (aliveRef.current) { setItems(next); setError(null); }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'Could not load your chats.');
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void currentUserId().then(async (viewer) => {
      if (cancelled) return;
      viewerRef.current = viewer;
      if (viewer) {
        await reload();
        if (cancelled) return;
        channel = supabase
          .channel(`inbox:${viewer}:${safeRandomUUID().slice(0, 8)}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
            if (cancelled) return;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => void reload(), REFRESH_DELAY_MS);
          })
          .subscribe((status) => {
            if (!cancelled && status === 'SUBSCRIBED') void reload();
          });
      }
      setIsLoading(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : 'Could not open your inbox.');
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [reload]);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    }
  }, [reload]);

  const accept = useCallback((id: string) => run(() => acceptConversation(id)), [run]);
  const decline = useCallback((id: string) => run(() => declineConversation(id)), [run]);

  const { incoming, accepted } = splitConversations(items);
  return { incoming, accepted, isLoading, error, accept, decline };
}
