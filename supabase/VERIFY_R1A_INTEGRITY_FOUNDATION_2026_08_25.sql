-- ============================================================================
-- FadeUp — VERIFY: R1A, data integrity & security foundation
--
-- Companion to MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql.
--
-- Emits one row per check:  check_name | status | detail
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected: 0 FAIL rows.
--
-- Every defect R1A closes was REPRODUCED on a disposable replay before the fix.
-- This file re-runs those exact attacks and asserts they now fail, and equally
-- asserts that the legitimate paths they ran through still work — a guard that
-- also breaks booking is not a fix.
--
-- Refusals are asserted by SQLSTATE, never by a catch-all. A bare
-- "did it raise?" returns true for a typo'd table name, which would let every
-- "an attacker cannot X" check pass while testing nothing.
--
-- Safe to run repeatedly: all fixtures live in a transaction that is rolled
-- back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
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

-- Impersonation must set BOTH claim GUCs: the live stack's auth.uid() parses
-- request.jwt.claims, the older disposable image reads request.jwt.claim.sub.
-- Setting only one leaves auth.uid() NULL, which silently turns every
-- "an attacker cannot" test into "an anonymous caller cannot" — a weaker and
-- different claim, and one that also trips the server-side stand-down paths in
-- the guard triggers.
create or replace function pg_temp.become_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- Returns the SQLSTATE of a refusal, or 'ALLOWED' if the statement succeeded.
-- The caller asserts on the specific code, so a broken test cannot masquerade
-- as a passing security property.
create or replace function pg_temp.sqlstate_of(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.sqlstate_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := sqlstate;
  end;
  execute 'reset role';
  return v;
end;
$$;

begin;

-- ============================================================================
-- FIXTURES
-- ============================================================================

create temporary table v (k text primary key, id uuid);
grant select on v to public;

insert into v (k, id) values
  ('owner', gen_random_uuid()), ('manager', gen_random_uuid()),
  ('barber', gen_random_uuid()), ('victim', gen_random_uuid()),
  ('attacker', gen_random_uuid()), ('cust', gen_random_uuid()),
  ('org', gen_random_uuid());

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       k || '+r1a@fadeup.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()
from v
where k in ('owner', 'manager', 'barber', 'victim', 'attacker', 'cust');

do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ((select id from v where k = 'org'), 'R1A Shop', 'r1a-shop', true);
end $$;

insert into public.locations (organization_id, name, city, country, is_active)
values ((select id from v where k = 'org'), 'Main', 'Lyon', 'FR', true);
insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
values ((select id from v where k = 'org'), 'Fade', 30, 2500, true);

insert into public.memberships (organization_id, user_id, role) values
  ((select id from v where k = 'org'), (select id from v where k = 'owner'), 'owner'),
  ((select id from v where k = 'org'), (select id from v where k = 'manager'), 'manager'),
  ((select id from v where k = 'org'), (select id from v where k = 'barber'), 'barber');

insert into public.barbers (organization_id, staff_profile_id)
select sp.organization_id, sp.id from public.staff_profiles sp
where sp.user_id = (select id from v where k = 'barber');

insert into v (k, id)
select 'loc', id
from public.locations
where organization_id = (select id from v where k = 'org')
order by id
limit 1;

insert into v (k, id)
select 'svc', id
from public.services
where organization_id = (select id from v where k = 'org')
order by id
limit 1;

insert into v (k, id)
select 'bar', id
from public.barbers
where organization_id = (select id from v where k = 'org')
order by id
limit 1;

-- Distinct, non-overlapping slots: appointments_barber_no_overlap is a real
-- GiST exclusion constraint, and a colliding fixture would abort the run rather
-- than test anything.
create or replace function pg_temp.mk_appt(p_status text, p_day integer)
returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.appointments (organization_id, location_id, barber_id, service_id,
    customer_name, starts_at, ends_at, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), (select id from v where k = 'svc'),
          'Fixture', now() + (p_day || ' days')::interval,
          now() + (p_day || ' days')::interval + interval '30 minutes',
          p_status::public.appointment_status)
  returning id into i;
  return i;
