'use client';

import { deepEngine } from '@/lib/deepEngine/deepEngineClient';
import {
  appendLocalSeenId,
  loadLocalBrainState,
  saveLocalTasteVector,
} from '@/lib/localBrain/localBrainStore';
import {
  rankPoolLocally,
  type LocalGenomeWeights,
  type PoolPostItem,
} from '@/lib/localBrain/localRanker';
import { updateLocalTaste } from '@/lib/localBrain/quantizedVector';
import type { PublicPost } from '@/types/social';

export interface EdgePoolEntry extends PoolPostItem {
  post: PublicPost;
}

const postVectors = new Map<string, number[]>();
let worker: Worker | null = null;
let workerFailed = false;
let reqSeq = 0;
let memTaste: Float32Array | null = null;
let memLoaded = false;
let swipesSinceFlush = 0;

function getWorker(): Worker | null {
  if (workerFailed || typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../../workers/feedRanker.worker.ts', import.meta.url));
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

function rankInWorker(
  pool: PoolPostItem[],
  tasteVector: Float32Array | null,
  seenIds: string[],
  weights: LocalGenomeWeights,
): Promise<string[]> {
  const w = getWorker();
  if (!w) {
    return Promise.resolve(
      rankPoolLocally(pool, tasteVector, new Set(seenIds), weights).map((p) => p.id),
    );
  }

  return new Promise((resolve) => {
    const requestId = ++reqSeq;
    const timeout = window.setTimeout(() => {
      w.removeEventListener('message', onMsg);
      resolve(rankPoolLocally(pool, tasteVector, new Set(seenIds), weights).map((p) => p.id));
    }, 600);

    const onMsg = (event: MessageEvent<{ type?: string; requestId?: number; orderedIds?: string[] }>) => {
      if (event.data?.type !== 'RANK_RESULT' || event.data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      w.removeEventListener('message', onMsg);
      resolve(event.data.orderedIds ?? pool.map((p) => p.id));
    };

    w.addEventListener('message', onMsg);
    w.postMessage({
      type: 'RANK_POOL',
      requestId,
      pool,
      tasteArray: tasteVector ? Array.from(tasteVector) : null,
      seenIds,
      weights,
    });
  });
}

function updateTasteInWorker(
  current: Float32Array | null,
  postInt8: number[],
  reward: number,
): Promise<Float32Array | null> {
  const w = getWorker();
  if (!w) {
    return Promise.resolve(updateLocalTaste(current, Int8Array.from(postInt8), reward));
  }

  return new Promise((resolve) => {
    const requestId = ++reqSeq;
    const timeout = window.setTimeout(() => {
      w.removeEventListener('message', onMsg);
      resolve(updateLocalTaste(current, Int8Array.from(postInt8), reward));
    }, 400);

    const onMsg = (event: MessageEvent<{ type?: string; requestId?: number; tasteArray?: number[] | null }>) => {
      if (event.data?.type !== 'TASTE_RESULT' || event.data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      w.removeEventListener('message', onMsg);
      const arr = event.data.tasteArray;
      resolve(Array.isArray(arr) ? Float32Array.from(arr) : null);
    };

    w.addEventListener('message', onMsg);
    w.postMessage({
      type: 'UPDATE_TASTE',
      requestId,
      tasteArray: current ? Array.from(current) : null,
      postInt8,
      reward,
    });
  });
}

/**
 * Fetches the globally edge-cached pool (`GET /api/feed/pool`) and ranks it 100% locally
 * in a Web Worker using the user's private IndexedDB taste vector and seen history.
 */
export async function rankFeedViaLocalPool(limit = 30): Promise<PublicPost[] | null> {
  if (typeof window === 'undefined') return null;

  const [res, state] = await Promise.all([
    fetch('/api/feed/pool'),
    loadLocalBrainState(),
  ]);
  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as { pool?: EdgePoolEntry[] } | null;
  const entries = Array.isArray(data?.pool) ? data.pool : [];
  if (entries.length === 0) return null;

  const preFiltered = entries.filter((entry) => !deepEngine.bloom.has(entry.id));
  const activeEntries = preFiltered.length > 0 ? preFiltered : entries;

  const byId = new Map<string, PublicPost>();
  const lightPool: PoolPostItem[] = [];
  for (const entry of activeEntries) {
    if (!entry?.post?.id) continue;
    byId.set(entry.post.id, entry.post);
    if (Array.isArray(entry.vibeInt8) && entry.vibeInt8.length > 0) {
      postVectors.set(entry.post.id, entry.vibeInt8);
    }
    lightPool.push({
      id: entry.id,
      creatorId: entry.creatorId,
      ageHours: entry.ageHours,
      pheromoneRaw: entry.pheromoneRaw,
      alpha: entry.alpha,
      beta: entry.beta,
      vibeInt8: entry.vibeInt8,
      tag: entry.post.topic_entity ?? null,
    });
  }

  let orderedIds = await rankInWorker(lightPool, state.tasteVector, state.seenIds, state.weights);
  // Apply Hebbian cross-tag affinity boost when active tag has wired neighbors
  const tagMap = new Map(lightPool.map((p) => [p.id, p.tag]));
  if (orderedIds.some((id) => deepEngine.getHebbianBoost(tagMap.get(id)) > 0)) {
    const n = orderedIds.length;
    orderedIds = [...orderedIds].sort((a, b) => {
      const idxA = orderedIds.indexOf(a);
      const idxB = orderedIds.indexOf(b);
      const scoreA = (n - idxA) / n + deepEngine.getHebbianBoost(tagMap.get(a)) * 0.25;
      const scoreB = (n - idxB) / n + deepEngine.getHebbianBoost(tagMap.get(b)) * 0.25;
      return scoreB - scoreA;
    });
  }
  const posts = orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is PublicPost => Boolean(p))
    .slice(0, limit);

  return posts.length > 0 ? posts : null;
}

/**
 * Updates the user's private on-device taste vector in memory and flushes to IndexedDB
 * every 10 swipes (never blocking the main thread on every swipe).
 */
export async function recordLocalSwipe(postId: string, reward: number): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!memLoaded) {
    memLoaded = true;
    const state = await loadLocalBrainState();
    memTaste = state.tasteVector;
  }
  const vec = postVectors.get(postId);
  if (vec) {
    memTaste = await updateTasteInWorker(memTaste, vec, reward);
  }
  swipesSinceFlush++;
  if (swipesSinceFlush >= 10) {
    swipesSinceFlush = 0;
    await appendLocalSeenId(postId);
    if (memTaste) await saveLocalTasteVector(memTaste);
  }
}
