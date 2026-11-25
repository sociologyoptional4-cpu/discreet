/**
 * On-device video processing: turns a recording (WebM from MediaRecorder, or any MP4/MOV) into a small, universally
 * playable H.264 + AAC MP4 whose moov atom is first ("fast start"), plus a small thumbnail. Runs on the phone's
 * WebCodecs hardware, so it costs no server time. Browser only; no React, no path aliases.
 *
 * It is built on Mediabunny (demux, decode, resize, trim, AAC, mux) and adds the policy around it: when to skip the
 * work, when to copy instead of re-encode, and how to fall back. It never makes a clip worse or fails a publish: on
 * anything unsupported or any error it returns the original blob (`strategy: 'fallback'`), except when aborted.
 */
import type { Input, InputVideoTrack } from 'mediabunny';
import { isFastStartMp4, OUTPUT_LIMITS, outputDimensions, planConversion, type SourceInfo } from './videoPolicy.ts';

export interface ProcessVideoOptions {
  /** Short-edge cap in pixels. Default 720. */
  maxShortSide?: number;
  /** Target video bitrate in bps when the video is re-encoded. Default 2.2 Mbps. */
  videoBitrate?: number;
  fps?: number;
  trimStartSec?: number;
  trimEndSec?: number;
  /** Small text drawn bottom-right on every frame, for example "@name - vybe". */
  watermarkText?: string;
  /** Second of the output to use for the thumbnail. Default 0.2. */
  thumbnailAtSec?: number;
  thumbnailWidth?: number;
  /** 0..100 */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export type ProcessStrategy = 'bypass' | 'converted' | 'fallback';

export interface ProcessedVideoResult {
  videoBlob: Blob;
  /** WebP where the browser can encode it, JPEG otherwise; null if no frame could be read. */
  thumbnailBlob: Blob | null;
  width: number;
  height: number;
  durationSec: number;
  originalBytes: number;
  compressedBytes: number;
  hasAudio: boolean;
  fastStart: boolean;
  strategy: ProcessStrategy;
  /** Why this strategy was chosen, for logs and tests. */
  reason: string;
}

export interface WebCodecsSupport {
  video: boolean;
  audio: boolean;
}

let supportCache: Promise<WebCodecsSupport> | null = null;

/** Whether this browser can encode H.264 and AAC through WebCodecs. Cached after the first call. */
export function probeWebCodecsSupport(): Promise<WebCodecsSupport> {
  supportCache ??= (async () => {
    if (typeof VideoEncoder === 'undefined') return { video: false, audio: false };
    try {
      const { canEncodeVideo, canEncodeAudio } = await import('mediabunny');
      const [video, audio] = await Promise.all([
        canEncodeVideo('avc', { width: 720, height: 1280, bitrate: OUTPUT_LIMITS.videoBitrate }),
        typeof AudioEncoder === 'undefined' ? false : canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: OUTPUT_LIMITS.audioBitrate }),
      ]);
      return { video, audio };
    } catch {
      return { video: false, audio: false };
    }
  })();
  return supportCache;
}

const abortError = () => new DOMException('Video processing aborted', 'AbortError');

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, type, quality));
}

/** A small still from the clip, read straight from the decoder (no seeking through a <video>). WebP, or JPEG where WebP is not encodable (Safari). */
async function makeThumbnail(track: InputVideoTrack, atSec: number, width: number): Promise<Blob | null> {
  try {
    const { CanvasSink } = await import('mediabunny');
    const sink = new CanvasSink(track, { width, fit: 'contain' });
    const frame = (await sink.getCanvas(Math.max(0, atSec))) ?? (await sink.getCanvas(0));
    if (!frame) return null;
    const webp = await canvasToBlob(frame.canvas, 'image/webp', 0.78);
    if (webp && webp.type === 'image/webp') return webp;
    return canvasToBlob(frame.canvas, 'image/jpeg', 0.8);
  } catch {
    return null;
  }
}

