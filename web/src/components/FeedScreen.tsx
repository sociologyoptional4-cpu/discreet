'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FeedPlayer } from '@/components/FeedPlayer';
import { StateMessage } from '@/components/StateMessage';
import { fetchFeed } from '@/lib/feedData';
import type { FeedItem } from '@/types/social';

type Loaded = { key: string; items: FeedItem[]; snapshot: string } | { key: string; error: string };

/** Loads live posts (the view hides expired ones) with the visitor's like/follow state, then hands them to the player. */
export function FeedScreen() {
  const params = useSearchParams();
  const focus = params.get('postId');
  const topic = params.get('topic');
  const key = `${focus ?? ''}|${topic ?? ''}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    const snapshot = new Date().toISOString();
    fetchFeed(focus, topic, snapshot)
      .then((items) => { if (alive) setLoaded({ key, items, snapshot }); })
      .catch((e: unknown) => { if (alive) setLoaded({ key, error: e instanceof Error ? e.message : 'Could not load the feed.' }); });
    return () => { alive = false; };
  }, [focus, topic, key]);

  if (!loaded || loaded.key !== key) return <StateMessage title="Loading feed…" />;
  if ('error' in loaded) return <StateMessage title="Couldn’t load the feed" body={loaded.error} action={{ href: '/feed', label: 'Try again' }} />;
  if (loaded.items.length === 0) return <StateMessage title="Nothing here yet" body="Be the first to post a review." action={{ href: '/record', label: 'Record a post' }} />;
  return <FeedPlayer key={key} items={loaded.items} paginate={!topic} snapshot={loaded.snapshot} />;
}
