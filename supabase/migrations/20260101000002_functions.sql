-- Server operations. All are SECURITY DEFINER with an empty search_path; identity is auth.uid().

-- ---------- internal helpers ----------
create function private.me() returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return v;
end $$;

create function private.require_active() returns uuid language plpgsql stable as $$
declare v uuid := private.me();
begin
  if not exists (select 1 from public.profiles where id = v and status = 'active') then
    raise exception 'account_unavailable' using errcode = '42501';
  end if;
  return v;
end $$;

create function private.is_blocked(a uuid, b uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create function private.rate_check(p_user uuid, p_action text, p_max int, p_window interval)
returns void language plpgsql as $$
begin
  if (select count(*) from private.rate_events
      where user_id = p_user and action = p_action and at > now() - p_window) >= p_max then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into private.rate_events (user_id, action) values (p_user, p_action);
end $$;

-- Can the viewer see this person at all? Active, not blocked either way, and either
-- discoverable or already connected (pending request / conversation).
create function private.can_see(p_viewer uuid, p_target uuid) returns boolean language sql stable as $$
  select p_viewer = p_target
      or (
        exists (select 1 from public.profiles t where t.id = p_target and t.status = 'active')
        and not private.is_blocked(p_viewer, p_target)
        and (
          exists (select 1 from public.profiles t where t.id = p_target and t.discoverable)
          or exists (select 1 from public.conversations c
                     where c.user_a = least(p_viewer, p_target) and c.user_b = greatest(p_viewer, p_target))
          or exists (select 1 from public.chat_requests r
                     where r.status = 'pending'
                       and least(r.from_id, r.to_id) = least(p_viewer, p_target)
                       and greatest(r.from_id, r.to_id) = greatest(p_viewer, p_target))
        )
      );
$$;

-- Hint only: identifiers, no text. No-op where Realtime is not installed (local tests).
create function private.hint(p_user uuid, p_event text, p_payload jsonb) returns void language plpgsql as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send(p_payload, p_event, 'user:' || p_user::text, true);
  end if;
end $$;

create function private.ensure_conversation(p_x uuid, p_y uuid) returns uuid language plpgsql as $$
declare v_id uuid; a uuid := least(p_x, p_y); b uuid := greatest(p_x, p_y);
begin
  insert into public.conversations (user_a, user_b) values (a, b) on conflict (user_a, user_b) do nothing;
  select id into v_id from public.conversations where user_a = a and user_b = b;
  insert into public.conversation_members (conversation_id, user_id) values (v_id, a), (v_id, b)
    on conflict do nothing;
  return v_id;
end $$;

-- ---------- profile ----------
create function public.create_profile(p_name text, p_dob date, p_city_id int, p_bio text default '', p_tags text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.me();
begin
  if p_dob is null or p_dob > (current_date - interval '18 years')::date then
    raise exception 'under_18' using errcode = '22023';
  end if;
  insert into public.profiles (id, display_name, bio, city_id, tags)
    values (v, btrim(p_name), coalesce(p_bio, ''), p_city_id, coalesce(p_tags, '{}'));
  insert into public.account_private (user_id, dob) values (v, p_dob);
exception when unique_violation then
  raise exception 'profile_exists' using errcode = '23505';
end $$;

create function public.update_profile(p_name text, p_bio text, p_city_id int, p_tags text[], p_prompts jsonb, p_discoverable boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  update public.profiles set display_name = btrim(p_name), bio = coalesce(p_bio, ''), city_id = p_city_id,
         tags = coalesce(p_tags, '{}'), prompts = coalesce(p_prompts, '[]'), discoverable = p_discoverable
   where id = v;
end $$;

create function public.set_tonight(p_text text, p_area text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  if p_text is null or btrim(p_text) = '' then
    update public.profiles set tonight_text = null, tonight_area = null, tonight_until = null where id = v;
  else
    update public.profiles set tonight_text = btrim(p_text), tonight_area = nullif(btrim(coalesce(p_area, '')), ''),
           tonight_until = now() + interval '24 hours' where id = v;
  end if;
end $$;

-- p_photos: ordered [{"object_key": "...", "thumb_key": "..."}], at most 4. Keys must live in the caller's folder.
create function public.set_photos(p_photos jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active(); n int; i int; item jsonb;
begin
  if jsonb_typeof(p_photos) <> 'array' then raise exception 'invalid_photos'; end if;
  n := jsonb_array_length(p_photos);
  if n > 4 then raise exception 'too_many_photos'; end if;
  for i in 0 .. n - 1 loop
    item := p_photos -> i;
    if coalesce(item ->> 'object_key', '') not like v::text || '/%'
       or coalesce(item ->> 'thumb_key', '') not like v::text || '/%'
       or (item ->> 'object_key') like '%..%' or (item ->> 'thumb_key') like '%..%' then
      raise exception 'invalid_photo_key' using errcode = '42501';
    end if;
  end loop;
  -- Removed or replaced objects go on the retryable cleanup queue.
  insert into private.storage_cleanup (object_key)
    select k from (select object_key k from public.profile_photos where user_id = v
                   union select thumb_key from public.profile_photos where user_id = v) old
    where k not in (select x ->> 'object_key' from jsonb_array_elements(p_photos) x
                    union select x ->> 'thumb_key' from jsonb_array_elements(p_photos) x);
  delete from public.profile_photos where user_id = v;
  for i in 0 .. n - 1 loop
    item := p_photos -> i;
    insert into public.profile_photos (user_id, position, object_key, thumb_key)
      values (v, i, item ->> 'object_key', item ->> 'thumb_key');
  end loop;
end $$;

create function public.get_my_profile() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.display_name, 'bio', p.bio, 'city_id', p.city_id, 'city', c.name,
    'age', date_part('year', age(a.dob))::int, 'tags', p.tags, 'prompts', p.prompts,
    'discoverable', p.discoverable, 'status', p.status,
    'tonight', case when p.tonight_until > now()
                    then jsonb_build_object('text', p.tonight_text, 'area', p.tonight_area, 'until', p.tonight_until) end,
    'approx_location', a.approx_location_opt_in, 'notifications', a.notifications_enabled,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('object_key', f.object_key, 'thumb_key', f.thumb_key) order by f.position)
                        from public.profile_photos f where f.user_id = p.id), '[]'))
  from public.profiles p
  join public.cities c on c.id = p.city_id
  join public.account_private a on a.user_id = p.id
  where p.id = auth.uid();
$$;

-- ---------- discovery ----------
create function public.list_nearby(p_city_id int default null, p_tonight_only boolean default false, p_limit int default 30,
                                   p_after_created timestamptz default null, p_after_id uuid default null)
returns table (id uuid, name text, age int, city text, bio text, tags text[], shared_tags int,
               tonight_text text, tonight_area text, tonight_until timestamptz, thumb_key text,
               created_at timestamptz, distance_band text)
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_active(); v_city int; v_tags text[];
begin
  select profiles.city_id, profiles.tags into v_city, v_tags from public.profiles where profiles.id = v;
  return query
    select p.id, p.display_name, date_part('year', age(a.dob))::int, c.name, p.bio, p.tags,
           (select count(*)::int from unnest(p.tags) t where t = any (v_tags)),
           case when p.tonight_until > now() then p.tonight_text end,
           case when p.tonight_until > now() then p.tonight_area end,
           case when p.tonight_until > now() then p.tonight_until end,
           (select f.thumb_key from public.profile_photos f where f.user_id = p.id order by f.position limit 1),
           p.created_at,
           null::text  -- distance bands arrive with approximate location in Phase 4
    from public.profiles p
    join public.account_private a on a.user_id = p.id
    join public.cities c on c.id = p.city_id
    where p.city_id = coalesce(p_city_id, v_city)
      and p.id <> v and p.status = 'active' and p.discoverable
      and not private.is_blocked(v, p.id)
      and (not p_tonight_only or p.tonight_until > now())
      and (p_after_created is null or (p.created_at, p.id) < (p_after_created, p_after_id))
    order by p.created_at desc, p.id desc
    limit least(greatest(p_limit, 1), 50);
end $$;

create function public.get_profile(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_active(); r jsonb; v_req uuid; v_dir text; v_conv uuid;
begin
  if not private.can_see(v, p_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, case when from_id = v then 'sent' else 'received' end into v_req, v_dir
    from public.chat_requests
   where status = 'pending' and least(from_id, to_id) = least(v, p_id) and greatest(from_id, to_id) = greatest(v, p_id);
  select id into v_conv from public.conversations where user_a = least(v, p_id) and user_b = greatest(v, p_id);
  select jsonb_build_object(
    'id', p.id, 'name', p.display_name, 'bio', p.bio, 'city', c.name,
    'age', date_part('year', age(a.dob))::int, 'tags', p.tags, 'prompts', p.prompts,
    'tonight', case when p.tonight_until > now()
                    then jsonb_build_object('text', p.tonight_text, 'area', p.tonight_area, 'until', p.tonight_until) end,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('object_key', f.object_key, 'thumb_key', f.thumb_key) order by f.position)
                        from public.profile_photos f where f.user_id = p.id), '[]'),
    'relation', case when v_conv is not null then 'connected'
                     when v_dir = 'sent' then 'request_sent'
                     when v_dir = 'received' then 'request_received' else 'none' end,
    'request_id', v_req, 'conversation_id', v_conv)
  into r
  from public.profiles p join public.cities c on c.id = p.city_id join public.account_private a on a.user_id = p.id
  where p.id = p_id;
  return r;
