const SEEK_TIMEOUT_MS = 4000;

/**
 * Generates a lightweight WebP thumbnail (~12–20 KB) from a video Blob on the client,
 * with a strict 4000ms iOS Safari timeout guard and full resource cleanup.
 */
export async function generateWebPThumbnail(
  videoBlob: Blob,
  targetWidth = 360,
  quality = 0.7
): Promise<Blob> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof URL?.createObjectURL !== 'function'
  ) {
    throw new Error('generateWebPThumbnail can only run in a browser environment.');
  }

  const objectUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  const canvas = document.createElement('canvas');
  let timeoutId: number | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('error', onError);
        if (err) reject(err);
        else resolve();
      };

      const onError = () => finish(new Error('Failed to load video for thumbnail generation.'));
      const onSeeked = () => finish();
      const onLoadedData = () => {
        if (video.readyState >= 2 && video.currentTime >= 0) {
          finish();
        }
      };
      const onLoadedMetadata = () => {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.4;
        const targetTime = Math.min(0.2, duration / 2);
        try {
          if (targetTime <= 0.01) {
            if (video.readyState >= 2) finish();
            else video.addEventListener('loadeddata', onLoadedData, { once: true });
          } else {
            video.currentTime = targetTime;
          }
        } catch {
          video.addEventListener('loadeddata', onLoadedData, { once: true });
        }
      };

      timeoutId = window.setTimeout(() => {
        finish(new Error('Timed out while generating video thumbnail.'));
      }, SEEK_TIMEOUT_MS);

      video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.src = objectUrl;
      video.load();
    });

    const srcWidth = video.videoWidth || targetWidth;
    const srcHeight = video.videoHeight || Math.round((targetWidth * 16) / 9);
    const width = Math.max(1, Math.min(targetWidth, srcWidth));
    const height = Math.max(1, Math.round((srcHeight / srcWidth) * width));

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context for thumbnail generation.');
    }
    ctx.drawImage(video, 0, 0, width, height);

    const thumbBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('WebP thumbnail encoding failed.'))),
        'image/webp',
        quality
      );
    });

    return thumbBlob;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    try {
      video.pause();
      video.removeAttribute('src');
      video.src = '';
      video.load();
    } catch {
      // ignore video element teardown errors
    }
    URL.revokeObjectURL(objectUrl);
    canvas.width = 0;
    canvas.height = 0;
  }
}
