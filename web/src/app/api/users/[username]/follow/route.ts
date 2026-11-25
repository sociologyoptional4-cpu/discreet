import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { authenticate, json } from '@/lib/server/request';
import type { FollowToggleResponse } from '@/types/social';

const USERNAME = /^[a-z0-9_]{3,24}$/;
const UNIQUE_VIOLATION = '23505';

/** Follows the creator, or unfollows when the signed-in visitor already does. Counters are kept by a database trigger. */
export async function POST(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { username } = await context.params;
  const handle = username.replace(/^@/, '').toLowerCase();
  if (!USERNAME.test(handle)) return json({ error: 'Creator not found' }, 404);

  const admin = getSupabaseAdmin();
  const { data: target, error: lookupError } = await admin.from('users').select('id').eq('username', handle).maybeSingle();
  if (lookupError) return json({ error: 'Could not look up this creator.' }, 503);
  if (!target) return json({ error: 'Creator not found' }, 404);
  if (target.id === auth.userId) return json({ error: 'You cannot follow yourself' }, 400);

  const { data: existing, error: existingError } = await auth.client
    .from('follows').select('follower_id').eq('follower_id', auth.userId).eq('following_id', target.id).maybeSingle();
  if (existingError) return json({ error: 'Could not update the follow.' }, 503);

  let isFollowing: boolean;
  if (existing) {
    const { error } = await auth.client.from('follows').delete().eq('follower_id', auth.userId).eq('following_id', target.id);
    if (error) return json({ error: 'Could not unfollow.' }, 503);
    isFollowing = false;
  } else {
    const { error } = await auth.client.from('follows').insert({ follower_id: auth.userId, following_id: target.id });
    if (error && error.code !== UNIQUE_VIOLATION) return json({ error: 'Could not follow.' }, 503);
    isFollowing = true;
  }

  const { data: counts, error: countError } = await admin.from('users').select('followers_count').eq('id', target.id).single();
  if (countError || !counts) return json({ error: 'Could not read the follower count.' }, 503);

  const body: FollowToggleResponse = { isFollowing, followersCount: counts.followers_count };
  return json(body);
}
