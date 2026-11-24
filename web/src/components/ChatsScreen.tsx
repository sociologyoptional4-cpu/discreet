'use client';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StoryStrip } from '@/components/StoryStrip';
import { ClayBuddy } from '@/components/chat/AvatarStickerMessage';
import { DailyQuestPill, StreakBadge } from '@/components/chat/ChatGamification';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';
import { PinnedAIChatCard } from '@/components/chat/PinnedAIChatCard';
import { useConversations } from '@/hooks/useConversations';
import { AVATAR_META, isAvatarId } from '@/lib/avatars';
import { fetchSuggestedCreators, requestConversation, type SuggestedCreator } from '@/lib/chatData';
import type { ConversationItem } from '@/lib/conversations';
import { currentUserId } from '@/lib/session';
import { isSupabaseConfigured } from '@/lib/supabase';

const card = 'rounded-[28px] border border-white/90 bg-white/75 shadow-[0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl';
const accentOf = (id: string) => (isAvatarId(id) ? AVATAR_META[id].accent : '#c4b5fd');

/** Stories, today's quest, requests waiting for an answer, then chats with their streaks. */
export function ChatsScreen() {
  const router = useRouter();
  const { incoming, accepted, isLoading, error, accept, decline } = useConversations();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingStory, setAddingStory] = useState(false);

  const answer = async (id: string, kind: 'accept' | 'decline') => {
    setBusyId(id);
    const ok = await (kind === 'accept' ? accept(id) : decline(id));
    setBusyId(null);
    if (ok && kind === 'accept') router.push(`/chats/${id}`);
  };

  return (
    <div className="pt-[max(.75rem,env(safe-area-inset-top))]">
      <header className="flex items-end justify-between px-5 pb-1 pt-2">
        <h1 className="text-[28px] font-black tracking-tight">Chats</h1>
        <span className="pb-1.5 text-xs font-semibold text-slate-400">faceless · private</span>
      </header>
      <DailyQuestPill />
      <StoryStrip adding={addingStory} onAddingChange={setAddingStory} />
      <div className="mt-3 px-4">
        <PinnedAIChatCard />
      </div>

      {incoming.length > 0 && (
        <section aria-labelledby="requests-heading" className="px-4 pt-2">
          <h2 id="requests-heading" className="px-1 text-xs font-bold uppercase tracking-[.14em] text-slate-400">Requests · {incoming.length}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {incoming.map((c) => (
              <motion.li key={c.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`${card} p-3.5`}>
                <div className="flex items-center gap-3">
                  <Orb accent={accentOf(c.other.avatarId)} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/profile/${c.other.username}`} className="text-sm font-bold">@{c.other.username}</Link>
                    <p className="truncate text-[13px] text-slate-500">{c.requestNote ?? 'No reason given.'}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busyId === c.id} onClick={() => void answer(c.id, 'accept')} className="min-h-11 flex-1 rounded-full bg-slate-900 text-sm font-semibold text-white disabled:opacity-50">Accept</button>
                  <button type="button" disabled={busyId === c.id} onClick={() => void answer(c.id, 'decline')} className="acrylic-pill min-h-11 flex-1 text-sm font-semibold disabled:opacity-50">Decline</button>
                </div>
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="chats-heading" className="px-4 pb-6 pt-4">
        <h2 id="chats-heading" className="px-1 text-xs font-bold uppercase tracking-[.14em] text-slate-400">Your vibes</h2>
        {!isSupabaseConfigured && <p className="mt-2 text-sm text-slate-500">Add your Supabase keys to .env.local to use chat.</p>}
        {isSupabaseConfigured && isLoading && <ul className="mt-2 flex flex-col gap-2">{[0, 1, 2].map((i) => <li key={i} className={`${card} h-[72px] animate-pulse`} />)}</ul>}
        {error && <p role="alert" className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
        {isSupabaseConfigured && !isLoading && accepted.length === 0 && <EmptyVibe exclude={incoming.map((c) => c.other.id)} onPostStory={() => setAddingStory(true)} />}
        <ul className="mt-2 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {accepted.map((c, i) => <ChatRow key={c.id} chat={c} index={i} />)}
          </AnimatePresence>
        </ul>
      </section>
    </div>
  );
}

function Orb({ accent, size = 44 }: { accent: string; size?: number }) {
  return <span aria-hidden className="shrink-0 rounded-full shadow-[inset_-4px_-5px_10px_rgba(0,0,0,.14),inset_4px_4px_8px_rgba(255,255,255,.75),0_6px_14px_rgba(15,23,42,.1)]" style={{ background: accent, width: size, height: size }} />;
}

function ChatRow({ chat: c, index }: { chat: ConversationItem; index: number }) {
  return (
    <motion.li layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: index * 0.03 } }} exit={{ opacity: 0 }}>
      <Link href={`/chats/${c.id}`} aria-label={`Chat with ${c.other.username}, ${c.unread} unread, streak ${c.streak}`}
        className={`${card} flex items-center gap-3 p-3 transition-transform active:scale-[.98] hover:-translate-y-0.5`}>
        <span className="relative">
          <Orb accent={accentOf(c.other.avatarId)} size={48} />
          {c.unread > 0 && <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">{c.unread}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${c.unread > 0 ? 'font-black' : 'font-semibold'}`}>@{c.other.username}</span>
          <time dateTime={c.lastMessageAt} className="text-xs text-slate-400">{c.unread > 0 ? 'New snap or message · ' : ''}{new Date(c.lastMessageAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </span>
        <StreakBadge count={c.streak} status={c.streakExpiring ? 'expiring_soon' : 'active'} />
      </Link>
    </motion.li>
  );
}

/** Never a dry "no chats" line: floating emoji, creators to wave at, and a nudge to post a story. */
function EmptyVibe({ exclude, onPostStory }: { exclude: string[]; onPostStory: () => void }) {
  const [creators, setCreators] = useState<SuggestedCreator[] | null>(null);
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  const excludeKey = exclude.join(',');

  useEffect(() => {
    let alive = true;
    currentUserId()
      .then((viewer) => (viewer ? fetchSuggestedCreators(viewer, excludeKey ? excludeKey.split(',') : []) : []))
      .then((list) => { if (alive) setCreators(list); })
      .catch(() => { if (alive) setCreators([]); });
    return () => { alive = false; };
  }, [excludeKey]);

  const wave = async (creator: SuggestedCreator) => {
    setSent((s) => ({ ...s, [creator.id]: 'sending' }));
    try {
      const viewer = await currentUserId();
      if (!viewer) throw new Error('No session');
      await requestConversation(viewer, creator.id, 'Wave 👋');
      setSent((s) => ({ ...s, [creator.id]: 'sent' }));
    } catch {
      setSent((s) => ({ ...s, [creator.id]: 'error' }));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className={`${card} mt-2 overflow-hidden p-5 text-center`}>
      <div aria-hidden className="relative mx-auto h-24 w-48">
        {[['👋', -56, 10, 0], ['✨', 0, -6, 0.4], ['👻', 56, 12, 0.8]].map(([e, x, y, d]) => (
          <motion.span key={e as string} className="absolute left-1/2 top-4" style={{ marginLeft: (x as number) - 28 }}
            animate={{ y: [y as number, (y as number) - 10, y as number], rotate: [-6, 6, -6] }} transition={{ duration: 3, repeat: Infinity, delay: d as number, ease: 'easeInOut' }}>
            <Emoji3D emoji={e as string} size={56} />
          </motion.span>
        ))}
      </div>
      <h3 className="text-lg font-black">Start your first faceless vibe</h3>
      <p className="mx-auto mt-1 max-w-64 text-[13px] text-slate-500">Wave at a creator. If they wave back, you’re chatting — no faces, ever.</p>

      {creators === null && <div className="mt-4 h-24 animate-pulse rounded-3xl bg-white/60" />}
      {creators && creators.length > 0 && (
        <ul aria-label="Suggested creators" className="-mx-5 mt-4 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {creators.map((c) => {
            const state = sent[c.id];
            return (
              <li key={c.id} className="flex w-28 shrink-0 snap-start flex-col items-center gap-1.5 rounded-3xl bg-white/70 p-2.5 shadow-sm">
                {isAvatarId(c.avatarId) ? <ClayBuddy avatarId={c.avatarId} stickerId="wave" size={52} /> : <Orb accent="#c4b5fd" size={52} />}
                <Link href={`/profile/${c.username}`} className="w-full truncate text-xs font-bold">@{c.username}</Link>
                <div className="flex w-full gap-1">
                  <button type="button" disabled={!!state && state !== 'error'} onClick={() => void wave(c)} aria-label={`Wave at ${c.username}`}
                    className="acrylic-pill min-h-8 flex-1 text-[11px] font-bold disabled:opacity-60">{state === 'sent' ? 'Sent ✓' : state === 'sending' ? '…' : state === 'error' ? 'Retry' : 'Wave 👋'}</button>
                </div>
                <Link href={`/profile/${c.username}`} className="text-[10px] font-semibold text-violet-600">Request</Link>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={onPostStory} className="mt-4 min-h-12 w-full rounded-full bg-slate-900 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(167,139,250,.45)]">
        Post a 24h Story ✨
      </button>
    </motion.div>
  );
}
