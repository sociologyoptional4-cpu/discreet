import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import type { ExpiryTier } from '@/types/privacy';

let s3: S3Client | undefined;
export function storage(isSnap: boolean) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PRIVATE_BUCKET_NAME } = process.env;
  const bucket = isSnap ? R2_PRIVATE_BUCKET_NAME : R2_BUCKET_NAME;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !bucket ||
      (isSnap && bucket === R2_BUCKET_NAME)) throw new Error('Storage configuration is incomplete.');
  s3 ??= new S3Client({
    region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return { s3, bucket };
}

function publicBase(): string {
  const base = new URL(process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid public media base.');
  return base.href.replace(/\/+$/, '');
}

function ownerSignature(userId: string, prefix: string, file: string): string {
  const secret = process.env.MEDIA_OWNERSHIP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Missing media signing secret.');
  return createHmac('sha256', secret).update(`post-v1:${userId}:${prefix}:${file}`).digest('hex');
}

export function publicTarget(userId: string, tier: ExpiryTier, file: string) {
  const key = `${tier}/${ownerSignature(userId, tier, file)}/${file}`;
  return { key, publicUrl: `${publicBase()}/${key}` };
}

/** A distinct per-file proof keeps incognito posts unlinkable by object path. */
export function ownsPublicMedia(userId: string, url: string): boolean {
  const base = publicBase() + '/';
  if (!url.startsWith(base)) return false;
  const match = /^(1d|1w|1y|never)\/([0-9a-f]{64})\/([a-f0-9-]{36}-[a-zA-Z0-9._-]{1,80})$/.exec(url.slice(base.length));
  if (!match) return false;
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(ownerSignature(userId, match[1], match[3]), 'hex'));
}

export function isSnapKey(key: unknown): key is string {
  return typeof key === 'string' && /^snaps\/1d\/[a-f0-9-]{36}\/[a-f0-9-]{36}-[a-zA-Z0-9._-]{1,80}$/.test(key);
}
