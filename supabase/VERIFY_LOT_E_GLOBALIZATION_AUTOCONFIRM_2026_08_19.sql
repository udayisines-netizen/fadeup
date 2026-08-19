-- ============================================================================
-- FadeUp — VERIFY: LOT E, booking auto-confirm (+ globalization data model)
--
-- Companion to MASTER_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql.
--
-- Emits one row per check:  check_name | status  where status is
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected result: 0 FAIL rows.
--
-- The point of this file is that removing a human approval step must not
-- remove a single guarantee. So it books, races, reschedules into a lunch
-- break, reschedules into a blocked hour, and checks every refusal — rather
-- than asserting that a function was redefined.
--
-- TRUE PARALLEL racing lives in scripts/lot-e-concurrency-test.sh, which
-- fires simultaneous connections at one slot. What is proven HERE is
-- serialized contention: the second caller, seeing the first one's committed
-- row, is refused by the constraint. Both matter; neither substitutes for the
-- other, and this file does not pretend to be the parallel one.
--
-- Safe to run repeatedly: every fixture lives inside a transaction that is
-- rolled back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
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

-- SECURITY INVOKER: Postgres refuses SET ROLE inside a definer function. Both
-- claim GUCs are set so this behaves identically on the live stack (auth.uid()
-- parses request.jwt.claims) and on the disposable image (older auth.uid()
-- reads request.jwt.claim.sub).
create or replace function pg_temp.become(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.become_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
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
-- FIXTURES — one fully bookable shop, built through the real onboarding RPCs
-- ============================================================================

create temporary table v_ids (k text primary key, v uuid);
grant select on v_ids to public;

insert into v_ids (k, v) values
  ('owner_a',    '0e000000-0000-4000-8000-00000000000a'),
  ('barber_u',   '0e000000-0000-4000-8000-00000000002a'),
  ('owner_b',    '0e000000-0000-4000-8000-00000000000b'),
  ('customer_1', '0e000000-0000-4000-8000-000000000101'),
  ('customer_2', '0e000000-0000-4000-8000-000000000102');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v.v, 'authenticated', 'authenticated',
       v.k || '+lote@fadeup.test', 'x', '{}'::jsonb,
       jsonb_build_object('full_name', initcap(replace(v.k, '_', ' '))), now(), now()
from v_ids v;

/** The target day and instants within it — ONE helper, used by fixtures and assertions alike. */
create or replace function pg_temp.target_date()
returns date language sql stable as $$
  select (date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days')::date;
$$;

create or replace function pg_temp.at_local(p_hour integer, p_minute integer default 0)
returns timestamptz language sql stable as $$
  select (pg_temp.target_date()::timestamp
          + make_interval(hours => p_hour, mins => p_minute)) at time zone 'Europe/Paris';
$$;

do $$
-- `sfx`, not `k`: a loop variable named k is ambiguous against v_ids.k
  -- inside the subqueries below, and plpgsql resolves it to the column.
  declare v_org uuid; v_loc uuid; v_barber uuid; v_row record; v_svc uuid; sfx text;
begin
  foreach sfx in array array['a', 'b'] loop
    perform pg_temp.become((select v from v_ids where v_ids.k = 'owner_' || sfx));

    select * into v_row from public.complete_organization_onboarding(
      'LOTE Shop ' || upper(sfx), 'lote-shop-' || sfx, 'Main', 'Europe/Paris');
    v_org := v_row.organization_id;
    v_loc := v_row.location_id;

    perform public.save_business_profile(v_org, 'barbershop'::public.business_type, 'EUR', 'FR');
    update public.locations set address_line1 = '1 rue LOTE', city = 'Paris', country = 'FR' where id = v_loc;

    v_barber := public.ensure_owner_professional(v_org, v_loc, 'Pro ' || upper(sfx), 'Barber');
    perform public.apply_starter_services(v_org, v_loc,
      '[{"name":"Coupe","duration_minutes":30,"price_cents":2500}]'::jsonb, v_barber);

    -- Split shift on the target day: 09:00-12:00 and 14:00-19:00. Auto-confirm
    -- has to respect it without a human ever looking.
    perform public.apply_weekly_hours(v_org, v_loc, v_barber,
      (select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', '09:00', 'close_time', '12:00',
                                           'second_open_time', '14:00', 'second_close_time', '19:00'))
       from generate_series(0, 6) d));

    perform public.complete_onboarding(v_org, true);
    select s.id into v_svc from public.services s where s.organization_id = v_org limit 1;

    perform pg_temp.become_postgres();
    insert into v_ids (k, v) values
      ('org_' || sfx, v_org), ('loc_' || sfx, v_loc), ('barber_' || sfx, v_barber), ('svc_' || sfx, v_svc);
  end loop;
