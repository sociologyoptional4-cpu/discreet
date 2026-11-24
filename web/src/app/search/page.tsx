'use client';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Ghost, Heart, Search, X } from 'lucide-react';
import { SentimentVerdictBar, verdictPercentages, type SentimentFilter } from '@/components/SentimentVerdictBar';
import { AIVisorOrb } from '@/components/AIVisorOrb';
import { EmotionDiscoveryHub } from '@/components/EmotionDiscoveryHub';
import { bucketOf, emotionOf, type MeterBucket } from '@/lib/emotions';
import { LiquidGlassSheet } from '@/components/LiquidGlassSheet';
import { PrismaticLiquidBlob } from '@/components/PrismaticLiquidBlob';
import { StateMessage } from '@/components/StateMessage';
import { TopicThumb } from '@/components/TopicThumb';
import { countBySentiment, fetchTopicThumbnails, getTrendingTopics, searchPostsFuzzy, suggestTopics } from '@/lib/feedData';
import type { PrivacyMode } from '@/types/privacy';
import type { PublicPost, SearchResult, TrendingTopic } from '@/types/social';

const DEBOUNCE_MS = 300;
const MODE_LABEL: Record<PrivacyMode, string> = { mask: '3D Mask', blur: 'Blur', shadow: 'Shadow', noface: 'NoFace' };
const AURA = ['#f9c9b6', '#c9d8f5', '#e4c9f0', '#cfe8d5', '#f8e3a8'];
/** Where up to four thumbnails sit inside a cluster: slightly uneven, so it looks grown rather than gridded. */
const CLUSTER = [
  { x: 6, y: 34, size: 52 },
  { x: 54, y: 4, size: 62 },
  { x: 96, y: 44, size: 48 },
  { x: 48, y: 62, size: 40 },
] as const;
const RING_SIZE = 260;
const RING_THUMB = 52;

type Loaded<T> = { key: string; data: T; error?: undefined } | { key: string; data?: undefined; error: string };

const searchUrl = (q: string): string => (q ? `/search?q=${encodeURIComponent(q)}` : '/search');
const messageOf = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);
const auraFor = (topic: string): string => AURA[[...topic].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AURA.length];

export default function SearchPage() {
  return (
    <Suspense fallback={<StateMessage title="Loading search…" />}>
      <SearchContent />
    </Suspense>
  );
}

