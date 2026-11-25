import { NextRequest } from 'next/server';
import { authenticate, json } from '@/lib/server/request';
import { toParticipant } from '@/lib/server/chatApi';
import type { ConversationSummary } from '@/types/chat';

/** The signed-in user's conversations, newest message first, each with the other person and an unread count. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.client
    .from('conversations')
    .select('*, a:users!user_a(*), b:users!user_b(*)')
    .order('last_message_at', { ascending: false });
  if (error) return json({ error: 'Could not load your chats.' }, 503);

  const conversations: ConversationSummary[] = (data ?? []).map((row) => {
    const mineIsA = row.user_a === auth.userId;
    const other = mineIsA ? row.b : row.a;
    return {
      id: row.id,
      status: row.status,
      incoming: row.status === 'pending' && row.initiator_id !== auth.userId,
      participant: toParticipant(Array.isArray(other) ? other[0] : other),
      lastMessageText: row.last_message_text ?? null,
      lastMessageAt: row.last_message_at,
      unreadCount: (mineIsA ? row.user_a_unread : row.user_b_unread) ?? 0,
    };
  });
  return json({ conversations });
}
