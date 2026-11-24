import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmotionSmoother, detectLiveEmotion, scoreEmotions } from '../src/lib/emotionDetector.ts';
import { bucketOf, countBuckets, emotionOf } from '../src/lib/emotions.ts';

const run = (s: EmotionSmoother, shapes: Record<string, number>, frames: number) => {
  let last = s.update(shapes);
  for (let i = 1; i < frames; i += 1) last = s.update(shapes);
  return last;
};

test('a neutral face is chill', () => {
  assert.equal(run(new EmotionSmoother(), {}, 20).emotion, 'chill');
});

test('a held smile becomes joy; brows down with a frown become angry; raised brows with an open jaw become surprised', () => {
  assert.equal(run(new EmotionSmoother(), { mouthSmileLeft: 0.7, mouthSmileRight: 0.7 }, 30).emotion, 'joy');
  assert.equal(run(new EmotionSmoother(), { browDownLeft: 0.7, browDownRight: 0.7, mouthFrownLeft: 0.5, mouthFrownRight: 0.5 }, 30).emotion, 'angry');
  assert.equal(run(new EmotionSmoother(), { browInnerUp: 0.8, jawOpen: 0.7, eyeWideLeft: 0.5, eyeWideRight: 0.5 }, 30).emotion, 'surprised');
  assert.equal(run(new EmotionSmoother(), { mouthFrownLeft: 0.7, mouthFrownRight: 0.7, eyeSquintLeft: 0.5, eyeSquintRight: 0.5 }, 30).emotion, 'sad');
});

test('a one-frame spike does not flip the label', () => {
  const s = new EmotionSmoother();
  run(s, {}, 20);
  assert.equal(s.update({ mouthSmileLeft: 1, mouthSmileRight: 1 }).emotion, 'chill');
});

test('scores stay within 0..1 and detectLiveEmotion returns display fields', () => {
  const scores = scoreEmotions({ mouthSmileLeft: 5, mouthSmileRight: 5 });
  assert.ok(Object.values(scores).every((v) => v >= 0 && v <= 1));
  const live = detectLiveEmotion({}, new EmotionSmoother());
  assert.equal(live.label, 'Chill');
  assert.match(live.color, /^#/);
  assert.ok(live.confidence > 0 && live.confidence <= 1);
});

test('posts without an AI tag get an emotion from their sentiment; sad counts as a complaint', () => {
  assert.equal(emotionOf({ sentiment: 'positive' }), 'joy');
  assert.equal(emotionOf({ emotion_tag: 'surprised', sentiment: 'negative' }), 'surprised');
  assert.equal(emotionOf({ emotion_tag: 'bogus', sentiment: null }), 'chill');
  assert.equal(bucketOf('sad'), 'angry');
  assert.deepEqual(countBuckets([{ sentiment: 'positive' }, { emotion_tag: 'sad', sentiment: 'negative' }, { sentiment: null }]), { joy: 1, angry: 1, surprised: 0, chill: 1 });
});
