-- Phase 2: AI discovery. Run after supabase/schema.sql, in the Supabase SQL editor. Safe to run more than once.
-- Adds typo-tolerant search (pg_trgm), two AI columns, trending topics and fuzzy search.
--
-- Both functions are SECURITY DEFINER because browsers cannot read `posts` directly (only the anonymised view).
-- They return only live posts, and for Incog posts they blank user_id and creator_username, exactly like `public_posts`.

-- schema.sql installs pg_trgm in the `extensions` schema; keep it findable for this session.
set search_path = public, extensions;

create extension if not exists pg_trgm;

------------------------------------------------------------------------------------------------------------------
-- columns written by the AI worker
------------------------------------------------------------------------------------------------------------------
alter table public.posts add column if not exists category   text   not null default 'general';
alter table public.posts add column if not exists key_points text[] not null default '{}';

------------------------------------------------------------------------------------------------------------------
-- trigram indexes (ILIKE '%x%' and the % similarity operator both use them)
-- posts_topic_trgm_idx already exists from schema.sql, so this is a no-op there.
------------------------------------------------------------------------------------------------------------------
create index if not exists posts_topic_trgm_idx      on public.posts using gin (topic_entity gin_trgm_ops);
create index if not exists posts_transcript_trgm_idx on public.posts using gin (transcript   gin_trgm_ops);

------------------------------------------------------------------------------------------------------------------
-- get_trending_topics: the most reviewed live topics, with their positive / negative counts
------------------------------------------------------------------------------------------------------------------
create or replace function public.get_trending_topics(limit_count int default 10)
returns table (topic_entity text, total_posts bigint, positive_count bigint, negative_count bigint)
language sql stable security definer set search_path = public, extensions as $$
  select p.topic_entity,
         count(*)                                         as total_posts,
         count(*) filter (where p.sentiment = 'positive') as positive_count,
         count(*) filter (where p.sentiment = 'negative') as negative_count
  from public.posts p
  where (p.expires_at is null or p.expires_at > now())
    and p.topic_entity is not null
    and p.topic_entity <> 'general'
  group by p.topic_entity
  order by total_posts desc, p.topic_entity
  limit least(greatest(coalesce(limit_count, 10), 1), 50);
$$;

------------------------------------------------------------------------------------------------------------------
-- search_posts_fuzzy: topic or transcript contains the text, or the topic sounds like it ("dary milk" -> "dairy milk")
------------------------------------------------------------------------------------------------------------------
create or replace function public.search_posts_fuzzy(search_query text)
returns table (
  id uuid, user_id uuid, creator_username text, creator_avatar_id text, creator_followers_count int,
  mode text, avatar_id text, media_url text, motion_url text, duration_sec int,
  is_incog boolean, incog_alias text,
  transcript text, topic_entity text, category text, key_points text[], sentiment text, ai_summary text,
  likes_count int, expiry_tier text, expires_at timestamptz, created_at timestamptz,
  match_score real
)
language sql stable security definer set search_path = public, extensions as $$
  with q as (
    select btrim(coalesce(search_query, '')) as term,
           -- % and _ are ILIKE wildcards; the visitor's text must match literally
           replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  )
  select p.id,
         case when p.is_incog then null else p.user_id end,
         case when p.is_incog then null else u.username end,
         case when p.is_incog then null else u.avatar_id end,
         case when p.is_incog then null else u.followers_count end,
         p.mode, p.avatar_id, p.media_url, p.motion_url, p.duration_sec,
         p.is_incog, p.incog_alias,
         p.transcript, p.topic_entity, p.category, p.key_points, p.sentiment, p.ai_summary,
         p.likes_count, p.expiry_tier, p.expires_at, p.created_at,
         greatest(similarity(coalesce(p.topic_entity, ''), q.term),
                  similarity(coalesce(p.transcript, ''), q.term))::real as match_score
  from public.posts p
  join public.users u on u.id = p.user_id
  cross join q
  where char_length(q.term) >= 2
    and (p.expires_at is null or p.expires_at > now())
    and (   p.topic_entity ilike '%' || q.pattern || '%'
         or p.transcript   ilike '%' || q.pattern || '%'
         or p.topic_entity % q.term
         or similarity(coalesce(p.topic_entity, ''), q.term) > 0.3)
  order by p.likes_count desc, match_score desc, p.created_at desc
  limit 200;
$$;

-- Anyone may call them; nothing else changes about who can read what.
revoke all on function public.get_trending_topics(int)   from public;
revoke all on function public.search_posts_fuzzy(text)   from public;
grant execute on function public.get_trending_topics(int) to anon, authenticated;
grant execute on function public.search_posts_fuzzy(text) to anon, authenticated;
