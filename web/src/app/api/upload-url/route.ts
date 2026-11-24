import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSupabaseAdmin } from '@/lib/supabase';
import { EXPIRY_TIERS } from '@/types/social';
import type { ExpiryTier } from '@/types/privacy';

const URL_TTL_SECONDS = 5 * 60;
const ALLOWED_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'video/webm', 'video/mp4', 'application/json']);

type Body = { fileName: string; contentType: string; expiryTier: ExpiryTier };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function parseBody(raw: unknown): Body | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { fileName, contentType, expiryTier } = raw as Record<string, unknown>;
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 200) return null;
  if (typeof contentType !== 'string' || !ALLOWED_TYPES.has(contentType.split(';')[0].trim().toLowerCase())) return null;
  if (typeof expiryTier !== 'string' || !EXPIRY_TIERS.includes(expiryTier as ExpiryTier)) return null;
  return { fileName, contentType, expiryTier: expiryTier as ExpiryTier };
}

/** Presigns a 5-minute PUT to Cloudflare R2. Only signed-in users may ask, so the bucket is not an open dropbox. */
export async function POST(request: Request): Promise<Response> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, NEXT_PUBLIC_R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !NEXT_PUBLIC_R2_PUBLIC_URL) {
    return json({ error: 'Storage is not configured.' }, 500);
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return json({ error: 'Sign in first.' }, 401);
  } catch {
    return json({ error: 'Auth is not configured.' }, 500);
  }

  const body = parseBody(await request.json().catch(() => null));
  if (!body) return json({ error: 'Invalid request.' }, 400);

  // Only a safe tail of the name survives; the random id makes the key unguessable and unique.
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(-80) || 'upload';
  const key = `${body.expiryTier}/${crypto.randomUUID()}-${safeName}`; // the prefix is what R2 lifecycle rules match

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, ContentType: body.contentType }),
      { expiresIn: URL_TTL_SECONDS },
    );
    return json({ uploadUrl, publicUrl: `${NEXT_PUBLIC_R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`, key });
  } catch (error) {
    console.error('upload-url: presign failed', error);
    return json({ error: 'Could not prepare the upload.' }, 500);
  }
}
