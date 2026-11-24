import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, questFor, streakTier, weekKey } from '../src/lib/chat/gamification.ts';
import { encodeReply, isSingleEmoji, parseReply } from '../src/lib/chat/messageFormat.ts';
import { encodeSticker, parseActionEvent, parseSticker, stickerUrl } from '../src/lib/chat/stickerRegistry.ts';

test('streak tiers change at 1, 7, 30 and 100 days', () => {
  assert.deepEqual([0, 1, 6, 7, 29, 30, 99, 100].map(streakTier), ['none', 'spark', 'spark', 'flame', 'flame', 'prism', 'prism', 'crown']);
});

test('levels and progress follow the XP thresholds', () => {
  assert.equal(levelFor(0).name, 'New Vibe');
  assert.equal(levelFor(59).level, 1);
  assert.equal(levelFor(60).name, 'Mutuals');
  assert.equal(levelFor(155).progress, 0.5);
  assert.deepEqual([levelFor(5000).level, levelFor(5000).next, levelFor(5000).progress], [4, null, 1]);
  assert.equal(levelFor(-10).level, 1);
});

test('the shield week starts on Monday and the quest is stable for a day', () => {
  assert.equal(weekKey(new Date(2026, 10, 29)), '2026-11-23'); // Sunday
  assert.equal(weekKey(new Date(2026, 10, 23)), '2026-11-23'); // Monday
  assert.deepEqual(questFor('2026-11-25'), questFor('2026-11-25'));
});

test('replies round-trip and long quotes are cut', () => {
  const content = encodeReply('see   you\nat 5', 'ok!');
  assert.deepEqual(parseReply(content), { quote: 'see you at 5', body: 'ok!' });
  assert.deepEqual(parseReply('plain'), { quote: null, body: 'plain' });
  assert.equal(parseReply(encodeReply('x'.repeat(200), 'y')).quote?.length, 80);
});

test('single emoji detection', () => {
  assert.equal(isSingleEmoji('🔥'), true);
  assert.equal(isSingleEmoji(' 👋🏽 '), true);
  assert.equal(isSingleEmoji('❤️'), true);
  assert.equal(isSingleEmoji('🔥🔥'), false);
  assert.equal(isSingleEmoji('hi'), false);
  assert.equal(isSingleEmoji('1'), false);
});

test('stickers parse only known ids and avatars', () => {
  assert.deepEqual(parseSticker(encodeSticker('wave', 'cozy_bear')), { stickerId: 'wave', avatarId: 'cozy_bear', label: 'Wave' });
  assert.equal(parseSticker('{"stickerId":"nope","avatarId":"cozy_bear"}'), null);
  assert.equal(parseSticker('not json'), null);
  assert.equal(stickerUrl('neon_bot', 'peek', 'https://cdn.example.com/'), 'https://cdn.example.com/stickers/neon_bot/peek.webp');
  assert.equal(stickerUrl('neon_bot', 'peek', undefined), '/stickers/neon_bot/peek.webp');
});

test('live action events are validated', () => {
  assert.deepEqual(parseActionEvent({ action: 'poke_knock', from: 'u1', at: 5 }), { action: 'poke_knock', from: 'u1', at: 5 });
  assert.equal(parseActionEvent({ action: 'explode', from: 'u1', at: 5 }), null);
  assert.equal(parseActionEvent(null), null);
});
