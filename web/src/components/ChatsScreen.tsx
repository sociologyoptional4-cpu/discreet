'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StoryStrip } from '@/components/StoryStrip';
import { useConversations } from '@/hooks/useConversations';
import { isSupabaseConfigured } from '@/lib/supabase';

/** Stories on top, then message requests waiting for an answer, then accepted chats. */
export function ChatsScreen() {
  const router = useRouter();
  const { incoming, accepted, isLoading, error, accept, decline } = useConversations();
  const [busyId, setBusyId] = useState<string | null>(null);

  const answer = async (id: string, kind: 'accept' | 'decline') => {
    setBusyId(id);
    const ok = await (kind === 'accept' ? accept(id) : decline(id));
    setBusyId(null);
    if (ok && kind === 'accept') router.push(`/chats/${id}`);
  };

  return (
    <div className="mx-auto w-full max-w-xl text-white">
      <StoryStrip />

      <section aria-labelledby="requests-heading" className="px-4 pt-2">
        <h2 id="requests-heading" className="text-base font-bold">Chat Requests ({incoming.length})</h2>
        {incoming.length === 0 ? (
          <p className="mt-1 text-sm text-white/60">No requests waiting.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/10">
            {incoming.map((c) => (
              <li key={c.id} className="py-3">
                <p className="text-sm font-semibold">
                  <Link href={`/profile/${c.other.username}`} className="underline">@{c.other.username}</Link>
                </p>
                <p className="mt-0.5 text-sm text-white/80">{c.requestNote ?? 'No reason given.'}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busyId === c.id} onClick={() => void answer(c.id, 'accept')} className="min-h-11 rounded bg-white px-4 text-sm font-semibold text-[#0A0A0A] disabled:opacity-50">Accept</button>
                  <button type="button" disabled={busyId === c.id} onClick={() => void answer(c.id, 'decline')} className="min-h-11 rounded border border-white/30 px-4 text-sm disabled:opacity-50">Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="chats-heading" className="px-4 pb-6 pt-6">
        <h2 id="chats-heading" className="text-base font-bold">Chats</h2>
        {!isSupabaseConfigured && <p className="mt-2 text-sm">Add your Supabase keys to .env.local to use chat.</p>}
        {isSupabaseConfigured && isLoading && <p className="mt-2 text-sm text-white/60">Loading…</p>}
        {error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
        {isSupabaseConfigured && !isLoading && accepted.length === 0 && <p className="mt-2 text-sm text-white/60">No chats yet. Send a request from someone’s profile.</p>}
        <ul className="mt-2 divide-y divide-white/10">
          {accepted.map((c) => (
            <li key={c.id}>
              <Link href={`/chats/${c.id}`} className="flex items-center justify-between py-3">
                <span className="font-semibold">@{c.other.username}</span>
                <time dateTime={c.lastMessageAt} className="text-xs text-white/50">{new Date(c.lastMessageAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
