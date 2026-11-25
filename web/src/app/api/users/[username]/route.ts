import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { json, optionalViewer } from '@/lib/server/request';
import type { CreatorBadge, CreatorProfile, ProfilePageResponse, ProfilePostSummary } from '@/types/social';

const USERNAME = /^[a-z0-9_]{3,24}$/;
const POST_COLUMNS = 'id, thumbnail_url, media_url, post_format, ai_summary, comments_count, expires_at, created_at, emotion_tag, sentiment';
const PERMANENT_LIMIT = 30;
const BURNER_LIMIT = 20;

type PostRow = Omit<ProfilePostSummary, 'caption'> & { ai_summary: string | null };

const toSummary = ({ ai_summary, ...rest }: PostRow): ProfilePostSummary => ({ ...rest, caption: ai_summary, comments_count: rest.comments_count ?? 0 });

const toBadges = (value: unknown): CreatorBadge[] =>
  Array.isArray(value)
    ? value.filter((b): b is CreatorBadge => typeof b === 'object' && b !== null && typeof (b as CreatorBadge).id === 'string' && typeof (b as CreatorBadge).label === 'string')
    : [];

/** A creator's public profile and posts. Incog posts are excluded no matter who asks. */
export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params;
  const handle = username.replace(/^@/, '').toLowerCase();
  if (!USERNAME.test(handle)) return json({ error: 'Creator not found' }, 404);

  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin.from('users').select('*').eq('username', handle).maybeSingle();
  if (error) return json({ error: 'Could not load this profile.' }, 503);
  if (!row) return json({ error: 'Creator not found' }, 404);

  const viewerId = await optionalViewer(request);
  const nowIso = new Date().toISOString();
  const live = () => admin.from('posts').select(POST_COLUMNS).eq('user_id', row.id).eq('is_incog', false).order('created_at', { ascending: false });

  const [permanent, burners, count, follow] = await Promise.all([
    live().is('expires_at', null).limit(PERMANENT_LIMIT),
    live().not('expires_at', 'is', null).gt('expires_at', nowIso).limit(BURNER_LIMIT),
    admin.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', row.id).eq('is_incog', false).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    viewerId && viewerId !== row.id
      ? admin.from('follows').select('follower_id').eq('follower_id', viewerId).eq('following_id', row.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (permanent.error || burners.error || count.error || follow.error) return json({ error: 'Could not load this profile.' }, 503);

  const profile: CreatorProfile = {
    id: row.id,
    username: row.username,
    avatar_id: row.avatar_id,
    bio: row.bio ?? '',
    followers_count: row.followers_count ?? 0,
    following_count: row.following_count ?? 0,
    total_likes_received: row.total_likes_received ?? 0,
    vibe_xp: row.vibe_xp ?? 0,
    vibe_level: row.vibe_level ?? 1,
    badges: toBadges(row.badges),
  };
  const body: ProfilePageResponse = {
    profile,
    isOwnProfile: viewerId === row.id,
    isFollowing: follow.data !== null,
    postsCount: count.count ?? 0,
    permanentPosts: (permanent.data as unknown as PostRow[]).map(toSummary),
    burnerPosts: (burners.data as unknown as PostRow[]).map(toSummary),
  };
  return json(
    body,
    200,
    viewerId === null
      ? { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120', Vary: 'Authorization' }
      : { Vary: 'Authorization' },
  );
}
