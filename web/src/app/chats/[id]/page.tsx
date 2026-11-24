import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChatThreadScreen } from '@/components/ChatThreadScreen';
import { StateMessage } from '@/components/StateMessage';

export const metadata: Metadata = { title: 'Chat', robots: { index: false } };

async function Thread({ params }: PageProps<'/chats/[id]'>) {
  const { id } = await params;
  return <ChatThreadScreen conversationId={id} />;
}

export default function ChatThreadPage(props: PageProps<'/chats/[id]'>) {
  return (
    <main className="bg-[#0A0A0A]">
      <Suspense fallback={<StateMessage title="Loading chat…" />}>
        <Thread {...props} />
      </Suspense>
    </main>
  );
}
