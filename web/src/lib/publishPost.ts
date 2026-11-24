import { describeMedia, uploadMedia, type MediaInput } from '@/lib/r2Upload';
import { demoAddPost } from '@/lib/demoData';
import { ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';
import type { ExpiryTier } from '@/types/privacy';

export type PublishInput = MediaInput & { expiryTier: ExpiryTier; isIncog: boolean };

/** Called with 0..1 as bytes leave the phone. The last 5% is the database write. */
export type ProgressHandler = (fraction: number) => void;

const UPLOAD_SHARE = 0.95;
const ALIAS_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `Anon_` plus five unambiguous characters, from the browser's secure random source. */
export function randomIncogAlias(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `Anon_${Array.from(bytes, (b) => ALIAS_CHARS[b % ALIAS_CHARS.length]).join('')}`;
}

/**
 * Uploads the clip to R2, inserts the `posts` row, and starts transcription in the background.
 * Incog posts are always 1 day and carry a random `Anon_XXXXX` alias; the database enforces both again.
 */
export async function publishPost(input: PublishInput, onProgress?: ProgressHandler): Promise<{ postId: string }> {
  if (isDemoMode) {
    // Demo: nothing is uploaded. The clip is kept in memory (new object URLs, since the camera revokes its own) and shown in the feed.
    const { mode, avatarId, durationSec } = describeMedia(input);
    const mediaUrl = URL.createObjectURL(input.kind === 'mask' ? input.payload.audioBlob : input.payload.blob);
    const motion = input.kind === 'mask' ? { fps: input.payload.fps, avatarId: input.payload.avatarId, frames: input.payload.frames } : null;
    onProgress?.(1);
    return { postId: demoAddPost({ mode, avatarId, mediaUrl, motion, durationSec, isIncog: input.isIncog, alias: input.isIncog ? randomIncogAlias() : null }) };
  }
  const session = await ensureSession();
  const token = session.access_token;
  const expiryTier: ExpiryTier = input.isIncog ? '1d' : input.expiryTier;

  const uploaded = await uploadMedia(token, input, expiryTier, (fraction) => onProgress?.(fraction * UPLOAD_SHARE));
  const { mode, avatarId, durationSec } = describeMedia(input);

  const postId = crypto.randomUUID();
  const { error } = await supabase.from('posts').insert({
    id: postId,
    user_id: session.user.id,
    mode,
    avatar_id: avatarId,
    media_url: uploaded.mediaUrl,
    motion_url: uploaded.motionUrl,
    duration_sec: durationSec,
    is_incog: input.isIncog,
    incog_alias: input.isIncog ? randomIncogAlias() : null,
    expiry_tier: expiryTier,
  });
  if (error) {
    throw new Error(error.message.includes('permanent posts') ? 'Free accounts keep up to 5 permanent posts. Pick a shorter expiry.' : 'Could not publish your post. Try again.');
  }
  onProgress?.(1);

  // Fire and forget: the post is already live, the transcript and topic arrive a few seconds later. keepalive lets the
  // request finish even though the page navigates to /feed right away.
  void fetch('/api/process-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ postId, mediaUrl: uploaded.mediaUrl }),
    keepalive: true,
  }).catch(() => {});

  return { postId };
}