end;
$$;

-- A slot that has ALREADY PASSED, for the no-show sweep.
--
-- It has to be born in the past rather than moved there. Moving it would mean
-- UPDATEing starts_at, and restrict_appointment_self_update() refuses that for
-- any caller it cannot positively identify as owner/manager/receptionist —
-- which includes a plain postgres session, because has_org_role() resolves
-- through auth.uid() and that is NULL here. Correct behaviour; it just makes
-- "move the row into the past" the wrong way to build this fixture.
create or replace function pg_temp.mk_appt_at(p_status text, p_hours_ago integer)
returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.appointments (organization_id, location_id, barber_id, service_id,
    customer_name, starts_at, ends_at, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), (select id from v where k = 'svc'),
          'Fixture past', now() - (p_hours_ago || ' hours')::interval,
          now() - (p_hours_ago || ' hours')::interval + interval '30 minutes',
          p_status::public.appointment_status)
  returning id into i;
  return i;
end;
$$;

-- ============================================================================
-- 1. D-1 — CONTACT-DETAIL SQUATTING
--
-- The attacker plants the victim's phone on a row the attacker owns; the
-- victim later books anonymously with their own phone. Before R1A the victim's
-- booking landed on the attacker's row, and get_my_appointments /
-- cancel_my_appointment then handed the attacker the victim's booking.
-- ============================================================================

insert into public.customers (organization_id, name, phone, email, user_id) values
  ((select id from v where k = 'org'), 'Attacker', '+33600001111', 'victim@fadeup.test',
   (select id from v where k = 'attacker'));

do $$
declare i uuid;
begin
  -- The victim's anonymous booking, typing their own phone.
  insert into public.appointments (organization_id, location_id, barber_id, service_id,
    customer_name, customer_phone, starts_at, ends_at, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), (select id from v where k = 'svc'),
          'Victim', '+33600001111', now() + interval '40 days',
          now() + interval '40 days' + interval '30 minutes', 'confirmed')
  returning id into i;
  insert into v (k, id) values ('appt_squat', i);
exception when others then
  perform pg_temp.record('1.0 fixture: victim booking', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect(
  '1.1 an anonymous booking does NOT attach to an account-owned customer row',
  (select customer_id is null from public.appointments where id = (select id from v where k = 'appt_squat')),
  'the phone matched an owned row, so the booking is left safely unlinked');

select pg_temp.expect(
  '1.2 the attacker gained no claim on the victim''s booking',
  (select count(*) = 0
   from public.appointments a
   join public.customers c on c.id = a.customer_id
   where a.id = (select id from v where k = 'appt_squat')
     and c.user_id = (select id from v where k = 'attacker')));

-- The email leg of the same vector.
do $$
declare i uuid;
begin
  insert into public.appointments (organization_id, location_id, barber_id, service_id,
    customer_name, customer_email, starts_at, ends_at, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), (select id from v where k = 'svc'),
          'Victim', 'VICTIM@fadeup.test', now() + interval '41 days',
          now() + interval '41 days' + interval '30 minutes', 'confirmed')
  returning id into i;
  insert into v (k, id) values ('appt_squat_email', i);
exception when others then
  perform pg_temp.record('1.0 fixture: victim booking by email', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect(
  '1.3 the email leg is closed too, case-insensitively',
  (select customer_id is null from public.appointments where id = (select id from v where k = 'appt_squat_email')));

-- The legitimate path must still work: an UNOWNED contact row is still matched,
-- which is how a walk-in who later signs up is recognised.
insert into public.customers (organization_id, name, phone) values
  ((select id from v where k = 'org'), 'Walk-in', '+33600002222');

do $$
declare i uuid;
begin
  insert into public.appointments (organization_id, location_id, barber_id, service_id,
    customer_name, customer_phone, starts_at, ends_at, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), (select id from v where k = 'svc'),
          'Walk-in', '+33600002222', now() + interval '42 days',
          now() + interval '42 days' + interval '30 minutes', 'confirmed')
  returning id into i;
  insert into v (k, id) values ('appt_legit', i);
