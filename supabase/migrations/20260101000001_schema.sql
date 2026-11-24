-- Nearby Chat core schema. Clients never touch tables directly: reads and writes go through
-- security-definer functions (next migration) so identity comes from the session and every
-- block / status / rate rule is enforced in one place.

create schema if not exists private;

create type public.account_status as enum ('active', 'suspended', 'deleting');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled');

create table public.cities (
  id        int generated always as identity primary key,
  name      text not null unique,
  country   text not null default 'IN'
);
insert into public.cities (name) values
  ('Bengaluru'), ('Mumbai'), ('Delhi'), ('Pune'), ('Hyderabad'), ('Chennai'), ('Goa');

-- Public profile fields only. Date of birth lives in account_private.
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null check (char_length(btrim(display_name)) between 1 and 30),
  bio             text not null default '' check (char_length(bio) <= 160),
  city_id         int  not null references public.cities (id),
  tags            text[] not null default '{}' check (cardinality(tags) <= 6),
  prompts         jsonb not null default '[]'
                    check (jsonb_typeof(prompts) = 'array' and jsonb_array_length(prompts) <= 3),
  tonight_text    text check (char_length(tonight_text) <= 40),
  tonight_area    text check (char_length(tonight_area) <= 30),
  tonight_until   timestamptz,
  discoverable    boolean not null default true,
  status          public.account_status not null default 'active',
  created_at      timestamptz not null default now()
);
create index profiles_discovery_idx on public.profiles (city_id, created_at desc, id desc)
  where discoverable and status = 'active';

create table public.account_private (
  user_id                  uuid primary key references public.profiles (id) on delete cascade,
  dob                      date not null,
  approx_location_opt_in   boolean not null default false,
  notifications_enabled    boolean not null default true,
  created_at               timestamptz not null default now()
);

-- Coarse cell only (computed on device). Never returned to other users. Expires after 7 days.
create table public.discovery_locations (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  cell        text not null,
  expires_at  timestamptz not null
);

-- Four slots maximum, enforced by the position check. Deferrable so a reorder is one statement.
create table public.profile_photos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  position    smallint not null check (position between 0 and 3),
  object_key  text not null,
  thumb_key   text not null,
  created_at  timestamptz not null default now(),
  constraint profile_photos_slot unique (user_id, position) deferrable initially deferred
);

create table public.chat_requests (
  id            uuid primary key default gen_random_uuid(),
  from_id       uuid not null references public.profiles (id) on delete cascade,
  to_id         uuid not null references public.profiles (id) on delete cascade,
  status        public.request_status not null default 'pending',
  note          text check (char_length(note) <= 200),
  prompt        text check (char_length(prompt) <= 80),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (from_id <> to_id)
);
-- One pending request per unordered pair.
create unique index chat_requests_one_pending on public.chat_requests
  (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index chat_requests_to_idx   on public.chat_requests (to_id, created_at desc)   where status = 'pending';
create index chat_requests_from_idx on public.chat_requests (from_id, created_at desc) where status = 'pending';

-- One conversation per unordered pair: user_a < user_b makes the pair canonical.
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_a           uuid not null references public.profiles (id) on delete cascade,
  user_b           uuid not null references public.profiles (id) on delete cascade,
  last_seq         bigint not null default 0,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.conversation_members (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  last_read_seq    bigint not null default 0,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id, conversation_id);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null references public.profiles (id) on delete cascade,
  seq              bigint not null,
  client_id        uuid not null,
  body             text not null check (char_length(body) between 1 and 1000),
  created_at       timestamptz not null default now(),
  unique (conversation_id, seq),
  unique (sender_id, client_id)          -- retries with the same client id never duplicate
);

create table public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  token       text not null unique,
  platform    text not null default 'ios',
  updated_at  timestamptz not null default now()
);

-- Push jobs hold identifiers only, never message text.
create table public.notification_outbox (
  id               bigint generated always as identity primary key,
  recipient_id     uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('message', 'request', 'accepted')),
  conversation_id  uuid,
  message_id       uuid,
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts         int not null default 0,
  available_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index notification_outbox_due on public.notification_outbox (available_at) where status = 'pending';

-- Safety and lifecycle tables: populated by Phase 3 functions; locked down from day one.
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reported_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null,
  note         text,
  evidence     jsonb not null default '[]',
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now()
);
create table public.staff (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  role     text not null check (role in ('moderator', 'admin'))
);
create table public.moderation_actions (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.reports (id) on delete cascade,
  moderator_id  uuid not null references auth.users (id),
  action        text not null check (action in ('dismiss', 'warn', 'suspend')),
  note          text,
  created_at    timestamptz not null default now()
);
create table public.deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  status        text not null default 'pending' check (status in ('pending', 'running', 'done')),
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz
);

-- Internal bookkeeping, never exposed through the API.
create table private.rate_events (
  user_id  uuid not null,
  action   text not null,
  at       timestamptz not null default now()
);
create index rate_events_idx on private.rate_events (user_id, action, at desc);
create table private.storage_cleanup (
  id          bigint generated always as identity primary key,
  object_key  text not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);

-- Lock everything down; row-level security is the default-deny backstop.
alter table public.cities enable row level security;
alter table public.profiles enable row level security;
alter table public.account_private enable row level security;
alter table public.discovery_locations enable row level security;
alter table public.profile_photos enable row level security;
alter table public.chat_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.devices enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.reports enable row level security;
alter table public.staff enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.deletion_requests enable row level security;

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- The few direct reads clients need (their own rows). Everything else is an RPC.
grant select on public.cities to anon, authenticated;
create policy cities_read on public.cities for select using (true);
grant select on public.profiles, public.account_private, public.profile_photos, public.blocks to authenticated;
create policy profiles_own on public.profiles for select to authenticated using (id = auth.uid());
create policy account_private_own on public.account_private for select to authenticated using (user_id = auth.uid());
create policy photos_own on public.profile_photos for select to authenticated using (user_id = auth.uid());
create policy blocks_own on public.blocks for select to authenticated using (blocker_id = auth.uid());
