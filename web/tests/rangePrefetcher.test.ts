import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ByteRangePrefetcher, type NetworkInformationLike, type PrefetchConfig } from '../src/lib/media/rangePrefetcher.ts';

const FAST: NetworkInformationLike = { effectiveType: '4g' };
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { url: string; range: string; signal: AbortSignal; finish: (status?: number, fullSize?: number) => void };

/** A fetch whose responses are completed by hand, so tests control timing, and which honours AbortSignal. */
function fakeFetch() {
  const calls: Call[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input);
      const range = (init?.headers as Record<string, string>).Range;
      const signal = init!.signal as AbortSignal;
      const end = Number(/bytes=0-(\d+)/.exec(range)![1]);
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      calls.push({
        url, range, signal,
        finish: (status = 206, full = 10_000_000) => {
          const body = new Uint8Array(status === 206 ? end + 1 : Math.min(full, 4096));
          // Like a real cross-origin response: Content-Length is visible, Content-Range is not (R2 does not expose it).
          resolve(new Response(body, { status, headers: { 'content-length': String(status === 206 ? end + 1 : full) } }));
        },
      });
    })) as typeof fetch;
  return { calls, impl };
}

function make(config: PrefetchConfig = {}, network: NetworkInformationLike | undefined = FAST) {
  const f = fakeFetch();
  const prefetcher = new ByteRangePrefetcher({ fetchImpl: f.impl, getNetwork: () => network, ...config });
  return { f, prefetcher };
}

test('asks for the first 512 KB on a fast connection and remembers the URL as warm', async () => {
  const { f, prefetcher } = make();
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  assert.equal(f.calls[0].range, 'bytes=0-524287');
  f.calls[0].finish();
  await tick(5);
  assert.equal(prefetcher.isPrefetched('https://cdn/a.mp4'), true);
  assert.equal(prefetcher.getStats().totalBytesFetched, 524288);
});

test('uses 256 KB on 3G and nothing on 2G or Data Saver', async () => {
  const slow = make({}, { effectiveType: '3g' });
  slow.prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  assert.equal(slow.f.calls[0].range, 'bytes=0-262143');

  for (const network of [{ effectiveType: '2g' }, { effectiveType: '4g', saveData: true }]) {
    const none = make({}, network);
    none.prefetcher.prefetchWindow(['https://cdn/a.mp4']);
    assert.equal(none.f.calls.length, 0);
  }
});

test('aborts a request when its URL leaves the window, without counting it as a failure', async () => {
  const { f, prefetcher } = make();
  prefetcher.prefetchWindow(['https://cdn/a.mp4', 'https://cdn/b.mp4']);
  prefetcher.prefetchWindow(['https://cdn/b.mp4', 'https://cdn/c.mp4']);
  await tick(5);
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.calls[1].signal.aborted, false);
  const stats = prefetcher.getStats();
  assert.equal(stats.abortedCount, 1);
  assert.equal(stats.failedCount, 0);
});

test('an aborted URL that comes back is not removed from flight by the old request finishing', async () => {
  const { f, prefetcher } = make();
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  prefetcher.prefetchWindow([]);
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  await tick(5);
  assert.equal(f.calls.length, 2);
  assert.equal(prefetcher.getStats().inFlightCount, 1);
});

test('never runs more than maxConcurrent fetches and continues down the queue', async () => {
  const { f, prefetcher } = make({ maxConcurrent: 2 });
  prefetcher.prefetchWindow(['https://cdn/1.mp4', 'https://cdn/2.mp4', 'https://cdn/3.mp4']);
  assert.equal(f.calls.length, 2);
  f.calls[0].finish();
  await tick(5);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].url, 'https://cdn/3.mp4');
});

test('a server that ignores Range (200) is cancelled early and not asked again', async () => {
  const { f, prefetcher } = make();
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  f.calls[0].finish(200);
  await tick(5);
  assert.equal(prefetcher.isPrefetched('https://cdn/a.mp4'), false);
  prefetcher.prefetchWindow(['https://cdn/other.mp4']);
  assert.equal(f.calls.length, 1);
  assert.equal(prefetcher.getStats().failedCount, 1);
});

test('a failed URL is left alone during its cooldown', async () => {
  let time = 0;
  const { f, prefetcher } = make({ failureCooldownMs: 1000, now: () => time });
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  f.calls[0].finish(500);
  await tick(5);
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  assert.equal(f.calls.length, 1);
  time = 1500;
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  assert.equal(f.calls.length, 2);
});

test('only URLs accepted by allowUrl are fetched', () => {
  const { f, prefetcher } = make({ allowUrl: (url) => url.startsWith('https://cdn/') });
  prefetcher.prefetchWindow(['https://other/a.mp4', 'https://cdn/b.mp4']);
  assert.deepEqual(f.calls.map((c) => c.url), ['https://cdn/b.mp4']);
});

test('the pause gate holds fetches until it opens, and cannot hold them past maxPauseMs', async () => {
  let paused = true;
  const open = make({ gatePollMs: 5, maxPauseMs: 1000 });
  open.prefetcher.setPauseGate(() => paused);
  open.prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  await tick(20);
  assert.equal(open.f.calls.length, 0);
  paused = false;
  await tick(20);
  assert.equal(open.f.calls.length, 1);

  const stuck = make({ gatePollMs: 5, maxPauseMs: 30 });
  stuck.prefetcher.setPauseGate(() => true);
  stuck.prefetcher.prefetchWindow(['https://cdn/b.mp4']);
  await tick(80);
  assert.equal(stuck.f.calls.length, 1);
});

test('forgets the oldest warm URL beyond maxCacheEntries', async () => {
  const { f, prefetcher } = make({ maxCacheEntries: 10, maxConcurrent: 1 });
  for (let i = 0; i < 11; i++) {
    prefetcher.prefetchWindow([`https://cdn/${i}.mp4`]);
    f.calls[i].finish();
    await tick(2);
  }
  assert.equal(prefetcher.isPrefetched('https://cdn/0.mp4'), false);
  assert.equal(prefetcher.isPrefetched('https://cdn/10.mp4'), true);
});

test('a 206 without a readable Content-Range still counts, because cross-origin hosts rarely expose it', async () => {
  const { f, prefetcher } = make();
  prefetcher.prefetchWindow(['https://cdn/a.mp4']);
  f.calls[0].finish(206);
  await tick(5);
  assert.equal(prefetcher.isPrefetched('https://cdn/a.mp4'), true);
  assert.equal(prefetcher.getStats().failedCount, 0);
});

test('a small file answered with a full 200 is a success, not a "no range support" host', async () => {
  const { f, prefetcher } = make();
  prefetcher.prefetchWindow(['https://cdn/tiny.mp4']);
  f.calls[0].finish(200, 4096);
  await tick(5);
  assert.equal(prefetcher.isPrefetched('https://cdn/tiny.mp4'), true);
  prefetcher.prefetchWindow(['https://cdn/next.mp4']);
  assert.equal(f.calls.length, 2);
});
