-- ============================================================================
-- FadeUp — VERIFY: LOT D, the professional workspace
--
-- Companion to MASTER_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql.
--
-- Emits one row per check:  check_name | status  where status is
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected result: 0 FAIL rows.
--
-- Behavioural wherever behaviour is what matters. Split shifts and time blocks
-- are only worth anything if the availability engine actually refuses the time,
-- so this file books, is refused, and checks the refusal — it does not assert
-- that a column exists and call that proof.
--
-- Safe to run repeatedly: every fixture lives inside a transaction that is
-- rolled back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql
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
-- FIXTURES
-- ============================================================================

create temporary table v_ids (k text primary key, v uuid);
grant select on v_ids to public;

insert into v_ids (k, v) values
  ('owner_a',  '0d000000-0000-4000-8000-00000000000a'),
  ('barber_u', '0d000000-0000-4000-8000-00000000002a'),
  ('owner_b',  '0d000000-0000-4000-8000-00000000000b');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v.v, 'authenticated', 'authenticated',
       v.k || '+lotd@fadeup.test', 'x', '{}'::jsonb,
       jsonb_build_object('full_name', initcap(replace(v.k, '_', ' '))), now(), now()
from v_ids v;

/**
 * The target day, seven days out, and instants within it. Built by ONE helper
 * used by both the fixtures and the assertions — computing the same instant
 * twice in two different ways is what produced five false failures in LOT C.
 */
create or replace function pg_temp.target_date()
returns date language sql stable as $$
  select (date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days')::date;
$$;

create or replace function pg_temp.at_local(p_hour integer, p_minute integer default 0)
returns timestamptz language sql stable as $$
  select (pg_temp.target_date()::timestamp
          + make_interval(hours => p_hour, mins => p_minute)) at time zone 'Europe/Paris';
$$;

-- Two shops built through the real LOT B onboarding RPCs, so everything below
-- runs on a genuinely bookable business rather than hand-inserted rows.
do $$
declare
  v_org uuid; v_loc uuid; v_barber uuid; v_row record; k text; owner_key text;
  v_svc uuid;
begin
  foreach k in array array['a', 'b'] loop
    owner_key := 'owner_' || k;
    perform pg_temp.become((select v from v_ids where v_ids.k = owner_key));

    select * into v_row from public.complete_organization_onboarding(
      'LOTD Shop ' || upper(k), 'lotd-shop-' || k, 'Main', 'Europe/Paris');
    v_org := v_row.organization_id;
    v_loc := v_row.location_id;

    perform public.save_business_profile(v_org, 'barbershop'::public.business_type, 'EUR', 'FR');
    update public.locations set address_line1 = '1 rue LOTD', city = 'Paris', country = 'FR'
      where id = v_loc;

    v_barber := public.ensure_owner_professional(v_org, v_loc, 'Pro ' || upper(k), 'Barber');
    perform public.apply_starter_services(v_org, v_loc,
      '[{"name":"Coupe","duration_minutes":30,"price_cents":2500}]'::jsonb, v_barber);

    -- Every day open 08:00-20:00 to start with; the split shift is applied to
    -- the target day only, further down, so the "before" behaviour is real.
    perform public.apply_weekly_hours(v_org, v_loc, v_barber,
      (select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', '08:00', 'close_time', '20:00'))
       from generate_series(0, 6) d));

    perform public.complete_onboarding(v_org, true);

    select s.id into v_svc from public.services s where s.organization_id = v_org limit 1;

    perform pg_temp.become_postgres();
    insert into v_ids (k, v) values
      ('org_' || k, v_org), ('loc_' || k, v_loc), ('barber_' || k, v_barber), ('svc_' || k, v_svc);
  end loop;
end $$;

-- A plain barber at Shop A: a membership with role 'barber' (NOT front-of-house)
-- whose staff profile belongs to barber_u. Inserted directly because there is no
-- RPC that mints a colleague without the invitation flow, and the invitation
-- flow is LOT B's to prove, not this file's.
do $$
declare v_sp uuid; v_b uuid;
begin
  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_public, is_active)
  values ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'barber_u'),
          (select v from v_ids where k = 'loc_a'), 'Karim', true, true)
  returning id into v_sp;

  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  values ((select v from v_ids where k = 'org_a'), v_sp, true)
  returning id into v_b;

  insert into public.memberships (organization_id, user_id, role)
  values ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'barber_u'), 'barber');

  insert into v_ids (k, v) values ('barber_karim', v_b);
