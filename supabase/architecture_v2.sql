-- Install in the Next.js web application's Supabase project. The separate mobile
-- application has a different message schema and uses supabase/migrations instead.
begin;
do $$ begin
  if to_regclass('public.conversations') is not null and not exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='conversations' and column_name='initiator_id'
  ) then raise exception 'This database uses the mobile conversation schema. Choose the web project.'; end if;
end $$;
create schema if not exists extensions;
set local search_path = public, extensions;
create extension if not exists vector with schema extensions;
-- Vybe backend schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- Before using the app: Authentication > Providers > enable "Anonymous sign-ins" (visitors get a private session, no email).
--
-- Privacy model
--   * Every table is locked down with Row-Level Security and column-level grants, so a browser can only do what the
--     policies below allow and can never write counters, AI fields or someone else's rows.
--   * Everyone reads posts through the view `public_posts`. For Incog posts the view blanks out user_id and the
--     creator columns, so an Incog post cannot be traced to its author through the public API.
--   * The AI worker uses the service role key (server only) to write transcript / topic / sentiment / summary.

create extension if not exists pg_trgm with schema extensions;

------------------------------------------------------------------------------------------------------------------
-- users
------------------------------------------------------------------------------------------------------------------
create table if not exists public.users (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null unique
                         check (username ~ '^[a-z0-9_]{3,24}$' and username !~ '^anon_'),
  avatar_id            text not null default 'cyber_monk'
                         check (avatar_id in ('cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot')),
  bio                  text not null default '' check (char_length(bio) <= 200),
  followers_count      int  not null default 0 check (followers_count >= 0),
  following_count      int  not null default 0 check (following_count >= 0),
  total_likes_received int  not null default 0 check (total_likes_received >= 0),
  created_at           timestamptz not null default now()
);

-- Every new auth user (including anonymous sign-ins) gets a profile with a generated @username.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  attempt int := 0;
begin
  loop
    begin
      insert into public.users (id, username)
      values (new.id, 'creator_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      return new;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 5 then raise; end if;
    end;
  end loop;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------------------------------------------
-- posts
------------------------------------------------------------------------------------------------------------------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  mode         text not null check (mode in ('mask', 'blur', 'shadow', 'noface')),
  avatar_id    text check (avatar_id is null or avatar_id in ('cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot')),
  media_url    text not null,
  motion_url   text,
  duration_sec int  not null default 0 check (duration_sec between 0 and 600),
  is_incog     boolean not null default false,
  incog_alias  text,
  transcript   text,
  topic_entity text,
  sentiment    text check (sentiment in ('positive', 'negative', 'neutral')),
  emotion_tag  text check (emotion_tag is null or emotion_tag in ('joy', 'angry', 'surprised', 'sad', 'chill')),
  ai_summary   text,
  likes_count  int  not null default 0 check (likes_count >= 0),
  expiry_tier  text not null default '1d' check (expiry_tier in ('1d', '1w', '1y', 'never')),
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (is_incog = (incog_alias is not null)),
  check ((mode = 'mask') = (motion_url is not null))
);

alter table public.posts add column if not exists emotion_tag text;
alter table public.posts add column if not exists category text not null default 'general';
alter table public.posts add column if not exists key_points text[] not null default '{}';

-- The server decides what the client must not: expiry, the Incog rules, the free-tier permanent limit.
create or replace function public.posts_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  permanent_posts int;
begin
  if new.is_incog then
    new.expiry_tier := '1d'; -- burner posts always disappear after a day
    if new.incog_alias is null or new.incog_alias !~ '^Anon_[A-Z0-9]{3,8}$' then
      new.incog_alias := 'Anon_' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    end if;
  else
    new.incog_alias := null;
  end if;

  new.expires_at := case new.expiry_tier
    when '1d' then now() + interval '1 day'
    when '1w' then now() + interval '7 days'
    when '1y' then now() + interval '365 days'
    else null
  end;

  if new.expiry_tier = 'never' then
    select count(*) into permanent_posts from public.posts where user_id = new.user_id and expiry_tier = 'never';
    if permanent_posts >= 5 then
      raise exception 'Free accounts keep up to 5 permanent posts.' using errcode = 'P0001';
    end if;
  end if;

  new.created_at   := now();
  new.likes_count  := 0;
  new.transcript   := null;
  new.topic_entity := nullif(trim(new.topic_entity),'');
  if length(new.topic_entity)>120 then raise exception 'Topic too long'; end if;
  new.sentiment    := null;
  new.ai_summary   := null;
  return new;
end $$;

drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert
  before insert on public.posts
  for each row execute function public.posts_before_insert();

create index if not exists posts_topic_sentiment_expiry_idx on public.posts (topic_entity, sentiment, expires_at);
create index if not exists posts_topic_trgm_idx             on public.posts using gin (topic_entity extensions.gin_trgm_ops);
create index if not exists posts_created_idx                on public.posts (created_at desc);
create index if not exists posts_user_created_idx           on public.posts (user_id, created_at desc);

-- Removes expired rows. Run daily, for example: select cron.schedule('purge-posts', '15 3 * * *', 'select public.purge_expired_posts()');
create or replace function public.purge_expired_posts() returns int
language sql security definer set search_path = public as $$
  with gone as (delete from public.posts where expires_at is not null and expires_at <= now() returning 1)
  select count(*)::int from gone;
$$;
revoke all on function public.purge_expired_posts() from public, anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- likes (counters change atomically inside the same transaction as the row)
------------------------------------------------------------------------------------------------------------------
create or replace function public.post_is_live(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where id = target and (expires_at is null or expires_at > now()));
$$;

