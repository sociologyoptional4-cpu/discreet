import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from './api';
import { ApiError } from './errors';
import type { MessageRow } from './types';

const PAGE = 30;
const POLL_MS = 4000; // Phase-2 stand-in; Phase 3 triggers the same catch-up from private Realtime hints.

export type Pending = { clientId: string; body: string; status: 'sending' | 'failed'; at: number };
export type ThreadItem =
  | { kind: 'server'; key: string; m: MessageRow }
  | { kind: 'pending'; key: string; p: Pending };

/** Pages of 30, cursor catch-up, optimistic sends keyed by a stable client id, and de-duplication. */
export function useThread(conversationId: string, me: string) {
  const qc = useQueryClient();
  const key = useMemo(() => ['messages', conversationId], [conversationId]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [offline, setOffline] = useState(false);

  const q = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.listMessages(conversationId, { beforeSeq: pageParam }),
    getNextPageParam: (last: MessageRow[]) => (last.length === PAGE ? last[last.length - 1].seq : undefined),
    retry: (n, e) => !(e instanceof ApiError && e.code === 'conversation_unavailable') && n < 1,
  });

  useEffect(() => { if (q.error instanceof ApiError && q.error.code === 'conversation_unavailable') setUnavailable(true); }, [q.error]);

  const server = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const maxSeq = server.length ? server[0].seq : 0;

  // Merge anything newer than what we hold into the first page (newest first), skipping known ids.
  const catchUp = useCallback(async () => {
    const data = qc.getQueryData<InfiniteData<MessageRow[]>>(key);
    if (!data) return;
    const top = data.pages[0]?.[0]?.seq ?? 0;
    try {
      const fresh = await api.listMessages(conversationId, { afterSeq: top });
      setOffline(false);
      if (!fresh.length) return;
      qc.setQueryData<InfiniteData<MessageRow[]>>(key, (d) => {
        if (!d) return d;
        const have = new Set(d.pages.flat().map((m) => m.id));
        const add = fresh.filter((m) => !have.has(m.id)).reverse();
        return { ...d, pages: [[...add, ...d.pages[0]], ...d.pages.slice(1)] };
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conversation_unavailable') setUnavailable(true);
      else if (e instanceof ApiError && e.offline) setOffline(true);
    }
  }, [qc, key, conversationId]);

  useEffect(() => {
    const id = setInterval(catchUp, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') catchUp(); }); // fetch missed messages on resume
    return () => { clearInterval(id); sub.remove(); };
  }, [catchUp]);

  const attempt = useCallback(async (p: Pending) => {
    try {
      const [res] = await api.sendMessage(conversationId, p.clientId, p.body);
      // Only now does the message count as sent: the server has committed it.
      qc.setQueryData<InfiniteData<MessageRow[]>>(key, (d) => {
        if (!d) return d;
        const row: MessageRow = { id: res.id, seq: res.seq, sender_id: me, client_id: p.clientId, body: p.body, created_at: res.created_at };
        if (d.pages.flat().some((m) => m.id === row.id)) return d;
        return { ...d, pages: [[row, ...d.pages[0]], ...d.pages.slice(1)] };
      });
      setPending((list) => list.filter((x) => x.clientId !== p.clientId));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conversation_unavailable') setUnavailable(true);
      setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, status: 'failed' } : x)));
    }
  }, [qc, key, conversationId, me]);

  const send = useCallback((body: string) => {
    const p: Pending = { clientId: Crypto.randomUUID(), body, status: 'sending', at: Date.now() };
    setPending((l) => [p, ...l]); // appears immediately, marked Sending
    attempt(p);
  }, [attempt]);

  const retry = useCallback((clientId: string) => {
    setPending((l) => l.map((x) => (x.clientId === clientId ? { ...x, status: 'sending' } : x)));
    const p = pending.find((x) => x.clientId === clientId);
    if (p) attempt({ ...p, status: 'sending' }); // same client id: the server returns the original if it had committed
  }, [pending, attempt]);

  const items = useMemo<ThreadItem[]>(() => {
    const known = new Set(server.map((m) => m.client_id));
    const mine = pending.filter((p) => !known.has(p.clientId)).map((p): ThreadItem => ({ kind: 'pending', key: p.clientId, p }));
    return [...mine, ...server.map((m): ThreadItem => ({ kind: 'server', key: m.id, m }))];
  }, [server, pending]);

  return { items, maxSeq, send, retry, unavailable, offline, loading: q.isPending, error: q.error, hasOlder: !!q.hasNextPage, loadOlder: () => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }, refetch: q.refetch };
}
