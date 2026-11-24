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
create table public.users (
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
create function public.handle_new_user() returns trigger
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------------------------------------------
-- posts
------------------------------------------------------------------------------------------------------------------
create table public.posts (
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

-- The server decides what the client must not: expiry, the Incog rules, the free-tier permanent limit.
create function public.posts_before_insert() returns trigger
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
  new.topic_entity := null;
  new.sentiment    := null;
  new.ai_summary   := null;
  return new;
end $$;

create trigger posts_before_insert
  before insert on public.posts
  for each row execute function public.posts_before_insert();

create index posts_topic_sentiment_expiry_idx on public.posts (topic_entity, sentiment, expires_at);
create index posts_topic_trgm_idx             on public.posts using gin (topic_entity extensions.gin_trgm_ops);
create index posts_created_idx                on public.posts (created_at desc);
create index posts_user_created_idx           on public.posts (user_id, created_at desc);

-- Removes expired rows. Run daily, for example: select cron.schedule('purge-posts', '15 3 * * *', 'select public.purge_expired_posts()');
create function public.purge_expired_posts() returns int
language sql security definer set search_path = public as $$
  with gone as (delete from public.posts where expires_at is not null and expires_at <= now() returning 1)
  select count(*)::int from gone;
$$;
revoke all on function public.purge_expired_posts() from public, anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- likes (counters change atomically inside the same transaction as the row)
------------------------------------------------------------------------------------------------------------------
create function public.post_is_live(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where id = target and (expires_at is null or expires_at > now()));
$$;

create table public.post_likes (
  user_id    uuid not null references public.users (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index post_likes_post_idx on public.post_likes (post_id);

create function public.handle_like_change() returns trigger
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

create trigger post_likes_counts
  after insert or delete on public.post_likes
  for each row execute function public.handle_like_change();

------------------------------------------------------------------------------------------------------------------
-- follows
------------------------------------------------------------------------------------------------------------------
create table public.follows (
  follower_id  uuid not null references public.users (id) on delete cascade,
  following_id uuid not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following_idx on public.follows (following_id);

create function public.handle_follow_change() returns trigger
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

create trigger follows_counts
  after insert or delete on public.follows
  for each row execute function public.handle_follow_change();

------------------------------------------------------------------------------------------------------------------
-- public read model: live posts only, Incog posts anonymised
------------------------------------------------------------------------------------------------------------------
create view public.public_posts as -- owned by the migration role, so it reads posts past RLS (the default, security_invoker off)
select
  p.id,
  case when p.is_incog then null else p.user_id end            as user_id,
  p.mode, p.avatar_id, p.media_url, p.motion_url, p.duration_sec,
  p.is_incog, p.incog_alias,
  p.transcript, p.topic_entity, p.sentiment, p.ai_summary,
  p.likes_count, p.expiry_tier, p.expires_at, p.created_at,
  case when p.is_incog then null else u.username end           as creator_username,
  case when p.is_incog then null else u.avatar_id end          as creator_avatar_id,
  case when p.is_incog then null else u.followers_count end    as creator_followers_count
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
create policy users_read_all   on public.users for select using (true);
create policy users_update_own on public.users for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- posts: authors insert and read/delete their own rows. Everyone else reads through public_posts.
grant select on public.posts to authenticated;
grant insert (id, user_id, mode, avatar_id, media_url, motion_url, duration_sec, is_incog, incog_alias, expiry_tier)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;
create policy posts_read_own   on public.posts for select to authenticated using (auth.uid() = user_id);
create policy posts_insert_own on public.posts for insert to authenticated with check (auth.uid() = user_id);
create policy posts_delete_own on public.posts for delete to authenticated using (auth.uid() = user_id);

grant select on public.public_posts to anon, authenticated;

-- likes: a person sees and changes only their own likes, and only on live posts.
grant select, insert, delete on public.post_likes to authenticated;
create policy likes_read_own   on public.post_likes for select to authenticated using (auth.uid() = user_id);
create policy likes_insert_own on public.post_likes for insert to authenticated
  with check (auth.uid() = user_id and public.post_is_live(post_id));
create policy likes_delete_own on public.post_likes for delete to authenticated using (auth.uid() = user_id);

-- follows: same shape.
grant select, insert, delete on public.follows to authenticated;
create policy follows_read_own   on public.follows for select to authenticated using (auth.uid() = follower_id);
create policy follows_insert_own on public.follows for insert to authenticated with check (auth.uid() = follower_id);
create policy follows_delete_own on public.follows for delete to authenticated using (auth.uid() = follower_id);
