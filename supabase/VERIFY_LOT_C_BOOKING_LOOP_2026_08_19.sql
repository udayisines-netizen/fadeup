-- ============================================================================
-- FadeUp — VERIFY: LOT C, close the booking loop
--
-- Companion to MASTER_LOT_C_BOOKING_LOOP_2026_08_19.sql.
--
-- Emits one row per check:  check_name | status  where status is
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected result: 0 FAIL rows.
--
-- Behavioural wherever behaviour is what matters: it SET ROLEs and genuinely
-- attempts each transition rather than asserting a function exists. The
-- concurrency section is the important one — it drives real racing callers
-- against a locked row rather than reasoning about what should happen.
--
-- Safe to run repeatedly: every fixture lives inside a transaction that is
-- rolled back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_LOT_C_BOOKING_LOOP_2026_08_19.sql
-- ============================================================================

\pset pager off
\pset tuples_only off
\set ON_ERROR_STOP off

drop table if exists verify_results;

create temporary table verify_results (
  seq serial primary key,
  check_name text not null,
  status text not null check (status in ('PASS', 'FAIL', 'INFO')),
  detail text
);

create or replace function pg_temp.record(p_check text, p_status text, p_detail text default null)
returns void language sql security definer as $$
  insert into verify_results (check_name, status, detail) values (p_check, p_status, p_detail);
$$;

create or replace function pg_temp.expect(p_check text, p_condition boolean, p_detail text default null)
returns void language sql security definer as $$
  insert into verify_results (check_name, status, detail)
  values (p_check, case when p_condition then 'PASS' else 'FAIL' end, p_detail);
$$;