exception when others then
  perform pg_temp.record('1.0 fixture: walk-in booking', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect(
  '1.4 REGRESSION: an anonymous booking still links to an UNOWNED contact row',
  (select customer_id is not null from public.appointments where id = (select id from v where k = 'appt_legit')),
  'the walk-in recognition path is unaffected');

-- The queue leg.
do $$
declare i uuid;
begin
  insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, customer_phone, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), 'Victim', '+33600001111', 'waiting')
  returning id into i;
  insert into v (k, id) values ('q_squat', i);
exception when others then
  perform pg_temp.record('1.0 fixture: victim queue join', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect(
  '1.5 the queue leg is closed — join_public_queue cannot adopt an owned row',
  (select customer_id is null from public.queue_entries where id = (select id from v where k = 'q_squat')));

-- ============================================================================
-- 2. APPOINTMENT TRANSITIONS — every edge of the matrix, for every role
-- ============================================================================

select pg_temp.expect('2.1 LEGAL pending -> confirmed',
  pg_temp.sqlstate_of(format('update public.appointments set status=''confirmed'' where id=%L', pg_temp.mk_appt('pending', 101))) = 'ALLOWED');
select pg_temp.expect('2.2 LEGAL pending -> cancelled',
  pg_temp.sqlstate_of(format('update public.appointments set status=''cancelled'' where id=%L', pg_temp.mk_appt('pending', 102))) = 'ALLOWED');
select pg_temp.expect('2.3 LEGAL confirmed -> completed',
  pg_temp.sqlstate_of(format('update public.appointments set status=''completed'' where id=%L', pg_temp.mk_appt('confirmed', 103))) = 'ALLOWED');
select pg_temp.expect('2.4 LEGAL confirmed -> no_show',
  pg_temp.sqlstate_of(format('update public.appointments set status=''no_show'' where id=%L', pg_temp.mk_appt('confirmed', 104))) = 'ALLOWED');
select pg_temp.expect('2.5 LEGAL confirmed -> cancelled',
  pg_temp.sqlstate_of(format('update public.appointments set status=''cancelled'' where id=%L', pg_temp.mk_appt('confirmed', 105))) = 'ALLOWED');

select pg_temp.expect('2.6 ILLEGAL pending -> completed refused 22023',
  pg_temp.sqlstate_of(format('update public.appointments set status=''completed'' where id=%L', pg_temp.mk_appt('pending', 106))) = '22023');
select pg_temp.expect('2.7 ILLEGAL pending -> no_show refused 22023',
  pg_temp.sqlstate_of(format('update public.appointments set status=''no_show'' where id=%L', pg_temp.mk_appt('pending', 107))) = '22023');
select pg_temp.expect('2.8 ILLEGAL completed -> pending refused 22023 (terminal)',
  pg_temp.sqlstate_of(format('update public.appointments set status=''pending'' where id=%L', pg_temp.mk_appt('completed', 108))) = '22023');
select pg_temp.expect('2.9 ILLEGAL cancelled -> confirmed refused 22023 (terminal)',
  pg_temp.sqlstate_of(format('update public.appointments set status=''confirmed'' where id=%L', pg_temp.mk_appt('cancelled', 109))) = '22023');
select pg_temp.expect('2.10 ILLEGAL no_show -> completed refused 22023 (terminal)',
  pg_temp.sqlstate_of(format('update public.appointments set status=''completed'' where id=%L', pg_temp.mk_appt('no_show', 110))) = '22023');
select pg_temp.expect('2.11 ILLEGAL confirmed -> pending without the reschedule flag refused 22023',
  pg_temp.sqlstate_of(format('update public.appointments set status=''pending'' where id=%L', pg_temp.mk_appt('confirmed', 111))) = '22023');

-- THE POINT OF A SEPARATE TRIGGER: owner, manager and barber are all exempt
-- from restrict_appointment_self_update. None of them is exempt from this.
do $$
declare i uuid;
begin
  i := pg_temp.mk_appt('completed', 112);
  perform pg_temp.expect('2.12 an OWNER cannot resurrect a completed appointment',
    pg_temp.sqlstate_as((select id from v where k = 'owner'),
      format('update public.appointments set status=''confirmed'' where id=%L', i)) in ('22023', '42501'));
  i := pg_temp.mk_appt('completed', 113);
  perform pg_temp.expect('2.13 a MANAGER cannot resurrect a completed appointment',
    pg_temp.sqlstate_as((select id from v where k = 'manager'),
      format('update public.appointments set status=''confirmed'' where id=%L', i)) in ('22023', '42501'));
  i := pg_temp.mk_appt('pending', 114);
  perform pg_temp.expect('2.14 a BARBER cannot jump pending -> completed',
    pg_temp.sqlstate_as((select id from v where k = 'barber'),
      format('update public.appointments set status=''completed'' where id=%L', i)) in ('22023', '42501'));
exception when others then
  perform pg_temp.record('2.12-2.14 per-role terminal/skip refusals', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$ begin perform pg_temp.become_postgres(); end $$;

-- The reschedule path, with the flag the RPC sets.
do $$
declare i uuid;
begin
  i := pg_temp.mk_appt('confirmed', 115);
  perform set_config('fadeup.appointment_reschedule', 'on', true);
  update public.appointments set status = 'pending' where id = i;
  perform set_config('fadeup.appointment_reschedule', 'off', true);
  perform pg_temp.expect('2.15 REGRESSION: customer reschedule confirmed -> pending still works',
    (select status = 'pending' from public.appointments where id = i));
exception when others then
  perform pg_temp.record('2.15 REGRESSION: customer reschedule confirmed -> pending still works',
    'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- The bulk sweep. confirmed -> no_show, in bulk, setting no decided_at — one of
-- the two edges that would have been missed by writing the guard from intuition.
do $$
declare i uuid; n integer;
begin
  i := pg_temp.mk_appt_at('confirmed', 3);
  n := public.apply_appointment_no_show_rule((select id from v where k = 'org'));
  perform pg_temp.expect('2.16 REGRESSION: bulk no-show sweep still works', n >= 1,
    format('%s row(s) swept', n));
  perform pg_temp.expect('2.17 the swept row really is no_show',
    (select status = 'no_show' from public.appointments where id = i));
exception when others then
  perform pg_temp.record('2.16 REGRESSION: bulk no-show sweep still works', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 3. COMPLETION IS SERVER-AUTHORITATIVE
-- ============================================================================

do $$
declare i uuid;
begin
  i := pg_temp.mk_appt('confirmed', 120);
  update public.appointments set status = 'completed' where id = i;
  perform pg_temp.expect('3.1 completed_at is stamped by the database on completion',
    (select completed_at is not null from public.appointments where id = i));
  perform pg_temp.expect('3.2 a client cannot write completed_at',
    pg_temp.sqlstate_as((select id from v where k = 'owner'),
      format('update public.appointments set completed_at = now() - interval ''99 days'' where id=%L', i)) = '42501');
exception when others then
  perform pg_temp.record('3.1-3.2 completion is server-authoritative', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '3.3 no completed row carries a fabricated completion time',
  (select count(*) = 0 from public.appointments
   where status = 'completed' and completed_at is not null and completed_at = starts_at),
  'completed_at is never inferred from starts_at');

-- ============================================================================
-- 4. QUEUE INTEGRITY
-- ============================================================================

do $$
declare i uuid;
begin
  insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), 'Q1', 'waiting')
  returning id into i;
  insert into v (k, id) values ('q1', i);

  -- The exact forgery that succeeded before R1A.
  update public.queue_entries set status = 'completed',
    called_at = now() - interval '10 days',
    service_started_at = now() - interval '10 days 5 minutes',
    completed_at = now() - interval '10 days 20 minutes'
  where id = i;

  perform pg_temp.expect('4.1 client-supplied queue timestamps are discarded',
    (select called_at <= service_started_at and service_started_at <= completed_at
     from public.queue_entries where id = i),
    'the server stamps them in order; the backdated impossible values are gone');

  perform pg_temp.expect('4.2 the stamped completion is recent, not backdated',
    (select completed_at > now() - interval '1 hour' from public.queue_entries where id = i));
exception when others then
  perform pg_temp.record('4.1-4.2 queue timestamp forgery', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare i uuid;
begin
  insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), 'Q2', 'waiting')
  returning id into i;
  insert into v (k, id) values ('q2', i);

  update public.queue_entries set status = 'called' where id = i;
  update public.queue_entries set status = 'in_service' where id = i;
  update public.queue_entries set status = 'completed' where id = i;

  perform pg_temp.expect('4.3 REGRESSION: normal queue progression works and is monotonic',
    (select called_at <= service_started_at and service_started_at <= completed_at
       and status = 'completed'
     from public.queue_entries where id = i));
exception when others then
  perform pg_temp.record('4.3 REGRESSION: normal queue progression works and is monotonic',
    'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect('4.4 a terminal queue entry cannot be re-opened',
  pg_temp.sqlstate_of(format('update public.queue_entries set status=''waiting'' where id=%L',
    (select id from v where k = 'q2'))) = '22023');

do $$
declare i uuid; c uuid;
begin
  insert into public.customers (organization_id, name) values ((select id from v where k='org'),'Other')
  returning id into c;
  insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, status)
  values ((select id from v where k = 'org'), (select id from v where k = 'loc'),
          (select id from v where k = 'bar'), 'Q3', 'waiting')
  returning id into i;
  update public.queue_entries set status = 'called' where id = i;
  perform pg_temp.expect('4.5 customer_id cannot be reassigned once the entry has been called',
    pg_temp.sqlstate_of(format('update public.queue_entries set customer_id=%L where id=%L', c, i)) = '22023');
