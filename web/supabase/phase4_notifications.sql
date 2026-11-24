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