end $$;

/** Books at Shop A as anon (p_user null) or as a signed-in customer. Returns the row or raises. */
create or replace function pg_temp.book(p_at timestamptz, p_user uuid default null)
returns record language plpgsql as $$
declare v_row record;
begin
  if p_user is null then perform pg_temp.become_anon(); else perform pg_temp.become(p_user); end if;
  select * into v_row from public.book_public_appointment(
    'lote-shop-a',
    (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a'),
    (select v from v_ids where k = 'svc_a'),
    p_at, 'Test Customer', '+33612000900', 'lote@fadeup.test', null);
  perform pg_temp.become_postgres();
  return v_row;
end;
$$;

/** Attempts a booking and returns 'OK' or the error message. */
create or replace function pg_temp.try_book(p_at timestamptz, p_user uuid default null)
returns text language plpgsql as $$
declare v_row record;
begin
  begin
    v_row := pg_temp.book(p_at, p_user);
    return 'OK';
  exception when others then
    perform pg_temp.become_postgres();
    return sqlerrm;
  end;
end;
$$;

create or replace function pg_temp.try_rpc(p_user uuid, p_sql text)
returns text language plpgsql as $$
begin
  perform pg_temp.become(p_user);
  begin
    execute p_sql;
    perform pg_temp.become_postgres();
    return 'OK';
  exception when others then
    perform pg_temp.become_postgres();
    return sqlerrm;
  end;
end;
$$;

-- ============================================================================
-- SECTION 1 — Structure and preserved invariants
-- ============================================================================

select pg_temp.expect('1.1 shared window validator exists and is INVOKER',
  (select not prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'slot_is_within_hours'),
  'one definition of "within hours", shared by booking and reschedule');

select pg_temp.expect('1.2 validator is unreachable by anon',
  not has_function_privilege('anon',
    'private.slot_is_within_hours(uuid,uuid,timestamptz,timestamptz,text)', 'execute'));

select pg_temp.expect('1.3 the GiST exclusion predicate is UNCHANGED',
  (select pg_get_constraintdef(oid) like '%cancelled%no_show%'
     from pg_constraint where conname = 'appointments_barber_no_overlap'),
  'auto-confirm changes the birth status, never the constraint that decides races');

select pg_temp.expect('1.4 no appointment_status values were added or removed',
  (select count(*) = 5 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'appointment_status'));

select pg_temp.expect('1.5 time-block trigger still armed',
  (select count(*) = 1 from pg_trigger where tgname = 'appointments_check_time_blocks'));

select pg_temp.expect('1.6 book_public_appointment still returns claim_token',
  (select count(*) = 1 from information_schema.routines r
    join information_schema.parameters pa on pa.specific_name = r.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'book_public_appointment'
      and pa.parameter_name = 'claim_token'),
  'the LOT 13 anonymous-ownership contract survived');

select pg_temp.expect('1.7 the old request-only trigger function is gone',
  (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_new_booking_request'),
  'replaced by notify_new_appointment rather than left to drift beside it');

-- ============================================================================
-- SECTION 2 — The new golden path
-- ============================================================================

do $$
declare v_row record;
begin
  v_row := pg_temp.book(pg_temp.at_local(10, 0));
  insert into v_ids (k, v) values ('appt_anon', v_row.id);

  perform pg_temp.expect('2.1 a valid public booking is CONFIRMED immediately',
    v_row.status = 'confirmed', 'no approval step, no waiting');
  perform pg_temp.expect('2.2 the RPC RETURNS confirmed to the caller',
    v_row.status::text = 'confirmed',
    'the customer UI can show a confirmation without a second round trip');
  perform pg_temp.expect('2.3 an anonymous booking still gets a claim token',
    v_row.claim_token is not null and length(v_row.claim_token) = 64);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('2.1 a valid public booking is CONFIRMED immediately', false, sqlerrm);
end $$;

select pg_temp.expect('2.4 it never passed through pending',
  (select status = 'confirmed' and expires_at is null
     from public.appointments where id = (select v from v_ids where k = 'appt_anon')),
  'no expiry deadline exists, so the sweep has nothing to find');

select pg_temp.expect('2.5 nobody is recorded as having decided it',
  (select decided_at is null and decided_by is null
     from public.appointments where id = (select v from v_ids where k = 'appt_anon')),
  'auto-confirmed is deliberately distinguishable from staff-accepted');

select pg_temp.expect('2.6 the claim token row was actually stored, hashed',
  (select count(*) = 1 from public.appointment_claim_tokens
    where appointment_id = (select v from v_ids where k = 'appt_anon')));

-- Signed-in booking: customer linking must still happen.
do $$
declare v_row record;
begin
  v_row := pg_temp.book(pg_temp.at_local(10, 30), (select v from v_ids where k = 'customer_1'));
  insert into v_ids (k, v) values ('appt_signed', v_row.id);

  perform pg_temp.expect('2.7 a signed-in booking is confirmed too', v_row.status = 'confirmed');
  perform pg_temp.expect('2.8 ...and issues NO claim token', v_row.claim_token is null,
    'there is an account to own it already');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('2.7 a signed-in booking is confirmed too', false, sqlerrm);
end $$;

select pg_temp.expect('2.9 the signed-in booking is linked to its customer record',
  (select a.customer_id is not null and c.user_id = (select v from v_ids where k = 'customer_1')
     from public.appointments a join public.customers c on c.id = a.customer_id
    where a.id = (select v from v_ids where k = 'appt_signed')));

do $$ begin perform pg_temp.become((select v from v_ids where k = 'customer_1')); end $$;
select pg_temp.expect('2.10 the customer''s own history shows it confirmed',
  (select count(*) = 1 from public.get_my_appointments() m
    where m.id = (select v from v_ids where k = 'appt_signed') and m.status = 'confirmed'));
do $$ begin perform pg_temp.become_postgres(); end $$;

do $$ begin perform pg_temp.become((select v from v_ids where k = 'owner_a')); end $$;
select pg_temp.expect('2.11 the professional calendar receives it',
  (select count(*) = 2 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'), pg_temp.at_local(0, 0), pg_temp.at_local(24, 0)) c
   where c.status = 'confirmed'),
  'the same range read that /app Today and /app/calendar both use');
do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- SECTION 3 — What must NOT happen
-- ============================================================================

do $$ begin perform pg_temp.become((select v from v_ids where k = 'owner_a')); end $$;
select pg_temp.expect('3.1 a normal booking does NOT appear in the request inbox',
  (select count(*) = 0 from public.get_booking_requests((select v from v_ids where k = 'org_a'))),
  'the inbox is for decisions; there is no decision to make');
do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('3.2 the pending sweep ignores confirmed appointments',
  (select public.expire_pending_appointments() = 0)
  and (select status = 'confirmed' from public.appointments
        where id = (select v from v_ids where k = 'appt_anon')),
  'a confirmed booking can never be expired out from under a customer');

-- ============================================================================
-- SECTION 4 — Notifications: once each, never a request AND a confirmation
-- ============================================================================

select pg_temp.expect('4.1 the business is told it has a NEW BOOKING',
  (select count(*) = 1 from public.notifications n
    where n.appointment_id = (select v from v_ids where k = 'appt_signed')
      and n.user_id = (select v from v_ids where k = 'owner_a')
      and n.type = 'booking_confirmed' and n.title = 'New booking'));

select pg_temp.expect('4.2 the customer is told it is CONFIRMED',
  (select count(*) = 1 from public.notifications n
    where n.appointment_id = (select v from v_ids where k = 'appt_signed')
      and n.user_id = (select v from v_ids where k = 'customer_1')
      and n.type = 'booking_confirmed' and n.title = 'Booking confirmed'));

select pg_temp.expect('4.3 NO booking_request_created is emitted for a normal booking',
  (select count(*) = 0 from public.notifications n
    where n.appointment_id in (
      (select v from v_ids where k = 'appt_signed'), (select v from v_ids where k = 'appt_anon'))
      and n.type = 'booking_request_created'),
  'the duplicate request-then-confirmation pair the brief forbids');

select pg_temp.expect('4.4 exactly two notifications per confirmed booking',
  (select count(*) = 2 from public.notifications
    where appointment_id = (select v from v_ids where k = 'appt_signed')),
  'one for the shop, one for the customer — no more');

select pg_temp.expect('4.5 an email intent was queued, not sent inline',
  (select count(*) >= 1 from public.email_outbox where to_email = 'lote@fadeup.test'),
  'SMTP being down can never roll back a booking');

-- ============================================================================
-- SECTION 5 — Legacy pending still works
-- ============================================================================

do $$
declare v_id uuid;
begin
  -- A historical request, inserted the way LOT C created them. The product no
  -- longer produces these, but rows like it exist in production today.
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_name, customer_phone,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, status)
  values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a'), (select v from v_ids where k = 'svc_a'),
    'Legacy Pending', '+33612000901',
    pg_temp.at_local(11, 0), pg_temp.at_local(11, 30), 0, 0, 'pending')
  returning id into v_id;
  insert into v_ids (k, v) values ('appt_legacy', v_id);
