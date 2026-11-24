-- Phase 6: an emotion for every post. Run after supabase/schema.sql. Safe to run more than once.
-- The AI worker (/api/process-post) fills emotion_tag; browsers cannot write it (it is not in their insert grant).

alter table public.posts add column if not exists emotion_tag text;

alter table public.posts drop constraint if exists posts_emotion_tag_valid;
alter table public.posts add constraint posts_emotion_tag_valid
  check (emotion_tag is null or emotion_tag in ('joy', 'angry', 'surprised', 'sad', 'chill'));

create index if not exists posts_topic_emotion_idx on public.posts (topic_entity, emotion_tag);

-- Expose it through the public view. New columns can only be added at the end of a view.
create or replace view public.public_posts as
select
  p.id,
  case when p.is_incog then null else p.user_id end            as user_id,
  p.mode, p.avatar_id, p.media_url, p.motion_url, p.duration_sec,
  p.is_incog, p.incog_alias,
  p.transcript, p.topic_entity, p.sentiment, p.ai_summary,
  p.likes_count, p.expiry_tier, p.expires_at, p.created_at,
  case when p.is_incog then null else u.username end           as creator_username,
  case when p.is_incog then null else u.avatar_id end          as creator_avatar_id,
  case when p.is_incog then null else u.followers_count end    as creator_followers_count,
  p.emotion_tag
from public.posts p
join public.users u on u.id = p.user_id
where p.expires_at is null or p.expires_at > now();

grant select on public.public_posts to anon, authenticated;
