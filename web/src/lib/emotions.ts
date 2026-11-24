import type { Sentiment } from '../types/social.ts';

export type EmotionTag = 'joy' | 'angry' | 'surprised' | 'sad' | 'chill';
export const EMOTION_TAGS: readonly EmotionTag[] = ['joy', 'angry', 'surprised', 'sad', 'chill'];

export type EmotionMeta = { id: EmotionTag; label: string; color: string; glow: string; headline: string; plural: string };

/** Display name, clay colour and headline for each emotion. Shared by the camera, the discovery hub and the vibe card. */
export const EMOTION_META: Record<EmotionTag, EmotionMeta> = {
  joy: { id: 'joy', label: 'Joy', color: '#7ED957', glow: '#c8f5b4', headline: 'People feel joyful', plural: 'Joyful' },
  angry: { id: 'angry', label: 'Angry', color: '#B84A5E', glow: '#f0b6c1', headline: 'Users feel angry', plural: 'Rants' },
  surprised: { id: 'surprised', label: 'Surprised', color: '#9B87F5', glow: '#d9d0ff', headline: 'People are surprised', plural: 'Surprised' },
  sad: { id: 'sad', label: 'Sad', color: '#8FA3BF', glow: '#d6e0ee', headline: 'People feel let down', plural: 'Let down' },
  chill: { id: 'chill', label: 'Chill', color: '#7CC6FE', glow: '#cfeaff', headline: 'People feel chill', plural: 'Chill' },
};

export const isEmotionTag = (v: unknown): v is EmotionTag => typeof v === 'string' && (EMOTION_TAGS as readonly string[]).includes(v);

/** A post's emotion: the AI's tag when there is one, otherwise a fair guess from its sentiment. */
export function emotionOf(post: { emotion_tag?: string | null; sentiment: Sentiment | null }): EmotionTag {
  if (isEmotionTag(post.emotion_tag)) return post.emotion_tag;
  return post.sentiment === 'positive' ? 'joy' : post.sentiment === 'negative' ? 'angry' : 'chill';
}

/** The four bars of the vibe meter. Sad reviews count with the angry ones: both are complaints. */
export type MeterBucket = 'joy' | 'angry' | 'surprised' | 'chill';
export const METER_BUCKETS: readonly MeterBucket[] = ['joy', 'angry', 'surprised', 'chill'];
export const bucketOf = (emotion: EmotionTag): MeterBucket => (emotion === 'sad' ? 'angry' : emotion);

export function countBuckets(posts: readonly { emotion_tag?: string | null; sentiment: Sentiment | null }[]): Record<MeterBucket, number> {
  const counts: Record<MeterBucket, number> = { joy: 0, angry: 0, surprised: 0, chill: 0 };
  for (const p of posts) counts[bucketOf(emotionOf(p))] += 1;
  return counts;
}
