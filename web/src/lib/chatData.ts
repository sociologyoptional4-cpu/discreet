import { toConversationItem, type ConversationItem, type ConversationRow } from '@/lib/conversations';
import { supabase } from '@/lib/supabase';

const COLUMNS =
  'id, user_a, user_b, status, initiator_id, request_note, last_message_at, user_a_unread, user_b_unread, streak_count, streak_updated_at, a:users!user_a(id, username, avatar_id), b:users!user_b(id, username, avatar_id)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';

export const REQUEST_NOTE_MAX = 200;

/** Every conversation the viewer is in, most recent first. */
export async function fetchConversations(viewerId: string): Promise<ConversationItem[]> {
  const { data, error } = await supabase.from('conversations').select(COLUMNS).order('last_message_at', { ascending: false });
  if (error) throw new Error('Could not load your chats.');
  return (data as unknown as ConversationRow[]).map((row) => toConversationItem(row, viewerId)).filter((c): c is ConversationItem => c !== null);
}

export async function fetchConversation(id: string, viewerId: string): Promise<ConversationItem | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase.from('conversations').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error('Could not load this chat.');
  return data ? toConversationItem(data as unknown as ConversationRow, viewerId) : null;
}

/** The conversation between the viewer and one other person, whichever of them started it. */
export async function findConversationWith(viewerId: string, otherId: string): Promise<{ id: string; status: 'pending' | 'accepted'; initiatorId: string } | null> {
  if (!UUID.test(viewerId) || !UUID.test(otherId)) throw new Error('Invalid person.');
  const { data, error } = await supabase
    .from('conversations')
    .select('id, status, initiator_id')
    .or(`and(user_a.eq.${viewerId},user_b.eq.${otherId}),and(user_a.eq.${otherId},user_b.eq.${viewerId})`)
    .maybeSingle();
  if (error) throw new Error('Could not check your chats.');
  return data ? { id: data.id as string, status: data.status as 'pending' | 'accepted', initiatorId: data.initiator_id as string } : null;
}

/** Starts a pending request with a reason. Returns the new conversation's id; a request that already exists counts as done. */
export async function requestConversation(viewerId: string, otherId: string, note: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('conversations').insert({ id, user_a: viewerId, user_b: otherId, initiator_id: viewerId, request_note: note.trim().slice(0, REQUEST_NOTE_MAX) });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(error.message.includes('Too many') ? 'You have too many requests waiting for an answer.' : 'Could not send your request. Try again.');
  }
  return id;
}

export async function acceptConversation(id: string): Promise<void> {
  const { data, error } = await supabase.from('conversations').update({ status: 'accepted' }).eq('id', id).select('id');
  if (error || !data || data.length === 0) throw new Error('Could not accept this request.');
}

export async function declineConversation(id: string): Promise<void> {
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) throw new Error('Could not decline this request.');
}
