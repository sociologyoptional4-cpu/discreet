'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyMessageUpdate, mergeMessages, setDeliveryStatus, type ChatMessage, type DeliveryStatus, type MessageRow } from '@/lib/chatMessages';
import { describeMedia, toMediaInput, uploadMedia, type UploadedMedia } from '@/lib/r2Upload';
import { ensureSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { RecordedSnapPayload } from '@/types/privacy';

export type { ChatMessage, DeliveryStatus };

const PAGE_SIZE = 30;
const MAX_TEXT_LENGTH = 2000;
const UNIQUE_VIOLATION = '23505';
const COLUMNS = 'id, conversation_id, sender_id, type, content, snap_mode, avatar_id, media_url, motion_url, story_id, viewed_at, expires_at, created_at';

type Thread = { id: string; messages: ChatMessage[]; hasMore: boolean; error: string | null };

export type ChatThread = {
  /** Oldest first. Includes messages still being sent or that failed. */
  messages: ChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
  loadOlderMessages: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  /** Uploads the clip (and the motion track of a 3D mask) to R2, then sends it as a snap. */
  sendSnap: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  /** Tries a failed message again. It never creates a second copy: the message keeps its id. */
  retryMessage: (tempId: string) => Promise<void>;
  /**
   * The receiver opens a snap. Returns true only for the one call that actually claimed the view,
   * so show the snap only when it returns true.
   */
  markSnapViewed: (messageId: string) => Promise<boolean>;
};

async function fetchPage(conversationId: string, before: string | null): Promise<MessageRow[]> {
  let query = supabase.from('messages').select(COLUMNS).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw new Error('Could not load messages.');
  return data as MessageRow[];
}

/**
 * One conversation: paginated history, live INSERT / UPDATE events, and optimistic sending.
 * A message is created on screen at once with status `sending`, becomes `sent` when the server confirms,
 * or `failed` (and can be retried) if the network or the server refuses it.
 */
export function useChatThread(conversationId: string, currentUserId: string): ChatThread {
  const [thread, setThread] = useState<Thread | null>(null);
  const current = thread?.id === conversationId ? thread : null;
  const messages = current?.messages ?? [];

  const messagesRef = useRef<ChatMessage[]>([]);
  const retriesRef = useRef(new Map<string, () => Promise<void>>());
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  });

  /** Change the thread only while it is still the one on screen (a late callback for a previous conversation is ignored). */
  const patch = useCallback(
    (change: (t: Thread) => Thread) => setThread((prev) => (prev && prev.id === conversationId ? change(prev) : prev)),
    [conversationId],
  );

  // First page of history.
  useEffect(() => {
    let alive = true;
    retriesRef.current.clear();
    fetchPage(conversationId, null)
      .then((rows) => { if (alive) setThread({ id: conversationId, messages: mergeMessages([], rows), hasMore: rows.length === PAGE_SIZE, error: null }); })
      .catch((e: unknown) => { if (alive) setThread({ id: conversationId, messages: [], hasMore: false, error: e instanceof Error ? e.message : 'Could not load messages.' }); });
    return () => { alive = false; };
  }, [conversationId]);

  // Live events. After a dropped connection comes back, fetch the newest page so nothing sent meanwhile is missed.
  useEffect(() => {
    let alive = true;
    let subscribedBefore = false;
    const channel = supabase
      .channel(`chat:${conversationId}:${crypto.randomUUID().slice(0, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        if (alive) patch((t) => ({ ...t, messages: mergeMessages(t.messages, [payload.new as MessageRow]) }));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        if (alive) patch((t) => ({ ...t, messages: applyMessageUpdate(t.messages, payload.new as MessageRow) }));
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (subscribedBefore) {
          fetchPage(conversationId, null)
            .then((rows) => { if (alive) patch((t) => ({ ...t, messages: mergeMessages(t.messages, rows) })); })
            .catch(() => {});
        }
        subscribedBefore = true;
      });
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, patch]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !current?.hasMore) return;
    const oldest = current.messages.find((m) => m.status === 'sent');
    if (!oldest) return;
    loadingOlderRef.current = true;
    try {
      const rows = await fetchPage(conversationId, oldest.created_at);
      patch((t) => ({ ...t, messages: mergeMessages(t.messages, rows), hasMore: rows.length === PAGE_SIZE, error: null }));
    } catch (e) {
      patch((t) => ({ ...t, error: e instanceof Error ? e.message : 'Could not load older messages.' }));
    } finally {
      loadingOlderRef.current = false;
    }
  }, [conversationId, current, patch]);

  /** Shows a message on screen right away and remembers how to (re)send it. */
  const sendOptimistic = useCallback(
    async (row: MessageRow, deliver: () => Promise<void>) => {
      const id = row.id;
      const setStatus = (status: DeliveryStatus) => patch((t) => ({ ...t, messages: setDeliveryStatus(t.messages, id, status) }));
      const attempt = async () => {
        setStatus('sending');
        try {
          await deliver();
          retriesRef.current.delete(id);
          setStatus('sent');
        } catch {
          setStatus('failed');
        }
      };
      retriesRef.current.set(id, attempt);
      patch((t) => ({ ...t, error: null, messages: [...t.messages, { ...row, status: 'sending' as const }].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) }));
      await attempt();
    },
    [patch],
  );

  const baseRow = useCallback(
    (): Pick<MessageRow, 'id' | 'conversation_id' | 'sender_id' | 'content' | 'snap_mode' | 'avatar_id' | 'media_url' | 'motion_url' | 'story_id' | 'viewed_at' | 'expires_at' | 'created_at'> => ({
      id: crypto.randomUUID(), conversation_id: conversationId, sender_id: currentUserId, content: null, snap_mode: null, avatar_id: null,
      media_url: null, motion_url: null, story_id: null, viewed_at: null, expires_at: null, created_at: new Date().toISOString(),
    }),
    [conversationId, currentUserId],
  );

  const sendText = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content) return;
      if (content.length > MAX_TEXT_LENGTH) {
        patch((t) => ({ ...t, error: `Messages can be up to ${MAX_TEXT_LENGTH} characters.` }));
        return;
      }
      const row: MessageRow = { ...baseRow(), type: 'text', content };
      await sendOptimistic(row, async () => {
        // A retry after a lost reply hits the unique id: the first attempt did arrive, so that counts as sent.
        const { error } = await supabase.from('messages').insert({ id: row.id, conversation_id: conversationId, sender_id: currentUserId, type: 'text', content });
        if (error && error.code !== UNIQUE_VIOLATION) throw error;
      });
    },
    [baseRow, conversationId, currentUserId, patch, sendOptimistic],
  );

  const sendSnap = useCallback(
    async (payload: RecordedSnapPayload | MaskRecordingPayload) => {
      const input = toMediaInput(payload);
      const { mode, avatarId } = describeMedia(input);
      const localUrl = input.kind === 'mask' ? input.payload.audioUrl : input.payload.url;
      const row: MessageRow = { ...baseRow(), type: 'snap', snap_mode: mode, avatar_id: avatarId, media_url: localUrl };
      let uploaded: UploadedMedia | null = null; // kept across retries, so a failed insert does not upload the clip again
      await sendOptimistic(row, async () => {
        const session = await ensureSession();
        if (session.user.id !== currentUserId) throw new Error('Signed in as someone else.');
        uploaded ??= await uploadMedia(session.access_token, input, '1d');
        const { error } = await supabase.from('messages').insert({
          id: row.id, conversation_id: conversationId, sender_id: currentUserId, type: 'snap',
          snap_mode: mode, avatar_id: avatarId, media_url: uploaded.mediaUrl, motion_url: uploaded.motionUrl,
        });
        if (error && error.code !== UNIQUE_VIOLATION) throw error;
      });
    },
    [baseRow, conversationId, currentUserId, sendOptimistic],
  );

  const retryMessage = useCallback(async (tempId: string) => {
    const failed = messagesRef.current.find((m) => m.id === tempId && m.status === 'failed');
    if (failed) await retriesRef.current.get(tempId)?.();
  }, []);

  const markSnapViewed = useCallback(
    async (messageId: string): Promise<boolean> => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      if (!message || message.type !== 'snap' || message.sender_id === currentUserId || message.viewed_at) return false;
      const openedAt = new Date().toISOString();
      const setViewed = (viewedAt: string | null) =>
        patch((t) => ({ ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, viewed_at: viewedAt } : m)) }));
      setViewed(openedAt); // a second tap now sees it as opened, so only one call can claim the view
      // The database replaces this time with its own clock and refuses to change a snap that was already opened.
      const { data, error } = await supabase.from('messages').update({ viewed_at: openedAt }).eq('id', messageId).is('viewed_at', null).select('viewed_at');
      if (error || !data || data.length === 0) {
        setViewed(null);
        return false;
      }
      setViewed((data[0] as { viewed_at: string }).viewed_at);
      return true;
    },
    [currentUserId, patch],
  );

  return {
    messages,
    isLoading: current === null,
    hasMore: current?.hasMore ?? false,
    error: current?.error ?? null,
    loadOlderMessages,
    sendText,
    sendSnap,
    retryMessage,
    markSnapViewed,
  };
}
