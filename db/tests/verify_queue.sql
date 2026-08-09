-- FadeUp — LOT 10 verification: live queue.
--
-- Seeds two auth.users fixtures (Jack the owner, Bob a barber-role member)
-- and a location. Proves: a receptionist-capable role (Jack is owner) can
-- add a walk-in to the queue with barber_id null ("any available barber");
-- derived position-by-created_at ordering behaves correctly with no stored
-- position column; status transitions (waiting -> called -> in_service ->
-- completed) work; the tenant-consistency trigger rejects a cross-org
-- location; a barber-role member (Bob) is rejected by RLS on INSERT
-- (read-only in this lot, same rule as appointments) but CAN read the
-- queue; a non-member/anon has zero access; queue_entries is confirmed
-- present in the supabase_realtime publication. Cleans up its own
-- fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block (see
-- verify_services_availability.sql's header for why).
--
-- Run with:
--   docker cp db/tests/verify_queue.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_queue.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('f1f1f1f1-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot10@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('f1f1f1f1-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'bob+lot10@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Bob Barber"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Jack onboards, becomes a barber; Bob is added as a barber-role member'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers LOT10', 'jacks-barbers-lot10', 'Main Shop', 'UTC');
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true
from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
where o.slug = 'jacks-barbers-lot10' and sp.user_id = (select auth.uid());
commit;

begin;
reset role;
insert into public.memberships (organization_id, user_id, role)
select id, 'f1f1f1f1-0000-0000-0000-000000000002', 'barber' from public.organizations where slug = 'jacks-barbers-lot10';
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'jacks-barbers-lot10' \gset
select id as main_location_id from public.locations where organization_id = :'org_id' and name = 'Main Shop' \gset
select id as jack_barber_id from public.barbers where organization_id = :'org_id' \gset
commit;

\echo '=========================================================='
\echo '2. Jack (owner) adds three walk-ins: two "any barber", one requesting Jack specifically'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

insert into public.queue_entries (organization_id, location_id, customer_name) values
  (:'org_id', :'main_location_id', 'Alice Walkin');
insert into public.queue_entries (organization_id, location_id, customer_name) values
  (:'org_id', :'main_location_id', 'Carla Walkin');
insert into public.queue_entries (organization_id, location_id, barber_id, customer_name) values
  (:'org_id', :'main_location_id', :'jack_barber_id', 'Dave Requesting Jack');
commit;

\echo '-- derived position order (by created_at, no stored position column):'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select customer_name, status, barber_id is null as any_barber, row_number() over (order by created_at) as position
from public.queue_entries
where location_id = :'main_location_id' and status = 'waiting'
order by created_at;
commit;

\echo '=========================================================='
\echo '3. Status lifecycle: Alice waiting -> called -> in_service -> completed'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update public.queue_entries set status = 'called', called_at = now()
where location_id = :'main_location_id' and customer_name = 'Alice Walkin';
update public.queue_entries set status = 'in_service', service_started_at = now()
where location_id = :'main_location_id' and customer_name = 'Alice Walkin';
update public.queue_entries set status = 'completed', completed_at = now()
where location_id = :'main_location_id' and customer_name = 'Alice Walkin';
select customer_name, status, called_at is not null as was_called, service_started_at is not null as was_started, completed_at is not null as was_completed
from public.queue_entries where customer_name = 'Alice Walkin';
commit;

\echo '-- Alice no longer appears in the waiting line (now 2 waiting, not 3):'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select count(*) as still_waiting from public.queue_entries where location_id = :'main_location_id' and status = 'waiting';
commit;

\echo '=========================================================='
\echo '4. Tenant-consistency guard: queue_entries cannot reference another org''s location'
\echo '=========================================================='
begin;
reset role;
insert into public.organizations (id, name, slug) values
  ('a3a3a3a3-0000-0000-0000-000000000001', 'Unrelated Org (LOT10 fixture)', 'unrelated-org-lot10');
insert into public.locations (id, organization_id, name, timezone) values
  ('a3a3a3a3-0000-0000-0000-000000000002', 'a3a3a3a3-0000-0000-0000-000000000001', 'Other Shop', 'UTC');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: queue_entries.location_id must belong to the same organization_id'
insert into public.queue_entries (organization_id, location_id, customer_name)
values (:'org_id', 'a3a3a3a3-0000-0000-0000-000000000002', 'Cross Org Walkin');
rollback;

\echo '=========================================================='
\echo '5. Bob (barber-role member) is rejected by RLS on INSERT, but CAN read the queue'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: new row violates row-level security policy for table "queue_entries"'
insert into public.queue_entries (organization_id, location_id, customer_name)
values (:'org_id', :'main_location_id', 'Bob Attempt Walkin');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as queue_visible_to_bob from public.queue_entries where location_id = :'main_location_id';
commit;

\echo '=========================================================='
\echo '6. anon has zero access to queue_entries'
\echo '=========================================================='
begin;
set local role anon;
reset request.jwt.claims;
select count(*) as queue_anon from public.queue_entries;
commit;

\echo '=========================================================='
\echo '7. queue_entries is present in the supabase_realtime publication'
\echo '=========================================================='
begin;
reset role;
select count(*) as in_realtime_publication from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_entries';
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.queue_entries where organization_id = :'org_id';
delete from public.barbers where organization_id = :'org_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id = :'org_id';
delete from public.locations where id = 'a3a3a3a3-0000-0000-0000-000000000002';
delete from public.organizations where id = 'a3a3a3a3-0000-0000-0000-000000000001';
delete from auth.users where email in ('jack+lot10@fadeup.test', 'bob+lot10@fadeup.test');
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot10', 'unrelated-org-lot10');
select count(*) as remaining_users from auth.users where email like '%lot10@fadeup.test';
commit;

\echo 'DONE.'