create table if not exists public.post_likes (
  user_id    uuid not null references public.users (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists post_likes_post_idx on public.post_likes (post_id);

create or replace function public.handle_like_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  creator uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = new.post_id returning user_id into creator;
    update public.users set total_likes_received = total_likes_received + 1 where id = creator;
    return new;
  end if;
  update public.posts set likes_count = greatest(likes_count - 1, 0) where id = old.post_id returning user_id into creator;
  update public.users set total_likes_received = greatest(total_likes_received - 1, 0) where id = creator;
  return old;
end $$;

drop trigger if exists post_likes_counts on public.post_likes;
create trigger post_likes_counts
  after insert or delete on public.post_likes
  for each row execute function public.handle_like_change();

------------------------------------------------------------------------------------------------------------------
-- follows
------------------------------------------------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id  uuid not null references public.users (id) on delete cascade,
  following_id uuid not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);

create or replace function public.handle_follow_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.users set following_count = following_count + 1 where id = new.follower_id;
    update public.users set followers_count = followers_count + 1 where id = new.following_id;
    return new;
  end if;
  update public.users set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  update public.users set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
  return old;
end $$;

drop trigger if exists follows_counts on public.follows;
create trigger follows_counts
  after insert or delete on public.follows
  for each row execute function public.handle_follow_change();

------------------------------------------------------------------------------------------------------------------
-- public read model: live posts only, Incog posts anonymised
------------------------------------------------------------------------------------------------------------------
create or replace view public.public_posts as -- owned by the migration role, so it reads posts past RLS (the default, security_invoker off)
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
  p.emotion_tag, p.category, p.key_points
from public.posts p
join public.users u on u.id = p.user_id
where p.expires_at is null or p.expires_at > now();

------------------------------------------------------------------------------------------------------------------
-- privileges and Row-Level Security
------------------------------------------------------------------------------------------------------------------
revoke all on public.users, public.posts, public.post_likes, public.follows, public.public_posts from anon, authenticated;

alter table public.users      enable row level security;
alter table public.posts      enable row level security;
alter table public.post_likes enable row level security;
alter table public.follows    enable row level security;

-- users: public profiles; a person edits only their own username / avatar / bio. Counters are trigger-only.
grant select on public.users to anon, authenticated;
grant update (username, avatar_id, bio) on public.users to authenticated;
drop policy if exists users_read_all on public.users;
create policy users_read_all on public.users for select using (true);
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- posts: authors insert and read/delete their own rows. Everyone else reads through public_posts.
grant select on public.posts to authenticated;
grant insert (id, user_id, mode, avatar_id, media_url, motion_url, duration_sec, is_incog, incog_alias, expiry_tier)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;
drop policy if exists posts_read_own on public.posts;
create policy posts_read_own on public.posts for select to authenticated using (auth.uid() = user_id);
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete to authenticated using (auth.uid() = user_id);

grant select on public.public_posts to anon, authenticated;

-- likes: a person sees and changes only their own likes, and only on live posts.
grant select, insert, delete on public.post_likes to authenticated;
drop policy if exists likes_read_own on public.post_likes;
create policy likes_read_own on public.post_likes for select to authenticated using (auth.uid() = user_id);
drop policy if exists likes_insert_own on public.post_likes;
create policy likes_insert_own on public.post_likes for insert to authenticated
  with check (auth.uid() = user_id and public.post_is_live(post_id));
drop policy if exists likes_delete_own on public.post_likes;
create policy likes_delete_own on public.post_likes for delete to authenticated using (auth.uid() = user_id);

-- follows: same shape.
grant select, insert, delete on public.follows to authenticated;
drop policy if exists follows_read_own on public.follows;
create policy follows_read_own on public.follows for select to authenticated using (auth.uid() = follower_id);
drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows for insert to authenticated with check (auth.uid() = follower_id);
drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows for delete to authenticated using (auth.uid() = follower_id);

-- Phase 4: like and follow notifications. Run after supabase/schema.sql, in the Supabase SQL editor. Safe to run more than once.
--
-- A database trigger writes the notification in the same transaction as the like or follow, so it can never be skipped
-- or forged by a browser. Browsers can only read their own notifications and mark them read.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users (id) on delete cascade,
  actor_id     uuid not null references public.users (id) on delete cascade,
  type         text not null check (type in ('like', 'follow')),
  post_id      uuid references public.posts (id) on delete cascade,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now(),
  check (recipient_id <> actor_id),
  check ((type = 'like') = (post_id is not null))
);

-- One notification per person per like / follow: liking, unliking and liking again cannot spam the recipient.
create unique index if not exists notifications_dedupe_idx
  on public.notifications (recipient_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (recipient_id) where not is_read;

------------------------------------------------------------------------------------------------------------------
-- triggers: create on like / follow, remove again on unlike / unfollow
------------------------------------------------------------------------------------------------------------------
create or replace function public.notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  if tg_op = 'INSERT' then
    select user_id into owner from public.posts where id = new.post_id;
    if owner is not null and owner <> new.user_id then -- liking your own post notifies nobody
      insert into public.notifications (recipient_id, actor_id, type, post_id)
      values (owner, new.user_id, 'like', new.post_id)
      on conflict do nothing;
    end if;
    return new;
  end if;
  delete from public.notifications where type = 'like' and actor_id = old.user_id and post_id = old.post_id;
  return old;
end $$;

create or replace function public.notify_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (recipient_id, actor_id, type)
    values (new.following_id, new.follower_id, 'follow')
    on conflict do nothing;
    return new;
  end if;
  delete from public.notifications where type = 'follow' and actor_id = old.follower_id and recipient_id = old.following_id;
  return old;
end $$;

drop trigger if exists post_likes_notify on public.post_likes;
create trigger post_likes_notify after insert or delete on public.post_likes
  for each row execute function public.notify_like();

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert or delete on public.follows
  for each row execute function public.notify_follow();

------------------------------------------------------------------------------------------------------------------
-- privileges and Row-Level Security: read own, mark own as read, nothing else
------------------------------------------------------------------------------------------------------------------
revoke all on public.notifications from anon, authenticated;
alter table public.notifications enable row level security;

grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

------------------------------------------------------------------------------------------------------------------
-- Realtime: browsers receive new rows live (Realtime applies the select policy, so each person only gets their own)
------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Phase 5: 1-on-1 chat with message requests, disappearing snaps, and 24-hour stories.
-- Run after supabase/schema.sql, in the Supabase SQL editor. Safe to run more than once.
--
-- Rules the database enforces (the browser cannot skip them):
--   * A conversation starts as a request: the person who starts it adds a short note saying why, and nobody can send
--     messages until the other person accepts. Only the other person can accept; either person can delete it.
--   * Only the two participants can read or write a conversation and its messages.
--   * A snap can be opened once. Only the receiver marks it viewed, and the time is set by the server.
--   * Message and story timestamps and expiry are set by the server, so a client cannot keep content longer.
--
-- Extra column beyond the brief: messages.story_id (nullable), so a story reply knows which story it answers.

------------------------------------------------------------------------------------------------------------------
-- helpers (SECURITY DEFINER so policies can ask about conversations without recursing into their own RLS)
------------------------------------------------------------------------------------------------------------------
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.users (id) on delete cascade,
  user_b          uuid not null references public.users (id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'accepted')),
  initiator_id    uuid not null references public.users (id) on delete cascade,
  request_note    text check (request_note is null or char_length(request_note) <= 200),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check (user_a <> user_b),
  check (initiator_id in (user_a, user_b))
);

-- One conversation per pair of people, whichever way round they are stored.
create unique index if not exists conversations_pair_idx
  on public.conversations (least(user_a, user_b), greatest(user_a, user_b));
create index if not exists conversations_user_a_idx on public.conversations (user_a, last_message_at desc);
create index if not exists conversations_user_b_idx on public.conversations (user_b, last_message_at desc);

create or replace function public.is_participant(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c where c.id = conv and auth.uid() in (c.user_a, c.user_b));
$$;

create or replace function public.can_send_in(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv and c.status = 'accepted' and auth.uid() in (c.user_a, c.user_b)
  );
