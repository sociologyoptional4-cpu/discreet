import type { EmotionTag } from '@/lib/emotions';
import type { AvatarId, MotionFrame } from '@/types/avatar';
import type { PrivacyMode } from '@/types/privacy';
import type { MotionTrackFile, Profile, PublicPost, SearchResult, Sentiment, TrendingTopic } from '@/types/social';

/**
 * Demo mode: with no Supabase keys the app runs on this in-memory data, so the whole loop (feed, expand, like, follow,
 * search, profiles, record and post) works offline. Nothing is saved: a page refresh starts over.
 */
export const DEMO_VIEWER_ID = '00000000-0000-4000-8000-000000000001';
const DAY_MS = 86_400_000;

type DemoUser = Profile;
type DemoPost = PublicPost & { category: string; key_points: string[] };

const user = (n: number, username: string, avatar_id: AvatarId, bio: string, followers: number, likes: number): DemoUser => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, username, avatar_id, bio, followers_count: followers, following_count: 12 + n, total_likes_received: likes,
});

const users: DemoUser[] = [
  user(1, 'you_demo', 'neon_bot', 'This is you. Record a post to see it in the feed.', 3, 0),
  user(2, 'sweet_tooth', 'cozy_bear', 'Chocolate critic. Honest, never paid.', 1840, 9200),
  user(3, 'hair_lab', 'street_artist', 'Shampoo and skincare, tested for weeks.', 920, 4100),
  user(4, 'night_snacker', 'cyber_monk', 'Instant noodles and late-night finds.', 2600, 12800),
  user(5, 'gadget_grandma', 'neon_bot', 'Tech that actually helps.', 5400, 30200),
];
const byId = new Map(users.map((u) => [u.id, u]));

type Seed = { owner: number; topic: string; category: string; sentiment: Sentiment; emotion: EmotionTag; summary: string; points: string[]; likes: number; mode?: PrivacyMode; hoursAgo: number };
const seeds: Seed[] = [
  { owner: 2, topic: 'dairy milk', category: 'food', sentiment: 'positive', emotion: 'joy', summary: 'Creamy and a proper treat, just very sweet.', points: ['Great taste', 'Too much sugar'], likes: 1280, hoursAgo: 2 },
  { owner: 4, topic: 'dairy milk', category: 'food', sentiment: 'positive', emotion: 'joy', summary: 'Still the best everyday chocolate bar.', points: ['Smooth', 'Fair price'], likes: 640, hoursAgo: 9 },
  { owner: 3, topic: 'sunsilk', category: 'beauty', sentiment: 'negative', emotion: 'angry', summary: 'Left my hair dry and the smell is overpowering.', points: ['Dry hair', 'Strong smell'], likes: 910, hoursAgo: 5 },
  { owner: 3, topic: 'sunsilk', category: 'beauty', sentiment: 'positive', emotion: 'chill', summary: 'Smooth hair after two washes, nice for monsoon.', points: ['Smooth', 'Good value'], likes: 330, hoursAgo: 20 },
  { owner: 4, topic: 'maggi', category: 'food', sentiment: 'positive', emotion: 'joy', summary: 'Two-minute comfort food that never lets me down.', points: ['Quick', 'Nostalgic'], likes: 2150, hoursAgo: 1 },
  { owner: 2, topic: 'oreo', category: 'food', sentiment: 'neutral', emotion: 'chill', summary: 'Fine cookie, but the cream filling is the only point.', points: ['Cream is good', 'Cookie is plain'], likes: 210, hoursAgo: 12 },
  { owner: 5, topic: 'iphone 15', category: 'tech', sentiment: 'positive', emotion: 'surprised', summary: 'Camera and battery are a real step up from my old phone.', points: ['Great camera', 'Battery lasts'], likes: 3020, hoursAgo: 3 },
  { owner: 5, topic: 'iphone 15', category: 'tech', sentiment: 'negative', emotion: 'sad', summary: 'Gets warm when charging and the price is hard to justify.', points: ['Runs warm', 'Expensive'], likes: 760, hoursAgo: 30 },
  { owner: 4, topic: 'nike air max', category: 'lifestyle', sentiment: 'positive', emotion: 'joy', summary: 'Comfortable all day, they look good with everything.', points: ['Comfy', 'Stylish'], likes: 480, hoursAgo: 16 },
];

