import 'server-only';

type Task = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

export async function embedText(text: string, taskType: Task): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Embedding service unavailable.');
  const model = 'models/gemini-embedding-001';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:embedContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ model, taskType, outputDimensionality: 768, content: { parts: [{ text: text.slice(0, 6000) }] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Embedding service returned ${response.status}.`);
  const data = await response.json() as { embedding?: { values?: unknown } };
  const vector = data.embedding?.values;
  if (!Array.isArray(vector) || vector.length !== 768 || !vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('Invalid embedding returned.');
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding norm.');
  return vector.map((v: number) => v / norm);
}