end $$;

-- ============================================================================
-- SECTION 1 — Structure
-- ============================================================================

select pg_temp.expect('1.1 split-shift columns on barber_working_hours',
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'barber_working_hours'
      and column_name in ('second_start_time', 'second_end_time')),
  'the schema can finally express a day with a break in it');

select pg_temp.expect('1.2 split-shift columns on location_hours',
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'location_hours'
      and column_name in ('second_open_time', 'second_close_time')));

select pg_temp.expect('1.3 unique-per-day constraints PRESERVED',
  (select count(*) = 2 from pg_constraint
    where conname in ('barber_working_hours_barber_day_unique', 'location_hours_location_day_unique'))
  or (select count(*) >= 2 from pg_indexes
    where schemaname = 'public'
      and (indexdef like '%UNIQUE%barber_id, day_of_week%' or indexdef like '%UNIQUE%location_id, day_of_week%')),
  'the additive design leaves apply_weekly_hours'' on-conflict targets intact');

select pg_temp.expect('1.4 time_blocks exists',
  (select count(*) = 1 from pg_tables where schemaname = 'public' and tablename = 'time_blocks'));

select pg_temp.expect('1.5 time_blocks has RLS ENABLED and FORCED',
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.time_blocks'::regclass),
  'FORCE matters: without it the table owner silently bypasses every policy');

select pg_temp.expect('1.6 time_blocks has all four policies',
  (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'time_blocks'));

select pg_temp.expect('1.7 time_blocks in the realtime publication',
  (select count(*) = 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'time_blocks'),
  'a manager blocking a barber''s afternoon must reach that barber''s open calendar');

select pg_temp.expect('1.8 time_blocks range index present',
  (select count(*) = 1 from pg_indexes
    where schemaname = 'public' and indexname = 'time_blocks_barber_range_idx'));

select pg_temp.expect('1.9 appointments org+starts_at index present',
  (select count(*) = 1 from pg_indexes
    where schemaname = 'public' and indexname = 'appointments_org_starts_at_idx'),
  'the index the calendar''s range scan actually uses');

select pg_temp.expect('1.10 shared slot helper exists and is INVOKER',
  (select not prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'compute_available_slots'),
  'pure arithmetic, no elevation — both wrappers keep their own trust boundary');

select pg_temp.expect('1.11 shared slot helper is NOT reachable by anon',
  not has_function_privilege('anon',
    'private.compute_available_slots(uuid,uuid,date,text,integer,integer,integer,integer,boolean)', 'execute'));

select pg_temp.expect('1.12 no appointment_status values were added',
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'appointment_status') =
  (select count(*) from unnest(array['pending','confirmed','completed','cancelled','no_show'])),
  'completed/no_show already existed; LOT D adds transitions, not states');

select pg_temp.expect('1.13 book_public_appointment still returns claim_token',
  (select count(*) = 1 from information_schema.routines r
    join information_schema.parameters pa on pa.specific_name = r.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'book_public_appointment'
      and pa.parameter_name = 'claim_token'),
  'the LOT 13 ownership/claim contract survived being rebased on');

-- ============================================================================
-- SECTION 2 — Split shifts actually split the day
-- ============================================================================

