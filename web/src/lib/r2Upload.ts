import type { MaskRecordingPayload } from '@/types/avatar';
import type { ExpiryTier, PrivacyMode, RecordedSnapPayload } from '@/types/privacy';
import type { MotionTrackFile } from '@/types/social';

/** A finished clip, in either of the two shapes the camera produces. */
export type MediaInput =
  | { kind: 'mask'; payload: MaskRecordingPayload }
  | { kind: 'snap'; payload: RecordedSnapPayload };

export type UploadedMedia = { mediaUrl: string; motionUrl: string | null };

export type UploadFile = { blob: Blob; contentType: string; fileName: string };
type Upload = UploadFile;
type Presigned = { uploadUrl: string; key: string; publicUrl?: string };

/** Tells the two payload shapes apart: only a 3D mask recording carries motion frames. */
export function toMediaInput(payload: RecordedSnapPayload | MaskRecordingPayload): MediaInput {
  return 'frames' in payload ? { kind: 'mask', payload } : { kind: 'snap', payload };
}

/** The post / message columns that describe how the clip was made. */
export function describeMedia(input: MediaInput): { mode: PrivacyMode; avatarId: MaskRecordingPayload['avatarId'] | null; durationSec: number } {
  return input.kind === 'mask'
    ? { mode: 'mask', avatarId: input.payload.avatarId, durationSec: Math.max(0, Math.round(input.payload.durationSec)) }
    : { mode: input.payload.mode, avatarId: null, durationSec: Math.max(0, Math.round(input.payload.durationSec)) };
}

function planFiles(input: MediaInput): { media: Upload; motion: Upload | null } {
  if (input.kind === 'mask') {
    const { payload } = input;
    const audioType = payload.audioBlob.type || 'audio/webm';
    const track: MotionTrackFile = { fps: payload.fps, avatarId: payload.avatarId, frames: payload.frames };
    return {
      media: { blob: payload.audioBlob, contentType: audioType, fileName: audioType.includes('mp4') ? 'voice.mp4' : 'voice.webm' },
      motion: { blob: new Blob([JSON.stringify(track)], { type: 'application/json' }), contentType: 'application/json', fileName: 'motion.json' },
    };
  }
  const { payload } = input;
  const videoType = payload.mimeType || payload.blob.type || 'video/webm';
  return { media: { blob: payload.blob, contentType: videoType, fileName: videoType.includes('mp4') ? 'snap.mp4' : 'snap.webm' }, motion: null };
}

async function presign(token: string, file: Upload, expiryTier: ExpiryTier, purpose: 'post' | 'snap'): Promise<Presigned> {
  const response = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileName: file.fileName, contentType: file.contentType, fileSize: file.blob.size, expiryTier, purpose }),
  });
  const body = (await response.json().catch(() => null)) as (Presigned & { error?: string }) | null;
  if (!response.ok || !body?.uploadUrl || !body.key || (purpose === 'post' && !body.publicUrl)) throw new Error(body?.error ?? 'Could not prepare the upload.');
  return body;
}

/** XHR rather than fetch, because only XHR reports upload progress. */
function putFile(url: string, file: Upload, onBytes: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.contentType); // must match what was signed
    xhr.setRequestHeader('Cache-Control', 'public, max-age=31536000, immutable');
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file.blob);
  });
}

/**
 * Uploads files to Cloudflare R2 through presigned URLs and reports 0..1 across all of them.
 * `expiryTier` picks the key prefix that the bucket's lifecycle rule deletes on schedule.
 */
export async function uploadFiles(token: string, files: Upload[], purpose: 'post' | 'snap', expiryTier: ExpiryTier, onProgress?: (fraction: number) => void): Promise<Presigned[]> {
  const totalBytes = files.reduce((sum, f) => sum + f.blob.size, 0) || 1;
  const sent = new Map<Upload, number>();
  const report = () => onProgress?.(Math.min(1, [...sent.values()].reduce((a, b) => a + b, 0) / totalBytes));
  report();

  const targets = await Promise.all(files.map((f) => presign(token, f, expiryTier, purpose)));
  await Promise.all(
    files.map((file, i) =>
      putFile(targets[i].uploadUrl, file, (loaded) => {
        sent.set(file, loaded);
        report();
      }),
    ),
  );
  return targets;
}

/** Uploads a clip (and the motion track of a 3D mask). */
async function upload(token: string, input: MediaInput, purpose: 'post' | 'snap', expiryTier: ExpiryTier, onProgress?: (fraction: number) => void): Promise<Presigned[]> {
  const { media, motion } = planFiles(input);
  return uploadFiles(token, motion ? [media, motion] : [media], purpose, expiryTier, onProgress);
}

export async function uploadMedia(token: string, input: MediaInput, expiryTier: ExpiryTier, onProgress?: (fraction: number) => void): Promise<UploadedMedia> {
  const [media, motion] = await upload(token, input, 'post', expiryTier, onProgress);
  if (!media.publicUrl) throw new Error('Missing public media URL.');
  return { mediaUrl: media.publicUrl, motionUrl: motion?.publicUrl ?? null };
}

export async function uploadPrivateSnap(token: string, input: MediaInput, onProgress?: (fraction: number) => void) {
  const [media, motion] = await upload(token, input, 'snap', '1d', onProgress);
  return { r2Key: media.key, motionR2Key: motion?.key ?? null };
}
