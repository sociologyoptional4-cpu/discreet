import type { Combinator as CombinatorType, MP4Clip as MP4ClipType, OffscreenSprite as OffscreenSpriteType } from '@webav/av-cliper';

export type CompressedVideoResult = {
  blob: Blob;
  wasCompressed: boolean;
  width?: number;
  height?: number;
  durationSec?: number;
};

export type CompressedImageResult = {
  blob: Blob;
  width: number;
  height: number;
};

const MAX_RAW_VIDEO_BYTES = 100 * 1024 * 1024;
const PASSTHROUGH_VIDEO_BYTES = 8 * 1024 * 1024;
const MAX_DURATION_US = 60_000_000;
const TARGET_SHORT_SIDE_PX = 720;
const TARGET_VIDEO_BITRATE = 2_200_000;
const TARGET_FPS = 30;
const CODEC_CANDIDATES = ['avc1.640028', 'avc1.4D401F', 'avc1.42E01E'] as const;

async function pickSupportedVideoCodec(width: number, height: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoEncoder.isConfigSupported !== 'function') {
    return null;
  }
  for (const codec of CODEC_CANDIDATES) {
    try {
      const check = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: TARGET_VIDEO_BITRATE,
        framerate: TARGET_FPS,
        hardwareAcceleration: 'prefer-hardware',
        bitrateMode: 'variable',
      });
      if (check.supported) return codec;
    } catch {
      // try next codec profile
    }
  }
  return null;
}

const toEven = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

function computeScaledDimensions(srcW: number, srcH: number, maxShortSide: number): { width: number; height: number } {
  const safeW = srcW > 0 ? srcW : 720;
  const safeH = srcH > 0 ? srcH : 1280;
  const shortSide = Math.min(safeW, safeH);
  const scale = shortSide > maxShortSide ? maxShortSide / shortSide : 1;
  return {
    width: toEven(safeW * scale),
    height: toEven(safeH * scale),
  };
}

async function readStreamToBlob(stream: ReadableStream<Uint8Array>, mimeType: string): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(new Uint8Array(value));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: mimeType });
}

/**
 * Compresses mobile videos client-side using WebCodecs (`@webav/av-cliper`) to
 * H.264 720p @ 700kbps MP4 (max 60s), with automatic passthrough and fallback safety.
 */
export async function compressVideoForMobile(
  file: Blob,
  onProgress?: (pct: number) => void
): Promise<CompressedVideoResult> {
  if (file.size > MAX_RAW_VIDEO_BYTES) {
    throw new Error('Video must be under 100 MB');
  }

  if (
    file.size < PASSTHROUGH_VIDEO_BYTES ||
    typeof window === 'undefined' ||
    typeof VideoEncoder === 'undefined'
  ) {
    onProgress?.(100);
    return { blob: file, wasCompressed: false };
  }

  let clip: MP4ClipType | null = null;
  let sprite: OffscreenSpriteType | null = null;
  let combinator: CombinatorType | null = null;
  let unsubscribeProgress: (() => void) | null = null;

  try {
    onProgress?.(2);
    const { MP4Clip, OffscreenSprite, Combinator } = await import('@webav/av-cliper');

    clip = new MP4Clip(file.stream());
    const meta = await clip.ready;

    const validDurationUs =
      meta.duration > 0 ? Math.min(meta.duration, MAX_DURATION_US) : MAX_DURATION_US;
    const durationSec = Math.round((validDurationUs / 1_000_000) * 100) / 100;

    const { width: targetWidth, height: targetHeight } = computeScaledDimensions(
      meta.width,
      meta.height,
      TARGET_SHORT_SIDE_PX
    );

    const selectedCodec = await pickSupportedVideoCodec(targetWidth, targetHeight);
    const supported = selectedCodec
      ? await Combinator.isSupported({
          videoCodec: selectedCodec,
          width: targetWidth,
          height: targetHeight,
          bitrate: TARGET_VIDEO_BITRATE,
        })
      : false;
    if (!supported || !selectedCodec) {
      onProgress?.(100);
      return { blob: file, wasCompressed: false };
    }

    sprite = new OffscreenSprite(clip);
    await sprite.ready;
    sprite.rect.x = 0;
    sprite.rect.y = 0;
    sprite.rect.w = targetWidth;
    sprite.rect.h = targetHeight;
    sprite.time = { offset: 0, duration: validDurationUs };

    combinator = new Combinator({
      width: targetWidth,
      height: targetHeight,
      videoCodec: selectedCodec,
      fps: TARGET_FPS,
      bitrate: TARGET_VIDEO_BITRATE,
      __unsafe_hardwareAcceleration__: 'prefer-hardware',
    });

    unsubscribeProgress = combinator.on('OutputProgress', (progress) => {
      const pct = Math.min(99, Math.max(2, Math.round(progress * 100)));
      onProgress?.(pct);
    });

    await combinator.addSprite(sprite, { main: true });
    const outStream = combinator.output({ maxTime: validDurationUs });
    const compressedBlob = await readStreamToBlob(outStream, 'video/mp4');

    if (compressedBlob.size === 0 || compressedBlob.size >= file.size) {
      onProgress?.(100);
      return {
        blob: file,
        wasCompressed: false,
        width: meta.width || undefined,
        height: meta.height || undefined,
        durationSec,
      };
    }

    onProgress?.(100);
    return {
      blob: compressedBlob,
      wasCompressed: true,
      width: targetWidth,
      height: targetHeight,
      durationSec,
    };
  } catch {
    onProgress?.(100);
    return { blob: file, wasCompressed: false };
  } finally {
    try {
      unsubscribeProgress?.();
    } catch {
      // ignore listener teardown error
    }
    try {
      combinator?.destroy();
    } catch {
      // ignore combinator teardown error
    }
    try {
      sprite?.destroy();
    } catch {
      // ignore sprite teardown error
    }
    try {
      clip?.destroy();
    } catch {
      // ignore clip teardown error
    }
  }
}

/**
 * Compresses an image Blob/File to WebP scaled proportionally to `maxWidth` (~50–100 KB).
 */
export async function compressImageToWebP(
  file: Blob,
  maxWidth = 1080,
  quality = 0.82
): Promise<CompressedImageResult> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof URL?.createObjectURL !== 'function'
  ) {
    throw new Error('compressImageToWebP can only run in a browser environment.');
  }

  const objectUrl = URL.createObjectURL(file);
  const canvas = document.createElement('canvas');

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image for WebP compression.'));
      el.src = objectUrl;
    });

    const srcWidth = img.naturalWidth || img.width || maxWidth;
    const srcHeight = img.naturalHeight || img.height || maxWidth;
    const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
    const width = Math.max(1, Math.round(srcWidth * scale));
    const height = Math.max(1, Math.round(srcHeight * scale));

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context for image compression.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const webpBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('WebP image encoding failed.'))),
        'image/webp',
        quality
      );
    });

    return { blob: webpBlob, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
    canvas.width = 0;
    canvas.height = 0;
  }
}
