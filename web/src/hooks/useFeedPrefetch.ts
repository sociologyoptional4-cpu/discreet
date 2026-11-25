'use client';
import { useEffect, useRef } from 'react';
import { registerVybeMedia } from '@/lib/media/devHooks';
import { feedPrefetcher } from '@/lib/media/feedPrefetcher';
import { getTtffSamples, summarizeTtff } from '@/lib/media/ttff';

type Options<T> = {
  items: readonly T[];
  activeIndex: number;
  /** The video URL to warm for an item, or null for items that are not plain videos (3D scenes, images, audio). */
  urlOf: (item: T) => string | null;
  /**
   * First slide ahead to prefetch. Default 2: the video pool already preloads the active slide and its neighbours,
   * so warming slide +1 would only duplicate that request.
   */
  startOffset?: number;
  /** How many slides to warm, starting at `startOffset`. Default 2. */
  lookahead?: number;
  /** Wait after the active slide changes before fetching. Default 120 ms. */
  settleMs?: number;
  /** Two slide changes closer than this count as a fling and wait 2.5x longer. Default 350 ms. */
  flingMs?: number;
  /** While this returns true no new prefetch starts (the playing video is still filling its own buffer). */
  pauseGate?: () => boolean;
};

/** Keeps the next slides' first bytes warm in the HTTP cache. Thin wrapper around `feedPrefetcher`. */
export function useFeedPrefetch<T>({ items, activeIndex, urlOf, startOffset = 2, lookahead = 2, settleMs = 120, flingMs = 350, pauseGate }: Options<T>): void {
  const urlOfRef = useRef(urlOf);
  const gateRef = useRef(pauseGate);
  const lastIndex = useRef(activeIndex);
  const lastChangeAt = useRef(0);

  useEffect(() => {
    urlOfRef.current = urlOf;
    gateRef.current = pauseGate;
  });

  useEffect(() => {
    feedPrefetcher.setPauseGate(() => gateRef.current?.() ?? false);
    registerVybeMedia('prefetcher', feedPrefetcher);
    registerVybeMedia('ttff', { samples: getTtffSamples, summary: summarizeTtff });
    return () => {
      feedPrefetcher.setPauseGate(null);
      feedPrefetcher.abortAll();
    };
  }, []);

  useEffect(() => {
    const now = performance.now();
    const moved = lastIndex.current !== activeIndex;
    const quick = moved && now - lastChangeAt.current < flingMs;
    if (moved) {
      lastIndex.current = activeIndex;
      lastChangeAt.current = now;
    }

    const urls: string[] = [];
    for (let offset = startOffset; offset < startOffset + lookahead; offset++) {
      const item = items[activeIndex + offset];
      const url = item === undefined ? null : urlOfRef.current(item);
      if (url) urls.push(url);
    }

    const timer = window.setTimeout(() => feedPrefetcher.prefetchWindow(urls), quick ? settleMs * 2.5 : settleMs);
    return () => window.clearTimeout(timer);
  }, [items, activeIndex, startOffset, lookahead, settleMs, flingMs]);
}