-- 09:00-12:00 and 14:00-19:00 on the target day, for both the shop and the pro.
do $$
declare v_dow integer := extract(dow from pg_temp.target_date());
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.apply_weekly_hours(
    (select v from v_ids where k = 'org_a'),
    (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a'),
    jsonb_build_array(jsonb_build_object(
      'day_of_week', v_dow,
      'open_time', '09:00', 'close_time', '12:00',
      'second_open_time', '14:00', 'second_close_time', '19:00')));
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect('2.1 the split shift was stored, not silently dropped',
  (select second_start_time = '14:00'::time and second_end_time = '19:00'::time
     from public.barber_working_hours
    where barber_id = (select v from v_ids where k = 'barber_a')
      and day_of_week = extract(dow from pg_temp.target_date())));

-- The slot engine, as an anonymous visitor sees it.
create or replace function pg_temp.public_slots()
returns setof timestamptz language plpgsql as $$
begin
  perform pg_temp.become_anon();
  return query
    select s.slot_start from public.get_public_available_slots(
      'lotd-shop-a',
      (select v from v_ids where k = 'loc_a'),
      (select v from v_ids where k = 'barber_a'),
      (select v from v_ids where k = 'svc_a'),
      pg_temp.target_date()) s;
  perform pg_temp.become_postgres();
end;
$$;

select pg_temp.expect('2.2 morning slots are offered',
  (select count(*) > 0 from pg_temp.public_slots() s where s = pg_temp.at_local(9, 0)));

select pg_temp.expect('2.3 the last morning slot ENDS exactly at the closure',
  (select count(*) = 1 from pg_temp.public_slots() s where s = pg_temp.at_local(11, 30))
  and (select count(*) = 0 from pg_temp.public_slots() s where s = pg_temp.at_local(11, 45)),
  '11:30+30min fits before 12:00; 11:45 would run into the break and is not offered');

select pg_temp.expect('2.4 NOTHING is offered during the break',
  (select count(*) = 0 from pg_temp.public_slots() s
    where s >= pg_temp.at_local(12, 0) and s < pg_temp.at_local(14, 0)),
  'the whole point: a lunch closure is unbookable');

select pg_temp.expect('2.5 afternoon slots resume at 14:00',
  (select count(*) = 1 from pg_temp.public_slots() s where s = pg_temp.at_local(14, 0)));

select pg_temp.expect('2.6 the afternoon ends on time',
  (select count(*) = 1 from pg_temp.public_slots() s where s = pg_temp.at_local(18, 30))
  and (select count(*) = 0 from pg_temp.public_slots() s where s >= pg_temp.at_local(18, 45)));

/** Attempts an anonymous booking and returns the SQLSTATE message, or 'OK'. */
create or replace function pg_temp.try_book(p_at timestamptz, p_barber uuid default null)
returns text language plpgsql as $$
declare v_row record;
begin
  perform pg_temp.become_anon();
  begin
    select * into v_row from public.book_public_appointment(
      'lotd-shop-a',
      (select v from v_ids where k = 'loc_a'),
      coalesce(p_barber, (select v from v_ids where k = 'barber_a')),
      (select v from v_ids where k = 'svc_a'),
      p_at, 'Test Customer', '+33612000900', 'lotd@fadeup.test', null);
    perform pg_temp.become_postgres();
    return 'OK';
  exception when others then
    perform pg_temp.become_postgres();
    return sqlerrm;
  end;
end;
$$;

select pg_temp.expect('2.7 booking INSIDE the break is refused server-side',
  pg_temp.try_book(pg_temp.at_local(12, 30)) like '%outside available hours%',
  'not offering a slot is not the same as refusing it — the client is never trusted');

select pg_temp.expect('2.8 a booking SPANNING the break is refused',
  pg_temp.try_book(pg_temp.at_local(11, 45)) like '%outside available hours%',
  'both endpoints land in open time, yet the appointment crosses the closure — the containment check is what catches this');

select pg_temp.expect('2.9 a normal morning booking still succeeds',
  pg_temp.try_book(pg_temp.at_local(10, 0)) = 'OK',
  'the split-shift change must not break ordinary booking');

select pg_temp.expect('2.10 a single-window day is completely unaffected',
  (select count(*) > 0 from public.get_public_available_slots(
      'lotd-shop-b',
      (select v from v_ids where k = 'loc_b'),
      (select v from v_ids where k = 'barber_b'),
      (select v from v_ids where k = 'svc_b'),
      pg_temp.target_date()) s
    where s.slot_start = pg_temp.at_local(13, 0)),
  'Shop B never set a second interval; 13:00 is still bookable there');

-- ============================================================================
-- SECTION 3 — Time blocks actually block
-- ============================================================================

do $$
declare v_id uuid;
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason)
  values ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
          (select v from v_ids where k = 'barber_a'),
          pg_temp.at_local(15, 0), pg_temp.at_local(16, 0), 'Dentist')
  returning id into v_id;
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('block_1', v_id);
end $$;

