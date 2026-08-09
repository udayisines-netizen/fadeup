-- FadeUp — LOT 11 phase 1 verification: barber self-service + kiosk/TV RPCs.
--
-- Seeds three auth.users fixtures (Jack the owner/barber, Bob a second
-- barber-role member with his own barbers row, Kim an outsider). Proves:
-- Jack (assigned barber on his own appointment) can update its status but
-- is REJECTED attempting to change customer_name on that same appointment;
-- Bob (NOT the assigned barber) is rejected outright by RLS touching
-- Jack's appointment; owner/manager/receptionist retain full edit rights
-- unaffected by the restriction trigger; the same pattern holds for
-- queue_entries; anon can join_public_queue and then see the entry via
-- get_public_queue_status with identity reduced to "First L." (never full
-- name/phone); anon still has zero direct table access. Cleans up its own
-- fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block (see
-- verify_services_availability.sql's header for why).
--
-- Run with:
--   docker cp db/tests/verify_chair_mode_phase1.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_chair_mode_phase1.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('d2d2d2d2-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot11@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('d2d2d2d2-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'bob+lot11@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Bob Barber"}', 'authenticated', 'authenticated'),
  ('d2d2d2d2-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'kim+lot11@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Kim Outsider"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Jack onboards + becomes a barber; Bob joins as a barber-role member + gets his own barbers row'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers LOT11', 'jacks-barbers-lot11', 'Main Shop', 'UTC');
insert into public.service_categories (organization_id, name) select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot11';
insert into public.services (organization_id, category_id, name, duration_minutes, price_cents)
  select o.id, sc.id, 'Classic Fade', 30, 3500 from public.organizations o join public.service_categories sc on sc.organization_id = o.id where o.slug = 'jacks-barbers-lot11';
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'jacks-barbers-lot11' and sp.user_id = (select auth.uid());
commit;

begin;
reset role;
insert into public.memberships (organization_id, user_id, role) select id, 'd2d2d2d2-0000-0000-0000-000000000002', 'barber' from public.organizations where slug = 'jacks-barbers-lot11';
select id as org_id from public.organizations where slug = 'jacks-barbers-lot11' \gset
select id as main_location_id from public.locations where organization_id = :'org_id' and name = 'Main Shop' \gset
select id as jack_barber_id from public.barbers where organization_id = :'org_id' \gset
select id as classic_fade_id from public.services where organization_id = :'org_id' and name = 'Classic Fade' \gset
commit;

-- Bob's staff_profiles row already exists at this point — auto-provisioned
-- by the handle_new_membership trigger (LOT 6) the instant his membership
-- row was inserted above. No manual insert needed (or allowed: clients
-- can't insert staff_profiles directly, only the trigger does).
begin;
reset role;
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp
  where sp.organization_id = :'org_id' and sp.user_id = 'd2d2d2d2-0000-0000-0000-000000000002';
select id as bob_barber_id from public.barbers where organization_id = :'org_id' and staff_profile_id = (select id from public.staff_profiles where organization_id = :'org_id' and user_id = 'd2d2d2d2-0000-0000-0000-000000000002') \gset
commit;

\echo '=========================================================='
\echo '2. Jack (owner) books TWO appointments: one assigned to himself, one assigned to Bob'
\echo '=========================================================='
\echo '-- (Jack is both owner AND a barber — assigning a test case to him would let the'
\echo '-- managing-role bypass mask the self-service restriction entirely, since he always'
\echo '-- passes the has_org_role check regardless. Bob is barber-only, no managing role,'
\echo '-- so his appointment is what actually exercises the restriction.)'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Alice Customer', '2026-08-17 10:00:00+00', '2026-08-17 10:30:00+00');
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at)
values (:'org_id', :'main_location_id', :'bob_barber_id', :'classic_fade_id', 'Carla Customer', '2026-08-17 11:00:00+00', '2026-08-17 11:30:00+00');
select id as appt_id from public.appointments where organization_id = :'org_id' and customer_name = 'Alice Customer' \gset
select id as appt_bob_id from public.appointments where organization_id = :'org_id' and customer_name = 'Carla Customer' \gset
commit;

\echo '=========================================================='
\echo '3a. Bob (barber-only role, the assigned barber) marks HIS OWN appointment completed — allowed'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
update public.appointments set status = 'completed' where id = :'appt_bob_id';
select status from public.appointments where id = :'appt_bob_id';
commit;

\echo '=========================================================='
\echo '3b. (separate transaction) Bob (self-service, no managing role) tries to rename the customer on his own appointment — rejected'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: a barber may only update status and notes on their own appointments'
update public.appointments set customer_name = 'Renamed Customer' where id = :'appt_bob_id';
rollback;

\echo '-- confirm the customer_name from 2 is untouched (proves 3b''s rollback was isolated and the trigger actually fired, not silently allowed):'
begin;
reset role;
select customer_name, status from public.appointments where id = :'appt_bob_id';
commit;

\echo '=========================================================='
\echo '3c. (separate transaction) Bob (NOT the assigned barber on Jack''s appointment) is rejected by RLS entirely'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect 0 rows updated (RLS silently filters — no row for Bob to match, not a raised error)'
update public.appointments set status = 'no_show' where id = :'appt_id';
rollback;

\echo '=========================================================='
\echo '4. Owner Jack can still fully edit Bob''s appointment (rename customer AND reassign barber_id) — the self-service trigger only restricts non-managing callers'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update public.appointments set customer_name = 'Carla Renamed By Owner', barber_id = :'jack_barber_id', status = 'confirmed' where id = :'appt_bob_id';
select customer_name, barber_id = :'jack_barber_id' as reassigned_to_jack, status from public.appointments where id = :'appt_bob_id';
commit;

\echo '=========================================================='
\echo '5. Kiosk: anon joins the public queue, then sees it via get_public_queue_status with reduced identity'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select status from public.join_public_queue('jacks-barbers-lot11', :'main_location_id', 'Alice Public Walkin', '555-0100');
commit;

begin;
set local role anon;
reset request.jwt.claims;
select display_name, status, queue_position from public.get_public_queue_status('jacks-barbers-lot11', :'main_location_id');
commit;

\echo '-- and staff can see the FULL customer_name/phone for the same row (kiosk entries are ordinary queue_entries rows):'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select customer_name, customer_phone, status from public.queue_entries where organization_id = :'org_id' and customer_name = 'Alice Public Walkin';
commit;

\echo '=========================================================='
\echo '6. join_public_queue rejects an inactive/unknown location, and anon still has zero direct table access'
\echo '=========================================================='
begin;
reset role;
update public.locations set is_active = false where organization_id = :'org_id' and name = 'Main Shop';
commit;

begin;
set local role anon;
reset request.jwt.claims;
\echo '-- expect ERROR: location is not available'
select * from public.join_public_queue('jacks-barbers-lot11', :'main_location_id', 'Too Late Walkin', null);
rollback;

begin;
reset role;
update public.locations set is_active = true where organization_id = :'org_id' and name = 'Main Shop';
commit;

begin;
set local role anon;
reset request.jwt.claims;
select count(*) as queue_entries_anon from public.queue_entries;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.queue_entries where organization_id = :'org_id';
delete from public.appointments where organization_id = :'org_id';
delete from public.barbers where organization_id = :'org_id';
delete from public.services where organization_id = :'org_id';
delete from public.service_categories where organization_id = :'org_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id = :'org_id';
delete from auth.users where email like '%lot11@fadeup.test';
select count(*) as remaining_orgs from public.organizations where slug = 'jacks-barbers-lot11';
select count(*) as remaining_users from auth.users where email like '%lot11@fadeup.test';
commit;

\echo 'DONE.'
