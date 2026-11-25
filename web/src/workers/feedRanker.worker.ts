import { rankPoolLocally, type LocalGenomeWeights, type PoolPostItem } from '../lib/localBrain/localRanker.ts';
import { updateLocalTaste } from '../lib/localBrain/quantizedVector.ts';

type RankRequest = {
  type: 'RANK_POOL';
  requestId: number;
  pool: PoolPostItem[];
  tasteArray: number[] | null;
  seenIds: string[];
  weights?: LocalGenomeWeights;
};

type UpdateTasteRequest = {
  type: 'UPDATE_TASTE';
  requestId: number;
  tasteArray: number[] | null;
  postInt8: number[];
  reward: number;
};

self.onmessage = (event: MessageEvent<RankRequest | UpdateTasteRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'RANK_POOL') {
    const taste = msg.tasteArray ? Float32Array.from(msg.tasteArray) : null;
    const ranked = rankPoolLocally(msg.pool, taste, new Set(msg.seenIds), msg.weights);
    self.postMessage({
      type: 'RANK_RESULT',
      requestId: msg.requestId,
      orderedIds: ranked.map((p) => p.id),
    });
    return;
  }

  if (msg.type === 'UPDATE_TASTE') {
    const current = msg.tasteArray ? Float32Array.from(msg.tasteArray) : null;
    const next = updateLocalTaste(current, Int8Array.from(msg.postInt8), msg.reward);
    self.postMessage({
      type: 'TASTE_RESULT',
      requestId: msg.requestId,
      tasteArray: next ? Array.from(next) : null,
    });
  }
};
