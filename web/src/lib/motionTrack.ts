import { isAvatarId } from './avatars.ts';
import { demoMotion, isDemoUrl } from './demoData.ts';
import type { MotionFrame } from '@/types/avatar';
import type { MotionTrackFile } from '@/types/social';

const MAX_FRAMES = 30 * 600; // ten minutes at 30 FPS
const MAX_FPS = 120;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTriple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNumber);

function parseFrame(raw: unknown): MotionFrame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (!isNumber(f.t) || !isTriple(f.head) || typeof f.shapes !== 'object' || f.shapes === null) return null;
  const shapes: Record<string, number> = {};
  for (const [name, weight] of Object.entries(f.shapes)) {
    if (!isNumber(weight)) return null;
    shapes[name] = weight;
  }
  const frame: MotionFrame = { t: f.t, head: f.head, shapes };
  if (f.leftHand !== undefined) { if (!isTriple(f.leftHand)) return null; frame.leftHand = f.leftHand; }
  if (f.rightHand !== undefined) { if (!isTriple(f.rightHand)) return null; frame.rightHand = f.rightHand; }
  return frame;
}

/** Checks a downloaded motion file. It came from another user, so nothing is trusted: bad data returns null. */
export function parseMotionTrack(raw: unknown): MotionTrackFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { fps, avatarId, frames } = raw as Record<string, unknown>;
  if (!isNumber(fps) || fps <= 0 || fps > MAX_FPS || !isAvatarId(avatarId)) return null;
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_FRAMES) return null;
  const parsed: MotionFrame[] = [];
  for (const f of frames) {
    const frame = parseFrame(f);
    if (!frame) return null;
    parsed.push(frame);
  }
  return { fps, avatarId, frames: parsed };
}

const cache = new Map<string, Promise<MotionTrackFile | null>>();

/** Downloads and validates a motion track once per URL; a failed download is not cached so it can be retried. */
export function loadMotionTrack(url: string): Promise<MotionTrackFile | null> {
  if (isDemoUrl(url)) return Promise.resolve(demoMotion(url));
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then(parseMotionTrack)
      .catch(() => null)
      .then((track) => {
        if (!track) cache.delete(url);
        return track;
      });
    cache.set(url, pending);
  }
  return pending;
}