$$;

-- Stops one person from mass-requesting strangers: at most 20 requests waiting for an answer.
create or replace function public.conversations_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  waiting int;
begin
  perform 1 from public.users where id=new.initiator_id for update;
  new.status          := 'pending';
  new.created_at      := now();
  new.last_message_at := now();
  new.request_note    := nullif(btrim(coalesce(new.request_note, '')), '');
  select count(*) into waiting from public.conversations where initiator_id = new.initiator_id and status = 'pending';
  if waiting >= 20 then
    raise exception 'Too many message requests are waiting for an answer.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists conversations_before_insert on public.conversations;
create trigger conversations_before_insert before insert on public.conversations
  for each row execute function public.conversations_before_insert();

------------------------------------------------------------------------------------------------------------------
-- stories (created before messages, which may point at one)
------------------------------------------------------------------------------------------------------------------
create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  mode       text not null check (mode in ('mask', 'blur', 'shadow', 'noface')),
  avatar_id  text check (avatar_id is null or avatar_id in ('cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot')),
  media_url  text not null,
  motion_url text,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  check ((mode = 'mask') = (motion_url is not null)),
  check ((mode = 'mask') = (avatar_id is not null))
);
create index if not exists stories_expires_idx      on public.stories (expires_at);
create index if not exists stories_user_created_idx on public.stories (user_id, created_at desc);

create or replace function public.stories_before_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  new.expires_at := now() + interval '24 hours'; -- not up to the client
  return new;
end $$;

drop trigger if exists stories_before_insert on public.stories;
create trigger stories_before_insert before insert on public.stories
  for each row execute function public.stories_before_insert();

------------------------------------------------------------------------------------------------------------------
-- messages
------------------------------------------------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.users (id) on delete cascade,
  type            text not null check (type in ('text', 'snap', 'story_reply')),
  content         text,
  snap_mode       text check (snap_mode is null or snap_mode in ('mask', 'blur', 'shadow', 'noface')),
  avatar_id       text check (avatar_id is null or avatar_id in ('cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot')),
  media_url       text,
  motion_url      text,
  story_id        uuid references public.stories (id) on delete set null,
  viewed_at       timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  check (
    (type = 'text'
       and content is not null and char_length(btrim(content)) between 1 and 2000
       and media_url is null and snap_mode is null and story_id is null)
    or (type = 'snap'
       and media_url is not null and snap_mode is not null
       and ((snap_mode = 'mask') = (motion_url is not null))
       and ((snap_mode = 'mask') = (avatar_id is not null)))
    or (type = 'story_reply'
       and content is not null and char_length(btrim(content)) between 1 and 500
       and media_url is null and snap_mode is null)
  )
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;

-- privileges and Row-Level Security
------------------------------------------------------------------------------------------------------------------
revoke all on public.conversations, public.messages, public.stories from anon, authenticated;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.stories       enable row level security;

-- conversations: start one as yourself, accept one that was sent to you, delete one you are in.
grant select, delete on public.conversations to authenticated;
grant insert (id, user_a, user_b, initiator_id, request_note) on public.conversations to authenticated;
grant update (status) on public.conversations to authenticated;

drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert to authenticated
  with check (auth.uid() = initiator_id and auth.uid() in (user_a, user_b));

drop policy if exists conversations_accept on public.conversations;
create policy conversations_accept on public.conversations for update to authenticated
  using (auth.uid() in (user_a, user_b) and auth.uid() <> initiator_id and status = 'pending')
  with check (status = 'accepted' and auth.uid() in (user_a, user_b) and auth.uid() <> initiator_id);

drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations for delete to authenticated
  using (auth.uid() in (user_a, user_b));

-- messages: read your conversations' live messages; send only as yourself, only once accepted; only the receiver marks viewed.
grant select on public.messages to authenticated;
grant insert (id, conversation_id, sender_id, type, content, snap_mode, avatar_id, media_url, motion_url, story_id)
  on public.messages to authenticated;


drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (public.is_participant(conversation_id) and (expires_at is null or expires_at > now()));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_send_in(conversation_id));

-- stories: signed-in people see live stories and post or delete their own.
grant select, delete on public.stories to authenticated;
grant insert (id, user_id, mode, avatar_id, media_url, motion_url) on public.stories to authenticated;

drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories for select to authenticated using (expires_at > now());

drop policy if exists stories_insert on public.stories;
create policy stories_insert on public.stories for insert to authenticated with check (user_id = auth.uid());

drop policy if exists stories_delete on public.stories;
create policy stories_delete on public.stories for delete to authenticated using (user_id = auth.uid());

------------------------------------------------------------------------------------------------------------------
-- Realtime: new messages, opened snaps, accepted requests arrive live (Realtime applies the select policies above)
------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'conversations'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Phase 3: custom persona and avatar. Run after supabase/schema.sql, in the Supabase SQL editor. Safe to run more than once.
--
-- Both fields are shown to other people (their phones download the .glb and read the style), so the database checks
-- them instead of trusting the browser: the avatar URL must be the person's own file under avatars/<their id>/custom.glb,
-- and persona_style must have exactly the expected shape, ranges and a small size.

alter table public.users add column if not exists custom_avatar_url text;
alter table public.users add column if not exists persona_style     jsonb;

