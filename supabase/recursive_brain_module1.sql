-- Vybe Recursive Feed Brain (Module 1): pgvector HNSW, atomic swipe-batch ingestion RPC,
-- 2-stage top-50 candidate funnel RPC, user taste vectors, and Trimurti Algo Genomes.
-- Idempotent: safe to run more than once.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS vibe_embedding vector(384),
  ADD COLUMN IF NOT EXISTS alpha_score double precision NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS beta_score double precision NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS pheromone_score double precision NOT NULL DEFAULT 1.0;

-- Fix #1: Use HNSW instead of ivfflat so small/empty tables remain accurate and fast.
DROP INDEX IF EXISTS public.idx_posts_vibe_embedding;
CREATE INDEX IF NOT EXISTS idx_posts_vibe_embedding
  ON public.posts USING hnsw (vibe_embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.user_taste_vectors (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  taste_embedding vector(384),
  total_signals integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_taste_vectors ENABLE ROW LEVEL SECURITY;

-- Anti-spam dedup: max 1 brain signal per (user_id, post_id)
CREATE TABLE IF NOT EXISTS public.brain_signal_dedup (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE public.brain_signal_dedup ENABLE ROW LEVEL SECURITY;

-- Fix #2A: Unique genome_key prevents duplicate seed rows on re-run.
CREATE TABLE IF NOT EXISTS public.algo_genomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genome_key text UNIQUE,
  generation integer NOT NULL DEFAULT 1,
  w_vibe double precision NOT NULL DEFAULT 0.45,
  w_pheromone double precision NOT NULL DEFAULT 0.35,
  w_explore double precision NOT NULL DEFAULT 0.20,
  decay_lambda double precision NOT NULL DEFAULT 1.35,
  impressions integer NOT NULL DEFAULT 0,
  cumulative_reward double precision NOT NULL DEFAULT 0.0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.algo_genomes ENABLE ROW LEVEL SECURITY;

INSERT INTO public.algo_genomes (genome_key, generation, w_vibe, w_pheromone, w_explore, decay_lambda)
VALUES
  ('seed_taste',    1, 0.50, 0.30, 0.20, 1.30),
  ('seed_viral',    1, 0.30, 0.50, 0.20, 1.45),
  ('seed_explore',  1, 0.35, 0.25, 0.40, 1.25),
  ('seed_balanced', 1, 0.40, 0.40, 0.20, 1.35)
ON CONFLICT (genome_key) DO NOTHING;

-- Fix #2B: Single atomic Postgres RPC to ingest batched swipe signals without hot-row lock queues.
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
  updated_posts AS (
    UPDATE public.posts p
    SET
      alpha_score = greatest(0.5, p.alpha_score + agg.alpha_d),
      beta_score = greatest(0.5, p.beta_score + agg.beta_d),
      pheromone_score = greatest(0.0, p.pheromone_score + agg.phero_d)
    FROM agg
    WHERE p.id = agg.post_id
    RETURNING p.id
  )
  SELECT count(*)::integer, coalesce(sum(reward), 0.0)
  INTO v_batch_count, v_total_reward
  FROM raw_rows;

  IF p_genome_id IS NOT NULL AND v_batch_count > 0 THEN
    UPDATE public.algo_genomes
    SET
      impressions = impressions + v_batch_count,
      cumulative_reward = cumulative_reward + v_total_reward
    WHERE id = p_genome_id AND is_active = true;
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

-- Fix #6: Two-stage top-50 candidate funnel RPC (pgvector HNSW similarity + fresh/trending pool).
CREATE OR REPLACE FUNCTION public.get_brain_feed_candidates(
  p_user_id uuid,
  p_seen_ids uuid[] DEFAULT '{}',
  p_downrank_topics text[] DEFAULT '{}',
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  post jsonb,
  vibe_similarity double precision,
  pheromone_raw double precision,
  age_hours double precision,
  alpha_score double precision,
  beta_score double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_taste vector(384);
  v_cap integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_vec_cap integer := greatest(10, v_cap / 2);
BEGIN
  SELECT utv.taste_embedding INTO v_taste
  FROM public.user_taste_vectors utv
  WHERE utv.user_id = p_user_id;

  RETURN QUERY
  WITH vec_ids AS (
    SELECT p.id
    FROM public.posts p
    WHERE v_taste IS NOT NULL
      AND p.vibe_embedding IS NOT NULL
      AND post_is_live(p.expires_at)
      AND NOT (p.id = ANY(coalesce(p_seen_ids, '{}')))
    ORDER BY p.vibe_embedding <=> v_taste
    LIMIT v_vec_cap
  ),
  fresh_ids AS (
    SELECT p.id
    FROM public.posts p
    WHERE post_is_live(p.expires_at)
      AND NOT (p.id = ANY(coalesce(p_seen_ids, '{}')))
    ORDER BY p.created_at DESC
    LIMIT v_cap
  ),
  combined_ids AS (
    SELECT id FROM vec_ids
    UNION
    SELECT id FROM fresh_ids
  ),
  limited_ids AS (
    SELECT c.id
    FROM combined_ids c
    JOIN public.posts p ON p.id = c.id
    ORDER BY p.created_at DESC
    LIMIT v_cap
  )
  SELECT
    to_jsonb(v) AS post,
    CASE
      WHEN v_taste IS NOT NULL AND p.vibe_embedding IS NOT NULL
        THEN greatest(0.0, least(1.0, (2.0 - (p.vibe_embedding <=> v_taste)) / 2.0))
      ELSE 0.5
    END AS vibe_similarity,
    greatest(
      0.0,
      (
        p.pheromone_score
        + 0.35 * p.likes_count
        + 0.6 * coalesce(m.shares, 0)
        + 0.4 * coalesce(m.rewatches, 0)
      ) * CASE
        WHEN p.topic_entity IS NOT NULL AND lower(p.topic_entity) = ANY(coalesce(p_downrank_topics, '{}'))
          THEN 0.15
        ELSE 1.0
      END
    ) AS pheromone_raw,
    greatest(0.0, extract(epoch FROM (now() - p.created_at)) / 3600.0) AS age_hours,
    p.alpha_score,
    p.beta_score
  FROM limited_ids l
  JOIN public.public_posts v ON v.id = l.id
  JOIN public.posts p ON p.id = l.id
  LEFT JOIN public.post_metrics m ON m.post_id = l.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_brain_feed_candidates(uuid, uuid[], text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_brain_feed_candidates(uuid, uuid[], text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.check_api_rate_limit(p_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  quota integer;
  admitted integer;
BEGIN
  quota := CASE p_action
    WHEN 'upload-url' THEN 60
    WHEN 'process-post' THEN 8
    WHEN 'search' THEN 30
    WHEN 'living-generate' THEN 10
    WHEN 'brain-signal' THEN 60
  END;
  IF quota IS NULL THEN RETURN false; END IF;
  INSERT INTO public.api_rate_windows AS w(user_id, action, minute, hits)
    VALUES (p_user_id, p_action, date_trunc('minute', statement_timestamp()), 1)
  ON CONFLICT (user_id, action) DO UPDATE
    SET minute = excluded.minute,
        hits = CASE WHEN w.minute < excluded.minute THEN 1 ELSE w.hits + 1 END
    WHERE w.minute < excluded.minute OR w.hits < quota
    RETURNING hits INTO admitted;
  RETURN admitted IS NOT NULL;
END;
$$;

COMMIT;
