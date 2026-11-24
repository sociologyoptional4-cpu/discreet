-- Access-matrix and behaviour tests. Run on a database with tests/shim.sql + migrations applied.
-- Roles under test: anonymous, unrelated user, participant, blocked user, suspended user.
\set ON_ERROR_STOP 1
create schema test;
create table test.results (n serial, label text, ok boolean, detail text);
create function test.record(l text, o boolean, d text default null) returns void language sql security definer as
  $$ insert into test.results (label, ok, detail) values (l, o, d) $$;
create function test.check(l text, q text) returns void language plpgsql as $$
declare r boolean;
begin execute q into r; perform test.record(l, coalesce(r, false), case when r then null else 'false/null' end);
exception when others then perform test.record(l, false, sqlerrm); end $$;
create function test.throws(l text, q text, expect text) returns void language plpgsql as $$
begin execute q; perform test.record(l, false, 'no error raised');
exception when others then perform test.record(l, sqlerrm like '%' || expect || '%', sqlerrm); end $$;
grant usage on schema test to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'), ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test'), ('44444444-4444-4444-4444-444444444444', 'dave@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.test'),   ('66666666-6666-6666-6666-666666666666', 'minor@example.test');

-- ===== anonymous =====
set role anon;
select test.throws('anon cannot read profiles', 'select * from public.profiles', 'permission denied');
select test.throws('anon cannot call list_nearby', 'select * from public.list_nearby(1)', 'permission denied');
select test.throws('anon cannot read messages table', 'select * from public.messages', 'permission denied');
select test.check('anon can read city list', 'select count(*) = 7 from public.cities');
reset role;

-- ===== profiles =====
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select test.throws('under-18 date of birth rejected', $$select public.create_profile('Kid', (current_date - interval '17 years 11 months')::date, 1)$$, 'under_18');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.create_profile('Alice', '1996-01-01', 1, 'Potter', '{Coffee,Pottery}');
select test.throws('second create_profile rejected', $$select public.create_profile('Again', '1996-01-01', 1)$$, 'profile_exists');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.create_profile('Bob', '1995-05-05', 1, 'Cyclist', '{Coffee,Cycling}');
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.create_profile('Carol', '1994-04-04', 1);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.create_profile('Dave', '1993-03-03', 1);
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.create_profile('Eve', '1992-02-02', 1);

-- ===== unrelated user (carol) =====
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.check('carol sees only her own profile row', $$select count(*) = 1 from public.profiles$$);
select test.check('carol cannot read anyone''s date of birth', $$select count(*) = 0 from public.account_private where user_id <> auth.uid()$$);
select test.check('carol sees own dob only', $$select count(*) = 1 from public.account_private$$);
select test.check('list_nearby excludes self, includes others, exposes age not dob', $$
  select count(*) = 4 and not bool_or(id = auth.uid()) and bool_and(age is not null) from public.list_nearby(1)$$);
select test.check('list_nearby result has no location columns', $$
  select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'discovery_locations' and false) and
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'list_nearby' and pg_get_function_result(p.oid) ~* '(cell|lat|lng|coord)')$$);
select test.throws('carol cannot update a profile directly', $$update public.profiles set display_name = 'x'$$, 'permission denied');
select test.throws('carol cannot insert messages directly', $$insert into public.messages (conversation_id, sender_id, seq, client_id, body) values (gen_random_uuid(), auth.uid(), 1, gen_random_uuid(), 'hi')$$, 'permission denied');