function buildPosts(): DemoPost[] {
  const list: DemoPost[] = seeds.map((s, i) => {
  const owner = users.find((u) => u.id.endsWith(String(s.owner).padStart(2, '0')))!;
  const avatar = owner.avatar_id;
  const created = new Date(Date.now() - s.hoursAgo * 3_600_000).toISOString();
  return {
    id: `10000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`, user_id: owner.id, mode: s.mode ?? 'mask', avatar_id: avatar,
    media_url: 'demo:audio', motion_url: `demo:motion:${avatar}:${i}`, duration_sec: 8, is_incog: false, incog_alias: null, transcript: s.summary,
    topic_entity: s.topic, sentiment: s.sentiment, emotion_tag: s.emotion, ai_summary: s.summary, likes_count: s.likes, expiry_tier: '1w', expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
    created_at: created, creator_username: owner.username, creator_avatar_id: owner.avatar_id, creator_followers_count: owner.followers_count,
    category: s.category, key_points: s.points,
  };
  });
  // One burner post, so Incog looks right in the feed.
  list.push({ ...list[2], id: '10000000-0000-4000-8000-000000000099', user_id: null, is_incog: true, incog_alias: 'Anon_K7Q2M', creator_username: null, creator_avatar_id: null,
  creator_followers_count: null, topic_entity: 'maggi', sentiment: 'negative', emotion_tag: 'angry', ai_summary: 'Too salty lately, the masala packet changed.', key_points: ['Too salty'], likes_count: 175, created_at: new Date(Date.now() - 4 * 3_600_000).toISOString() });
  return list;
}

// Built on first use (not when the module loads), so the timestamps are fresh and server rendering never reads the clock.
let store: DemoPost[] | null = null;
const allPosts = (): DemoPost[] => (store ??= buildPosts());

const likedPosts = new Set<string>();
const followed = new Set<string>();
const motions = new Map<string, MotionTrackFile>();

/* ------------------------------------------------------------------ synthetic motion and audio */

/** A talking, gesturing, blinking performance for demo posts, generated rather than recorded. */
export function syntheticMotion(avatarId: AvatarId, seed: number, seconds = 8, fps = 30): MotionTrackFile {
  const frames: MotionFrame[] = [];
  for (let i = 0; i < seconds * fps; i += 1) {
    const t = i / fps;
    const speaking = Math.max(0, Math.sin(t * 1.3 + seed) + 0.4);
    const jaw = Math.max(0, Math.sin(t * 9 + seed * 2) * 0.5 + 0.2) * Math.min(1, speaking);
    const blink = (t + seed * 0.37) % 3.1 < 0.14 ? 1 : 0;
    const gesture = Math.max(0, Math.sin(t * 0.9 + seed));
    frames.push({
      t: Math.round(t * 1000) / 1000,
      head: [Math.sin(t * 1.1 + seed) * 0.08, Math.sin(t * 0.7 + seed) * 0.18, Math.sin(t * 0.5) * 0.05],
      shapes: { jawOpen: round(jaw), eyeBlinkLeft: blink, eyeBlinkRight: blink, mouthSmileLeft: round(0.25 + 0.2 * Math.sin(t * 0.8)), mouthSmileRight: round(0.25 + 0.2 * Math.sin(t * 0.8)), browInnerUp: round(0.15 + 0.15 * Math.sin(t * 1.7 + seed)) },
      rightHand: gesture > 0.2 ? [round(0.3 + 0.1 * Math.sin(t * 3 + seed)), round(0.55 - 0.1 * gesture), 0] : undefined,
      leftHand: gesture > 0.5 ? [round(0.7 + 0.08 * Math.sin(t * 2.4)), round(0.6 - 0.08 * gesture), 0] : undefined,
    });
  }
  return { fps, avatarId, frames };
}
const round = (v: number): number => Math.round(v * 1000) / 1000;

export const isDemoUrl = (url: string): boolean => url.startsWith('demo:');

/** Looks up a demo motion track by its `demo:motion:` address; seeded tracks are generated on first use. */
export function demoMotion(url: string): MotionTrackFile | null {
  const stored = motions.get(url);
  if (stored) return stored;
  const [, , avatar, seed] = url.split(':');
  if (!avatar || seed === undefined || avatar === 'mine') return null;
  const track = syntheticMotion(avatar as AvatarId, Number(seed) || 0);
  motions.set(url, track);
  return track;
}

let silence: string | null = null;
/** Eight seconds of silence as a playable file: the 3D player needs an audio clock, even in a silent demo. */
export function demoAudioUrl(): string {
  if (silence) return silence;
  const rate = 8000;
  const samples = rate * 8;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); write(36, 'data'); view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  silence = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  return silence;
}

/** Turns a `demo:` media address into something a media element can play. */
export const resolveMediaUrl = (url: string): string => (url === 'demo:audio' ? demoAudioUrl() : url);

/* ------------------------------------------------------------------ reads */

const live = (): DemoPost[] => allPosts().filter((p) => p.expires_at === null || new Date(p.expires_at).getTime() > Date.now());
const withCreator = (p: DemoPost): DemoPost => {
  const owner = p.user_id ? byId.get(p.user_id) : undefined;
  return owner ? { ...p, creator_followers_count: owner.followers_count } : p;
};
const newest = (a: DemoPost, b: DemoPost): number => (a.created_at < b.created_at ? 1 : -1);

