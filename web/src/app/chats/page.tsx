import type { Metadata } from 'next';
import { ChatsScreen } from '@/components/ChatsScreen';

export const metadata: Metadata = { title: 'Chats' };

export default function ChatsPage() {
  return (
    <main className="bg-[#0A0A0A]">
      <ChatsScreen />
    </main>
  );
}
