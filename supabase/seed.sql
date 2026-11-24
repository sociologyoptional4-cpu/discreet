-- SYNTHETIC LOCAL SEED. Fictional adult profiles so Nearby has people to show in development.
-- Real tester accounts are created through email sign-in, never from this file.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'seed.ananya@example.test'),
  ('a0000000-0000-0000-0000-000000000002', 'seed.dev@example.test'),
  ('a0000000-0000-0000-0000-000000000003', 'seed.zoya@example.test');
insert into public.profiles (id, display_name, bio, city_id, tags) values
  ('a0000000-0000-0000-0000-000000000001', 'Ananya', 'Architect sketching old Bangalore bungalows.', 1, '{Design,Photography,Coffee}'),
  ('a0000000-0000-0000-0000-000000000002', 'Dev', 'Drummer, coder, cat person.', 1, '{"Live music",Cats,Design}'),
  ('a0000000-0000-0000-0000-000000000003', 'Zoya', 'Pastry chef. Croissants are my love language.', 1, '{Baking,"Food walks"}');
insert into public.account_private (user_id, dob) values
  ('a0000000-0000-0000-0000-000000000001', '1999-03-02'),
  ('a0000000-0000-0000-0000-000000000002', '1997-08-19'),
  ('a0000000-0000-0000-0000-000000000003', '1996-11-30');
