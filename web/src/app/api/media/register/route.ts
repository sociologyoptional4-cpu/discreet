import { authenticate, isUuid, json } from '@/lib/server/request';
import type { IncrementMediaRefArgs, MediaAsset, MediaAssetInsert } from '@/types/media';

const SHA256_LOWER_HEX = /^[a-f0-9]{64}$/;
const UNIQUE_VIOLATION = '23505';

type ClaimBody = {
  action: 'claim';
  assetId?: unknown;
};

type RegisterBody = {
  action: 'register';
  file_hash?: unknown;
  r2_url?: unknown;
  thumbnail_url?: unknown;
  mime_type?: unknown;
  file_size_bytes?: unknown;
  width?: unknown;
  height?: unknown;
  duration_sec?: unknown;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isOptionalPositiveInt(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function isOptionalNonNegativeNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

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

  const rawBody = (await request.json().catch(() => null)) as ClaimBody | RegisterBody | null;
  if (!rawBody || (rawBody.action !== 'claim' && rawBody.action !== 'register')) {
    return json({ error: "Invalid action: expected 'claim' or 'register'." }, 400);
  }

  if (rawBody.action === 'claim') {
    if (!isUuid(rawBody.assetId)) {
      return json({ error: 'Invalid assetId: expected a valid UUID.' }, 400);
    }

    const args: IncrementMediaRefArgs = { p_asset_id: rawBody.assetId };
    const { data, error } = await auth.client.rpc('increment_media_ref', args);
    if (error) {
      if (error.code === 'P0002') {
        return json({ error: 'Media asset not found.' }, 404);
      }
      return json({ error: 'Failed to claim media asset reference.' }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return json({ error: 'Media asset not found.' }, 404);
    }
    return json({ asset: normalizeAsset(row as Record<string, unknown>) });
  }

  const {
    file_hash,
    r2_url,
    thumbnail_url,
    mime_type,
    file_size_bytes,
    width,
    height,
    duration_sec,
  } = rawBody;

  if (typeof file_hash !== 'string' || !SHA256_LOWER_HEX.test(file_hash)) {
    return json({ error: 'Invalid file_hash: expected a 64-character lowercase SHA-256 hex string.' }, 400);
  }
  if (!isHttpUrl(r2_url)) {
    return json({ error: 'Invalid r2_url: expected a valid http/https URL.' }, 400);
  }
  if (thumbnail_url !== undefined && thumbnail_url !== null && !isHttpUrl(thumbnail_url)) {
    return json({ error: 'Invalid thumbnail_url: expected a valid http/https URL or null.' }, 400);
  }
  if (typeof mime_type !== 'string' || mime_type.trim().length === 0 || mime_type.trim().length > 128) {
    return json({ error: 'Invalid mime_type.' }, 400);
  }
  if (typeof file_size_bytes !== 'number' || !Number.isInteger(file_size_bytes) || file_size_bytes < 0) {
    return json({ error: 'Invalid file_size_bytes: expected a non-negative integer.' }, 400);
  }
  if (!isOptionalPositiveInt(width) || !isOptionalPositiveInt(height)) {
    return json({ error: 'Invalid width or height: expected a positive integer or null.' }, 400);
  }
  if (!isOptionalNonNegativeNumber(duration_sec)) {
    return json({ error: 'Invalid duration_sec: expected a non-negative number or null.' }, 400);
  }

  const insertPayload: MediaAssetInsert = {
    file_hash,
    r2_url,
    thumbnail_url: thumbnail_url ?? null,
    mime_type: mime_type.trim(),
    file_size_bytes,
    width: width ?? null,
    height: height ?? null,
    duration_sec: duration_sec ?? null,
  };

  const { data: inserted, error: insertError } = await auth.client
    .from('media_assets')
    .insert(insertPayload)
    .select('*')
    .single();

  if (!insertError && inserted) {
    return json({ asset: normalizeAsset(inserted as Record<string, unknown>) }, 201);
  }

  // Concurrent upload race condition: another request just registered the same file_hash.
  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: fetchError } = await auth.client
      .from('media_assets')
      .select('id')
      .eq('file_hash', file_hash)
      .maybeSingle();

    if (fetchError || !existing?.id) {
      return json({ error: 'Failed to resolve concurrent media registration.' }, 500);
    }

    const args: IncrementMediaRefArgs = { p_asset_id: String(existing.id) };
    const { data: incremented, error: rpcError } = await auth.client.rpc('increment_media_ref', args);
    if (rpcError) {
      return json({ error: 'Failed to increment media reference count.' }, 500);
    }

    const row = Array.isArray(incremented) ? incremented[0] : incremented;
    if (!row || typeof row !== 'object') {
      return json({ error: 'Media asset not found after race resolution.' }, 500);
    }
    return json({ asset: normalizeAsset(row as Record<string, unknown>) }, 200);
  }

  return json({ error: 'Failed to register media asset.' }, 500);
}