exception when others then
  perform pg_temp.record('4.5 customer_id freeze', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 5. APPOINTMENT HISTORY DURABILITY
-- ============================================================================

-- Run as the OWNER, because that is the actor the original reproduction used
-- and the only one who can reach this through PostgREST at all.
--
-- Running it as a bare postgres session tests something different and weaker.
-- barbers has a second child, queue_entries.barber_id, which is ON DELETE SET
-- NULL; that cascade fires restrict_queue_entry_self_update() as an UPDATE,
-- and with no JWT has_org_role() cannot identify the caller, so that trigger
-- refuses first with P0001. The row is still protected, but by the wrong guard
-- and for the wrong reason — which would have left the RESTRICT itself
-- untested while the check appeared to pass.
do $$
declare v_code text;
begin
  v_code := pg_temp.sqlstate_as((select id from v where k = 'owner'),
    format('delete from public.barbers where id=%L', (select id from v where k = 'bar')));
  perform pg_temp.expect(
    '5.1 an OWNER removing a barber who has history is refused (23503)',
    v_code = '23503',
    format('got %s; before R1A this silently destroyed every appointment', v_code));
end $$;

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '5.2 the appointment history is intact after the refusal',
  (select count(*) > 0 from public.appointments where barber_id = (select id from v where k = 'bar')));

