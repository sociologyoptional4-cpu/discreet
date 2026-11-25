import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './admin';
import {
  checkUpstashRateLimit,
  getClientIp,
  MemoryWindowLimiter,
  RATE_LIMIT_QUOTAS,
  type RateLimitAction,
} from './rateLimitCore';

export { getClientIp, type RateLimitAction };

let anonClient: SupabaseClient | null = null;
const memoryLimiter = new MemoryWindowLimiter(20_000);

/** Shared stateless anon Supabase client so GoTrue JWKS cache stays warm across requests. */
export function getAnonSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  anonClient ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return anonClient;
}

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
  const verifier = getAnonSupabaseClient();
  if (!url || !key || !verifier) return json({ error: 'Authentication is unavailable.' }, 503);
  try {
    // Prefer local JWT claims verification via warm shared JWKS cache to avoid Auth network hops.
    const { data: claimsData, error: claimsErr } = await verifier.auth.getClaims(token);
    let userId = typeof claimsData?.claims?.sub === 'string' && claimsData.claims.sub.length > 0
      ? claimsData.claims.sub
      : null;

    if (!userId || claimsErr) {
      const { data, error } = await verifier.auth.getUser(token);
      if (error || !data.user) return json({ error: 'Sign in first.' }, 401);
      userId = data.user.id;
    }

    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    return { userId, token, client };
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

export async function rateLimit(subjectId: string, action: RateLimitAction): Promise<Response | null> {
  const quota = RATE_LIMIT_QUOTAS[action];
  const bucketKey = `${action}:${subjectId}`;

  const upstash = await checkUpstashRateLimit(bucketKey, quota.limit, quota.windowSec);
  if (upstash) {
    return upstash.allowed
      ? null
      : json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': String(upstash.retryAfterSec) });
  }

  const mem = memoryLimiter.check(bucketKey, quota.limit, quota.windowSec * 1000);
  if (!mem.allowed) {
    return json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': String(mem.retryAfterSec) });
  }

  if (quota.dbFallback && isUuid(subjectId)) {
    try {
      const { data, error } = await getSupabaseAdmin().rpc('check_api_rate_limit', { p_user_id: subjectId, p_action: action });
      if (error || typeof data !== 'boolean') throw new Error('Rate limit check unavailable.');
      return data ? null : json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': '60' });
    } catch {
      return json({ error: 'Request throttling is temporarily unavailable.' }, 503);
    }
  }

  return null;
}
