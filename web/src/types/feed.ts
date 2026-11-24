import type { PublicPost } from './social';

export const EVENT_NAMES = [
  'impression', 'watch_time_ms', 'video_duration_ms', 'completion_rate', 'rewatch_count',
  'fast_skip', 'like', 'unlike', 'share', 'profile_visit', 'follow_from_post', 'not_interested',
] as const;
export type EventName = typeof EVENT_NAMES[number];
export type PostEvent = { id: string; post_id: string; event_type: EventName; value: number };
export type DiversityContext = Pick<PublicPost, 'user_id' | 'topic_entity' | 'mode' | 'emotion_tag'>;
export type FeedPage = { posts: PublicPost[]; cursor: string; hasMore: boolean };
