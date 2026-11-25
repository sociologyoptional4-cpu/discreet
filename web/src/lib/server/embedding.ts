import 'server-only';

type Task = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

const EMBEDDING_DIMS = 768;

function normalizeVector(vector: unknown): number[] | null {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS || !vector.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return null;
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) return null;
  return vector.map((v: number) => v / norm);
}

/** Deterministic L2-normalized 768-dim semantic hash fallback when no embedding API is configured. */
function computeSemanticHashVector768(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMS).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9#\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const features = [token];
    if (i + 1 < tokens.length) features.push(`${token}_${tokens[i + 1]}`);
    for (let c = 0; c <= token.length - 3; c++) features.push(token.slice(c, c + 3));

    for (const feat of features) {
      let h1 = 2166136261;
      let h2 = 0x9e3779b9;
      for (let j = 0; j < feat.length; j++) {
        const ch = feat.charCodeAt(j);
        h1 ^= ch;
        h1 = Math.imul(h1, 16777619);
        h2 ^= ch + j;
        h2 = Math.imul(h2, 2246822519);
      }
      const idx = Math.abs(h1) % EMBEDDING_DIMS;
      const sign = (h2 & 1) === 0 ? 1 : -1;
      vec[idx] += sign * (feat.startsWith('#') ? 2.0 : 1.0);
    }
  }

  const norm = Math.hypot(...vec);
  if (Number.isFinite(norm) && norm > 0) {
    for (let i = 0; i < EMBEDDING_DIMS; i++) vec[i] /= norm;
  }
  return vec;
}

export async function embedText(text: string, taskType: Task): Promise<number[]> {
  const snippet = text.slice(0, 6000);

  const jarvisKey = process.env.JARVISLABS_API_KEY;
  const jarvisEmbedModel = process.env.JARVISLABS_EMBEDDINGS_MODEL;
  if (jarvisKey && jarvisEmbedModel) {
    const baseUrl = (process.env.JARVISLABS_BASE_URL || 'https://models.jarvislabs.net/v1').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jarvisKey}` },
      body: JSON.stringify({ model: jarvisEmbedModel, input: snippet, dimensions: EMBEDDING_DIMS }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
      const normalized = normalizeVector(data.data?.[0]?.embedding);
      if (normalized) return normalized;
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const model = 'models/gemini-embedding-001';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({ model, taskType, outputDimensionality: EMBEDDING_DIMS, content: { parts: [{ text: snippet }] } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const data = (await response.json()) as { embedding?: { values?: unknown } };
      const normalized = normalizeVector(data.embedding?.values);
      if (normalized) return normalized;
    }
  }

  return computeSemanticHashVector768(snippet);
}
