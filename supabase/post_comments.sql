-- Post Comments System Migration (Idempotent)
-- Adds public.post_comments, posts.comments_count trigger, RLS policies, and Supabase Realtime publication.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS comments_count int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.post_comments(id) ON DELETE CASCADE,
  content     text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 500),
  likes_count int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_comments_post_created_idx
  ON public.post_comments (post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS post_comments_parent_idx
  ON public.post_comments (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_post_comment_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts
    SET comments_count = COALESCE(comments_count, 0) + 1
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts
    SET comments_count = GREATEST(COALESCE(comments_count, 0) - 1, 0)
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS post_comments_count_trg ON public.post_comments;
CREATE TRIGGER post_comments_count_trg
  AFTER INSERT OR DELETE ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_post_comment_count();

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.post_comments TO anon, authenticated;
GRANT INSERT (id, post_id, user_id, parent_id, content) ON public.post_comments TO authenticated;
GRANT DELETE ON public.post_comments TO authenticated;

DROP POLICY IF EXISTS post_comments_select_public ON public.post_comments;
CREATE POLICY post_comments_select_public
  ON public.post_comments
  FOR SELECT
  USING (public.post_is_live(post_id));

DROP POLICY IF EXISTS post_comments_insert_own ON public.post_comments;
CREATE POLICY post_comments_insert_own
  ON public.post_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.post_is_live(post_id));

DROP POLICY IF EXISTS post_comments_delete_own ON public.post_comments;
CREATE POLICY post_comments_delete_own
  ON public.post_comments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'post_comments'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;
    END IF;
  END IF;
END;
$$;
