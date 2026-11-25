import type { Metadata } from 'next';
import { ProfileIndexRedirect } from '@/components/profile/ProfileIndexRedirect';

export const metadata: Metadata = { title: 'My profile', robots: { index: false } };

export default function ProfileIndexPage() {
  return (
    <main className="bg-[#0A0A0A]">
      <ProfileIndexRedirect />
    </main>
  );
}
