-- Private photo bucket and private Realtime. Guarded so the migration also runs on a bare Postgres.

grant usage on schema private to authenticated;
create function private.can_see_photos(p_viewer uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.can_see(p_viewer, p_owner); $$;
revoke all on function private.can_see_photos(uuid, uuid) from public, anon;
grant execute on function private.can_see_photos(uuid, uuid) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('profile-photos', 'profile-photos', false, 600000, array['image/jpeg'])
      on conflict (id) do update set public = false, file_size_limit = 600000, allowed_mime_types = array['image/jpeg'];

    -- Owners write into their own folder only.
    create policy photos_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy photos_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
    -- Reads (and therefore new signed URLs) follow the same visibility and block rules as profiles.
    create policy photos_read_visible on storage.objects for select to authenticated
      using (bucket_id = 'profile-photos'
             and private.can_see_photos(auth.uid(), ((storage.foldername(name))[1])::uuid));
  end if;

  if to_regclass('realtime.messages') is not null then
    -- Each user may only listen on their own private topic.
    create policy realtime_own_topic on realtime.messages for select to authenticated
      using (realtime.topic() = 'user:' || auth.uid()::text and extension in ('broadcast'));
  end if;
end $$;
