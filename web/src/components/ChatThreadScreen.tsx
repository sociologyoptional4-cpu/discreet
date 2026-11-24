'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HoldToViewSnap } from '@/components/HoldToViewSnap';
import { PrivacyCamera } from '@/components/PrivacyCamera';
import { StateMessage } from '@/components/StateMessage';
import type { SnapView } from '@/types/chat';
import { useChatThread, type ChatMessage } from '@/hooks/useChatThread';
import { fetchConversation } from '@/lib/chatData';
import type { ConversationItem } from '@/lib/conversations';
import { currentUserId } from '@/lib/session';
import { isSupabaseConfigured } from '@/lib/supabase';

type Loaded = { id: string; viewerId: string | null; conversation: ConversationItem | null; error?: string };

/** Finds out who is looking and which conversation this is, then shows the thread only for an accepted one. */
export function ChatThreadScreen({ conversationId }: { conversationId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    (async () => {
      const viewerId = await currentUserId();
      const conversation = viewerId ? await fetchConversation(conversationId, viewerId) : null;
      return { id: conversationId, viewerId, conversation } satisfies Loaded;
    })()
      .then((result) => { if (alive) setLoaded(result); })
      .catch((e: unknown) => { if (alive) setLoaded({ id: conversationId, viewerId: null, conversation: null, error: e instanceof Error ? e.message : 'Could not load this chat.' }); });
    return () => { alive = false; };
  }, [conversationId]);

  if (!isSupabaseConfigured) return <StateMessage title="Backend not set up" body="Add your Supabase keys to .env.local to use chat." />;
  if (!loaded || loaded.id !== conversationId) return <StateMessage title="Loading chat…" />;
  if (loaded.error) return <StateMessage title="Couldn’t load this chat" body={loaded.error} action={{ href: '/chats', label: 'Back to chats' }} />;
  const { conversation, viewerId } = loaded;
  if (!conversation || !viewerId) return <StateMessage title="Chat not found" action={{ href: '/chats', label: 'Back to chats' }} />;
  if (conversation.status !== 'accepted') {
    return (
      <StateMessage
        title={conversation.incoming ? 'This request is waiting for you' : 'Waiting for them to accept'}
        body={conversation.incoming ? 'Accept it from your chats to start talking.' : 'You can chat once they accept your request.'}
        action={{ href: '/chats', label: 'Back to chats' }}
      />
    );
  }
  return <Thread key={conversationId + viewerId} conversationId={conversationId} viewerId={viewerId} other={conversation.other} />;
}

function Thread({ conversationId, viewerId, other }: { conversationId: string; viewerId: string; other: ConversationItem['other'] }) {
  const { messages, isLoading, hasMore, error, loadOlderMessages, sendText, sendSnap, retryMessage, openSnap, canReplay, signalCapture, type, setSaved, setRetention, retention, peerTyping, peerPresent, streakCount, streakStatus } = useChatThread(conversationId, viewerId);
  const [text, setText] = useState('');
  const [camera, setCamera] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  // Scroll to the newest message when one arrives (not when older ones are loaded above).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    void sendText(text);
    setText('');
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-xl flex-col bg-[#0A0A0A] text-white">
      <header title={`Retention: ${retention}. Double-click to toggle. Streak: ${streakCount} (${streakStatus}).`} onDoubleClick={() => void setRetention(retention === '24h' ? 'after_viewing' : '24h')} onKeyDown={e => { if (e.shiftKey && e.key === 'Enter') void setRetention(retention === '24h' ? 'after_viewing' : '24h'); }} tabIndex={0} className="flex items-center gap-3 border-b border-white/15 px-4 py-3">
        <Link href="/chats" aria-label="Back to chats" className="min-h-11 min-w-11 py-2 text-sm">Back</Link>
        <Link href={`/profile/${other.username}`} className="font-semibold">@{other.username}</Link>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3" role="log" aria-label={peerTyping ? 'Messages, other participant typing' : peerPresent ? 'Messages, other participant in chat' : 'Messages'}>
        {hasMore && <button type="button" onClick={() => void loadOlderMessages()} className="mb-3 min-h-11 w-full rounded border border-white/20 text-sm">Load older messages</button>}
        {isLoading && <p className="text-sm text-white/60">Loading…</p>}
        {!isLoading && messages.length === 0 && <p className="text-sm text-white/60">Say hi, or send a snap.</p>}
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className={`flex flex-col ${m.sender_id === viewerId ? 'items-end' : 'items-start'}`}>
              <MessageBody message={m} mine={m.sender_id === viewerId} onOpen={openSnap} canReplay={canReplay(m.id)} onSignal={signalCapture} onSave={() => void setSaved(m)} />
              {m.sender_id === viewerId && <DeliveryLine message={m} onRetry={() => void retryMessage(m.id)} />}
            </li>
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      {error && <p role="alert" className="px-4 pb-1 text-sm text-rose-300">{error}</p>}
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/15 p-3">
        <button type="button" onClick={() => setCamera(true)} className="min-h-11 rounded border border-white/30 px-3 text-sm">Camera</button>
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); type(); }}
          maxLength={2000}
          placeholder="Message"
          aria-label="Message"
          autoComplete="off"
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded border border-white/20 bg-white/10 px-3 text-base text-white placeholder:text-white/40"
        />
        <button type="submit" disabled={!text.trim()} className="min-h-11 rounded bg-white px-4 text-sm font-semibold text-[#0A0A0A] disabled:opacity-40">Send</button>
      </form>

      {camera && (
        <div role="dialog" aria-modal="true" aria-label="Send a snap" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="w-[min(100vw,calc(100dvh*9/16))]">
            <PrivacyCamera onClose={() => setCamera(false)} onSubmitMedia={sendSnap} submitLabel="Send snap" />
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBody({ message, mine, onOpen, canReplay, onSignal, onSave }: { message: ChatMessage; mine: boolean; onOpen: (id: string) => Promise<SnapView | null>; canReplay: boolean; onSignal: (reason: 'key' | 'hidden') => void; onSave: () => void }) {
  if (message.type === 'snap') return <HoldToViewSnap message={message} isOwnMessage={mine} onOpen={onOpen} canReplay={canReplay} onSignal={onSignal} />;
  const bubble = `max-w-[80%] break-words rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-white text-[#0A0A0A]' : 'bg-white/15'}`;
  if (message.type === 'story_reply') {
    return (
      <div className={bubble}>
        <span className="mr-2 rounded bg-black/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase">Story reply</span>
        {message.content}
      </div>
    );
  }
  return <div className={bubble} role={message.type === 'text' ? 'button' : undefined} tabIndex={message.type === 'text' ? 0 : undefined} aria-pressed={message.type === 'text' ? !!message.is_saved : undefined} title={message.type === 'text' ? (message.is_saved ? 'Tap to unsave' : 'Tap to save') : undefined} onClick={onSave} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSave(); } }}>{message.content}</div>;
}

function DeliveryLine({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  if (message.status === 'failed') {
    return <button type="button" onClick={onRetry} className="mt-1 min-h-11 text-xs font-semibold text-red-500">Failed — Tap to retry</button>;
  }
  return <span className="mt-0.5 text-[11px] text-white/50">{message.is_saved ? 'Saved' : message.status === 'queued_offline' ? 'Queued' : message.status === 'sending' ? 'Sending…' : message.viewed_at ? 'Seen' : message.status === 'delivered' ? 'Delivered' : 'Sent'}</span>;
}