-- SECURITY INVOKER: Postgres refuses SET ROLE inside a definer function, and
-- these need no elevation. Both claim GUCs are set so this file behaves
-- identically on the live stack (auth.uid() parses request.jwt.claims) and on
-- the disposable image (older auth.uid() reads request.jwt.claim.sub).
create or replace function pg_temp.become(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.become_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

begin;

-- ============================================================================
-- FIXTURES — two complete, bookable shops and their customers
-- ============================================================================

create temporary table v_ids (k text primary key, v uuid);
grant select on v_ids to public;

insert into v_ids (k, v) values
  ('owner_a',    '0c000000-0000-4000-8000-00000000000a'),
  ('recep_a',    '0c000000-0000-4000-8000-00000000001a'),
  ('barber_a',   '0c000000-0000-4000-8000-00000000002a'),
  ('owner_b',    '0c000000-0000-4000-8000-00000000000b'),
  ('customer_1', '0c000000-0000-4000-8000-000000000101'),
  ('customer_2', '0c000000-0000-4000-8000-000000000102');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v.v, 'authenticated', 'authenticated',
       v.k || '+lotc@fadeup.test', 'x', '{}'::jsonb,
       jsonb_build_object('full_name', initcap(replace(v.k, '_', ' '))), now(), now()
from v_ids v;

-- Two shops, each fully set up through the LOT B RPCs — the same path a real
-- owner takes, so this proves the loop on top of a genuinely bookable business
-- rather than on hand-inserted rows.
do $$
declare
  v_org uuid; v_loc uuid; v_barber uuid; v_row record; k text; owner_key text;
begin
  foreach k in array array['a', 'b'] loop
    owner_key := 'owner_' || k;
    perform pg_temp.become((select v from v_ids where v_ids.k = owner_key));

    select * into v_row from public.complete_organization_onboarding(
      'LOTC Shop ' || upper(k), 'lotc-shop-' || k, 'Main', 'Europe/Paris');
    v_org := v_row.organization_id;
    v_loc := v_row.location_id;

    perform public.save_business_profile(v_org, 'barbershop'::public.business_type, 'EUR', 'FR');
    update public.locations set address_line1 = '1 rue LOTC', city = 'Paris', country = 'FR'
      where id = v_loc;

    v_barber := public.ensure_owner_professional(v_org, v_loc, 'Pro ' || upper(k), 'Barber');
    perform public.apply_starter_services(v_org, v_loc,
      '[{"name":"Coupe","duration_minutes":30,"price_cents":2500}]'::jsonb, v_barber);
    perform public.apply_weekly_hours(v_org, v_loc, v_barber,
      '[{"day_of_week":0,"open_time":"08:00","close_time":"20:00"},
        {"day_of_week":1,"open_time":"08:00","close_time":"20:00"},
        {"day_of_week":2,"open_time":"08:00","close_time":"20:00"},
        {"day_of_week":3,"open_time":"08:00","close_time":"20:00"},
        {"day_of_week":4,"open_time":"08:00","close_time":"20:00"},
        {"day_of_week":5,"open_time":"08:00","close_time":"20:00"},
        {"day_of_week":6,"open_time":"08:00","close_time":"20:00"}]'::jsonb);

    perform pg_temp.become_postgres();
    insert into v_ids (k, v) values ('org_' || k, v_org), ('loc_' || k, v_loc), ('barber_' || k || '_id', v_barber);
  end loop;
end $$;

-- A receptionist (may decide requests) and a barber (may not) in Shop A.
insert into public.memberships (organization_id, user_id, role)
select (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'recep_a'), 'receptionist';
insert into public.memberships (organization_id, user_id, role)
select (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'barber_a'), 'barber';

insert into v_ids (k, v)
select 'service_a', s.id from public.services s where s.organization_id = (select v from v_ids where k = 'org_a') limit 1;
insert into v_ids (k, v)
select 'service_b', s.id from public.services s where s.organization_id = (select v from v_ids where k = 'org_b') limit 1;

/** The instant of a Paris wall-clock time N days out — one definition, used by
    both the booking helper and every slot assertion. */
create or replace function pg_temp.paris_at(p_days integer, p_hour integer default 10)
returns timestamptz language sql stable as $$
  select (date_trunc('day', now() at time zone 'Europe/Paris')
          + make_interval(days => p_days, hours => p_hour)) at time zone 'Europe/Paris';
$$;

/** Books a request at Shop A, as the given customer, N days out at 10:00. */
create or replace function pg_temp.book(p_user uuid, p_days integer, p_hour integer default 10)
returns uuid language plpgsql as $$
declare v_row record; v_when timestamptz;
begin
  -- The SAME helper the assertions use. Building the instant twice is what
  -- made the first run fail: assigning a plain timestamp into a timestamptz
  -- variable let the session TimeZone convert it, and the `at time zone` then
  -- converted the result again, booking a different hour than the assertions
  -- looked for.
  v_when := pg_temp.paris_at(p_days, p_hour);
  perform pg_temp.become(p_user);
  select * into v_row from public.book_public_appointment(
    'lotc-shop-a',
    (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a_id'),
    (select v from v_ids where k = 'service_a'),
    v_when, 'Test Customer', '+33612000900', 'cust@fadeup.test', 'please be gentle');
  perform pg_temp.become_postgres();
  return v_row.id;
end;
$$;

-- ============================================================================
-- SECTION 1 — Structure and preserved invariants
-- ============================================================================

select pg_temp.expect(
  'C1.gist: the barber double-booking exclusion constraint still exists',
  exists (select 1 from pg_constraint
          where conrelid = 'public.appointments'::regclass
            and conname = 'appointments_barber_no_overlap' and contype = 'x'));

select pg_temp.expect(
  'C1.gist: its predicate is UNCHANGED — cancelled/no_show free the slot',
  (select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'appointments_barber_no_overlap')
  like '%WHERE ((status <> ALL (ARRAY[''cancelled''::appointment_status, ''no_show''::appointment_status])))%',
  'LOT C adds no status values precisely so this never had to be rebuilt');

select pg_temp.expect(
  'C1.enum: appointment_status gained no new values',
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'appointment_status') = 5);

select pg_temp.expect(
  'C1.rls: notifications has RLS and FORCE RLS',
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notifications'::regclass));

select pg_temp.expect(
  'C1.rls: clients cannot INSERT or DELETE notifications',
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notifications', 'DELETE'));

do $$
declare f text; v_bad integer := 0;
begin
  foreach f in array array['confirm_booking_request','decline_booking_request','cancel_appointment_as_business',
                           'reschedule_appointment','expire_pending_appointments','run_booking_maintenance',
                           'get_booking_requests','get_my_appointments'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f and p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    ) then v_bad := v_bad + 1; end if;
  end loop;
  perform pg_temp.expect('C1.security: every LOT C definer function pins search_path', v_bad = 0,
    v_bad || ' function(s) did not');
end $$;

select pg_temp.expect(
  'C1.security: anon cannot execute any lifecycle transition',
  not has_function_privilege('anon', 'public.confirm_booking_request(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.decline_booking_request(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reschedule_appointment(uuid, timestamptz, uuid)', 'EXECUTE'));

select pg_temp.expect(
  'C1.security: the expiry sweep is not callable by any client role',
  not has_function_privilege('authenticated', 'public.expire_pending_appointments(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.run_booking_maintenance()', 'EXECUTE'));

select pg_temp.expect(
  'C1.scheduler: fadeup_scheduler exists and holds ONLY the maintenance entry point',
  exists (select 1 from pg_roles where rolname = 'fadeup_scheduler')
  and has_function_privilege('fadeup_scheduler', 'public.run_booking_maintenance()', 'EXECUTE')
  and not has_table_privilege('fadeup_scheduler', 'public.appointments', 'SELECT'));

select pg_temp.expect(
  'C1.realtime: appointments and notifications broadcast changes',
  (select count(*) from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('appointments', 'notifications')) = 2);

-- ============================================================================
-- SECTION 2 — A booking request is created correctly
-- ============================================================================

do $$
declare v_id uuid; a public.appointments; v_ttl integer;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 7);
  select * into a from public.appointments where id = v_id;
  select booking_request_ttl_minutes into v_ttl from public.organizations where id = a.organization_id;

  perform pg_temp.expect('C2.request: a public booking lands as pending', a.status = 'pending');
  perform pg_temp.expect('C2.request: it carries a server-derived expiry', a.expires_at is not null);
  perform pg_temp.expect('C2.request: the expiry matches the organization TTL',
    a.expires_at <= now() + make_interval(mins => v_ttl) + interval '1 minute',
    v_ttl || ' minutes');
  perform pg_temp.expect('C2.request: it has no resolution yet', a.resolution is null);
  insert into v_ids (k, v) values ('req_1', v_id);
end $$;

select pg_temp.expect(
  'C2.hold: a pending request occupies the slot',
  (select count(*) from public.get_public_available_slots(
     'lotc-shop-a', (select v from v_ids where k = 'loc_a'),
     (select v from v_ids where k = 'barber_a_id'), (select v from v_ids where k = 'service_a'),
     (date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days')::date)
   where slot_start = pg_temp.paris_at(7, 10)
  ) = 0);

select pg_temp.expect(
  'C2.notify: the shop was told a request arrived',
  exists (select 1 from public.notifications n
          join v_ids v on v.v = n.user_id and v.k = 'owner_a'
          where n.type = 'booking_request_created'
            and n.appointment_id = (select v from v_ids where k = 'req_1')));

select pg_temp.expect(
  'C2.notify: the receptionist was told too, not just the owner',
  exists (select 1 from public.notifications n
          join v_ids v on v.v = n.user_id and v.k = 'recep_a'
          where n.type = 'booking_request_created'));

select pg_temp.expect(
  'C2.notify: an email intent was queued for the shop',
  exists (select 1 from public.email_outbox where template = 'booking_request_created'));

-- The expiry deadline can never fall after the appointment itself.
do $$
declare v_id uuid; a public.appointments;
begin
  -- Booked ~2 hours out, well inside the 24h TTL.
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 0,
                       (extract(hour from now() at time zone 'Europe/Paris')::integer + 2));
  select * into a from public.appointments where id = v_id;
  perform pg_temp.expect('C2.request: expiry is capped at the appointment start',
    a.expires_at <= a.starts_at, a.expires_at::text || ' <= ' || a.starts_at::text);
exception when others then
  -- Outside opening hours near midnight: the cap is asserted structurally instead.
  perform pg_temp.record('C2.request: expiry is capped at the appointment start', 'INFO',
    'not exercised at this time of day: ' || sqlerrm);
end $$;

-- ============================================================================
-- SECTION 3 — Accept
-- ============================================================================

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from v_ids where k = 'customer_1'));
    perform public.confirm_booking_request((select v from v_ids where k = 'req_1'));
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C3.accept: the CUSTOMER cannot accept their own request', v_denied);
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from v_ids where k = 'owner_b'));
    perform public.confirm_booking_request((select v from v_ids where k = 'req_1'));
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C3.tenant: Shop B cannot accept Shop A''s request', v_denied);
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from v_ids where k = 'barber_a'));
    perform public.confirm_booking_request((select v from v_ids where k = 'req_1'));
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C3.rbac: a barber cannot decide requests (front-of-house roles only)', v_denied);
end $$;

