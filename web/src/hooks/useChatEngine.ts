'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeMessages, setDeliveryStatus, type ChatMessage, type MessageRow } from '@/lib/chatMessages';
import { flushOutbox, MESSAGE_COLUMNS, observeOutbox, queuedFor, retryOutgoing, storeOutgoing } from '@/lib/offlineQueue';
import { describeMedia, toMediaInput, type MediaInput } from '@/lib/r2Upload';
import { ensureSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { ChatMeta, Outgoing, Retention, SnapView, StreakStatus } from '@/types/chat';
import type { RecordedSnapPayload } from '@/types/privacy';
import type { AvatarId } from '@/types/avatar';
import { ALL_EMOJIS } from '@/lib/chat/messageFormat';
import { encodeSticker, parseActionEvent, type AvatarAction, type AvatarActionEvent, type StickerId } from '@/lib/chat/stickerRegistry';

const PAGE = 30;
const local = (m: ChatMessage) => ['sending', 'queued_offline', 'failed'].includes(m.status);
async function history(id: string, before?: ChatMessage) {
  let query = supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', id);
  if (before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
  if (error) throw error;
  return data as MessageRow[];
}
const isReaction = (v: unknown): v is { messageId: string; emoji: string } =>
  typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).messageId === 'string' && (ALL_EMOJIS as readonly string[]).includes(String((v as Record<string, unknown>).emoji));
const messageOf = (e: unknown) => e instanceof Error ? e.message : 'The chat could not sync.';

export function useChatEngine(conversationId: string, currentUserId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [hasMore, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [peerPresent, setPeerPresent] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [peerInRoom, setPeerInRoom] = useState(false);
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const inRoom = useRef(false);
  const actionListeners = useRef(new Set<(event: AvatarActionEvent) => void>());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessionId = useRef<string | null>(null);
  const replayable = useRef(new Set<string>());
  const receiptRequests = useRef(new Set<string>());
  const previews = useRef(new Map<string, { url: string; motionUrl: string | null }>());
  const loadingOlder = useRef(false);
  const typingAt = useRef(0);
  const mounted = useRef(false);
  const fail = useCallback((e: unknown) => { if (mounted.current) setError(messageOf(e)); }, []);

  const release = useCallback((id: string) => {
    const item = previews.current.get(id);
    if (!item) return;
    URL.revokeObjectURL(item.url);
    if (item.motionUrl) URL.revokeObjectURL(item.motionUrl);
    previews.current.delete(id);
  }, []);
  const preview = useCallback((id: string, input?: MediaInput) => {
    if (!input) return null;
    let value = previews.current.get(id);
    if (!value) {
      const url = URL.createObjectURL(input.kind === 'mask' ? input.payload.audioBlob : input.payload.blob);
      const motionUrl = input.kind === 'mask' ? URL.createObjectURL(new Blob([JSON.stringify({
        fps: input.payload.fps, avatarId: input.payload.avatarId, frames: input.payload.frames,
      })], { type: 'application/json' })) : null;
      value = {url, motionUrl};
      previews.current.set(id, value);
    }
    return value;
  }, []);

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    sessionId.current = safeRandomUUID();
    const replaySet = replayable.current;
    const receiptSet = receiptRequests.current;
    const owned = previews.current;
    const merge = (rows: MessageRow[]) => {
      if (!alive) return;
      for (const row of rows) release(row.id);
      setMessages(last => mergeMessages(last, rows));
    };
    const refresh = async () => {
      try {
        const rows = await history(conversationId);
        // Keep paginated history while merging the subscribe-time snapshot.
        if (alive) { merge(rows); setMore(rows.length === PAGE); setLoading(false); }
      } catch (e) { if (alive) { fail(e); setLoading(false); } }
    };
    const refreshMeta = async () => {
      const { data, error } = await supabase.from('conversations').select('retention_mode,streak_count,streak_updated_at').eq('id', conversationId).single();
      if (alive && data && !error) setMeta(data as ChatMeta);
    };
    void refresh();
    void refreshMeta();
    const stopUpdates = observeOutbox(({row, state}) => {
      if (!alive || row.conversation_id !== conversationId || row.sender_id !== currentUserId) return;
      if (state === 'confirmed') merge([row]);
      else setMessages(list => setDeliveryStatus(list, row.id, state));
    });
    void queuedFor(currentUserId).then(items => {
      if (!alive) return;
      const restored = items.filter(i => i.row.conversation_id === conversationId).map(item => {
        const p = preview(item.row.id, item.input);
        return { ...item.row, media_url: p?.url ?? null, motion_url: p?.motionUrl ?? null,
          status: item.retryAt === Number.MAX_SAFE_INTEGER ? 'failed' as const : 'queued_offline' as const };
      });
      setMessages(list => [...restored.filter(row => !list.some(m => m.id === row.id)), ...list].sort((a,b) => a.created_at.localeCompare(b.created_at)));
    }).catch(fail);
    let typingTimer: ReturnType<typeof setTimeout>;
    const channel = supabase.channel(`chat:${conversationId}`, {config: {private: true, presence: {key: currentUserId}}});
    channelRef.current = channel;
    const visibility = () => {
      if (!alive) return;
      const visible = document.visibilityState === 'visible';
      void channel.track({is_in_chat: visible, in_room: visible && inRoom.current});
      if (!visible) void supabase.rpc('leave_chat', {p_conversation_id: conversationId}).then();
      else setNow(Date.now());
    };
    channel.on('presence', {event: 'sync'}, () => {
      if (!alive) return;
      const peers = Object.entries(channel.presenceState<{is_in_chat: boolean; in_room?: boolean}>()).filter(([id]) => id !== currentUserId).flatMap(([, entries]) => entries);
      setPeerPresent(peers.some(e => e.is_in_chat));
      setPeerInRoom(peers.some(e => e.in_room));
    }).on('broadcast', {event: 'avatar_action'}, ({payload}) => {
      const event = parseActionEvent(payload);
      if (alive && event && event.from !== currentUserId) for (const listener of actionListeners.current) listener(event);
    }).on('broadcast', {event: 'reaction'}, ({payload}) => {
      if (alive && isReaction(payload)) setReactions(old => ({...old, [payload.messageId]: [...(old[payload.messageId] ?? []), payload.emoji].slice(-12)}));
    }).on('broadcast', {event: 'typing'}, () => {
      if (!alive) return;
      setPeerTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setPeerTyping(false), 1800);
    }).on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}`}, p => merge([p.new as MessageRow]))
      .on('postgres_changes', {event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}`}, p => merge([p.new as MessageRow]))
      .on('postgres_changes', {event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}`}, p => { if (alive) setMeta(p.new as ChatMeta); })
      .subscribe(status => {
        if (alive && status === 'SUBSCRIBED') { visibility(); void refresh(); void refreshMeta(); }
      });
    document.addEventListener('visibilitychange', visibility);
    const clock = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      alive = false; mounted.current = false;
      clearTimeout(typingTimer); clearInterval(clock); stopUpdates();
      document.removeEventListener('visibilitychange', visibility);
      channelRef.current = null;
      void supabase.removeChannel(channel);
      void supabase.rpc('leave_chat', {p_conversation_id: conversationId}).then();
      replaySet.clear(); receiptSet.clear();
      for (const id of owned.keys()) release(id);
    };
  }, [conversationId, currentUserId, fail, preview, release]);

  useEffect(() => {
    for (const m of messages) {
      if (m.sender_id === currentUserId || local(m) || m.is_saved || m.viewed_at || m.status === 'opened' || m.status === 'expired') continue;
      const status = m.type === 'snap' || document.visibilityState !== 'visible' ? 'delivered' : 'opened';
      const key = m.id + status;
      if ((status === 'delivered' && m.status === status) || receiptRequests.current.has(key)) continue;
      receiptRequests.current.add(key);
      void supabase.rpc('mark_message', {p_message_id: m.id, p_status: status}).then(({error}) => { if (error) receiptRequests.current.delete(key); });
    }
  }, [messages, currentUserId, now]);

  const loadOlderMessages = async () => {
    const oldest = messages.find(m => !local(m));
    if (!oldest || !hasMore || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const rows = await history(conversationId, oldest);
      if (mounted.current) { setMessages(list => mergeMessages(list, rows)); setMore(rows.length === PAGE); }
    } catch (e) { fail(e); } finally { loadingOlder.current = false; }
  };

  const send = async (type: MessageRow['type'], content: string | null, input?: MediaInput) => {
    const id = safeRandomUUID();
    const description = input && describeMedia(input);
    const row: MessageRow = {
      id, client_msg_id: id, sender_id: currentUserId, conversation_id: conversationId, type, content,
      snap_mode: description?.mode ?? null, avatar_id: description?.avatarId ?? null, media_url: null, motion_url: null,
      story_id: null, viewed_at: null, expires_at: null, created_at: new Date().toISOString(),
    };
    const p = preview(id, input);
    setMessages(list => [...list, {...row, media_url: p?.url ?? null, motion_url: p?.motionUrl ?? null, status: navigator.onLine ? 'sending' : 'queued_offline'}]);
    const item: Outgoing = {row, input, attempts: 0, retryAt: 0};
    try {
      await storeOutgoing(item);
      void flushOutbox(currentUserId).catch(fail);
    } catch (e) {
      release(id);
      if (mounted.current) setMessages(list => list.filter(m => m.id !== id));
      fail(e);
      if (input) throw e;
    }
  };
  const openSnap = async (messageId: string): Promise<SnapView | null> => {
    try {
      const session = await ensureSession();
      const response = await fetch('/api/snap-url', {
        method: 'POST', cache: 'no-store',
        headers: {'Content-Type':'application/json', Authorization: `Bearer ${session.access_token}`},
        body: JSON.stringify({messageId, sessionId:sessionId.current}),
      });
      if (!response.ok) throw new Error('Snap expired or its views have been used.');
      const view: SnapView = await response.json();
      if (view.replayed) replayable.current.delete(messageId); else replayable.current.add(messageId);
      if (mounted.current) setMessages(list => list.map(m => m.id !== messageId ? m : {...m, status:'opened', view_count:view.viewCount, replayed_by_recipient:view.replayed}));
      return view;
    } catch (e) { fail(e); return null; }
  };

  const onAvatarAction = useCallback((listener: (event: AvatarActionEvent) => void) => {
    actionListeners.current.add(listener);
    return () => { actionListeners.current.delete(listener); };
  }, []);

  const age = meta?.streak_updated_at ? now - Date.parse(meta.streak_updated_at) : Infinity;
  const streakStatus: StreakStatus = age >= 86400000 ? 'expired' : age > 72000000 ? 'expiring_soon' : 'active';
  return {
    messages: messages.filter(m => m.is_saved || !m.expires_at || Date.parse(m.expires_at) > now),
    isLoading, hasMore, error, peerPresent, peerTyping, retention: meta?.retention_mode ?? 'after_viewing',
    streakStatus, streakCount: streakStatus === 'expired' ? 0 : meta?.streak_count ?? 0, loadOlderMessages,
    sendText: async (text: string) => { const body = text.trim(); if (body && body.length <= 2000) await send('text', body); },
    peerInRoom, reactions,
    sendAvatarSticker: (stickerId: StickerId, avatarId: AvatarId) => send('avatar_sticker', encodeSticker(stickerId, avatarId)),
    /** Live actions go over Realtime Broadcast only; nothing is stored. The sender's own screen plays it at once. */
    triggerLiveAction: (action: AvatarAction) => {
      const event: AvatarActionEvent = {action, from: currentUserId, at: Date.now()};
      for (const listener of actionListeners.current) listener(event);
      void channelRef.current?.send({type: 'broadcast', event: 'avatar_action', payload: event});
    },
    onAvatarAction,
    react: (messageId: string, emoji: string) => {
      setReactions(old => ({...old, [messageId]: [...(old[messageId] ?? []), emoji].slice(-12)}));
      void channelRef.current?.send({type: 'broadcast', event: 'reaction', payload: {messageId, emoji}});
    },
    setInRoom: (open: boolean) => {
      inRoom.current = open;
      void channelRef.current?.track({is_in_chat: document.visibilityState === 'visible', in_room: open});
    },
    sendSnap: (payload: RecordedSnapPayload | MaskRecordingPayload) => send('snap', null, toMediaInput(payload)),
    retryMessage: (id: string) => retryOutgoing(currentUserId, id).catch(fail),
    openSnap, canReplay: (id: string) => replayable.current.has(id),
    signalCapture: (reason: 'key' | 'hidden') => send('system_alert', reason === 'key' ? 'Screenshot key pressed while viewing a snap.' : 'Viewer left the screen while a snap was open.'),
    type: () => {
      if (Date.now() - typingAt.current < 650) return;
      typingAt.current = Date.now();
      void channelRef.current?.send({type:'broadcast', event:'typing', payload:{}});
    },
    setSaved: async (m: ChatMessage) => {
      if (m.type !== 'text' || local(m)) return;
      const {error} = await supabase.rpc('set_message_saved', {p_message_id:m.id, p_saved:!m.is_saved});
      if (error) fail(error);
    },
    setRetention: async (mode: Retention) => {
      const {error} = await supabase.rpc('set_chat_retention', {p_conversation_id:conversationId, p_retention_mode:mode});
      if (error) fail(error); else setMeta(old => old && {...old, retention_mode:mode});
    },
  };
}
