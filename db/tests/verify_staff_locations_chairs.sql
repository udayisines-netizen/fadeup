-- FadeUp — LOT 6 verification: staff_profiles auto-provisioning, barbers,
-- chairs, and tenant-consistency guards.
--
-- Seeds two auth.users fixtures (Henry the owner, Ivy the invited barber),
-- proves staff_profiles is auto-created for both (org creation trigger +
-- accept_invitation path), that a chair/barber can be created for the right
-- location/staff_profile, that cross-tenant consistency triggers reject a
-- location/staff_profile from a different org, and that RLS denies a
-- non-owner/manager write. Cleans up its own fixtures.
--
-- Run with:
--   docker cp db/tests/verify_staff_locations_chairs.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_staff_locations_chairs.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('b2b2b2b2-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'henry+lot6@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Henry Owner"}', 'authenticated', 'authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'ivy+lot6@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Ivy Barber"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Henry creates an org — staff_profiles auto-created for the owner'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b2b2b2b2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Henry''s Cuts', 'henrys-cuts-lot6', 'Main Shop', 'UTC');
select display_name, is_active from public.staff_profiles sp
join public.organizations o on o.id = sp.organization_id
where o.slug = 'henrys-cuts-lot6' and sp.user_id = (select auth.uid());
commit;

\echo '=========================================================='
\echo '2. Henry invites Ivy as a barber; Ivy accepts — her staff_profiles auto-created too'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b2b2b2b2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.invitations (organization_id, email, role, token, invited_by)
select id, 'ivy+lot6@fadeup.test', 'barber', 'lot6-test-token', (select auth.uid())
from public.organizations where slug = 'henrys-cuts-lot6';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b2b2b2b2-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select public.accept_invitation('lot6-test-token');
select display_name from public.staff_profiles sp
join public.organizations o on o.id = sp.organization_id
where o.slug = 'henrys-cuts-lot6' and sp.user_id = (select auth.uid());
commit;

\echo '=========================================================='
\echo '3. Henry adds a second location and a chair at Main Shop; marks Ivy a barber'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b2b2b2b2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

insert into public.locations (organization_id, name)
select id, 'Downtown Branch' from public.organizations where slug = 'henrys-cuts-lot6'
returning name;

insert into public.chairs (organization_id, location_id, name)
select o.id, l.id, 'Chair 1'
from public.organizations o join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'henrys-cuts-lot6'
returning name;

-- Look up Ivy's staff_profile via staff_profiles itself (any org member can
-- see it, per staff_profiles_select) — NOT via auth.users/profiles, which
-- Henry has no RLS access to for another user. This is the actual point of
-- staff_profiles existing: org-scoped visibility that profiles/auth.users
-- deliberately don't have.
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select o.id, sp.id, true
from public.organizations o
join public.staff_profiles sp on sp.organization_id = o.id
where o.slug = 'henrys-cuts-lot6' and sp.display_name = 'Ivy Barber'
returning is_bookable;
commit;

\echo '=========================================================='
\echo '4. Tenant-consistency guard: a chair cannot reference another org''s location'
\echo '=========================================================='
begin;
-- Set up an unrelated second org + location directly (as postgres, bypassing
-- RLS) purely so there is another org's location to actually conflict
-- against below.
reset role;
insert into public.organizations (id, name, slug) values
  ('c3c3c3c3-0000-0000-0000-000000000001', 'Unrelated Org (LOT6 fixture)', 'unrelated-org-lot6');
insert into public.locations (id, organization_id, name) values
  ('c3c3c3c3-0000-0000-0000-000000000002', 'c3c3c3c3-0000-0000-0000-000000000001', 'Unrelated Location');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b2b2b2b2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: chairs.location_id must belong to the same organization_id'
insert into public.chairs (organization_id, location_id, name)
select o.id, 'c3c3c3c3-0000-0000-0000-000000000002', 'Cross-tenant chair'
from public.organizations o where o.slug = 'henrys-cuts-lot6';
rollback;

\echo '=========================================================='
\echo '5. RLS: Ivy (barber, not owner/manager) cannot create a chair'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b2b2b2b2-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: RLS policy violation'
insert into public.chairs (organization_id, location_id, name)
select organization_id, id, 'Ivy''s unauthorized chair' from public.locations where name = 'Main Shop'
and organization_id = (select organization_id from public.memberships where user_id = (select auth.uid()) limit 1);
rollback;

\echo '=========================================================='
\echo '6. anon has zero access to all three new tables'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as staff_profiles_visible_to_anon from public.staff_profiles;
select count(*) as barbers_visible_to_anon from public.barbers;
select count(*) as chairs_visible_to_anon from public.chairs;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.chairs where organization_id in (select id from public.organizations where slug = 'henrys-cuts-lot6');
delete from public.barbers where organization_id in (select id from public.organizations where slug = 'henrys-cuts-lot6');
delete from public.staff_profiles where organization_id in (select id from public.organizations where slug = 'henrys-cuts-lot6');
delete from public.locations where organization_id in (select id from public.organizations where slug = 'henrys-cuts-lot6');
delete from public.invitations where token = 'lot6-test-token';
delete from public.memberships where organization_id in (select id from public.organizations where slug = 'henrys-cuts-lot6');
delete from public.organizations where slug = 'henrys-cuts-lot6';
delete from public.locations where id = 'c3c3c3c3-0000-0000-0000-000000000002';
delete from public.organizations where id = 'c3c3c3c3-0000-0000-0000-000000000001';
delete from auth.users where email in ('henry+lot6@fadeup.test', 'ivy+lot6@fadeup.test');
select count(*) as remaining_orgs from public.organizations where slug in ('henrys-cuts-lot6', 'unrelated-org-lot6');
select count(*) as remaining_users from auth.users where email like '%lot6@fadeup.test';
commit;

\echo 'DONE.'