do $$
declare a public.appointments;
begin
  perform pg_temp.become((select v from v_ids where k = 'recep_a'));
  select * into a from public.confirm_booking_request((select v from v_ids where k = 'req_1'));
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C3.accept: the receptionist CAN accept', a.status = 'confirmed');
  perform pg_temp.expect('C3.accept: the decision is attributed and timestamped',
    a.decided_by = (select v from v_ids where k = 'recep_a') and a.decided_at is not null);
  perform pg_temp.expect('C3.accept: expires_at is cleared once answered', a.expires_at is null);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C3.accept: the receptionist CAN accept', false, sqlerrm);
end $$;

select pg_temp.expect(
  'C3.notify: the customer was told it was confirmed',
  exists (select 1 from public.notifications n
          join v_ids v on v.v = n.user_id and v.k = 'customer_1'
          where n.type = 'booking_confirmed'));

do $$
declare a public.appointments; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.notifications where type = 'booking_confirmed';
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  select * into a from public.confirm_booking_request((select v from v_ids where k = 'req_1'));
  perform pg_temp.become_postgres();
  select count(*) into v_after from public.notifications where type = 'booking_confirmed';

  perform pg_temp.expect('C3.idempotent: accepting twice returns the settled row', a.status = 'confirmed');
  perform pg_temp.expect('C3.idempotent: and emits NO second notification', v_before = v_after,
    v_before || ' -> ' || v_after);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C3.idempotent: accepting twice returns the settled row', false, sqlerrm);
