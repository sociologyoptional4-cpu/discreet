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