export function demoFeed(topic: string | null | undefined, focusId: string | null | undefined): PublicPost[] {
  let list = live().filter((p) => !topic || p.topic_entity === topic.trim().toLowerCase());
  list = [...list].sort(topic ? (a, b) => b.likes_count - a.likes_count : newest).map(withCreator);
  if (focusId) {
    const focus = allPosts().find((p) => p.id === focusId);
    if (focus) list = [withCreator(focus), ...list.filter((p) => p.id !== focusId)];
  }
  return list;
}

const grams = (text: string): Set<string> => {
  const padded = `  ${text.toLowerCase()} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) set.add(padded.slice(i, i + 3));
  return set;
};
const similarity = (a: string, b: string): number => {
  const x = grams(a);
  const y = grams(b);
  let shared = 0;
  x.forEach((g) => { if (y.has(g)) shared += 1; });
  return shared / (x.size + y.size - shared || 1);
};

/** Contains-match or trigram-similar topic ("dary milk" finds "dairy milk"), most liked first. */
export function demoSearch(query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return live()
    .map((p) => ({ post: p, score: Math.max(similarity(p.topic_entity ?? '', q), (p.topic_entity ?? '').includes(q) || (p.transcript ?? '').toLowerCase().includes(q) ? 1 : 0) }))
    .filter((r) => r.score > 0.3)
    .sort((a, b) => b.post.likes_count - a.post.likes_count)
    .map(({ post, score }) => ({ ...withCreator(post), match_score: score }));
}

export function demoTrending(limit: number): TrendingTopic[] {
  const groups = new Map<string, TrendingTopic>();
  for (const p of live()) {
    if (!p.topic_entity || p.topic_entity === 'general') continue;
    const g = groups.get(p.topic_entity) ?? { topic_entity: p.topic_entity, total_posts: 0, positive_count: 0, negative_count: 0 };
    g.total_posts += 1;
    if (p.sentiment === 'positive') g.positive_count += 1;
    if (p.sentiment === 'negative') g.negative_count += 1;
    groups.set(p.topic_entity, g);
  }
  return [...groups.values()].sort((a, b) => b.total_posts - a.total_posts).slice(0, limit);
}

export function demoThumbnails(topics: readonly string[], perTopic: number): Record<string, PublicPost[]> {
  const out: Record<string, PublicPost[]> = {};
  for (const topic of topics) out[topic] = live().filter((p) => p.topic_entity === topic).sort((a, b) => b.likes_count - a.likes_count).slice(0, perTopic).map(withCreator);
  return out;
}

export const demoProfileByName = (username: string): Profile | null => users.find((u) => u.username === username.toLowerCase()) ?? null;
export const demoViewerProfile = (): Profile => users[0];
export const demoProfilePosts = (userId: string): PublicPost[] => live().filter((p) => p.user_id === userId && !p.is_incog).sort(newest).map(withCreator);
export const demoIsFollowing = (creatorId: string): boolean => followed.has(creatorId);
export const demoLiked = (postId: string): boolean => likedPosts.has(postId);

/* ------------------------------------------------------------------ writes */

export function demoToggleLike(postId: string, currentlyLiked: boolean): void {
  const post = allPosts().find((p) => p.id === postId);
  if (post) post.likes_count = Math.max(0, post.likes_count + (currentlyLiked ? -1 : 1));
  if (currentlyLiked) likedPosts.delete(postId);
  else likedPosts.add(postId);
}

export function demoToggleFollow(creatorId: string, currentlyFollowing: boolean): void {
  const creator = byId.get(creatorId);
  if (creator) creator.followers_count = Math.max(0, creator.followers_count + (currentlyFollowing ? -1 : 1));
  if (currentlyFollowing) followed.delete(creatorId);
  else followed.add(creatorId);
}

export type DemoNewPost = { mode: PrivacyMode; avatarId: AvatarId | null; mediaUrl: string; motion: MotionTrackFile | null; durationSec: number; isIncog: boolean; alias: string | null };

/** Adds the viewer's own post to the demo feed, newest first. */
export function demoAddPost(input: DemoNewPost): string {
  const id = crypto.randomUUID();
  const me = users[0];
  const motionUrl = input.motion ? `demo:motion:mine:${id}` : null;
  if (input.motion && motionUrl) motions.set(motionUrl, input.motion);
  const summary = 'Your new post. In the real app, speech-to-text and AI add the topic and summary within seconds.';
  allPosts().push({
    id, user_id: input.isIncog ? null : me.id, mode: input.mode, avatar_id: input.avatarId, media_url: input.mediaUrl, motion_url: motionUrl, duration_sec: input.durationSec,
    is_incog: input.isIncog, incog_alias: input.alias, transcript: summary, topic_entity: 'my review', sentiment: 'positive', emotion_tag: 'joy', ai_summary: summary, likes_count: 0,
    expiry_tier: input.isIncog ? '1d' : '1w', expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(), created_at: new Date().toISOString(),
    creator_username: input.isIncog ? null : me.username, creator_avatar_id: input.isIncog ? null : me.avatar_id, creator_followers_count: input.isIncog ? null : me.followers_count,
    category: 'general', key_points: [],
  });
  return id;
}
