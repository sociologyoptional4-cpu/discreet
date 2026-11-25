import type { AvatarId, MotionFrame } from '@/types/avatar';
import type { ExpiryTier, PrivacyMode } from '@/types/privacy';

export type Sentiment = 'positive' | 'negative' | 'neutral';

export const CATEGORIES = ['food', 'beauty', 'tech', 'lifestyle', 'movies', 'general'] as const;
export type Category = (typeof CATEGORIES)[number];

/** One row of the `public_posts` view. Creator fields and `user_id` are null for Incog posts. */
export type PublicPost = {
  id: string;
  user_id: string | null;
  mode: PrivacyMode;
  avatar_id: AvatarId | null;
  media_url: string;
  thumbnail_url?: string | null;
  motion_url: string | null;
  duration_sec: number;
  is_incog: boolean;
  incog_alias: string | null;
  transcript: string | null;
  topic_entity: string | null;
  sentiment: Sentiment | null;
  ai_summary: string | null;
  likes_count: number;
  comments_count?: number;
  expiry_tier: ExpiryTier;
  expires_at: string | null;
  created_at: string;
  creator_username: string | null;
  creator_avatar_id: AvatarId | null;
  creator_followers_count: number | null;
  /** Set by the AI worker (phase6_emotion.sql). Missing on databases without that migration. */
  emotion_tag?: 'joy' | 'angry' | 'surprised' | 'sad' | 'chill' | null;
};

/** A post plus what the signed-in visitor has already done with it. */
export type FeedItem = PublicPost & { liked: boolean; following: boolean };

export type Profile = {
  id: string;
  username: string;
  avatar_id: AvatarId;
  bio: string;
  followers_count: number;
  following_count: number;
  total_likes_received: number;
};

/** The self-describing motion track stored next to a 3D mask post's audio. */
export type MotionTrackFile = {
  fps: number;
  avatarId: AvatarId;
  frames: MotionFrame[];
};

export const EXPIRY_TIERS: readonly ExpiryTier[] = ['1d', '1w', '1y', 'never'];

/** A row from `search_posts_fuzzy`: a public post plus the AI fields and how closely it matched. */
export type SearchResult = PublicPost & { category: string; key_points: string[]; match_score: number };

/** A row from `get_trending_topics`. */
export type TrendingTopic = { topic_entity: string; total_posts: number; positive_count: number; negative_count: number };
