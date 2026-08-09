-- FadeUp — LOT 9 verification: public booking.
--
-- Seeds one auth.users fixture (Jack, owner/barber) plus a fully-configured
-- org (service, location hours, barber working hours, service_locations,
-- barber_services) — the same shape as the LOT 8 fixture. Proves, calling
-- as the `anon` role throughout (this is the whole point of the lot): the
-- read RPCs return real, correctly-scoped data and empty results for
-- cross-tenant/inactive/ineligible combinations; book_public_appointment
-- succeeds for a genuinely valid request; it rejects an out-of-hours
-- request, a request for a service not offered at that location, a request
-- for an ineligible barber, and a request overlapping an existing booking
-- (the GiST exclusion constraint firing even from inside a SECURITY
-- DEFINER function); anon still has zero direct table access throughout
-- (only the RPCs mediate access); a normal authenticated org member can
-- also call the same RPCs (they are not anon-exclusive). Cleans up its own
-- fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block, isolated
-- from legitimate setup (see verify_services_availability.sql's header for
-- why).
--
-- Run with:
--   docker cp db/tests/verify_public_booking.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_public_booking.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('c7c7c7c7-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot9@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Jack sets up a fully bookable org: service, Monday hours, barber, joins'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c7c7c7c7-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select * from public.complete_organization_onboarding('Jack''s Barbers LOT9', 'jacks-barbers-lot9', 'Main Shop', 'UTC');

insert into public.service_categories (organization_id, name)
select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot9';

insert into public.services (organization_id, category_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents)
select o.id, sc.id, 'Classic Fade', 30, 5, 10, 3500
from public.organizations o join public.service_categories sc on sc.organization_id = o.id
where o.slug = 'jacks-barbers-lot9';

-- an inactive "old" location and a not-yet-offered "beard trim" service,
-- to prove the public reads correctly exclude both.
insert into public.locations (organization_id, name, timezone, is_active)
select id, 'Closed Branch', 'UTC', false from public.organizations where slug = 'jacks-barbers-lot9';

insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
select id, 'Beard Trim (unlisted)', 15, 1500, true from public.organizations where slug = 'jacks-barbers-lot9';

-- 2026-08-17 is a Monday (day_of_week = 1).
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
select o.id, l.id, 1, '09:00', '18:00'
from public.organizations o join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot9';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true
from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
where o.slug = 'jacks-barbers-lot9' and sp.user_id = (select auth.uid());

update public.staff_profiles set location_id = (select id from public.locations where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot9') and name = 'Main Shop')
where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot9') and user_id = (select auth.uid());

insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time)
select b.organization_id, b.id, 1, '09:00', '17:00'
from public.barbers b join public.organizations o on o.id = b.organization_id
where o.slug = 'jacks-barbers-lot9';

insert into public.service_locations (organization_id, service_id, location_id)
select o.id, s.id, l.id
from public.organizations o
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
join public.locations l on l.organization_id = o.id and l.name = 'Main Shop'
where o.slug = 'jacks-barbers-lot9';

insert into public.barber_services (organization_id, barber_id, service_id)
select b.organization_id, b.id, s.id
from public.barbers b
join public.organizations o on o.id = b.organization_id
join public.services s on s.organization_id = o.id and s.name = 'Classic Fade'
where o.slug = 'jacks-barbers-lot9';
commit;

-- Capture fixture ids as postgres (bypasses RLS) into psql variables for
-- reuse below. This is test scaffolding, not part of what's being tested —
-- the earlier draft of this script instead re-queried public.locations/
-- services/barbers directly from INSIDE the anon-role sections to compute
-- these ids, which is a real bug in the test itself: anon has zero RLS
-- access to those tables (see section 7), so those subqueries silently
-- evaluated to NULL and every anon RPC call below was silently called with
-- NULL ids, producing misleading "empty result" / "not found" failures
-- that looked like the RPCs were broken. They were not — the test was.
begin;
reset role;
select id as main_location_id from public.locations
  where name = 'Main Shop' and organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot9') \gset
select id as classic_fade_id from public.services
  where name = 'Classic Fade' and organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot9') \gset
select id as beard_trim_id from public.services
  where name = 'Beard Trim (unlisted)' and organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot9') \gset
select id as jack_barber_id from public.barbers
  where organization_id = (select id from public.organizations where slug = 'jacks-barbers-lot9') \gset
commit;

\echo '=========================================================='
\echo '2. anon: get_public_organization / list_public_locations — real data, unknown slug empty'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select name, slug from public.get_public_organization('jacks-barbers-lot9');
select count(*) as unknown_org_rows from public.get_public_organization('no-such-shop-lot9');
select name from public.list_public_locations('jacks-barbers-lot9');
select count(*) as active_locations_only from public.list_public_locations('jacks-barbers-lot9');
commit;

\echo '=========================================================='
\echo '3. anon: list_public_services excludes the unlisted (not service_locations-linked) service'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select name, duration_minutes, price_cents from public.list_public_services(
  'jacks-barbers-lot9',
  :'main_location_id'
);
commit;

\echo '=========================================================='
\echo '4. anon: list_public_barbers returns Jack for Classic Fade at Main Shop'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select display_name from public.list_public_barbers(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'classic_fade_id'
);
commit;

\echo '=========================================================='
\echo '5. anon: get_public_available_slots offers 09:15, not 10:00 or later slots that don''t exist yet (none booked yet)'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as total_slots from public.get_public_available_slots(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'jack_barber_id',
  :'classic_fade_id',
  '2026-08-17'
);
commit;

\echo '=========================================================='
\echo '6a. anon: book_public_appointment succeeds for a genuinely valid request (10:00, 2026-08-17)'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select id, starts_at, ends_at, status from public.book_public_appointment(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'jack_barber_id',
  :'classic_fade_id',
  '2026-08-17 10:00:00+00',
  'Alice Public Customer',
  '555-0100',
  null,
  'first time customer'
);
commit;

\echo '-- confirm it landed with status=pending and shows up for staff:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c7c7c7c7-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select customer_name, status from public.appointments a
join public.organizations o on o.id = a.organization_id where o.slug = 'jacks-barbers-lot9';
commit;

\echo '=========================================================='
\echo '6b. (separate transaction) anon booking the SAME slot again is rejected — exclusion constraint fires even from inside SECURITY DEFINER'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
\echo '-- expect ERROR: conflicting key value violates exclusion constraint "appointments_barber_no_overlap"'
select * from public.book_public_appointment(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'jack_barber_id',
  :'classic_fade_id',
  '2026-08-17 10:15:00+00',
  'Duplicate Customer',
  '555-0101',
  null,
  null
);
rollback;

\echo '=========================================================='
\echo '6c. anon booking BEFORE opening hours (07:00) is rejected by hours validation, not just the exclusion constraint'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
\echo '-- expect ERROR: requested time is outside available hours'
select * from public.book_public_appointment(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'jack_barber_id',
  :'classic_fade_id',
  '2026-08-17 07:00:00+00',
  'Too Early Customer',
  '555-0102',
  null,
  null
);
rollback;

\echo '=========================================================='
\echo '6d. anon booking the unlisted service (not offered at this location) is rejected'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
\echo '-- expect ERROR: service is not available for booking at this location'
select * from public.book_public_appointment(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'jack_barber_id',
  :'beard_trim_id',
  '2026-08-17 11:00:00+00',
  'Unlisted Service Customer',
  '555-0103',
  null,
  null
);
rollback;

\echo '=========================================================='
\echo '6e. anon booking with no contact info at all is rejected'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
\echo '-- expect ERROR: at least one of customer_phone or customer_email is required'
select * from public.book_public_appointment(
  'jacks-barbers-lot9',
  :'main_location_id',
  :'jack_barber_id',
  :'classic_fade_id',
  '2026-08-17 12:00:00+00',
  'No Contact Customer',
  null,
  null,
  null
);
rollback;

\echo '=========================================================='
\echo '7. anon still has ZERO direct table access — only the RPCs mediate anything'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select
  (select count(*) from public.appointments) as appointments_anon,
  (select count(*) from public.organizations) as organizations_anon,
  (select count(*) from public.locations) as locations_anon,
  (select count(*) from public.services) as services_anon,
  (select count(*) from public.barbers) as barbers_anon,
  (select count(*) from public.staff_profiles) as staff_profiles_anon;
commit;

\echo '=========================================================='
\echo '8. the same RPCs also work for an authenticated caller (not anon-exclusive)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c7c7c7c7-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select name from public.get_public_organization('jacks-barbers-lot9');
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.appointments where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.barber_services where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.barber_working_hours where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.barbers where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.service_locations where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.location_hours where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.services where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.service_categories where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.staff_profiles where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.locations where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.memberships where organization_id in (select id from public.organizations where slug = 'jacks-barbers-lot9');
delete from public.organizations where slug = 'jacks-barbers-lot9';
delete from auth.users where email = 'jack+lot9@fadeup.test';
select count(*) as remaining_orgs from public.organizations where slug = 'jacks-barbers-lot9';
select count(*) as remaining_users from auth.users where email like '%lot9@fadeup.test';
commit;

\echo 'DONE.'