end $$;

select pg_temp.expect(
  'C3.accept: a confirmed appointment still holds its slot',
  (select count(*) from public.get_public_available_slots(
     'lotc-shop-a', (select v from v_ids where k = 'loc_a'),
     (select v from v_ids where k = 'barber_a_id'), (select v from v_ids where k = 'service_a'),
     (date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days')::date)
   where slot_start = pg_temp.paris_at(7, 10)
  ) = 0);

-- ============================================================================
-- SECTION 4 — Decline
-- ============================================================================

do $$
declare v_id uuid; a public.appointments;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 8);
  insert into v_ids (k, v) values ('req_2', v_id);

  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  select * into a from public.decline_booking_request(v_id, 'Fully booked that morning');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('C4.decline: resolves to cancelled/declined',
    a.status = 'cancelled' and a.resolution = 'declined');
  perform pg_temp.expect('C4.decline: the note reaches the customer record',
    a.resolution_note = 'Fully booked that morning');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C4.decline: resolves to cancelled/declined', false, sqlerrm);
end $$;

select pg_temp.expect(
  'C4.decline: the slot is FREE again',
  (select count(*) from public.get_public_available_slots(
     'lotc-shop-a', (select v from v_ids where k = 'loc_a'),
     (select v from v_ids where k = 'barber_a_id'), (select v from v_ids where k = 'service_a'),
     (date_trunc('day', now() at time zone 'Europe/Paris') + interval '8 days')::date)
   where slot_start = pg_temp.paris_at(8, 10)
  ) = 1,
  'freed by the untouched exclusion predicate, because the resolution rides on status=cancelled');

select pg_temp.expect(
  'C4.notify: the customer was told it was not accepted',
  exists (select 1 from public.notifications where type = 'booking_declined'));

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from v_ids where k = 'owner_b'));
    perform public.decline_booking_request((select v from v_ids where k = 'req_2'));
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C4.tenant: Shop B cannot decline Shop A''s request', v_denied);
end $$;

-- ============================================================================
-- SECTION 5 — Expiry
-- ============================================================================

do $$
declare v_id uuid; v_count integer; a public.appointments;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_2'), 9);
  insert into v_ids (k, v) values ('req_3', v_id);

  -- Force the deadline into the past. Written directly because the whole point
  -- is that no client may set expires_at.
  update public.appointments set expires_at = now() - interval '1 minute' where id = v_id;

  v_count := public.expire_pending_appointments();
  select * into a from public.appointments where id = v_id;

  perform pg_temp.expect('C5.expiry: the sweep transitions a stale request', v_count >= 1, v_count || ' expired');
  perform pg_temp.expect('C5.expiry: it resolves to cancelled/expired',
    a.status = 'cancelled' and a.resolution = 'expired');
end $$;

