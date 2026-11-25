'use client';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { parsePostShare } from '@/lib/chat/postShare';
import { ensureSession } from '@/lib/session';
import type { SharedPostPreview } from '@/types/chat';

type Loaded = SharedPostPreview | 'missing';
const cache = new Map<string, Loaded>();

async function loadPreview(postId: string): Promise<Loaded> {
  const known = cache.get(postId);
  if (known) return known;
  try {
    const session = await ensureSession();
    const response = await fetch(`/api/posts/${postId}/preview`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const result: Loaded = response.ok ? ((await response.json()) as { post: SharedPostPreview }).post : 'missing';
    if (response.ok || response.status === 404) cache.set(postId, result);
    return result;
  } catch {
    return 'missing';
  }
}

/** A Vybe post sent in chat: a 9:16 still that opens the post in the feed. Never mounts a <video>. */
export function SharedPostCard({ content, mine }: { content: string | null; mine: boolean }) {
  const share = parsePostShare(content);
  const postId = share?.postId ?? null;
  const [loaded, setLoaded] = useState<{ postId: string; value: Loaded } | null>(null);

  useEffect(() => {
    if (!postId) return;
    let alive = true;
    void loadPreview(postId).then((value) => { if (alive) setLoaded({ postId, value }); });
    return () => { alive = false; };
  }, [postId]);

  const preview = loaded && loaded.postId === postId ? loaded.value : null;
  const tone = mine ? 'border-slate-900/10 bg-slate-900 text-white' : 'border-white/90 bg-white/85 text-slate-800';

  return (
    <div className={`w-40 overflow-hidden rounded-[22px] border shadow-[0_10px_28px_rgba(15,23,42,.08)] backdrop-blur ${tone}`}>
      {preview === 'missing' || !postId ? (
        <p className="px-3 py-6 text-center text-xs font-semibold opacity-70">This post is no longer available</p>
      ) : (
        <Link href={`/feed?postId=${postId}`} aria-label={preview?.caption ? `Open post: ${preview.caption}` : 'Open shared post'} className="block focus-visible:outline-2 focus-visible:outline-violet-400">
          <span className="relative block aspect-[9/16] bg-slate-200">
            {preview?.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.thumbnail_url} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
            ) : (
              <span aria-hidden className="absolute inset-0 grid place-items-center bg-gradient-to-br from-violet-200 via-sky-100 to-rose-100"><Play className="size-6 text-slate-500" /></span>
            )}
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md">Vybe</span>
          </span>
          {preview?.caption && <span className="line-clamp-2 block px-2.5 py-2 text-[11px] leading-snug">{preview.caption}</span>}
        </Link>
      )}
      {share?.note && <p className="px-2.5 pb-2 text-[12px] leading-snug">{share.note}</p>}
    </div>
  );
}