------------------------------------------------------------------------------------------------------------------
-- persona_style validation (mirrors PersonaStyle in src/types/persona.ts)
------------------------------------------------------------------------------------------------------------------
create or replace function public.is_valid_persona_style(style jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  tilt jsonb;
  i int;
begin
  if style is null then return true; end if;
  if jsonb_typeof(style) <> 'object' or octet_length(style::text) > 2048 then return false; end if;
  if (select count(*) from jsonb_object_keys(style)) <> 5 then return false; end if;

  if jsonb_typeof(style -> 'handSpeedMultiplier') <> 'number'
     or (style ->> 'handSpeedMultiplier')::numeric not between 0.5 and 2.0 then return false; end if;
  if jsonb_typeof(style -> 'expressionGain') <> 'number'
     or (style ->> 'expressionGain')::numeric not between 0.8 and 1.6 then return false; end if;
  if jsonb_typeof(style -> 'dominantHand') <> 'string'
     or (style ->> 'dominantHand') not in ('left', 'right', 'both') then return false; end if;
  if jsonb_typeof(style -> 'calibratedAt') <> 'string'
     or char_length(style ->> 'calibratedAt') > 40 then return false; end if;

  tilt := style -> 'restingHeadTilt';
  if jsonb_typeof(tilt) <> 'array' or jsonb_array_length(tilt) <> 3 then return false; end if;
  for i in 0..2 loop
    if jsonb_typeof(tilt -> i) <> 'number' or (tilt ->> i)::numeric not between -1.0 and 1.0 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end $$;

alter table public.users drop constraint if exists users_persona_style_valid;
alter table public.users add  constraint users_persona_style_valid check (public.is_valid_persona_style(persona_style));

-- The avatar must be the owner's own upload: https://<anything>/avatars/<this user's id>/custom.glb, optionally ?v=<number>.
alter table public.users drop constraint if exists users_custom_avatar_url_valid;
alter table public.users add  constraint users_custom_avatar_url_valid check (
  custom_avatar_url is null
  or (
    char_length(custom_avatar_url) <= 500
    and custom_avatar_url ~ ('^https://[^/?#]+(/[^?#]*)?/avatars/' || id::text || '/custom\.glb(\?v=[0-9]+)?$')
  )
);

------------------------------------------------------------------------------------------------------------------
-- who may change them
------------------------------------------------------------------------------------------------------------------
-- The existing policy users_update_own already limits UPDATE to the person's own row. Column grants decide which
-- columns, so the two new ones are added to the list a person may edit (counters stay trigger-only).
grant update (username, avatar_id, bio, custom_avatar_url, persona_style) on public.users to authenticated;

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Additional read models and per-subject, server-maintained counters.
alter table public.users add column if not exists snap_score bigint not null default 0;
alter table public.posts add column if not exists embedding vector(768);
alter table public.posts add column if not exists search_tsv tsvector generated always as (
  setweight(to_tsvector('simple', coalesce(topic_entity,'')), 'A') ||
  setweight(to_tsvector('simple', coalesce(ai_summary,'')), 'B') ||
  setweight(to_tsvector('simple', coalesce(transcript,'')), 'C')
) stored;
create index if not exists posts_search_tsv on public.posts using gin(search_tsv);
create index if not exists posts_embedding_cosine on public.posts using hnsw(embedding vector_cosine_ops);
create index if not exists notifications_actor_fk on public.notifications(actor_id);
create index if not exists notifications_post_fk on public.notifications(post_id);
create index if not exists conversations_initiator_fk on public.conversations(initiator_id,status);
create index if not exists messages_story_fk on public.messages(story_id);
create index if not exists messages_sender_fk on public.messages(sender_id);

create table if not exists public.post_events (
  id uuid primary key, user_id uuid not null references public.users on delete cascade,
  post_id uuid not null references public.posts on delete cascade,
  event_type text not null check(event_type in ('impression','watch_time_ms','video_duration_ms',
    'completion_rate','rewatch_count','fast_skip','like','unlike','share','profile_visit','follow_from_post','not_interested')),
  value double precision not null check(value between 0 and 86400000),
  created_at timestamptz not null default now()
);
create index if not exists post_events_post on public.post_events(post_id,created_at desc);
create index if not exists post_events_user on public.post_events(user_id,created_at desc);
create index if not exists post_events_time on public.post_events(created_at);
create table if not exists public.user_seen_posts (
  user_id uuid not null references public.users on delete cascade,
  post_id uuid not null references public.posts on delete cascade,
  seen_at timestamptz not null default now(), primary key(user_id,post_id)
);
create index if not exists user_seen_posts_post on public.user_seen_posts(post_id);
create table if not exists public.user_affinity_scores (
  user_id uuid not null references public.users on delete cascade,
  kind text not null check (kind in ('topic','emotion','creator')), entity text not null,
  score double precision not null default 0, hidden boolean not null default false,
  primary key(user_id,kind,entity)
);
-- Raw searches are never published. Suggestions use aggregated, repeated terms.
create table if not exists public.search_queries (
  user_id uuid not null references public.users on delete cascade,
  query text not null check(length(query) between 2 and 120),
  hits bigint not null default 1, updated_at timestamptz not null default now(),
  primary key(user_id,query)
);
create index if not exists search_queries_term on public.search_queries using gin(query gin_trgm_ops);
create table if not exists public.api_rate_windows (
  user_id uuid not null references public.users on delete cascade,
  action text not null, minute timestamptz not null, hits integer not null, primary key(user_id,action)
);
create table if not exists public.post_metrics (
  post_id uuid primary key references public.posts on delete cascade,
  impressions bigint not null default 0, completions float8 not null default 0,
  rewatches float8 not null default 0, shares bigint not null default 0,
  follows bigint not null default 0, skips bigint not null default 0
);
create table if not exists public.post_watch_hours (
  post_id uuid not null references public.posts on delete cascade,
  hour timestamptz not null, watch_ms float8 not null, primary key(post_id,hour)
);
create index if not exists post_watch_hours_time on public.post_watch_hours(hour);
do $$
declare t text;
begin
  foreach t in array array['post_events','user_seen_posts','user_affinity_scores','search_queries',
                           'api_rate_windows','post_metrics','post_watch_hours'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    -- Internal aggregate rows are accessible only by the migration owner or service role.
    execute format('drop policy if exists service_only on public.%I',t);
    execute format('create policy service_only on public.%I to service_role using(true) with check(true)',t);
  end loop;
end $$;

create or replace function public.check_api_rate_limit(p_user_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare quota integer; admitted integer;
begin
  quota := case p_action when 'upload-url' then 60 when 'process-post' then 8 when 'search' then 30 end;
  if quota is null then return false; end if;
  insert into public.api_rate_windows as w(user_id,action,minute,hits)
    values(p_user_id,p_action,date_trunc('minute',statement_timestamp()),1)
  on conflict(user_id,action) do update set minute=excluded.minute,
    hits=case when w.minute<excluded.minute then 1 else w.hits+1 end
    where w.minute<excluded.minute or w.hits<quota returning hits into admitted;
  return admitted is not null;
end $$;
revoke all on function public.check_api_rate_limit(uuid,text) from public,anon,authenticated;
grant execute on function public.check_api_rate_limit(uuid,text) to service_role;

create or replace function public.ingest_post_events(p_events jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid := auth.uid(); e record; matched integer; weight float8; 
begin
  if uid is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events)>100 then
    raise exception 'Invalid telemetry batch'; end if;
  for e in select v.*, p.topic_entity,p.emotion_tag,p.user_id as author
      from jsonb_to_recordset(p_events) v(id uuid,post_id uuid,event_type text,value float8)
      join public.posts p on p.id=v.post_id and (p.expires_at is null or p.expires_at>now())
      order by p.id,v.id loop
    insert into public.post_events(id,user_id,post_id,event_type,value)
      values(e.id,uid,e.post_id,e.event_type,e.value) on conflict do nothing;
    get diagnostics matched = row_count;
    if matched=0 then continue; end if;
    if e.event_type in ('impression','not_interested','fast_skip') then
      insert into public.user_seen_posts values(uid,e.post_id,now()) on conflict do nothing;
    end if;
    insert into public.post_metrics as m(post_id,impressions,completions,rewatches,shares,follows,skips)
      values(e.post_id,(e.event_type='impression')::int,
        case when e.event_type='completion_rate' then least(e.value,10) else 0 end,
        case when e.event_type='rewatch_count' then least(e.value,10) else 0 end,
        (e.event_type='share')::int,(e.event_type='follow_from_post')::int,(e.event_type='fast_skip')::int)
      on conflict(post_id) do update set impressions=m.impressions+excluded.impressions,
        completions=m.completions+excluded.completions,rewatches=m.rewatches+excluded.rewatches,
        shares=m.shares+excluded.shares,follows=m.follows+excluded.follows,skips=m.skips+excluded.skips;
    if e.event_type='watch_time_ms' then
      insert into public.post_watch_hours as h values(e.post_id,date_trunc('hour',now()),least(e.value,600000))
        on conflict(post_id,hour) do update set watch_ms=h.watch_ms+excluded.watch_ms;
    end if;
    weight := case e.event_type when 'not_interested' then -20 when 'fast_skip' then -2
      when 'unlike' then -2 when 'like' then 2 when 'share' then 5 when 'follow_from_post' then 6
      when 'profile_visit' then 1 when 'completion_rate' then least(2,e.value) else 0 end;
    if weight<>0 then
      insert into public.user_affinity_scores as a(user_id,kind,entity,score,hidden)
        select uid,k,v,weight,e.event_type='not_interested' and k in('topic','creator')
        from (values ('topic',lower(e.topic_entity)),('creator',e.author::text),('emotion',e.emotion_tag)) x(k,v)
        where v is not null order by k,v
        on conflict(user_id,kind,entity) do update set score=greatest(-100,least(100,a.score+excluded.score)),
          hidden=a.hidden or excluded.hidden;
    end if;
  end loop;
end $$;

create or replace function public.log_search_query(p_query text)
returns void language sql security definer set search_path=pg_catalog,public as $$
  insert into public.search_queries as s(user_id,query)
    select auth.uid(),lower(trim(p_query)) where auth.uid() is not null and length(trim(p_query)) between 2 and 120
    on conflict(user_id,query) do update set hits=s.hits+1,updated_at=now();
$$;

create or replace function public.get_trending_velocity(p_limit integer default 10)
returns table(topic_entity text,velocity float8,total_posts bigint,positive_count bigint,negative_count bigint)
language sql stable security definer set search_path=pg_catalog,public as $$
  with live as (
    select p.id,p.topic_entity,p.sentiment,p.created_at from public.posts p
    where p.topic_entity is not null and (p.expires_at is null or p.expires_at>now())
  ), activity as (
    select w.post_id,sum(w.watch_ms)/60000.0 as minutes48,
      coalesce(sum(w.watch_ms) filter(where w.hour>=now()-interval '6 hours'),0)/60000.0 as minutes6
    from public.post_watch_hours w where w.hour>=now()-interval '48 hours' group by w.post_id
  ), counts as (
    select l.topic_entity,count(*) as total_posts,count(*) filter(where l.sentiment='positive') as pos,
      count(*) filter(where l.sentiment='negative') as neg,
      count(*) filter(where l.created_at>=now()-interval '6 hours')+coalesce(sum(a.minutes6),0) as hot,
      count(*) filter(where l.created_at>=now()-interval '48 hours')+coalesce(sum(a.minutes48),0) as baseline
    from live l left join activity a on a.post_id=l.id group by l.topic_entity
  ) select c.topic_entity,(c.hot/(1+c.baseline/8))::float8,c.total_posts,c.pos,c.neg from counts c
    where c.baseline>0 order by 2 desc,3 desc,1 limit greatest(1,least(100,p_limit));
$$;

create or replace function public.get_ranked_feed(p_user_id uuid,p_cursor timestamptz default null,
 p_limit integer default 20,p_seen_ids uuid[] default '{}',p_downrank_topics text[] default '{}')
returns setof public.public_posts language sql stable security definer set search_path=pg_catalog,public as $$
 with candidates as materialized (
  select p.id,p.created_at,p.topic_entity,coalesce(m.impressions,0) as views,
    ((3*coalesce(m.completions,0)+4*coalesce(m.rewatches,0)+2*p.likes_count+
      5*coalesce(m.shares,0)+6*coalesce(m.follows,0)-4.5*coalesce(m.skips,0)) /
      greatest(coalesce(m.impressions,0),1)) /
      power(greatest(0,extract(epoch from(now()-p.created_at))/3600)+2,1.4)
      + coalesce(t.score,0)+coalesce(e.score,0)+coalesce(a.score,0)+case when f.follower_id is null then 0 else 4 end as score
  from public.posts p left join public.post_metrics m on m.post_id=p.id
  left join public.user_affinity_scores t on t.user_id=p_user_id and t.kind='topic' and t.entity=lower(p.topic_entity)
  left join public.user_affinity_scores e on e.user_id=p_user_id and e.kind='emotion' and e.entity=p.emotion_tag
  left join public.user_affinity_scores a on a.user_id=p_user_id and a.kind='creator' and a.entity=p.user_id::text
  left join public.follows f on f.follower_id=p_user_id and f.following_id=p.user_id
  where p_user_id is not distinct from auth.uid() and p.created_at<=coalesce(p_cursor,now())
    and (p.expires_at is null or p.expires_at>now()) and not coalesce(t.hidden,false) and not coalesce(a.hidden,false)
    and not exists(select 1 from unnest(p_downrank_topics) d where lower(d)=lower(p.topic_entity))
    and not (p.id=any(coalesce(p_seen_ids,'{}'))) and not exists(
      select 1 from public.user_seen_posts s where s.user_id=p_user_id and s.post_id=p.id)
 ), limits as(select greatest(1,least(100,p_limit)) n),
 cold as (
   select id from candidates where views<100 and created_at>now()-interval '7 days'
   order by created_at desc,id limit (select round(n*0.2) from limits)
 ), hot as (
   select c.id from candidates c join public.get_trending_velocity(100) t using(topic_entity)
   where c.id not in(select id from cold) order by t.velocity desc,c.score desc,c.id
   limit (select round(n*0.1) from limits)
 ), pooled as (
   select c.id,c.score,case when c.id in(select id from cold) then 1 when c.id in(select id from hot) then 2 else 0 end as lane
   from candidates c
 ), numbered as (
   select id,lane,row_number() over(partition by lane order by score desc,id) as seq from pooled
 ), ordered as (
   select id,case lane when 0 then (seq-1)/7*10+(array[1,2,3,5,6,8,9])[((seq-1)%7+1)::int]
     when 1 then (seq-1)/2*10+(array[4,7])[((seq-1)%2+1)::int] else seq*10 end as slot
   from numbered
 ) select v.* from ordered o join public.public_posts v on v.id=o.id order by o.slot,o.id
 limit (select n from limits);
$$;

create or replace function public.search_hybrid(p_query text,p_embedding vector(768) default null,
  p_sentiment text default null,p_emotion text default null,p_limit integer default 30)
returns setof public.public_posts language sql stable security definer set search_path=pg_catalog,public,extensions as $$
  with params as (select left(trim(p_query),500) term,greatest(1,least(100,p_limit)) n),
  eligible as not materialized (
    select p.* from public.posts p where (p.expires_at is null or p.expires_at>now())
      and (p_sentiment is null or p.sentiment=p_sentiment) and (p_emotion is null or p.emotion_tag=p_emotion)
  ), lexical as (
    select p.id,ts_rank_cd(p.search_tsv,q.tsq) score from eligible p
    cross join (select websearch_to_tsquery('simple',term) tsq from params) q
    where p.search_tsv @@ q.tsq order by score desc,p.id limit(select n*4 from params)
  ), fuzzy as (
    select p.id,similarity(p.topic_entity,q.term) score from eligible p cross join params q
    where p.topic_entity % q.term order by score desc,p.id limit(select n*4 from params)
  ), semantic as (
    select p.id,p.embedding <=> p_embedding as distance from eligible p where p_embedding is not null
      and p.embedding is not null order by p.embedding <=> p_embedding limit(select n*4 from params)
  ), ranks as (
    select id,row_number() over(order by score desc,id) r from lexical union all
    select id,row_number() over(order by score desc,id) from fuzzy union all
    select id,row_number() over(order by distance,id) from semantic
  ), fusion as (
    select id,sum(1.0/(60+r)) score from ranks group by id
  ) select v.* from fusion f join public.public_posts v using(id)
    left join public.post_metrics m on m.post_id=f.id
    order by f.score*(1+least(0.1,ln(1+v.likes_count)*0.01)+least(0.1,0.05*coalesce(m.completions,0)/greatest(m.impressions,1))) desc,v.id
    limit (select n from params);
$$;
create index if not exists posts_topic_prefix on public.posts(lower(topic_entity) text_pattern_ops);
create index if not exists search_queries_prefix on public.search_queries(query text_pattern_ops);
create or replace function public.suggest_topics(p_query text,p_limit integer default 8)
returns table(topic_entity text) language sql stable security definer set search_path=pg_catalog,public,extensions as $$
  with q as(select lower(left(trim(p_query),120)) term),
  topics as (
    select p.topic_entity,count(*)+count(*) filter(where p.created_at>=now()-interval '6 hours')*2 as weight
    from public.posts p,q where length(q.term)>=1 and (p.expires_at is null or p.expires_at>now())
      and (starts_with(lower(p.topic_entity),q.term) or p.topic_entity % q.term) group by p.topic_entity
  ), popular as (
    select s.query,sum(least(5,s.hits)) weight from public.search_queries s,q
    where length(q.term)>=1 and starts_with(s.query,q.term) and s.updated_at>now()-interval '30 days'
      group by s.query having count(*)>=3
  ) select t.topic_entity from (select * from topics union all select * from popular) t
    group by t.topic_entity order by sum(t.weight) desc,t.topic_entity limit greatest(1,least(20,p_limit));
$$;

alter table public.posts add column if not exists processing_lease_until timestamptz;
grant insert(topic_entity) on public.posts to authenticated;

alter table public.conversations
  add column if not exists retention_mode text not null default 'after_viewing' check(retention_mode in('after_viewing','24h')),
  add column if not exists streak_count integer not null default 0,
  add column if not exists streak_updated_at timestamptz,
  add column if not exists user_a_last_snap_at timestamptz,
  add column if not exists user_b_last_snap_at timestamptz,
  add column if not exists user_a_left_at timestamptz,
  add column if not exists user_b_left_at timestamptz,
  add column if not exists user_a_unread integer not null default 0,
  add column if not exists user_b_unread integer not null default 0;
alter table public.messages
  add column if not exists client_msg_id uuid,
  add column if not exists status text not null default 'sent' check(status in('sent','delivered','opened')),
  add column if not exists is_saved boolean not null default false,
  add column if not exists r2_key text,
  add column if not exists motion_r2_key text,
  add column if not exists max_views integer not null default 1,
  add column if not exists view_count integer not null default 0,
  add column if not exists replayed_by_recipient boolean not null default false,
  add column if not exists replay_session_id uuid;
-- Remove the old "any UPDATE means viewed" trigger before backfilling or changing delivery states.
drop trigger if exists messages_before_update on public.messages;
update public.messages set client_msg_id=id where client_msg_id is null;
alter table public.messages alter column client_msg_id set default gen_random_uuid(),
  alter column client_msg_id set not null;
create unique index if not exists messages_client_msg_id_uq on public.messages(client_msg_id);
update public.messages set status='opened',view_count=case when type='snap' then greatest(1,view_count) else view_count end
  where viewed_at is not null and status<>'opened';

alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check check(type in('snap','text','story_reply','system_alert'));
alter table public.messages drop constraint if exists messages_check;
alter table public.messages drop constraint if exists messages_payload_v2;
-- Previously stored snaps keep their legacy media fields. The insert trigger requires
-- private object keys for every new snap. Sending an external media URL is disallowed.
alter table public.messages add constraint messages_payload_v2 check(
  case type
    when 'snap' then snap_mode is not null and content is null and story_id is null
      and (r2_key is not null or media_url is not null)
      and ((snap_mode='mask')=(coalesce(motion_r2_key,motion_url) is not null))
      and ((snap_mode='mask')=(avatar_id is not null))
    when 'story_reply' then content is not null and length(trim(content)) between 1 and 500 and r2_key is null and media_url is null
    else content is not null and length(trim(content)) between 1 and 2000 and r2_key is null and media_url is null and story_id is null
  end
);
create index if not exists messages_unread on public.messages(conversation_id,sender_id) where viewed_at is null;
create index if not exists messages_retention on public.messages(expires_at) where not is_saved;

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.conversations; story_owner uuid;
begin
  select * into strict c from public.conversations where id=new.conversation_id for update;
  if c.status<>'accepted' or new.sender_id not in(c.user_a,c.user_b) then raise exception 'Conversation not accepted'; end if;
  if new.type='snap' then
    if new.r2_key is null or new.r2_key !~ ('^snaps/1d/'||new.sender_id::text||'/[a-zA-Z0-9._-]+$')
      or (new.motion_r2_key is not null and new.motion_r2_key !~ ('^snaps/1d/'||new.sender_id::text||'/[a-zA-Z0-9._-]+$'))
      or new.media_url is not null or new.motion_url is not null then raise exception 'Invalid private object keys'; end if;
  elsif new.motion_r2_key is not null or new.motion_url is not null or new.avatar_id is not null or new.snap_mode is not null then
    raise exception 'Invalid message payload';
  end if;
  if new.type='system_alert' and new.content not in(
    'Screenshot key pressed while viewing a snap.','Viewer left the screen while a snap was open.'
  ) then raise exception 'Invalid system alert'; end if;
  if new.type='story_reply' then
    select user_id into story_owner from public.stories where id=new.story_id and expires_at>now();
    if story_owner is null or story_owner=new.sender_id or story_owner not in(c.user_a,c.user_b) then
      raise exception 'Invalid story reply'; end if;
  end if;
  new.created_at:=clock_timestamp(); new.status:='sent'; new.viewed_at:=null;
  new.is_saved:=false; new.max_views:=1; new.view_count:=0; new.replayed_by_recipient:=false; new.replay_session_id:=null;
  new.expires_at:=case when new.type='snap' or c.retention_mode='24h' then new.created_at+interval '24 hours' end;
  return new;
end $$;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.conversations; a_time timestamptz; b_time timestamptz; paired boolean;
begin
  select * into strict c from public.conversations where id=new.conversation_id for update;
  a_time:=case when new.type='snap' and new.sender_id=c.user_a then new.created_at else c.user_a_last_snap_at end;
  b_time:=case when new.type='snap' and new.sender_id=c.user_b then new.created_at else c.user_b_last_snap_at end;
  paired:=new.type='snap' and a_time>=new.created_at-interval '24 hours' and b_time>=new.created_at-interval '24 hours'
    and least(a_time,b_time)>coalesce(c.streak_updated_at,'-infinity'::timestamptz)
    and (c.streak_updated_at is null or (c.streak_updated_at at time zone 'UTC')::date < (new.created_at at time zone 'UTC')::date);
  update public.conversations set last_message_at=greatest(last_message_at,new.created_at),
    user_a_unread=user_a_unread+(new.sender_id=c.user_b)::int,user_b_unread=user_b_unread+(new.sender_id=c.user_a)::int,
    user_a_last_snap_at=a_time,user_b_last_snap_at=b_time,
    streak_count=case when paired then case when c.streak_updated_at>=new.created_at-interval '24 hours'
       then c.streak_count+1 else 1 end when c.streak_updated_at<new.created_at-interval '24 hours' then 0 else c.streak_count end,
    streak_updated_at=case when paired then new.created_at else c.streak_updated_at end where id=c.id;
  if new.type='snap' then update public.users set snap_score=snap_score+1 where id=new.sender_id; end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.sync_message_unread() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.viewed_at is null and (tg_op='DELETE' or new.viewed_at is not null) then
    update public.conversations set user_a_unread=greatest(0,user_a_unread-(old.sender_id=user_b)::int),
      user_b_unread=greatest(0,user_b_unread-(old.sender_id=user_a)::int) where id=old.conversation_id;
  end if;
  return null;
end $$;
drop trigger if exists messages_sync_unread on public.messages;
create trigger messages_sync_unread after update of viewed_at or delete on public.messages
  for each row execute function public.sync_message_unread();
update public.conversations c set (user_a_unread,user_b_unread)=(
  select count(*) filter(where m.sender_id=c.user_b)::int,count(*) filter(where m.sender_id=c.user_a)::int
  from public.messages m where m.conversation_id=c.id and m.viewed_at is null
);
-- Private keys identify objects but cannot authorize reads. The replay session token must
-- remain private to the caller; store only a one-way fingerprint, never the bearer token.
revoke update(viewed_at) on public.messages from authenticated;
drop policy if exists messages_mark_viewed on public.messages;
grant insert(client_msg_id,r2_key,motion_r2_key) on public.messages to authenticated;
create or replace function public.consume_snap_view(p_message_id uuid,p_user_id uuid,p_session_id uuid default null)
returns table(r2_key text,motion_r2_key text,view_count int,replayed_by_recipient boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Serialize opens, read receipts, retention changes and cleanup on the conversation row.
 perform 1 from public.conversations c join public.messages m on m.conversation_id=c.id
   where m.id=p_message_id and c.status='accepted' and p_user_id=auth.uid()
     and p_user_id in(c.user_a,c.user_b) and m.sender_id<>p_user_id
   for update of c;
 if not found then return; end if;
 return query update public.messages m set
   view_count=m.view_count+1, viewed_at=coalesce(m.viewed_at,clock_timestamp()),status='opened',
   replayed_by_recipient=m.view_count>=m.max_views,
   replay_session_id=case when m.view_count=0 and p_session_id is not null then md5(p_session_id::text)::uuid else m.replay_session_id end,
   expires_at=least(m.expires_at,now()+interval '1 minute')
 from public.conversations c where m.id=p_message_id and m.conversation_id=c.id and c.status='accepted'
   and p_user_id=auth.uid() and p_user_id in(c.user_a,c.user_b) and m.sender_id<>p_user_id
   and m.type='snap' and m.r2_key is not null and m.expires_at>now()
   and (m.view_count<m.max_views or (m.view_count=m.max_views and not m.replayed_by_recipient and
     p_session_id is not null and m.replay_session_id=md5(p_session_id::text)::uuid))
 returning m.r2_key,m.motion_r2_key,m.view_count,m.replayed_by_recipient;
end $$;

create or replace function public.mark_message(p_message_id uuid,p_status text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_status not in('delivered','opened') then raise exception 'Invalid message state'; end if;
 perform 1 from public.conversations c join public.messages m on m.conversation_id=c.id
   where m.id=p_message_id and c.status='accepted' and auth.uid() in(c.user_a,c.user_b)
     and m.sender_id<>auth.uid() for update of c;
 if not found then return; end if;
 update public.messages m set status=p_status,
   viewed_at=case when p_status='opened' then coalesce(viewed_at,clock_timestamp()) else viewed_at end
 from public.conversations c where m.id=p_message_id and m.conversation_id=c.id and auth.uid() in(c.user_a,c.user_b)
   and m.sender_id<>auth.uid() and (m.expires_at is null or m.expires_at>now())
   and ((p_status='delivered' and m.status='sent') or (p_status='opened' and m.status<>'opened' and m.type<>'snap'));
end $$;
create or replace function public.set_chat_retention(p_conversation_id uuid,p_retention_mode text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_retention_mode not in('24h','after_viewing') then raise exception 'Invalid retention'; end if;
  update public.conversations set retention_mode=p_retention_mode where id=p_conversation_id and status='accepted'
    and auth.uid() in(user_a,user_b);
  if not found then raise exception 'Conversation unavailable'; end if;
  update public.messages set expires_at=case when p_retention_mode='24h' then created_at+interval '24 hours' end
    where conversation_id=p_conversation_id and type<>'snap' and not is_saved and (expires_at is null or expires_at>now());
end $$;
create or replace function public.set_message_saved(p_message_id uuid,p_saved boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.messages m set is_saved=p_saved, expires_at=case when not p_saved and c.retention_mode='24h' then m.created_at+interval '24 hours' end
 from public.conversations c where m.id=p_message_id and m.type='text' and m.conversation_id=c.id
   and auth.uid() in(c.user_a,c.user_b) and (m.expires_at is null or m.expires_at>now());
 if not found then raise exception 'Message unavailable'; end if;
end $$;
create or replace function public.leave_chat(p_conversation_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.conversations;
begin
 update public.conversations set user_a_left_at=case when user_a=auth.uid() then clock_timestamp() else user_a_left_at end,
   user_b_left_at=case when user_b=auth.uid() then clock_timestamp() else user_b_left_at end
 where id=p_conversation_id and auth.uid() in(user_a,user_b) returning * into c;
 if not found or c.retention_mode<>'after_viewing' or c.user_a_left_at is null or c.user_b_left_at is null then return; end if;
 update public.messages set expires_at=now() where conversation_id=c.id and not is_saved and type<>'snap'
   and created_at<=least(c.user_a_left_at,c.user_b_left_at)
   and viewed_at<=case when sender_id=c.user_a then c.user_b_left_at else c.user_a_left_at end and expires_at is null;
end $$;

create table if not exists public.story_views (
  story_id uuid not null references public.stories on delete cascade,
  viewer_id uuid not null references public.users on delete cascade,
  viewed_at timestamptz not null default now(), primary key(story_id,viewer_id)
);
create index if not exists story_views_viewer on public.story_views(viewer_id);
alter table public.story_views enable row level security;
revoke all on public.story_views from public,anon,authenticated;
grant select,insert(story_id,viewer_id) on public.story_views to authenticated;
drop policy if exists story_views_read on public.story_views;
create policy story_views_read on public.story_views for select to authenticated using (
 viewer_id=auth.uid() or exists(select 1 from public.stories s where s.id=story_id and s.user_id=auth.uid())
);
drop policy if exists story_views_insert on public.story_views;
create policy story_views_insert on public.story_views for insert to authenticated with check (
 viewer_id=auth.uid() and exists(select 1 from public.stories s where s.id=story_id and s.user_id<>auth.uid() and s.expires_at>now())
);
create or replace function public.get_story_conversation(p_story_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid; uid uuid:=auth.uid(); conv uuid;
begin
 select user_id into owner_id from public.stories where id=p_story_id and expires_at>now();
 if uid is null or owner_id is null or uid=owner_id then raise exception 'Story unavailable'; end if;
 select id into conv from public.conversations where least(user_a,user_b)=least(uid,owner_id)
   and greatest(user_a,user_b)=greatest(uid,owner_id);
 if conv is null then
   insert into public.conversations(user_a,user_b,initiator_id,request_note)
     values(uid,owner_id,uid,'I would like to reply to your story.') on conflict do nothing returning id into conv;
   if conv is null then select id into strict conv from public.conversations where least(user_a,user_b)=least(uid,owner_id)
     and greatest(user_a,user_b)=greatest(uid,owner_id); end if;
 end if;
 return conv;
end $$;
create or replace function public.purge_expired_chat() returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare changed int; total int:=0;
begin
 -- Lock candidate conversation rows in a stable order before deleting unread messages.
 with locked_conversations as materialized (
   select c.id from public.conversations c
   where exists (select 1 from public.messages m where m.conversation_id=c.id and not m.is_saved and m.expires_at<=now())
   order by c.id for update
 )
 delete from public.messages m using locked_conversations c
   where m.conversation_id=c.id and not m.is_saved and m.expires_at<=now();
 get diagnostics changed=row_count; total:=changed;
 delete from public.stories where expires_at<=now();
 get diagnostics changed=row_count; total:=total+changed;
 delete from public.post_events where created_at<now()-interval '30 days';
 delete from public.post_watch_hours where hour<now()-interval '48 hours';
 delete from public.search_queries where updated_at<now()-interval '90 days';
 delete from public.api_rate_windows where minute<now()-interval '1 day';
 update public.conversations set streak_count=0 where streak_count>0 and streak_updated_at<now()-interval '24 hours';
 return total;
end $$;
revoke all on function public.purge_expired_chat() from public,anon,authenticated;

do $$
declare fn regprocedure;
begin
 foreach fn in array array[
 'public.ingest_post_events(jsonb)'::regprocedure,'public.log_search_query(text)'::regprocedure,
 'public.consume_snap_view(uuid,uuid,uuid)'::regprocedure,'public.mark_message(uuid,text)'::regprocedure,
 'public.set_message_saved(uuid,boolean)'::regprocedure,'public.set_chat_retention(uuid,text)'::regprocedure,
 'public.leave_chat(uuid)'::regprocedure,'public.get_story_conversation(uuid)'::regprocedure] loop
   execute format('revoke all on function %s from public,anon,authenticated',fn);
   execute format('grant execute on function %s to authenticated',fn);
 end loop;
 foreach fn in array array[
 'public.get_ranked_feed(uuid,timestamptz,integer,uuid[],text[])'::regprocedure,
 'public.search_hybrid(text,vector,text,text,integer)'::regprocedure,'public.suggest_topics(text,integer)'::regprocedure,
 'public.get_trending_velocity(integer)'::regprocedure] loop
   execute format('revoke all on function %s from public,anon,authenticated',fn);
   execute format('grant execute on function %s to anon,authenticated',fn);
 end loop;
end $$;

-- Real-time channel access follows the same membership rule as message SELECT.
-- These policies are meaningful only for private channels; the client sets private:true.
do $$
declare t text;
begin
 if to_regclass('realtime.messages') is not null then
   execute 'drop policy if exists chat_v2_receive on realtime.messages';
   execute 'drop policy if exists chat_v2_send on realtime.messages';
   execute $policy$create policy chat_v2_receive on realtime.messages for select to authenticated using (
     extension in ('broadcast','presence') and exists (
       select 1 from public.conversations c where 'chat:'||c.id::text=realtime.topic()
         and c.status='accepted' and auth.uid() in(c.user_a,c.user_b)))$policy$;
   execute $policy$create policy chat_v2_send on realtime.messages for insert to authenticated with check (
     extension in ('broadcast','presence') and exists (
       select 1 from public.conversations c where 'chat:'||c.id::text=realtime.topic()
         and c.status='accepted' and auth.uid() in(c.user_a,c.user_b)))$policy$;
 end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   foreach t in array array['story_views','stories'] loop
     if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
       execute format('alter publication supabase_realtime add table public.%I',t);
     end if;
   end loop;
 end if;
end $$;

-- Supabase Dashboard > Integrations > Cron enables pg_cron on hosted projects.
-- If the extension is unavailable here, enable it there and rerun this script.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
   begin create extension if not exists pg_cron;
   exception when insufficient_privilege or object_not_in_prerequisite_state or feature_not_supported then
     raise notice 'Enable pg_cron in Supabase Integrations and rerun this migration.';
   end;
 end if;
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
   perform cron.schedule('web-architecture-v2-cleanup','*/5 * * * *','select public.purge_expired_chat(), public.purge_expired_posts()');
 end if;
end $$;
commit;
