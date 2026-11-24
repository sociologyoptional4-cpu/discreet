'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FeedPlayer } from '@/components/FeedPlayer';
import { EmotionResultCard } from '@/components/EmotionResultCard';
import { StateMessage } from '@/components/StateMessage';
import { LiquidGlassNav } from '@/components/feed/LiquidGlassNav';
import { fetchFeed, fetchOwnProfile, fetchProfilePosts } from '@/lib/feedData';
import type { FeedItem, Profile, PublicPost } from '@/types/social';

type Loaded = { key: string; items: FeedItem[]; snapshot: string } | { key: string; error: string };

/** Loads live posts (the view hides expired ones) with the visitor's like/follow state, then hands them to the player. */
export function FeedScreen() {
  const params = useSearchParams();
  const focus = params.get('postId');
  const topic = params.get('topic');
  const posted = params.get('posted') === '1';
  const key = `${focus ?? ''}|${topic ?? ''}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [prevPosted, setPrevPosted] = useState(posted);
  const [showVibe, setShowVibe] = useState(posted);

  if (posted !== prevPosted) {
    setPrevPosted(posted);
    if (posted) setShowVibe(true);
  }

  useEffect(() => {
    let alive = true;
    const snapshot = new Date().toISOString();
    fetchFeed(focus, topic, snapshot)
      .then((items) => { if (alive) setLoaded({ key, items, snapshot }); })
      .catch((e: unknown) => { if (alive) setLoaded({ key, error: e instanceof Error ? e.message : 'Could not load the feed.' }); });
    return () => { alive = false; };
  }, [focus, topic, key]);

  if (!loaded || loaded.key !== key) return <StateMessage title="Loading feed…" />;
  if ('error' in loaded) return <WithNav><StateMessage title="Couldn’t load the feed" body={loaded.error} action={{ href: '/feed', label: 'Try again' }} /></WithNav>;
  if (loaded.items.length === 0) return <WithNav><StateMessage title="Nothing here yet" body="Be the first to post a review." action={{ href: '/record', label: 'Record a post' }} /></WithNav>;
  return (
    <>
      <FeedPlayer key={key} items={loaded.items} paginate={!topic} snapshot={loaded.snapshot} />
      {showVibe && <PostedVibe onClose={() => setShowVibe(false)} />}
    </>
  );
}

/** Shown once right after publishing: the creator's updated vibe card, ready to share. */
function PostedVibe({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mine, setMine] = useState<{ profile: Profile; posts: PublicPost[] } | null>(null);

  const stripPosted = useCallback(() => {
    const search = new URLSearchParams(window.location.search);
    if (!search.has('posted')) return;
    search.delete('posted');
    const qs = search.toString();
    router.replace(qs ? `/feed?${qs}` : '/feed', { scroll: false });
  }, [router]);

  const close = useCallback(() => {
    stripPosted();
    onClose();
  }, [stripPosted, onClose]);

  useEffect(() => {
    let alive = true;
    fetchOwnProfile()
      .then(async (profile) => (profile ? { profile, posts: await fetchProfilePosts(profile.id) } : null))
      .then((result) => {
        if (!alive) return;
        setMine(result);
        stripPosted();
      })
      .catch(() => {
        if (alive) stripPosted();
      });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, [stripPosted, close]);

  if (!mine) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Your creator vibe" className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/30 p-4 backdrop-blur-sm sm:items-center" onClick={close}>
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <p className="mb-2 text-center text-sm font-semibold text-white drop-shadow">Posted! Here’s your vibe</p>
        <EmotionResultCard username={mine.profile.username} posts={mine.posts} />
        <button type="button" onClick={close} className="acrylic-pill mt-3 min-h-11 w-full text-sm font-semibold">Done</button>
      </div>
    </div>
  );
}

/** The feed hides the app's bottom bar, so its empty and error screens still need the corner nav orb. */
function WithNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden [--feed-accent-rgb:165_180_252]">
      {children}
      <LiquidGlassNav open={open} onOpenChange={setOpen} />
    </div>
  );
}
