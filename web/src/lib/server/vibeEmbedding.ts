import 'server-only';
import { computeSemanticHashVector384, formatPgVector, l2Normalize, VIBE_VECTOR_DIM } from '@/lib/brain/tasteVector';
import { getSupabaseAdmin } from '@/lib/server/admin';

/**
 * Takes the first 384 dimensions of a 768-dim Gemini embedding (Matryoshka truncation)
 * and L2-normalizes the resulting vector for `vibe_embedding`.
 */
export function sliceAndNormalize384(vec768: readonly number[]): Float32Array {
  const sliced = new Float32Array(VIBE_VECTOR_DIM);
  const len = Math.min(vec768.length, VIBE_VECTOR_DIM);
  for (let i = 0; i < len; i++) {
    const v = vec768[i];
    sliced[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return l2Normalize(sliced);
}

/**
 * Generates a normalized 384-dimensional vibe embedding for semantic clustering.
 * Uses Gemini Embedding (`outputDimensionality: 384`) with a deterministic local semantic-hash fallback.
 */
export async function generateVibeEmbedding384(text: string): Promise<Float32Array> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 6000);
  if (!clean) return computeSemanticHashVector384('');

  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const model = 'models/gemini-embedding-001';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:embedContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model,
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: VIBE_VECTOR_DIM,
          content: { parts: [{ text: clean }] },
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) {
        const data = (await response.json()) as { embedding?: { values?: unknown } };
        const values = data.embedding?.values;
        if (
          Array.isArray(values) &&
          values.length === VIBE_VECTOR_DIM &&
          values.every((v) => typeof v === 'number' && Number.isFinite(v))
        ) {
          return l2Normalize(Float32Array.from(values));
        }
      }
    } catch {
      // Fall through cleanly to local 384-d semantic hash vector
    }
  }

  return computeSemanticHashVector384(clean);
}

/**
 * Builds an embedding text document from a post row and persists `vibe_embedding` in Postgres.
 */
export async function embedPostById(postId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('posts')
    .select('id, topic_entity, category, emotion_tag, ai_summary, key_points, transcript, post_format, recipe_data')
    .eq('id', postId)
    .maybeSingle();

  if (error || !data) return false;

  const recipe = (data.recipe_data && typeof data.recipe_data === 'object' ? data.recipe_data : {}) as Record<
    string,
    unknown
  >;
  const overlayLines =
    recipe.textOverlay && typeof recipe.textOverlay === 'object'
      ? (recipe.textOverlay as { lines?: unknown }).lines
      : undefined;

  const parts: string[] = [
    typeof data.topic_entity === 'string' ? data.topic_entity : '',
    typeof data.category === 'string' ? data.category : '',
    typeof data.emotion_tag === 'string' ? data.emotion_tag : '',
    typeof data.post_format === 'string' ? data.post_format : '',
    typeof data.ai_summary === 'string' ? data.ai_summary : '',
    Array.isArray(data.key_points) ? data.key_points.join(' ') : '',
    typeof data.transcript === 'string' ? data.transcript : '',
    typeof recipe.prompt === 'string' ? recipe.prompt : '',
    Array.isArray(overlayLines) ? overlayLines.join(' ') : '',
  ].filter(Boolean);

  const vec = await generateVibeEmbedding384(parts.join('\n') || 'vybe post');
  const { error: updateErr } = await admin
    .from('posts')
    .update({ vibe_embedding: formatPgVector(vec) })
    .eq('id', postId);

  return !updateErr;
}
