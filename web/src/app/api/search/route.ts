import { embedText } from '@/lib/server/embedding';
import { authenticate, rateLimit } from '@/lib/server/request';

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim() ?? '';
  const sentiment = params.get('sentiment'), emotion = params.get('emotion');
  if (!query || query.length > 160 || (sentiment && !['positive', 'negative', 'neutral'].includes(sentiment))
    || (emotion && !['joy', 'angry', 'surprised', 'sad', 'chill'].includes(emotion))) {
    return Response.json({ error: 'Invalid search.' }, { status: 400 });
  }
  const limited = await rateLimit(auth.userId, 'search');
  const embedding = limited ? null : await embedText(query, 'RETRIEVAL_QUERY').catch(() => null);
  const [result] = await Promise.all([
    auth.client.rpc('search_hybrid', { p_query: query, p_embedding: embedding, p_sentiment: sentiment, p_emotion: emotion, p_limit: 100 }),
    auth.client.rpc('log_search_query', { p_query: query }),
  ]);
  return result.error ? Response.json({ error: 'Search unavailable.' }, { status: 503 })
    : Response.json({ posts: result.data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
