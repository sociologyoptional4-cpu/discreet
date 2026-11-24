import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleShare } from '../src/lib/share.ts';

const data = { title: 'A review', url: 'https://vybe.example/feed?postId=1' };

test('uses the share sheet when it exists', async () => {
  let shared: unknown;
  assert.equal(await handleShare(data, { share: async (d) => { shared = d; } }), 'shared');
  assert.deepEqual(shared, data);
});

test('closing the share sheet is cancelled, not a failure or a copy', async () => {
  let copied = false;
  const result = await handleShare(data, {
    share: async () => { throw new DOMException('closed', 'AbortError'); },
    clipboard: { writeText: async () => { copied = true; } },
  });
  assert.equal(result, 'cancelled');
  assert.equal(copied, false);
});

test('copies the link when there is no share sheet, or sharing breaks', async () => {
  let copied = '';
  const clipboard = { writeText: async (t: string) => { copied = t; } };
  assert.equal(await handleShare(data, { clipboard }), 'copied');
  assert.equal(copied, data.url);
  copied = '';
  assert.equal(await handleShare(data, { share: async () => { throw new Error('boom'); }, clipboard }), 'copied');
  assert.equal(copied, data.url);
});

test('fails cleanly when nothing is available or the copy is refused', async () => {
  assert.equal(await handleShare(data, {}), 'failed');
  assert.equal(await handleShare(data, undefined), 'failed');
  assert.equal(await handleShare(data, { clipboard: { writeText: async () => { throw new Error('denied'); } } }), 'failed');
});
