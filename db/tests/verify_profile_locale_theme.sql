-- FadeUp — verification: profiles.locale / profiles.theme
-- (db/migrations/20260810120000_profile_locale_theme.sql)
--
-- Proves: a valid locale/theme update succeeds; an invalid locale value is
-- rejected by profiles_locale_valid; an invalid theme value is rejected by
-- profiles_theme_valid; NULL is still allowed for both (no preference set);
-- a second user cannot read or write the first user's preferences — reuses
-- the existing profiles_select_own/profiles_update_own RLS from
-- 20260809100200_profiles.sql, this just confirms it still applies to the
-- two new columns. Cleans up its own fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- Run with:
--   docker cp db/tests/verify_profile_locale_theme.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_profile_locale_theme.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('dadadada-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'nina+prefs@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Nina Prefs"}', 'authenticated', 'authenticated'),
  ('dadadada-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'omar+prefs@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Omar Prefs"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. New profiles start with locale/theme both NULL (no preference set)'
\echo '=========================================================='
begin;
reset role;
select locale, theme from public.profiles where id = 'dadadada-0000-0000-0000-000000000001';
commit;

\echo '=========================================================='
\echo '2. Nina sets a valid locale + theme on her own profile — succeeds'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'dadadada-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update public.profiles set locale = 'fr', theme = 'dark' where id = 'dadadada-0000-0000-0000-000000000001';
select locale, theme from public.profiles where id = 'dadadada-0000-0000-0000-000000000001';
commit;

\echo '=========================================================='
\echo '3. An invalid locale is REJECTED by profiles_locale_valid'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'dadadada-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: violates check constraint "profiles_locale_valid"'
update public.profiles set locale = 'klingon' where id = 'dadadada-0000-0000-0000-000000000001';
rollback;

\echo '=========================================================='
\echo '4. An invalid theme is REJECTED by profiles_theme_valid'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'dadadada-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: violates check constraint "profiles_theme_valid"'
update public.profiles set theme = 'rainbow' where id = 'dadadada-0000-0000-0000-000000000001';
rollback;

\echo '=========================================================='
\echo '5. Clearing back to NULL (no preference) succeeds — NULL is always valid'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'dadadada-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update public.profiles set locale = null, theme = null where id = 'dadadada-0000-0000-0000-000000000001';
commit;

\echo '=========================================================='
\echo '6. Omar cannot read or write Ninas preferences (existing RLS still applies)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'dadadada-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as nina_rows_visible_to_omar from public.profiles where id = 'dadadada-0000-0000-0000-000000000001';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'dadadada-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect 0 rows updated (RLS filters the target row, not an error — UPDATE...WHERE with no visible match just affects nothing)'
update public.profiles set locale = 'es' where id = 'dadadada-0000-0000-0000-000000000001';
select locale from public.profiles where id = 'dadadada-0000-0000-0000-000000000001';
rollback;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from auth.users where email like '%prefs@fadeup.test';
select count(*) as remaining_users from auth.users where email like '%prefs@fadeup.test';
commit;

\echo 'DONE.'
