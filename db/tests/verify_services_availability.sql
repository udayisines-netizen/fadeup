-- FadeUp — LOT 7 verification: service catalog + availability data model.
--
-- Seeds two auth.users fixtures (Jack the owner, Kim an outsider). Proves:
-- category + service with buffers/price; explicit service_locations/
-- barber_services joins (no implicit "everywhere/everyone" semantics);
-- location_hours with its open/close CHECK actually enforced; the
-- tenant-consistency triggers rejecting a real cross-org reference; RLS
-- rejecting a non-member; anon zero access. Cleans up its own fixtures.
--
-- IMPORTANT test-authoring note (a real bug found while writing this): every
-- "expect ERROR" case below runs in its OWN begin/rollback block, separate
-- from legitimate setup. Postgres aborts the whole enclosing transaction on
-- any error inside it — putting a deliberate failure in the same
-- begin/commit as real setup would silently roll back that setup too (this
-- happened on the first draft of this script: a duration-check failure
-- wiped out the service insert that preceded it in the same transaction).
--
-- Run with:
--   docker cp db/tests/verify_services_availability.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_services_availability.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('d4d4d4d4-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot7@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('d4d4d4d4-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'kim+lot7@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Kim Barber"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1a. Jack creates an org (via onboarding), a category, and a service with buffers/price'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers', 'jacks-barbers-lot7', 'Main Shop', 'UTC');

insert into public.service_categories (organization_id, name)
select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot7'
returning name;

insert into public.services (organization_id, category_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents)
select o.id, sc.id, 'Classic Fade', 30, 5, 10, 3500
from public.organizations o join public.service_categories sc on sc.organization_id = o.id
where o.slug = 'jacks-barbers-lot7'
returning name, duration_minutes, price_cents;
commit;

\echo '=========================================================='
\echo '1b. (separate transaction) a zero/invalid duration is rejected, and does NOT roll back 1a'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: services_duration_positive'
insert into public.services (organization_id, name, duration_minutes, price_cents)
select id, 'Invalid Service', 0, 1000 from public.organizations where slug = 'jacks-barbers-lot7';
rollback;

\echo '-- confirm Classic Fade from 1a is still there (proves 1b''s rollback was isolated):'
begin;
reset role;
select name, duration_minutes, price_cents from public.services where name = 'Classic Fade';
commit;

\echo '=========================================================='
\echo '2. Explicit service_locations/barber_services joins — no rows means not offered/eligible'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

insert into public.service_locations (organization_id, service_id, location_id)
select o.id, s.id, l.id
from public.organizations o
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot7'
returning service_id is not null as linked;
commit;

begin;
reset role;
select count(*) as service_location_rows from public.service_locations sl
join public.services s on s.id = sl.service_id
where s.name = 'Classic Fade';
commit;

\echo '=========================================================='
\echo '3a. Location hours: a valid row'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
select o.id, l.id, 1, '09:00', '18:00'
from public.organizations o join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot7'
returning day_of_week, open_time, close_time;
commit;

\echo '=========================================================='
\echo '3b. (separate transaction) open-after-close is rejected'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: location_hours_open_close_consistent'
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
select o.id, l.id, 2, '18:00', '09:00'
from public.organizations o join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot7';
rollback;

\echo '-- confirm Monday''s row from 3a is still there:'
begin;
reset role;
select count(*) as location_hours_rows from public.location_hours lh
join public.locations l on l.id = lh.location_id where l.name = 'Main Shop';
commit;

\echo '=========================================================='
\echo '4a. Jack becomes a barber (needed to test barber_services next)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true
from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
where o.slug = 'jacks-barbers-lot7' and sp.user_id = (select auth.uid())
returning is_bookable;
commit;

\echo '=========================================================='
\echo '4b. Tenant-consistency guard: barber_services cannot reference another org''s service'
\echo '=========================================================='
begin;
reset role;
insert into public.organizations (id, name, slug) values
  ('e5e5e5e5-0000-0000-0000-000000000001', 'Unrelated Org (LOT7 fixture)', 'unrelated-org-lot7');
insert into public.service_categories (id, organization_id, name) values
  ('e5e5e5e5-0000-0000-0000-000000000002', 'e5e5e5e5-0000-0000-0000-000000000001', 'Other Org Category');
insert into public.services (id, organization_id, category_id, name, duration_minutes, price_cents) values
  ('e5e5e5e5-0000-0000-0000-000000000003', 'e5e5e5e5-0000-0000-0000-000000000001', 'e5e5e5e5-0000-0000-0000-000000000002', 'Other Org Service', 20, 2000);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: barber_services.service_id must belong to the same organization_id'
insert into public.barber_services (organization_id, barber_id, service_id)
select b.organization_id, b.id, 'e5e5e5e5-0000-0000-0000-000000000003'
from public.barbers b join public.organizations o on o.id = b.organization_id
where o.slug = 'jacks-barbers-lot7';
rollback;

\echo '-- and the legitimate link (Jack eligible for Classic Fade) still works in its own transaction:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.barber_services (organization_id, barber_id, service_id)
select b.organization_id, b.id, s.id
from public.barbers b
join public.organizations o on o.id = b.organization_id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot7'
returning barber_id is not null as linked;
commit;

\echo '=========================================================='
\echo '5. RLS: Kim (not yet a member) has zero access to Jack''s catalog'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as services_visible_to_kim from public.services s
join public.organizations o on o.id = s.organization_id where o.slug = 'jacks-barbers-lot7';
commit;

\echo '=========================================================='
\echo '6. anon has zero access to all seven new tables'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select
  (select count(*) from public.service_categories) as service_categories_anon,
  (select count(*) from public.services) as services_anon,
  (select count(*) from public.service_locations) as service_locations_anon,
  (select count(*) from public.barber_services) as barber_services_anon,
  (select count(*) from public.location_hours) as location_hours_anon,
  (select count(*) from public.barber_working_hours) as barber_working_hours_anon,
  (select count(*) from public.barber_availability_exceptions) as barber_exceptions_anon;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.barber_services where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.barbers where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.service_locations where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.location_hours where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.services where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.service_categories where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.staff_profiles where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.locations where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.memberships where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot7');
delete from public.organizations where slug = 'jacks-barbers-lot7';
delete from public.services where id = 'e5e5e5e5-0000-0000-0000-000000000003';
delete from public.service_categories where id = 'e5e5e5e5-0000-0000-0000-000000000002';
delete from public.organizations where id = 'e5e5e5e5-0000-0000-0000-000000000001';
delete from auth.users where email in ('jack+lot7@fadeup.test', 'kim+lot7@fadeup.test');
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot7', 'unrelated-org-lot7');
select count(*) as remaining_users from auth.users where email like '%lot7@fadeup.test';
commit;

\echo 'DONE.'
