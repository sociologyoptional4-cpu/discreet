import { cacheLife } from 'next/cache';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type ProfileSummary = { username: string; followers: number; bio: string };

/** Public facts for link previews. Cached for a few minutes so a crowd of crawlers does not hit the database. */
export async function getProfileSummary(username: string): Promise<ProfileSummary | null> {
  'use cache';
  cacheLife('minutes');
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.from('users').select('username, followers_count, bio').eq('username', username).maybeSingle();
  return data ? { username: data.username as string, followers: data.followers_count as number, bio: data.bio as string } : null;
}
