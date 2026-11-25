'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextFeedPage } from '@/lib/feedClient';
import { withViewerState } from '@/lib/feedData';
import { resolveMediaUrl } from '@/lib/demoData';
import { evaluateFeedNudge, type FeedNudgePayload } from '@/lib/feed/aiNudgeEngine';
import {
  getSessionContext,
  markNudgeAccepted,
  markNudgeDismissed,
  markNudgeShown,
  recordWatchedPost,
} from '@/lib/feed/sessionContext';
import { isDemoMode, supabase } from '@/lib/supabase';
import { queueBrainSwipe, startBrainSignals } from '@/lib/brain/brainClient';
import { startTelemetry, trackPost } from '@/lib/telemetry';
import type { FeedItem, PublicPost } from '@/types/social';

const topicOf = (item: FeedItem) => item.topic_entity?.trim().toLowerCase();

export function useFeedEngine(initial: FeedItem[], paginate: boolean, snapshot: string) {
  const [items, setItems] = useState(initial);
  const [activeId, setActiveId] = useState(initial[0]?.id ?? '');
  const [nudge, setNudge] = useState<FeedNudgePayload | null>(null);
  const index = Math.max(0, items.findIndex((post) => post.id === activeId));
  const active = items[index];
  const next = items[index + 1];
  const downrank = useRef(new Set<string>());
  const seen = useRef(new Set(initial.map((post) => post.id)));
  const skips = useRef<string[]>([]);
  const exhausted = useRef(false);
  const [retry, setRetry] = useState(0);
  const clock = useRef<{ item: FeedItem; visibleMs: number; playMs: number; visibleStart: number | null; playingStart: number | null } | null>(null);
  const paused = useRef(false);
  const jumpPrefetchRef = useRef<AbortController | null>(null);

  const adapt = useCallback((topic: string, current: string) => {
    downrank.current.add(topic);
    setItems((list) => {
      const pos = list.findIndex((post) => post.id === current);
      if (pos < 0) return list;
      const queued = list.slice(pos + 1);
      const disliked = (row: FeedItem) => downrank.current.has(topicOf(row) ?? '');
      return [...list.slice(0, pos + 1), ...queued.filter((row) => !disliked(row)), ...queued.filter(disliked)];
    });
  }, []);

  const notInterested = useCallback((item: FeedItem) => {
    trackPost(item.id, 'not_interested');
    const topic = topicOf(item);
    if (topic) adapt(topic, item.id);
  }, [adapt]);

  const needPage = !isDemoMode && paginate && items.length - index <= 5;
  useEffect(() => {
    if (!needPage || exhausted.current) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const page = await nextFeedPage(snapshot, [...seen.current], [...downrank.current], items.at(-1)?.id ?? null, controller.signal);
      const fresh = page.posts.filter((row) => !seen.current.has(row.id));
      const enriched = await withViewerState(fresh);
      if (controller.signal.aborted) return;
      if (!enriched.length || !page.hasMore) exhausted.current = true;
      for (const post of enriched) seen.current.add(post.id);
      if (enriched.length) setItems((list) => [...list, ...enriched]);
    };
    void load().catch(() => {
      if (!controller.signal.aborted) timer = setTimeout(() => setRetry((count) => count + 1), 5000);
    });
    return () => { controller.abort(); clearTimeout(timer); };
  }, [items, needPage, retry, snapshot]);

  const tick = useCallback((visible: boolean, play: boolean) => {
    const state = clock.current;
    if (!state) return;
    const now = performance.now();
    if (state.visibleStart !== null) state.visibleMs += now - state.visibleStart;
    if (state.playingStart !== null) state.playMs += now - state.playingStart;
    state.visibleStart = visible ? now : null;
    state.playingStart = visible && play ? now : null;
  }, []);

  const playback = useCallback((playing: boolean) => {
    paused.current = !playing;
    tick(!document.hidden, playing);
  }, [tick]);

  const finish = useCallback((swipeTo?: string) => {
    const state = clock.current;
    if (!state) return;
    tick(false, false);
    clock.current = null;
    const duration = Math.round(state.item.duration_sec * 1000);
    const watch = Math.round(state.playMs);
    const completionRate = duration > 0 ? watch / duration : 0;

    trackPost(state.item.id, 'watch_time_ms', watch);
    if (duration > 0) {
      trackPost(state.item.id, 'video_duration_ms', duration);
      trackPost(state.item.id, 'completion_rate', completionRate);
      trackPost(state.item.id, 'rewatch_count', Math.max(0, Math.ceil(watch / duration) - 1));
    }

    const effectiveWatchMs = state.playMs > 0 ? state.playMs : state.visibleMs;
    const effectiveDurationMs = duration > 0 ? duration : 15_000;
    const watchRatio = effectiveWatchMs / effectiveDurationMs;
    const fastSkip = Boolean(swipeTo && state.visibleMs < 2000);
    queueBrainSwipe({
      postId: state.item.id,
      watchRatio,
      rewatched: watchRatio >= 1.35,
      shared: false,
      liked: Boolean(state.item.liked),
      fastSkip,
    });

    const itemMeta = state.item as FeedItem & { category?: string | null; key_points?: string[] | null };
    const updatedCtx = recordWatchedPost({
      postId: state.item.id,
      creatorId: state.item.user_id,
      creatorUsername: state.item.creator_username,
      topic_entity: state.item.topic_entity,
      category: itemMeta.category ?? null,
      emotion_tag: state.item.emotion_tag ?? null,
      sentiment: state.item.sentiment,
      transcript: state.item.transcript,
      key_points: itemMeta.key_points ?? [],
      watchDurationMs: watch,
      completionRate,
      reacted: Boolean(state.item.liked),
      followedCreator: Boolean(state.item.following),
    });

    if (!isDemoMode && swipeTo) {
      const lastWatched = updatedCtx.watchedPosts[updatedCtx.watchedPosts.length - 1] ?? null;
      void evaluateFeedNudge(updatedCtx, lastWatched).then((found) => {
        if (found) {
          markNudgeShown();
          setNudge(found);
        }
      });
    }

    if (!swipeTo) return;
    const topic = topicOf(state.item);
    if (state.visibleMs >= 2000) { skips.current = []; return; }
    trackPost(state.item.id, 'fast_skip');
    skips.current = [...skips.current.slice(-2), topic ?? ''];
    if (topic && skips.current.filter((value) => value === topic).length >= 2) adapt(topic, swipeTo);
  }, [adapt, tick]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      clock.current = { item: active, visibleMs: 0, playMs: 0, visibleStart: document.hidden ? null : performance.now(), playingStart: null };
      const media = document.querySelector<HTMLMediaElement>(`[data-post-id="${CSS.escape(active.id)}"] video, [data-post-id="${CSS.escape(active.id)}"] audio`);
      paused.current = !media || media.paused || media.readyState < 3;
      tick(!document.hidden, !paused.current);
      trackPost(active.id, 'impression');
    });
    const visibility = () => tick(!document.hidden, !paused.current);
    document.addEventListener('visibilitychange', visibility);
    return () => { alive = false; document.removeEventListener('visibilitychange', visibility); finish(); };
  }, [active, finish, tick]);

  useEffect(startTelemetry, []);
  useEffect(startBrainSignals, []);

  const select = useCallback((id: string) => {
    if (clock.current && clock.current.item.id !== id) finish(id);
    setActiveId(id);
  }, [finish]);

  const dismissNudge = useCallback(() => {
    markNudgeDismissed();
    setNudge(null);
  }, []);

  /** Fetches (if needed) and injects `targetPostId` at `activeIndex + 1`, prefetches media, and snaps to it. */
  const jumpToPost = useCallback(async (targetPostId: string, scroller?: HTMLElement | null): Promise<boolean> => {
    let targetItem = items.find((p) => p.id === targetPostId);

    if (!targetItem && !isDemoMode) {
      const { data } = await supabase
        .from('public_posts')
        .select('*')
        .eq('id', targetPostId)
        .maybeSingle<PublicPost>();
      if (!data) return false;
      const [enriched] = await withViewerState([data]);
      targetItem = enriched;
    }

    if (!targetItem) return false;

    markNudgeAccepted();
    setNudge(null);
    seen.current.add(targetItem.id);

    jumpPrefetchRef.current?.abort();
    const ctrl = new AbortController();
    jumpPrefetchRef.current = ctrl;
    if (targetItem.motion_url) {
      void fetch(targetItem.motion_url, { signal: ctrl.signal, cache: 'force-cache', credentials: 'omit' }).catch(() => {});
    }
    if (targetItem.media_url) {
      void fetch(resolveMediaUrl(targetItem.media_url), {
        headers: { Range: 'bytes=0-131071' },
        signal: ctrl.signal,
        cache: 'force-cache',
        credentials: 'omit',
      }).catch(() => {});
    }

    const chosen = targetItem;
    setItems((list) => {
      const curIdx = Math.max(0, list.findIndex((p) => p.id === activeId));
      const deduped = list.filter((p) => p.id !== chosen.id);
      const insertAt = Math.min(deduped.length, curIdx + 1);
      return [...deduped.slice(0, insertAt), chosen, ...deduped.slice(insertAt)];
    });

    trackPost(chosen.id, 'nudge_click');

    requestAnimationFrame(() => {
      const el =
        scroller?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(chosen.id)}"]`) ??
        document.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(chosen.id)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      select(chosen.id);
    });

    return true;
  }, [activeId, items, select]);

  useEffect(() => {
    if (!next || isDemoMode) return;
    const control = new AbortController();
    if (next.media_url) void fetch(resolveMediaUrl(next.media_url), {
      headers: { Range: 'bytes=0-131071' }, signal: control.signal, cache: 'force-cache', credentials: 'omit',
    }).then(async (response) => {
      if (response.status === 206) await response.arrayBuffer();
      else await response.body?.cancel();
    }).catch(() => {});
    if (next.motion_url) void fetch(next.motion_url, { signal: control.signal, cache: 'force-cache', credentials: 'omit' })
      .then((response) => response.arrayBuffer()).catch(() => {});
    return () => control.abort();
  }, [next]);

  return { items, index, active, select, notInterested, playback, nudge, dismissNudge, jumpToPost, getSessionContext };
}
