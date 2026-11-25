import { toConversationItem, type ConversationItem, type ConversationRow } from '@/lib/conversations';
import { ensureSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';

// `*` rather than a column list, so databases without the newest columns (last_message_text) still load.
const COLUMNS = '*, a:users!user_a(id, username, avatar_id), b:users!user_b(id, username, avatar_id)';
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

/** Starts a conversation request; AI & demo creators auto-accept immediately via /api/chats/start so chat opens right away. */
export async function requestConversation(viewerId: string, otherId: string, note: string): Promise<string> {
  try {
    const session = await ensureSession();
    const res = await fetch('/api/chats/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ otherId, note }),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      if (data.id) return data.id;
    }
  } catch {
    // fall through to direct insert
  }

  const existing = await findConversationWith(viewerId, otherId);
  if (existing) return existing.id;

  const id = safeRandomUUID();
  const { error } = await supabase.from('conversations').insert({
    id,
    user_a: viewerId,
    user_b: otherId,
    initiator_id: viewerId,
    request_note: note.trim().slice(0, REQUEST_NOTE_MAX),
  });
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

export type SuggestedCreator = { id: string; username: string; avatarId: string };

/** Popular creators to wave at, for an empty inbox. Excludes the viewer and anyone already in a chat with them. */
export async function fetchSuggestedCreators(viewerId: string, exclude: readonly string[]): Promise<SuggestedCreator[]> {
  const { data, error } = await supabase.from('users').select('id, username, avatar_id').neq('id', viewerId).order('followers_count', { ascending: false }).limit(12);
  if (error) throw new Error('Could not load suggestions.');
  return (data as { id: string; username: string; avatar_id: string }[])
    .filter((u) => !exclude.includes(u.id))
    .map((u) => ({ id: u.id, username: u.username, avatarId: u.avatar_id }));
}

/** Opens (or creates) the conversation with a creator by @handle, for `/chats?to=<username>` links. */
export async function startChatWith(username: string): Promise<string> {
  const session = await ensureSession();
  const response = await fetch('/api/chats/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
  if (!response.ok || !body?.id) throw new Error(body?.error ?? 'Could not open this chat.');
  return body.id;
}
