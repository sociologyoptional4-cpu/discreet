import { getAnonSupabaseClient } from '@/lib/server/request';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!query || query.length > 160) return Response.json({ suggestions: [] });
  const db = getAnonSupabaseClient();
  if (!db) return Response.json({ error: 'Search unavailable.' }, { status: 503 });
  const result = await db.rpc('suggest_topics', { p_query: query, p_limit: 8 });
  if (result.error) return Response.json({ error: 'Suggestions unavailable.' }, { status: 503 });
  return Response.json({ suggestions: (result.data as { topic_entity: string }[]).map(row => row.topic_entity) },
    { headers: { 'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=60' } });
}
