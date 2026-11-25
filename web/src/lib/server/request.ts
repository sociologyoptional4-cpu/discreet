import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './admin';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

export async function authenticate(request: Request): Promise<{userId: string; token: string; client: SupabaseClient} | Response> {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return json({ error: 'Sign in first.' }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return json({ error: 'Authentication is unavailable.' }, 503);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    // Prefer local JWT claims verification (cached JWKS) to avoid a ~250ms Auth network hop per API call.
    const { data: claimsData, error: claimsErr } = await client.auth.getClaims(token);
    const sub = claimsData?.claims?.sub;
    if (!claimsErr && typeof sub === 'string' && sub.length > 0) {
      return { userId: sub, token, client };
    }
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Sign in first.' }, 401);
    return { userId: data.user.id, token, client };
  } catch {
    return json({ error: 'Authentication is unavailable.' }, 503);
  }
}

/** The signed-in viewer if the request carries a valid token; null for visitors without one. */
export async function optionalViewer(request: Request): Promise<string | null> {
  if (!request.headers.get('authorization')) return null;
  const auth = await authenticate(request);
  return auth instanceof Response ? null : auth.userId;
}

export async function rateLimit(userId: string, action: 'upload-url' | 'process-post' | 'search' | 'living-generate' | 'brain-signal'): Promise<Response | null> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('check_api_rate_limit', { p_user_id: userId, p_action: action });
    if (error || typeof data !== 'boolean') throw new Error('Rate limit check unavailable.');
    return data ? null : json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': '60' });
  } catch {
    return json({ error: 'Request throttling is temporarily unavailable.' }, 503);
  }
}
