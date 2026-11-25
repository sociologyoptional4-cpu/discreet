export type RateLimitAction =
  | 'upload-url'
  | 'process-post'
  | 'search'
  | 'living-generate'
  | 'brain-signal'
  | 'feed'
  | 'telemetry'
  | 'react'
  | 'xp'
  | 'ai-chat';

export interface RateLimitQuota {
  limit: number;
  windowSec: number;
  dbFallback: boolean;
}

export const RATE_LIMIT_QUOTAS: Record<RateLimitAction, RateLimitQuota> = {
  feed: { limit: 60, windowSec: 60, dbFallback: false },
  'brain-signal': { limit: 60, windowSec: 60, dbFallback: false },
  telemetry: { limit: 60, windowSec: 60, dbFallback: false },
  react: { limit: 90, windowSec: 60, dbFallback: false },
  xp: { limit: 30, windowSec: 60, dbFallback: false },
  search: { limit: 30, windowSec: 60, dbFallback: false },
  'ai-chat': { limit: 20, windowSec: 60, dbFallback: false },
  'upload-url': { limit: 60, windowSec: 60, dbFallback: true },
  'process-post': { limit: 8, windowSec: 60, dbFallback: true },
  'living-generate': { limit: 10, windowSec: 60, dbFallback: true },
};

/** Bounded in-memory fixed-window limiter for isolate-local fast checks and burst shedding. */
export class MemoryWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 20_000) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.buckets.size;
  }

  check(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const existing = this.buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      if (this.buckets.size >= this.maxEntries) {
        for (const [k, v] of this.buckets) {
          if (now >= v.resetAt) this.buckets.delete(k);
        }
        if (this.buckets.size >= this.maxEntries) {
          const evictCount = Math.max(1, Math.floor(this.maxEntries * 0.1));
          let removed = 0;
          for (const k of this.buckets.keys()) {
            this.buckets.delete(k);
            if (++removed >= evictCount) break;
          }
        }
      }
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)) };
    }

    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    if (existing.count >= limit) {
      return { allowed: false, retryAfterSec };
    }

    existing.count++;
    return { allowed: true, retryAfterSec };
  }
}

/** Optional Upstash Redis REST pipeline rate check. Returns null when unconfigured or unreachable. */
export async function checkUpstashRateLimit(
  key: string,
  limit: number,
  windowSec: number,
  env?: { url?: string; token?: string },
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfterSec: number } | null> {
  const url = (env?.url ?? process.env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env?.token ?? process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  if (!url || !token) return null;

  const bucket = Math.floor(now / (windowSec * 1000));
  const redisKey = `vybe:rl:${key}:${bucket}`;

  try {
    const res = await fetchFn(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, windowSec, 'NX'],
      ]),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as Array<{ result?: unknown }>;
    const count = Number(payload?.[0]?.result);
    if (!Number.isFinite(count)) return null;

    const retryAfterSec = Math.max(1, windowSec - (Math.floor(now / 1000) % windowSec));
    return { allowed: count <= limit, retryAfterSec };
  } catch {
    return null;
  }
}

/** Extracts the client IP from proxy headers with safe fallback. */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || 'anonymous';
}
