'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StateMessage } from '@/components/StateMessage';
import { fetchOwnProfile } from '@/lib/feedData';

/** `/profile` has no handle: send the visitor to their own profile. */
export function ProfileIndexRedirect() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOwnProfile()
      .then((own) => {
        if (!alive) return;
        if (own) router.replace(`/profile/${own.username}`);
        else setFailed(true);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [router]);

  if (failed) return <StateMessage title="Couldn’t open your profile" action={{ href: '/feed', label: 'Back to the feed' }} />;
  return <StateMessage title="Opening your profile…" />;
}