select pg_temp.expect(
  '5.3 offboard_barber() is the supported removal path and works',
  pg_temp.sqlstate_as((select id from v where k = 'owner'),
    format('select public.offboard_barber(%L)', (select id from v where k = 'bar'))) = 'ALLOWED');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('5.4 offboarding made the barber unbookable rather than removing them',
  (select not is_bookable from public.barbers where id = (select id from v where k = 'bar')));

-- Account erasure must remain possible, and must not take history with it.
do $$
declare n_before integer; n_after integer; v_state text;
begin
  select count(*) into n_before from public.appointments where barber_id = (select id from v where k='bar');
  v_state := pg_temp.sqlstate_of(format('delete from auth.users where id=%L', (select id from v where k='barber')));
  select count(*) into n_after from public.appointments where barber_id = (select id from v where k='bar');

  perform pg_temp.expect('5.5 a professional''s account can still be erased', v_state = 'ALLOWED',
    format('sqlstate=%s', v_state));
  perform pg_temp.expect('5.6 erasing the account did NOT destroy the service history',
    n_after = n_before, format('%s appointments before, %s after', n_before, n_after));
  perform pg_temp.expect('5.7 the roster record survives, detached from the erased account',
    (select count(*) = 1 from public.staff_profiles
     where organization_id = (select id from v where k='org') and user_id is null));