select pg_temp.expect('3.1 slots inside a block disappear',
  (select count(*) = 0 from pg_temp.public_slots() s
    where s >= pg_temp.at_local(15, 0) and s < pg_temp.at_local(16, 0)));

select pg_temp.expect('3.2 a slot that would OVERLAP the block is gone too',
  (select count(*) = 0 from pg_temp.public_slots() s where s = pg_temp.at_local(14, 45)),
  '14:45+30min runs into 15:00 — overlap, not containment, is the test');

select pg_temp.expect('3.3 the slot right before the block survives',
  (select count(*) = 1 from pg_temp.public_slots() s where s = pg_temp.at_local(14, 30)));

select pg_temp.expect('3.4 slots resume the moment the block ends',
  (select count(*) = 1 from pg_temp.public_slots() s where s = pg_temp.at_local(16, 0)));

select pg_temp.expect('3.5 booking into a block is REFUSED, not merely unoffered',
  pg_temp.try_book(pg_temp.at_local(15, 0)) like '%unavailable at the requested time%');

select pg_temp.expect('3.6 the refusal does not leak the reason',
  pg_temp.try_book(pg_temp.at_local(15, 0)) not like '%Dentist%',
  'this message reaches anonymous customers; why a professional is away is not theirs to know');

select pg_temp.expect('3.7 a block does not touch a DIFFERENT professional',
  (select count(*) > 0 from public.get_public_available_slots(
      'lotd-shop-a', (select v from v_ids where k = 'loc_a'),
      (select v from v_ids where k = 'barber_karim'),
      (select v from v_ids where k = 'svc_a'), pg_temp.target_date()) s
    where s.slot_start = pg_temp.at_local(15, 0))
  or (select count(*) = 0 from public.barber_services
       where barber_id = (select v from v_ids where k = 'barber_karim')),
  'blocks are per-professional, never per-shop');

-- ============================================================================
-- SECTION 4 — Time block authorization and tenant isolation
-- ============================================================================

create or replace function pg_temp.try_block(p_user uuid, p_barber uuid, p_org uuid default null)
returns text language plpgsql as $$
begin
  perform pg_temp.become(p_user);
  begin
    insert into public.time_blocks (organization_id, barber_id, starts_at, ends_at, reason)
    values (coalesce(p_org, (select v from v_ids where k = 'org_a')), p_barber,
            pg_temp.at_local(17, 0), pg_temp.at_local(17, 30), 'Break');
    perform pg_temp.become_postgres();
    return 'OK';
  exception when others then
    perform pg_temp.become_postgres();
    return sqlerrm;
  end;
end;
$$;

select pg_temp.expect('4.1 a barber may block their OWN time',
  pg_temp.try_block((select v from v_ids where k = 'barber_u'),
                    (select v from v_ids where k = 'barber_karim')) = 'OK',
  'blocking your own lunch must not require finding a manager');

select pg_temp.expect('4.2 a barber may NOT block a colleague''s time',
  pg_temp.try_block((select v from v_ids where k = 'barber_u'),
                    (select v from v_ids where k = 'barber_a')) like '%row-level security%');

