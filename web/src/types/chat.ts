import type { MediaInput } from '@/lib/r2Upload';
import type { MessageRow } from '@/lib/chatMessages';

export type ServerStatus = 'sent' | 'delivered' | 'opened' | 'expired' | 'saved';
export type Retention = 'after_viewing' | '24h';
export type StreakStatus = 'active' | 'expiring_soon' | 'expired';
export type ChatMeta = {
  retention_mode: Retention;
  streak_count: number;
  streak_updated_at: string | null;
};
export type SnapView = { url: string; motionUrl: string | null; viewCount: number; replayed: boolean; expiresIn: number };
export type Outgoing = {
  row: MessageRow;
  input?: MediaInput;
  keys?: { r2Key: string; motionR2Key: string | null };
  attempts: number;
  retryAt: number;
};

export type ChatParticipant = {
  id: string;
  username: string;
  avatarId: string;
  avatarUrl: string | null;
  vibeLevel: number;
};

/** One inbox row from `GET /api/chats`. */
export type ConversationSummary = {
  id: string;
  status: 'pending' | 'accepted';
  /** A request somebody else sent to the viewer, still waiting for their answer. */
  incoming: boolean;
  participant: ChatParticipant;
  lastMessageText: string | null;
  lastMessageAt: string;
  unreadCount: number;
};

export type SharedPostPreview = {
  id: string;
  thumbnail_url: string | null;
  caption: string | null;
  post_format: 'video' | 'image' | 'recipe_avatar' | 'recipe_shayari' | 'living_post';
};

/** A message as the chat API returns it. Not the same as the row-shaped `ChatMessage` the live thread screen keeps. */
export type ApiChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageRow['type'];
  body: string | null;
  sharedPostId: string | null;
  sharedPost: SharedPostPreview | null;
  createdAt: string;
};
