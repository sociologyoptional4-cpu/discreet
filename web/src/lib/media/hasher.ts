const HEX_TABLE: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
);

/**
 * Computes a lowercase 64-character SHA-256 hex fingerprint for a Blob or File
 * using the browser's native Web Crypto API without extra buffer copies.
 */
export async function computeFileHash(blob: Blob): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error(
      'SHA-256 file hashing requires Web Crypto API (window.crypto.subtle) in a secure browser context.'
    );
  }
  if (!(blob instanceof Blob)) {
    throw new TypeError('computeFileHash expected a Blob or File instance.');
  }

  const buffer = await blob.arrayBuffer();
  const digest = await window.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);

  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += HEX_TABLE[bytes[i]];
  }
  return hex;
}