-- ===== photos =====
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select test.throws('photo key outside own folder rejected', $$select public.set_photos('[{"object_key":"22222222-2222-2222-2222-222222222222/x.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/t.jpg"}]')$$, 'invalid_photo_key');
select test.throws('path traversal rejected', $$select public.set_photos('[{"object_key":"11111111-1111-1111-1111-111111111111/../x.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/t.jpg"}]')$$, 'invalid_photo_key');
select test.throws('five photos rejected', $$select public.set_photos((select jsonb_agg(jsonb_build_object('object_key','11111111-1111-1111-1111-111111111111/'||i||'.jpg','thumb_key','11111111-1111-1111-1111-111111111111/'||i||'t.jpg')) from generate_series(1,5) i))$$, 'too_many_photos');
select public.set_photos('[{"object_key":"11111111-1111-1111-1111-111111111111/a.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/at.jpg"},{"object_key":"11111111-1111-1111-1111-111111111111/b.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/bt.jpg"}]');
select public.set_photos('[{"object_key":"11111111-1111-1111-1111-111111111111/b.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/bt.jpg"},{"object_key":"11111111-1111-1111-1111-111111111111/a.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/at.jpg"}]');
select test.check('reorder keeps both photos in the new order', $$select (select jsonb_agg(p->>'object_key') from jsonb_array_elements(public.get_my_profile()->'photos') p) = '["11111111-1111-1111-1111-111111111111/b.jpg","11111111-1111-1111-1111-111111111111/a.jpg"]'::jsonb$$);
select public.set_photos('[{"object_key":"11111111-1111-1111-1111-111111111111/b.jpg","thumb_key":"11111111-1111-1111-1111-111111111111/bt.jpg"}]');
reset role;
select test.record('removed photo queued for cleanup', (select count(*) = 2 from private.storage_cleanup where object_key like '%/a%.jpg'));
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into storage.objects (bucket_id, name) values ('profile-photos', '11111111-1111-1111-1111-111111111111/b.jpg');
select test.throws('cannot upload into another user''s folder', $$insert into storage.objects (bucket_id, name) values ('profile-photos', '22222222-2222-2222-2222-222222222222/evil.jpg')$$, 'row-level security');
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.check('unrelated user may read a discoverable user''s photo', $$select count(*) = 1 from storage.objects where bucket_id = 'profile-photos'$$);

-- ===== request -> accept =====
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.send_request('22222222-2222-2222-2222-222222222222', 'Your cycling tag caught my eye', 'Ask me about');
reset role;
create temp table ctx as select id as req from public.chat_requests limit 1;
grant select on ctx to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select test.throws('duplicate request rejected', $$select public.send_request('22222222-2222-2222-2222-222222222222')$$, 'request_exists');
select test.throws('self request rejected', $$select public.send_request(auth.uid())$$, 'invalid_target');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select test.throws('reverse request while pending rejected (unordered pair)', $$select public.send_request('11111111-1111-1111-1111-111111111111')$$, 'request_exists');
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.throws('unrelated user cannot read requests table directly', $$select * from public.chat_requests$$, 'permission denied');
select test.throws('unrelated user cannot accept someone else''s request', $$select public.respond_to_request((select req from ctx), true)$$, 'not_found');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
create temp table conv as select public.respond_to_request((select req from ctx), true) as id;
grant select on conv to authenticated;
select test.check('accepting twice returns the same conversation', $$select public.respond_to_request((select req from ctx), true) = (select id from conv)$$);
select test.check('exactly one conversation exists for the pair', $$select count(*) = 1 from public.list_conversations()$$);
select test.check('request note became the first message', $$select count(*) = 1 and min(body) = 'Your cycling tag caught my eye' from public.list_messages((select id from conv))$$);
select test.check('recipient sees the note as unread', $$select unread = 1 from public.list_conversations()$$);
select test.throws('re-sending a request to a connected user rejected', $$select public.send_request('11111111-1111-1111-1111-111111111111')$$, 'already_connected');

