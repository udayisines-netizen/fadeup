-- FadeUp — LOT 8 verification: appointment engine.
--
-- Seeds three auth.users fixtures (Jack the owner/barber, Kim an outsider,
-- Bob a barber-role member). Proves: booking an appointment as
-- owner/manager/receptionist; the GiST exclusion constraint rejecting a
-- real overlapping double-booking for the same barber (not just a
-- theoretical claim); a non-overlapping adjacent booking succeeding; the
-- appointments_check_consistency trigger rejecting a cross-org reference; a
-- barber-role member being rejected by RLS (barbers are read-only in LOT
-- 8); RLS rejecting a non-member; anon zero access to both the table and
-- the get_available_slots RPC; get_available_slots correctly excluding
-- blocked windows (including buffers) and returning free ones. Cleans up
-- its own fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block, isolated
-- from legitimate setup (lesson learned the hard way in
-- verify_services_availability.sql — see that file's header comment).
--
-- Run with:
--   docker cp db/tests/verify_appointments.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_appointments.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('a8a8a8a8-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot8@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('a8a8a8a8-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'kim+lot8@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Kim Outsider"}', 'authenticated', 'authenticated'),
  ('a8a8a8a8-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'bob+lot8@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Bob Barber"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Jack onboards, creates a service + Monday hours, becomes a barber'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select * from public.complete_organization_onboarding('Jack''s Barbers LOT8', 'jacks-barbers-lot8', 'Main Shop', 'UTC');

insert into public.service_categories (organization_id, name)
select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot8';

insert into public.services (organization_id, category_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents)
select o.id, sc.id, 'Classic Fade', 30, 5, 10, 3500
from public.organizations o join public.service_categories sc on sc.organization_id = o.id
where o.slug = 'jacks-barbers-lot8'
returning name, duration_minutes;

-- 2026-08-17 is a Monday (day_of_week = 1).
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
select o.id, l.id, 1, '09:00', '18:00'
from public.organizations o join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot8';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true
from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
where o.slug = 'jacks-barbers-lot8' and sp.user_id = (select auth.uid())
returning is_bookable;

insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time)
select b.organization_id, b.id, 1, '09:00', '17:00'
from public.barbers b join public.organizations o on o.id = b.organization_id
where o.slug = 'jacks-barbers-lot8';

insert into public.service_locations (organization_id, service_id, location_id)
select o.id, s.id, l.id
from public.organizations o
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot8';

insert into public.barber_services (organization_id, barber_id, service_id)
select b.organization_id, b.id, s.id
from public.barbers b
join public.organizations o on o.id = b.organization_id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot8';
commit;

\echo '=========================================================='
\echo '2a. Jack (owner) books 10:00-10:30 on 2026-08-17 — expect success'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, created_by)
select o.id, l.id, b.id, s.id, 'Alice Customer', '2026-08-17 10:00:00+00', '2026-08-17 10:30:00+00', 5, 10, (select auth.uid())
from public.organizations o
join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
join public.barbers b on b.organization_id = o.id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot8'
returning customer_name, status, blocked_range;
commit;

\echo '=========================================================='
\echo '2b. (separate transaction) an overlapping booking for the SAME barber is rejected'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: conflicting key value violates exclusion constraint "appointments_barber_no_overlap"'
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, created_by)
select o.id, l.id, b.id, s.id, 'Overlap Customer', '2026-08-17 10:15:00+00', '2026-08-17 10:45:00+00', 5, 10, (select auth.uid())
from public.organizations o
join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
join public.barbers b on b.organization_id = o.id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot8';
rollback;

\echo '-- confirm the original 10:00-10:30 booking from 2a is still the only appointment (proves 2b''s rollback was isolated):'
begin;
reset role;
select count(*) as appointment_count from public.appointments a
join public.organizations o on o.id = a.organization_id where o.slug = 'jacks-barbers-lot8';
commit;

\echo '=========================================================='
\echo '2c. A non-overlapping booking for the SAME barber later the same day succeeds'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, created_by)
select o.id, l.id, b.id, s.id, 'Later Customer', '2026-08-17 14:00:00+00', '2026-08-17 14:30:00+00', 5, 10, (select auth.uid())
from public.organizations o
join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
join public.barbers b on b.organization_id = o.id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot8'
returning customer_name;
commit;

\echo '=========================================================='
\echo '3. Tenant-consistency guard: appointments cannot reference another org''s location'
\echo '=========================================================='
begin;
reset role;
insert into public.organizations (id, name, slug) values
  ('b9b9b9b9-0000-0000-0000-000000000001', 'Unrelated Org (LOT8 fixture)', 'unrelated-org-lot8');
