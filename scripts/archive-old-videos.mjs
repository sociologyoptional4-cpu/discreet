#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const MIN_ARCHIVE_BYTES = 3 * 1024 * 1024; // 3 MB (3,145,728 bytes)
const ARCHIVE_AGE_DAYS = 30;
const BATCH_LIMIT = 15;
const TMP_IN = '/tmp/in.mp4';
const TMP_OUT = '/tmp/out.mp4';

function getEnv(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : '');
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractR2Key(rawUrl) {
  const parsed = new URL(rawUrl);
  const key = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  if (!key) {
    throw new Error(`Could not extract R2 key from URL: ${rawUrl}`);
  }
  return key;
}

async function main() {
  const supabaseUrl = getEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const r2Endpoint = process.env.R2_ENDPOINT || `https://${getEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
  const r2AccessKeyId = getEnv('R2_ACCESS_KEY_ID');
  const r2SecretAccessKey = getEnv('R2_SECRET_ACCESS_KEY');
  const r2Bucket = getEnv('R2_BUCKET_NAME');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
  });

  const cutoffIso = new Date(Date.now() - ARCHIVE_AGE_DAYS * 86_400_000).toISOString();

  const { data: candidates, error: queryError } = await supabase
    .from('media_assets')
    .select('id, r2_url, file_size_bytes, mime_type, created_at')
    .eq('is_archived', false)
    .like('mime_type', 'video/%')
    .gt('file_size_bytes', MIN_ARCHIVE_BYTES)
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryError) {
    throw new Error(`Supabase query failed: ${queryError.message}`);
  }

  const assets = candidates ?? [];
  console.log(`Found ${assets.length} video asset(s) eligible for 480p archival shrinking.`);

  let shrunkCount = 0;
  let skippedCount = 0;
  let totalBytesSaved = 0;

  for (const asset of assets) {
    const origSize = Number(asset.file_size_bytes) || 0;
    const key = extractR2Key(asset.r2_url);
    console.log(`Processing ${asset.id} (${key}, ${(origSize / (1024 * 1024)).toFixed(2)} MB)...`);

    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      if (!obj.Body) {
        throw new Error(`Empty S3 body for key ${key}`);
      }

      await pipeline(obj.Body, createWriteStream(TMP_IN));

      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-i',
          TMP_IN,
          '-vf',
          "scale='min(480,iw)':-2",
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-b:v',
          '280k',
          '-maxrate',
          '350k',
          '-bufsize',
          '700k',
          '-r',
          '24',
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-movflags',
          '+faststart',
          TMP_OUT,
        ],
        { stdio: 'pipe' }
      );

      const newSize = statSync(TMP_OUT).size;
      if (newSize > 0 && newSize < origSize) {
        await s3.send(
          new PutObjectCommand({
            Bucket: r2Bucket,
            Key: key,
            Body: createReadStream(TMP_OUT),
            ContentType: 'video/mp4',
            ContentLength: newSize,
            CacheControl: 'public, max-age=31536000, immutable',
          })
        );

        const { error: updateError } = await supabase
          .from('media_assets')
          .update({
            is_archived: true,
            file_size_bytes: newSize,
            mime_type: 'video/mp4',
          })
          .eq('id', asset.id);

        if (updateError) {
          throw new Error(`Failed to update DB row ${asset.id}: ${updateError.message}`);
        }

        const saved = origSize - newSize;
        totalBytesSaved += saved;
        shrunkCount += 1;
        console.log(
          `Shrunk ${asset.id}: ${(origSize / 1024).toFixed(0)} KB -> ${(newSize / 1024).toFixed(0)} KB (saved ${(saved / 1024).toFixed(0)} KB)`
        );
      } else {
        await supabase.from('media_assets').update({ is_archived: true }).eq('id', asset.id);
        skippedCount += 1;
        console.log(`Already optimal (${asset.id}); marked is_archived = true.`);
      }
    } catch (err) {
      console.error(`Error archiving ${asset.id}:`, err instanceof Error ? err.message : err);
    } finally {
      rmSync(TMP_IN, { force: true });
      rmSync(TMP_OUT, { force: true });
    }
  }

  console.log(
    `Archival complete: shrunk=${shrunkCount}, alreadyOptimal=${skippedCount}, savedMB=${(totalBytesSaved / (1024 * 1024)).toFixed(2)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
