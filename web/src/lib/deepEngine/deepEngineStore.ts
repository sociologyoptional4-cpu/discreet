'use client';

import type { HebbianSnapshot } from '@/lib/deepEngine/hebbianGraph';
import type { MarkovSnapshot } from '@/lib/deepEngine/markovPredictor';
import type { BloomSnapshot } from '@/lib/deepEngine/rotatingBloom';

const DB_NAME = 'vybe_deep_engine';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

export interface DeepEnginePersisted {
  bloom?: BloomSnapshot;
  markov?: MarkovSnapshot;
  hebbian?: HebbianSnapshot;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function loadDeepEngineState(): Promise<DeepEnginePersisted> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const bReq = store.get('bloom');
      const mReq = store.get('markov');
      const hReq = store.get('hebbian');
      tx.oncomplete = () =>
        resolve({
          bloom: bReq.result as BloomSnapshot | undefined,
          markov: mReq.result as MarkovSnapshot | undefined,
          hebbian: hReq.result as HebbianSnapshot | undefined,
        });
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return {};
  }
}

export async function saveDeepEngineState(data: DeepEnginePersisted): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      if (data.bloom) store.put(data.bloom, 'bloom');
      if (data.markov) store.put(data.markov, 'markov');
      if (data.hebbian) store.put(data.hebbian, 'hebbian');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}
