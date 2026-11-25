-- Phase 7, module 1: realtime DMs on top of the existing chat (architecture_v2.sql + phase7_chat_play.sql).
-- Additive and idempotent: safe to run more than once in the Supabase SQL Editor. Run after phase7_chat_play.sql.
--
-- The chat already has public.conversations / public.messages with a request-and-accept gate, strict insert triggers,
-- per-user unread counters and Realtime. This file only adds what was missing:
--   * messages of type 'post_share' (a Vybe post sent in chat; like stickers, the payload is JSON in `content`)
--   * conversations.last_message_text for the inbox preview
--   * Realtime publication membership (re-asserted, ignored when already present)
-- Row Level Security is untouched: only the two participants can read a conversation, and nobody can send until it is accepted.

alter table public.conversations add column if not exists last_message_text text;

alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('snap', 'text', 'story_reply', 'system_alert', 'avatar_sticker', 'post_share'));

-- {"postId": "<uuid>", "note": "optional text"}; messages_payload_v2 already limits content to 1-2000 chars with no media.
alter table public.messages drop constraint if exists messages_post_share_payload;
alter table public.messages add constraint messages_post_share_payload check (
  type <> 'post_share' or (
    content ~ '^\{.*\}$'
    and (content::jsonb ->> 'postId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

create or replace function public.message_preview_text(msg_type text, msg_content text) returns text
language sql immutable as $$
  select case msg_type
    when 'text'           then left(msg_content, 80)
    when 'story_reply'    then left(msg_content, 80)
    when 'snap'           then '📸 Snap'
    when 'avatar_sticker' then '🎭 Sticker'
    when 'post_share'     then 'Shared a Vybe'
    else null
  end
$$;

create or replace function public.messages_set_last_text() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  preview text := public.message_preview_text(new.type, new.content);
begin
  if preview is not null then
    update public.conversations set last_message_text = preview where id = new.conversation_id;
  end if;
  return new;
end $$;

drop trigger if exists messages_last_text on public.messages;
create trigger messages_last_text
  after insert on public.messages
  for each row execute function public.messages_set_last_text();

-- Fill the preview for conversations that already have messages.
update public.conversations c
set last_message_text = latest.preview
from (
  select distinct on (m.conversation_id) m.conversation_id, public.message_preview_text(m.type, m.content) as preview
  from public.messages m
  where public.message_preview_text(m.type, m.content) is not null
  order by m.conversation_id, m.created_at desc
) latest
where c.id = latest.conversation_id and c.last_message_text is null;

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