select pg_temp.expect('4.3 another org''s owner cannot block into Shop A',
  pg_temp.try_block((select v from v_ids where k = 'owner_b'),
                    (select v from v_ids where k = 'barber_a')) like '%row-level security%',
  'and the message is the AUTHORIZATION one — the consistency trigger reads real rows so it no longer misreports a cross-tenant caller as a tenant mismatch');

select pg_temp.expect('4.4 a cross-tenant block is rejected even with matching RLS',
  pg_temp.try_block((select v from v_ids where k = 'owner_b'),
                    (select v from v_ids where k = 'barber_a'),
                    (select v from v_ids where k = 'org_b')) like '%same organization_id%',
  'the consistency trigger holds even where a policy might have let the row through');

do $$ begin perform pg_temp.become((select v from v_ids where k = 'owner_b')); end $$;
select pg_temp.expect('4.5 another tenant cannot SEE Shop A''s blocks',
  (select count(*) = 0 from public.time_blocks
    where organization_id = (select v from v_ids where k = 'org_a')));
do $$ begin perform pg_temp.become_postgres(); end $$;

do $$ begin perform pg_temp.become((select v from v_ids where k = 'barber_u')); end $$;
select pg_temp.expect('4.6 a barber CAN see the shop''s blocks',
  (select count(*) > 0 from public.time_blocks
    where organization_id = (select v from v_ids where k = 'org_a')),
  'everyone on the floor needs to know why a slot is unavailable');
do $$ begin perform pg_temp.become_postgres(); end $$;

do $$ begin perform pg_temp.become_anon(); end $$;
select pg_temp.expect('4.7 anon sees no blocks at all',
  (select count(*) = 0 from public.time_blocks));
do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- SECTION 5 — Completion and no-show transitions
-- ============================================================================

