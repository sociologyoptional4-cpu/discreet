/**
 * Pure decisions for on-device video processing: what to do with a clip before it is uploaded. No browser APIs, no
 * dependencies, so it runs under `node --test` and can be copied to any project.
 */

export const OUTPUT_LIMITS = {
  /** Longest side of the *short* edge, like the app's other compressor: portrait 720x1280, landscape 1280x720. */
  maxShortSide: 720,
  fps: 30,
  videoBitrate: 2_200_000,
  audioBitrate: 96_000,
  keyFrameIntervalSec: 2,
  /** A fast-start MP4 this small is already cheap to ship; re-encoding it would only cost quality. */
  smallFileBytes: 2 * 1024 * 1024,
  /** A source within this multiple of the target bitrate is left alone (no re-encode). */
  bitrateTolerance: 1.25,
  /** Above this multiple a source is always re-encoded, even when it needs no resize. */
  bitrateForceMultiple: 1.5,
} as const;

export type Atom = { type: string; size: number; offset: number };

/** Top-level MP4 boxes found in `bytes` (the start of a file). Stops at the first malformed or incomplete box. */
export function readTopLevelAtoms(bytes: Uint8Array): Atom[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const atoms: Atom[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;
    if (size === 1) {
      if (offset + 16 > bytes.byteLength) break;
      size = Number(view.getBigUint64(offset + 8));
    } else if (size === 0) {
      size = bytes.byteLength - offset;
    }
    if (size < 8) break;
    atoms.push({ type, size, offset });
    offset += size;
  }
  return atoms;
}

/** True when the `moov` atom comes before `mdat` (the file can start playing, and be range-prefetched, from byte 0). */
export function isFastStartMp4(head: Uint8Array): boolean {
  const atoms = readTopLevelAtoms(head);
  if (atoms[0]?.type !== 'ftyp') return false;
  for (const atom of atoms) {
    if (atom.type === 'moov') return true;
    if (atom.type === 'mdat') return false;
  }
  return false;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Output size: never upscaled, aspect kept, both sides even (H.264 needs that). `changed` is true when it differs from the source. */
export function outputDimensions(width: number, height: number, maxShortSide: number = OUTPUT_LIMITS.maxShortSide): { width: number; height: number; changed: boolean } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const shortSide = Math.min(w, h);
  const scale = shortSide > maxShortSide ? maxShortSide / shortSide : 1;
  const outW = even(w * scale);
  const outH = even(h * scale);
  return { width: outW, height: outH, changed: outW !== w || outH !== h };
}

export interface SourceInfo {
  /** Lower-case container from the MIME type, for example `mp4`, `webm`, `quicktime`. */
  container: string;
  bytes: number;
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  fastStart: boolean;
}

export interface PlanRequest {
  trim?: boolean;
  watermark?: boolean;
}

export type ConversionPlan =
  | { action: 'bypass'; reason: 'already-optimal' }
  | { action: 'convert'; reason: string; resize: { width: number; height: number } | null; forceVideoTranscode: boolean };

export const sourceBitrate = (info: Pick<SourceInfo, 'bytes' | 'durationSec'>): number => (info.durationSec > 0 ? (info.bytes * 8) / info.durationSec : Infinity);

/**
 * Decides between uploading the clip as it is and converting it. The conversion always yields H.264 + AAC in an MP4
 * with the moov atom first; the video track is only re-encoded when it must be (wrong codec, too big, too heavy,
 * watermark) - otherwise its packets are copied, which is fast and loses no quality.
 */
export function planConversion(info: SourceInfo, request: PlanRequest = {}): ConversionPlan {
  const dims = outputDimensions(info.width, info.height);
  const bitrate = sourceBitrate(info);
  const mp4 = info.container === 'mp4' || info.container === 'quicktime';
  const untouched = !request.trim && !request.watermark;

  const audioOk = info.audioCodec === null || info.audioCodec === 'aac';
  const light = info.bytes <= OUTPUT_LIMITS.smallFileBytes || bitrate <= OUTPUT_LIMITS.videoBitrate * OUTPUT_LIMITS.bitrateTolerance;
  if (untouched && mp4 && info.fastStart && info.videoCodec === 'avc' && audioOk && !dims.changed && light) {
    return { action: 'bypass', reason: 'already-optimal' };
  }

  const heavy = bitrate > OUTPUT_LIMITS.videoBitrate * OUTPUT_LIMITS.bitrateForceMultiple;
  const forceVideoTranscode = info.videoCodec !== 'avc' || dims.changed || heavy || !!request.watermark;
  const reason = info.container === 'webm' ? 'webm-to-mp4'
    : dims.changed ? 'downscale'
    : info.videoCodec !== 'avc' ? 'transcode-to-h264'
    : heavy ? 'high-bitrate'
    : request.trim ? 'trim'
    : 'faststart-remux';
  return { action: 'convert', reason, resize: dims.changed ? { width: dims.width, height: dims.height } : null, forceVideoTranscode };
}
