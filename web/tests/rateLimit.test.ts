import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkUpstashRateLimit,
  getClientIp,
  MemoryWindowLimiter,
} from '../src/lib/server/rateLimitCore.ts';

test('MemoryWindowLimiter allows up to quota, blocks at limit+1, and resets after window', () => {
  const limiter = new MemoryWindowLimiter(100);
  const t0 = 1_000_000;

  assert.deepEqual(limiter.check('feed:u1', 3, 60_000, t0), { allowed: true, retryAfterSec: 60 });
  assert.deepEqual(limiter.check('feed:u1', 3, 60_000, t0 + 10_000), { allowed: true, retryAfterSec: 50 });
  assert.deepEqual(limiter.check('feed:u1', 3, 60_000, t0 + 20_000), { allowed: true, retryAfterSec: 40 });

  const blocked = limiter.check('feed:u1', 3, 60_000, t0 + 25_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 35);

  const afterReset = limiter.check('feed:u1', 3, 60_000, t0 + 60_000);
  assert.deepEqual(afterReset, { allowed: true, retryAfterSec: 60 });
});

test('MemoryWindowLimiter bounds map size at maxEntries under flood', () => {
  const limiter = new MemoryWindowLimiter(20);
  const now = 5_000_000;

  for (let i = 0; i < 45; i++) {
    limiter.check(`feed:user_${i}`, 5, 60_000, now + i);
  }

  assert.ok(limiter.size <= 20, `expected bounded size <= 20, got ${limiter.size}`);
});

test('checkUpstashRateLimit returns null when env vars are missing', async () => {
  const result = await checkUpstashRateLimit('feed:u1', 60, 60, { url: '', token: '' });
  assert.equal(result, null);
});

test('checkUpstashRateLimit sends INCR+EXPIRE NX pipeline and honors quota', async () => {
  let capturedUrl = '';
  let capturedAuth = '';
  let capturedBody = '';

  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify([{ result: 3 }, { result: 1 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const allowed = await checkUpstashRateLimit(
    'feed:u1',
    3,
    60,
    { url: 'https://redis.example.com/', token: 'tok_secret' },
    mockFetch,
    120_000,
  );
  assert.equal(capturedUrl, 'https://redis.example.com/pipeline');
  assert.equal(capturedAuth, 'Bearer tok_secret');
  assert.deepEqual(JSON.parse(capturedBody), [
    ['INCR', 'vybe:rl:feed:u1:2'],
    ['EXPIRE', 'vybe:rl:feed:u1:2', 60, 'NX'],
  ]);
  assert.deepEqual(allowed, { allowed: true, retryAfterSec: 60 });

  const overLimitFetch = (async () =>
    new Response(JSON.stringify([{ result: 4 }, { result: 0 }]), { status: 200 })) as typeof fetch;
  const blocked = await checkUpstashRateLimit(
    'feed:u1',
    3,
    60,
    { url: 'https://redis.example.com', token: 'tok_secret' },
    overLimitFetch,
    135_000,
  );
  assert.deepEqual(blocked, { allowed: false, retryAfterSec: 45 });
});

test('checkUpstashRateLimit fails open (returns null) on network or HTTP error', async () => {
  const errFetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
  const httpFail = await checkUpstashRateLimit(
    'feed:u1',
    10,
    60,
    { url: 'https://redis.example.com', token: 'tok_secret' },
    errFetch,
  );
  assert.equal(httpFail, null);

  const throwFetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const netFail = await checkUpstashRateLimit(
    'feed:u1',
    10,
    60,
    { url: 'https://redis.example.com', token: 'tok_secret' },
    throwFetch,
  );
  assert.equal(netFail, null);
});

test('getClientIp extracts first x-forwarded-for, falls back to x-real-ip and anonymous', () => {
  const req1 = new Request('https://vybe.app/api/ai-chat', {
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'x-real-ip': '198.51.100.2' },
  });
  assert.equal(getClientIp(req1), '203.0.113.5');

  const req2 = new Request('https://vybe.app/api/ai-chat', {
    headers: { 'x-real-ip': '198.51.100.2' },
  });
  assert.equal(getClientIp(req2), '198.51.100.2');

  const req3 = new Request('https://vybe.app/api/ai-chat');
  assert.equal(getClientIp(req3), 'anonymous');
});
