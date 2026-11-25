'use client';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isImageUrl } from '@/lib/media/mediaKind';
import { timeLeftLabel } from '@/lib/profileFormat';
import type { ProfilePostSummary } from '@/types/social';

type Tab = 'posts' | 'burners';

const FORMAT_LABEL: Partial<Record<ProfilePostSummary['post_format'], string>> = {
  recipe_avatar: 'Avatar',
  recipe_shayari: 'Shayari',
  living_post: 'Living ✨',
};

/** Current time, refreshed each minute, set after mount so server and client markup agree. */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Posts / Burners tabs over a 3-column grid of still thumbnails. No <video> is ever mounted here. */
export function ProfilePostGrid({ permanent, burners }: { permanent: ProfilePostSummary[]; burners: ProfilePostSummary[] }) {
  const [tab, setTab] = useState<Tab>('posts');
  const now = useNow();
  const list = tab === 'posts' ? permanent : burners;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'posts', label: 'Posts' },
    { id: 'burners', label: 'Burners', count: burners.length },
  ];

  return (
    <section className="mt-5" aria-label="Creator posts">
      <div role="tablist" aria-label="Post type" className="flex border-b border-slate-900/10 px-4">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="profile-grid" onClick={() => setTab(t.id)}
            className={`relative flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-violet-400 ${tab === t.id ? 'text-slate-900' : 'text-slate-400'}`}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-4 text-white">{t.count}</span>}
            {tab === t.id && <motion.span layoutId="profile-tab-underline" className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-slate-900" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          </button>
        ))}
      </div>

      <div id="profile-grid" role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-1">
        {list.length === 0 ? (
          <p className="px-8 py-14 text-center text-sm text-slate-500">{tab === 'posts' ? 'No permanent vibes yet' : 'No active burners'}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-1">
            {list.map((post) => {
              const left = tab === 'burners' && post.expires_at && now !== null ? timeLeftLabel(post.expires_at, now) : null;
              const format = FORMAT_LABEL[post.post_format];
              return (
                <li key={post.id}>
                  <Link href={`/feed?postId=${post.id}`} aria-label={post.caption || 'Open post'} className="relative block aspect-[9/16] overflow-hidden bg-slate-200 focus-visible:outline-2 focus-visible:outline-violet-400">
                    {post.thumbnail_url || isImageUrl(post.media_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.thumbnail_url ?? post.media_url} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <span aria-hidden className="absolute inset-0 grid place-items-center bg-gradient-to-br from-violet-200 via-sky-100 to-rose-100"><Play className="size-6 text-slate-500" /></span>
                    )}
                    {format && <span className="absolute left-1 top-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-md">{format}</span>}
                    {left && <span className="absolute right-1 top-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-md">{left}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
