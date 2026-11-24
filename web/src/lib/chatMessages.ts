import type { PrivacyMode } from '../types/privacy.ts';

import type { ServerStatus } from '../types/chat.ts';

export type DeliveryStatus = 'queued_offline' | 'sending' | 'failed' | ServerStatus;

/** A row of the `messages` table, as the server stores and broadcasts it. */
export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: 'text' | 'snap' | 'story_reply' | 'system_alert';
  client_msg_id?: string;
  r2_key?: string | null;
  motion_r2_key?: string | null;
  view_count?: number;
  max_views?: number;
  replayed_by_recipient?: boolean;
  is_saved?: boolean;
  status?: ServerStatus;
  content: string | null;
  snap_mode: PrivacyMode | null;
  avatar_id: string | null;
  media_url: string | null;
  motion_url: string | null;
  story_id: string | null;
  viewed_at: string | null;
  expires_at: string | null;
  created_at: string;
};

/** A message as the screen shows it: the row plus whether it has reached the server. */
export type ChatMessage = Omit<MessageRow, 'status'> & { status: DeliveryStatus };

const byTime = (a: ChatMessage, b: ChatMessage): number => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);

/**
 * Folds server rows into the list. A row replaces the local copy with the same id (so a message that was
 * "sending" becomes "sent" and takes the server's timestamp); messages that exist only locally stay;
 * the result is oldest first.
 */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly MessageRow[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>(current.map((m) => [m.id, m]));
  for (const row of incoming) byId.set(row.id, { ...row, status: row.status ?? 'sent' });
  return [...byId.values()].sort(byTime);
}

/** Applies a change to one message (a snap being opened). Unknown ids are ignored: a change never invents a message. */
export function applyMessageUpdate(current: readonly ChatMessage[], row: MessageRow): ChatMessage[] {
  return current.map((m) => (m.id === row.id ? { ...row, status: row.status ?? m.status } : m));
}

/** Changes one message's delivery status. */
export function setDeliveryStatus(current: readonly ChatMessage[], id: string, status: DeliveryStatus): ChatMessage[] {
  return current.map((m) => (m.id === id ? { ...m, status } : m));
}