-- ===== messaging =====
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
create temp table m1 as select * from public.send_message((select id from conv), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hello Bob');
grant select on m1 to authenticated;
select test.check('retry with same client id returns the same message', $$select (select id from public.send_message((select id from conv), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hello Bob')) = (select id from m1)$$);
reset role;
select test.record('retry produced no duplicate row', (select count(*) = 2 from public.messages));
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.throws('unrelated user cannot read the thread', $$select * from public.list_messages((select id from conv))$$, 'not_found');
select test.throws('unrelated user cannot send into the thread', $$select * from public.send_message((select id from conv), gen_random_uuid(), 'hi')$$, 'not_found');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select test.throws('empty message rejected (participant)', $$select * from public.send_message((select id from conv), gen_random_uuid(), '   ')$$, 'invalid_body');
select test.throws('oversize message rejected', $$select * from public.send_message((select id from conv), gen_random_uuid(), repeat('x', 1001))$$, 'invalid_body');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select test.check('bob has 2 unread (note + hello)', $$select unread = 2 from public.list_conversations()$$);
select public.mark_read((select id from conv), 999);
select test.check('mark_read clamps to last message', $$select unread = 0 from public.list_conversations()$$);
select public.mark_read((select id from conv), 0);
select test.check('mark_read never moves backwards', $$select unread = 0 from public.list_conversations()$$);
select test.check('catch-up by cursor returns only newer messages in order', $$select count(*) = 1 and min(seq) = 2 from public.list_messages((select id from conv), null, 1)$$);
select test.check('pages of 30 cap at the requested limit', $$select count(*) = 1 from public.list_messages((select id from conv), null, null, 1)$$);

-- ===== blocked user =====
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.block_user('11111111-1111-1111-1111-111111111111');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select test.throws('blocked user cannot send', $$select * from public.send_message((select id from conv), gen_random_uuid(), 'still there?')$$, 'conversation_unavailable');
select test.throws('blocked user cannot read the thread', $$select * from public.list_messages((select id from conv))$$, 'conversation_unavailable');
select test.throws('blocked user cannot open the blocker''s profile', $$select public.get_profile('22222222-2222-2222-2222-222222222222')$$, 'not_found');
select test.check('blocker is hidden from the blocked user''s Nearby', $$select not exists (select 1 from public.list_nearby(1) where id = '22222222-2222-2222-2222-222222222222')$$);
select test.check('conversation row shows as unavailable without the name', $$select unavailable and other_name = 'Unavailable' and other_thumb is null from public.list_conversations()$$);
select test.throws('blocked user cannot send a new request', $$select public.send_request('22222222-2222-2222-2222-222222222222')$$, 'not_found');
-- Photo reads: alice (blocked by bob) must lose access to bob's photos, and vice versa.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.set_photos('[{"object_key":"22222222-2222-2222-2222-222222222222/p.jpg","thumb_key":"22222222-2222-2222-2222-222222222222/pt.jpg"}]');
insert into storage.objects (bucket_id, name) values ('profile-photos', '22222222-2222-2222-2222-222222222222/p.jpg');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select test.check('blocked user gets no new photo access', $$select count(*) = 0 from storage.objects where name like '22222222%'$$);
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.check('unrelated user still sees the photo', $$select count(*) = 1 from storage.objects where name like '22222222%'$$);

-- ===== suspended user =====
reset role;
update public.profiles set status = 'suspended' where id = '55555555-5555-5555-5555-555555555555';
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select test.throws('suspended user cannot list nearby', $$select * from public.list_nearby(1)$$, 'account_unavailable');
select test.throws('suspended user cannot send requests', $$select public.send_request('33333333-3333-3333-3333-333333333333')$$, 'account_unavailable');
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.check('suspended user is hidden from Nearby', $$select not exists (select 1 from public.list_nearby(1) where id = '55555555-5555-5555-5555-555555555555')$$);
select test.throws('suspended profile cannot be opened', $$select public.get_profile('55555555-5555-5555-5555-555555555555')$$, 'not_found');

-- ===== pause discovery, tonight, rate limit =====
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.update_profile('Dave', '', 1, '{}', '[]', false);
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.check('paused user is hidden from Nearby', $$select not exists (select 1 from public.list_nearby(1) where id = '44444444-4444-4444-4444-444444444444')$$);
select test.throws('paused user cannot receive new requests', $$select public.send_request('44444444-4444-4444-4444-444444444444')$$, 'not_found');
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.update_profile('Dave', '', 1, '{}', '[]', true);
select public.set_tonight('Free for chai', 'Indiranagar');
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select test.check('tonight filter shows only users with a live status', $$select count(*) = 1 and min(id::text) = '44444444-4444-4444-4444-444444444444' from public.list_nearby(1, true)$$);

reset role;
-- rate limit: alice -> carol conversation then 60 sends/minute
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.send_request('44444444-4444-4444-4444-444444444444');
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
reset role;
create temp table req2 as select id from public.chat_requests where to_id = '44444444-4444-4444-4444-444444444444' and status = 'pending';
grant select on req2 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
create temp table conv2 as select public.respond_to_request((select id from req2), true) as id;
grant select on conv2 to authenticated;
do $$ declare i int; begin for i in 1..60 loop perform public.send_message((select id from conv2), gen_random_uuid(), 'm' || i); end loop; end $$;
select test.throws('61st message in a minute is rate limited', $$select * from public.send_message((select id from conv2), gen_random_uuid(), 'one too many')$$, 'rate_limited');

reset role;
select label, case when ok then 'PASS' else 'FAIL' end as result, detail from test.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from test.results;
