import {
  computeSignalDeltas,
  pickStickyGenome,
  type SwipeTelemetry,
} from '@/lib/brain/recursiveBrain';
import {
  formatPgVector,
  parsePgVector,
  updateTasteVector,
} from '@/lib/brain/tasteVector';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { getActiveGenomes } from '@/lib/server/brainGenomes';
import { authenticate, isUuid, json, rateLimit } from '@/lib/server/request';

interface RawSignal extends Partial<SwipeTelemetry> {
  postId?: unknown;
}

function cleanSignal(raw: unknown): (SwipeTelemetry & { postId: string }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawSignal;
  if (!isUuid(r.postId)) return null;
  const watchRatio =
    typeof r.watchRatio === 'number' && Number.isFinite(r.watchRatio)
      ? Math.min(10, Math.max(0, r.watchRatio))
      : 0;
  return {
    postId: r.postId,
    watchRatio,
    rewatched: Boolean(r.rewatched),
    shared: Boolean(r.shared),
    liked: Boolean(r.liked),
    fastSkip: Boolean(r.fastSkip),
  };
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && new URL(request.url).origin !== origin) {
    return new Response(null, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid brain signal payload.' }, 400);
  }

  // sendBeacon cannot send custom Authorization headers, so allow body token on same-origin POSTs.
  const authRequest =
    !request.headers.has('Authorization') && typeof body.token === 'string'
      ? new Request(request.url, { headers: { Authorization: `Bearer ${body.token}` } })
      : request;

  const auth = await authenticate(authRequest);
  if (auth instanceof Response) return auth;

  const limited = await rateLimit(auth.userId, 'brain-signal');
  if (limited) return limited;

  const rawList = Array.isArray(body.signals) ? body.signals : [body];
  if (rawList.length === 0 || rawList.length > 50) {
    return json({ error: 'Signal batch must contain 1..50 items.' }, 400);
  }

  const signals = rawList.map(cleanSignal).filter((s): s is SwipeTelemetry & { postId: string } => s !== null);
  if (signals.length === 0) {
    return json({ error: 'No valid signals provided.' }, 400);
  }

  const genomes = await getActiveGenomes();
  const requestedGenomeId = isUuid(body.genomeId) ? body.genomeId : null;
  const chosenGenome =
    (requestedGenomeId ? genomes.find((g) => g.id === requestedGenomeId) : undefined) ??
    pickStickyGenome(genomes, `${auth.userId}:${new Date().toISOString().slice(0, 10)}`);

  const admin = getSupabaseAdmin();
  const postIds = [...new Set(signals.map((s) => s.postId))];

  const [postsRes, tasteRes] = await Promise.all([
    admin.from('posts').select('id, vibe_embedding').in('id', postIds),
    admin
      .from('user_taste_vectors')
      .select('taste_embedding')
      .eq('user_id', auth.userId)
      .maybeSingle(),
  ]);

  const postVecs = new Map<string, Float32Array>();
  for (const row of (postsRes.data ?? []) as Array<{ id: string; vibe_embedding: unknown }>) {
    const parsed = parsePgVector(row.vibe_embedding);
    if (parsed) postVecs.set(row.id, parsed);
  }

  let currentTaste = parsePgVector(tasteRes.data?.taste_embedding);
  let tasteChanged = false;

  const rpcSignals = signals.map((sig) => {
    const deltas = computeSignalDeltas(sig);
    const postVec = postVecs.get(sig.postId);
    if (postVec) {
      const updated = updateTasteVector(currentTaste, postVec, deltas.reward);
      if (updated) {
        currentTaste = updated;
        tasteChanged = true;
      }
    }
    return {
      post_id: sig.postId,
      alpha_delta: deltas.alphaDelta,
      beta_delta: deltas.betaDelta,
      pheromone_delta: deltas.pheromoneDelta,
      reward: deltas.reward,
    };
  });

  const { error } = await admin.rpc('ingest_brain_signals', {
    p_user_id: auth.userId,
    p_genome_id: chosenGenome.id,
    p_signals: rpcSignals,
    p_new_taste: tasteChanged && currentTaste ? formatPgVector(currentTaste) : null,
    p_signal_count: signals.length,
  });

  if (error) {
    return json({ error: 'Could not ingest brain signals.' }, 503);
  }

  return new Response(null, { status: 204 });
}
