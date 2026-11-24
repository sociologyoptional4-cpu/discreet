import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { isAvatarId } from '../avatars.ts';
import { demoMotion, isDemoUrl } from '../demoData.ts';
import type { MotionFrame } from '@/types/avatar';
import type { MotionTrackFile } from '@/types/social';

export const CODEC_FPS = 30;
const MAX_FRAMES = 30 * 600;
const MAX_FPS = 120;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Strips near-zero blendshapes (< 0.01) and rounds floats to 3 decimals for minimal payload size. */
export function quantizeFrame(frame: MotionFrame): MotionFrame {
  const shapes: Record<string, number> = {};
  for (const [k, v] of Object.entries(frame.shapes)) {
    if (Math.abs(v) >= 0.01) shapes[k] = round3(v);
  }
  const out: MotionFrame = {
    t: round3(frame.t),
    head: [round3(frame.head[0]), round3(frame.head[1]), round3(frame.head[2])],
    shapes,
  };
  if (frame.leftHand) out.leftHand = [round3(frame.leftHand[0]), round3(frame.leftHand[1]), round3(frame.leftHand[2])];
  if (frame.rightHand) out.rightHand = [round3(frame.rightHand[0]), round3(frame.rightHand[1]), round3(frame.rightHand[2])];
  return out;
}

/** Encodes a motion track into gzipped bytes using `fflate` (works synchronously in all browsers). */
export function encodeMotionTrackGzip(track: MotionTrackFile): Uint8Array {
  const compact: MotionTrackFile = {
    fps: track.fps,
    avatarId: track.avatarId,
    frames: track.frames.map(quantizeFrame),
  };
  return gzipSync(strToU8(JSON.stringify(compact)), { level: 6 });
}

/** Decodes either gzipped (`Uint8Array`) or plain JSON motion track payloads. */
export function decodeMotionTrackBytes(bytes: Uint8Array): MotionTrackFile | null {
  try {
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const jsonStr = strFromU8(isGzip ? gunzipSync(bytes) : bytes);
    return validateMotionTrack(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

function isTriple(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function validateMotionTrack(raw: unknown): MotionTrackFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { fps, avatarId, frames } = raw as Record<string, unknown>;
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) return null;
  if (!isAvatarId(avatarId) || !Array.isArray(frames) || frames.length === 0 || frames.length > MAX_FRAMES) return null;
  const parsed: MotionFrame[] = [];
  for (const f of frames) {
    if (typeof f !== 'object' || f === null) return null;
    const item = f as Record<string, unknown>;
    if (typeof item.t !== 'number' || !Number.isFinite(item.t) || !isTriple(item.head) || typeof item.shapes !== 'object' || item.shapes === null) {
      return null;
    }
    const shapes: Record<string, number> = {};
    for (const [k, v] of Object.entries(item.shapes)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      shapes[k] = v;
    }
    const frame: MotionFrame = { t: item.t, head: item.head, shapes };
    if (item.leftHand !== undefined) {
      if (!isTriple(item.leftHand)) return null;
      frame.leftHand = item.leftHand;
    }
    if (item.rightHand !== undefined) {
      if (!isTriple(item.rightHand)) return null;
      frame.rightHand = item.rightHand;
    }
    parsed.push(frame);
  }
  return { fps, avatarId, frames: parsed };
}

/** Binary search + linear interpolation strictly synchronized to `audio.currentTime`. */
export function sampleMotionFrameAt(frames: readonly MotionFrame[], timeSec: number, fps = CODEC_FPS): MotionFrame | null {
  if (frames.length === 0) return null;
  if (timeSec <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (timeSec >= last.t) return last;

  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= timeSec) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t;
  const alpha = span > 1e-5 ? Math.min(1, Math.max(0, (timeSec - a.t) / span)) : Math.min(1, Math.max(0, timeSec * fps - lo));

  const lerp = (x: number, y: number) => x + (y - x) * alpha;
  const shapes: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.shapes), ...Object.keys(b.shapes)])) {
    const w = lerp(a.shapes[k] ?? 0, b.shapes[k] ?? 0);
    if (Math.abs(w) >= 0.005) shapes[k] = w;
  }

  const lerpTriple = (t1?: [number, number, number], t2?: [number, number, number]): [number, number, number] | undefined => {
    if (!t1 && !t2) return undefined;
    const p1 = t1 ?? t2!;
    const p2 = t2 ?? t1!;
    return [lerp(p1[0], p2[0]), lerp(p1[1], p2[1]), lerp(p1[2], p2[2])];
  };

  return {
    t: timeSec,
    head: [lerp(a.head[0], b.head[0]), lerp(a.head[1], b.head[1]), lerp(a.head[2], b.head[2])],
    shapes,
    leftHand: lerpTriple(a.leftHand, b.leftHand),
    rightHand: lerpTriple(a.rightHand, b.rightHand),
  };
}

const trackCache = new Map<string, Promise<MotionTrackFile | null>>();

/** Downloads, decompresses, and caches a motion track with optional AbortSignal prefetching. */
export function fetchMotionTrack(url: string, signal?: AbortSignal): Promise<MotionTrackFile | null> {
  if (isDemoUrl(url)) return Promise.resolve(demoMotion(url));
  const ephemeral = url.startsWith('blob:') || /[?&]X-Amz-Signature=/i.test(url);
  let pending = ephemeral ? undefined : trackCache.get(url);
  if (!pending) {
    pending = fetch(url, { signal })
      .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
      .then((buf) => (buf ? decodeMotionTrackBytes(buf) : null))
      .catch(() => null)
      .then((track) => {
        if (!track) trackCache.delete(url);
        return track;
      });
    if (!ephemeral) {
      if (trackCache.size >= 24) {
        const first = trackCache.keys().next();
        if (!first.done) trackCache.delete(first.value);
      }
      trackCache.set(url, pending);
    }
  }
  return pending;
}