exception when others then
  perform pg_temp.record('5.5-5.7 account erasure vs history', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 6. IDENTITY BINDING AND ATTRIBUTION
-- ============================================================================

select pg_temp.expect('6.1 a shop cannot repoint customers.user_id at another account',
  pg_temp.sqlstate_as((select id from v where k = 'owner'),
    format('update public.customers set user_id=%L where organization_id=%L',
      (select id from v where k = 'victim'), (select id from v where k = 'org'))) = '42501');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('6.2 a shop cannot forge booked_by_user_id on INSERT',
  pg_temp.sqlstate_as((select id from v where k = 'owner'), format(
    'insert into public.appointments (organization_id,location_id,barber_id,service_id,'
    || 'customer_name,starts_at,ends_at,status,booked_by_user_id) values (%L,%L,%L,%L,'
    || '''Forged'', now() + interval ''200 days'', now() + interval ''200 days 30 minutes'', ''completed'', %L)',
    (select id from v where k='org'), (select id from v where k='loc'),
    (select id from v where k='bar'), (select id from v where k='svc'),
    (select id from v where k='victim'))) = '42501');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('6.3 a shop cannot forge booked_by_user_id on UPDATE',
  pg_temp.sqlstate_as((select id from v where k = 'owner'),
    format('update public.appointments set booked_by_user_id=%L where id=%L',
      (select id from v where k='victim'), (select id from v where k='appt_legit'))) = '42501');

do $$ begin perform pg_temp.become_postgres(); end $$;

-- The ordinary staff booking path must still work.
select pg_temp.expect('6.4 REGRESSION: staff can still create an ordinary appointment',
  pg_temp.sqlstate_as((select id from v where k = 'owner'), format(
    'insert into public.appointments (organization_id,location_id,barber_id,service_id,'
    || 'customer_name,starts_at,ends_at,status) values (%L,%L,%L,%L,'
    || '''Walk-in'', now() + interval ''201 days'', now() + interval ''201 days 30 minutes'', ''confirmed'')',
    (select id from v where k='org'), (select id from v where k='loc'),
    (select id from v where k='bar'), (select id from v where k='svc'))) = 'ALLOWED');

do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- 7. COLUMN PRIVILEGES — the mechanism that protects a single column
--
-- A column-level REVOKE cannot subtract from a table-level grant, so each of
-- these rests on a table-level revoke plus a selective re-grant. That silently
-- changes what PostgREST may write, so it is asserted per column rather than
-- assumed.
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select * from (values
      ('appointments','booked_by_user_id','SELECT', true),
      ('appointments','booked_by_user_id','INSERT', false),
      ('appointments','booked_by_user_id','UPDATE', false),
      ('appointments','completed_at','UPDATE', false),
      ('appointments','status','INSERT', true),
      ('appointments','status','UPDATE', true),
      ('appointments','customer_id','UPDATE', true),
      ('queue_entries','booked_by_user_id','INSERT', false),
      ('queue_entries','booked_by_user_id','UPDATE', false),
      ('queue_entries','status','UPDATE', true),
      ('queue_entries','completed_at','UPDATE', true),
      ('professional_applications','internal_note','SELECT', false),
      ('professional_applications','status','SELECT', true),
      ('professional_applications','rejection_reason','SELECT', true)
    ) as x(tbl, col, priv, want)
  loop
    perform pg_temp.expect(
      format('7.x authenticated %s %s.%s', case when r.want then 'MAY' else 'may NOT' end, r.tbl, r.col),
      has_column_privilege('authenticated', 'public.' || r.tbl, r.col, r.priv) = r.want,
      format('%s expected %s', r.priv, r.want));
  end loop;
