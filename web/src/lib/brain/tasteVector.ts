export const VIBE_VECTOR_DIM = 384;

function fnv1a32(input: string, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-8) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * Indrajaal EMA Taste Vector Update:
 * Pulls user vector toward liked posts and pushes away from fast-skipped posts.
 * Fix #3: On cold-start (`currentTaste === null`), scales by `reward` (returns `null` when reward is 0)
 * so fast-skipping the very first video repels rather than attracts similar content.
 */
export function updateTasteVector(
  currentTaste: Float32Array | null,
  postVector: Float32Array,
  reward: number,
  learningRate = 0.12
): Float32Array | null {
  const dim = postVector.length;
  if (dim === 0 || !Number.isFinite(reward)) return currentTaste;

  const next = new Float32Array(dim);
  if (!currentTaste || currentTaste.length !== dim) {
    if (Math.abs(reward) < 1e-6) return null;
    for (let i = 0; i < dim; i++) {
      next[i] = postVector[i] * reward;
    }
  } else {
    const lr = Math.min(1, Math.max(0.001, learningRate));
    for (let i = 0; i < dim; i++) {
      next[i] = (1 - lr) * currentTaste[i] + lr * reward * postVector[i];
    }
  }

  let sumSq = 0;
  for (let i = 0; i < dim; i++) sumSq += next[i] * next[i];
  const norm = Math.sqrt(sumSq);
  if (norm <= 1e-8) return currentTaste;
  for (let i = 0; i < dim; i++) next[i] /= norm;
  return next;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 1e-8) return 0;
  return Math.min(1, Math.max(-1, dot / denom));
}

export function cosineToUnitScore(cos: number): number {
  return Math.min(1, Math.max(0, (cos + 1) / 2));
}

export function parsePgVector(raw: unknown, expectedDim = VIBE_VECTOR_DIM): Float32Array | null {
  let values: number[] | null = null;
  if (Array.isArray(raw)) {
    values = raw.map(Number);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      values = trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => Number(s.trim()));
    }
  }
  if (!values || values.length !== expectedDim || !values.every(Number.isFinite)) return null;
  return Float32Array.from(values);
}

export function formatPgVector(vec: Float32Array): string {
  const parts = new Array<string>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    parts[i] = Number.isFinite(v) ? v.toFixed(6) : '0';
  }
  return `[${parts.join(',')}]`;
}

/**
 * Deterministic multilingual signed feature hashing into `Float32Array(384)`.
 * Provides zero-cost semantic clustering fallback when external embeddings are unavailable.
 */
export function computeSemanticHashVector384(text: string): Float32Array {
  const vec = new Float32Array(VIBE_VECTOR_DIM);
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) {
    vec[0] = 1;
    return vec;
  }

  const addFeature = (token: string, weight: number) => {
    const h = fnv1a32(token);
    const idx = h % VIBE_VECTOR_DIM;
    const sign = (fnv1a32(token, 1337) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  };

  const words = clean.split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;
    addFeature(`w:${w}`, 1.5);
    if (i + 1 < words.length && words[i + 1]) {
      addFeature(`b:${w}_${words[i + 1]}`, 1.2);
    }
    const padded = `^${w}$`;
    for (let j = 0; j <= padded.length - 3; j++) {
      addFeature(`c3:${padded.slice(j, j + 3)}`, 0.55);
    }
    for (let j = 0; j <= padded.length - 4; j++) {
      addFeature(`c4:${padded.slice(j, j + 4)}`, 0.45);
    }
  }

  let sumSq = 0;
  for (let i = 0; i < VIBE_VECTOR_DIM; i++) sumSq += vec[i] * vec[i];
  if (sumSq <= 1e-8) {
    vec[0] = 1;
    return vec;
  }
  return l2Normalize(vec);
}
