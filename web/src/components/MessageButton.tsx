'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { REQUEST_NOTE_MAX, findConversationWith, requestConversation } from '@/lib/chatData';
import { ensureSession } from '@/lib/session';
import { isDemoMode } from '@/lib/supabase';

type Phase = 'idle' | 'checking' | 'composing' | 'sending' | 'sent' | 'pending-theirs' | 'pending-yours';

/** Opens the chat if you already talk; otherwise asks for a short reason and sends a message request. */
export function MessageButton({ creatorId }: { creatorId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setPhase('checking');
    try {
      const session = await ensureSession();
      const existing = await findConversationWith(session.user.id, creatorId);
      if (!existing) setPhase('composing');
      else if (existing.status === 'accepted') router.push(`/chats/${existing.id}`);
      else setPhase(existing.initiatorId === session.user.id ? 'pending-theirs' : 'pending-yours');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('idle');
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const reason = note.trim();
    if (!reason) return;
    setPhase('sending');
    try {
      const session = await ensureSession();
      await requestConversation(session.user.id, creatorId, reason);
      setPhase('sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request.');
      setPhase('composing');
    }
  };

  if (isDemoMode) return <p className="text-xs text-slate-500">Chat needs the backend (demo mode).</p>;
  if (phase === 'composing' || phase === 'sending') {
    return (
      <form onSubmit={(e) => void send(e)} className="flex w-full max-w-xs flex-col gap-2">
        <label htmlFor="request-note" className="text-sm font-semibold">Send a request with a reason</label>
        <input
          id="request-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={REQUEST_NOTE_MAX}
          placeholder="Why do you want to chat?"
          required
          autoFocus
          className="h-11 rounded-2xl border border-slate-200 bg-white/80 px-3 text-base text-slate-800 placeholder:text-slate-400 outline-none focus:border-violet-400"
        />
        <div className="flex gap-2">
          <button type="submit" disabled={phase === 'sending' || !note.trim()} className="min-h-11 flex-1 rounded-full bg-slate-900 text-sm font-semibold text-white disabled:opacity-50">{phase === 'sending' ? 'Sending…' : 'Send request'}</button>
          <button type="button" onClick={() => setPhase('idle')} disabled={phase === 'sending'} className="min-h-11 rounded-full border border-slate-200 bg-white/70 px-4 text-sm text-slate-700">Cancel</button>
        </div>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </form>
    );
  }
  if (phase === 'sent') return <p role="status" className="text-sm">Request sent. You can chat once they accept.</p>;
  if (phase === 'pending-theirs') return <p role="status" className="text-sm">Your request is waiting for them to accept.</p>;
  if (phase === 'pending-yours') return <p role="status" className="text-sm">They sent you a request. <Link href="/chats" className="underline">Answer it in Chats</Link>.</p>;

  return (
    <>
      <button type="button" onClick={() => void start()} disabled={phase === 'checking'} className="min-h-11 min-w-32 rounded-full border border-white/80 bg-white/60 px-6 text-sm font-semibold text-slate-800 shadow-[0_8px_28px_rgba(15,23,42,.08)] backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-violet-400 disabled:opacity-50">
        {phase === 'checking' ? 'Checking…' : 'Message'}
      </button>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </>
  );
}
