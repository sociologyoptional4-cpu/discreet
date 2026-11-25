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
  /** Present once supabase/playable_scenes_module1.sql has been run; absent means a plain video post. */
  post_format?: 'video' | 'image' | 'recipe_avatar' | 'recipe_shayari';
  recipe_data?: unknown;
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

export type CreatorBadge = { id: string; label: string };

/** A creator as shown on a profile page: the stored profile plus gamification and what the visitor has done. */
export type CreatorProfile = Profile & {
  vibe_xp: number;
  vibe_level: number;
  badges: CreatorBadge[];
};

/** One tile of a profile grid. `caption` is the post's AI summary; `expires_at` is null for permanent posts. */
export type ProfilePostSummary = {
  id: string;
  thumbnail_url: string | null;
  media_url: string;
  post_format: 'video' | 'image' | 'recipe_avatar' | 'recipe_shayari';
  caption: string | null;
  comments_count: number;
  expires_at: string | null;
  created_at: string;
  emotion_tag: PublicPost['emotion_tag'];
  sentiment: Sentiment | null;
};

/** Reply of `GET /api/users/[username]`. Incog posts are never included. */
export type ProfilePageResponse = {
  profile: CreatorProfile;
  isOwnProfile: boolean;
  isFollowing: boolean;
  postsCount: number;
  permanentPosts: ProfilePostSummary[];
  burnerPosts: ProfilePostSummary[];
};

/** Reply of `POST /api/users/[username]/follow`. */
export type FollowToggleResponse = { isFollowing: boolean; followersCount: number };

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
