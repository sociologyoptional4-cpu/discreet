import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { CreatorProfileScreen } from '@/components/profile/CreatorProfileScreen';
import { StateMessage } from '@/components/StateMessage';
import { getProfileSummary } from '@/lib/profileMeta';

export const viewport: Viewport = { themeColor: '#0A0A0A', viewportFit: 'cover' };

const compact = (n: number): string => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);

/** What WhatsApp, X and other apps show when the link is shared: the @username, follower count and bio. */
export async function generateMetadata({ params }: PageProps<'/profile/[username]'>): Promise<Metadata> {
  const username = decodeURIComponent((await params).username);
  if (username === 'me') return { title: 'My profile', robots: { index: false } };
  const profile = await getProfileSummary(username.toLowerCase());
  if (!profile) return { title: 'Creator not found', robots: { index: false } };

  const title = `@${profile.username}`;
  const followers = `${compact(profile.followers)} ${profile.followers === 1 ? 'follower' : 'followers'}`;
  const description = profile.bio ? `${followers} • ${profile.bio}` : `${followers} • Faceless reviews on Vybe`;
  const path = `/profile/${profile.username}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'profile', title, description, url: path, username: profile.username },
    twitter: { card: 'summary', title, description },
  };
}

async function Profile({ params }: PageProps<'/profile/[username]'>) {
  const { username } = await params;
  return <CreatorProfileScreen username={decodeURIComponent(username).replace(/^@/, '').toLowerCase()} />;
}

export default function ProfilePage(props: PageProps<'/profile/[username]'>) {
  return (
    <main className="bg-[#0A0A0A]">
      <Suspense fallback={<StateMessage title="Loading profile…" />}>
        <Profile {...props} />
      </Suspense>
    </main>
  );
}