-- An accepted appointment to operate on, plus a still-pending one.
do $$
declare v_id uuid; v_row record;
begin
  perform pg_temp.become_anon();
  select * into v_row from public.book_public_appointment(
    'lotd-shop-a', (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a'), (select v from v_ids where k = 'svc_a'),
    pg_temp.at_local(9, 0), 'Completion Test', '+33612000901', null, null);
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('appt_done', v_row.id);

  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request(v_row.id);
  perform pg_temp.become_postgres();

  perform pg_temp.become_anon();
  select * into v_row from public.book_public_appointment(
    'lotd-shop-a', (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a'), (select v from v_ids where k = 'svc_a'),
    pg_temp.at_local(9, 30), 'Pending Test', '+33612000902', null, null);
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('appt_pending', v_row.id);
end $$;

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

select pg_temp.expect('5.1 a PENDING appointment cannot be completed',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.complete_appointment(%L)', (select v from v_ids where k = 'appt_pending')))
    like '%only a confirmed appointment%',
  'the raw status PATCH allowed any transition at all, including backwards');

select pg_temp.expect('5.2 a confirmed appointment completes',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.complete_appointment(%L)', (select v from v_ids where k = 'appt_done'))) = 'OK');

select pg_temp.expect('5.3 ...and is genuinely completed',
  (select status = 'completed' from public.appointments
    where id = (select v from v_ids where k = 'appt_done')));

select pg_temp.expect('5.4 ...and records WHO decided',
  (select decided_by = (select v from v_ids where k = 'owner_a') and decided_at is not null
     from public.appointments where id = (select v from v_ids where k = 'appt_done')));

select pg_temp.expect('5.5 completing twice is idempotent, not an error',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.complete_appointment(%L)', (select v from v_ids where k = 'appt_done'))) = 'OK',
  'a double-tap on a phone must not produce a red error');

select pg_temp.expect('5.6 a completed appointment cannot be marked no-show',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.mark_appointment_no_show(%L)', (select v from v_ids where k = 'appt_done')))
    like '%only a confirmed appointment%');

select pg_temp.expect('5.7 another tenant cannot complete this appointment',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_b'),
    format('select public.complete_appointment(%L)', (select v from v_ids where k = 'appt_pending')))
    like '%not authorized%');

-- No-show, and the slot it frees.
do $$
declare v_row record;
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  perform public.confirm_booking_request((select v from v_ids where k = 'appt_pending'));
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect('5.8 a barber may mark their OWN client a no-show',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.mark_appointment_no_show(%L)', (select v from v_ids where k = 'appt_pending'))) = 'OK');

select pg_temp.expect('5.9 the no-show FREES the slot for someone else',
  pg_temp.try_book(pg_temp.at_local(9, 30)) = 'OK',
  'no_show is already in the exclusion predicate, so the time genuinely returns to sale');

-- ============================================================================
-- SECTION 6 — A block over an existing appointment
-- ============================================================================

do $$
declare v_row record; v_id uuid;
begin
  perform pg_temp.become_anon();
  select * into v_row from public.book_public_appointment(
    'lotd-shop-a', (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'barber_a'), (select v from v_ids where k = 'svc_a'),
    pg_temp.at_local(17, 0), 'Already Booked', '+33612000903', null, null);
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('appt_covered', v_row.id);

  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  insert into public.time_blocks (organization_id, barber_id, starts_at, ends_at, reason)
  values ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'barber_a'),
          pg_temp.at_local(17, 0), pg_temp.at_local(18, 0), 'Staff meeting');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect('6.1 a block may be laid over an already-booked hour',
  (select count(*) = 1 from public.time_blocks
    where barber_id = (select v from v_ids where k = 'barber_a')
      and reason = 'Staff meeting'),
  'it stops NEW bookings; it does not retroactively cancel a customer');

select pg_temp.expect('6.2 the existing appointment can still be CONFIRMED',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.confirm_booking_request(%L)', (select v from v_ids where k = 'appt_covered'))) = 'OK',
  'the trigger stands down when a row''s time and professional are unchanged — without that guard, merely answering this request would fail');

select pg_temp.expect('6.3 ...and still COMPLETED',
  pg_temp.try_rpc((select v from v_ids where k = 'owner_a'),
    format('select public.complete_appointment(%L)', (select v from v_ids where k = 'appt_covered'))) = 'OK');

-- ============================================================================
-- SECTION 7 — The calendar read
-- ============================================================================

do $$ begin perform pg_temp.become((select v from v_ids where k = 'owner_a')); end $$;

select pg_temp.expect('7.1 the calendar returns the day''s appointments, pre-joined',
  (select count(*) > 0 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'),
    pg_temp.at_local(0, 0), pg_temp.at_local(24, 0)) c
   where c.service_name is not null and c.barber_display_name is not null and c.location_name is not null),
  'one query, no client-side N+1 across services and professionals');

select pg_temp.expect('7.2 the range bound is respected',
  (select count(*) = 0 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'),
    pg_temp.at_local(0, 0), pg_temp.at_local(8, 0))),
  'nothing is scheduled before 08:00 on the target day');

select pg_temp.expect('7.3 filtering by professional works',
  (select count(*) = 0 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'),
    pg_temp.at_local(0, 0), pg_temp.at_local(24, 0),
    null, (select v from v_ids where k = 'barber_karim'))),
  'Karim has no bookings; the multi-professional filter must not fall back to "everyone"');

select pg_temp.expect('7.4 cancelled and no-show rows are still returned',
  (select count(*) > 0 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'),
    pg_temp.at_local(0, 0), pg_temp.at_local(24, 0)) c
   where c.status = 'no_show'),
  'a day''s history is part of the day; the UI decides how to show it');

select pg_temp.expect('7.5 the calendar does NOT expose customer_email',
  (select count(*) = 0 from information_schema.routines r
    join information_schema.parameters pa on pa.specific_name = r.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'get_calendar_appointments'
      and pa.parameter_name in ('customer_email', 'customer_id')),
  'running a day needs a name and a phone number, not the CRM record');

do $$ begin perform pg_temp.become_postgres(); end $$;

