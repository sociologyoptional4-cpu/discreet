/**
 * On-device still-image processing for photo posts: shrinks the photo, re-encodes it as WebP (JPEG where the browser
 * cannot encode WebP, such as Safari), and makes a small thumbnail. Browser only; no React, no path aliases.
 * Never fails a publish: if the image cannot be decoded it returns the original.
 */
export interface ProcessImageOptions {
  /** Longest edge in pixels. Default 1280. */
  maxLongEdge?: number;
  quality?: number;
  thumbnailWidth?: number;
}

export interface ProcessedImageResult {
  imageBlob: Blob;
  thumbnailBlob: Blob | null;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  strategy: 'converted' | 'fallback';
}

/** Fits a size inside `maxLongEdge` without upscaling. */
export function fitWithin(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const toBlob = (type: string): Promise<Blob | null> =>
    'convertToBlob' in canvas ? canvas.convertToBlob({ type, quality }).catch(() => null) : new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, type, quality));
  const webp = await toBlob('image/webp');
  return webp && webp.type === 'image/webp' ? webp : toBlob('image/jpeg');
}

function draw(bitmap: ImageBitmap, width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export async function processImageOnDevice(source: Blob, options: ProcessImageOptions = {}): Promise<ProcessedImageResult> {
  const { maxLongEdge = 1280, quality = 0.82, thumbnailWidth = 360 } = options;
  const fallback: ProcessedImageResult = { imageBlob: source, thumbnailBlob: null, width: 0, height: 0, originalBytes: source.size, compressedBytes: source.size, strategy: 'fallback' };
  if (typeof createImageBitmap !== 'function') return fallback;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(source);
    const size = fitWithin(bitmap.width, bitmap.height, maxLongEdge);
    const imageBlob = await encode(draw(bitmap, size.width, size.height), quality);
    if (!imageBlob) return { ...fallback, width: bitmap.width, height: bitmap.height };
    const thumbSize = fitWithin(bitmap.width, bitmap.height, thumbnailWidth * 2);
    const thumbScale = Math.min(1, thumbnailWidth / Math.min(thumbSize.width, thumbSize.height));
    const thumbnailBlob = await encode(draw(bitmap, Math.max(1, Math.round(thumbSize.width * thumbScale)), Math.max(1, Math.round(thumbSize.height * thumbScale))), 0.75);
    // Keep the original if re-encoding did not help.
    if (imageBlob.size >= source.size && (source.type === 'image/webp' || source.type === 'image/jpeg')) {
      return { ...fallback, thumbnailBlob, width: bitmap.width, height: bitmap.height };
    }
    return { imageBlob, thumbnailBlob, width: size.width, height: size.height, originalBytes: source.size, compressedBytes: imageBlob.size, strategy: 'converted' };
  } catch {
    return fallback;
  } finally {
    bitmap?.close();
  }
}
