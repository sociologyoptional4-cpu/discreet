import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { FeedScreen } from '@/components/FeedScreen';
import { StateMessage } from '@/components/StateMessage';

export const metadata: Metadata = { title: 'Feed' };
export const viewport: Viewport = { themeColor: '#0A0A0A', viewportFit: 'cover' };

export default function FeedPage() {
  return (
    <main className="bg-[#0A0A0A]">
      <link rel="preload" href="/api/feed/pool" as="fetch" crossOrigin="anonymous" />
      <Suspense fallback={<StateMessage title="Loading feed…" />}>
        <FeedScreen />
      </Suspense>
    </main>
  );
}