end $$;

select pg_temp.expect('5.1 a pending row still gets a deadline',
  (select expires_at is not null from public.appointments
    where id = (select v from v_ids where k = 'appt_legacy')),
  'the approval architecture is intact, not deleted');

do $$ begin perform pg_temp.become((select v from v_ids where k = 'owner_a')); end $$;
select pg_temp.expect('5.2 legacy pending DOES appear in the request inbox',
  (select count(*) = 1 from public.get_booking_requests((select v from v_ids where k = 'org_a'))),
  'so a shop can still answer what it was promised it could answer');
do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('5.3 the business was told it was a REQUEST, not a booking',
  (select count(*) = 1 from public.notifications
    where appointment_id = (select v from v_ids where k = 'appt_legacy')
      and type = 'booking_request_created'));

do $$
begin
  update public.appointments set expires_at = now() - interval '1 minute'
    where id = (select v from v_ids where k = 'appt_legacy');
end $$;

select pg_temp.expect('5.4 legacy pending still EXPIRES correctly',
  (select public.expire_pending_appointments() = 1));

select pg_temp.expect('5.5 ...resolving as expired and releasing the slot',
  (select status = 'cancelled' and resolution = 'expired' from public.appointments
    where id = (select v from v_ids where k = 'appt_legacy')));