exception when others then
  perform pg_temp.record('7.x column privilege matrix', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 8. FADE PASSPORT
-- ============================================================================

insert into public.customer_profiles (user_id, display_name)
values ((select id from v where k = 'cust'), 'Cust');
insert into public.customer_passports (user_id, usual_haircut)
values ((select id from v where k = 'cust'), 'Fade');

select pg_temp.expect('8.1 a customer cannot discard their Fade Passport',
  pg_temp.sqlstate_as((select id from v where k = 'cust'),
    format('delete from public.customer_passports where user_id=%L', (select id from v where k='cust'))) = '42501');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('8.2 the Passport still exists',
  (select count(*) = 1 from public.customer_passports where user_id = (select id from v where k='cust')));

-- The exact statement PostgREST emits for the app's
-- .upsert({ user_id, ... }, { onConflict: 'user_id' }). ON CONFLICT DO UPDATE
-- requires UPDATE privilege on every column in its SET list, including
-- user_id — withholding it would break the Passport editor for every customer.
select pg_temp.expect('8.3 REGRESSION: the PostgREST Passport upsert still works',
  pg_temp.sqlstate_as((select id from v where k = 'cust'), format(
    'insert into public.customer_passports (user_id, usual_haircut) values (%L, ''Mid fade'') '
    || 'on conflict (user_id) do update set user_id = excluded.user_id, usual_haircut = excluded.usual_haircut',
    (select id from v where k='cust'))) = 'ALLOWED');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('8.4 the upsert actually saved',
  (select usual_haircut = 'Mid fade' from public.customer_passports where user_id = (select id from v where k='cust')));

select pg_temp.expect('8.5 one Passport per account is still enforced structurally',
  (select count(*) > 0 from pg_constraint
   where conrelid = 'public.customer_passports'::regclass and contype = 'u'));

-- ============================================================================
-- 9. INTERNAL DATA
-- ============================================================================

select pg_temp.expect('9.1 the acquisition worker cannot read transactional email',
  has_table_privilege('prospect_worker', 'public.email_outbox', 'SELECT') = false);

select pg_temp.expect('9.2 no worker SELECT policy remains on email_outbox',
  (select count(*) = 0 from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'email_outbox' and p.polname = 'email_outbox_worker_select'));

select pg_temp.expect('9.3 claim_next_email still exists — the worker keeps its real path',
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'claim_next_email'));

-- ============================================================================
-- 10. PLATFORM INVARIANTS — R1A must not weaken the existing baseline
-- ============================================================================

select pg_temp.expect('10.1 every public table still has RLS enabled AND forced',
  (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity)));

select pg_temp.expect('10.2 still zero policies granting anon or PUBLIC',
  (select count(*) = 0 from pg_policy p
   where exists (select 1 from unnest(p.polroles) r where r = 0 or pg_get_userbyid(r) = 'anon')));

select pg_temp.expect('10.3 every SECURITY DEFINER function still pins search_path',
  (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));

select pg_temp.expect('10.4 appointments.barber_id is ON DELETE RESTRICT',
  (select confdeltype = 'r' from pg_constraint where conname = 'appointments_barber_id_fkey'));

select pg_temp.expect('10.5 staff_profiles.user_id is ON DELETE SET NULL',
  (select confdeltype = 'n' from pg_constraint where conname = 'staff_profiles_user_id_fkey'));

select pg_temp.expect('10.6 both R1A indexes exist',
  (select count(*) = 2 from pg_indexes where schemaname = 'public'
   and indexname in ('staff_profiles_user_id_idx', 'appointments_barber_customer_completed_idx')));

select pg_temp.expect('10.7 R1A introduced no new table',
  (select count(*) = 89 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),
  'R1A is integrity only — social tables belong to R1B');