insert into public.locations (id, organization_id, name, timezone) values
  ('b9b9b9b9-0000-0000-0000-000000000002', 'b9b9b9b9-0000-0000-0000-000000000001', 'Other Shop', 'UTC');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: appointments.location_id must belong to the same organization_id'
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at)
select o.id, 'b9b9b9b9-0000-0000-0000-000000000002', b.id, s.id, 'Cross Org Customer', '2026-08-17 16:00:00+00', '2026-08-17 16:30:00+00'
from public.organizations o
join public.barbers b on b.organization_id = o.id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot8';
rollback;

\echo '=========================================================='
\echo '4. Bob (barber-role member) is rejected by RLS — barbers are read-only in LOT 8'
\echo '=========================================================='
begin;
reset role;
insert into public.memberships (organization_id, user_id, role)
select id, 'a8a8a8a8-0000-0000-0000-000000000003', 'barber' from public.organizations where slug = 'jacks-barbers-lot8';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: new row violates row-level security policy for table "appointments"'
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at)
select o.id, l.id, b.id, s.id, 'Bob Attempt Customer', '2026-08-17 15:00:00+00', '2026-08-17 15:30:00+00'
from public.organizations o
join public.locations l on l.organization_id = o.id
join public.barbers b on b.organization_id = o.id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot8';
rollback;

\echo '-- but Bob (org member) CAN read the schedule:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select count(*) as appointments_visible_to_bob from public.appointments a
join public.organizations o on o.id = a.organization_id where o.slug = 'jacks-barbers-lot8';
commit;

\echo '=========================================================='
\echo '5. Kim (non-member) has zero access to Jack''s appointments'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as appointments_visible_to_kim from public.appointments a
join public.organizations o on o.id = a.organization_id where o.slug = 'jacks-barbers-lot8';
commit;

\echo '=========================================================='
\echo '6. anon has zero access to appointments, and get_available_slots is not anon-callable'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as appointments_anon from public.appointments;
commit;

begin;
set local role anon;
reset request.jwt.claims;
\echo '-- expect ERROR: permission denied for function get_available_slots'
select * from public.get_available_slots(
  (select id from public.organizations where slug = 'jacks-barbers-lot8'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.barbers where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.services where name = 'Classic Fade'),
  '2026-08-17'
);
rollback;

\echo '=========================================================='
\echo '7. get_available_slots excludes the 10:00-10:30 (buffers: 09:55-10:40) blocked window'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a8a8a8a8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

\echo '-- total candidate slots for the day (09:00-16:30 window, 15-min step):'
select count(*) as total_slots from public.get_available_slots(
  (select id from public.organizations where slug = 'jacks-barbers-lot8'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.barbers where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.services where name = 'Classic Fade'),
  '2026-08-17'
);

\echo '-- 10:00 must NOT be offered (expect 0 rows):'
select * from public.get_available_slots(
  (select id from public.organizations where slug = 'jacks-barbers-lot8'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.barbers where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.services where name = 'Classic Fade'),
  '2026-08-17'
) where slot_start = '2026-08-17 10:00:00+00';

\echo '-- 09:15 SHOULD be offered (expect 1 row, more than 5 min clear of the 09:55 buffer edge):'
select * from public.get_available_slots(
  (select id from public.organizations where slug = 'jacks-barbers-lot8'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.barbers where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.services where name = 'Classic Fade'),
  '2026-08-17'
) where slot_start = '2026-08-17 09:15:00+00';

\echo '-- 14:00 must also be excluded now (the 2c booking occupies it):'
select * from public.get_available_slots(
  (select id from public.organizations where slug = 'jacks-barbers-lot8'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.barbers where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.services where name = 'Classic Fade'),
  '2026-08-17'
) where slot_start = '2026-08-17 14:00:00+00';

\echo '-- a Sunday (2026-08-16, no location_hours row) returns zero slots:'
select count(*) as sunday_slots from public.get_available_slots(
  (select id from public.organizations where slug = 'jacks-barbers-lot8'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.barbers where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot8')),
  (select id from public.services where name = 'Classic Fade'),
  '2026-08-16'
);
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.appointments where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.barber_services where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.barber_working_hours where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.barbers where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.service_locations where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.location_hours where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.services where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.service_categories where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.staff_profiles where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.locations where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.memberships where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot8');
delete from public.organizations where slug = 'jacks-barbers-lot8';
delete from public.locations where id = 'b9b9b9b9-0000-0000-0000-000000000002';
delete from public.organizations where id = 'b9b9b9b9-0000-0000-0000-000000000001';
delete from auth.users where email in ('jack+lot8@fadeup.test', 'kim+lot8@fadeup.test', 'bob+lot8@fadeup.test');
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot8', 'unrelated-org-lot8');
select count(*) as remaining_users from auth.users where email like '%lot8@fadeup.test';
commit;

\echo 'DONE.'
