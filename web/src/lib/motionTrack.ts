import { fetchMotionTrack, validateMotionTrack } from './mocap/motionCodec.ts';
import type { MotionTrackFile } from '@/types/social';

/** Checks a downloaded motion file. It came from another user, so nothing is trusted: bad data returns null. */
export function parseMotionTrack(raw: unknown): MotionTrackFile | null {
  return validateMotionTrack(raw);
}

/** Downloads, decompresses, and validates a motion track once per URL. */
export function loadMotionTrack(url: string): Promise<MotionTrackFile | null> {
  return fetchMotionTrack(url);
}
