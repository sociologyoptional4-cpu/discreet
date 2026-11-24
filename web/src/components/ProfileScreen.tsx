'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Heart, Play } from 'lucide-react';
import { AvatarCarousel } from '@/components/AvatarCarousel';
import { MessageButton } from '@/components/MessageButton';
import { EmotionResultCard } from '@/components/EmotionResultCard';
import { StateMessage } from '@/components/StateMessage';
import { useSocialActions } from '@/hooks/useSocialActions';
import { AVATAR_META } from '@/lib/avatars';
import { fetchIsFollowing, fetchOwnProfile, fetchProfile, fetchProfilePosts } from '@/lib/feedData';
import type { Profile, PublicPost } from '@/types/social';

type Loaded =
  | { username: string; profile: Profile; posts: PublicPost[]; following: boolean; error?: undefined }
  | { username: string; profile: null; error?: string; posts?: undefined; following?: undefined };

const compact = (n: number): string => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
const MODE_LABEL = { mask: '3D Mask', blur: 'Blur', shadow: 'Shadow', noface: 'NoFace' } as const;

/** A creator's faceless profile: avatar badge, counters, Follow button, and a grid of their public (never Incog) posts. */
export function ProfileScreen({ username }: { username: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const social = useSocialActions();

  useEffect(() => {
    let alive = true;
    (async () => {
      const profile = username === 'me' ? await fetchOwnProfile() : await fetchProfile(username);
      if (!profile) return { username, profile: null } satisfies Loaded;
      const [posts, following] = await Promise.all([fetchProfilePosts(profile.id), fetchIsFollowing(profile.id)]);
      return { username, profile, posts, following } satisfies Loaded;
    })()
      .then((result) => { if (alive) setLoaded(result); })
      .catch((e: unknown) => { if (alive) setLoaded({ username, profile: null, error: e instanceof Error ? e.message : 'Could not load this profile.' }); });
    return () => { alive = false; };
  }, [username]);

  if (!loaded || loaded.username !== username) return <StateMessage title="Loading profile…" />;
  if (!loaded.profile) {
    return <StateMessage title={loaded.error ? 'Couldn’t load this profile' : 'Creator not found'} body={loaded.error} action={{ href: '/feed', label: 'Back to the feed' }} />;
  }

  const { profile, posts } = loaded;
  const accent = AVATAR_META[profile.avatar_id].accent;
  const follow = social.followView(profile.id, { following: loaded.following, followers: profile.followers_count });
  const isOwn = social.viewerId === profile.id;
  const stats = [
    { label: 'Followers', value: follow.followers },
    { label: 'Following', value: profile.following_count },
    { label: 'Likes', value: profile.total_likes_received },
  ];

  return (
    <div className="mesh-aura mx-auto min-h-[calc(100dvh-var(--nav-h))] w-full max-w-xl px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-slate-900">
      <div className="px-4">
        <Link href="/feed" aria-label="Back to the feed" className="acrylic-pill flex size-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-slate-800">
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
      </div>

      <header className="flex flex-col items-center gap-3 pt-2 text-center">
        {username === 'me' && <Link href="/notifications" className="self-end text-sm text-slate-600 underline">Notifications</Link>}
        <AvatarCarousel key={profile.id} initial={profile.avatar_id} />
        <div>
          <h1 className="text-xl font-bold">@{profile.username}</h1>
          <p className="text-xs text-slate-500">{AVATAR_META[profile.avatar_id].label}</p>
        </div>
        {profile.bio && <p className="max-w-sm text-sm text-slate-700">{profile.bio}</p>}

        {posts.length > 0 && <div className="flex flex-wrap justify-center gap-2">{Array.from(new Set(posts.map((post) => post.topic_entity).filter((topic): topic is string => Boolean(topic)))).slice(0, 4).map((topic) => <span key={topic} className="rounded-full border border-white/90 bg-white/65 px-3 py-1 text-xs font-medium capitalize text-slate-600">{topic}</span>)}</div>}

        <dl className="grid w-full max-w-xs grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/85 bg-white/65 py-2 shadow-sm">
              <dd className="text-lg font-bold tabular-nums">{compact(s.value)}</dd>
              <dt className="text-[11px] text-slate-500">{s.label}</dt>
            </div>
          ))}
        </dl>

        {!isOwn && (
          <button
            type="button"
            onClick={() => void social.toggleFollow(profile.id, follow.following)}
            aria-pressed={follow.following}
            className={`min-h-11 w-40 rounded-full text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${
              follow.following ? 'border border-slate-200 bg-white/70 text-slate-700' : 'bg-slate-900 text-white'
            }`}
          >
            {follow.following ? 'Following' : 'Follow'}
          </button>
        )}
        {!isOwn && username !== 'me' && <MessageButton creatorId={profile.id} />}
        {social.error && <p role="alert" className="text-sm text-rose-700">{social.error}</p>}
      </header>

      <EmotionResultCard username={profile.username} posts={posts} />

      {posts.length === 0 ? (
        <p className="mt-10 text-center text-sm text-slate-500">No public posts yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-3 gap-2">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/feed?postId=${post.id}`}
                aria-label={post.ai_summary || `${MODE_LABEL[post.mode]} post, ${post.likes_count} likes`}
                className="relative flex aspect-[9/16] flex-col justify-between overflow-hidden rounded-2xl border border-white/70 bg-white/65 p-2 text-slate-800 shadow-sm focus-visible:outline-2 focus-visible:outline-violet-400"
                style={{ backgroundImage: `linear-gradient(160deg, ${accent}22, transparent 60%)` }}
              >
                <span className="w-fit rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-semibold">{MODE_LABEL[post.mode]}</span>
                <Play aria-hidden className="mx-auto size-6 text-slate-600" />
                <span className="flex items-center gap-1 text-xs font-semibold tabular-nums"><Heart aria-hidden className="size-3.5" /> {post.likes_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
