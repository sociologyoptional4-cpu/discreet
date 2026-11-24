'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNotifications, type NotificationItem } from '@/hooks/useNotifications';
import { isSupabaseConfigured } from '@/lib/supabase';

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 31_536_000 },
  { unit: 'month', seconds: 2_592_000 },
  { unit: 'week', seconds: 604_800 },
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
];
const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000); // negative: in the past
  const match = UNITS.find((u) => Math.abs(seconds) >= u.seconds);
  return match ? formatter.format(Math.round(seconds / match.seconds), match.unit) : 'just now';
}

function describe(n: NotificationItem): { text: string; href: string } {
  const who = n.actor ? `@${n.actor.username}` : 'Someone';
  if (n.type === 'follow') return { text: `${who} started following you`, href: n.actor ? `/profile/${n.actor.username}` : '/notifications' };
  return { text: `${who} liked your post`, href: n.post_id ? `/feed?postId=${n.post_id}` : '/feed' };
}

export function NotificationsView() {
  const { status, notifications, unreadCount, markAllAsRead } = useNotifications();
  // The clock is read after mount: the page is prerendered, and a time baked into the HTML would be stale.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl p-4 text-white">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Notifications</h1>
        <button type="button" onClick={() => void markAllAsRead()} disabled={unreadCount === 0} className="min-h-11 rounded border border-white/30 px-3 text-sm disabled:opacity-40">
          Mark all read
        </button>
      </div>
      <p className="mt-1 text-sm text-white/60" aria-live="polite">{unreadCount === 0 ? 'No unread notifications' : `${unreadCount} unread`}</p>

      {!isSupabaseConfigured && <p className="mt-6 text-sm">Add your Supabase keys to .env.local to see notifications.</p>}
      {isSupabaseConfigured && status === 'idle' && <p className="mt-6 text-sm text-white/70">Like or follow someone, or post, to start getting notifications.</p>}
      {status === 'loading' && <p className="mt-6 text-sm text-white/70">Loading…</p>}
      {status === 'error' && <p role="alert" className="mt-6 text-sm text-rose-300">Couldn’t load notifications.</p>}
      {status === 'ready' && notifications.length === 0 && <p className="mt-6 text-sm text-white/70">Nothing yet.</p>}

      <ul className="mt-4 divide-y divide-white/10">
        {notifications.map((n) => {
          const { text, href } = describe(n);
          return (
            <li key={n.id}>
              <Link href={href} className={`flex items-center gap-3 py-3 ${n.is_read ? 'text-white/70' : 'font-semibold text-white'}`}>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-violet-400'}`} />
                <span className="flex-1">
                  {text}
                  {!n.is_read && <span className="sr-only"> (unread)</span>}
                </span>
                <time dateTime={n.created_at} className="shrink-0 text-xs font-normal text-white/50">{now === null ? '' : relativeTime(n.created_at, now)}</time>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
