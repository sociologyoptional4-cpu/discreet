/** Pure helpers for the chat inbox: turn raw `conversations` rows into what the screens show. */

export type PersonRow = { id: string; username: string; avatar_id: string };
type Embedded = PersonRow | PersonRow[] | null;

export type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  status: 'pending' | 'accepted';
  initiator_id: string;
  request_note: string | null;
  last_message_at: string;
  a: Embedded;
  b: Embedded;
};

export type ConversationItem = {
  id: string;
  status: 'pending' | 'accepted';
  initiatorId: string;
  requestNote: string | null;
  lastMessageAt: string;
  /** The other person in the conversation. */
  other: { id: string; username: string; avatarId: string };
  /** A request somebody else sent to the viewer, waiting for their answer. */
  incoming: boolean;
};

const one = (value: Embedded): PersonRow | null => (Array.isArray(value) ? (value[0] ?? null) : value);

/** Null when the viewer is not in the conversation (which row-level security prevents anyway). */
export function toConversationItem(row: ConversationRow, viewerId: string): ConversationItem | null {
  if (row.user_a !== viewerId && row.user_b !== viewerId) return null;
  const otherId = row.user_a === viewerId ? row.user_b : row.user_a;
  const person = one(row.user_a === viewerId ? row.b : row.a);
  return {
    id: row.id,
    status: row.status,
    initiatorId: row.initiator_id,
    requestNote: row.request_note,
    lastMessageAt: row.last_message_at,
    other: { id: otherId, username: person?.username ?? 'unknown', avatarId: person?.avatar_id ?? 'cyber_monk' },
    incoming: row.status === 'pending' && row.initiator_id !== viewerId,
  };
}

/** Incoming requests (newest first) and accepted chats (most recent message first). */
export function splitConversations(items: readonly ConversationItem[]): { incoming: ConversationItem[]; accepted: ConversationItem[] } {
  const newestFirst = (a: ConversationItem, b: ConversationItem): number => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0);
  return {
    incoming: items.filter((c) => c.incoming).sort(newestFirst),
    accepted: items.filter((c) => c.status === 'accepted').sort(newestFirst),
  };
}
