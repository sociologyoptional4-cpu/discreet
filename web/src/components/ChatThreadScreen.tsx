'use client';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { ArrowUp, Camera, ChevronLeft, Smile } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { HoldToViewSnap } from '@/components/HoldToViewSnap';
import { PrivacyCamera } from '@/components/PrivacyCamera';
import { StateMessage } from '@/components/StateMessage';
import { AvatarStickerDrawer } from '@/components/chat/AvatarStickerDrawer';
import { AvatarStickerMessage, ClayBuddy } from '@/components/chat/AvatarStickerMessage';
import { LevelUpModal, StreakBadge, VibeMeter, useChatXp } from '@/components/chat/ChatGamification';
import { DuoHangoutRoom } from '@/components/chat/DuoHangoutRoom';
import { ComboBurstLayer, Emoji3D, ReactionChips, ReactionPill, useComboBurst } from '@/components/chat/EmojiReactionSystem';
import { ACTION_SECONDS, LiveAvatarActionStage, type StageEvent } from '@/components/chat/LiveAvatarActionStage';
import { SwipeableMessageBubble } from '@/components/chat/SwipeableMessageBubble';
import { useChatThread, type ChatMessage } from '@/hooks/useChatThread';
import { useGyroParallax } from '@/hooks/useGyroParallax';
import { AVATAR_META, isAvatarId } from '@/lib/avatars';
import { recordQuestAction, shieldAvailable, type QuestKind } from '@/lib/chat/gamification';
import { ALL_EMOJIS, encodeReply, isSingleEmoji, parseReply } from '@/lib/chat/messageFormat';
import { playCue, primeAudio } from '@/lib/chat/spatialAudio';
import type { AvatarActionEvent } from '@/lib/chat/stickerRegistry';
import { fetchConversation } from '@/lib/chatData';
import type { ConversationItem } from '@/lib/conversations';
import { fetchOwnProfile } from '@/lib/feedData';
import { currentUserId } from '@/lib/session';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { AvatarId } from '@/types/avatar';

type Loaded = { id: string; viewerId: string | null; myAvatar: AvatarId; conversation: ConversationItem | null; error?: string };

/** Finds out who is looking and which conversation this is, then shows the thread only for an accepted one. */
export function ChatThreadScreen({ conversationId }: { conversationId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    (async () => {
      const viewerId = await currentUserId();
      const [conversation, profile] = viewerId ? await Promise.all([fetchConversation(conversationId, viewerId), fetchOwnProfile().catch(() => null)]) : [null, null];
      const myAvatar = isAvatarId(profile?.avatar_id) ? profile.avatar_id : 'cyber_monk';
      return { id: conversationId, viewerId, myAvatar, conversation } satisfies Loaded;
    })()
      .then((result) => { if (alive) setLoaded(result); })
      .catch((e: unknown) => { if (alive) setLoaded({ id: conversationId, viewerId: null, myAvatar: 'cyber_monk', conversation: null, error: e instanceof Error ? e.message : 'Could not load this chat.' }); });
    return () => { alive = false; };
  }, [conversationId]);

  if (!isSupabaseConfigured) return <StateMessage light title="Backend not set up" body="Add your Supabase keys to .env.local to use chat." />;
  if (!loaded || loaded.id !== conversationId) return <StateMessage light title="Loading chat…" />;
  if (loaded.error) return <StateMessage light title="Couldn’t load this chat" body={loaded.error} action={{ href: '/chats', label: 'Back to chats' }} />;
  const { conversation, viewerId } = loaded;
  if (!conversation || !viewerId) return <StateMessage light title="Chat not found" action={{ href: '/chats', label: 'Back to chats' }} />;
  if (conversation.status !== 'accepted') {
    return (
      <StateMessage light
        title={conversation.incoming ? 'This request is waiting for you' : 'Waiting for them to accept'}
        body={conversation.incoming ? 'Accept it from your chats to start talking.' : 'You can chat once they accept your request.'}
        action={{ href: '/chats', label: 'Back to chats' }}
      />
    );
  }
  return <Thread key={conversationId + viewerId} conversationId={conversationId} viewerId={viewerId} other={conversation.other} myAvatar={loaded.myAvatar} />;
}

