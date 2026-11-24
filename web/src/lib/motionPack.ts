import type { MotionFrame } from '@/types/avatar';

/** Capture and playback rate. Playback indexes frames as `time * fps`, so frames must be evenly spaced at this rate. */
export const MOTION_FPS = 30;

/** Which frame to show at `timeSec`. Clamped, so a looping or overshooting audio clock can never index out of range. */
export function frameIndexAt(timeSec: number, fps: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return Math.min(frameCount - 1, Math.max(0, Math.floor(timeSec * fps)));
}

/** Exact gzip size in bytes. Falls back to the raw UTF-8 size where `CompressionStream` is missing (older Safari). */
export async function gzipSizeBytes(text: string): Promise<number> {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(text).length;
  const reader = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')).getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
  }
}

/** Size of the motion track as it would be uploaded (gzipped JSON), in kilobytes with one decimal. */
export async function measureMotionKB(frames: MotionFrame[]): Promise<number> {
  const bytes = await gzipSizeBytes(JSON.stringify(frames));
  return Math.round((bytes / 1024) * 10) / 10;
}
