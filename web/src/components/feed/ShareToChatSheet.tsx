'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ClayBuddy } from '@/components/chat/AvatarStickerMessage';
import { AVATAR_META, isAvatarId } from '@/lib/avatars';
import { ensureSession } from '@/lib/session';
import type { ConversationSummary } from '@/types/chat';
import type { FeedItem } from '@/types/social';

type Props = { post: FeedItem | null; onClose: () => void; onShareLink: (post: FeedItem) => void };
type Sent = 'sending' | 'sent' | 'error';

/** Bottom sheet over the feed: send this post to a chat, or fall back to sharing the link. */
export function ShareToChatSheet({ post, onClose, onShareLink }: Props) {
  return <AnimatePresence>{post && <Sheet key={post.id} post={post} onClose={onClose} onShareLink={onShareLink} />}</AnimatePresence>;
}

function Sheet({ post, onClose, onShareLink }: Omit<Props, 'post'> & { post: FeedItem }) {
  const [chats, setChats] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<Record<string, Sent>>({});

  useEffect(() => {
    let alive = true;
    ensureSession()
      .then((session) => fetch('/api/chats', { headers: { Authorization: `Bearer ${session.access_token}` } }))
      .then(async (response) => {
        if (!response.ok) throw new Error('chats');
        return ((await response.json()) as { conversations: ConversationSummary[] }).conversations;
      })
      .then((list) => { if (alive) setChats(list.filter((c) => c.status === 'accepted')); })
      .catch(() => { if (alive) setFailed(true); });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const send = async (chat: ConversationSummary) => {
    if (sent[chat.id] === 'sending' || sent[chat.id] === 'sent') return;
    navigator.vibrate?.(10);
    setSent((prev) => ({ ...prev, [chat.id]: 'sending' }));
    try {
      const session = await ensureSession();
      const response = await fetch(`/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedPostId: post.id }),
      });
      setSent((prev) => ({ ...prev, [chat.id]: response.ok ? 'sent' : 'error' }));
    } catch {
      setSent((prev) => ({ ...prev, [chat.id]: 'error' }));
    }
  };

  return (
    <motion.div className="absolute inset-0 z-[75] flex items-end bg-black/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog" aria-modal="true" aria-label="Send this post"
        onClick={(event) => event.stopPropagation()}
        initial={{ y: 120 }} animate={{ y: 0 }} exit={{ y: 120 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="w-full rounded-t-[28px] border border-white/20 bg-white/85 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-900 shadow-2xl backdrop-blur-2xl"
      >
        <p className="text-sm font-bold">Send to</p>
        {chats === null && !failed && <div className="mt-3 h-24 animate-pulse rounded-2xl bg-slate-900/5" />}
        {failed && <p role="alert" className="mt-3 text-sm text-rose-700">Could not load your chats.</p>}
        {chats?.length === 0 && <p className="mt-3 text-sm text-slate-500">No chats yet. Share the link instead.</p>}
        {chats && chats.length > 0 && (
          <ul className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {chats.map((chat) => {
              const state = sent[chat.id];
              const avatar = isAvatarId(chat.participant.avatarId) ? chat.participant.avatarId : 'cyber_monk';
              return (
                <li key={chat.id} className="shrink-0">
                  <button type="button" onClick={() => void send(chat)} disabled={state === 'sending'}
                    className="flex w-28 flex-col items-center gap-1 rounded-2xl p-2 focus-visible:outline-2 focus-visible:outline-violet-400" style={{ background: `${AVATAR_META[avatar].accent}22` }}>
                    <ClayBuddy avatarId={avatar} stickerId="wave" size={48} />
                    <span className="w-full truncate text-center text-[11px] font-semibold">@{chat.participant.username}</span>
                    <span className={`text-[10px] font-bold ${state === 'error' ? 'text-rose-600' : 'text-violet-600'}`}>
                      {state === 'sent' ? 'Sent ✓' : state === 'sending' ? '…' : state === 'error' ? 'Retry' : 'Send'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => { onShareLink(post); onClose(); }} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/70 text-sm font-semibold text-slate-700">
            <Link2 aria-hidden className="size-4" /> Share link
          </button>
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-full bg-slate-900 text-sm font-semibold text-white">Done</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
