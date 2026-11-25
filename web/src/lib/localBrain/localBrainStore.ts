'use client';

import { DEFAULT_LOCAL_WEIGHTS, type LocalGenomeWeights } from '@/lib/localBrain/localRanker';

const DB_NAME = 'vybe_local_brain';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const MAX_SEEN_IDS = 500;

export interface LocalBrainState {
  tasteVector: Float32Array | null;
  seenIds: string[];
  weights: LocalGenomeWeights;
}

const memoryFallback: LocalBrainState = {
  tasteVector: null,
  seenIds: [],
  weights: { ...DEFAULT_LOCAL_WEIGHTS },
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLocalBrainState(): Promise<LocalBrainState> {
  try {
    const [tasteRaw, seenRaw, weightsRaw] = await Promise.all([
      idbGet<number[] | Float32Array>('tasteVector'),
      idbGet<string[]>('seenIds'),
      idbGet<LocalGenomeWeights>('weights'),
    ]);
    const tasteVector =
      tasteRaw instanceof Float32Array
        ? tasteRaw
        : Array.isArray(tasteRaw)
          ? Float32Array.from(tasteRaw)
          : null;
    const seenIds = Array.isArray(seenRaw) ? seenRaw.slice(-MAX_SEEN_IDS) : [];
    const weights = weightsRaw && typeof weightsRaw.wVibe === 'number' ? weightsRaw : { ...DEFAULT_LOCAL_WEIGHTS };
    return { tasteVector, seenIds, weights };
  } catch {
    return {
      tasteVector: memoryFallback.tasteVector ? new Float32Array(memoryFallback.tasteVector) : null,
      seenIds: [...memoryFallback.seenIds],
      weights: { ...memoryFallback.weights },
    };
  }
}

export async function saveLocalTasteVector(vec: Float32Array | null): Promise<void> {
  memoryFallback.tasteVector = vec ? new Float32Array(vec) : null;
  try {
    await idbSet('tasteVector', vec ? Array.from(vec) : null);
  } catch {
    // Fallback already updated
  }
}

export async function appendLocalSeenId(postId: string): Promise<void> {
  const next = memoryFallback.seenIds.filter((id) => id !== postId);
  next.push(postId);
  if (next.length > MAX_SEEN_IDS) next.splice(0, next.length - MAX_SEEN_IDS);
  memoryFallback.seenIds = next;

  try {
    const existing = (await idbGet<string[]>('seenIds')) ?? [];
    const merged = existing.filter((id) => id !== postId);
    merged.push(postId);
    if (merged.length > MAX_SEEN_IDS) merged.splice(0, merged.length - MAX_SEEN_IDS);
    await idbSet('seenIds', merged);
  } catch {
    // Fallback already updated
  }
}

export async function saveLocalWeights(weights: LocalGenomeWeights): Promise<void> {
  memoryFallback.weights = { ...weights };
  try {
    await idbSet('weights', weights);
  } catch {
    // Fallback already updated
  }
}
