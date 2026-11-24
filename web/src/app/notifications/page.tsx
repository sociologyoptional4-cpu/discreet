import type { Metadata } from 'next';
import { NotificationsView } from '@/components/NotificationsView';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <main className="bg-[#0A0A0A]">
      <NotificationsView />
    </main>
  );
}