end $$;

-- ---------- requests ----------
create function public.send_request(p_to uuid, p_note text default null, p_prompt text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active(); v_id uuid;
begin
  if p_to = v then raise exception 'invalid_target'; end if;
  if not private.can_see(v, p_to) or not exists (select 1 from public.profiles where id = p_to and discoverable) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.conversations where user_a = least(v, p_to) and user_b = greatest(v, p_to)) then
    raise exception 'already_connected';
  end if;
  perform private.rate_check(v, 'send_request', 30, interval '1 day');
  insert into public.chat_requests (from_id, to_id, note, prompt)
    values (v, p_to, nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_prompt, '')), ''))
    returning id into v_id;
  insert into public.notification_outbox (recipient_id, kind) values (p_to, 'request');
  perform private.hint(p_to, 'request', jsonb_build_object('request_id', v_id));
  return v_id;
exception when unique_violation then
  raise exception 'request_exists' using errcode = '23505';
end $$;

-- Accept creates or reuses the conversation in one transaction. The row lock serialises
-- simultaneous responses; a repeated accept returns the same conversation.
create function public.respond_to_request(p_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active(); r public.chat_requests; v_conv uuid;
begin
  select * into r from public.chat_requests where id = p_id and to_id = v for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status = 'accepted' and p_accept then
    return (select id from public.conversations where user_a = least(r.from_id, r.to_id) and user_b = greatest(r.from_id, r.to_id));
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  if not p_accept then
    update public.chat_requests set status = 'declined', responded_at = now() where id = p_id;
    return null;
  end if;
  if private.is_blocked(r.from_id, r.to_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.chat_requests set status = 'accepted', responded_at = now() where id = p_id;
  v_conv := private.ensure_conversation(r.from_id, r.to_id);
  if r.note is not null then
    -- The requester's note becomes the first message. Deterministic client id keeps it idempotent.
    insert into public.messages (conversation_id, sender_id, seq, client_id, body, created_at)
      values (v_conv, r.from_id, 1, r.id, r.note, r.created_at) on conflict do nothing;
    update public.conversations set last_seq = greatest(last_seq, 1), last_message_at = coalesce(last_message_at, r.created_at)
      where id = v_conv;
    update public.conversation_members set last_read_seq = 1 where conversation_id = v_conv and user_id = r.from_id;
  end if;
  insert into public.notification_outbox (recipient_id, kind, conversation_id) values (r.from_id, 'accepted', v_conv);
  perform private.hint(r.from_id, 'accepted', jsonb_build_object('conversation_id', v_conv));
  return v_conv;
end $$;

create function public.cancel_request(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  update public.chat_requests set status = 'cancelled', responded_at = now()
   where id = p_id and from_id = v and status = 'pending';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create function public.list_requests() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'direction', case when r.to_id = auth.uid() then 'incoming' else 'sent' end,
    'other_id', o.id, 'name', o.display_name, 'note', r.note, 'prompt', r.prompt, 'created_at', r.created_at,
    'thumb_key', (select f.thumb_key from public.profile_photos f where f.user_id = o.id order by f.position limit 1))
    order by r.created_at desc), '[]')
  from public.chat_requests r
  join public.profiles o on o.id = case when r.to_id = auth.uid() then r.from_id else r.to_id end
  where r.status = 'pending' and auth.uid() in (r.from_id, r.to_id)
    and o.status = 'active' and not private.is_blocked(auth.uid(), o.id);
