'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextFeedPage } from '@/lib/feedClient';
import { withViewerState } from '@/lib/feedData';
import { resolveMediaUrl } from '@/lib/demoData';
import { isDemoMode } from '@/lib/supabase';
import { startTelemetry, trackPost } from '@/lib/telemetry';
import type { FeedItem } from '@/types/social';

const topicOf = (item: FeedItem) => item.topic_entity?.trim().toLowerCase();

export function useFeedEngine(initial: FeedItem[], paginate: boolean, snapshot: string) {
  const [items, setItems] = useState(initial);
  const [activeId, setActiveId] = useState(initial[0]?.id ?? '');
  const index = Math.max(0, items.findIndex(post => post.id === activeId));
  const active = items[index];
  const next = items[index + 1];
  const downrank = useRef(new Set<string>());
  const seen = useRef(new Set(initial.map(post => post.id)));
  const skips = useRef<string[]>([]);
  const exhausted = useRef(false);
  const [retry, setRetry] = useState(0);
  const clock = useRef<{ item: FeedItem; visibleMs: number; playMs: number; visibleStart: number | null; playingStart: number | null } | null>(null);
  const paused = useRef(false);

  const adapt = useCallback((topic: string, current: string) => {
    downrank.current.add(topic);
    setItems(list => {
      const pos = list.findIndex(post => post.id === current);
      if (pos < 0) return list;
      const queued = list.slice(pos + 1);
      const disliked = (row: FeedItem) => downrank.current.has(topicOf(row) ?? '');
      return [...list.slice(0, pos + 1), ...queued.filter(row => !disliked(row)), ...queued.filter(disliked)];
    });
  }, []);
  const notInterested = useCallback((item: FeedItem) => {
    trackPost(item.id, 'not_interested');
    const topic = topicOf(item);
    if (topic) adapt(topic, item.id);
  }, [adapt]);

  // A cancelled request never mutates the seen set. Retrying the same page therefore cannot lose candidates.
  const needPage = !isDemoMode && paginate && items.length - index <= 5;
  useEffect(() => {
    if (!needPage || exhausted.current) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const page = await nextFeedPage(snapshot, [...seen.current], [...downrank.current], items.at(-1)?.id ?? null, controller.signal);
      const fresh = page.posts.filter(row => !seen.current.has(row.id));
      const enriched = await withViewerState(fresh);
      if (controller.signal.aborted) return;
      if (!enriched.length || !page.hasMore) exhausted.current = true;
      for (const post of enriched) seen.current.add(post.id);
      if (enriched.length) setItems(list => [...list, ...enriched]);
    };
    void load().catch(() => {
      if (!controller.signal.aborted) timer = setTimeout(() => setRetry(count => count + 1), 5000);
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
    trackPost(state.item.id, 'watch_time_ms', watch);
    if (duration > 0) {
      trackPost(state.item.id, 'video_duration_ms', duration);
      trackPost(state.item.id, 'completion_rate', watch / duration);
      trackPost(state.item.id, 'rewatch_count', Math.max(0, Math.ceil(watch / duration) - 1));
    }
    if (!swipeTo) return;
    const topic = topicOf(state.item);
    if (state.visibleMs >= 2000) { skips.current = []; return; }
    trackPost(state.item.id, 'fast_skip');
    skips.current = [...skips.current.slice(-2), topic ?? ''];
    if (topic && skips.current.filter(value => value === topic).length >= 2) adapt(topic, swipeTo);
  }, [adapt, tick]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    // Ignore the disposable development Strict Mode mount.
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

  // Register after watch tracking so the final dwell is queued before unmount flush.
  useEffect(startTelemetry, []);

  const select = useCallback((id: string) => {
    if (clock.current && clock.current.item.id !== id) finish(id);
    setActiveId(id);
  }, [finish]);

  useEffect(() => {
    if (!next || isDemoMode) return;
    const control = new AbortController();
    // Warm the HTTP cache. A byte range avoids downloading the whole next video during a quick swipe.
    if (next.media_url) void fetch(resolveMediaUrl(next.media_url), {
      headers: { Range: 'bytes=0-131071' }, signal: control.signal, cache: 'force-cache', credentials: 'omit',
    }).then(async response => {
      if (response.status === 206) await response.arrayBuffer();
      else await response.body?.cancel();
    }).catch(() => {});
    if (next.motion_url) void fetch(next.motion_url, { signal: control.signal, cache: 'force-cache', credentials: 'omit' })
      .then(response => response.arrayBuffer()).catch(() => {});
    return () => control.abort();
  }, [next]);
  return { items, index, active, select, notInterested, playback };
}
