export const LOCAL_VECTOR_DIM = 64;

/**
 * Truncates (Matryoshka) and quantizes a normalized Float32 vector into Int8 (-127..127).
 * Shrinks 1,536 bytes -> 64 bytes per post for instant edge delivery.
 */
export function quantizeToInt8(vec: ArrayLike<number>): Int8Array {
  const out = new Int8Array(LOCAL_VECTOR_DIM);
  const len = Math.min(LOCAL_VECTOR_DIM, vec.length);
  for (let i = 0; i < len; i++) {
    const v = vec[i];
    const clamped = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    out[i] = Math.round(clamped * 127);
  }
  return out;
}

/**
 * Fast cosine similarity between a Float32 user taste vector and an Int8 post vector,
 * mapped from `[-1, 1]` into `[0, 1]`.
 */
export function cosineSimInt8(
  userTaste: Float32Array,
  postInt8: Int8Array
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(userTaste.length, postInt8.length);

  for (let i = 0; i < len; i++) {
    const a = userTaste[i];
    const b = postInt8[i] / 127;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-8) return 0.5;
  return Math.max(0, Math.min(1, (dot / denom + 1) * 0.5));
}

function normalizeF32(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-8) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/**
 * Updates the user's private on-device taste vector via EMA.
 * Cold-start guard: ignores negative/zero skips until the user has at least 1 positive signal.
 */
export function updateLocalTaste(
  current: Float32Array | null,
  postInt8: Int8Array,
  reward: number,
  eta = 0.14
): Float32Array | null {
  if (!Number.isFinite(reward) || postInt8.length === 0) return current;

  if (!current || current.length !== LOCAL_VECTOR_DIM) {
    if (reward <= 0) return null;
    const init = new Float32Array(LOCAL_VECTOR_DIM);
    const len = Math.min(LOCAL_VECTOR_DIM, postInt8.length);
    for (let i = 0; i < len; i++) init[i] = postInt8[i] / 127;
    return normalizeF32(init);
  }

  const lr = Math.min(1, Math.max(0.001, eta));
  const next = new Float32Array(LOCAL_VECTOR_DIM);
  const len = Math.min(LOCAL_VECTOR_DIM, postInt8.length);
  for (let i = 0; i < len; i++) {
    const p = postInt8[i] / 127;
    next[i] = (1 - lr) * current[i] + lr * reward * p;
  }
  return normalizeF32(next);
}
