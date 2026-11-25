import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NonRetryableError, UploadQueue, createMemoryStorage, type UploadPipeline, type UploadDraft } from '../src/lib/media/optimisticUpload.ts';

type Meta = { topic: string };
const blob = (text: string) => new Blob([text]);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(overrides: Partial<UploadPipeline<Meta>> = {}) {
  const log: string[] = [];
  const pipeline: UploadPipeline<Meta> = {
    process: async (video, _meta, ctx) => { log.push('process'); ctx.onProgress(50); ctx.onProgress(100); return { video: blob(`small-${video.size}`), thumbnail: blob('thumb') }; },
    publish: async (job, ctx) => { log.push(`publish:${job.id}`); ctx.onProgress(1); },
    ...overrides,
  };
  const storage = createMemoryStorage<Meta>();
  let n = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  const queue = new UploadQueue<Meta>(pipeline, storage, {
    sleep: async () => undefined, settleMs: 0, randomId: () => `job-${++n}`,
    urls: { create: () => { const u = `blob:${created.length}`; created.push(u); return u; }, revoke: (u) => void revoked.push(u) },
  });
  return { queue, storage, log, created, revoked };
}

test('shows the clip at once from a local URL, then processes and publishes it', async () => {
  const { queue, log, storage } = harness();
  const seen: UploadDraft[][] = [];
  queue.subscribe((d) => seen.push(d));
  const id = await queue.enqueue(blob('raw'), { topic: 'x' }, 'hello');
  assert.equal(queue.getAll()[0].localVideoUrl, 'blob:0');
  assert.equal((await storage.list()).length, 1);
  await tick(10);
  assert.deepEqual(log, ['process', `publish:${id}`]);
  assert.ok(seen.some((d) => d[0]?.status === 'processing'));
  assert.ok(seen.some((d) => d[0]?.status === 'uploading'));
  assert.ok(seen.some((d) => d[0]?.status === 'published' && d[0].progress === 100));
  assert.equal((await storage.list()).length, 0);
});

test('the finished draft disappears and its local URLs are released', async () => {
  const { queue, revoked, created } = harness();
  await queue.enqueue(blob('raw'), { topic: 'x' }, 'hi');
  await tick(20);
  assert.equal(queue.getAll().length, 0);
  assert.equal(revoked.length, created.length);
});

test('a failed upload is retried, and processing is not repeated', async () => {
  let attempts = 0;
  const { queue, log } = harness({ publish: async () => { attempts += 1; if (attempts < 3) throw new Error('network'); } });
  await queue.enqueue(blob('raw'), { topic: 'x' }, '');
  await tick(20);
  assert.equal(attempts, 3);
  assert.equal(log.filter((l) => l === 'process').length, 1);
});

test('gives up after maxAttempts and can be retried by hand', async () => {
  let fail = true;
  const { queue } = harness({ publish: async () => { if (fail) throw new Error('offline'); } });
  const id = await queue.enqueue(blob('raw'), { topic: 'x' }, '');
  await tick(20);
  assert.equal(queue.getAll()[0].status, 'failed');
  assert.equal(queue.getAll()[0].attempts, 5);
  fail = false;
  queue.retry(id);
  await tick(20);
  assert.equal(queue.getAll().length, 0);
});

test('a non-retryable error fails immediately without retrying', async () => {
  let calls = 0;
  const { queue } = harness({ publish: async () => { calls += 1; throw new NonRetryableError('Free accounts keep up to 5 permanent posts.'); } });
  await queue.enqueue(blob('raw'), { topic: 'x' }, '');
  await tick(20);
  assert.equal(calls, 1);
  assert.equal(queue.getAll()[0].status, 'failed');
  assert.match(queue.getAll()[0].error ?? '', /permanent posts/);
});

test('after a crash, resume() continues from the saved stage: processed jobs skip processing', async () => {
  const first = harness({ publish: async () => { throw new Error('tab closed'); } });
  first.queue.enqueue(blob('raw'), { topic: 'x' }, 'cap');
  await tick(20);
  const saved = await first.storage.list();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].stage, 'processed');

  const second = harness();
  await second.storage.put(saved[0]);
  await second.queue.resume();
  await tick(20);
  assert.deepEqual(second.log, [`publish:${saved[0].id}`]);
  assert.equal((await second.storage.list()).length, 0);
});

test('resume() does not start a job that is already running', async () => {
  const { queue, log } = harness();
  await queue.enqueue(blob('raw'), { topic: 'x' }, '');
  await queue.resume();
  await tick(20);
  assert.equal(log.filter((l) => l === 'process').length, 1);
});

test('cancel() aborts the job and removes its saved copy', async () => {
  let aborted = false;
  const { queue, storage } = harness({ process: (_v, _m, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('x', 'AbortError')); })) });
  const id = await queue.enqueue(blob('raw'), { topic: 'x' }, '');
  await tick(5);
  await queue.cancel(id);
  await tick(5);
  assert.equal(aborted, true);
  assert.equal(queue.getAll().length, 0);
  assert.equal((await storage.list()).length, 0);
});

test('jobs run one at a time, in order', async () => {
  const order: string[] = [];
  const { queue } = harness({ publish: async (job) => { order.push(`start:${job.id}`); await tick(5); order.push(`end:${job.id}`); } });
  await queue.enqueue(blob('a'), { topic: 'x' }, '');
  await queue.enqueue(blob('b'), { topic: 'y' }, '');
  await tick(50);
  assert.deepEqual(order, ['start:job-1', 'end:job-1', 'start:job-2', 'end:job-2']);
});
