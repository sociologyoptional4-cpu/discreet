-- Phase 7: avatar stickers in chat. Run after architecture_v2.sql.
-- Live pokes, hearts, duo emotes and reactions use Realtime Broadcast on the existing `chat:<id>` topic and are never stored.
-- A sticker is a normal message whose content is JSON: {"stickerId": "...", "avatarId": "...", "label": "..."}.

alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('snap', 'text', 'story_reply', 'system_alert', 'avatar_sticker'));

-- messages_payload_v2 already requires content (1-2000 chars) and no media for non-snap types.
alter table public.messages drop constraint if exists messages_sticker_payload;
alter table public.messages add constraint messages_sticker_payload check (
  type <> 'avatar_sticker' or (
    content ~ '^\{.*\}$'
    and (content::jsonb ->> 'stickerId') in ('peek', 'wave', 'heart_burst', 'laugh', 'angry_stomp', 'sleepy', 'duo_run', 'knock')
    and (content::jsonb ->> 'avatarId') in ('cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot')
  )
);