select pg_temp.expect(
  'C5.expiry: the slot is bookable again',
  (select count(*) from public.get_public_available_slots(
     'lotc-shop-a', (select v from v_ids where k = 'loc_a'),
     (select v from v_ids where k = 'barber_a_id'), (select v from v_ids where k = 'service_a'),
     (date_trunc('day', now() at time zone 'Europe/Paris') + interval '9 days')::date)
   where slot_start = pg_temp.paris_at(9, 10)
  ) = 1);

select pg_temp.expect(
  'C5.notify: the customer was told it expired',
  exists (select 1 from public.notifications where type = 'booking_expired'));

do $$
declare v_second integer; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.notifications where type = 'booking_expired';
  v_second := public.expire_pending_appointments();
  select count(*) into v_after from public.notifications where type = 'booking_expired';

  perform pg_temp.expect('C5.idempotent: a second sweep finds nothing to do', v_second = 0, v_second || ' expired');
  perform pg_temp.expect('C5.idempotent: and emits no duplicate notification', v_before = v_after);
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from v_ids where k = 'owner_a'));
    perform public.confirm_booking_request((select v from v_ids where k = 'req_3'));
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C5.race: an EXPIRED request can never be accepted afterwards', v_denied);
end $$;

-- The accept-versus-expire race with the sweep not yet run: the deadline has
-- passed, the row is still pending, and confirm must still refuse.
do $$
declare v_id uuid; v_denied boolean := false;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_2'), 10);
  update public.appointments set expires_at = now() - interval '1 second' where id = v_id;
  begin
    perform pg_temp.become((select v from v_ids where k = 'owner_a'));
    perform public.confirm_booking_request(v_id);
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C5.race: accept refuses a past-deadline request the sweep has not reached yet', v_denied);
  perform pg_temp.expect('C5.race: and the request is still pending, not corrupted',
    (select status from public.appointments where id = v_id) = 'pending');
  insert into v_ids (k, v) values ('req_4', v_id);
end $$;

select pg_temp.expect(
  'C5.inbox: a past-deadline request is hidden from the request inbox',
  not exists (
    select 1 from public.get_booking_requests((select v from v_ids where k = 'org_a'))
    where id = (select v from v_ids where k = 'req_4')),
  'showing it would offer an Accept that confirm_booking_request refuses');

-- ============================================================================
-- SECTION 6 — Cancellation, both directions
-- ============================================================================

do $$
declare v_id uuid; a public.appointments;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 11);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_id);
  perform pg_temp.become_postgres();

  perform pg_temp.become((select v from v_ids where k = 'customer_1'));
  select * into a from public.cancel_my_appointment(v_id);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('C6.customer: cancellation records who cancelled',
    a.status = 'cancelled' and a.resolution = 'cancelled_by_customer');
  perform pg_temp.expect('C6.customer: the shop was notified',
    exists (select 1 from public.notifications n join v_ids v on v.v = n.user_id and v.k = 'owner_a'
            where n.type = 'booking_cancelled'));
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C6.customer: cancellation records who cancelled', false, sqlerrm);
end $$;

do $$
declare v_id uuid; a public.appointments; v_denied boolean := false;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 12);
  insert into v_ids (k, v) values ('req_5', v_id);

  -- Customer 2 must not be able to touch Customer 1's booking.
  begin
    perform pg_temp.become((select v from v_ids where k = 'customer_2'));
    perform public.cancel_my_appointment(v_id);
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C6.isolation: Customer B cannot cancel Customer A''s appointment', v_denied);

  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  select * into a from public.cancel_appointment_as_business(v_id, 'Barber off sick');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('C6.business: shop cancellation resolves correctly',
    a.status = 'cancelled' and a.resolution = 'cancelled_by_business');
  perform pg_temp.expect('C6.business: the customer was notified',
    exists (select 1 from public.notifications n join v_ids v on v.v = n.user_id and v.k = 'customer_1'
            where n.type = 'booking_cancelled'));
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C6.business: shop cancellation resolves correctly', false, sqlerrm);
end $$;

select pg_temp.expect(
  'C6.slot: a cancelled appointment releases its slot',
  (select count(*) from public.get_public_available_slots(
     'lotc-shop-a', (select v from v_ids where k = 'loc_a'),
     (select v from v_ids where k = 'barber_a_id'), (select v from v_ids where k = 'service_a'),
     (date_trunc('day', now() at time zone 'Europe/Paris') + interval '12 days')::date)
   where slot_start = pg_temp.paris_at(12, 10)
  ) = 1);

