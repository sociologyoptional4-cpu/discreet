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

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.viewed_at  := null;
  -- An unopened snap disappears after a day (matching the 1d storage prefix); other messages stay.
  new.expires_at := case when new.type = 'snap' then now() + interval '1 day' else null end;
  return new;
end $$;

-- Opening a snap: the server stamps the time, it can only happen once, and the snap is removed a minute later.
create or replace function public.messages_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.viewed_at is not null then
    new.viewed_at := old.viewed_at; -- already opened: nothing can change it
  else
    new.viewed_at := now();
  end if;
  new.expires_at := case when new.type = 'snap' then least(coalesce(old.expires_at, 'infinity'::timestamptz), new.viewed_at + interval '1 minute') else old.expires_at end;
  return new;
end $$;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();
drop trigger if exists messages_before_update on public.messages;
create trigger messages_before_update before update on public.messages
  for each row execute function public.messages_before_update();
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Removes expired snaps and stories. Run daily, for example: select cron.schedule('purge-chat', '30 3 * * *', 'select public.purge_expired_chat()');
create or replace function public.purge_expired_chat() returns int
language sql security definer set search_path = public as $$
  with gone_messages as (delete from public.messages where expires_at is not null and expires_at <= now() returning 1),
       gone_stories  as (delete from public.stories  where expires_at <= now() returning 1)
  select (select count(*) from gone_messages)::int + (select count(*) from gone_stories)::int;
$$;
revoke all on function public.purge_expired_chat() from public, anon, authenticated;

------------------------------------------------------------------------------------------------------------------
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
grant update (viewed_at) on public.messages to authenticated;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (public.is_participant(conversation_id) and (expires_at is null or expires_at > now()));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_send_in(conversation_id));

drop policy if exists messages_mark_viewed on public.messages;
create policy messages_mark_viewed on public.messages for update to authenticated
  using (public.is_participant(conversation_id) and sender_id <> auth.uid() and (expires_at is null or expires_at > now()))
  with check (public.is_participant(conversation_id) and sender_id <> auth.uid());

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
