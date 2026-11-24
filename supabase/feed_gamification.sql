-- Idempotent migration for Feed Gamification, Streaks, and Multi-Emoji Reactions
begin;

alter table public.users
  add column if not exists vibe_xp int not null default 0 check (vibe_xp >= 0),
  add column if not exists vibe_level int not null default 1 check (vibe_level >= 1),
  add column if not exists daily_watch_streak int not null default 0 check (daily_watch_streak >= 0),
  add column if not exists last_watch_date date;

alter table public.posts
  add column if not exists reaction_counts jsonb not null default '{}'::jsonb;

create or replace function public.increment_user_vibe_xp(p_user_id uuid, p_xp int)
returns table (vibe_xp int, vibe_level int, daily_watch_streak int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_xp int;
  v_level int;
  v_streak int;
begin
  if p_xp is null or p_xp <= 0 or p_xp > 500 then
    raise exception 'Invalid XP delta';
  end if;

  update public.users u
  set
    vibe_xp = u.vibe_xp + p_xp,
    vibe_level = greatest(1, floor((u.vibe_xp + p_xp) / 100.0)::int + 1),
    daily_watch_streak = case
      when u.last_watch_date = v_today then greatest(1, u.daily_watch_streak)
      when u.last_watch_date = (v_today - 1) then u.daily_watch_streak + 1
      else 1
    end,
    last_watch_date = v_today
  where u.id = p_user_id
  returning u.vibe_xp, u.vibe_level, u.daily_watch_streak
  into v_xp, v_level, v_streak;

  if not found then
    return;
  end if;

  return query select v_xp, v_level, v_streak;
end $$;

create or replace function public.increment_post_reaction(p_post_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
begin
  if p_emoji not in ('heart', 'love', 'laugh', 'fire', 'mindblown') then
    raise exception 'Unsupported reaction emoji';
  end if;

  update public.posts
  set reaction_counts = jsonb_set(
    coalesce(reaction_counts, '{}'::jsonb),
    array[p_emoji],
    to_jsonb(coalesce((reaction_counts ->> p_emoji)::int, 0) + 1),
    true
  )
  where id = p_post_id
    and (expires_at is null or expires_at > now())
  returning reaction_counts into v_counts;

  return coalesce(v_counts, '{}'::jsonb);
end $$;

revoke all on function public.increment_user_vibe_xp(uuid, int) from public;
grant execute on function public.increment_user_vibe_xp(uuid, int) to service_role;

revoke all on function public.increment_post_reaction(uuid, text) from public;
grant execute on function public.increment_post_reaction(uuid, text) to authenticated, service_role;

commit;