type ThreadProps = { conversationId: string; viewerId: string; other: ConversationItem['other']; myAvatar: AvatarId };

function Thread({ conversationId, viewerId, other, myAvatar }: ThreadProps) {
  const chat = useChatThread(conversationId, viewerId);
  const { messages, isLoading, hasMore, error, peerTyping, peerPresent, peerInRoom, streakCount, streakStatus, retention, reactions, onAvatarAction, setInRoom } = chat;
  const otherAvatar: AvatarId = isAvatarId(other.avatarId) ? other.avatarId : 'cyber_monk';
  // A vibe typed on the feed arrives as ?draft=…; prefill it once, then drop it from the URL so a reload doesn't repeat it.
  const draft = useSearchParams().get('draft');
  const [text, setText] = useState(() => (draft ?? '').slice(0, 2000));
  useEffect(() => {
    if (draft !== null) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [draft]);
  const [camera, setCamera] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [room, setRoom] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null);
  const [reacting, setReacting] = useState<string | null>(null);
  const [stage, setStage] = useState<StageEvent | null>(null);
  const [ripple, setRipple] = useState<number | null>(null);
  const [shield] = useState(() => shieldAvailable());
  const xp = useChatXp(conversationId, streakStatus === 'active' && streakCount > 0);
  const { bursts, fire } = useComboBurst();
  const tilt = useGyroParallax(room);
  const shake = useAnimationControls();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [lastId]);
  useEffect(() => { setInRoom(room); }, [room, setInRoom]);
  useEffect(() => () => { if (stageTimer.current) clearTimeout(stageTimer.current); }, []);

  const play = useCallback((event: AvatarActionEvent) => {
    const fromSelf = event.from === viewerId;
    if (stageTimer.current) clearTimeout(stageTimer.current);
    setStage({ action: event.action, fromSelf, key: event.at });
    stageTimer.current = setTimeout(() => setStage(null), ACTION_SECONDS * 1000);
    const pan = fromSelf ? 0.35 : -0.35;
    if (event.action === 'poke_knock') {
      setRipple(event.at);
      void shake.start({ x: [0, -2, 2, -1.5, 1, 0], transition: { duration: 0.35 } });
      navigator.vibrate?.([35, 25, 35]);
      playCue('poke_knock', pan);
    } else if (event.action === 'send_heart') {
      fire('💖');
      playCue('heart_burst', pan);
    }
  }, [viewerId, shake, fire]);
  useEffect(() => onAvatarAction(play), [onAvatarAction, play]);

  const quest = (kind: QuestKind) => { const bonus = recordQuestAction(kind); if (bonus) xp.addBonus(bonus); };

  const sendMessage = (body: string) => {
    const content = replyTo ? encodeReply(replyTo.text, body) : body;
    void chat.sendText(content);
    xp.award('message');
    quest('message');
    if (isSingleEmoji(body)) fire(body.trim());
    setReplyTo(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    sendMessage(text);
    setText('');
  };
  const react = (messageId: string, emoji: string, x?: number, y?: number) => {
    chat.react(messageId, emoji);
    fire(emoji, x, y);
    setReacting(null);
  };
  const shownStage = stage && !room ? stage : null;

  return (
    <motion.div animate={shake} onPointerDownCapture={primeAudio} className="relative flex h-dvh flex-col overflow-hidden">
      <header className="relative z-20 shrink-0 border-b border-white/80 bg-white/70 px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] shadow-[0_8px_24px_rgba(15,23,42,.05)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Link href="/chats" aria-label="Back to chats" className="flex size-11 items-center justify-center rounded-full text-slate-700 hover:bg-white"><ChevronLeft aria-hidden className="size-6" /></Link>
          <span aria-hidden className="size-9 shrink-0 rounded-full shadow-[inset_-3px_-4px_8px_rgba(0,0,0,.15),inset_3px_3px_6px_rgba(255,255,255,.7)]" style={{ background: AVATAR_META[otherAvatar].accent }} />
          <div className="min-w-0 flex-1">
            <Link href={`/profile/${other.username}`} className="block truncate text-[15px] font-bold text-slate-900">@{other.username}</Link>
            <p className="text-[11px] text-slate-500" aria-live="polite">{peerTyping ? 'typing…' : peerPresent ? 'in chat now' : 'faceless chat'}</p>
          </div>
          <StreakBadge count={streakCount} status={streakStatus} shield={shield && streakStatus === 'expiring_soon'} />
          <button type="button" aria-pressed={room} onClick={() => setRoom((r) => !r)} className="acrylic-pill min-h-9 px-3 text-xs font-bold">3D Room</button>
        </div>
        <div className="mt-2 flex items-center gap-2 pl-1">
          <div className="flex-1"><VibeMeter info={xp.info} xp={xp.xp} /></div>
          <button type="button" onClick={() => void chat.setRetention(retention === '24h' ? 'after_viewing' : '24h')} aria-label={`Messages disappear ${retention === '24h' ? 'after 24 hours' : 'after viewing'}. Tap to change.`}
            className="rounded-full bg-slate-900/[.05] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            ⏱ {retention === '24h' ? '24h' : 'After View'}
          </button>
        </div>
      </header>

      <AnimatePresence>{room && <DuoHangoutRoom me={myAvatar} other={otherAvatar} otherName={other.username} peerInRoom={peerInRoom} event={stage} tilt={tilt} onEmote={chat.triggerLiveAction} />}</AnimatePresence>

      <div className={`flex-1 overflow-y-auto px-4 pb-4 pt-4 ${room ? 'bg-white/30 backdrop-blur-md' : ''}`} role="log" aria-label={peerTyping ? 'Messages, other participant typing' : 'Messages'}>
        {hasMore && <button type="button" onClick={() => void chat.loadOlderMessages()} className="acrylic-pill mx-auto mb-3 block min-h-10 px-4 text-xs font-semibold">Load older messages</button>}
        {isLoading && <p className="text-center text-sm text-slate-400">Loading…</p>}
        {!isLoading && messages.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-2 text-center">
            <ClayBuddy avatarId={otherAvatar} stickerId="wave" size={88} />
            <p className="text-sm font-semibold text-slate-700">Say hi to @{other.username}</p>
            <p className="text-xs text-slate-400">Send a wave, a sticker or a faceless snap.</p>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} mine={m.sender_id === viewerId} reactions={reactions[m.id] ?? []} reacting={reacting === m.id} chat={chat}
              onReply={(t) => { setReplyTo({ id: m.id, text: t }); inputRef.current?.focus(); }}
              onOpenReactions={() => setReacting(m.id)} onCloseReactions={() => setReacting(null)} onReact={(e, x, y) => react(m.id, e, x, y)} />
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      <AnimatePresence>
        {(peerPresent || peerTyping) && (
          <motion.div aria-hidden initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            className="pointer-events-none absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 z-10 flex items-end gap-1">
            <ClayBuddy avatarId={otherAvatar} stickerId="peek" size={54} />
            {peerTyping && <TypingDots />}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-20 shrink-0 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        {error && <p role="alert" className="mx-4 mb-1 text-xs font-medium text-rose-600">{error}</p>}
        <AnimatePresence>
          {drawer && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
              <div role="group" aria-label="Quick emoji" className="mx-3 mb-2 flex justify-between rounded-full border border-white/90 bg-white/70 px-2 py-1 backdrop-blur-xl">
                {ALL_EMOJIS.map((e) => <button key={e} type="button" aria-label={`Send ${e}`} onClick={() => sendMessage(e)} className="flex size-10 items-center justify-center rounded-full active:scale-90"><Emoji3D emoji={e} size={28} /></button>)}
              </div>
              <AvatarStickerDrawer avatarId={myAvatar} onClose={() => setDrawer(false)}
                onSticker={(id) => { void chat.sendAvatarSticker(id, myAvatar); playCue('sticker_send'); xp.award('sticker'); quest('sticker'); setDrawer(false); }}
                onAction={(a) => { chat.triggerLiveAction(a); setDrawer(false); }} />
            </motion.div>
          )}
        </AnimatePresence>
        {replyTo && (
          <div className="mx-4 mb-1.5 flex items-center gap-2 rounded-2xl border-l-4 border-violet-300 bg-white/70 px-3 py-1.5 text-xs text-slate-600 backdrop-blur">
            <span className="min-w-0 flex-1 truncate">Replying to “{replyTo.text}”</span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)} className="size-7 rounded-full text-slate-400">✕</button>
          </div>
        )}
        <form onSubmit={submit} className="mx-3 flex items-center gap-1.5 rounded-full border border-white/90 bg-white/75 p-1.5 shadow-[0_10px_28px_rgba(15,23,42,.08)] backdrop-blur-xl">
          <button type="button" onClick={() => setCamera(true)} aria-label="Send a faceless snap"
            className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_6px_18px_rgba(167,139,250,.55)]">
            <Camera aria-hidden className="size-5" />
          </button>
          <input ref={inputRef} value={text} onChange={(e) => { setText(e.target.value); chat.type(); }} maxLength={1900} placeholder="Message" aria-label="Message" autoComplete="off" enterKeyHint="send"
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-slate-900 outline-none placeholder:text-slate-400" />
          <button type="button" aria-label={drawer ? 'Close stickers and emoji' : 'Open stickers and emoji'} aria-expanded={drawer} onClick={() => setDrawer((d) => !d)}
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${drawer ? 'bg-violet-100 text-violet-700' : 'text-slate-500'}`}>
            <Smile aria-hidden className="size-5" />
          </button>
          {text.trim() ? (
            <motion.button type="submit" aria-label="Send" initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-400 text-white shadow-[0_6px_16px_rgba(167,139,250,.5)]">
              <ArrowUp aria-hidden className="size-5" strokeWidth={2.6} />
            </motion.button>
          ) : (
            <button type="button" aria-label="Send a wave" onClick={() => sendMessage('👋')} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm"><Emoji3D emoji="👋" size={26} /></button>
          )}
        </form>
      </div>

      {shownStage && <LiveAvatarActionStage me={myAvatar} other={otherAvatar} event={shownStage} room={false} tiltX={tilt.x} tiltY={tilt.y} className="pointer-events-none fixed inset-0 z-40 mx-auto max-w-[430px]" />}
      <AnimatePresence>
        {ripple !== null && (
          <motion.span key={ripple} aria-hidden onAnimationComplete={() => setRipple(null)} initial={{ scale: 0.1, opacity: 0.9 }} animate={{ scale: 3.2, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }}
            className="pointer-events-none fixed left-1/2 top-1/2 z-50 -ml-24 -mt-24 size-48 rounded-full border-2 border-white/90 bg-white/20 shadow-[0_0_40px_rgba(167,139,250,.5),inset_0_0_30px_rgba(255,255,255,.8)] backdrop-blur-sm" />
        )}
      </AnimatePresence>
      <p className="sr-only" aria-live="assertive">{stage ? `${stage.fromSelf ? 'You' : `@${other.username}`} sent ${stage.action.replace('_', ' ')}` : ''}</p>
      <ComboBurstLayer bursts={bursts} />
      <LevelUpModal info={xp.levelUp} onClose={xp.dismissLevelUp} />

      {camera && (
        <div role="dialog" aria-modal="true" aria-label="Send a snap" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="w-[min(100vw,calc(100dvh*9/16))]">
            <PrivacyCamera onClose={() => setCamera(false)} onSubmitMedia={async (payload) => { await chat.sendSnap(payload); xp.award('snap'); quest('snap'); }} submitLabel="Send snap" />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function TypingDots() {
  return (
    <span className="mb-2 flex gap-1 rounded-full border border-white/90 bg-white/85 px-2.5 py-2 shadow-sm backdrop-blur">
      {[0, 1, 2].map((i) => <motion.span key={i} className="size-1.5 rounded-full bg-violet-400" animate={{ y: [0, -4, 0] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12 }} />)}
    </span>
  );
}

type Chat = ReturnType<typeof useChatThread>;
type RowProps = {
  message: ChatMessage; mine: boolean; reactions: string[]; reacting: boolean; chat: Chat;
  onReply: (text: string) => void; onOpenReactions: () => void; onCloseReactions: () => void; onReact: (emoji: string, x?: number, y?: number) => void;
};

function MessageRow({ message: m, mine, reactions, reacting, chat, onReply, onOpenReactions, onCloseReactions, onReact }: RowProps) {
  const side = mine ? 'items-end' : 'items-start';
  if (m.type === 'system_alert') return <li className="self-center rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">⚠️ {m.content}</li>;
  let body: ReactNode;
  if (m.type === 'snap') {
    body = <HoldToViewSnap message={m} isOwnMessage={mine} onOpen={chat.openSnap} canReplay={chat.canReplay(m.id)} onSignal={chat.signalCapture} onQuickReact={(e) => onReact(e)} />;
  } else if (m.type === 'avatar_sticker') {
    body = <AvatarStickerMessage content={m.content} mine={mine} />;
  } else {
    const { quote, body: textBody } = parseReply(m.content ?? '');
    const big = !quote && isSingleEmoji(textBody);
    const canSave = m.type === 'text';
    body = (
      <SwipeableMessageBubble onReply={() => onReply(textBody)} onReact={onOpenReactions}>
        {big ? (
          <motion.span initial={{ scale: 0.3, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 14 }} className="block">
            <Emoji3D emoji={textBody.trim()} size={64} />
          </motion.span>
        ) : (
          <div role={canSave ? 'button' : undefined} tabIndex={canSave ? 0 : undefined} aria-pressed={canSave ? !!m.is_saved : undefined} title={canSave ? (m.is_saved ? 'Tap to unsave' : 'Tap to save') : undefined}
            onClick={canSave ? () => void chat.setSaved(m) : undefined} onKeyDown={canSave ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void chat.setSaved(m); } } : undefined}
            className={`relative max-w-[78vw] break-words rounded-[22px] px-3.5 py-2 text-[15px] leading-snug shadow-[0_10px_28px_rgba(15,23,42,.06)] sm:max-w-[320px] ${mine ? 'rounded-br-md bg-slate-900 text-white' : 'rounded-bl-md border border-white/90 bg-white/80 text-slate-900 backdrop-blur-xl'}`}>
            {m.type === 'story_reply' && <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${mine ? 'text-white/60' : 'text-violet-500'}`}>Story reply</span>}
            {quote && <span className={`mb-1 block truncate border-l-2 pl-2 text-xs ${mine ? 'border-white/40 text-white/70' : 'border-violet-300 text-slate-500'}`}>{quote}</span>}
            {textBody}
            {m.is_saved && <span aria-hidden className="absolute -right-1.5 -top-1.5 text-sm">📌</span>}
          </div>
        )}
      </SwipeableMessageBubble>
    );
  }
  return (
    <li className={`relative flex flex-col ${side}`}>
      <AnimatePresence>{reacting && <ReactionPill align={mine ? 'end' : 'start'} onPick={(e) => onReact(e)} onClose={onCloseReactions} />}</AnimatePresence>
      {body}
      <ReactionChips emojis={reactions} onTap={(e, x, y) => onReact(e, x, y)} />
      {mine && <DeliveryLine message={m} onRetry={() => void chat.retryMessage(m.id)} />}
    </li>
  );
}

function DeliveryLine({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  if (message.status === 'failed') {
    return <button type="button" onClick={onRetry} className="mt-1 min-h-9 text-xs font-semibold text-rose-600">Failed — Tap to retry</button>;
  }
  return <span className="mt-0.5 text-[10px] font-medium text-slate-400">{message.is_saved ? 'Saved' : message.status === 'queued_offline' ? 'Queued' : message.status === 'sending' ? 'Sending…' : message.viewed_at ? 'Seen' : message.status === 'delivered' ? 'Delivered' : 'Sent'}</span>;
}
