-- Video pipeline, module 2: let a post carry its own thumbnail. Idempotent: safe to run more than once.
--
-- The app now makes a small WebP/JPEG thumbnail on the phone and uploads it with the video. Until this is run, the
-- app still publishes (it retries the insert without the thumbnail), but posts have no poster image.
grant insert (thumbnail_url) on public.posts to authenticated;

-- The feed puts this value in an <img src>, so it must be a plain https URL and not unbounded.
alter table public.posts drop constraint if exists posts_thumbnail_url_https;
alter table public.posts add constraint posts_thumbnail_url_https
  check (thumbnail_url is null or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 500));
