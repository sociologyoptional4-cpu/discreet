import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChatsScreen } from '@/components/ChatsScreen';
import { StateMessage } from '@/components/StateMessage';

export const metadata: Metadata = { title: 'Chats' };

export default function ChatsPage() {
  return (
    <main className="relative mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-x-hidden bg-[#F2F4F7] text-[#111827] pb-28">
      <Suspense fallback={<StateMessage light title="Loading chats…" />}>
        <ChatsScreen />
      </Suspense>
    </main>
  );
}
