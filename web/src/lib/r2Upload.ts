import type { MaskRecordingPayload } from '@/types/avatar';
import type { ExpiryTier, PrivacyMode, RecordedSnapPayload } from '@/types/privacy';
import type { MotionTrackFile } from '@/types/social';

/** A finished clip, in either of the two shapes the camera produces. */
export type MediaInput =
  | { kind: 'mask'; payload: MaskRecordingPayload }
  | { kind: 'snap'; payload: RecordedSnapPayload };

export type UploadedMedia = { mediaUrl: string; motionUrl: string | null };

type Upload = { blob: Blob; contentType: string; fileName: string };
type Presigned = { uploadUrl: string; publicUrl: string };

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

async function presign(token: string, file: Upload, expiryTier: ExpiryTier): Promise<Presigned> {
  const response = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileName: file.fileName, contentType: file.contentType, expiryTier }),
  });
  const body = (await response.json().catch(() => null)) as (Presigned & { error?: string }) | null;
  if (!response.ok || !body?.uploadUrl) throw new Error(body?.error ?? 'Could not prepare the upload.');
  return body;
}

/** XHR rather than fetch, because only XHR reports upload progress. */
function putFile(url: string, file: Upload, onBytes: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.contentType); // must match what was signed
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file.blob);
  });
}

/**
 * Uploads a clip (and the motion track of a 3D mask) to Cloudflare R2 through presigned URLs.
 * `expiryTier` picks the key prefix that the bucket's lifecycle rule deletes on schedule.
 * `onProgress` receives 0..1 across all files.
 */
export async function uploadMedia(token: string, input: MediaInput, expiryTier: ExpiryTier, onProgress?: (fraction: number) => void): Promise<UploadedMedia> {
  const { media, motion } = planFiles(input);
  const files = motion ? [media, motion] : [media];
  const totalBytes = files.reduce((sum, f) => sum + f.blob.size, 0) || 1;
  const sent = new Map<Upload, number>();
  const report = () => onProgress?.(Math.min(1, [...sent.values()].reduce((a, b) => a + b, 0) / totalBytes));
  report();

  const targets = await Promise.all(files.map((f) => presign(token, f, expiryTier)));
  await Promise.all(
    files.map((file, i) =>
      putFile(targets[i].uploadUrl, file, (loaded) => {
        sent.set(file, loaded);
        report();
      }),
    ),
  );
  return { mediaUrl: targets[0].publicUrl, motionUrl: motion ? targets[1].publicUrl : null };
}
