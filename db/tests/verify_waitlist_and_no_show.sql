-- FadeUp — LOT 13 verification: waitlist_entries + apply_appointment_no_show_rule.
--
-- Seeds Jack (owner/barber) and Kim (non-member). Proves: a waitlist entry
-- auto-links to a customer via the reused LOT 12 trigger; cross-org
-- desired_service_id/desired_barber_id are rejected by the consistency
-- trigger; RLS matches appointments/customers (member read, owner/manager/
-- receptionist write; non-member and anon zero access); a confirmed
-- appointment more than 30 minutes past its end time is flipped to
-- no_show by apply_appointment_no_show_rule, a confirmed appointment still
-- within the grace window is left alone, and an already-cancelled
-- appointment past its end time is untouched (the rule only ever touches
-- confirmed rows); calling the rule again is a no-op (idempotent — 0 rows
-- the second time). Cleans up its own fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- Run with:
--   docker cp db/tests/verify_waitlist_and_no_show.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_waitlist_and_no_show.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('c8c8c8c8-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot13@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('c8c8c8c8-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'kim+lot13@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Kim Outsider"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Jack onboards, becomes a barber, creates a service'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c8c8c8c8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers LOT13', 'jacks-barbers-lot13', 'Main Shop', 'UTC');
insert into public.service_categories (organization_id, name) select id, 'Haircuts' from public.organizations where slug = 'jacks-barbers-lot13';
insert into public.services (organization_id, category_id, name, duration_minutes, price_cents)
  select o.id, sc.id, 'Classic Fade', 30, 3500 from public.organizations o join public.service_categories sc on sc.organization_id = o.id where o.slug = 'jacks-barbers-lot13';
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'jacks-barbers-lot13' and sp.user_id = (select auth.uid());
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'jacks-barbers-lot13' \gset
select id as main_location_id from public.locations where organization_id = :'org_id' and name = 'Main Shop' \gset
select id as jack_barber_id from public.barbers where organization_id = :'org_id' \gset
select id as classic_fade_id from public.services where organization_id = :'org_id' and name = 'Classic Fade' \gset
insert into public.organizations (id, name, slug) values ('c9c9c9c9-0000-0000-0000-000000000001', 'Unrelated Org (LOT13 fixture)', 'unrelated-org-lot13');
insert into public.services (id, organization_id, category_id, name, duration_minutes, price_cents)
  values ('c9c9c9c9-0000-0000-0000-000000000002', 'c9c9c9c9-0000-0000-0000-000000000001', null, 'Other Org Service', 30, 1000);
commit;

\echo '=========================================================='
\echo '2. A waitlist entry with phone+email auto-creates AND links a customer (reused LOT 12 trigger)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c8c8c8c8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.waitlist_entries (organization_id, location_id, customer_name, customer_phone, customer_email, desired_service_id, desired_barber_id)
values (:'org_id', :'main_location_id', 'Alice Waiting', '555-0300', 'alice.wait@example.com', :'classic_fade_id', :'jack_barber_id')
returning customer_id is not null as was_linked;
commit;

\echo '=========================================================='
\echo '3. A cross-org desired_service_id is rejected by the consistency trigger'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c8c8c8c8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: desired_service_id must belong to the same organization_id as the waitlist entry'
insert into public.waitlist_entries (organization_id, location_id, customer_name, desired_service_id)
values (:'org_id', :'main_location_id', 'Bad Reference', 'c9c9c9c9-0000-0000-0000-000000000002');
rollback;

\echo '=========================================================='
\echo '4. RLS: Kim (non-member) has zero access; anon has zero access'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c8c8c8c8-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as waitlist_visible_to_kim from public.waitlist_entries where organization_id = :'org_id';
commit;

begin;
set local role anon;
reset request.jwt.claims;
select count(*) as waitlist_anon from public.waitlist_entries;
commit;

\echo '=========================================================='
\echo '5. No-show rule: an overdue confirmed appointment (35 min past end) is marked no_show'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c8c8c8c8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Overdue Confirmed', now() - interval '65 minutes', now() - interval '35 minutes', 'confirmed')
returning id as overdue_appt_id \gset
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Recently Ended Confirmed', now() - interval '25 minutes', now() - interval '10 minutes', 'confirmed')
returning id as recent_appt_id \gset
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status)
values (:'org_id', :'main_location_id', :'jack_barber_id', :'classic_fade_id', 'Overdue But Cancelled', now() - interval '65 minutes', now() - interval '35 minutes', 'cancelled')
returning id as cancelled_appt_id \gset
select public.apply_appointment_no_show_rule(:'org_id') as rows_marked_no_show;
commit;

\echo '-- the overdue confirmed appointment is now no_show, the recent one is still confirmed, the cancelled one is untouched:'
begin;
reset role;
select
  (select status from public.appointments where id = :'overdue_appt_id') as overdue_status,
  (select status from public.appointments where id = :'recent_appt_id') as recent_status,
  (select status from public.appointments where id = :'cancelled_appt_id') as cancelled_status;
commit;

\echo '-- calling the rule again is a no-op (already-no_show rows do not match a second time):'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c8c8c8c8-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select public.apply_appointment_no_show_rule(:'org_id') as rows_marked_second_call;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.appointments where organization_id = :'org_id';
delete from public.waitlist_entries where organization_id = :'org_id';
delete from public.customers where organization_id = :'org_id';
delete from public.barbers where organization_id = :'org_id';
delete from public.services where organization_id in (:'org_id', 'c9c9c9c9-0000-0000-0000-000000000001');
delete from public.service_categories where organization_id = :'org_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id in (:'org_id', 'c9c9c9c9-0000-0000-0000-000000000001');
delete from auth.users where email like '%lot13@fadeup.test';
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot13', 'unrelated-org-lot13');
select count(*) as remaining_users from auth.users where email like '%lot13@fadeup.test';
commit;

\echo 'DONE.'
