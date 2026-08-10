-- FadeUp — LOT 14 verification: membership_plans + customer_memberships.
--
-- Seeds Jack (owner/barber), Kim (non-member), a plan, and a customer.
-- Proves: a manager-role write to membership_plans succeeds, a
-- receptionist-role write to membership_plans is rejected (plan management
-- is owner/manager only, narrower than most booking tables); enrolling a
-- customer (receptionist-level action) succeeds; a SECOND active
-- enrollment for the SAME customer is rejected by the partial unique
-- index (one open membership at a time); cancelling the first and THEN
-- enrolling a new one succeeds (the unique index only blocks concurrent
-- open ones, not sequential history); a cross-org plan_id is rejected by
-- the consistency trigger; an invalid period (end before start) is
-- rejected by the check constraint; RLS matches customers (member read,
-- owner/manager/receptionist enrollment writes, owner/manager plan
-- writes); anon has zero access. Cleans up its own fixtures.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- Run with:
--   docker cp db/tests/verify_customer_memberships.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_customer_memberships.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('cacacaca-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot14@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('cacacaca-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'kim+lot14@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Kim Outsider"}', 'authenticated', 'authenticated'),
  ('cacacaca-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'rita+lot14@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Rita Receptionist"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Jack onboards; Rita joins as receptionist; a customer exists'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jack''s Barbers LOT14', 'jacks-barbers-lot14', 'Main Shop', 'UTC');
insert into public.memberships (organization_id, user_id, role)
  select id, 'cacacaca-0000-0000-0000-000000000003', 'receptionist' from public.organizations where slug = 'jacks-barbers-lot14';
insert into public.customers (organization_id, name, phone)
  select id, 'Alice Member', '555-0400' from public.organizations where slug = 'jacks-barbers-lot14';
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'jacks-barbers-lot14' \gset
select id as alice_customer_id from public.customers where organization_id = :'org_id' \gset
insert into public.organizations (id, name, slug) values ('cbcbcbcb-0000-0000-0000-000000000001', 'Unrelated Org (LOT14 fixture)', 'unrelated-org-lot14');
commit;

\echo '=========================================================='
\echo '2. A manager-role (Jack, owner) write to membership_plans succeeds'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.membership_plans (organization_id, name, description, price_cents, billing_interval)
values (:'org_id', 'Unlimited Fades Monthly', 'Unlimited haircuts, one shop.', 4500, 'monthly')
returning id as plan_id \gset
commit;

\echo '=========================================================='
\echo '3. A receptionist-role write to membership_plans is REJECTED (plan management is owner/manager only)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: new row violates row-level security policy (INSERT has no existing row to filter, unlike SELECT/UPDATE — a failing WITH CHECK always raises, never silently affects 0 rows)'
insert into public.membership_plans (organization_id, name, price_cents)
values (:'org_id', 'Receptionist Plan Attempt', 1000);
rollback;

\echo '=========================================================='
\echo '4. Rita (receptionist) enrolling a customer succeeds — enrollment write is owner/manager/receptionist'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
insert into public.customer_memberships (organization_id, customer_id, plan_id, current_period_end, created_by)
values (:'org_id', :'alice_customer_id', :'plan_id', now() + interval '30 days', 'cacacaca-0000-0000-0000-000000000003')
returning id as first_enrollment_id \gset
commit;

\echo '=========================================================='
\echo '5. A SECOND active enrollment for the SAME customer is REJECTED (one open membership at a time)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: duplicate key value violates unique constraint "customer_memberships_one_open_per_customer"'
insert into public.customer_memberships (organization_id, customer_id, plan_id, current_period_end)
values (:'org_id', :'alice_customer_id', :'plan_id', now() + interval '30 days');
rollback;

\echo '=========================================================='
\echo '6. Cancelling the first, THEN enrolling a new one, succeeds (history, not a concurrent duplicate)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update public.customer_memberships set status = 'cancelled', cancelled_at = now() where id = :'first_enrollment_id';
insert into public.customer_memberships (organization_id, customer_id, plan_id, current_period_end)
values (:'org_id', :'alice_customer_id', :'plan_id', now() + interval '30 days')
returning id as second_enrollment_id \gset
commit;

\echo '-- Alice now has exactly one CANCELLED and one ACTIVE customer_memberships row:'
begin;
reset role;
select status, count(*) from public.customer_memberships where customer_id = :'alice_customer_id' group by status order by status;
commit;

\echo '=========================================================='
\echo '7. A cross-org plan_id is rejected by the consistency trigger'
\echo '=========================================================='
begin;
reset role;
insert into public.membership_plans (id, organization_id, name, price_cents)
values ('cbcbcbcb-0000-0000-0000-000000000002', 'cbcbcbcb-0000-0000-0000-000000000001', 'Other Org Plan', 1000);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: plan_id must belong to the same organization_id as the customer membership'
insert into public.customer_memberships (organization_id, customer_id, plan_id, current_period_end)
values (:'org_id', :'alice_customer_id', 'cbcbcbcb-0000-0000-0000-000000000002', now() + interval '30 days');
rollback;

\echo '=========================================================='
\echo '8. An invalid period (end before start) is rejected by the check constraint'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: violates check constraint "customer_memberships_period_valid"'
insert into public.customer_memberships (organization_id, customer_id, plan_id, current_period_start, current_period_end)
values (:'org_id', :'alice_customer_id', :'plan_id', now(), now() - interval '1 day');
rollback;

\echo '=========================================================='
\echo '9. RLS: Kim (non-member) has zero access; anon has zero access'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'cacacaca-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select
  (select count(*) from public.membership_plans where organization_id = :'org_id') as plans_visible_to_kim,
  (select count(*) from public.customer_memberships where organization_id = :'org_id') as enrollments_visible_to_kim;
commit;

begin;
set local role anon;
reset request.jwt.claims;
select
  (select count(*) from public.membership_plans) as plans_anon,
  (select count(*) from public.customer_memberships) as enrollments_anon;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.customer_memberships where organization_id in (:'org_id', 'cbcbcbcb-0000-0000-0000-000000000001');
delete from public.membership_plans where organization_id in (:'org_id', 'cbcbcbcb-0000-0000-0000-000000000001');
delete from public.customers where organization_id = :'org_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id in (:'org_id', 'cbcbcbcb-0000-0000-0000-000000000001');
delete from auth.users where email like '%lot14@fadeup.test';
select count(*) as remaining_orgs from public.organizations where slug in ('jacks-barbers-lot14', 'unrelated-org-lot14');
select count(*) as remaining_users from auth.users where email like '%lot14@fadeup.test';
commit;

\echo 'DONE.'