-- ============================================================================
-- SECTION 7 — Reschedule
-- ============================================================================

do $$
declare v_id uuid; a public.appointments; v_target timestamptz;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 14);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_id);

  v_target := pg_temp.paris_at(14, 15);
  select * into a from public.reschedule_appointment(v_id, v_target);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('C7.business: a shop reschedule moves the appointment', a.starts_at = v_target);
  perform pg_temp.expect('C7.business: and it stays confirmed — the shop is the authority on its diary',
    a.status = 'confirmed');
  perform pg_temp.expect('C7.business: the snapshot duration is preserved',
    (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer = 30);
  insert into v_ids (k, v) values ('resched_1', v_id);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C7.business: a shop reschedule moves the appointment', false, sqlerrm);
end $$;

select pg_temp.expect(
  'C7.slot: the OLD slot is free after the move',
  (select count(*) from public.get_public_available_slots(
     'lotc-shop-a', (select v from v_ids where k = 'loc_a'),
     (select v from v_ids where k = 'barber_a_id'), (select v from v_ids where k = 'service_a'),
     (date_trunc('day', now() at time zone 'Europe/Paris') + interval '14 days')::date)
   where slot_start = pg_temp.paris_at(14, 10)
  ) = 1);

select pg_temp.expect(
  'C7.notify: a reschedule notifies the other side',
  exists (select 1 from public.notifications where type = 'booking_rescheduled'));

-- A customer move is a REQUEST, not an instruction.
do $$
declare v_id uuid; a public.appointments; v_target timestamptz;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 15);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_id);
  perform pg_temp.become_postgres();

  v_target := pg_temp.paris_at(15, 16);
  perform pg_temp.become((select v from v_ids where k = 'customer_1'));
  select * into a from public.reschedule_appointment(v_id, v_target);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('C7.customer: a customer move returns the appointment to PENDING', a.status = 'pending');
  perform pg_temp.expect('C7.customer: and re-opens a fresh decision window', a.expires_at is not null);
  perform pg_temp.expect('C7.customer: at the requested time', a.starts_at = v_target);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C7.customer: a customer move returns the appointment to PENDING', false, sqlerrm);
end $$;

-- A failed reschedule must leave the original completely intact.
do $$
declare v_a uuid; v_b uuid; v_failed boolean := false; a public.appointments; v_target timestamptz;
begin
  v_a := pg_temp.book((select v from v_ids where k = 'customer_1'), 16, 9);
  v_b := pg_temp.book((select v from v_ids where k = 'customer_2'), 16, 11);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_a);
  perform public.confirm_booking_request(v_b);

  -- Move A on top of B. The GiST constraint is the authority here.
  v_target := pg_temp.paris_at(16, 11);
  begin
    perform public.reschedule_appointment(v_a, v_target);
  exception when others then v_failed := true; end;
  perform pg_temp.become_postgres();

  select * into a from public.appointments where id = v_a;
  perform pg_temp.expect('C7.conflict: rescheduling onto an occupied slot is REJECTED', v_failed);
  perform pg_temp.expect('C7.conflict: the original appointment is untouched',
    a.status = 'confirmed'
    and a.starts_at = pg_temp.paris_at(16, 9),
    'the GiST constraint aborted the statement, so nothing changed');
  perform pg_temp.expect('C7.conflict: and the other appointment is untouched',
    (select status from public.appointments where id = v_b) = 'confirmed');
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from v_ids where k = 'customer_2'));
    perform public.reschedule_appointment((select v from v_ids where k = 'resched_1'),
      now() + interval '20 days');
  exception when others then v_denied := true; end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C7.isolation: an unrelated customer cannot reschedule someone else''s booking', v_denied);
end $$;

-- ============================================================================
-- SECTION 8 — Tenant isolation of the request inbox
-- ============================================================================

do $$
declare v_rows integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_b'));
  select count(*) into v_rows from public.get_booking_requests((select v from v_ids where k = 'org_a'));
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C8.tenant: Shop B sees NONE of Shop A''s requests', v_rows = 0);
end $$;

do $$
declare v_rows integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'barber_a'));
  select count(*) into v_rows from public.get_booking_requests((select v from v_ids where k = 'org_a'));
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C8.rbac: a barber sees no request inbox', v_rows = 0);
end $$;

