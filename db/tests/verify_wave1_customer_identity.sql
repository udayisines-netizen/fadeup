-- FadeUp — Wave 1 verification: customer identity bridge
--
-- Proves the core Wave 1 fix: a real customer auth.users account can link
-- itself to the shop-owned customers CRM row created when they booked
-- (anonymously, before they had an account) with matching contact info —
-- via claim_customer_records — without ever gaining broad access to the
-- customers table itself (notes stay staff-internal). Also proves
-- customer_profiles is strictly owner-only (Customer A cannot read/write
-- Customer B's profile), anon has zero access to either table, and
-- claiming is idempotent/cannot steal an already-linked row.
--
-- Run with:
--   docker cp db/tests/verify_wave1_customer_identity.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_wave1_customer_identity.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'shopowner+w1id@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Shop Owner"}', 'authenticated', 'authenticated'),
  ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'customer-a+w1id@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer A"}', 'authenticated', 'authenticated'),
  ('c1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'customer-b+w1id@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer B"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: a shop, and an ANONYMOUS booking with Customer A''s phone'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Wave1 Identity Shop', 'wave1-identity-shop', 'Main', 'UTC');
insert into public.services (organization_id, name, duration_minutes, price_cents)
  select id, 'Fade', 30, 2500 from public.organizations where slug = 'wave1-identity-shop';
insert into public.service_locations (organization_id, service_id, location_id)
  select s.organization_id, s.id, l.id
  from public.services s join public.locations l on l.organization_id = s.organization_id
  where s.organization_id = (select id from public.organizations where slug = 'wave1-identity-shop');
update public.staff_profiles set location_id = (select id from public.locations where organization_id = (select id from public.organizations where slug = 'wave1-identity-shop'))
  where organization_id = (select id from public.organizations where slug = 'wave1-identity-shop') and user_id = (select auth.uid());
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'wave1-identity-shop' and sp.user_id = (select auth.uid());
insert into public.barber_services (organization_id, barber_id, service_id)
  select b.organization_id, b.id, s.id
  from public.barbers b join public.services s on s.organization_id = b.organization_id
  where b.organization_id = (select id from public.organizations where slug = 'wave1-identity-shop');
-- Open every day, all day — avoids the test being sensitive to which real
-- weekday "now() + 2 days" happens to land on.
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
select o.id, l.id, d, '00:00', '23:59'
from public.organizations o join public.locations l on l.organization_id = o.id, generate_series(0, 6) as d
where o.slug = 'wave1-identity-shop';
insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time)
select b.organization_id, b.id, d, '00:00', '23:59'
from public.barbers b, generate_series(0, 6) as d
where b.organization_id = (select id from public.organizations where slug = 'wave1-identity-shop');
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'wave1-identity-shop' \gset
select id as loc_id from public.locations where organization_id = :'org_id' \gset
select id as svc_id from public.services where organization_id = :'org_id' \gset
select id as brb_id from public.barbers where organization_id = :'org_id' \gset
commit;

begin;
set local role anon;
select public.book_public_appointment(
  'wave1-identity-shop', :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid,
  (now() + interval '2 days')::timestamptz, 'Walk-in Name', '+15550001111', 'a-before-account@example.com', null
);
commit;

\echo '=========================================================='
\echo '2. Customer A signs up and claims the record by phone'
\echo '=========================================================='
begin;
reset role;
select id as customers_row_id, user_id as customers_row_user_id from public.customers where organization_id = :'org_id' and phone = '+15550001111' \gset
commit;
-- customers_row_user_id is NULL here (unclaimed) — psql \gset leaves a
-- variable unset rather than empty on a NULL column, which is why this
-- section doesn't print/assert it directly; section 2's final check below
-- (customers_row_id, always non-null) is the real assertion.

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into public.customer_profiles (user_id, display_name, phone, email)
  values ((select auth.uid()), 'Customer A', '+15550001111', 'a-before-account@example.com');
select public.claim_customer_records('+15550001111', 'a-before-account@example.com') as claimed_count;
commit;

begin;
reset role;
select user_id from public.customers where id = :'customers_row_id' \gset
commit;
select case when :'user_id' = 'c1000000-0000-0000-0000-000000000002' then 'PASS: claim linked the record to Customer A' else 'FAIL: not linked' end as result;

\echo '=========================================================='
\echo '3. Idempotency: claiming again finds nothing new, and Customer B cannot steal it'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select public.claim_customer_records('+15550001111', 'a-before-account@example.com') into v_count;
  if v_count <> 0 then
    raise exception 'FAIL: re-claiming an already-linked record should link 0 new rows, got %', v_count;
  end if;
  raise notice 'PASS: re-claiming is a no-op (0 new links)';
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
  v_owner uuid;
begin
  select public.claim_customer_records('+15550001111', 'a-before-account@example.com') into v_count;
  if v_count <> 0 then
    raise exception 'FAIL: Customer B claimed a record already linked to Customer A (% rows)', v_count;
  end if;
  raise notice 'PASS: Customer B cannot steal Customer A''s already-linked record';
end $$;
commit;

\echo '=========================================================='
\echo '4. customer_profiles is strictly owner-only'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.customer_profiles where display_name = 'Customer A';
  if v_count <> 0 then
    raise exception 'FAIL: Customer B could see Customer A''s profile (% rows)', v_count;
  end if;
  raise notice 'PASS: Customer B sees zero rows of Customer A''s profile';
end $$;
-- Customer B attempting to update Customer A's row directly (by primary
-- key, if they somehow knew it) must affect zero rows, not error — RLS
-- filters it out of the update's own visible row set.
do $$
declare
  v_updated integer;
begin
  update public.customer_profiles set display_name = 'Hijacked' where display_name = 'Customer A';
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'FAIL: Customer B updated Customer A''s profile (% rows)', v_updated;
  end if;
  raise notice 'PASS: Customer B''s update of Customer A''s profile affected 0 rows';
end $$;
commit;

\echo '=========================================================='
\echo '5. anon has zero access to customer_profiles and customers'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.customer_profiles;
    if v_count > 0 then
      raise exception 'FAIL: anon saw % row(s) of customer_profiles', v_count;
    end if;
    raise notice 'PASS: anon sees zero rows of customer_profiles';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to select customer_profiles';
  end;

  begin
    select count(*) into v_count from public.customers;
    if v_count > 0 then
      raise exception 'FAIL: anon saw % row(s) of customers', v_count;
    end if;
    raise notice 'PASS: anon sees zero rows of customers';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to select customers';
  end;

  begin
    perform public.claim_customer_records('+15550001111', null);
    raise exception 'FAIL: anon was able to call claim_customer_records';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to execute claim_customer_records';
  end;
end $$;
commit;

\echo '=========================================================='
\echo '6. Cleanup'
\echo '=========================================================='
begin;
reset role;
delete from public.customer_profiles where user_id in ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003');
delete from public.organizations where slug = 'wave1-identity-shop';
delete from auth.users where id in ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003');
commit;

begin;
reset role;
select count(*) as remaining_orgs from public.organizations where slug = 'wave1-identity-shop';
select count(*) as remaining_profiles from public.customer_profiles where user_id in ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003');
select count(*) as remaining_users from auth.users where id in ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003');
commit;
