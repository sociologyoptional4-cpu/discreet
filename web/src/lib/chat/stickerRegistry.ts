/** Avatar stickers (persisted chat messages) and live avatar actions (Realtime Broadcast only, never stored). */
import type { AvatarId } from '../../types/avatar.ts';

const AVATARS: readonly AvatarId[] = ['cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot'];
const isAvatar = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

export const STICKER_IDS = ['peek', 'wave', 'heart_burst', 'laugh', 'angry_stomp', 'sleepy', 'duo_run', 'knock'] as const;
export type StickerId = (typeof STICKER_IDS)[number];
export const isStickerId = (v: unknown): v is StickerId => typeof v === 'string' && (STICKER_IDS as readonly string[]).includes(v);

/** `mood` picks the clay face of the built-in fallback; `prop` is the emoji the character holds. */
export const STICKERS: Record<StickerId, { label: string; prop: string; mood: 'joy' | 'angry' | 'surprised' | 'sad' | 'chill'; motion: 'peek' | 'wave' | 'bounce' | 'shake' | 'sway' | 'run' | 'knock' }> = {
  peek: { label: 'Peek', prop: '👀', mood: 'surprised', motion: 'peek' },
  wave: { label: 'Wave', prop: '👋', mood: 'joy', motion: 'wave' },
  heart_burst: { label: 'Heart', prop: '💖', mood: 'joy', motion: 'bounce' },
  laugh: { label: 'LOL', prop: '😂', mood: 'joy', motion: 'shake' },
  angry_stomp: { label: 'Stomp', prop: '💢', mood: 'angry', motion: 'shake' },
  sleepy: { label: 'Sleepy', prop: '💤', mood: 'chill', motion: 'sway' },
  duo_run: { label: 'Zoom', prop: '💨', mood: 'joy', motion: 'run' },
  knock: { label: 'Knock', prop: '✊', mood: 'surprised', motion: 'knock' },
};

/** Where a rendered clip lives: `public/stickers/<avatar>/<action>.webp`, or the same path under the R2 public URL. */
export function stickerUrl(avatarId: AvatarId, stickerId: StickerId, base: string | undefined): string {
  const root = base ? `${base.replace(/\/+$/, '')}/stickers` : '/stickers';
  return `${root}/${avatarId}/${stickerId}.webp`;
}

export type StickerPayload = { stickerId: StickerId; avatarId: AvatarId; label: string };

export const encodeSticker = (stickerId: StickerId, avatarId: AvatarId): string => JSON.stringify({ stickerId, avatarId, label: STICKERS[stickerId].label });

/** Message content from the database is untrusted: unknown stickers or avatars give null. */
export function parseSticker(content: string | null): StickerPayload | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== 'object' || value === null) return null;
    const { stickerId, avatarId } = value as Record<string, unknown>;
    if (!isStickerId(stickerId) || !isAvatar(avatarId)) return null;
    return { stickerId, avatarId, label: STICKERS[stickerId].label };
  } catch {
    return null;
  }
}

export const AVATAR_ACTIONS = ['poke_knock', 'send_heart', 'duo_dance', 'high_five', 'wave', 'chill'] as const;
export type AvatarAction = (typeof AVATAR_ACTIONS)[number];
export const isAvatarAction = (v: unknown): v is AvatarAction => typeof v === 'string' && (AVATAR_ACTIONS as readonly string[]).includes(v);

export const ACTION_META: Record<AvatarAction, { label: string; emoji: string }> = {
  poke_knock: { label: 'Poke', emoji: '👋' },
  send_heart: { label: 'Heart', emoji: '💖' },
  duo_dance: { label: 'Duo Dance', emoji: '🕺' },
  high_five: { label: 'High-Five', emoji: '🙌' },
  wave: { label: 'Wave', emoji: '👋' },
  chill: { label: 'Chill', emoji: '😌' },
};
export const LIVE_ACTIONS: readonly AvatarAction[] = ['poke_knock', 'send_heart', 'duo_dance', 'high_five'];
export const ROOM_EMOTES: readonly AvatarAction[] = ['wave', 'high_five', 'duo_dance', 'chill'];

export type AvatarActionEvent = { action: AvatarAction; from: string; at: number };

export function parseActionEvent(payload: unknown): AvatarActionEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { action, from, at } = payload as Record<string, unknown>;
  if (!isAvatarAction(action) || typeof from !== 'string' || typeof at !== 'number') return null;
  return { action, from, at };
}