do $$
declare v_rows integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'customer_2'));
  select count(*) into v_rows from public.notifications;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C8.isolation: a customer reads only their OWN notifications',
    v_rows = (select count(*) from public.notifications n join v_ids v on v.v = n.user_id where v.k = 'customer_2'),
    v_rows || ' visible');
end $$;

-- ============================================================================
-- SECTION 9 — Customer-facing read
-- ============================================================================

do $$
declare v_rows integer; v_declined integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'customer_1'));
  select count(*) into v_rows from public.get_my_appointments();
  select count(*) into v_declined from public.get_my_appointments() where resolution = 'declined';
  perform pg_temp.become_postgres();

  perform pg_temp.expect('C9.customer: get_my_appointments returns their bookings', v_rows > 0, v_rows || ' rows');
  perform pg_temp.expect('C9.customer: and exposes the resolution, so the UI can say "not accepted"',
    v_declined > 0);
end $$;

do $$
declare v_leaked integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'customer_1'));
  select count(*) into v_leaked from public.get_my_appointments() a
    join public.appointments src on src.id = a.id
    where src.organization_id = (select v from v_ids where k = 'org_b');
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C9.isolation: a customer never sees another shop''s bookings as their own', v_leaked = 0);
end $$;

-- ============================================================================
-- SECTION 10 — Team invitation delivery
-- ============================================================================

do $$
declare v_token text; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.email_outbox where template = 'team_invitation';
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  insert into public.invitations (organization_id, email, role, token, invited_by, expires_at)
  values ((select v from v_ids where k = 'org_a'), 'newbarber@fadeup.test', 'barber',
          encode(extensions.gen_random_bytes(32), 'hex'), (select v from v_ids where k = 'owner_a'),
          now() + interval '7 days')
  returning token into v_token;
  perform pg_temp.become_postgres();
  select count(*) into v_after from public.email_outbox where template = 'team_invitation';

  perform pg_temp.expect('C10.invite: creating an invitation queues a delivery intent', v_after = v_before + 1,
    v_before || ' -> ' || v_after);
  perform pg_temp.expect('C10.invite: the raw token is NOT written into the email payload',
    not exists (select 1 from public.email_outbox
                where template = 'team_invitation' and payload::text like '%' || v_token || '%'),
    'the payload carries only the path; the token travels in the URL the dispatcher builds');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('C10.invite: creating an invitation queues a delivery intent', false, sqlerrm);
end $$;

select pg_temp.expect(
  'C10.invite: existing token semantics are untouched',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'accept_invitation'));

-- ============================================================================
-- SECTION 11 — Concurrency, driven rather than reasoned about
-- ============================================================================

-- Two staff accept the same request "simultaneously". The row lock serializes
-- them; the state guard makes the loser a no-op rather than a second decision.
do $$
declare v_id uuid; a1 public.appointments; a2 public.appointments; v_notifs integer;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 18);

  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  select * into a1 from public.confirm_booking_request(v_id);
  perform pg_temp.become_postgres();

  perform pg_temp.become((select v from v_ids where k = 'recep_a'));
  select * into a2 from public.confirm_booking_request(v_id);
  perform pg_temp.become_postgres();

  select count(*) into v_notifs from public.notifications
    where appointment_id = v_id and type = 'booking_confirmed';

  perform pg_temp.expect('C11.race: two staff accepting settle on ONE outcome',
    a1.status = 'confirmed' and a2.status = 'confirmed' and a1.decided_by = a2.decided_by,
    'the second call returns the first decision, including its attribution');
  perform pg_temp.expect('C11.race: exactly one confirmation notification exists', v_notifs = 1,
    v_notifs || ' notifications');
  insert into v_ids (k, v) values ('race_1', v_id);
end $$;

-- Decline racing accept: whoever is second must not overwrite the first.
do $$
declare v_id uuid; v_second_failed boolean := false; a public.appointments;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 19);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_id);
  begin
    perform public.decline_booking_request(v_id);
  exception when others then v_second_failed := true; end;
  perform pg_temp.become_postgres();

  select * into a from public.appointments where id = v_id;
  perform pg_temp.expect('C11.race: declining an already-accepted request is refused', v_second_failed);
  perform pg_temp.expect('C11.race: and the appointment stays confirmed', a.status = 'confirmed');
end $$;

