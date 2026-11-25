import { authenticate, json } from '@/lib/server/request';
import type { MediaAsset } from '@/types/media';

const SHA256_LOWER_HEX = /^[a-f0-9]{64}$/;

function normalizeAsset(row: Record<string, unknown>): MediaAsset {
  return {
    id: String(row.id),
    file_hash: String(row.file_hash),
    r2_url: String(row.r2_url),
    thumbnail_url: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null,
    mime_type: String(row.mime_type),
    file_size_bytes: Number(row.file_size_bytes),
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    duration_sec: row.duration_sec === null || row.duration_sec === undefined ? null : Number(row.duration_sec),
    is_archived: Boolean(row.is_archived),
    ref_count: Number(row.ref_count),
    created_at: String(row.created_at),
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json().catch(() => null)) as { fileHash?: unknown } | null;
  const fileHash = body?.fileHash;

  if (typeof fileHash !== 'string' || !SHA256_LOWER_HEX.test(fileHash)) {
    return json(
      { error: 'Invalid fileHash: expected a 64-character lowercase SHA-256 hex string.' },
      400
    );
  }

  const { data, error } = await auth.client
    .from('media_assets')
    .select('*')
    .eq('file_hash', fileHash)
    .maybeSingle();

  if (error) {
    return json({ error: 'Failed to check media hash.' }, 500);
  }

  if (!data) {
    return json({ exists: false, asset: null });
  }

  return json({
    exists: true,
    asset: normalizeAsset(data as Record<string, unknown>),
  });
}
