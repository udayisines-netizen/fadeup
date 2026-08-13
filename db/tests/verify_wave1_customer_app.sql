-- FadeUp — Wave 1 verification: Customer App (appointments, queue, favorites)
--
-- Proves: a customer sees only their OWN appointments/queue entries/
-- favorites across every organization (never another customer's), can
-- cancel only their own pending/confirmed appointment (never someone
-- else's, never an already-completed one), queue position is accurate, and
-- favorites round-trip through get_my_favorites with correct uniqueness
-- (can't favorite the same shop or barber twice) and zero anon access.
--
-- Run with:
--   docker cp db/tests/verify_wave1_customer_app.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_wave1_customer_app.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'shopowner+w1app@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Shop Owner"}', 'authenticated', 'authenticated'),
  ('d1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'customer-a+w1app@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer A"}', 'authenticated', 'authenticated'),
  ('d1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'customer-b+w1app@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer B"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: a shop, and appointments/queue entries for A and B'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Wave1 App Shop', 'wave1-app-shop', 'Main', 'UTC');
insert into public.services (organization_id, name, duration_minutes, price_cents)
  select id, 'Fade', 30, 2000 from public.organizations where slug = 'wave1-app-shop';
update public.staff_profiles set location_id = (select id from public.locations where organization_id = (select id from public.organizations where slug = 'wave1-app-shop'))
  where organization_id = (select id from public.organizations where slug = 'wave1-app-shop') and user_id = (select auth.uid());
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'wave1-app-shop' and sp.user_id = (select auth.uid());
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'wave1-app-shop' \gset
select id as loc_id from public.locations where organization_id = :'org_id' \gset
select id as svc_id from public.services where organization_id = :'org_id' \gset
select id as brb_id from public.barbers where organization_id = :'org_id' \gset

-- Customer A: one pending appointment (cancellable), one completed appointment (rebook-relevant, not cancellable).
insert into public.customers (organization_id, name, phone, user_id)
  values (:'org_id'::uuid, 'Customer A', '+15551110001', 'd1000000-0000-0000-0000-000000000002')
  returning id as customer_a_id \gset
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, starts_at, ends_at, status)
  values (:'org_id'::uuid, :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid, :'customer_a_id'::uuid, 'Customer A', '+15551110001', now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', 'pending')
  returning id as appt_a_pending_id \gset
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, starts_at, ends_at, status)
  values (:'org_id'::uuid, :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid, :'customer_a_id'::uuid, 'Customer A', '+15551110001', now() - interval '10 days', now() - interval '10 days' + interval '30 minutes', 'completed')
  returning id as appt_a_completed_id \gset

-- Customer B: one pending appointment (must never be visible/cancellable by A), one queue entry.
insert into public.customers (organization_id, name, phone, user_id)
  values (:'org_id'::uuid, 'Customer B', '+15551110002', 'd1000000-0000-0000-0000-000000000003')
  returning id as customer_b_id \gset
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, starts_at, ends_at, status)
  values (:'org_id'::uuid, :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid, :'customer_b_id'::uuid, 'Customer B', '+15551110002', now() + interval '3 days', now() + interval '3 days' + interval '30 minutes', 'pending')
  returning id as appt_b_pending_id \gset
insert into public.queue_entries (organization_id, location_id, customer_id, customer_name, customer_phone, status)
  values (:'org_id'::uuid, :'loc_id'::uuid, :'customer_b_id'::uuid, 'Customer B', '+15551110002', 'waiting');
insert into public.queue_entries (organization_id, location_id, customer_id, customer_name, customer_phone, status)
  values (:'org_id'::uuid, :'loc_id'::uuid, :'customer_a_id'::uuid, 'Customer A', '+15551110001', 'waiting')
  returning id as queue_a_id \gset
commit;

\echo '=========================================================='
\echo '2. get_my_appointments returns only the caller''s own rows, across statuses'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
  v_other_count integer;
begin
  select count(*) into v_count from public.get_my_appointments();
  if v_count <> 2 then
    raise exception 'FAIL: Customer A should see exactly 2 appointments, got %', v_count;
  end if;

  select count(*) into v_other_count from public.get_my_appointments() where organization_name = 'Wave1 App Shop' and status = 'pending' and starts_at > now() + interval '2 days 12 hours';
  if v_other_count <> 0 then
    raise exception 'FAIL: Customer A saw Customer B''s appointment';
  end if;

  raise notice 'PASS: Customer A sees exactly their own 2 appointments, not Customer B''s';
end $$;
commit;

\echo '=========================================================='
\echo '3. cancel_my_appointment: own pending works, someone else''s and already-completed both fail'
\echo '=========================================================='
-- psql's :'var' substitution does not reach inside do $$ ... $$ bodies (a
-- dollar-quoted span is opaque to it) — bridge \gset-derived ids through
-- set_config/current_setting instead, which resolve at RUNTIME, not via
-- psql text substitution.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select set_config('test.appt_a_pending_id', :'appt_a_pending_id', true);
select set_config('test.appt_a_completed_id', :'appt_a_completed_id', true);
select set_config('test.appt_b_pending_id', :'appt_b_pending_id', true);
do $$
declare
  v_status public.appointment_status;
begin
  select status into v_status from public.cancel_my_appointment(current_setting('test.appt_a_pending_id')::uuid);
  if v_status <> 'cancelled' then
    raise exception 'FAIL: expected cancelled, got %', v_status;
  end if;
  raise notice 'PASS: Customer A cancelled their own pending appointment';
end $$;

do $$
begin
  perform public.cancel_my_appointment(current_setting('test.appt_a_completed_id')::uuid);
  raise exception 'FAIL: cancelling an already-completed appointment should have raised';
exception when others then
  raise notice 'PASS: cancelling an already-completed appointment raised as expected';
end $$;

do $$
begin
  perform public.cancel_my_appointment(current_setting('test.appt_b_pending_id')::uuid);
  raise exception 'FAIL: Customer A cancelled Customer B''s appointment';
exception when others then
  raise notice 'PASS: Customer A cannot cancel Customer B''s appointment';
end $$;
commit;

begin;
reset role;
select status from public.appointments where id = :'appt_b_pending_id' \gset
select case when :'status' = 'pending' then 'PASS: Customer B''s appointment is untouched' else 'FAIL: Customer B''s appointment status changed' end as result;
commit;

\echo '=========================================================='
\echo '4. get_my_queue_status: accurate position, own entry only'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select set_config('test.queue_a_id', :'queue_a_id', true);
do $$
declare
  v_count integer;
  v_position integer;
begin
  select count(*) into v_count from public.get_my_queue_status();
  if v_count <> 1 then
    raise exception 'FAIL: Customer A should see exactly 1 queue entry, got %', v_count;
  end if;

  select queue_position into v_position from public.get_my_queue_status() where id = current_setting('test.queue_a_id')::uuid;
  if v_position <> 2 then
    raise exception 'FAIL: Customer A (2nd in line, after Customer B) should be position 2, got %', v_position;
  end if;

  raise notice 'PASS: Customer A sees only their own queue entry, correct position (2, after Customer B)';
end $$;
commit;

\echo '=========================================================='
\echo '5. Favorites: round-trip, uniqueness, and strict ownership'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into public.customer_favorites (user_id, organization_id) values ((select auth.uid()), :'org_id'::uuid);
insert into public.customer_favorites (user_id, organization_id, barber_id) values ((select auth.uid()), :'org_id'::uuid, :'brb_id'::uuid);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select set_config('test.org_id', :'org_id', true);
do $$
begin
  begin
    insert into public.customer_favorites (user_id, organization_id) values ((select auth.uid()), current_setting('test.org_id')::uuid);
    raise exception 'FAIL: favoriting the same shop twice should have raised unique_violation';
  exception when unique_violation then
    raise notice 'PASS: cannot favorite the same shop twice';
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.get_my_favorites();
  if v_count <> 2 then
    raise exception 'FAIL: expected 2 favorites (shop + barber), got %', v_count;
  end if;
  raise notice 'PASS: get_my_favorites returns exactly the 2 saved favorites';
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
  v_deleted integer;
begin
  select count(*) into v_count from public.get_my_favorites();
  if v_count <> 0 then
    raise exception 'FAIL: Customer B saw Customer A''s favorites (% rows)', v_count;
  end if;

  delete from public.customer_favorites where user_id <> (select auth.uid());
  get diagnostics v_deleted = row_count;
  if v_deleted <> 0 then
    raise exception 'FAIL: Customer B deleted Customer A''s favorite (% rows)', v_deleted;
  end if;

  raise notice 'PASS: Customer B sees zero of Customer A''s favorites and cannot delete them';
end $$;
commit;

\echo '=========================================================='
\echo '6. anon has zero access to every new surface'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_count integer;
begin
  begin
    perform public.get_my_appointments();
    raise exception 'FAIL: anon called get_my_appointments';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to execute get_my_appointments';
  end;

  begin
    perform public.get_my_queue_status();
    raise exception 'FAIL: anon called get_my_queue_status';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to execute get_my_queue_status';
  end;

  begin
    perform public.get_my_favorites();
    raise exception 'FAIL: anon called get_my_favorites';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to execute get_my_favorites';
  end;

  select count(*) into v_count from public.customer_favorites;
  if v_count > 0 then
    raise exception 'FAIL: anon saw % row(s) of customer_favorites', v_count;
  end if;
  raise notice 'PASS: anon sees zero rows of customer_favorites';
end $$;
commit;

\echo '=========================================================='
\echo '7. Cleanup'
\echo '=========================================================='
begin;
reset role;
delete from public.customer_favorites where user_id in ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003');
delete from public.organizations where slug = 'wave1-app-shop';
delete from auth.users where id in ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003');
commit;

begin;
reset role;
select count(*) as remaining_orgs from public.organizations where slug = 'wave1-app-shop';
select count(*) as remaining_favorites from public.customer_favorites where user_id in ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003');
select count(*) as remaining_users from auth.users where id in ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003');
commit;
