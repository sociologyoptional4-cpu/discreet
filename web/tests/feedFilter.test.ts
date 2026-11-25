import test from 'node:test';
import assert from 'node:assert/strict';
import { feedPlayable, isFeedPlayable } from '../src/lib/feed/feedFilter.ts';

test('living posts are excluded from the feed', () => {
  assert.equal(isFeedPlayable({ post_format: 'living_post' }), false);
  assert.equal(isFeedPlayable({ post_format: 'video' }), true);
  assert.equal(isFeedPlayable({}), true);
  assert.deepEqual(feedPlayable([{ post_format: 'living_post' }, { post_format: 'video' }]), [{ post_format: 'video' }]);
});
