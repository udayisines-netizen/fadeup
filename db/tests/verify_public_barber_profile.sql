-- FadeUp — LOT 12 verification: Barber Passport (get_public_barber, list_public_barber_services).
--
-- Seeds an org with two barbers: Sam (is_public = true, one active service)
-- and Priya, explicitly opted OUT (is_public = false — note profiles
-- actually default to true, see 20260809120000_staff_profiles.sql; this
-- test does not rely on that default). Proves: get_public_barber
-- returns Sam's profile as anon; get_public_barber returns ZERO rows for
-- Priya (private, not an error — same shape as "unknown id"); a barber_id
-- belonging to a different org returns zero rows even if that org has a
-- public barber (no cross-org leakage); list_public_barber_services returns
-- Sam's one active service and correctly excludes an inactive one; anon has
-- zero direct table access throughout; the same RPCs also work for an
-- authenticated caller. Cleans up its own fixtures.
--
-- Run with:
--   docker cp db/tests/verify_public_barber_profile.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_public_barber_profile.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('c6c6c6c6-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot12passport@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('c6c6c6c6-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'priya+lot12passport@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Priya Private"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Jack onboards; Sam (Jack himself) is public, Priya is private (default)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c6c6c6c6-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers LOT12P', 'jacks-barbers-lot12p', 'Main Shop', 'UTC');
insert into public.service_categories (organization_id, name) select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot12p';
insert into public.services (organization_id, category_id, name, duration_minutes, price_cents, is_active)
  select o.id, sc.id, 'Classic Fade', 30, 3500, true from public.organizations o join public.service_categories sc on sc.organization_id = o.id where o.slug = 'jacks-barbers-lot12p';
insert into public.services (organization_id, category_id, name, duration_minutes, price_cents, is_active)
  select o.id, sc.id, 'Retired Service', 30, 3500, false from public.organizations o join public.service_categories sc on sc.organization_id = o.id where o.slug = 'jacks-barbers-lot12p';
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'jacks-barbers-lot12p' and sp.user_id = (select auth.uid());
update public.staff_profiles set is_public = true, avatar_url = 'https://example.com/sam.jpg', title = 'Master Barber', bio = 'Fades and tapers.'
  where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot12p') and user_id = (select auth.uid());
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'jacks-barbers-lot12p' \gset
select id as sam_barber_id from public.barbers where organization_id = :'org_id' \gset
select id as classic_fade_id from public.services where organization_id = :'org_id' and name = 'Classic Fade' \gset
select id as retired_service_id from public.services where organization_id = :'org_id' and name = 'Retired Service' \gset
insert into public.barber_services (organization_id, barber_id, service_id) values (:'org_id', :'sam_barber_id', :'classic_fade_id');
insert into public.barber_services (organization_id, barber_id, service_id) values (:'org_id', :'sam_barber_id', :'retired_service_id');
-- Priya: a second member, added as a barber, then explicitly opted OUT of
-- public visibility (staff_profiles.is_public defaults to true — a fresh
-- profile is public until someone turns it off).
insert into public.memberships (organization_id, user_id, role) values (:'org_id', 'c6c6c6c6-0000-0000-0000-000000000002', 'barber');
select id as priya_profile_id from public.staff_profiles where organization_id = :'org_id' and user_id = 'c6c6c6c6-0000-0000-0000-000000000002' \gset
update public.staff_profiles set is_public = false where id = :'priya_profile_id';
insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (:'org_id', :'priya_profile_id', true)
  returning id as priya_barber_id \gset
commit;

\echo '=========================================================='
\echo '2. get_public_barber returns Sam''s (public) profile as anon'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select display_name, title, bio, avatar_url from public.get_public_barber('jacks-barbers-lot12p', :'sam_barber_id');
commit;

\echo '=========================================================='
\echo '3. get_public_barber returns ZERO rows for Priya (is_public = false) — not an error'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as priya_rows_visible_to_anon from public.get_public_barber('jacks-barbers-lot12p', :'priya_barber_id');
commit;

\echo '=========================================================='
\echo '4. get_public_barber returns ZERO rows for a barber id from a DIFFERENT org (no cross-org leakage)'
\echo '=========================================================='
begin;
reset role;
insert into public.organizations (id, name, slug) values ('c7c7c7c7-0000-0000-0000-000000000001', 'Unrelated Org (LOT12P fixture)', 'unrelated-org-lot12p');
commit;

begin;
set local role anon;
reset request.jwt.claims;
select count(*) as cross_org_rows from public.get_public_barber('unrelated-org-lot12p', :'sam_barber_id');
commit;

\echo '=========================================================='
\echo '5. list_public_barber_services returns Sam''s ONE active service, excludes the inactive one'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as active_services_visible, (array_agg(name))[1] as service_name
from public.list_public_barber_services('jacks-barbers-lot12p', :'sam_barber_id');
commit;

\echo '-- and list_public_barber_services returns ZERO rows for Priya (private):'
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as priya_services_visible from public.list_public_barber_services('jacks-barbers-lot12p', :'priya_barber_id');
commit;

\echo '=========================================================='
\echo '6. anon still has ZERO direct table access — only the RPCs mediate anything'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select
  (select count(*) from public.staff_profiles) as staff_profiles_anon,
  (select count(*) from public.barbers) as barbers_anon,
  (select count(*) from public.barber_services) as barber_services_anon;
commit;

\echo '=========================================================='
\echo '7. the same RPCs also work for an authenticated caller (not anon-exclusive)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c6c6c6c6-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select display_name from public.get_public_barber('jacks-barbers-lot12p', :'sam_barber_id');
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.barber_services where organization_id = :'org_id';
delete from public.barbers where organization_id = :'org_id';
delete from public.services where organization_id = :'org_id';
delete from public.service_categories where organization_id = :'org_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id = :'org_id';
delete from public.organizations where id = 'c7c7c7c7-0000-0000-0000-000000000001';
delete from auth.users where email like '%lot12passport@fadeup.test';
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot12p', 'unrelated-org-lot12p');
select count(*) as remaining_users from auth.users where email like '%lot12passport@fadeup.test';
commit;

\echo 'DONE.'