$$;

-- ---------- conversations & messages ----------
create function public.list_conversations(p_limit int default 50, p_before timestamptz default null)
returns table (conversation_id uuid, other_id uuid, other_name text, other_thumb text, unavailable boolean,
               last_body text, last_sender uuid, last_at timestamptz, unread int, sort_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  return query
    select c.id, o.id,
           case when ub.x then 'Unavailable' else o.display_name end,
           case when ub.x then null else (select f.thumb_key from public.profile_photos f where f.user_id = o.id order by f.position limit 1) end,
           ub.x or o.status <> 'active',
           lm.body, lm.sender_id, c.last_message_at,
           (select count(*)::int from public.messages m
             where m.conversation_id = c.id and m.seq > cm.last_read_seq and m.sender_id <> v),
           coalesce(c.last_message_at, c.created_at)
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    join public.profiles o on o.id = case when c.user_a = v then c.user_b else c.user_a end
    cross join lateral (select private.is_blocked(v, o.id) as x) ub
    left join lateral (select m.body, m.sender_id from public.messages m
                       where m.conversation_id = c.id order by m.seq desc limit 1) lm on true
    where cm.user_id = v
      and (p_before is null or coalesce(c.last_message_at, c.created_at) < p_before)
    order by coalesce(c.last_message_at, c.created_at) desc
    limit least(greatest(p_limit, 1), 100);
end $$;

-- Newest page: no cursor. Older page: p_before_seq. Catch-up after reconnect: p_after_seq (ascending).
create function public.list_messages(p_conversation uuid, p_before_seq bigint default null, p_after_seq bigint default null, p_limit int default 30)
returns table (id uuid, seq bigint, sender_id uuid, client_id uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_active(); c public.conversations;
begin
  select * into c from public.conversations where conversations.id = p_conversation and v in (user_a, user_b);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.is_blocked(c.user_a, c.user_b) then raise exception 'conversation_unavailable' using errcode = '42501'; end if;
  if p_after_seq is not null then
    return query select m.id, m.seq, m.sender_id, m.client_id, m.body, m.created_at from public.messages m
      where m.conversation_id = p_conversation and m.seq > p_after_seq order by m.seq asc limit least(greatest(p_limit, 1), 100);
  else
    return query select m.id, m.seq, m.sender_id, m.client_id, m.body, m.created_at from public.messages m
      where m.conversation_id = p_conversation and (p_before_seq is null or m.seq < p_before_seq)
      order by m.seq desc limit least(greatest(p_limit, 1), 100);
  end if;
end $$;

create function public.send_message(p_conversation uuid, p_client_id uuid, p_body text)
returns table (id uuid, seq bigint, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active(); c public.conversations; v_other uuid; v_seq bigint; v_id uuid; v_at timestamptz; body text := btrim(coalesce(p_body, ''));
begin
  if char_length(body) not between 1 and 1000 then raise exception 'invalid_body'; end if;
  -- Row lock serialises sends and blocks for the same pair: a committed block always wins.
  select * into c from public.conversations where conversations.id = p_conversation and v in (user_a, user_b) for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select m.id, m.seq, m.created_at into v_id, v_seq, v_at from public.messages m where m.sender_id = v and m.client_id = p_client_id;
  if found then return query select v_id, v_seq, v_at; return; end if;   -- retry of a committed message
  v_other := case when c.user_a = v then c.user_b else c.user_a end;
  if private.is_blocked(v, v_other) or not exists (select 1 from public.profiles where profiles.id = v_other and status = 'active') then
    raise exception 'conversation_unavailable' using errcode = '42501';
  end if;
  perform private.rate_check(v, 'send_message', 60, interval '1 minute');
  v_seq := c.last_seq + 1;
  insert into public.messages (conversation_id, sender_id, seq, client_id, body)
    values (p_conversation, v, v_seq, p_client_id, body) returning messages.id, messages.created_at into v_id, v_at;
  update public.conversations set last_seq = v_seq, last_message_at = v_at where conversations.id = p_conversation;
  update public.conversation_members set last_read_seq = greatest(last_read_seq, v_seq)
    where conversation_id = p_conversation and user_id = v;
  insert into public.notification_outbox (recipient_id, kind, conversation_id, message_id)
    values (v_other, 'message', p_conversation, v_id);
  perform private.hint(v_other, 'message', jsonb_build_object('conversation_id', p_conversation, 'seq', v_seq));
  return query select v_id, v_seq, v_at;
end $$;

-- Read cursors only move forward and never past the last message.
create function public.mark_read(p_conversation uuid, p_seq bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  update public.conversation_members cm
     set last_read_seq = greatest(cm.last_read_seq, least(p_seq, (select c.last_seq from public.conversations c where c.id = cm.conversation_id)))
   where cm.conversation_id = p_conversation and cm.user_id = v;
end $$;

-- ---------- blocks & devices ----------
create function public.block_user(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  if p_user = v then raise exception 'invalid_target'; end if;
  perform 1 from public.conversations where user_a = least(v, p_user) and user_b = greatest(v, p_user) for update;  -- wait out in-flight sends
  insert into public.blocks (blocker_id, blocked_id) values (v, p_user) on conflict do nothing;
  update public.chat_requests set status = 'cancelled', responded_at = now()
   where status = 'pending' and least(from_id, to_id) = least(v, p_user) and greatest(from_id, to_id) = greatest(v, p_user);
end $$;

create function public.unblock_user(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin delete from public.blocks where blocker_id = v and blocked_id = p_user; end $$;

create function public.register_device(p_token text) returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_active();
begin
  if char_length(p_token) not between 8 and 200 then raise exception 'invalid_token'; end if;
  insert into public.devices (user_id, token) values (v, p_token)
    on conflict (token) do update set user_id = v, updated_at = now();
end $$;

-- ---------- grants: callable only by signed-in users ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on schema private from public, anon, authenticated;