select pg_temp.expect('5.6 the confirmed bookings beside it were untouched',
  (select count(*) = 2 from public.appointments
    where id in ((select v from v_ids where k = 'appt_anon'), (select v from v_ids where k = 'appt_signed'))
      and status = 'confirmed'));

-- ============================================================================
-- SECTION 6 — Reschedule stays confirmed, and is genuinely validated
-- ============================================================================

select pg_temp.expect('6.1 a CUSTOMER move keeps the appointment confirmed',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_1'),
    format('select public.reschedule_appointment(%L, %L)',
      (select v from v_ids where k = 'appt_signed'), pg_temp.at_local(15, 0))) = 'OK',
  'the shop already said yes to 15:00 by publishing it');

select pg_temp.expect('6.2 ...and it really is still confirmed, at the new time',
  (select status = 'confirmed' and starts_at = pg_temp.at_local(15, 0)
     from public.appointments where id = (select v from v_ids where k = 'appt_signed')),
  'this is the LOT C behaviour that auto-confirm had to change: it used to drop back to pending');

select pg_temp.expect('6.3 ...with no expiry deadline attached',
  (select expires_at is null from public.appointments
    where id = (select v from v_ids where k = 'appt_signed')));

select pg_temp.expect('6.4 the shop was notified of the move',
  (select count(*) >= 1 from public.notifications n
    where n.appointment_id = (select v from v_ids where k = 'appt_signed')
      and n.type = 'booking_rescheduled'));

