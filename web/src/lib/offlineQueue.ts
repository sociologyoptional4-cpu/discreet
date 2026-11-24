'use client';
import type { Outgoing } from '@/types/chat';
import { supabase } from '@/lib/supabase';
import { uploadPrivateSnap } from '@/lib/r2Upload';
import type { MessageRow } from '@/lib/chatMessages';

export const MESSAGE_COLUMNS = 'id,client_msg_id,conversation_id,sender_id,type,content,snap_mode,avatar_id,media_url,motion_url,story_id,status,is_saved,r2_key,motion_r2_key,max_views,view_count,replayed_by_recipient,viewed_at,expires_at,created_at';
type Update = { row: MessageRow; state: 'sending' | 'queued_offline' | 'failed' | 'confirmed' };
const listeners = new Set<(event: Update) => void>();
let database: Promise<IDBDatabase> | undefined;

function openQueue(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('discreet-message-outbox', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('messages', { keyPath: 'row.id' });
      store.createIndex('sender', 'row.sender_id');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => { database = undefined; throw error; });
  return database;
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', mode);
    const request = action(tx.objectStore('messages'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Message storage unavailable.'));
  });
}
export const storeOutgoing = (item: Outgoing) => transact('readwrite', store => store.put(item));
export const queuedFor = (user: string): Promise<Outgoing[]> => transact('readonly', store => store.index('sender').getAll(user));
const emit = (event: Update) => { for (const fn of listeners) fn(event); };

export function observeOutbox(fn: (event: Update) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function deliver(item: Outgoing, token: string): Promise<MessageRow> {
  const { row } = item;
  // A tab may have closed after the INSERT committed but before the outbox was cleared.
  const lookup = () => supabase.from('messages').select(MESSAGE_COLUMNS).eq('client_msg_id', row.id).eq('sender_id', row.sender_id).maybeSingle();
  if (item.attempts || item.keys) {
    const existing = await lookup();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as MessageRow;
  }
  if (item.input && !item.keys) {
    item.keys = await uploadPrivateSnap(token, item.input);
    delete item.input;
    await storeOutgoing(item);
  }
  const { data, error } = await supabase.from('messages').insert({
    id: row.id, client_msg_id: row.id, sender_id: row.sender_id, conversation_id: row.conversation_id,
    type: row.type, content: row.content, snap_mode: row.snap_mode, avatar_id: row.avatar_id, story_id: row.story_id,
    r2_key: item.keys?.r2Key ?? null, motion_r2_key: item.keys?.motionR2Key ?? null,
  }).select(MESSAGE_COLUMNS).single();
  if (!error) return data as MessageRow;
  if (error.code === '23505') {
    const existing = await lookup();
    if (existing.data) return existing.data as MessageRow;
  }
  throw error;
}

async function processDue(user: string) {
  const { data } = await supabase.auth.getSession();
  if (!navigator.onLine || data.session?.user.id !== user) return;
  const pending = (await queuedFor(user)).sort((a,b) => a.row.created_at.localeCompare(b.row.created_at));
  for (const item of pending) {
    if (!navigator.onLine || item.retryAt > Date.now()) continue;
    emit({row: item.row, state: 'sending'});
    try {
      const row = await deliver(item, data.session.access_token);
      await transact('readwrite', store => store.delete(item.row.id));
      emit({row, state: 'confirmed'});
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      item.attempts++;
      const permanent = /^(22|23|42|P0001)/.test(code);
      item.retryAt = permanent ? Number.MAX_SAFE_INTEGER : Date.now() + Math.min(120000, 1000 * 2 ** Math.min(item.attempts, 7));
      await storeOutgoing(item);
      emit({row: item.row, state: permanent ? 'failed' : 'queued_offline'});
    }
  }
}

const active = new Map<string, Promise<void>>();
export function flushOutbox(user: string): Promise<void> {
  const running = active.get(user);
  if (running) return running;
  const work = navigator.locks
    ? navigator.locks.request('discreet-outbox-' + user, () => processDue(user))
    : processDue(user);
  const tracked = work.then(() => undefined).finally(() => active.delete(user));
  active.set(user, tracked);
  return tracked;
}

export function runOutbox(user: string, onError: (error: unknown) => void) {
  const wake = () => { void flushOutbox(user).catch(onError); };
  wake();
  window.addEventListener('online', wake);
  const timer = window.setInterval(wake, 2000);
  return () => { clearInterval(timer); window.removeEventListener('online', wake); };
}

export async function retryOutgoing(user: string, id: string) {
  const queued = await queuedFor(user);
  const item = queued.find(entry => entry.row.id === id);
  if (item) { item.retryAt = 0; await storeOutgoing(item); await flushOutbox(user); }
}
