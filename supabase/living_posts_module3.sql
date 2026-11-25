-- Living Posts module 3: enable post_format = 'living_post', allow authenticated inserts on
-- post_format & recipe_data (size-bounded), and add 'living-generate' API rate-limit quota.
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_post_format_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_post_format_check
  CHECK (post_format IN ('video', 'image', 'recipe_avatar', 'recipe_shayari', 'living_post'));

GRANT INSERT (post_format, recipe_data) ON public.posts TO authenticated;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_recipe_data_size_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_recipe_data_size_check
  CHECK (recipe_data IS NULL OR pg_column_size(recipe_data) <= 65536);

CREATE OR REPLACE FUNCTION public.check_api_rate_limit(p_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