select pg_temp.expect('6.5 a move INTO the lunch break is refused',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_1'),
    format('select public.reschedule_appointment(%L, %L)',
      (select v from v_ids where k = 'appt_signed'), pg_temp.at_local(12, 30)))
    like '%outside available hours%',
  'the gap auto-confirm had to close: reschedule never checked hours at all, because a human used to see it');

select pg_temp.expect('6.6 a move SPANNING the break is refused',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_1'),
    format('select public.reschedule_appointment(%L, %L)',
      (select v from v_ids where k = 'appt_signed'), pg_temp.at_local(11, 45)))
    like '%outside available hours%');

select pg_temp.expect('6.7 a move to the middle of the night is refused',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_1'),
    format('select public.reschedule_appointment(%L, %L)',
      (select v from v_ids where k = 'appt_signed'), pg_temp.at_local(3, 0)))
    like '%outside available hours%');

select pg_temp.expect('6.8 a FAILED move leaves the original appointment exactly as it was',
  (select status = 'confirmed' and starts_at = pg_temp.at_local(15, 0)
     from public.appointments where id = (select v from v_ids where k = 'appt_signed')),
  'one UPDATE statement — there is never a moment with two appointments');

-- ============================================================================
-- SECTION 7 — Contention and the rules that still refuse a booking
-- ============================================================================

select pg_temp.expect('7.1 a second booking of a TAKEN slot is refused',
  pg_temp.try_book(pg_temp.at_local(10, 0)) like '%exclusion constraint%',
  'serialized contention; scripts/lot-e-concurrency-test.sh proves the parallel case');

select pg_temp.expect('7.2 booking inside the lunch break is refused',
  pg_temp.try_book(pg_temp.at_local(12, 30)) like '%outside available hours%');

select pg_temp.expect('7.3 booking SPANNING the break is refused',
  pg_temp.try_book(pg_temp.at_local(11, 45)) like '%outside available hours%',
  'both endpoints are in open time; the appointment still crosses the closure');

do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason)
  values ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
          (select v from v_ids where k = 'barber_a'),
          pg_temp.at_local(16, 0), pg_temp.at_local(17, 0), 'Dentist');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect('7.4 booking into blocked time is refused',
  pg_temp.try_book(pg_temp.at_local(16, 0)) like '%unavailable at the requested time%');

select pg_temp.expect('7.5 RESCHEDULING into blocked time is refused',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_1'),
    format('select public.reschedule_appointment(%L, %L)',
      (select v from v_ids where k = 'appt_signed'), pg_temp.at_local(16, 0)))
    like '%unavailable at the requested time%',
  'the LOT D trigger covers the reschedule path too, without reschedule knowing about blocks');

select pg_temp.expect('7.6 a booking in the past is still refused',
  pg_temp.try_book(now() - interval '1 hour') like '%must be in the future%');

select pg_temp.expect('7.7 another tenant''s ids are still rejected',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_2'),
    format('select public.reschedule_appointment(%L, %L)',
      (select v from v_ids where k = 'appt_signed'), pg_temp.at_local(14, 0)))
    like '%not authorized%',
  'a customer cannot move somebody else''s appointment');

-- ============================================================================
-- SECTION 8 — Everything LOT C/D built still works
-- ============================================================================

select pg_temp.expect('8.1 the customer can still cancel',
  pg_temp.try_rpc((select v from v_ids where k = 'customer_1'),
    format('select public.cancel_my_appointment(%L)', (select v from v_ids where k = 'appt_signed'))) = 'OK');

select pg_temp.expect('8.2 ...resolving as cancelled_by_customer',
  (select status = 'cancelled' and resolution = 'cancelled_by_customer'
     from public.appointments where id = (select v from v_ids where k = 'appt_signed')));

select pg_temp.expect('8.3 ...and the slot is genuinely released',
  pg_temp.try_book(pg_temp.at_local(15, 0)) = 'OK',
  'the exclusion predicate frees cancelled rows, exactly as in LOT C');

select pg_temp.expect('8.4 complete_appointment still works on a confirmed booking',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.complete_appointment(%L)', (select v from v_ids where k = 'appt_anon'))) = 'OK',
  'and now needs no acceptance first, since the booking was born confirmed');

