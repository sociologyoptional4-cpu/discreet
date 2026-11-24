import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMessageUpdate, mergeMessages, setDeliveryStatus, type ChatMessage, type MessageRow } from '../src/lib/chatMessages.ts';
import { groupStories, type StoryRow } from '../src/lib/storyGroups.ts';

const row = (id: string, created_at: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id, conversation_id: 'c', sender_id: 'a', type: 'text', content: id, snap_mode: null, avatar_id: null, media_url: null,
  motion_url: null, story_id: null, viewed_at: null, expires_at: null, created_at, ...extra,
});
const local = (id: string, created_at: string, status: ChatMessage['status']): ChatMessage => ({ ...row(id, created_at), status });

test('merge sorts oldest first and dedupes by id', () => {
  const merged = mergeMessages([], [row('b', '2026-01-01T00:00:02Z'), row('a', '2026-01-01T00:00:01Z'), row('b', '2026-01-01T00:00:02Z')]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b']);
  assert.ok(merged.every((m) => m.status === 'sent'));
});

test('the server row replaces the optimistic copy and takes its timestamp', () => {
  const merged = mergeMessages([local('m1', '2026-01-01T00:00:09Z', 'sending')], [row('m1', '2026-01-01T00:00:05Z')]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'sent');
  assert.equal(merged[0].created_at, '2026-01-01T00:00:05Z');
});

test('unsent local messages survive a refetch', () => {
  const merged = mergeMessages([local('f', '2026-01-01T00:00:03Z', 'failed'), local('s', '2026-01-01T00:00:04Z', 'sending')], [row('a', '2026-01-01T00:00:01Z')]);
  assert.deepEqual(merged.map((m) => `${m.id}:${m.status}`), ['a:sent', 'f:failed', 's:sending']);
});

test('updates change known messages only and keep their delivery status', () => {
  const list = [local('m1', '2026-01-01T00:00:01Z', 'sent')];
  const opened = applyMessageUpdate(list, row('m1', '2026-01-01T00:00:01Z', { viewed_at: '2026-01-01T00:01:00Z' }));
  assert.equal(opened[0].viewed_at, '2026-01-01T00:01:00Z');
  assert.equal(applyMessageUpdate(list, row('ghost', '2026-01-01T00:00:01Z')).length, 1);
  assert.equal(setDeliveryStatus(list, 'm1', 'failed')[0].status, 'failed');
});

const story = (id: string, user: string, created_at: string, expires_at: string, creator = { username: user, avatar_id: 'neon_bot' }): StoryRow => ({
  id, user_id: user, mode: 'blur', avatar_id: null, media_url: `https://x/${id}`, motion_url: null, created_at, expires_at, creator,
});

test('stories group by creator, newest creator first, oldest story first, expired dropped', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const groups = groupStories([
    story('1', 'ann', '2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z'),
    story('2', 'bob', '2026-01-01T12:00:00Z', '2026-01-02T12:00:00Z'),
    story('3', 'ann', '2026-01-01T14:00:00Z', '2026-01-02T14:00:00Z'),
    story('4', 'cat', '2025-12-30T00:00:00Z', '2025-12-31T00:00:00Z'),
  ], now);
  assert.deepEqual(groups.map((g) => g.username), ['ann', 'bob']);
  assert.deepEqual(groups[0].stories.map((s) => s.id), ['1', '3']);
  assert.equal(groups[0].avatarId, 'neon_bot');
});

test('a creator embedded as a one-item array still works', () => {
  const groups = groupStories([{ ...story('1', 'ann', '2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z'), creator: [{ username: 'ann', avatar_id: 'cozy_bear' }] }], Date.parse('2026-01-01T11:00:00Z'));
  assert.equal(groups[0].avatarId, 'cozy_bear');
});

import { splitConversations, toConversationItem, type ConversationRow } from '../src/lib/conversations.ts';

const convo = (id: string, extra: Partial<ConversationRow> = {}): ConversationRow => ({
  id, user_a: 'me', user_b: 'bob', status: 'accepted', initiator_id: 'me', request_note: null, last_message_at: '2026-01-01T00:00:00Z',
  a: { id: 'me', username: 'me_user', avatar_id: 'neon_bot' }, b: { id: 'bob', username: 'bob', avatar_id: 'cozy_bear' }, ...extra,
});

test('the other person is whichever side the viewer is not', () => {
  assert.equal(toConversationItem(convo('1'), 'me')?.other.username, 'bob');
  assert.equal(toConversationItem(convo('1'), 'bob')?.other.username, 'me_user');
  assert.equal(toConversationItem(convo('1'), 'stranger'), null);
  assert.equal(toConversationItem(convo('1', { b: [{ id: 'bob', username: 'bob', avatar_id: 'cozy_bear' }] }), 'me')?.other.avatarId, 'cozy_bear');
});

test('incoming means pending and sent by someone else; lists are sorted newest first', () => {
  const rows = [
    convo('old', { last_message_at: '2026-01-01T00:00:00Z' }),
    convo('new', { last_message_at: '2026-01-03T00:00:00Z' }),
    convo('req', { status: 'pending', initiator_id: 'bob', last_message_at: '2026-01-02T00:00:00Z', request_note: 'love your reviews' }),
    convo('mine', { status: 'pending', initiator_id: 'me' }),
  ].map((r) => toConversationItem(r, 'me')!);
  const { incoming, accepted } = splitConversations(rows);
  assert.deepEqual(incoming.map((c) => c.id), ['req']);
  assert.equal(incoming[0].requestNote, 'love your reviews');
  assert.deepEqual(accepted.map((c) => c.id), ['new', 'old']);
});