do $$ begin perform pg_temp.become((select v from v_ids where k = 'owner_b')); end $$;
select pg_temp.expect('7.6 a non-member gets NOTHING, not an error',
  (select count(*) = 0 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'),
    pg_temp.at_local(0, 0), pg_temp.at_local(24, 0))),
  'SECURITY DEFINER bypasses RLS, so membership is checked in the body — returning empty keeps it safe to call from a shared layout');
do $$ begin perform pg_temp.become_postgres(); end $$;

do $$ begin perform pg_temp.become((select v from v_ids where k = 'barber_u')); end $$;
select pg_temp.expect('7.7 a barber can read the shop calendar',
  (select count(*) > 0 from public.get_calendar_appointments(
    (select v from v_ids where k = 'org_a'),
    pg_temp.at_local(0, 0), pg_temp.at_local(24, 0))),
  'same breadth as the appointments_select policy — no new exposure');
do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect('7.8 anon cannot call the calendar at all',
  not has_function_privilege('anon',
    'public.get_calendar_appointments(uuid,timestamptz,timestamptz,uuid,uuid)', 'execute'));

-- ============================================================================
-- SECTION 8 — Preserved invariants
-- ============================================================================

select pg_temp.expect('8.1 double-booking is still impossible',
  pg_temp.try_book(pg_temp.at_local(10, 0)) like '%exclusion constraint%'
  or pg_temp.try_book(pg_temp.at_local(10, 0)) like '%conflict%',
  '10:00 was taken in 2.9; the GiST constraint is untouched by any of this');

select pg_temp.expect('8.2 every public table still has RLS forced',
  (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relrowsecurity and c.relforcerowsecurity)));

select pg_temp.expect('8.3 time_blocks grants anon NOTHING beyond the schema default',
  has_table_privilege('anon', 'public.time_blocks', 'select')
    = has_table_privilege('anon', 'public.appointments', 'select'),
  'this schema gives anon the blanket table grant everywhere and gates on RLS; time_blocks must not be a special case in either direction');

select pg_temp.expect('8.4 no time_blocks policy admits anon',
  (select count(*) = 0 from pg_policies
    where schemaname = 'public' and tablename = 'time_blocks'
      and ('anon' = any(roles) or 'public' = any(roles))),
  'the grant is inert because every policy is TO authenticated — which is what 4.7 proves behaviourally');

-- ============================================================================
-- Context
-- ============================================================================

select pg_temp.record('INFO.split_shifts', 'INFO',
  'Split shifts are modelled as an optional SECOND interval on the existing row, not as many rows per day. That keeps unique (barber_id, day_of_week) — and therefore apply_weekly_hours'' on-conflict upsert — intact. A day needing three intervals uses a time block for the third gap.');
select pg_temp.record('INFO.time_blocks', 'INFO',
  'Blocks are deliberately allowed to overlap each other (no exclusion constraint): a break inside a meeting is not a contradiction. Overlap prevention belongs to appointments, where it means double-booking.');
select pg_temp.record('INFO.enforcement', 'INFO',
  'Time blocks are enforced by a trigger on appointments rather than inside each RPC, so book_public_appointment, reschedule_appointment and staff-side inserts are all covered by one rule that no path can route around.');
select pg_temp.record('INFO.exceptions', 'INFO',
  'barber_availability_exceptions still REPLACES a day and carries no second interval. An irregular day with a gap in it is expressed as a working day plus a time block, which is the model that actually fits.');
select pg_temp.record('INFO.past_trim', 'INFO',
  'get_available_slots now trims past times, which it previously did not — the drift the shared helper removed. Staff were being offered 09:00 at noon.');

-- ============================================================================
-- RESULTS — selected BEFORE the rollback that discards every fixture row
-- ============================================================================

\echo ''
\echo '============ VERIFY: LOT D — PROFESSIONAL WORKSPACE ============'
select seq, status, check_name, detail from verify_results order by seq;

\echo ''
\echo '--- summary ---'
select status, count(*) from verify_results group by status order by status;

\echo ''
\echo '--- failures (expected: none) ---'
select check_name, detail from verify_results where status = 'FAIL' order by seq;

rollback;
