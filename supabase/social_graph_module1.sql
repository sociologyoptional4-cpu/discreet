-- Social graph, module 1: follows table, counters, atomic trigger, RLS. Idempotent: safe to run repeatedly in the Supabase SQL Editor.
-- The profile table in this schema is public.users (public.profiles is only in the legacy migrations folder).

create table if not exists public.follows (
  follower_id  uuid not null references public.users (id) on delete cascade,
  following_id uuid not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

-- Tables created by architecture_v2.sql carry an unnamed check; add the named one only if no self-follow check exists yet.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.follows'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%follower_id <> following_id%'
  ) then
    alter table public.follows add constraint follows_no_self_follow check (follower_id <> following_id);
  end if;
end $$;

create index if not exists follows_follower_idx  on public.follows (follower_id);
create index if not exists follows_following_idx on public.follows (following_id);

alter table public.users
  add column if not exists bio             text        not null default '',
  add column if not exists followers_count int         not null default 0,
  add column if not exists following_count int         not null default 0,
  add column if not exists vibe_xp         int         not null default 0,
  add column if not exists vibe_level      int         not null default 1,
  add column if not exists badges          jsonb       not null default '[]'::jsonb;

-- Counters move in the same transaction as the follow row, so they cannot drift.
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

alter table public.follows enable row level security;

grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

drop policy if exists follows_read_own on public.follows;
drop policy if exists follows_read_public on public.follows;
create policy follows_read_public on public.follows for select to anon, authenticated using (true);

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows for insert to authenticated with check (auth.uid() = follower_id);

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows for delete to authenticated using (auth.uid() = follower_id);
