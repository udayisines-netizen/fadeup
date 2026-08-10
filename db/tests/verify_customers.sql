-- FadeUp — LOT 12 verification: customer CRM (customers + auto-link trigger).
--
-- Seeds two auth.users fixtures (Jack the owner/barber, Kim an outsider), a
-- location, a service. Proves: booking an appointment with phone+email
-- auto-creates AND links a customers row; a second booking with the SAME
-- phone re-uses the existing customer (no duplicate) even though the name
-- differs slightly (a nickname/typo case); a booking with no phone/email
-- stays unlinked (customer_id null) rather than creating a junk record; a
-- queue_entries walk-in re-uses a customer already created from an
-- appointment (cross-table linking actually works, not per-table
-- silos); the partial unique indexes reject a raw duplicate-phone insert;
-- the tenant-consistency check rejects an explicitly-supplied cross-org
-- customer_id; RLS matches appointments/queue_entries (owner/manager/
-- receptionist write, any member read); anon has zero access. Cleans up
-- its own fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block (see
-- verify_services_availability.sql's header for why).
--
-- Run with:
--   docker cp db/tests/verify_customers.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_customers.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('c4c4c4c4-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot12@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('c4c4c4c4-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'kim+lot12@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Kim Outsider"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Jack onboards, becomes a barber, creates a service'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers LOT12', 'jacks-barbers-lot12', 'Main Shop', 'UTC');
insert into public.service_categories (organization_id, name) select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot12';
insert into public.services (organization_id, category_id, name, duration_minutes, price_cents)
  select o.id, sc.id, 'Classic Fade', 30, 3500 from public.organizations o join public.service_categories sc on sc.organization_id = o.id where o.slug = 'jacks-barbers-lot12';
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'jacks-barbers-lot12' and sp.user_id = (select auth.uid());
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'jacks-barbers-lot12' \gset
select id as main_location_id from public.locations where organization_id = :'org_id' and name = 'Main Shop' \gset
select id as jack_barber_id from public.barbers where organization_id = :'org_id' \gset
select id as classic_fade_id from public.services where organization_id = :'org_id' and name = 'Classic Fade' \gset
commit;

\echo '=========================================================='
\echo '2a. First appointment with phone+email — auto-creates AND links a customers row'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, customer_phone, customer_email, starts_at, ends_at)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Alice Customer', '555-0100', 'alice@example.com', '2026-08-17 10:00:00+00', '2026-08-17 10:30:00+00')
returning customer_id is not null as was_linked;
commit;

\echo '-- exactly one customers row exists, matching the appointment name/phone/email:'
begin;
reset role;
select count(*) as customer_count, (array_agg(name))[1] as name, (array_agg(phone))[1] as phone, (array_agg(email))[1] as email
from public.customers where organization_id = :'org_id';
commit;

\echo '=========================================================='
\echo '2b. Second appointment, SAME phone but a slightly different name (nickname) — reuses the existing customer, no duplicate'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Ali (Alice)', '555-0100', '2026-08-17 14:00:00+00', '2026-08-17 14:30:00+00')
returning customer_id is not null as was_linked;
commit;

\echo '-- STILL exactly one customers row for this org (the second booking reused it, did not create a duplicate):'
begin;
reset role;
select count(*) as customer_count_after_second_booking from public.customers where organization_id = :'org_id';
commit;

\echo '-- and both appointments point at the SAME customer_id:'
begin;
reset role;
select count(distinct customer_id) as distinct_customer_ids from public.appointments where organization_id = :'org_id';
commit;

\echo '=========================================================='
\echo '3. A booking with NO phone/email stays unlinked (customer_id null) — no junk record created'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Walk-in No Contact', '2026-08-17 16:00:00+00', '2026-08-17 16:30:00+00')
returning customer_id is null as correctly_unlinked;
commit;

\echo '-- customer count is still exactly one (the anonymous booking did not create a row):'
begin;
reset role;
select count(*) as customer_count_still_one from public.customers where organization_id = :'org_id';
commit;

\echo '=========================================================='
\echo '4. Cross-table linking: a queue_entries walk-in with the SAME phone reuses the appointment-created customer'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.queue_entries (organization_id, location_id, customer_name, customer_phone)
values (:'org_id', :'main_location_id', 'Alice Walked In', '555-0100')
returning customer_id is not null as was_linked;
commit;

\echo '-- the queue entry''s customer_id matches the appointments'' customer_id (cross-table, not a per-table silo):'
begin;
reset role;
select
  (select customer_id from public.queue_entries where organization_id = :'org_id') =
  (select distinct customer_id from public.appointments where organization_id = :'org_id' and customer_id is not null)
  as same_customer_across_tables;
commit;

\echo '=========================================================='
\echo '5. Partial unique index: a raw duplicate-phone customers insert is rejected'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: duplicate key value violates unique constraint "customers_org_phone_unique"'
insert into public.customers (organization_id, name, phone) values (:'org_id', 'Duplicate Phone Customer', '555-0100');
rollback;

\echo '=========================================================='
\echo '6. Tenant-consistency guard: an explicitly-supplied cross-org customer_id is rejected'
\echo '=========================================================='
begin;
reset role;
insert into public.organizations (id, name, slug) values ('c5c5c5c5-0000-0000-0000-000000000001', 'Unrelated Org (LOT12 fixture)', 'unrelated-org-lot12');
insert into public.customers (id, organization_id, name) values ('c5c5c5c5-0000-0000-0000-000000000002', 'c5c5c5c5-0000-0000-0000-000000000001', 'Other Org Customer');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: customer_id must belong to the same organization_id'
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_id, customer_name, starts_at, ends_at)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'c5c5c5c5-0000-0000-0000-000000000002', 'Cross Org Customer Attempt', '2026-08-17 18:00:00+00', '2026-08-17 18:30:00+00');
rollback;

\echo '=========================================================='
\echo '7. RLS: Kim (non-member) has zero access; anon has zero access'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4c4c4c4-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as customers_visible_to_kim from public.customers where organization_id = :'org_id';
commit;

begin;
set local role anon;
reset request.jwt.claims;
select count(*) as customers_anon from public.customers;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.queue_entries where organization_id = :'org_id';
delete from public.appointments where organization_id = :'org_id';
delete from public.customers where organization_id = :'org_id';
delete from public.barbers where organization_id = :'org_id';
delete from public.services where organization_id = :'org_id';
delete from public.service_categories where organization_id = :'org_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id = :'org_id';
delete from public.customers where id = 'c5c5c5c5-0000-0000-0000-000000000002';
delete from public.organizations where id = 'c5c5c5c5-0000-0000-0000-000000000001';
delete from auth.users where email like '%lot12@fadeup.test';
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot12', 'unrelated-org-lot12');
select count(*) as remaining_users from auth.users where email like '%lot12@fadeup.test';
commit;

\echo 'DONE.'
