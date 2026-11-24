import {
  demoFeed, demoIsFollowing, demoLiked, demoProfileByName, demoProfilePosts, demoSearch, demoThumbnails, demoTrending, demoViewerProfile,
} from '@/lib/demoData';
import { currentUserId, ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';
import type { FeedItem, Profile, PublicPost, SearchResult, Sentiment, TrendingTopic } from '@/types/social';

const FEED_PAGE = 30;
const SEARCH_LIMIT = 200;

/** Adds "did I like this / do I follow its creator" for the signed-in visitor. Without a session both are false. */
export async function withViewerState(posts: PublicPost[]): Promise<FeedItem[]> {
  if (isDemoMode) return posts.map((p) => ({ ...p, liked: demoLiked(p.id), following: p.user_id !== null && demoIsFollowing(p.user_id) }));
  const viewerId = await currentUserId();
  if (!viewerId || posts.length === 0) return posts.map((p) => ({ ...p, liked: false, following: false }));

  const creatorIds = [...new Set(posts.map((p) => p.user_id).filter((id): id is string => id !== null))];
  const [likes, follows] = await Promise.all([
    supabase.from('post_likes').select('post_id').eq('user_id', viewerId).in('post_id', posts.map((p) => p.id)),
    creatorIds.length > 0
      ? supabase.from('follows').select('following_id').eq('follower_id', viewerId).in('following_id', creatorIds)
      : Promise.resolve({ data: [] as { following_id: string }[], error: null }),
  ]);
  const liked = new Set((likes.data ?? []).map((r) => r.post_id as string));
  const following = new Set((follows.data ?? []).map((r) => r.following_id as string));
  return posts.map((p) => ({ ...p, liked: liked.has(p.id), following: p.user_id !== null && following.has(p.user_id) }));
}

/** Newest live posts. `focusPostId` (opened from search) is fetched separately and put first. */
export async function fetchFeed(focusPostId?: string | null, topic?: string | null): Promise<FeedItem[]> {
  if (isDemoMode) return withViewerState(demoFeed(topic, focusPostId));
  let query = supabase.from('public_posts').select('*');
  if (topic) query = query.eq('topic_entity', topic.trim().toLowerCase());
  const latest = await query.order(topic ? 'likes_count' : 'created_at', { ascending: false }).limit(FEED_PAGE);
  if (latest.error) throw new Error('Could not load the feed.');
  let posts = latest.data as PublicPost[];

  if (focusPostId && !posts.some((p) => p.id === focusPostId)) {
    const focus = await supabase.from('public_posts').select('*').eq('id', focusPostId).maybeSingle();
    if (focus.data) posts = [focus.data as PublicPost, ...posts];
  } else if (focusPostId) {
    posts = [...posts.filter((p) => p.id === focusPostId), ...posts.filter((p) => p.id !== focusPostId)];
  }
  return withViewerState(posts);
}

/** `%` and `_` are wildcards in ILIKE; the visitor's text must match literally. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Live posts matching `query` by topic or transcript, tolerant of typos ("dary milk" finds "dairy milk"), most liked first.
 * Uses the `search_posts_fuzzy` RPC; if that function is not installed yet, falls back to a plain topic match.
 */
export async function searchPostsFuzzy(query: string): Promise<SearchResult[]> {
  const term = query.trim();
  if (!term) return [];
  if (isDemoMode) return demoSearch(term);
  const rpc = await supabase.rpc('search_posts_fuzzy', { search_query: term });
  if (!rpc.error) return (rpc.data as SearchResult[]).map((r) => ({ ...r, key_points: r.key_points ?? [] }));

  const { data, error } = await supabase
    .from('public_posts')
    .select('*')
    .ilike('topic_entity', `%${escapeLike(term)}%`)
    .order('likes_count', { ascending: false })
    .limit(SEARCH_LIMIT);
  if (error) throw new Error('Search failed. Try again.');
  return (data as PublicPost[]).map((p) => ({ ...p, category: 'general', key_points: [], match_score: 0 }));
}

/** The most reviewed live topics, for the empty search screen. */
export async function getTrendingTopics(limit = 10): Promise<TrendingTopic[]> {
  if (isDemoMode) return demoTrending(limit);
  const { data, error } = await supabase.rpc('get_trending_topics', { limit_count: limit });
  if (error) throw new Error('Could not load trending topics.');
  return (data as TrendingTopic[]).map((t) => ({
    topic_entity: t.topic_entity,
    total_posts: Number(t.total_posts), // bigint arrives as a number or a string depending on size
    positive_count: Number(t.positive_count),
    negative_count: Number(t.negative_count),
  }));
}

export function countBySentiment(posts: readonly { sentiment: Sentiment | null }[]): { all: number; positive: number; negative: number; neutral: number } {
  const positive = posts.filter((p) => p.sentiment === 'positive').length;
  const negative = posts.filter((p) => p.sentiment === 'negative').length;
  return { all: posts.length, positive, negative, neutral: posts.length - positive - negative };
}

export async function fetchProfile(username: string): Promise<Profile | null> {
  if (isDemoMode) return demoProfileByName(username);
  const { data, error } = await supabase
    .from('users')
    .select('id, username, avatar_id, bio, followers_count, following_count, total_likes_received')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (error) throw new Error('Could not load this profile.');
  return data as Profile | null;
}

/** The signed-in visitor's own profile (`/profile/me`). Starts an anonymous session if there is none yet. */
export async function fetchOwnProfile(): Promise<Profile | null> {
  if (isDemoMode) return demoViewerProfile();
  const session = await ensureSession();
  const { data, error } = await supabase
    .from('users')
    .select('id, username, avatar_id, bio, followers_count, following_count, total_likes_received')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw new Error('Could not load your profile.');
  return data as Profile | null;
}

/** A creator's live public posts. Incog posts never match: the view hides their user_id, and `is_incog` is filtered too. */
export async function fetchProfilePosts(userId: string): Promise<PublicPost[]> {
  if (isDemoMode) return demoProfilePosts(userId);
  const { data, error } = await supabase
    .from('public_posts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_incog', false)
    .order('created_at', { ascending: false })
    .limit(90);
  if (error) throw new Error('Could not load posts.');
  return data as PublicPost[];
}

export async function fetchIsFollowing(creatorId: string): Promise<boolean> {
  if (isDemoMode) return demoIsFollowing(creatorId);
  const viewerId = await currentUserId();
  if (!viewerId) return false;
  const { data } = await supabase.from('follows').select('following_id').eq('follower_id', viewerId).eq('following_id', creatorId).maybeSingle();
  return data !== null;
}

/** A few of the most liked posts for each topic, for the thumbnails on the trending clusters. */
export async function fetchTopicThumbnails(topics: readonly string[], perTopic = 4): Promise<Record<string, PublicPost[]>> {
  if (topics.length === 0) return {};
  if (isDemoMode) return demoThumbnails(topics, perTopic);
  const { data, error } = await supabase.from('public_posts').select('*').in('topic_entity', [...topics]).order('likes_count', { ascending: false }).limit(topics.length * 12);
  if (error) throw new Error('Could not load topic previews.');
  const grouped: Record<string, PublicPost[]> = {};
  for (const post of data as PublicPost[]) {
    const key = post.topic_entity ?? '';
    const list = (grouped[key] ??= []);
    if (list.length < perTopic) list.push(post);
  }
  return grouped;
}
