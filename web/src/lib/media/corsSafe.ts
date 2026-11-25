const R2_HOST = /\.r2\.dev$/;

/**
 * Only R2 serves videos with CORS headers (and `Range` allowed in the preflight); asking any other host for CORS would
 * stop the video loading. Used for `<video crossOrigin>` and for the byte-range prefetcher.
 */
export function isCorsSafeMediaUrl(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    return R2_HOST.test(host) || (!!base && host === new URL(base).hostname);
  } catch {
    return false;
  }
}
