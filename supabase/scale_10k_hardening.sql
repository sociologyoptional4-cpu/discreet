-- Vybe 10k Concurrent Scale Hardening:
-- 1) Sharded counters for algo_genomes to eliminate single-row lock contention on swipe ingestion
-- 2) Deterministic post_id lock ordering inside ingest_brain_signals to prevent deadlocks
-- 3) Partial & composite indexes for feed pool, creator profiles, active genomes, and signal dedup
-- Idempotent: safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS public.algo_genome_shards (
  genome_id uuid NOT NULL REFERENCES public.algo_genomes(id) ON DELETE CASCADE,
  shard smallint NOT NULL CHECK (shard >= 0 AND shard < 32),
  impressions bigint NOT NULL DEFAULT 0,
  cumulative_reward double precision NOT NULL DEFAULT 0.0,
  PRIMARY KEY (genome_id, shard)
);
ALTER TABLE public.algo_genome_shards ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rollup_algo_genome_shards()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  WITH drained AS (
    DELETE FROM public.algo_genome_shards
    WHERE shard >= 0
    RETURNING genome_id, impressions, cumulative_reward
  ),
  agg AS (
    SELECT
      genome_id,
      sum(impressions)::integer AS impressions,
      sum(cumulative_reward)::double precision AS cumulative_reward
    FROM drained
    GROUP BY genome_id
  ),
  upd AS (
    UPDATE public.algo_genomes g
    SET
      impressions = g.impressions + agg.impressions,
      cumulative_reward = g.cumulative_reward + agg.cumulative_reward
    FROM agg
    WHERE g.id = agg.genome_id
    RETURNING g.id
  )
  SELECT count(*)::integer INTO v_updated FROM upd;

  RETURN coalesce(v_updated, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.rollup_algo_genome_shards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_algo_genome_shards() TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_brain_signals(
  p_user_id uuid,
  p_genome_id uuid,
  p_signals jsonb,
  p_new_taste vector(384) DEFAULT NULL,
  p_signal_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_batch_count integer := 0;
  v_total_reward double precision := 0.0;
BEGIN
  WITH input_rows AS (
    SELECT DISTINCT ON (x.post_id)
      x.post_id,
      coalesce(x.alpha_delta, 0.0) AS alpha_delta,
      coalesce(x.beta_delta, 0.0) AS beta_delta,
      coalesce(x.pheromone_delta, 0.0) AS pheromone_delta,
      coalesce(x.reward, 0.0) AS reward
    FROM jsonb_to_recordset(p_signals) AS x(
      post_id uuid,
      alpha_delta double precision,
      beta_delta double precision,
      pheromone_delta double precision,
      reward double precision
    )
    WHERE x.post_id IS NOT NULL
  ),
  dedup_accepted AS (
    INSERT INTO public.brain_signal_dedup (user_id, post_id)
    SELECT p_user_id, r.post_id
    FROM input_rows r
    JOIN public.posts p ON p.id = r.post_id
    ON CONFLICT (user_id, post_id) DO NOTHING
    RETURNING post_id
  ),
  raw_rows AS (
    SELECT r.*
    FROM input_rows r
    JOIN dedup_accepted d ON d.post_id = r.post_id
  ),
  agg AS (
    SELECT
      post_id,
      sum(alpha_delta) AS alpha_d,
      sum(beta_delta) AS beta_d,
      sum(pheromone_delta) AS phero_d
    FROM raw_rows
    GROUP BY post_id
  ),
  agg_ordered AS (
    SELECT post_id, alpha_d, beta_d, phero_d
    FROM agg
    ORDER BY post_id ASC
  ),
  updated_posts AS (
    UPDATE public.posts p
    SET
      alpha_score = greatest(0.5, p.alpha_score + agg_ordered.alpha_d),
      beta_score = greatest(0.5, p.beta_score + agg_ordered.beta_d),
      pheromone_score = greatest(0.0, p.pheromone_score + agg_ordered.phero_d)
    FROM agg_ordered
    WHERE p.id = agg_ordered.post_id
    RETURNING p.id
  )
  SELECT count(*)::integer, coalesce(sum(reward), 0.0)
  INTO v_batch_count, v_total_reward
  FROM raw_rows;

  IF p_genome_id IS NOT NULL AND v_batch_count > 0 THEN
    INSERT INTO public.algo_genome_shards (genome_id, shard, impressions, cumulative_reward)
    SELECT
      g.id,
      (abs(hashtext(p_user_id::text)::bigint) % 32)::smallint,
      v_batch_count,
      v_total_reward
    FROM public.algo_genomes g
    WHERE g.id = p_genome_id AND g.is_active = true
    ON CONFLICT (genome_id, shard) DO UPDATE
    SET
      impressions = public.algo_genome_shards.impressions + EXCLUDED.impressions,
      cumulative_reward = public.algo_genome_shards.cumulative_reward + EXCLUDED.cumulative_reward;
  END IF;

  INSERT INTO public.user_taste_vectors (user_id, taste_embedding, total_signals, updated_at)
  VALUES (p_user_id, p_new_taste, greatest(1, p_signal_count), now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    taste_embedding = coalesce(EXCLUDED.taste_embedding, public.user_taste_vectors.taste_embedding),
    total_signals = public.user_taste_vectors.total_signals + greatest(1, p_signal_count),
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_brain_signals(uuid, uuid, jsonb, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_brain_signals(uuid, uuid, jsonb, vector, integer) TO service_role;

-- Partial and composite hot-path indexes
CREATE INDEX IF NOT EXISTS idx_posts_public_permanent_created
  ON public.posts (created_at DESC)
  WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_public_burner_expiry
  ON public.posts (expires_at, created_at DESC)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_profile_permanent
  ON public.posts (user_id, created_at DESC)
  WHERE is_incog = false AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_profile_burner
  ON public.posts (user_id, expires_at, created_at DESC)
  WHERE is_incog = false AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_algo_genomes_active_created
  ON public.algo_genomes (is_active, created_at);

CREATE INDEX IF NOT EXISTS idx_brain_signal_dedup_post
  ON public.brain_signal_dedup (post_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
