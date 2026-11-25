-- Step 1: Smart Media Storage & Compression Pipeline Migration (Idempotent)
-- Creates public.media_assets, alters public.posts for shared deduplication & JSON recipes,
-- defines atomic reference-counting RPCs, and configures RLS policies.

BEGIN;

-- 1. Shared deduplicated media assets registry
CREATE TABLE IF NOT EXISTS public.media_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash       text UNIQUE NOT NULL CHECK (file_hash ~ '^[0-9a-fA-F]{64}$'),
  r2_url          text NOT NULL,
  thumbnail_url   text,
  mime_type       text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes >= 0),
  width           int CHECK (width IS NULL OR width > 0),
  height          int CHECK (height IS NULL OR height > 0),
  duration_sec    numeric CHECK (duration_sec IS NULL OR duration_sec >= 0),
  is_archived     boolean NOT NULL DEFAULT false,
  ref_count       int NOT NULL DEFAULT 1 CHECK (ref_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_archived_created_idx
  ON public.media_assets (is_archived, created_at);

-- 2. Extend public.posts for deduplicated assets, thumbnails, recipes, and expiry
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_format    text NOT NULL DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipe_data    jsonb,
  ADD COLUMN IF NOT EXISTS thumbnail_url  text,
  ADD COLUMN IF NOT EXISTS expires_at     timestamptz;

ALTER TABLE public.posts
  ALTER COLUMN expires_at DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_post_format_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_post_format_check
      CHECK (post_format IN ('video', 'image', 'recipe_avatar', 'recipe_shayari'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS posts_media_asset_id_idx
  ON public.posts (media_asset_id)
  WHERE media_asset_id IS NOT NULL;

-- 3. Atomic Reference Counting RPCs
CREATE OR REPLACE FUNCTION public.increment_media_ref(p_asset_id uuid)
RETURNS public.media_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset public.media_assets;
BEGIN
  UPDATE public.media_assets
  SET ref_count = ref_count + 1
  WHERE id = p_asset_id
  RETURNING * INTO v_asset;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media asset % not found.', p_asset_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_asset;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_media_ref(p_asset_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_count int;
BEGIN
  UPDATE public.media_assets
  SET ref_count = GREATEST(ref_count - 1, 0)
  WHERE id = p_asset_id
  RETURNING ref_count INTO v_ref_count;

  RETURN COALESCE(v_ref_count, 0);
END;
$$;

-- 4. Row Level Security & Privileges on public.media_assets
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.media_assets TO anon, authenticated;
GRANT INSERT (id, file_hash, r2_url, thumbnail_url, mime_type, file_size_bytes, width, height, duration_sec)
  ON public.media_assets TO authenticated;

DROP POLICY IF EXISTS media_assets_select_public ON public.media_assets;
CREATE POLICY media_assets_select_public
  ON public.media_assets
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS media_assets_insert_authenticated ON public.media_assets;
CREATE POLICY media_assets_insert_authenticated
  ON public.media_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON FUNCTION public.increment_media_ref(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_media_ref(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.decrement_media_ref(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrement_media_ref(uuid) TO authenticated, service_role;

COMMIT;
