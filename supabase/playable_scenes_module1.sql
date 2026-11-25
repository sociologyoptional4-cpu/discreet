-- Playable 3D mini-worlds, module 1: let the feed see `post_format` and `recipe_data`.
-- Idempotent: safe to run more than once in the Supabase SQL Editor.
--
-- The feed reads public.public_posts, which does not expose these two columns, so a recipe post would reach the app
-- looking like a plain video. This appends them to the live view WITHOUT retyping its definition: the current
-- definition is read from the database and wrapped, so every existing column (thumbnail_url, category, ...) keeps its
-- name, type and position. Existing privileges and ownership are kept by CREATE OR REPLACE.
do $$
declare
  def text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_posts' and column_name = 'post_format'
  ) then
    return;
  end if;

  def := rtrim(pg_get_viewdef('public.public_posts'::regclass, true), E'; \n');
  execute 'create or replace view public.public_posts as '
    || 'select v.*, p.post_format, p.recipe_data from (' || def || ') v join public.posts p on p.id = v.id';
end $$;
