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
