'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmotionResultCard } from '@/components/EmotionResultCard';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfilePostGrid } from '@/components/profile/ProfilePostGrid';
import { StateMessage } from '@/components/StateMessage';
import { useSocialActions } from '@/hooks/useSocialActions';
import { fetchOwnProfile } from '@/lib/feedData';
import { supabase } from '@/lib/supabase';
import type { ProfilePageResponse } from '@/types/social';

type State =
  | { username: string; kind: 'ready'; data: ProfilePageResponse }
  | { username: string; kind: 'missing' }
  | { username: string; kind: 'error'; message: string };

const shell = 'mesh-aura mx-auto min-h-[100dvh] w-full max-w-[430px] pb-[calc(var(--nav-h)+1rem)] text-slate-900';

function ProfileSkeleton() {
  return (
    <div className={shell} aria-busy="true" aria-label="Loading profile">
      <div className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between"><div className="size-11 animate-pulse rounded-full bg-white/70" /><div className="h-4 w-28 animate-pulse rounded-full bg-white/70" /><div className="size-11 animate-pulse rounded-full bg-white/70" /></div>
        <div className="mt-4 flex flex-col items-center gap-3 rounded-[28px] bg-white/55 p-6">
          <div className="size-[104px] animate-pulse rounded-full bg-white/80" />
          <div className="h-5 w-32 animate-pulse rounded-full bg-white/80" />
          <div className="h-3 w-52 animate-pulse rounded-full bg-white/70" />
          <div className="mt-2 h-12 w-full animate-pulse rounded-2xl bg-white/70" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-1">{Array.from({ length: 9 }, (_, i) => <div key={i} className="aspect-[9/16] animate-pulse bg-white/60" />)}</div>
    </div>
  );
}

/** `/profile/[username]`: loads the creator from the profile API and shows the header and post grid. `me` resolves to your own @handle. */
export function CreatorProfileScreen({ username }: { username: string }) {
  const router = useRouter();
  const social = useSocialActions();
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<State | null> => {
      const handle = username;
      if (handle === 'me') {
        const own = await fetchOwnProfile();
        if (!own) return { username, kind: 'missing' };
        router.replace(`/profile/${own.username}`);
        return null;
      }
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      const response = await fetch(`/api/users/${encodeURIComponent(handle)}`, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (response.status === 404) return { username, kind: 'missing' };
      if (!response.ok) return { username, kind: 'error', message: 'Could not load this profile.' };
      return { username, kind: 'ready', data: (await response.json()) as ProfilePageResponse };
    };
    load()
      .then((next) => { if (next && !controller.signal.aborted) setState(next); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ username, kind: 'error', message: error instanceof Error ? error.message : 'Could not load this profile.' });
      });
    return () => controller.abort();
  }, [username, router]);

  if (!state || state.username !== username) return <ProfileSkeleton />;
  if (state.kind === 'missing') return <StateMessage title="Creator not found" body={`There is no @${username} on Vybe.`} action={{ href: '/feed', label: 'Back to the feed' }} />;
  if (state.kind === 'error') return <StateMessage title="Couldn’t load this profile" body={state.message} action={{ href: '/feed', label: 'Back to the feed' }} />;

  const { data } = state;
  const allPosts = [...data.permanentPosts, ...data.burnerPosts];
  return (
    <div className={shell}>
      <ProfileHeader
        data={data}
        social={social}
        onBioSaved={(bio) => setState({ ...state, data: { ...data, profile: { ...data.profile, bio } } })}
      />
      <div className="px-4"><EmotionResultCard username={data.profile.username} posts={allPosts} /></div>
      <ProfilePostGrid permanent={data.permanentPosts} burners={data.burnerPosts} />
    </div>
  );
}