select pg_temp.record('10.8 public tables', 'INFO',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'));

-- ============================================================================
-- 11. WHAT THE UPGRADE DID TO PRE-EXISTING DATA
--
-- Only meaningful when SEED_R1A_PRE_UPGRADE_2026_08_25.sql was loaded before
-- MASTER (TEST B). On a fresh database the seed rows are absent and this
-- section reports INFO instead of asserting, so one VERIFY file serves both
-- tests without either one silently skipping a real assertion.
-- ============================================================================

do $$
declare
  v_seeded boolean;
begin
  select exists (select 1 from public.organizations where slug = 'r1a-seed-pre') into v_seeded;

  if not v_seeded then
    perform pg_temp.record('11.0 pre-R1A seed data', 'INFO',
      'not seeded — this is TEST A (fresh database). Section 11 asserts nothing here.');
    return;
  end if;

  perform pg_temp.record('11.0 pre-R1A seed data', 'INFO', 'seeded — asserting upgrade behaviour');

  -- The backfill trusted real evidence...
  perform pg_temp.expect(
    '11.1 a completed row WITH decided_at was given that exact completion time',
    (select completed_at = timestamptz '2026-08-01 09:41:00+00'
     from public.appointments where id = 'aaaaaaaa-0000-4000-8000-00000000000a'));

  -- ...and refused to invent any.
  perform pg_temp.expect(
    '11.2 a completed row with NO evidence still has NO completion time',
    (select completed_at is null
     from public.appointments where id = 'aaaaaaaa-0000-4000-8000-00000000000b'),
    'unknown is recorded as unknown');

  perform pg_temp.expect(
    '11.3 and its completion time was NOT fabricated from starts_at',
    (select completed_at is distinct from starts_at
     from public.appointments where id = 'aaaaaaaa-0000-4000-8000-00000000000b'));

  -- The forged queue row survives untouched: a migration that quietly
  -- rewrote it would be destroying evidence of the very defect being fixed.
  perform pg_temp.expect(
    '11.4 the pre-existing forged queue row was NOT rewritten by the migration',
    (select completed_at = timestamptz '2026-07-01 11:40:00+00'
        and service_started_at = timestamptz '2026-07-01 11:55:00+00'
        and called_at = timestamptz '2026-07-01 12:00:00+00'
     from public.queue_entries where id = 'aaaaaaaa-0000-4000-8000-00000000000c'));

  perform pg_temp.expect(
    '11.5 the monotonicity CHECK exists but is left NOT VALID, as designed',
    (select not convalidated from pg_constraint
     where conname = 'queue_entries_timestamps_monotonic'),
    'existing rows violate it; new and updated rows are still enforced');

  -- New rows are enforced even though old ones were grandfathered.
  perform pg_temp.expect(
    '11.6 NOT VALID still enforces NEW rows',
    pg_temp.sqlstate_of(
      'insert into public.queue_entries (organization_id, location_id, customer_name, status,'
      || ' called_at, service_started_at) values ('
      || '''aaaaaaaa-0000-4000-8000-000000000001'', ''aaaaaaaa-0000-4000-8000-000000000002'','
      || ' ''New forgery'', ''waiting'', now(), now() - interval ''1 hour'')') = '23514');

  -- The FK was validated against real appointment rows, not just declared.
  perform pg_temp.expect(
    '11.7 appointments_barber_id_fkey was VALIDATED against the existing rows',
    (select convalidated from pg_constraint where conname = 'appointments_barber_id_fkey'));

  -- Honest, and deliberate.
  perform pg_temp.expect(
    '11.8 R1A did NOT retroactively unpick the historical squat',
    (select customer_id = 'aaaaaaaa-0000-4000-8000-000000000005'
     from public.appointments where id = 'aaaaaaaa-0000-4000-8000-00000000000d'),
    'the database cannot tell a squat from a legitimate old link; guessing would detach real customers');

exception when others then
  perform pg_temp.record('11.x pre-R1A upgrade behaviour', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- RESULTS
-- ============================================================================

select check_name, status, coalesce(detail, '') as detail from verify_results order by seq;

select
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail,
  count(*) filter (where status = 'INFO') as info
from verify_results;

rollback;