function SearchContent() {
  const router = useRouter();
  const q = (useSearchParams().get('q') ?? '').trim();

  // The box shows what the visitor types; the URL follows 300 ms later. A URL change that did not come from typing
  // (Back button, a topic tap) is copied into the box, but our own delayed updates never overwrite fresh keystrokes.
  const [text, setText] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const [completion, setCompletion] = useState<{ prefix: string; topic: string } | null>(null);
  const [allowCompletion, setAllowCompletion] = useState(false);
  const suggested = allowCompletion && completion?.prefix === text ? completion.topic : null;
  useEffect(() => {
    if (!allowCompletion || !text.trim() || text.length > 160) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void suggestTopics(text, controller.signal).then(topics => {
        const topic = topics.find(value => value.length > text.length && value.toLowerCase().startsWith(text.toLowerCase()));
        if (topic && !controller.signal.aborted) setCompletion({ prefix: text, topic });
      }).catch(() => {});
    }, 35);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [allowCompletion, text]);
  useLayoutEffect(() => {
    if (suggested && input.current === document.activeElement) input.current?.setSelectionRange(text.length, suggested.length);
  }, [text, suggested]);
  const [syncedQ, setSyncedQ] = useState(q);
  const [lastPushed, setLastPushed] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    if (q !== lastPushed) setText(q);
  }

  useEffect(() => {
    const next = text.trim();
    if (next === q) return;
    const id = setTimeout(() => {
      setLastPushed(next);
      router.replace(searchUrl(next), { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, q, router]);

  const chooseTopic = (topic: string) => {
    setAllowCompletion(false);
    setText(topic);
    setLastPushed(topic);
    router.replace(searchUrl(topic), { scroll: false });
  };

  const [trending, setTrending] = useState<Loaded<{ topics: TrendingTopic[]; thumbs: Record<string, PublicPost[]> }> | null>(null);
  const [results, setResults] = useState<Loaded<SearchResult[]> | null>(null);
  const [filter, setFilter] = useState<SentimentFilter>('all');
  const [emotionFilter, setEmotionFilter] = useState<MeterBucket | 'all'>('all');

  useEffect(() => {
    if (trending !== null) return;
    let alive = true;
    getTrendingTopics(10)
      .then(async (topics) => {
        const thumbs = await fetchTopicThumbnails(topics.map((t) => t.topic_entity)).catch(() => ({}));
        if (alive) setTrending({ key: 'trending', data: { topics, thumbs } });
      })
      .catch((e: unknown) => { if (alive) setTrending({ key: 'trending', error: messageOf(e, 'Could not load trending topics.') }); });
    return () => { alive = false; };
  }, [trending]);

  useEffect(() => {
    if (!q) return;
    let alive = true;
    const controller = new AbortController();
    searchPostsFuzzy(q, controller.signal)
      .then((data) => { if (alive) setResults({ key: q, data }); })
      .catch((e: unknown) => { if (alive) setResults({ key: q, error: messageOf(e, 'Search failed.') }); });
    return () => { alive = false; controller.abort(); };
  }, [q]);

  const current = results?.key === q ? results : null;
  const reviews = useMemo(() => current?.data ?? [], [current]);
  const counts = useMemo(() => countBySentiment(reviews), [reviews]);
  const visible = useMemo(() => reviews.filter((r) => (filter === 'all' || r.sentiment === filter) && (emotionFilter === 'all' || bucketOf(emotionOf(r)) === emotionFilter)), [reviews, filter, emotionFilter]);
  // The ring first shows the same thumbnails the cluster had (so they glide into place), then the real search results.
  const ringPosts = useMemo<PublicPost[]>(() => {
    const fromCluster = trending?.data?.thumbs[q];
    return (fromCluster && fromCluster.length > 0 ? fromCluster : reviews).slice(0, 6);
  }, [trending, q, reviews]);
  const split = verdictPercentages(counts.positive, counts.negative);
  const summary = reviews.find((r) => r.ai_summary)?.ai_summary ?? null;

  return (
    <div className="mesh-aura relative mx-auto min-h-[calc(100dvh-var(--nav-h))] w-full max-w-xl overflow-hidden px-4 pt-[max(1rem,env(safe-area-inset-top))] text-slate-900">
      <div className="flex items-center gap-2">
        {q && (
          <button type="button" onClick={() => chooseTopic('')} aria-label="Back to trending topics" className="acrylic-pill flex size-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-slate-900">
            <ArrowLeft aria-hidden className="size-5" />
          </button>
        )}
        <form role="search" onSubmit={(e) => { e.preventDefault(); chooseTopic(suggested ?? text.trim()); }} className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            ref={input}
            maxLength={160}
            aria-autocomplete="inline"
            value={suggested ?? text}
            onChange={(e) => {
              const event = e.nativeEvent as InputEvent;
              setAllowCompletion(!event.isComposing && event.inputType === 'insertText');
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (suggested && (e.key === 'Tab' || e.key === 'ArrowRight')) {
                if (e.key === 'ArrowRight') e.preventDefault();
                chooseTopic(suggested);
              }
              if (e.key === 'Escape') setAllowCompletion(false);
            }}
            placeholder="Search a product"
            aria-label="Search products and topics"
            autoComplete="off"
            enterKeyHint="search"
            className="h-12 w-full rounded-full border border-white/90 bg-white/75 pl-11 pr-11 text-base text-slate-900 shadow-sm backdrop-blur-xl placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-slate-800 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={() => chooseTopic('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 focus-visible:outline-2 focus-visible:outline-slate-800">
              <X aria-hidden className="size-4" />
            </button>
          )}
        </form>
      </div>

      <div className="flex flex-col items-center pb-1 pt-5">
        <div className="relative"><AIVisorOrb state={q && current === null ? 'thinking' : 'idle'} size="lg" />{q && current === null && <span className="absolute -bottom-2 -right-2"><PrismaticLiquidBlob state="processing" size="sm" /></span>}</div>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">{q && current === null ? 'Reading the room' : 'Vybe assistant'}</p>
      </div>

      <LayoutGroup>
        {!q && <TrendingClusters state={trending} onPick={chooseTopic} />}

        {q && (
          <>
            <OrbitHero topic={q} posts={ringPosts} split={split} total={counts.all} summary={summary} ready={current?.data !== undefined} />
            {current?.error && <Notice>{current.error}</Notice>}
            {current?.data && reviews.length > 0 && (
              <LiquidGlassSheet className="mt-5 space-y-4 p-4">
                <EmotionDiscoveryHub key={q} reviews={reviews} selected={emotionFilter} onSelect={setEmotionFilter} />
                <SentimentVerdictBar positiveCount={counts.positive} negativeCount={counts.negative} neutralCount={counts.neutral} activeFilter={filter} onFilterChange={setFilter} />
                <ul className="flex flex-col gap-3">
                  {visible.map((review) => (
                    <li key={review.id}><ReviewCard review={review} /></li>
                  ))}
                </ul>
              </LiquidGlassSheet>
            )}
            {current?.data && reviews.length === 0 && <Notice>No reviews for “{q}” yet.</Notice>}
          </>
        )}
      </LayoutGroup>
    </div>
  );
}

function TrendingClusters({ state, onPick }: { state: Loaded<{ topics: TrendingTopic[]; thumbs: Record<string, PublicPost[]> }> | null; onPick: (topic: string) => void }) {
  const reduceMotion = useReducedMotion();
  if (!state) return <Notice>Loading trending topics…</Notice>;
  if (state.error !== undefined) return <Notice>{state.error}</Notice>;
  const { topics, thumbs } = state.data;
  if (topics.length === 0) return <Notice>No trending topics yet. Search a product to get started.</Notice>;
  return (
    <section aria-labelledby="trending-heading" className="mt-5 pb-8">
      <div className="mb-4 flex items-end justify-between px-1"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">Fresh from the community</p><h2 id="trending-heading" className="mt-1 text-xl font-semibold tracking-tight">Explore reviews</h2></div><span className="text-xs text-slate-500">Trending</span></div>
      <ul className="mt-4 grid grid-cols-2 gap-x-2 gap-y-8">
        {topics.map((topic) => (
          <li key={topic.topic_entity}>
            <button
              type="button"
              onClick={() => onPick(topic.topic_entity)}
              aria-label={`${topic.topic_entity}, ${topic.total_posts} reviews`}
              className="group relative mx-auto flex w-full max-w-[170px] flex-col items-center focus-visible:outline-2 focus-visible:outline-slate-800"
            >
              <span className="relative block h-[130px] w-[150px]">
                <span aria-hidden className="absolute inset-3 rounded-full blur-2xl opacity-40" style={{ background: auraFor(topic.topic_entity) }} />
                {(thumbs[topic.topic_entity] ?? []).slice(0, 4).map((post, i) => (
                  <motion.span
                    key={post.id}
                    className="absolute"
                    style={{ left: CLUSTER[i].x, top: CLUSTER[i].y }}
                    animate={reduceMotion ? undefined : { y: [0, i % 2 ? -5 : 5, 0] }}
                    transition={{ duration: 5 + i, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <TopicThumb post={post} size={CLUSTER[i].size} />
                  </motion.span>
                ))}
              </span>
              <span className="mt-1 max-w-full truncate text-sm font-medium capitalize">{topic.topic_entity}</span>
              <span className="text-xs text-slate-500">{topic.total_posts} {topic.total_posts === 1 ? 'review' : 'reviews'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A topic in focus: its thumbnails on a thin ring around the verdict, with the AI summary and a way into the feed. */
function OrbitHero({ topic, posts, split, total, summary, ready }: { topic: string; posts: PublicPost[]; split: { positive: number; negative: number } | null; total: number; summary: string | null; ready: boolean }) {
  const reduceMotion = useReducedMotion();
  const radius = (RING_SIZE - RING_THUMB) / 2;
  return (
    <section aria-label={`Verdict for ${topic}`} className="mt-6 flex flex-col items-center text-center">
      <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <span aria-hidden className="absolute inset-6 rounded-full blur-2xl opacity-40" style={{ background: auraFor(topic) }} />
        <span aria-hidden className="absolute rounded-full border border-white/20" style={{ inset: RING_THUMB / 2 }} />
        {posts.map((post, i) => {
          const angle = (i / posts.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <motion.div
              key={post.id}
              className="absolute"
              style={{ left: RING_SIZE / 2 + Math.cos(angle) * radius - RING_THUMB / 2, top: RING_SIZE / 2 + Math.sin(angle) * radius - RING_THUMB / 2 }}
              animate={reduceMotion ? undefined : { scale: [1, 1.05, 1] }}
              transition={{ duration: 4 + i * 0.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <TopicThumb post={post} size={RING_THUMB} />
            </motion.div>
          );
        })}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {split ? (
            <>
              <span className="text-4xl font-semibold tabular-nums">{split.positive}%</span>
              <span className="text-xs text-slate-500">Positive</span>
            </>
          ) : (
              <span className="text-sm text-slate-500">{ready ? 'No verdict yet' : 'Reading reviews…'}</span>
          )}
        </div>
      </div>

      <h2 className="mt-4 text-lg font-medium capitalize">{topic}</h2>
      {split && <p className="mt-1 text-sm text-slate-600">{split.positive}% Positive • {split.negative}% Negative across {total} {total === 1 ? 'review' : 'reviews'}</p>}
      {summary && <p className="mt-2 max-w-xs text-sm text-slate-700">{summary}</p>}
      {ready && total > 0 && (
        <Link href={`/feed?topic=${encodeURIComponent(topic)}`} className="mt-4 min-h-11 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Open feed
        </Link>
      )}
    </section>
  );
}

function ReviewCard({ review }: { review: SearchResult }) {
  const dot = review.sentiment === 'positive' ? 'bg-emerald-500' : review.sentiment === 'negative' ? 'bg-rose-500' : 'bg-slate-300';
  return (
    <Link
      href={`/feed?postId=${review.id}`}
      className="block rounded-[22px] border border-white/80 bg-white/70 p-4 text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,.05)] backdrop-blur-xl transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-slate-800 motion-reduce:transition-none"
    >
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span aria-label={review.sentiment ?? 'unrated'} className={`size-2 shrink-0 rounded-full ${dot}`} />
        {review.is_incog ? (
          <span className="flex items-center gap-1 font-medium text-slate-800"><Ghost aria-hidden className="size-3.5" /> {review.incog_alias ?? 'Anon'}</span>
        ) : (
          <span className="font-medium text-slate-800">@{review.creator_username}</span>
        )}
        <span>{MODE_LABEL[review.mode]}</span>
        <span className="ml-auto flex items-center gap-1 tabular-nums"><Heart aria-hidden className="size-3.5" /> {review.likes_count}</span>
      </div>
      <p className="mt-2 text-sm leading-snug text-slate-800">{review.ai_summary || 'Summary on the way…'}</p>
      {review.key_points.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {review.key_points.map((point) => (
            <li key={point} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{point}</li>
          ))}
        </ul>
      )}
    </Link>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="mt-10 text-center text-sm text-slate-500">{children}</p>;
}
