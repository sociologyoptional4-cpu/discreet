import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, json, rateLimit } from '@/lib/server/request';
import { publicTarget, storage } from '@/lib/server/storage';
import { EXPIRY_TIERS } from '@/types/social';

const ALLOWED_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'video/webm',
  'video/mp4',
  'image/webp',
  'image/jpeg',
  'image/png',
  'application/json',
  'text/plain',
  'text/html',
]);
const EDGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MAX_BYTES = 64 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object') return json({ error: 'Invalid request.' }, 400);
  const { fileName, contentType, expiryTier, purpose, fileSize } = raw as Record<string, unknown>;
  const tier = EXPIRY_TIERS.find(t => t === expiryTier);
  if (!tier || typeof fileName !== 'string' || !fileName || fileName.length > 200 ||
      typeof contentType !== 'string' || contentType.length > 160 || /[\r\n]/.test(contentType) ||
      !ALLOWED_TYPES.has(contentType.split(';')[0].trim().toLowerCase()) ||
      (purpose !== undefined && purpose !== 'snap' && purpose !== 'post') ||
      typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_BYTES ||
      (purpose === 'snap' && tier !== '1d')) return json({ error: 'Invalid media upload.' }, 400);
  const limited = await rateLimit(auth.userId, 'upload-url');
  if (limited) return limited;
  const file = crypto.randomUUID() + '-' + (fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'upload');
  try {
    const { s3, bucket } = storage(purpose === 'snap');
    const target = purpose === 'snap' ? { key: `snaps/1d/${auth.userId}/${file}` } : publicTarget(auth.userId, tier, file);
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: bucket,
      Key: target.key,
      ContentType: contentType,
      ContentLength: fileSize,
      CacheControl: EDGE_CACHE_CONTROL,
    }), { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length', 'cache-control']) });
    return json({ uploadUrl, ...target });
  } catch {
    return json({ error: 'Could not prepare the upload.' }, 503);
  }
}
