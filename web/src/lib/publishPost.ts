import { NonRetryableError } from '@/lib/media/optimisticUpload';
import { describeMedia, uploadFiles, uploadMedia, type MediaInput } from '@/lib/r2Upload';
import { demoAddPost } from '@/lib/demoData';
import { ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';
import type { ExpiryTier, PrivacyMode } from '@/types/privacy';

export type PublishInput = MediaInput & { expiryTier: ExpiryTier; isIncog: boolean; topic?: string | null };

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
export function resolvePostTopic(topic: string | null | undefined): string | null {
  const routeTopic = typeof window !== 'undefined' && window.location.pathname === '/record'
    ? new URLSearchParams(window.location.search).get('topic')
    : null;
  return (topic ?? routeTopic)?.trim().slice(0, 160) || null;
}

export async function publishPost(input: PublishInput, onProgress?: ProgressHandler): Promise<{ postId: string }> {
  const topic = resolvePostTopic(input.topic);
  if (isDemoMode) {
    // Demo: nothing is uploaded. The clip is kept in memory (new object URLs, since the camera revokes its own) and shown in the feed.
    const { mode, avatarId, durationSec } = describeMedia(input);
    const mediaUrl = URL.createObjectURL(input.kind === 'mask' ? input.payload.audioBlob : input.payload.blob);
    const motion = input.kind === 'mask' ? { fps: input.payload.fps, avatarId: input.payload.avatarId, frames: input.payload.frames } : null;
    onProgress?.(1);
    return { postId: demoAddPost({ topic, mode, avatarId, mediaUrl, motion, durationSec, isIncog: input.isIncog, alias: input.isIncog ? randomIncogAlias() : null }) };
  }
  const session = await ensureSession();
  const token = session.access_token;
  const expiryTier: ExpiryTier = input.isIncog ? '1d' : input.expiryTier;

  const uploaded = await uploadMedia(token, input, expiryTier, (fraction) => onProgress?.(fraction * UPLOAD_SHARE));
  const { mode, avatarId, durationSec } = describeMedia(input);

  const postId = safeRandomUUID();
  const { error } = await supabase.from('posts').insert({
    id: postId,
    user_id: session.user.id,
    mode,
    topic_entity: topic,
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

/** What a queued video post needs besides the file itself. Plain data, so it can be saved to IndexedDB. */
export type ProcessedPostMeta = { mode: PrivacyMode; durationSec: number; topic: string | null; expiryTier: ExpiryTier; isIncog: boolean };

const POSTGRES_DUPLICATE_KEY = '23505';
const POSTGRES_INSUFFICIENT_PRIVILEGE = '42501';

const extensionFor = (type: string, fallback: string): string => (type.includes('webm') ? 'webm' : type.includes('webp') ? 'webp' : type.includes('jpeg') ? 'jpg' : fallback);

/**
 * Publishes an already-processed clip: uploads it and its thumbnail, then inserts the post under the job's own id.
 * Safe to run again after a crash or a retry: a post that already exists counts as published, and a database that
 * does not yet allow `thumbnail_url` (supabase/video_pipeline_module2.sql not run) still gets the post, just without it.
 */
export async function publishProcessedVideo(
  job: { postId: string; video: Blob; thumbnail: Blob | null; meta: ProcessedPostMeta },
  onProgress?: ProgressHandler,
): Promise<{ postId: string }> {
  const session = await ensureSession();
  const token = session.access_token;
  const { meta } = job;
  const expiryTier: ExpiryTier = meta.isIncog ? '1d' : meta.expiryTier;

  const videoType = job.video.type || 'video/mp4';
  const files = [{ blob: job.video, contentType: videoType, fileName: `snap.${extensionFor(videoType, 'mp4')}` }];
  if (job.thumbnail) files.push({ blob: job.thumbnail, contentType: job.thumbnail.type || 'image/webp', fileName: `thumb.${extensionFor(job.thumbnail.type, 'webp')}` });
  let targets;
  try {
    targets = await uploadFiles(token, files, 'post', expiryTier, (fraction) => onProgress?.(fraction * UPLOAD_SHARE));
  } catch (error) {
    // A 4xx from the presign step (type or size not allowed) will not improve with retries.
    if (error instanceof Error && /^Invalid media upload\.?$/.test(error.message)) throw new NonRetryableError(error.message);
    throw error;
  }
  const mediaUrl = targets[0].publicUrl;
  if (!mediaUrl) throw new Error('Missing public media URL.');

  const row: Record<string, unknown> = {
    id: job.postId,
    user_id: session.user.id,
    mode: meta.mode,
    topic_entity: meta.topic,
    avatar_id: null,
    media_url: mediaUrl,
    motion_url: null,
    duration_sec: Math.max(0, Math.round(meta.durationSec)),
    is_incog: meta.isIncog,
    incog_alias: meta.isIncog ? randomIncogAlias() : null,
    expiry_tier: expiryTier,
  };
  const thumbnailUrl = targets[1]?.publicUrl ?? null;
  let { error } = await supabase.from('posts').insert(thumbnailUrl ? { ...row, thumbnail_url: thumbnailUrl } : row);
  if (error?.code === POSTGRES_INSUFFICIENT_PRIVILEGE && thumbnailUrl) ({ error } = await supabase.from('posts').insert(row));
  if (error && error.code !== POSTGRES_DUPLICATE_KEY) {
    if (error.message.includes('permanent posts')) throw new NonRetryableError('Free accounts keep up to 5 permanent posts. Pick a shorter expiry.');
    throw new Error('Could not publish your post. Try again.');
  }
  onProgress?.(1);

  void fetch('/api/process-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ postId: job.postId, mediaUrl }),
    keepalive: true,
  }).catch(() => {});
  return { postId: job.postId };
}