async function describeSource(input: Input, blob: Blob, track: InputVideoTrack): Promise<{ info: SourceInfo; hasAudio: boolean }> {
  const [audio, durationSec, mime, head] = await Promise.all([
    input.getPrimaryAudioTrack(),
    input.computeDuration(),
    input.getMimeType(),
    blob.slice(0, 64 * 1024).arrayBuffer(),
  ]);
  const container = mime.split(';')[0].replace(/^(video|audio)\//, '').trim().toLowerCase();
  return {
    hasAudio: audio !== null,
    info: {
      container,
      bytes: blob.size,
      durationSec,
      width: track.displayWidth,
      height: track.displayHeight,
      videoCodec: track.codec,
      audioCodec: audio?.codec ?? null,
      fastStart: isFastStartMp4(new Uint8Array(head)),
    },
  };
}

function unchanged(blob: Blob, partial: Partial<ProcessedVideoResult> & Pick<ProcessedVideoResult, 'strategy' | 'reason'>): ProcessedVideoResult {
  return {
    videoBlob: blob, thumbnailBlob: null, width: 0, height: 0, durationSec: 0, originalBytes: blob.size, compressedBytes: blob.size,
    hasAudio: false, fastStart: false, ...partial,
  };
}

/**
 * Processes one clip. Resolves with the original blob when nothing can or needs to be done; rejects only with an
 * `AbortError` when `signal` is aborted.
 */
export async function processVideoOnDevice(source: Blob, options: ProcessVideoOptions = {}): Promise<ProcessedVideoResult> {
  const { maxShortSide = OUTPUT_LIMITS.maxShortSide, videoBitrate = OUTPUT_LIMITS.videoBitrate, fps = OUTPUT_LIMITS.fps, trimStartSec, trimEndSec, watermarkText, thumbnailAtSec = 0.2, thumbnailWidth = 360, onProgress, signal } = options;
  if (signal?.aborted) throw abortError();
  if (typeof window === 'undefined') return unchanged(source, { strategy: 'fallback', reason: 'no-browser' });

  let input: Input | null = null;
  try {
    const { Input, BlobSource, Output, Mp4OutputFormat, BufferTarget, Conversion, ConversionCanceledError, ALL_FORMATS } = await import('mediabunny');
    input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return unchanged(source, { strategy: 'fallback', reason: 'no-video-track' });
    onProgress?.(3);

    const { info, hasAudio } = await describeSource(input, source, track);
    const trim = trimStartSec !== undefined || trimEndSec !== undefined;
    const startSec = Math.max(0, Math.min(trimStartSec ?? 0, info.durationSec));
    const endSec = trimEndSec !== undefined ? Math.max(startSec + 0.5, Math.min(trimEndSec, info.durationSec)) : info.durationSec;
    const clipDurationSec = Math.max(0.1, endSec - startSec);
    const plan = planConversion(info, { trim, watermark: !!watermarkText });

    const thumbnailBlob = await makeThumbnail(track, startSec + thumbnailAtSec, thumbnailWidth);
    onProgress?.(8);

    if (plan.action === 'bypass') {
      onProgress?.(100);
      return { videoBlob: source, thumbnailBlob, width: info.width, height: info.height, durationSec: info.durationSec, originalBytes: source.size, compressedBytes: source.size, hasAudio, fastStart: info.fastStart, strategy: 'bypass', reason: plan.reason };
    }

    const support = await probeWebCodecsSupport();
    const needsAacEncode = hasAudio && info.audioCodec !== 'aac';
    if ((plan.forceVideoTranscode && !support.video) || (needsAacEncode && !support.audio)) {
      return unchanged(source, { strategy: 'fallback', reason: 'webcodecs-unsupported', thumbnailBlob, hasAudio, width: info.width, height: info.height, durationSec: info.durationSec });
    }

    const size = outputDimensions(info.width, info.height, maxShortSide);
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      ...(trim ? { trim: { start: startSec, end: endSec } } : {}),
      video: {
        codec: 'avc',
        ...(plan.resize ? { width: size.width, height: size.height, fit: 'contain' as const } : {}),
        ...(plan.forceVideoTranscode ? { forceTranscode: true, frameRate: fps, keyFrameInterval: OUTPUT_LIMITS.keyFrameIntervalSec, bitrate: videoBitrate } : {}),
        ...(watermarkText
          ? {
              process: (() => {
                const surface = new OffscreenCanvas(size.width, size.height);
                const ctx = surface.getContext('2d')!;
                return (sample: { draw: (c: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void }) => {
                  sample.draw(ctx, 0, 0, size.width, size.height);
                  ctx.save();
                  ctx.font = `600 ${Math.max(14, Math.round(size.width * 0.032))}px system-ui, sans-serif`;
                  ctx.fillStyle = 'rgba(255,255,255,.78)';
                  ctx.shadowColor = 'rgba(0,0,0,.55)';
                  ctx.shadowBlur = 6;
                  ctx.textAlign = 'right';
                  ctx.fillText(watermarkText, size.width - 18, size.height - 22);
                  ctx.restore();
                  return surface;
                };
              })(),
            }
          : {}),
      },
      audio: { codec: 'aac', bitrate: OUTPUT_LIMITS.audioBitrate },
    });

    // Never ship a silently muted clip: if the audio could not be carried over, keep the original instead.
    const lostAudio = conversion.discardedTracks.some((t) => t.track.type === 'audio');
    if (!conversion.isValid || lostAudio) {
      return unchanged(source, { strategy: 'fallback', reason: lostAudio ? 'audio-not-convertible' : 'conversion-invalid', thumbnailBlob, hasAudio, width: info.width, height: info.height, durationSec: info.durationSec });
    }

    const onAbort = () => void conversion.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    conversion.onProgress = (fraction) => onProgress?.(8 + Math.round(fraction * 90));
    try {
      await conversion.execute();
    } catch (error) {
      if (error instanceof ConversionCanceledError || signal?.aborted) throw abortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer || buffer.byteLength === 0) return unchanged(source, { strategy: 'fallback', reason: 'empty-output', thumbnailBlob, hasAudio });
    const videoBlob = new Blob([buffer], { type: 'video/mp4' });
    // A re-encode must never produce a bigger file than a clip that was already light.
    if (videoBlob.size >= source.size && info.container === 'mp4' && info.fastStart && info.videoCodec === 'avc') {
      return { videoBlob: source, thumbnailBlob, width: info.width, height: info.height, durationSec: clipDurationSec, originalBytes: source.size, compressedBytes: source.size, hasAudio, fastStart: true, strategy: 'bypass', reason: 'not-smaller' };
    }
    onProgress?.(100);
    return { videoBlob, thumbnailBlob, width: size.width, height: size.height, durationSec: clipDurationSec, originalBytes: source.size, compressedBytes: videoBlob.size, hasAudio, fastStart: true, strategy: 'converted', reason: plan.reason };
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
    return unchanged(source, { strategy: 'fallback', reason: error instanceof Error ? error.message.slice(0, 120) : 'error' });
  } finally {
    input?.dispose();
  }
}

