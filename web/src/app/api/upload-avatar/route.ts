import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { MAX_AVATAR_BYTES } from '@/types/persona';

const URL_TTL_SECONDS = 5 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Presigns a 5-minute PUT for the signed-in user's custom avatar at avatars/<userId>/custom.glb.
 * The key is fixed per user, so a new upload replaces the old file. The file size is signed into the URL,
 * so R2 rejects an upload of any other size: the 5 MB limit cannot be bypassed from the browser.
 */
export async function POST(request: Request): Promise<Response> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, NEXT_PUBLIC_R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !NEXT_PUBLIC_R2_PUBLIC_URL) {
    return json({ error: 'Storage is not configured.' }, 500);
  }

  const body = (await request.json().catch(() => null)) as { userId?: unknown; fileSize?: unknown } | null;
  const { userId, fileSize } = body ?? {};
  if (typeof userId !== 'string' || !UUID.test(userId)) return json({ error: 'Invalid request.' }, 400);
  if (typeof fileSize !== 'number' || !Number.isInteger(fileSize) || fileSize <= 0) return json({ error: 'Invalid file size.' }, 400);
  if (fileSize > MAX_AVATAR_BYTES) return json({ error: 'Avatar files must be 5 MB or smaller.' }, 413);

  // A person may only replace their own avatar: the id in the body must be the one the session token belongs to.
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return json({ error: 'Sign in first.' }, 401);
    if (data.user.id.toLowerCase() !== userId.toLowerCase()) return json({ error: 'You can only change your own avatar.' }, 403);
  } catch {
    return json({ error: 'Auth is not configured.' }, 500);
  }

  const key = `avatars/${userId.toLowerCase()}/custom.glb`;
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, ContentType: 'model/gltf-binary', ContentLength: fileSize }),
      { expiresIn: URL_TTL_SECONDS },
    );
    // The file name never changes, so `?v=` makes every upload a new address and phones and the CDN fetch the fresh file.
    const publicUrl = `${NEXT_PUBLIC_R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}?v=${Date.now()}`;
    return json({ uploadUrl, publicUrl, key });
  } catch (error) {
    console.error('upload-avatar: presign failed', error);
    return json({ error: 'Could not prepare the upload.' }, 500);
  }
}