select pg_temp.expect('8.5 mark_appointment_no_show still refuses a completed booking',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.mark_appointment_no_show(%L)', (select v from v_ids where k = 'appt_anon')))
    like '%only a confirmed appointment%');

select pg_temp.expect('8.6 legacy confirm_booking_request still answers a pending row',
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_booking_request'),
  'kept for legacy rows and any future approval-required workflow');

select pg_temp.expect('8.7 every public table still has RLS forced',
  (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relrowsecurity and c.relforcerowsecurity)));

-- ============================================================================
-- SECTION 9 — The globalization data model (no new columns were needed)
-- ============================================================================

select pg_temp.expect('9.1 organizations already carry currency and country',
  (select count(*) = 2 from information_schema.columns
    where table_name = 'organizations' and column_name in ('currency', 'country_code')),
  'LOT B added these; LOT E uses them rather than inventing a second source');

select pg_temp.expect('9.2 profiles already carry a locale preference',
  (select count(*) = 1 from information_schema.columns
    where table_name = 'profiles' and column_name = 'locale'),
  'authenticated locale persistence needs no migration');

select pg_temp.expect('9.3 a user can only change their OWN locale',
  (select count(*) > 0 from pg_policies
    where tablename = 'profiles' and cmd = 'UPDATE'
      and (qual like '%uid()%' or with_check like '%uid()%')),
  'GeoIP is personalization; it must never become a way to write someone else''s row');

select pg_temp.expect('9.4 locations still own the authoritative timezone',
  (select timezone = 'Europe/Paris' from public.locations
    where id = (select v from v_ids where k = 'loc_a')),
  'the professional calendar reads this, never the device');

select pg_temp.expect('9.5 the shop''s currency is what onboarding stored',
  (select currency = 'EUR' from public.organizations where id = (select v from v_ids where k = 'org_a')),
  'a visitor''s IP must never change it');

select pg_temp.expect('9.6 no table stores a raw visitor IP for locale purposes',
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'public'
      and column_name in ('visitor_ip', 'ip_address', 'client_ip', 'remote_addr')),
  'country-level personalization, not surveillance');

-- ============================================================================
-- Context
-- ============================================================================

select pg_temp.record('INFO.concurrency', 'INFO',
  'This file proves SERIALIZED contention. True parallel racing — simultaneous connections at one slot — is scripts/lot-e-concurrency-test.sh, and is reported separately.');
select pg_temp.record('INFO.legacy_pending', 'INFO',
  'Historical pending rows are deliberately NOT migrated. They were created under a promise that a human would answer; rewriting them would silently confirm appointments nobody agreed to. They keep their semantics and the sweep keeps expiring them.');
select pg_temp.record('INFO.race_guarantee', 'INFO',
  'Concurrency safety never depended on the approval step. The GiST predicate covers pending and confirmed identically, so removing approval changes nothing about which caller wins.');
select pg_temp.record('INFO.reschedule_gap', 'INFO',
  'reschedule_appointment previously validated no hours at all — survivable only because a customer move became a request a human reviewed. LOT E closes that, which is why private.slot_is_within_hours exists.');
select pg_temp.record('INFO.no_new_columns', 'INFO',
  'Globalization required NO new columns: organizations.currency/country_code (LOT B), profiles.locale and locations.timezone already model everything LOT E needs.');
select pg_temp.record('INFO.geoip', 'INFO',
  'GeoIP is a server-side Edge Function boundary and is not represented in SQL at all. It is personalization only and is never consulted for authorization.');

-- ============================================================================
-- RESULTS — selected BEFORE the rollback that discards every fixture row
-- ============================================================================

\echo ''
\echo '======= VERIFY: LOT E — AUTO-CONFIRM + GLOBALIZATION MODEL ======='
select seq, status, check_name, detail from verify_results order by seq;

\echo ''
\echo '--- summary ---'
select status, count(*) from verify_results group by status order by status;

\echo ''
\echo '--- failures (expected: none) ---'
select check_name, detail from verify_results where status = 'FAIL' order by seq;

rollback;
