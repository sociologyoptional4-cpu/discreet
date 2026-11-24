import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, isUuid, json } from '@/lib/server/request';
import { isSnapKey, storage } from '@/lib/server/storage';

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.messageId) || !isUuid(body?.sessionId)) return json({ error: 'Invalid snap request.' }, 400);
  try {
    const { s3, bucket } = storage(true);
    const { data, error } = await auth.client.rpc('consume_snap_view', {
      p_message_id: body.messageId, p_user_id: auth.userId, p_session_id: body.sessionId,
    }).maybeSingle<{ r2_key: string; motion_r2_key: string | null; view_count: number; replayed_by_recipient: boolean }>();
    if (error) return json({ error: 'Unable to open the snap.' }, 503);
    if (!data || !isSnapKey(data.r2_key) || (data.motion_r2_key !== null && !isSnapKey(data.motion_r2_key))) {
      return json({ error: 'Snap unavailable.' }, 404);
    }
    const sign = (key: string) => getSignedUrl(s3, new GetObjectCommand({
      Bucket: bucket, Key: key, ResponseCacheControl: 'private, no-store',
    }), { expiresIn: 60 });
    const [url, motionUrl] = await Promise.all([sign(data.r2_key), data.motion_r2_key ? sign(data.motion_r2_key) : null]);
    return json({ url, motionUrl, viewCount: data.view_count, replayed: data.replayed_by_recipient, expiresIn: 60 });
  } catch {
    return json({ error: 'Snap storage is unavailable.' }, 503);
  }
}
