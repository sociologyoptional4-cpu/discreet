const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i;

/** True when a media URL points at a still image, judged by its file extension. */
export function isImageUrl(url: string | null | undefined): boolean {
  return !!url && IMAGE_EXTENSION.test(url);
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** File extension for a MIME type (parameters like `;codecs=` ignored). Falls back to `bin`. */
export function extensionForMime(mime: string): string {
  return EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? 'bin';
}
