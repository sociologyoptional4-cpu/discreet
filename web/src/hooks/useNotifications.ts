'use client';
import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { AvatarId } from '@/types/avatar';

export type NotificationItem = {
  id: string;
  type: 'like' | 'follow';
  post_id: string | null;
  is_read: boolean;
  created_at: string;
  /** Who did it. Null only if that profile can no longer be read. */
  actor: { username: string; avatar_id: AvatarId } | null;
};

export type NotificationsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  notifications: NotificationItem[];
  unreadCount: number;
};

export type UseNotifications = NotificationsState & { markAllAsRead: () => Promise<void> };

const RECENT_LIMIT = 50;
const REFRESH_DELAY_MS = 200;
const EMPTY: NotificationsState = { status: 'idle', notifications: [], unreadCount: 0 };

/*
 * One shared store for the whole app, so the bottom bar badge and the notifications page always agree and only one
 * Realtime channel is open. It starts when the first component uses the hook and stops when the last one leaves.
 */
let state: NotificationsState = EMPTY;
const listeners = new Set<() => void>();
let users = 0;
let viewerId: string | null = null;
let channel: RealtimeChannel | null = null;
let authListener: { unsubscribe: () => void } | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0; // bumped when the viewer changes, so a slow response for the previous viewer is dropped

function setState(next: Partial<NotificationsState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

type Actor = NotificationItem['actor'];
type Row = Omit<NotificationItem, 'actor'> & { actor: Actor | Actor[] };

const toItem = (row: Row): NotificationItem => ({ ...row, actor: Array.isArray(row.actor) ? (row.actor[0] ?? null) : row.actor });

async function fetchUnreadCount(userId: string): Promise<number | null> {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', userId).eq('is_read', false);
  return error ? null : (count ?? 0);
}

async function load(userId: string): Promise<void> {
  const mine = generation;
  const [list, unread] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, post_id, is_read, created_at, actor:users!actor_id(username, avatar_id)')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),
    fetchUnreadCount(userId),
  ]);
  if (mine !== generation) return;
  if (list.error || unread === null) {
    setState({ status: 'error' });
    return;
  }
  setState({ status: 'ready', notifications: (list.data as unknown as Row[]).map(toItem), unreadCount: unread });
}

/** Other tabs or devices marking things read (or an unlike removing a row) change the count; re-ask the server once things settle. */
function scheduleRefresh(userId: string): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (userId === viewerId) void load(userId);
  }, REFRESH_DELAY_MS);
}

async function onInsert(row: { id: string; actor_id: string; type: 'like' | 'follow'; post_id: string | null; is_read: boolean; created_at: string }): Promise<void> {
  const mine = generation;
  if (state.notifications.some((n) => n.id === row.id)) return;
  setState({ unreadCount: state.unreadCount + (row.is_read ? 0 : 1) }); // the badge moves at once; the name follows
  const { data } = await supabase.from('users').select('username, avatar_id').eq('id', row.actor_id).maybeSingle();
  if (mine !== generation || state.notifications.some((n) => n.id === row.id)) return;
  const item: NotificationItem = { id: row.id, type: row.type, post_id: row.post_id, is_read: row.is_read, created_at: row.created_at, actor: (data as Actor) ?? null };
  setState({ notifications: [item, ...state.notifications].slice(0, RECENT_LIMIT) });
}

function openChannel(userId: string): void {
  channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, (payload) => {
      void onInsert(payload.new as Parameters<typeof onInsert>[0]);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, () => scheduleRefresh(userId))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications' }, () => scheduleRefresh(userId))
    .subscribe();
}

function closeChannel(): void {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function followViewer(userId: string | null): void {
  if (userId === viewerId) return; // token refreshes fire the auth listener too; nothing to do
  generation += 1;
  closeChannel();
  viewerId = userId;
  if (!userId) {
    setState(EMPTY);
    return;
  }
  setState({ ...EMPTY, status: 'loading' });
  openChannel(userId);
  void load(userId);
}

function start(): void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    // Calling Supabase from inside this callback can deadlock, so hand the work to the next tick.
    setTimeout(() => followViewer(session?.user.id ?? null), 0);
  });
  authListener = data.subscription;
}

function stop(): void {
  authListener?.unsubscribe();
  authListener = null;
  generation += 1;
  closeChannel();
  viewerId = null;
  state = EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (isSupabaseConfigured && users === 0) start();
  users += 1;
  return () => {
    listeners.delete(listener);
    users -= 1;
    if (users === 0 && isSupabaseConfigured) stop();
  };
}

const getSnapshot = (): NotificationsState => state;
const getServerSnapshot = (): NotificationsState => EMPTY;

async function markAllAsRead(): Promise<void> {
  const userId = viewerId;
  if (!userId || state.unreadCount === 0) return;
  setState({ unreadCount: 0, notifications: state.notifications.map((n) => ({ ...n, is_read: true })) });
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('recipient_id', userId).eq('is_read', false);
  if (error) void load(userId); // the write failed: show what the server really has
}

/** Recent notifications, a live unread count, and `markAllAsRead`. Shared by every component that calls it. */
export function useNotifications(): UseNotifications {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...snapshot, markAllAsRead };
}