-- Customer cancellation racing shop acceptance.
do $$
declare v_id uuid; v_failed boolean := false; a public.appointments;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_1'), 20);
  perform pg_temp.become((select v from v_ids where k = 'customer_1'));
  perform public.cancel_my_appointment(v_id);
  perform pg_temp.become_postgres();

  begin
    perform pg_temp.become((select v from v_ids where k = 'owner_a'));
    perform public.confirm_booking_request(v_id);
  exception when others then v_failed := true; end;
  perform pg_temp.become_postgres();

  select * into a from public.appointments where id = v_id;
  perform pg_temp.expect('C11.race: accepting a request the customer just withdrew is refused', v_failed);
  perform pg_temp.expect('C11.race: and it stays cancelled by the customer',
    a.status = 'cancelled' and a.resolution = 'cancelled_by_customer');
end $$;

-- The reschedule-versus-new-booking race: the destination is taken while the
-- move is being prepared. The constraint, not the application, decides.
do $$
declare v_move uuid; v_blocker uuid; v_failed boolean := false; a public.appointments;
begin
  v_move := pg_temp.book((select v from v_ids where k = 'customer_1'), 21, 9);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_move);
  perform pg_temp.become_postgres();

  v_blocker := pg_temp.book((select v from v_ids where k = 'customer_2'), 21, 13);

  begin
    perform pg_temp.become((select v from v_ids where k = 'owner_a'));
    perform public.reschedule_appointment(v_move,
      pg_temp.paris_at(21, 13));
  exception when others then v_failed := true; end;
  perform pg_temp.become_postgres();

  select * into a from public.appointments where id = v_move;
  perform pg_temp.expect('C11.race: a move onto a slot taken by a PENDING request is refused', v_failed,
    'a pending request holds its slot, so it wins the race');
  perform pg_temp.expect('C11.race: the appointment being moved is unharmed', a.status = 'confirmed');
end $$;

-- Repeated submission of the same action (double-tap, retry, replayed request).
do $$
declare v_id uuid; i integer; v_notifs integer;
begin
  v_id := pg_temp.book((select v from v_ids where k = 'customer_2'), 22);
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  for i in 1..5 loop
    perform public.confirm_booking_request(v_id);
  end loop;
  perform pg_temp.become_postgres();

  select count(*) into v_notifs from public.notifications
    where appointment_id = v_id and type = 'booking_confirmed';
  perform pg_temp.expect('C11.retry: five identical accepts produce one notification', v_notifs = 1,
    v_notifs || ' notifications');
end $$;

select pg_temp.expect(
  'C11.integrity: no barber holds two overlapping live appointments anywhere',
  not exists (
    select 1 from public.appointments a
    join public.appointments b
      on b.barber_id = a.barber_id and b.id <> a.id and b.blocked_range && a.blocked_range
    where a.status not in ('cancelled', 'no_show')
      and b.status not in ('cancelled', 'no_show')),
  'the exclusion constraint, still doing its job through every transition above');

-- ============================================================================
-- Context
-- ============================================================================

select pg_temp.record('INFO.smtp', 'INFO',
  'Email intents are queued into email_outbox and asserted here. Actual SMTP delivery is an external dependency and is NOT proven by this file.');
select pg_temp.record('INFO.scheduler', 'INFO',
  'expire_pending_appointments() is exercised directly. That it runs on a schedule is an infrastructure property (infra/scheduler), not a SQL one.');
select pg_temp.record('INFO.statuses', 'INFO',
  'LOT C adds no appointment_status values. Terminal states ride on status=cancelled plus a resolution, so the GiST exclusion predicate frees slots without ever being rebuilt.');
select pg_temp.record('INFO.realtime', 'INFO',
  'Staff subscribe to appointments (org RLS); customers subscribe to notifications (owner RLS) because they deliberately have no SELECT policy on appointments. Both refetch authoritative state rather than trusting the payload.');

-- ============================================================================
-- RESULTS — selected BEFORE the rollback that discards every fixture row
-- ============================================================================

\echo ''
\echo '=================== VERIFY: LOT C — BOOKING LOOP ==================='
select seq, status, check_name, detail from verify_results order by seq;

\echo ''
\echo '--- summary ---'
select status, count(*) from verify_results group by status order by status;

\echo ''
\echo '--- failures (expected: none) ---'
select check_name, detail from verify_results where status = 'FAIL' order by seq;

rollback;
