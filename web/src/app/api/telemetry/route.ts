import { authenticate, isUuid } from '@/lib/server/request';
import { EVENT_NAMES, type PostEvent } from '@/types/feed';

function valid(event: PostEvent) {
  return event && isUuid(event.id) && isUuid(event.post_id) && EVENT_NAMES.includes(event.event_type)
    && Number.isFinite(event.value) && event.value >= 0 && event.value <= 86_400_000;
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(request.url).origin !== origin) return new Response(null, { status: 403 });
  const data = await request.json().catch(() => null);
  if (!data || !Array.isArray(data.events) || !data.events.length || data.events.length > 100 || !data.events.every(valid)) {
    return Response.json({ error: 'Invalid telemetry batch.' }, { status: 400 });
  }
  // sendBeacon has no Authorization header option. The session token is transmitted only in the POST body.
  const authenticatedRequest = !request.headers.has('Authorization') && typeof data.token === 'string'
    ? new Request(request.url, { headers: { Authorization: 'Bearer ' + data.token } }) : request;
  const auth = await authenticate(authenticatedRequest);
  if (auth instanceof Response) return auth;
  const result = await auth.client.rpc('ingest_post_events', { p_events: data.events });
  return new Response(null, { status: result.error ? 503 : 204 });
}
