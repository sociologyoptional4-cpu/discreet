import { timingSafeEqual } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { json } from '@/lib/server/request';
import type { DecrementMediaRefArgs } from '@/types/media';

export const maxDuration = 60;

const EXPIRED_BATCH_LIMIT = 50;
const ORPHAN_BATCH_LIMIT = 100;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) return false;

  const header = request.headers.get('authorization');
  if (!header) return false;

  const expected = `Bearer ${secret}`;
  const actualBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(actualBuf, expectedBuf);
}

function getR2Client(): { s3: S3Client; bucket: string } {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 storage credentials are not fully configured.');
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId, secretAccessKey },
  });

  return { s3, bucket };
}

function extractR2Key(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    const key = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    return key.length > 0 ? key : null;
  } catch {
    const trimmed = rawUrl.replace(/^\/+/, '');
    return trimmed.length > 0 ? trimmed : null;
  }
}

async function handleCleanup(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = getSupabaseAdmin();
  const { s3, bucket } = getR2Client();
  const nowIso = new Date().toISOString();

  // 1. Query expired burner posts ONLY (never touch permanent posts where expires_at IS NULL)
  const { data: expiredRows, error: fetchExpiredError } = await admin
    .from('posts')
    .select('id, media_asset_id')
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .limit(EXPIRED_BATCH_LIMIT);

  if (fetchExpiredError) {
    return json({ error: 'Failed to query expired posts.' }, 500);
  }

  let deletedPosts = 0;
  const expiredList = (expiredRows ?? []) as Array<{ id: string; media_asset_id: string | null }>;

  if (expiredList.length > 0) {
    const expiredIds = expiredList.map((row) => row.id);
    const { data: deletedRows, error: deleteError } = await admin
      .from('posts')
      .delete()
      .in('id', expiredIds)
      .not('expires_at', 'is', null)
      .select('id, media_asset_id');

    if (deleteError) {
      return json({ error: 'Failed to delete expired posts.' }, 500);
    }

    const removed = (deletedRows ?? []) as Array<{ id: string; media_asset_id: string | null }>;
    deletedPosts = removed.length;

    // 2. Decrement ref_count for each linked media_asset
    for (const post of removed) {
      if (!post.media_asset_id) continue;
      const args: DecrementMediaRefArgs = { p_asset_id: post.media_asset_id };
      await admin.rpc('decrement_media_ref', args);
    }
  }

  // 3. Reclaim unreferenced media_assets (ref_count <= 0)
  const { data: orphanRows, error: orphanError } = await admin
    .from('media_assets')
    .select('id, r2_url, thumbnail_url, file_size_bytes')
    .lte('ref_count', 0)
    .limit(ORPHAN_BATCH_LIMIT);

  if (orphanError) {
    return json({ error: 'Failed to query orphaned media assets.' }, 500);
  }

  let freedAssets = 0;
  let bytesFreed = 0;

  for (const asset of (orphanRows ?? []) as Array<{
    id: string;
    r2_url: string;
    thumbnail_url: string | null;
    file_size_bytes: number;
  }>) {
    const keys = [extractR2Key(asset.r2_url), extractR2Key(asset.thumbnail_url)].filter(
      (k): k is string => Boolean(k)
    );

    let r2DeleteFailed = false;
    for (const key of keys) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        r2DeleteFailed = true;
      }
    }

    if (r2DeleteFailed) continue;

    const { error: deleteAssetError } = await admin
      .from('media_assets')
      .delete()
      .eq('id', asset.id)
      .lte('ref_count', 0);

    if (!deleteAssetError) {
      freedAssets += 1;
      bytesFreed += Number(asset.file_size_bytes) || 0;
    }
  }

  return json({
    deletedPosts,
    freedAssets,
    bytesFreed,
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleCleanup(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCleanup(request);
}
