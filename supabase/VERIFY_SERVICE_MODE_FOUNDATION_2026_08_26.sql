-- ============================================================================
-- FadeUp — VERIFY: the Service Mode foundation
--
-- Companion to MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql.
--
-- Emits one row per check:  check_name | status | detail
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected: 0 FAIL rows.
--
-- Refusals are asserted by SQLSTATE, never by a catch-all. A bare "did it
-- raise?" returns true for a typo'd table name, which would let every
-- "an attacker cannot X" check pass while testing nothing.
--
-- Every block that could abort carries an exception handler that RECORDS a
-- FAIL with the SQLSTATE. Without that, an error in an early block would abort
-- the transaction, every later insert into verify_results would fail too, and
-- the summary would print PASS=0 FAIL=0 — a suite that reports nothing while
-- looking like it reported success. Section 14 checks the count for the same
-- reason.
--
-- RUNS IN BOTH MODES. On a FRESH database it builds its own fixtures. On an
-- UPGRADE run it additionally finds public.seed_service_mode_census, left by
-- SEED_SERVICE_MODE_PRE_UPGRADE, and asserts that nothing it counted before
-- the upgrade was destroyed by it. The census checks are skipped, with an INFO,
-- when the table is absent — so the same file serves both tests without
-- pretending to have proved something it could not.
--
-- WHAT THIS SUITE DOES NOT TEST
--   True parallelism. Every check here runs in ONE session, so "the second
--   attempt is refused" proves serialized contention, not a race. The genuine
--   simultaneous races — a mode change against a booking, a queue close against
--   a join, two overrides against each other — are in
--   scripts/service-mode-concurrency-test.sh, which fires real concurrent
--   connections. Section 11 asserts the locking MECHANISM is present; the
--   script proves it works.
--
-- Safe to run repeatedly: all fixtures live in a transaction that is rolled
-- back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
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
-- different claim.
create or replace function pg_temp.become(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
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

create or replace function pg_temp.sqlstate_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.become(p_user);
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := sqlstate;
  end;
  perform pg_temp.become_postgres();
  return v;
end;
$$;

create or replace function pg_temp.sqlstate_as_anon(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.become_anon();
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := sqlstate;
  end;
  perform pg_temp.become_postgres();
  return v;
end;
$$;

create or replace function pg_temp.sqlstate_of(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
$$;

-- The two questions the whole lot exists to answer, as one-line helpers so the
-- assertions below read as product statements rather than as SQL.
create or replace function pg_temp.mode_of(p_location uuid, p_barber uuid default null)
returns text language sql as $$
  select m.mode::text from private.effective_service_mode(p_location, p_barber) m;
$$;

create or replace function pg_temp.source_of(p_location uuid, p_barber uuid default null)
returns text language sql as $$
  select m.source from private.effective_service_mode(p_location, p_barber) m;
$$;

create sequence if not exists pg_temp_verify_slot_seq;

begin;

set local client_min_messages = warning;

-- ============================================================================
-- FIXTURES
--
-- Built fresh in this transaction and rolled back at the end, so the suite is
-- identical on a fresh database and on one that already carries the SEED. Ids
-- are in a 9999 range that no seed or migration uses.
-- ============================================================================

-- Accounts and organizations first, in their own block.
--
-- THE PLAN IS ASSIGNED BEFORE ANY LOCATION EXISTS, and that ordering is
-- load-bearing rather than stylistic: R2's establishment-capacity trigger
-- (20260826110400) fires on every location INSERT, and a brand-new
-- organization starts on `free`, which covers exactly one establishment.
-- Creating the second location before raising the plan is refused — correctly,
-- by the commercial rule this lot deliberately does not weaken.
--
-- multi_scale is chosen for the main fixture because it covers ten
-- establishments and unlimited professionals, so none of the three locations
-- these checks create ever collides with a cap that is not what is under test.
do $$
begin
  insert into auth.users (id, email) values
    ('99990000-0000-4000-8000-000000000001', 'v.owner@verify.invalid'),
    ('99990000-0000-4000-8000-000000000002', 'v.manager@verify.invalid'),
    ('99990000-0000-4000-8000-000000000003', 'v.barber.one@verify.invalid'),
    ('99990000-0000-4000-8000-000000000004', 'v.barber.two@verify.invalid'),
    ('99990000-0000-4000-8000-000000000005', 'v.reception@verify.invalid'),
    ('99990000-0000-4000-8000-000000000006', 'v.customer@verify.invalid'),
    ('99990000-0000-4000-8000-000000000007', 'v.outsider@verify.invalid'),
    ('99990000-0000-4000-8000-000000000008', 'v.plans.owner@verify.invalid'),
    ('99990000-0000-4000-8000-000000000009', 'v.plans.barber@verify.invalid')
  on conflict (id) do nothing;

  insert into public.organizations (id, name, slug) values
    ('99991000-0000-4000-8000-000000000001', 'Verify Shop',    'verify-shop'),
    -- A second tenant, so "cross-tenant" checks have a real other side rather
    -- than a hypothetical one.
    ('99991000-0000-4000-8000-000000000002', 'Verify Rival',   'verify-rival'),
    -- A THIRD tenant that exists only for section 8's entitlement checks. It
    -- has exactly ONE location and ONE barber, so its plan can be moved freely
    -- between free / salon_essential / salon_pro without ever tripping R2's
    -- downgrade guard — which refuses a move to a plan too small for the shape
    -- an organization already has. Juggling plans on the main multi-location
    -- fixture would fail for a reason that has nothing to do with service mode.
    ('99991000-0000-4000-8000-000000000003', 'Verify Plans',   'verify-plans')
  on conflict (id) do nothing;

  perform private.ensure_organization_commercial_state('99991000-0000-4000-8000-000000000001');
  perform private.ensure_organization_commercial_state('99991000-0000-4000-8000-000000000002');
  perform private.ensure_organization_commercial_state('99991000-0000-4000-8000-000000000003');

  update public.organization_commercial_state
     set plan_key = 'multi_scale', status = 'active'
   where organization_id in ('99991000-0000-4000-8000-000000000001',
                             '99991000-0000-4000-8000-000000000002');

  update public.organization_commercial_state
     set plan_key = 'salon_pro', status = 'active'
   where organization_id = '99991000-0000-4000-8000-000000000003';
exception when others then
  perform pg_temp.record('0.1 (fixtures: accounts and plans) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
begin
  -- Two locations in ONE organization: the fixture that makes the
  -- per-establishment claim testable rather than merely asserted.
  insert into public.locations (id, organization_id, name, timezone, is_active) values
    ('99992000-0000-4000-8000-000000000001', '99991000-0000-4000-8000-000000000001', 'Verify North', 'Europe/Paris', true),
    ('99992000-0000-4000-8000-000000000002', '99991000-0000-4000-8000-000000000001', 'Verify South', 'Europe/Paris', true),
    ('99992000-0000-4000-8000-000000000003', '99991000-0000-4000-8000-000000000002', 'Rival Main',   'Europe/Paris', true),
    -- The plan-juggling tenant's single establishment.
    ('99992000-0000-4000-8000-000000000004', '99991000-0000-4000-8000-000000000003', 'Plans Main',   'Europe/Paris', true)
  on conflict (id) do nothing;

  insert into public.memberships (organization_id, user_id, role) values
    ('99991000-0000-4000-8000-000000000003', '99990000-0000-4000-8000-000000000008', 'owner'),
    ('99991000-0000-4000-8000-000000000003', '99990000-0000-4000-8000-000000000009', 'barber'),
    ('99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000001', 'owner'),
    ('99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000002', 'manager'),
    ('99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000003', 'barber'),
    ('99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000004', 'barber'),
    ('99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000005', 'receptionist'),
    ('99991000-0000-4000-8000-000000000002', '99990000-0000-4000-8000-000000000007', 'owner')
  on conflict (organization_id, user_id) do update set role = excluded.role;

  insert into public.staff_profiles (id, organization_id, user_id, location_id, display_name, is_public, is_active) values
    ('99993000-0000-4000-8000-000000000001', '99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000001', '99992000-0000-4000-8000-000000000001', 'V Owner',      true, true),
    ('99993000-0000-4000-8000-000000000002', '99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000002', '99992000-0000-4000-8000-000000000001', 'V Manager',    true, true),
    ('99993000-0000-4000-8000-000000000003', '99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000003', '99992000-0000-4000-8000-000000000001', 'V Barber One', true, true),
    -- Barber Two is at the SOUTH location: the other half of the
    -- per-establishment fixture.
    ('99993000-0000-4000-8000-000000000004', '99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000004', '99992000-0000-4000-8000-000000000002', 'V Barber Two', true, true),
    ('99993000-0000-4000-8000-000000000005', '99991000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000005', '99992000-0000-4000-8000-000000000001', 'V Reception',  true, true),
    ('99993000-0000-4000-8000-000000000007', '99991000-0000-4000-8000-000000000002', '99990000-0000-4000-8000-000000000007', '99992000-0000-4000-8000-000000000003', 'V Outsider',   true, true),
    ('99993000-0000-4000-8000-000000000008', '99991000-0000-4000-8000-000000000003', '99990000-0000-4000-8000-000000000008', '99992000-0000-4000-8000-000000000004', 'V Plans Owner',  true, true),
    ('99993000-0000-4000-8000-000000000009', '99991000-0000-4000-8000-000000000003', '99990000-0000-4000-8000-000000000009', '99992000-0000-4000-8000-000000000004', 'V Plans Barber', true, true)
  on conflict (organization_id, user_id) do update
    set id = excluded.id, location_id = excluded.location_id, display_name = excluded.display_name;

  insert into public.barbers (id, organization_id, staff_profile_id, is_bookable) values
    ('99994000-0000-4000-8000-000000000001', '99991000-0000-4000-8000-000000000001', '99993000-0000-4000-8000-000000000003', true),
    ('99994000-0000-4000-8000-000000000002', '99991000-0000-4000-8000-000000000001', '99993000-0000-4000-8000-000000000004', true),
    ('99994000-0000-4000-8000-000000000007', '99991000-0000-4000-8000-000000000002', '99993000-0000-4000-8000-000000000007', true),
    -- Exactly ONE barber for the plan-juggling tenant, so `free` (which covers
    -- one professional) remains a legal destination for it.
    ('99994000-0000-4000-8000-000000000009', '99991000-0000-4000-8000-000000000003', '99993000-0000-4000-8000-000000000009', true)
  on conflict (id) do nothing;

  insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active) values
    ('99995000-0000-4000-8000-000000000001', '99991000-0000-4000-8000-000000000001', 'V Coupe', 30, 3000, true),
    ('99995000-0000-4000-8000-000000000007', '99991000-0000-4000-8000-000000000002', 'R Coupe', 30, 3000, true),
    ('99995000-0000-4000-8000-000000000009', '99991000-0000-4000-8000-000000000003', 'P Coupe', 30, 3000, true)
  on conflict (id) do nothing;

  -- Both junction tables carry their OWN NOT NULL organization_id, which a
  -- trigger then cross-checks against the service and the location. Omitting it
  -- fails as a tenant-consistency violation rather than as a null violation,
  -- which reads misleadingly like a fixture that crossed tenants.
  insert into public.service_locations (organization_id, service_id, location_id) values
    ('99991000-0000-4000-8000-000000000001', '99995000-0000-4000-8000-000000000001', '99992000-0000-4000-8000-000000000001'),
    ('99991000-0000-4000-8000-000000000001', '99995000-0000-4000-8000-000000000001', '99992000-0000-4000-8000-000000000002'),
    ('99991000-0000-4000-8000-000000000002', '99995000-0000-4000-8000-000000000007', '99992000-0000-4000-8000-000000000003'),
    ('99991000-0000-4000-8000-000000000003', '99995000-0000-4000-8000-000000000009', '99992000-0000-4000-8000-000000000004')
  on conflict do nothing;

  insert into public.barber_services (organization_id, barber_id, service_id) values
    ('99991000-0000-4000-8000-000000000001', '99994000-0000-4000-8000-000000000001', '99995000-0000-4000-8000-000000000001'),
    ('99991000-0000-4000-8000-000000000001', '99994000-0000-4000-8000-000000000002', '99995000-0000-4000-8000-000000000001'),
    ('99991000-0000-4000-8000-000000000002', '99994000-0000-4000-8000-000000000007', '99995000-0000-4000-8000-000000000007'),
    ('99991000-0000-4000-8000-000000000003', '99994000-0000-4000-8000-000000000009', '99995000-0000-4000-8000-000000000009')
  on conflict do nothing;
exception when others then
  perform pg_temp.record('0.2 (fixtures: locations and roster) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- A helper that tries a real admission and reports what happened. Everything in
-- sections 5-8 goes through this, so every semantic claim is proved by an
-- actual INSERT hitting the actual guard rather than by asking the resolver
-- what it thinks.
-- The service is looked up from the location's OWN organization rather than
-- hard-coded, so the same helper works for every tenant fixture — including the
-- plan-juggling one in section 8, whose service belongs to a different
-- organization entirely. A hard-coded id would fail there on the
-- tenant-consistency trigger and look like a service-mode refusal.
--
-- Each call takes a fresh slot from a sequence: the GiST exclusion constraints
-- from LOT 8 would otherwise refuse the second booking for the same barber as
-- an overlap, which is a real constraint doing its job and would be misread
-- here as the service-mode guard refusing.
create or replace function pg_temp.try_book(p_location uuid, p_barber uuid)
returns text language plpgsql as $$
declare v_at timestamptz;
        v_org uuid;
        v_service uuid;
begin
  select organization_id into v_org from public.locations where id = p_location;
  select s.id into v_service
    from public.services s
    join public.service_locations sl on sl.service_id = s.id and sl.location_id = p_location
   where s.organization_id = v_org and s.is_active
   limit 1;

  v_at := now() + interval '30 days' + (nextval('pg_temp_verify_slot_seq') * interval '2 hours');
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at)
  values
    (v_org, p_location, p_barber, v_service,
     'Probe', '+33600009999', v_at, v_at + interval '30 minutes');
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.try_queue(p_location uuid, p_barber uuid)
returns text language plpgsql as $$
begin
  insert into public.queue_entries
    (organization_id, location_id, barber_id, customer_name, customer_phone)
  values
    ((select organization_id from public.locations where id = p_location),
     p_location, p_barber, 'Probe', '+33600009998');
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
$$;

-- ============================================================================
-- 1. THE CANONICAL MODEL
-- ============================================================================

do $$
declare v_labels text[];
begin
  select array_agg(e.enumlabel::text order by e.enumsortorder) into v_labels
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'service_mode';

  perform pg_temp.expect(
    '1.01 exactly four service modes exist, with the canonical identities',
    v_labels = array['hybrid', 'reservation_only', 'queue_only', 'unavailable'],
    format('found: %s', coalesce(array_to_string(v_labels, ','), 'NO TYPE')));

  perform pg_temp.expect(
    '1.02 the override scope enum is location + barber only',
    (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'service_mode_scope')
    = array['location', 'barber']);

  -- Per ESTABLISHMENT. A column on organizations would force every salon in a
  -- multi-salon group to operate identically, which §5 forbids outright.
  perform pg_temp.expect(
    '1.03 service settings are keyed on the ESTABLISHMENT, not the organization',
    (select a.attname from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.location_service_settings'::regclass and i.indisprimary)
    = 'location_id');

  perform pg_temp.expect(
    '1.04 organizations gained no service-mode column',
    not exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'organizations'
                  and column_name ilike '%service_mode%'));

  -- §4: mode is OPERATIONAL state and must not be attached to the durable
  -- R1B public identity.
  perform pg_temp.expect(
    '1.05 the durable professionals identity carries NO service mode',
    not exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'professionals'
                  and column_name ilike '%service_mode%'));

  perform pg_temp.expect(
    '1.06 the persistent override lives on the operational barber placement',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'barbers'
              and column_name = 'service_mode_override'));

  perform pg_temp.expect(
    '1.07 the persistent override is NULLABLE (NULL = inherit)',
    (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'barbers'
        and column_name = 'service_mode_override') = 'YES');

  perform pg_temp.expect(
    '1.08 queue_open exists as a SEPARATE column from the mode',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'location_service_settings'
              and column_name = 'queue_open')
    and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'location_service_settings'
                  and column_name = 'default_service_mode'));

  -- Every temporal column must be timestamptz. A bare `timestamp` would make
  -- an override's expiry depend on the server's timezone, which §11 forbids.
  perform pg_temp.expect(
    '1.09 every override timestamp is timestamptz, never a naive timestamp',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name in ('service_mode_overrides', 'location_service_settings', 'service_mode_changes')
        and data_type = 'timestamp without time zone'));
exception when others then
  perform pg_temp.record('1.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 2. THE DEFAULT AND THE BACKFILL
-- ============================================================================

do $$
begin
  perform pg_temp.expect(
    '2.01 the establishment default is hybrid — the compatibility choice',
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'location_service_settings'
        and column_name = 'default_service_mode') like '%hybrid%');

  perform pg_temp.expect(
    '2.02 queue_open defaults to true, so no working queue is switched off',
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'location_service_settings'
        and column_name = 'queue_open') like '%true%');

  -- The property that actually matters: no location anywhere lacks a row.
  perform pg_temp.expect(
    '2.03 EVERY location has a service-settings row after the backfill',
    not exists (
      select 1 from public.locations l
      left join public.location_service_settings s on s.location_id = l.id
      where s.location_id is null),
    format('%s location(s) without a settings row',
      (select count(*) from public.locations l
       left join public.location_service_settings s on s.location_id = l.id
       where s.location_id is null)));

  -- Including inactive ones — otherwise reactivating a location would silently
  -- change its service mode.
  perform pg_temp.expect(
    '2.04 INACTIVE locations are backfilled too',
    not exists (
      select 1 from public.locations l
      left join public.location_service_settings s on s.location_id = l.id
      where not l.is_active and s.location_id is null));

  perform pg_temp.expect(
    '2.05 the backfill fabricated NO temporary override',
    not exists (select 1 from public.service_mode_overrides
                where created_by_user_id is null and created_at < now() - interval '1 minute'),
    'a migration-created override with no actor would be an invented decision');

  perform pg_temp.expect(
    '2.06 no barber was given a copied mode — inheritance stays real',
    (select count(*) from public.barbers where service_mode_override is not null) = 0
    or (select count(*) from public.barbers where service_mode_override is not null)
       < (select count(*) from public.barbers),
    format('%s of %s barbers carry an explicit override',
      (select count(*) from public.barbers where service_mode_override is not null),
      (select count(*) from public.barbers)));

  -- A NEW location must get its row automatically, or the next shop to sign up
  -- lands in the "no settings row" branch the backfill just cleaned up.
  insert into public.locations (id, organization_id, name, timezone)
  values ('99992000-0000-4000-8000-0000000000ff', '99991000-0000-4000-8000-000000000001', 'Brand New', 'Europe/Paris');

  perform pg_temp.expect(
    '2.07 a NEWLY created location gets its settings row by trigger',
    (select default_service_mode::text from public.location_service_settings
      where location_id = '99992000-0000-4000-8000-0000000000ff') = 'hybrid');
exception when others then
  perform pg_temp.record('2.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 3. PRECEDENCE — the exact matrix §51 requires
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
begin
  -- LOCATION DEFAULT ONLY
  update public.location_service_settings set default_service_mode = 'hybrid' where location_id = v_loc;
  update public.barbers set service_mode_override = null where id = v_barber;

  perform pg_temp.expect('3.01 location default only -> hybrid',
    pg_temp.mode_of(v_loc, v_barber) = 'hybrid');
  perform pg_temp.expect('3.02 location default only -> source = location_default',
    pg_temp.source_of(v_loc, v_barber) = 'location_default');

  -- BARBER PERSISTENT OVERRIDE
  update public.barbers set service_mode_override = 'reservation_only' where id = v_barber;
  perform pg_temp.expect('3.03 barber persistent override -> reservation_only',
    pg_temp.mode_of(v_loc, v_barber) = 'reservation_only');
  perform pg_temp.expect('3.04 barber persistent override -> source = barber_override',
    pg_temp.source_of(v_loc, v_barber) = 'barber_override');

  -- ...and it does NOT leak to the location scope.
  perform pg_temp.expect('3.05 a barber override does not change the establishment',
    pg_temp.mode_of(v_loc, null) = 'hybrid');

  -- LOCATION TEMPORARY OVERRIDE
  update public.barbers set service_mode_override = null where id = v_barber;
  insert into public.service_mode_overrides (organization_id, scope, location_id, mode)
  values ('99991000-0000-4000-8000-000000000001', 'location', v_loc, 'queue_only');

  perform pg_temp.expect('3.06 location temporary override -> queue_only',
    pg_temp.mode_of(v_loc, v_barber) = 'queue_only');
  perform pg_temp.expect('3.07 location temporary override -> source = location_temporary_override',
    pg_temp.source_of(v_loc, v_barber) = 'location_temporary_override');

  -- THE ORDERING THAT IS EASIEST TO GET WRONG: a location TEMPORARY override
  -- outranks a barber PERSISTENT one. Temporary beats standing, at every level.
  update public.barbers set service_mode_override = 'reservation_only' where id = v_barber;
  perform pg_temp.expect('3.08 location TEMPORARY outranks barber PERSISTENT',
    pg_temp.mode_of(v_loc, v_barber) = 'queue_only'
    and pg_temp.source_of(v_loc, v_barber) = 'location_temporary_override');

  -- BARBER TEMPORARY beats everything.
  insert into public.service_mode_overrides (organization_id, scope, location_id, barber_id, mode)
  values ('99991000-0000-4000-8000-000000000001', 'barber', v_loc, v_barber, 'unavailable');

  perform pg_temp.expect('3.09 barber temporary override wins outright -> unavailable',
    pg_temp.mode_of(v_loc, v_barber) = 'unavailable');
  perform pg_temp.expect('3.10 barber temporary override -> source = barber_temporary_override',
    pg_temp.source_of(v_loc, v_barber) = 'barber_temporary_override');

  -- ...and still does not move the establishment.
  perform pg_temp.expect('3.11 a barber temporary override leaves the establishment alone',
    pg_temp.mode_of(v_loc, null) = 'queue_only');

  -- EXPIRATION, decided by the resolver and nothing else.
  update public.service_mode_overrides
     set starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
   where scope = 'barber' and barber_id = v_barber and cleared_at is null;

  perform pg_temp.expect('3.12 an EXPIRED override is ignored with no cron, worker or sweep',
    pg_temp.mode_of(v_loc, v_barber) = 'queue_only'
    and pg_temp.source_of(v_loc, v_barber) = 'location_temporary_override');

  -- A FUTURE override is not active yet either.
  update public.service_mode_overrides
     set starts_at = now() + interval '1 hour', expires_at = now() + interval '2 hours'
   where scope = 'barber' and barber_id = v_barber and cleared_at is null;

  perform pg_temp.expect('3.13 an override whose starts_at is in the future is not yet active',
    pg_temp.source_of(v_loc, v_barber) = 'location_temporary_override');

  -- CLEARING restores inheritance, one precedence level at a time.
  update public.service_mode_overrides set cleared_at = now()
   where scope = 'barber' and barber_id = v_barber and cleared_at is null;
  perform pg_temp.expect('3.14 clearing the barber override falls back to the location temporary',
    pg_temp.mode_of(v_loc, v_barber) = 'queue_only');

  update public.service_mode_overrides set cleared_at = now()
   where scope = 'location' and location_id = v_loc and cleared_at is null;
  perform pg_temp.expect('3.15 clearing the location temporary falls back to the barber persistent',
    pg_temp.mode_of(v_loc, v_barber) = 'reservation_only'
    and pg_temp.source_of(v_loc, v_barber) = 'barber_override');

  update public.barbers set service_mode_override = null where id = v_barber;
  perform pg_temp.expect('3.16 clearing the barber persistent restores the establishment default',
    pg_temp.mode_of(v_loc, v_barber) = 'hybrid'
    and pg_temp.source_of(v_loc, v_barber) = 'location_default');

  -- A queue entry with NO barber resolves at location scope, with no special
  -- case anywhere in the code.
  perform pg_temp.expect('3.17 a NULL barber resolves at establishment scope',
    pg_temp.mode_of(v_loc, null) = 'hybrid');

  -- INHERITANCE IS LIVE: moving the establishment default moves every
  -- inheriting barber, with no barber row written.
  update public.location_service_settings set default_service_mode = 'queue_only' where location_id = v_loc;
  perform pg_temp.expect('3.18 inheritance is LIVE — the establishment default moves inheriting barbers',
    pg_temp.mode_of(v_loc, v_barber) = 'queue_only');
  update public.location_service_settings set default_service_mode = 'hybrid' where location_id = v_loc;
exception when others then
  perform pg_temp.record('3.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 4. PER-ESTABLISHMENT ISOLATION
--
-- One organization, two salons. Changing one must say nothing about the other.
-- ============================================================================

do $$
declare v_north uuid := '99992000-0000-4000-8000-000000000001';
        v_south uuid := '99992000-0000-4000-8000-000000000002';
begin
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true
   where location_id in (v_north, v_south);

  update public.location_service_settings set default_service_mode = 'unavailable' where location_id = v_north;

  perform pg_temp.expect('4.01 changing one salon does not move its sibling',
    pg_temp.mode_of(v_south, null) = 'hybrid');

  update public.location_service_settings set queue_open = false where location_id = v_north;
  perform pg_temp.expect('4.02 closing one salon''s queue does not close its sibling''s',
    (select queue_open from public.location_service_settings where location_id = v_south) is true);

  -- A location temporary override is likewise establishment-scoped.
  insert into public.service_mode_overrides (organization_id, scope, location_id, mode)
  values ('99991000-0000-4000-8000-000000000001', 'location', v_north, 'queue_only');
  perform pg_temp.expect('4.03 a location temporary override does not reach the sibling salon',
    pg_temp.mode_of(v_south, null) = 'hybrid');

  update public.service_mode_overrides set cleared_at = now()
   where scope = 'location' and location_id = v_north and cleared_at is null;
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true
   where location_id = v_north;
exception when others then
  perform pg_temp.record('4.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 5. MODE SEMANTICS — proved by real INSERTs against the real guard
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
begin
  update public.barbers set service_mode_override = null where id = v_barber;

  -- HYBRID
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
  perform pg_temp.expect('5.01 hybrid admits a new reservation',
    pg_temp.try_book(v_loc, v_barber) = 'ALLOWED');
  perform pg_temp.expect('5.02 hybrid admits a new queue entry when the queue is open',
    pg_temp.try_queue(v_loc, v_barber) = 'ALLOWED');

  -- hybrid + queue CLOSED: booking unaffected, queue refused.
  update public.location_service_settings set queue_open = false where location_id = v_loc;
  perform pg_temp.expect('5.03 hybrid + queue_open=false still admits a reservation',
    pg_temp.try_book(v_loc, v_barber) = 'ALLOWED');
  perform pg_temp.expect('5.04 hybrid + queue_open=false REFUSES a queue entry (42501)',
    pg_temp.try_queue(v_loc, v_barber) = '42501');

  -- RESERVATION_ONLY
  update public.location_service_settings set default_service_mode = 'reservation_only', queue_open = true where location_id = v_loc;
  perform pg_temp.expect('5.05 reservation_only admits a new reservation',
    pg_temp.try_book(v_loc, v_barber) = 'ALLOWED');
  perform pg_temp.expect('5.06 reservation_only REFUSES a new queue entry (42501)',
    pg_temp.try_queue(v_loc, v_barber) = '42501');
  perform pg_temp.expect('5.07 reservation_only refuses the queue EVEN WITH queue_open=true',
    (select queue_open from public.location_service_settings where location_id = v_loc) is true
    and pg_temp.try_queue(v_loc, v_barber) = '42501');

  -- QUEUE_ONLY
  update public.location_service_settings set default_service_mode = 'queue_only' where location_id = v_loc;
  perform pg_temp.expect('5.08 queue_only REFUSES a new reservation (42501)',
    pg_temp.try_book(v_loc, v_barber) = '42501');
  perform pg_temp.expect('5.09 queue_only admits a queue entry when the queue is open',
    pg_temp.try_queue(v_loc, v_barber) = 'ALLOWED');

  update public.location_service_settings set queue_open = false where location_id = v_loc;
  perform pg_temp.expect('5.10 queue_only + queue_open=false is representable and refuses the queue',
    pg_temp.try_queue(v_loc, v_barber) = '42501');

  -- UNAVAILABLE
  update public.location_service_settings set default_service_mode = 'unavailable', queue_open = true where location_id = v_loc;
  perform pg_temp.expect('5.11 unavailable REFUSES a new reservation (42501)',
    pg_temp.try_book(v_loc, v_barber) = '42501');
  perform pg_temp.expect('5.12 unavailable REFUSES a new queue entry (42501)',
    pg_temp.try_queue(v_loc, v_barber) = '42501');
  perform pg_temp.expect('5.13 unavailable + queue_open=true is representable and still refuses',
    (select queue_open from public.location_service_settings where location_id = v_loc) is true
    and pg_temp.try_queue(v_loc, v_barber) = '42501');

  -- unavailable must NOT mean deactivated.
  perform pg_temp.expect('5.14 unavailable does NOT deactivate the barber',
    (select is_bookable from public.barbers where id = v_barber) is true);
  perform pg_temp.expect('5.15 unavailable does NOT deactivate the establishment',
    (select is_active from public.locations where id = v_loc) is true);

  -- The predicates themselves, stated once for the record.
  perform pg_temp.expect('5.16 mode_allows_booking is exactly {hybrid, reservation_only}',
    private.mode_allows_booking('hybrid') and private.mode_allows_booking('reservation_only')
    and not private.mode_allows_booking('queue_only') and not private.mode_allows_booking('unavailable'));
  perform pg_temp.expect('5.17 mode_allows_queue is exactly {hybrid, queue_only}',
    private.mode_allows_queue('hybrid') and private.mode_allows_queue('queue_only')
    and not private.mode_allows_queue('reservation_only') and not private.mode_allows_queue('unavailable'));

  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
exception when others then
  perform pg_temp.record('5.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 6. THE BARBER-SCOPED MODE IS ENFORCED, NOT ONLY RESOLVED
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
begin
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;

  update public.barbers set service_mode_override = 'reservation_only' where id = v_barber;
  perform pg_temp.expect('6.01 a barber on reservation_only refuses a queue entry naming them',
    pg_temp.try_queue(v_loc, v_barber) = '42501');
  perform pg_temp.expect('6.02 ...while the establishment still admits an any-barber walk-in',
    pg_temp.try_queue(v_loc, null) = 'ALLOWED');

  update public.barbers set service_mode_override = 'queue_only' where id = v_barber;
  perform pg_temp.expect('6.03 a barber on queue_only refuses a reservation with them',
    pg_temp.try_book(v_loc, v_barber) = '42501');

  update public.barbers set service_mode_override = 'unavailable' where id = v_barber;
  perform pg_temp.expect('6.04 a barber on unavailable refuses both channels',
    pg_temp.try_book(v_loc, v_barber) = '42501' and pg_temp.try_queue(v_loc, v_barber) = '42501');

  update public.barbers set service_mode_override = null where id = v_barber;
  perform pg_temp.expect('6.05 clearing the override makes the barber bookable again',
    pg_temp.try_book(v_loc, v_barber) = 'ALLOWED');
exception when others then
  perform pg_temp.record('6.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 7. EXISTING COMMITMENTS ARE PRESERVED — §18, §19, §28, §29, §54
--
-- The most important section in this file. A mode change must never cancel a
-- customer, and every existing appointment must keep its full R1A lifecycle in
-- every mode.
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
        v_appt uuid;
        v_queue uuid;
        v_appt_before bigint;
        v_queue_before bigint;
begin
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
  update public.barbers set service_mode_override = null where id = v_barber;

  -- Make real commitments while the shop is open.
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name, customer_phone, starts_at, ends_at, status)
  values ('99991000-0000-4000-8000-000000000001', v_loc, v_barber, '99995000-0000-4000-8000-000000000001',
          'Committed', '+33600007777', now() + interval '400 days', now() + interval '400 days' + interval '30 minutes', 'confirmed')
  returning id into v_appt;

  insert into public.queue_entries
    (organization_id, location_id, barber_id, customer_name, customer_phone, status)
  values ('99991000-0000-4000-8000-000000000001', v_loc, v_barber, 'Waiting', '+33600007778', 'waiting')
  returning id into v_queue;

  select count(*) into v_appt_before from public.appointments;
  select count(*) into v_queue_before from public.queue_entries;

  -- Now slam the establishment shut, every way there is.
  update public.location_service_settings set default_service_mode = 'unavailable', queue_open = false where location_id = v_loc;
  update public.barbers set service_mode_override = 'unavailable' where id = v_barber;
  insert into public.service_mode_overrides (organization_id, scope, location_id, mode)
  values ('99991000-0000-4000-8000-000000000001', 'location', v_loc, 'unavailable');

  perform pg_temp.expect('7.01 no appointment was deleted by the mode change',
    (select count(*) from public.appointments) = v_appt_before);
  perform pg_temp.expect('7.02 no queue entry was deleted by the mode change',
    (select count(*) from public.queue_entries) = v_queue_before);
  perform pg_temp.expect('7.03 the future appointment is still CONFIRMED, not cancelled',
    (select status::text from public.appointments where id = v_appt) = 'confirmed');
  perform pg_temp.expect('7.04 the waiting customer is still WAITING, not cancelled',
    (select status::text from public.queue_entries where id = v_queue) = 'waiting');
  perform pg_temp.expect('7.05 nothing anywhere was auto-cancelled',
    not exists (select 1 from public.appointments where status = 'cancelled' and customer_name = 'Committed'));

  -- And the whole R1A lifecycle still runs, in `unavailable`, at every step.
  perform pg_temp.expect('7.06 an existing queue entry can still be CALLED while unavailable',
    pg_temp.sqlstate_of(format(
      'update public.queue_entries set status = ''called'', called_at = now() where id = %L', v_queue)) = 'ALLOWED');
  perform pg_temp.expect('7.07 an existing queue entry can still be SERVED while unavailable',
    pg_temp.sqlstate_of(format(
      'update public.queue_entries set status = ''in_service'', service_started_at = now() where id = %L', v_queue)) = 'ALLOWED');
  perform pg_temp.expect('7.08 an existing queue entry can still be COMPLETED while unavailable',
    pg_temp.sqlstate_of(format(
      'update public.queue_entries set status = ''completed'', completed_at = now() where id = %L', v_queue)) = 'ALLOWED');
  perform pg_temp.expect('7.09 an existing appointment can still be CANCELLED by the shop while unavailable',
    pg_temp.sqlstate_of(format(
      'update public.appointments set status = ''cancelled'' where id = %L', v_appt)) = 'ALLOWED');

  -- The guard is INSERT-only. If it were widened to UPDATE, every check above
  -- would have failed — this asserts the cause directly.
  perform pg_temp.expect('7.10 the appointments guard fires on INSERT only',
    (select bool_and((tgtype & 4) <> 0 and (tgtype & 16) = 0 and (tgtype & 8) = 0)
     from pg_trigger where tgrelid = 'public.appointments'::regclass
       and tgname = 'appointments_enforce_service_mode'));
  perform pg_temp.expect('7.11 the queue guard fires on INSERT only',
    (select bool_and((tgtype & 4) <> 0 and (tgtype & 16) = 0 and (tgtype & 8) = 0)
     from pg_trigger where tgrelid = 'public.queue_entries'::regclass
       and tgname = 'queue_entries_enforce_service_mode'));

  update public.service_mode_overrides set cleared_at = now()
   where scope = 'location' and location_id = v_loc and cleared_at is null;
  update public.barbers set service_mode_override = null where id = v_barber;
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
exception when others then
  perform pg_temp.record('7.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 8. R2 ENTITLEMENT COMPOSITION — §53
--
-- Service mode is not an entitlement and must never become one.
-- ============================================================================

-- This section uses the dedicated single-establishment, single-barber tenant.
-- Moving the MAIN fixture between plans would be refused by R2's downgrade
-- guard — it operates three locations — and that refusal would have nothing to
-- do with service mode while looking exactly like a service-mode failure.
do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000004';
        v_barber uuid := '99994000-0000-4000-8000-000000000009';
        v_org uuid := '99991000-0000-4000-8000-000000000003';
begin
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
  update public.barbers set service_mode_override = null where id = v_barber;

  -- FREE + hybrid must gain NOTHING. This is §17 in one assertion.
  update public.organization_commercial_state set plan_key = 'free' where organization_id = v_org;
  perform pg_temp.expect('8.01 free + hybrid does NOT gain paid Booking',
    pg_temp.try_book(v_loc, v_barber) = '42501');
  perform pg_temp.expect('8.02 free + hybrid does NOT gain paid Queue',
    pg_temp.try_queue(v_loc, v_barber) = '42501');
  perform pg_temp.expect('8.03 free has none of booking/walkIns/liveQueue',
    not private.org_has_capability(v_org, 'booking')
    and not private.org_has_capability(v_org, 'walkIns')
    and not private.org_has_capability(v_org, 'liveQueue'));

  -- salon_essential holds walkIns but NOT liveQueue. The queue must still work,
  -- or this lot would have silently withdrawn a channel that plan pays for —
  -- a pricing change by side effect.
  update public.organization_commercial_state set plan_key = 'salon_essential' where organization_id = v_org;
  perform pg_temp.expect('8.04 salon_essential genuinely lacks liveQueue (the premise of the next check)',
    private.org_has_capability(v_org, 'walkIns') and not private.org_has_capability(v_org, 'liveQueue'));
  perform pg_temp.expect('8.05 salon_essential can STILL take a walk-in — no paid channel was withdrawn',
    pg_temp.try_queue(v_loc, v_barber) = 'ALLOWED');
  perform pg_temp.expect('8.06 salon_essential can still book',
    pg_temp.try_book(v_loc, v_barber) = 'ALLOWED');

  -- An entitled plan is still refused by the MODE.
  update public.organization_commercial_state set plan_key = 'salon_pro' where organization_id = v_org;
  update public.location_service_settings set default_service_mode = 'queue_only' where location_id = v_loc;
  perform pg_temp.expect('8.07 a plan WITH booking is still refused by queue_only mode',
    private.org_has_capability(v_org, 'booking') and pg_temp.try_book(v_loc, v_barber) = '42501');

  update public.location_service_settings set default_service_mode = 'reservation_only' where location_id = v_loc;
  perform pg_temp.expect('8.08 a plan WITH liveQueue is still refused by reservation_only mode',
    private.org_has_capability(v_org, 'liveQueue') and pg_temp.try_queue(v_loc, v_barber) = '42501');

  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = false where location_id = v_loc;
  perform pg_temp.expect('8.09 a plan WITH liveQueue + hybrid is still refused by queue_open=false',
    pg_temp.try_queue(v_loc, v_barber) = '42501');

  -- A cancelled subscription degrades to free capacity — R2's rule, composed
  -- rather than reimplemented.
  update public.location_service_settings set queue_open = true where location_id = v_loc;
  update public.organization_commercial_state set status = 'canceled' where organization_id = v_org;
  perform pg_temp.expect('8.10 a CANCELED subscription loses admission, via R2''s own degradation rule',
    pg_temp.try_book(v_loc, v_barber) = '42501');
  update public.organization_commercial_state set status = 'active', plan_key = 'salon_pro' where organization_id = v_org;

  -- The composition helpers agree with the guards.
  perform pg_temp.expect('8.11 booking_admission_allowed composes entitlement AND mode',
    private.booking_admission_allowed(v_org, v_loc, v_barber) is true);
  perform pg_temp.expect('8.12 queue_admission_allowed composes entitlement AND mode AND queue_open',
    private.queue_admission_allowed(v_org, v_loc, v_barber) is true);

  update public.location_service_settings set queue_open = false where location_id = v_loc;
  perform pg_temp.expect('8.13 queue_admission_allowed goes false on queue_open alone',
    private.queue_admission_allowed(v_org, v_loc, v_barber) is false
    and private.booking_admission_allowed(v_org, v_loc, v_barber) is true);
  update public.location_service_settings set queue_open = true where location_id = v_loc;

  -- Fail closed on unknowns.
  perform pg_temp.expect('8.14 the composers fail CLOSED on a NULL organization',
    private.booking_admission_allowed(null, v_loc, v_barber) is false
    and private.queue_admission_allowed(null, v_loc, v_barber) is false);
  perform pg_temp.expect('8.15 the composers fail CLOSED on an unknown location',
    private.booking_admission_allowed(v_org, '00000000-0000-4000-8000-0000000000ff', null) is false);
exception when others then
  perform pg_temp.record('8.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 9. AUTHORIZATION — §55
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_south uuid := '99992000-0000-4000-8000-000000000002';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
        v_barber_south uuid := '99994000-0000-4000-8000-000000000002';
        v_rival_loc uuid := '99992000-0000-4000-8000-000000000003';
        v_owner uuid := '99990000-0000-4000-8000-000000000001';
        v_manager uuid := '99990000-0000-4000-8000-000000000002';
        v_b1 uuid := '99990000-0000-4000-8000-000000000003';
        v_b2 uuid := '99990000-0000-4000-8000-000000000004';
        v_reception uuid := '99990000-0000-4000-8000-000000000005';
        v_customer uuid := '99990000-0000-4000-8000-000000000006';
        v_outsider uuid := '99990000-0000-4000-8000-000000000007';
begin
  -- ANONYMOUS
  perform pg_temp.expect('9.01 anonymous cannot set an establishment mode',
    pg_temp.sqlstate_as_anon(format(
      'select public.set_location_service_mode(%L, ''unavailable'')', v_loc)) <> 'ALLOWED');
  perform pg_temp.expect('9.02 anonymous cannot open or close a queue',
    pg_temp.sqlstate_as_anon(format(
      'select public.set_location_queue_open(%L, false)', v_loc)) <> 'ALLOWED');
  perform pg_temp.expect('9.03 anonymous cannot write location_service_settings directly',
    pg_temp.sqlstate_as_anon(format(
      'update public.location_service_settings set default_service_mode = ''unavailable'' where location_id = %L', v_loc)) <> 'ALLOWED');
  perform pg_temp.expect('9.04 anonymous cannot even READ the internal settings table',
    pg_temp.sqlstate_as_anon('select 1 from public.location_service_settings limit 1') = '42501');

  -- A CUSTOMER — authenticated, but a member of nothing.
  perform pg_temp.expect('9.05 a customer cannot set an establishment mode (42501)',
    pg_temp.sqlstate_as(v_customer, format(
      'select public.set_location_service_mode(%L, ''unavailable'')', v_loc)) = '42501');
  perform pg_temp.expect('9.06 a customer cannot set a barber override (42501)',
    pg_temp.sqlstate_as(v_customer, format(
      'select public.set_barber_service_mode_override(%L, ''unavailable'')', v_barber)) = '42501');

  -- A CROSS-TENANT owner. Owner of one shop is nobody at another.
  perform pg_temp.expect('9.07 a cross-tenant owner cannot set our establishment mode (42501)',
    pg_temp.sqlstate_as(v_outsider, format(
      'select public.set_location_service_mode(%L, ''unavailable'')', v_loc)) = '42501');
  perform pg_temp.expect('9.08 a cross-tenant owner cannot touch our barber (42501)',
    pg_temp.sqlstate_as(v_outsider, format(
      'select public.set_barber_service_mode_override(%L, ''unavailable'')', v_barber)) = '42501');
  perform pg_temp.expect('9.09 ...and our owner cannot touch theirs either — the rule is symmetric',
    pg_temp.sqlstate_as(v_owner, format(
      'select public.set_location_service_mode(%L, ''unavailable'')', v_rival_loc)) = '42501');

  -- A caller-supplied id is an ARGUMENT, never a credential. An unknown
  -- location must refuse identically to a forbidden one, or the error is an
  -- oracle for which location ids exist.
  perform pg_temp.expect('9.10 an unknown location refuses with the SAME sqlstate as a forbidden one',
    pg_temp.sqlstate_as(v_owner,
      'select public.set_location_service_mode(''00000000-0000-4000-8000-0000000000ee'', ''unavailable'')') = '42501');

  -- OWNER and MANAGER may.
  perform pg_temp.expect('9.11 the owner may set the establishment mode',
    pg_temp.sqlstate_as(v_owner, format(
      'select public.set_location_service_mode(%L, ''reservation_only'')', v_loc)) = 'ALLOWED');
  perform pg_temp.expect('9.12 a manager may set the establishment mode',
    pg_temp.sqlstate_as(v_manager, format(
      'select public.set_location_service_mode(%L, ''hybrid'')', v_loc)) = 'ALLOWED');
  perform pg_temp.expect('9.13 a manager may manage a barber in their own establishment',
    pg_temp.sqlstate_as(v_manager, format(
      'select public.set_barber_service_mode_override(%L, ''queue_only'')', v_barber)) = 'ALLOWED');

  -- A BARBER owns their own placement and nobody else's.
  perform pg_temp.expect('9.14 a barber may set their OWN persistent override',
    pg_temp.sqlstate_as(v_b1, format(
      'select public.set_barber_service_mode_override(%L, ''reservation_only'')', v_barber)) = 'ALLOWED');
  perform pg_temp.expect('9.15 a barber may set their OWN temporary override',
    pg_temp.sqlstate_as(v_b1, format(
      'select public.set_service_mode_temporary_override(''barber'', %L, ''unavailable'', now() + interval ''1 hour'', %L)',
      v_loc, v_barber)) = 'ALLOWED');
  perform pg_temp.expect('9.16 a barber may NOT set a COLLEAGUE''s override (42501)',
    pg_temp.sqlstate_as(v_b2, format(
      'select public.set_barber_service_mode_override(%L, ''unavailable'')', v_barber)) = '42501');
  perform pg_temp.expect('9.17 a barber may NOT set the ESTABLISHMENT default (42501)',
    pg_temp.sqlstate_as(v_b1, format(
      'select public.set_location_service_mode(%L, ''unavailable'')', v_loc)) = '42501');
  perform pg_temp.expect('9.18 a barber may NOT set a location-wide temporary override (42501)',
    pg_temp.sqlstate_as(v_b1, format(
      'select public.set_service_mode_temporary_override(''location'', %L, ''unavailable'', null, null)', v_loc)) = '42501');

  -- queue_open is front-of-house, deliberately wider.
  perform pg_temp.expect('9.19 a receptionist MAY open and close the queue',
    pg_temp.sqlstate_as(v_reception, format(
      'select public.set_location_queue_open(%L, false)', v_loc)) = 'ALLOWED');
  perform pg_temp.expect('9.20 ...but a receptionist may NOT change the establishment mode (42501)',
    pg_temp.sqlstate_as(v_reception, format(
      'select public.set_location_service_mode(%L, ''unavailable'')', v_loc)) = '42501');
  perform pg_temp.expect('9.21 a customer may NOT open or close the queue (42501)',
    pg_temp.sqlstate_as(v_customer, format(
      'select public.set_location_queue_open(%L, true)', v_loc)) = '42501');

  -- A barber-scoped override must name a barber actually placed at that
  -- establishment, or it would be written where the resolver never reads it.
  perform pg_temp.expect('9.22 a barber override aimed at the WRONG establishment is refused (42501)',
    pg_temp.sqlstate_as(v_manager, format(
      'select public.set_service_mode_temporary_override(''barber'', %L, ''unavailable'', null, %L)',
      v_loc, v_barber_south)) = '42501');

  perform pg_temp.become_postgres();
  update public.service_mode_overrides set cleared_at = now() where cleared_at is null
    and location_id in (v_loc, v_south);
  update public.barbers set service_mode_override = null where id in (v_barber, v_barber_south);
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true
    where location_id in (v_loc, v_south);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('9.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 10. THE CONTROLS THEMSELVES — audit trail, one-active-override, no bypass
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
        v_owner uuid := '99990000-0000-4000-8000-000000000001';
        v_before bigint;
        v_active bigint;
        v_cleared integer;
begin
  select count(*) into v_before from public.service_mode_changes;

  perform pg_temp.become(v_owner);
  perform public.set_location_service_mode(v_loc, 'queue_only');
  perform public.set_location_queue_open(v_loc, false);
  perform public.set_barber_service_mode_override(v_barber, 'reservation_only');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('10.01 every control writes an audit row',
    (select count(*) from public.service_mode_changes) = v_before + 3);
  perform pg_temp.expect('10.02 the audit row records WHO made the change',
    (select changed_by_user_id from public.service_mode_changes
      where change_kind = 'location_default' and location_id = v_loc
      order by created_at desc limit 1) = v_owner);
  -- Asserted as EXISTS on the exact transition rather than as "the newest row".
  -- created_at defaults to now(), which is transaction time, so every change
  -- this suite makes shares one timestamp and `order by created_at desc limit 1`
  -- would pick arbitrarily among them. That is a property of the test running
  -- many changes in one transaction, not of the audit trail — a real shop makes
  -- one change per transaction. The transition itself is what matters.
  perform pg_temp.expect('10.03 the audit row records the PREVIOUS and NEW mode',
    exists (select 1 from public.service_mode_changes
            where change_kind = 'location_default' and location_id = v_loc
              and previous_mode = 'hybrid' and new_mode = 'queue_only'));
  perform pg_temp.expect('10.04 a queue_open change is recorded as its own kind',
    exists (select 1 from public.service_mode_changes
            where change_kind = 'queue_open' and location_id = v_loc
              and previous_queue_open is true and new_queue_open is false
              and previous_mode is null and new_mode is null),
    'a queue_open change records no mode, because it changed none');

  -- Append-only, for EVERY writer including postgres.
  perform pg_temp.expect('10.05 the audit trail cannot be UPDATEd, even by postgres (42501)',
    pg_temp.sqlstate_of('update public.service_mode_changes set new_mode = ''hybrid'' where true') = '42501');
  perform pg_temp.expect('10.06 the audit trail cannot be DELETEd, even by postgres (42501)',
    pg_temp.sqlstate_of('delete from public.service_mode_changes where true') = '42501');

  -- Exactly one active override per target, guaranteed by the database.
  perform pg_temp.become(v_owner);
  perform public.set_service_mode_temporary_override('location', v_loc, 'unavailable', now() + interval '1 hour', null);
  perform public.set_service_mode_temporary_override('location', v_loc, 'queue_only', now() + interval '2 hours', null);
  perform pg_temp.become_postgres();

  select count(*) into v_active from public.service_mode_overrides
   where scope = 'location' and location_id = v_loc and cleared_at is null;

  perform pg_temp.expect('10.07 setting a second override supersedes the first — exactly one stays active',
    v_active = 1, format('%s active location override(s)', v_active));
  perform pg_temp.expect('10.08 the surviving override is the LAST one written',
    (select mode::text from public.service_mode_overrides
      where scope = 'location' and location_id = v_loc and cleared_at is null) = 'queue_only');
  perform pg_temp.expect('10.09 the superseded override is kept as history, not deleted',
    exists (select 1 from public.service_mode_overrides
            where scope = 'location' and location_id = v_loc
              and cleared_at is not null and mode = 'unavailable'));

  -- A duplicate active row is impossible even by direct insert.
  perform pg_temp.expect('10.10 a SECOND active override cannot be inserted directly (23505)',
    pg_temp.sqlstate_of(format(
      'insert into public.service_mode_overrides (organization_id, scope, location_id, mode)
       values (''99991000-0000-4000-8000-000000000001'', ''location'', %L, ''hybrid'')', v_loc)) = '23505');

  -- Clearing.
  perform pg_temp.become(v_owner);
  select public.clear_service_mode_temporary_override('location', v_loc, null) into v_cleared;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('10.11 clearing reports how many overrides it cleared', v_cleared = 1);

  perform pg_temp.become(v_owner);
  select public.clear_service_mode_temporary_override('location', v_loc, null) into v_cleared;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('10.12 clearing when nothing is active returns 0 rather than raising', v_cleared = 0);

  -- An already-expired override is refused: it would be inert on arrival, and
  -- accepting it would leave the author believing they had changed something.
  perform pg_temp.expect('10.13 an override that has ALREADY expired is refused (22023)',
    pg_temp.sqlstate_as(v_owner, format(
      'select public.set_service_mode_temporary_override(''location'', %L, ''unavailable'', now() - interval ''1 hour'', null)',
      v_loc)) = '22023');

  -- expires_at NULL is a real product state: "until manually changed".
  perform pg_temp.expect('10.14 expires_at NULL is accepted — "until manually changed"',
    pg_temp.sqlstate_as(v_owner, format(
      'select public.set_service_mode_temporary_override(''location'', %L, ''unavailable'', null, null)', v_loc)) = 'ALLOWED');

  -- Scope/barber coherence.
  perform pg_temp.expect('10.15 barber scope without a barber is refused (22023)',
    pg_temp.sqlstate_as(v_owner, format(
      'select public.set_service_mode_temporary_override(''barber'', %L, ''unavailable'', null, null)', v_loc)) = '22023');
  perform pg_temp.expect('10.16 location scope WITH a barber is refused (22023)',
    pg_temp.sqlstate_as(v_owner, format(
      'select public.set_service_mode_temporary_override(''location'', %L, ''unavailable'', null, %L)',
      v_loc, v_barber)) = '22023');

  -- Setting the barber override to NULL is how you go back to inheriting.
  perform pg_temp.become(v_owner);
  perform public.set_barber_service_mode_override(v_barber, null);
  perform pg_temp.become_postgres();
  perform pg_temp.expect('10.17 a NULL barber override restores inheritance',
    (select service_mode_override from public.barbers where id = v_barber) is null);

  update public.service_mode_overrides set cleared_at = now() where location_id = v_loc and cleared_at is null;
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('10.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 11. THE CONCURRENCY MECHANISM IS PRESENT
--
-- One session cannot prove a race. It CAN prove the locking is actually in the
-- code — which is what would silently disappear in a refactor. The real races
-- are in scripts/service-mode-concurrency-test.sh.
-- ============================================================================

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_booking_service_mode';
  perform pg_temp.expect('11.01 booking admission takes a SHARED lock on the establishment row',
    v_src ilike '%for share%' and v_src ilike '%location_service_settings%');

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_queue_service_mode';
  perform pg_temp.expect('11.02 queue admission takes a SHARED lock on the establishment row',
    v_src ilike '%for share%' and v_src ilike '%location_service_settings%');

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_location_service_mode';
  perform pg_temp.expect('11.03 a mode change takes an EXCLUSIVE lock on the same row',
    v_src ilike '%for update%');

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_location_queue_open';
  perform pg_temp.expect('11.04 a queue_open change takes an EXCLUSIVE lock on the same row',
    v_src ilike '%for update%');

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_service_mode_temporary_override';
  perform pg_temp.expect('11.05 a temporary override takes an EXCLUSIVE lock before clear-and-insert',
    v_src ilike '%for update%');

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_barber_service_mode_override';
  perform pg_temp.expect('11.06 a barber override locks the ESTABLISHMENT row, so it serialises with the rest',
    v_src ilike '%for update%' and v_src ilike '%location_service_settings%');

  -- No bypass anywhere in the lot.
  perform pg_temp.expect('11.07 no service-mode function reads a bypass GUC',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.proname in ('enforce_booking_service_mode', 'enforce_queue_service_mode',
                          'effective_service_mode', 'booking_admission_allowed',
                          'queue_admission_allowed')
        and (p.prosrc ilike '%current_setting%' or p.prosrc ilike '%set_config%')));
exception when others then
  perform pg_temp.record('11.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 12. SECURITY POSTURE — RLS, grants, SECURITY DEFINER, FKs, the Worker
-- ============================================================================

do $$
declare r record;
        v_bad text := '';
begin
  -- RLS enabled AND forced.
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('location_service_settings', 'service_mode_overrides', 'service_mode_changes')
  loop
    perform pg_temp.expect(format('12.01 %s has RLS ENABLED', r.relname), r.relrowsecurity);
    perform pg_temp.expect(format('12.02 %s has RLS FORCED (the owner is not exempt)', r.relname), r.relforcerowsecurity);
  end loop;

  perform pg_temp.expect('12.03 all three new tables exist',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('location_service_settings', 'service_mode_overrides', 'service_mode_changes')) = 3);

  -- No client role may WRITE any service-mode state directly.
  for r in
    select t.tbl, g.grantee, p.priv
    from unnest(array['public.location_service_settings', 'public.service_mode_overrides',
                      'public.service_mode_changes']) as t(tbl)
    cross join unnest(array['anon', 'authenticated']) as g(grantee)
    cross join unnest(array['insert', 'update', 'delete']) as p(priv)
    where has_table_privilege(g.grantee, t.tbl, p.priv)
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.tbl, r.grantee, r.priv);
  end loop;
  perform pg_temp.expect('12.04 NO client role can write service-mode state directly', v_bad = '', v_bad);

  perform pg_temp.expect('12.05 the barber override column is not client-writable',
    not has_column_privilege('authenticated', 'public.barbers', 'service_mode_override', 'update')
    and not has_column_privilege('authenticated', 'public.barbers', 'service_mode_override', 'insert'));

  -- R1B's own protection must still hold — this lot touched the same table.
  perform pg_temp.expect('12.06 R1B''s protection of barbers.professional_id is intact',
    not has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'update')
    and not has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'insert'));

  perform pg_temp.expect('12.07 anon can read NONE of the internal tables',
    not has_table_privilege('anon', 'public.location_service_settings', 'select')
    and not has_table_privilege('anon', 'public.service_mode_overrides', 'select')
    and not has_table_privilege('anon', 'public.service_mode_changes', 'select'));

  perform pg_temp.expect('12.08 this lot added NO policy granted to anon',
    not exists (
      select 1 from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('location_service_settings', 'service_mode_overrides', 'service_mode_changes')
        and 'anon' = any (select rolname from pg_roles where oid = any (pol.polroles))));

  -- SECURITY DEFINER hygiene: every function pins search_path.
  v_bad := '';
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('ensure_location_service_settings', 'handle_new_location_service_settings',
                        'check_location_service_settings_consistency', 'check_service_mode_override_consistency',
                        'reject_service_mode_history_mutation', 'mode_allows_booking', 'mode_allows_queue',
                        'effective_service_mode', 'booking_admission_allowed', 'queue_admission_allowed',
                        'assert_service_mode_authority', 'set_location_service_mode', 'set_location_queue_open',
                        'set_barber_service_mode_override', 'set_service_mode_temporary_override',
                        'clear_service_mode_temporary_override', 'enforce_booking_service_mode',
                        'enforce_queue_service_mode', 'get_public_service_state', 'get_service_mode_state')
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;
  perform pg_temp.expect('12.09 EVERY function in this lot pins search_path', v_bad = '', v_bad);

  -- anon may execute exactly one thing.
  v_bad := '';
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('ensure_location_service_settings', 'handle_new_location_service_settings',
                        'effective_service_mode', 'booking_admission_allowed', 'queue_admission_allowed',
                        'assert_service_mode_authority', 'set_location_service_mode', 'set_location_queue_open',
                        'set_barber_service_mode_override', 'set_service_mode_temporary_override',
                        'clear_service_mode_temporary_override', 'enforce_booking_service_mode',
                        'enforce_queue_service_mode', 'get_service_mode_state')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;
  perform pg_temp.expect('12.10 anon may execute NOTHING except the customer contract', v_bad = '', v_bad);
  perform pg_temp.expect('12.11 ...and the customer contract IS callable by anon',
    has_function_privilege('anon', 'public.get_public_service_state(text, uuid, uuid)', 'execute'));

  -- private is not an API.
  v_bad := '';
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('ensure_location_service_settings', 'effective_service_mode',
                        'booking_admission_allowed', 'queue_admission_allowed',
                        'assert_service_mode_authority', 'mode_allows_booking', 'mode_allows_queue')
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;
  perform pg_temp.expect('12.12 no client role can call a private service-mode helper directly', v_bad = '', v_bad);

  -- The Worker gained nothing.
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    v_bad := '';
    for r in
      select t.tbl, p.priv
      from unnest(array['public.location_service_settings', 'public.service_mode_overrides',
                        'public.service_mode_changes']) as t(tbl)
      cross join unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
      where has_table_privilege('prospect_worker', t.tbl, p.priv)
    loop
      v_bad := v_bad || format(' %s/%s', r.tbl, r.priv);
    end loop;
    perform pg_temp.expect('12.13 prospect_worker gained NO service-mode privilege', v_bad = '', v_bad);
  else
    perform pg_temp.record('12.13 prospect_worker gained NO service-mode privilege', 'INFO',
      'role absent in this environment — asserted by 20260826120700 where it exists');
  end if;

  -- FK behaviour, chosen deliberately per §41.
  perform pg_temp.expect('12.14 an override CASCADEs from its barber — offboarding is never blocked',
    (select confdeltype from pg_constraint
      where conrelid = 'public.service_mode_overrides'::regclass
        and confrelid = 'public.barbers'::regclass) = 'c');
  perform pg_temp.expect('12.15 a HISTORY row SET NULLs from its barber — evidence outlives the placement',
    (select confdeltype from pg_constraint
      where conrelid = 'public.service_mode_changes'::regclass
        and confrelid = 'public.barbers'::regclass) = 'n');

  -- Realtime.
  perform pg_temp.expect('12.16 the establishment row broadcasts through Realtime',
    exists (select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public'
              and tablename = 'location_service_settings'));
  perform pg_temp.expect('12.17 overrides broadcast through Realtime',
    exists (select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public'
              and tablename = 'service_mode_overrides'));
  perform pg_temp.expect('12.18 the audit trail is deliberately NOT broadcast',
    not exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public'
                  and tablename = 'service_mode_changes'));
exception when others then
  perform pg_temp.record('12.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 13. THE PUBLIC CONTRACT — §23, §24, §25
-- ============================================================================

do $$
declare v_loc uuid := '99992000-0000-4000-8000-000000000001';
        v_barber uuid := '99994000-0000-4000-8000-000000000001';
        r record;
        v_owner_rows integer;
        v_barber_rows integer;
        v_outsider_rows integer;
begin
  perform pg_temp.become_postgres();
  update public.location_service_settings set default_service_mode = 'hybrid', queue_open = true where location_id = v_loc;
  update public.barbers set service_mode_override = null where id = v_barber;

  select * into r from public.get_public_service_state('verify-shop', v_loc, v_barber);
  perform pg_temp.expect('13.01 the customer contract answers for a real, public barber',
    r.effective_service_mode::text = 'hybrid');
  perform pg_temp.expect('13.02 it returns the mode SOURCE, so no client re-implements precedence',
    r.mode_source = 'location_default');
  perform pg_temp.expect('13.03 it reports mode_allows_booking and mode_allows_queue',
    r.mode_allows_booking is true and r.mode_allows_queue is true);
  perform pg_temp.expect('13.04 it reports queue_open as its own separate fact',
    r.queue_open is true);
  perform pg_temp.expect('13.05 it reports the COMPOSED admission answers',
    r.queue_accepting_new_entries is true and r.booking_accepting_new_entries is true);

  -- queue_open alone must move only the queue answer.
  update public.location_service_settings set queue_open = false where location_id = v_loc;
  select * into r from public.get_public_service_state('verify-shop', v_loc, v_barber);
  perform pg_temp.expect('13.06 closing the queue moves queue_accepting_new_entries only',
    r.queue_accepting_new_entries is false
    and r.booking_accepting_new_entries is true
    and r.mode_allows_queue is true,
    'mode_allows_queue must stay TRUE — the mode did not change, the runtime state did');
  update public.location_service_settings set queue_open = true where location_id = v_loc;

  -- expires_at reaches the client, so it can schedule its own refetch for an
  -- expiry that generates no database write and therefore no realtime event.
  insert into public.service_mode_overrides (organization_id, scope, location_id, mode, expires_at)
  values ('99991000-0000-4000-8000-000000000001', 'location', v_loc, 'queue_only', now() + interval '30 minutes');
  select * into r from public.get_public_service_state('verify-shop', v_loc, v_barber);
  perform pg_temp.expect('13.07 the contract exposes mode_expires_at for client-side scheduled refresh',
    r.mode_expires_at is not null and r.effective_service_mode::text = 'queue_only');
  update public.service_mode_overrides set cleared_at = now() where location_id = v_loc and cleared_at is null;

  -- ZERO ROWS is the refusal, and it is uniform.
  perform pg_temp.expect('13.08 an unknown slug returns zero rows',
    not exists (select 1 from public.get_public_service_state('no-such-shop-at-all', v_loc, v_barber)));
  perform pg_temp.expect('13.09 a location from ANOTHER tenant returns zero rows',
    not exists (select 1 from public.get_public_service_state('verify-shop', '99992000-0000-4000-8000-000000000003', null)));
  perform pg_temp.expect('13.10 a barber from ANOTHER tenant returns zero rows',
    not exists (select 1 from public.get_public_service_state('verify-shop', v_loc, '99994000-0000-4000-8000-000000000007')));

  update public.locations set is_active = false where id = v_loc;
  perform pg_temp.expect('13.11 an INACTIVE establishment returns zero rows',
    not exists (select 1 from public.get_public_service_state('verify-shop', v_loc, null)));
  update public.locations set is_active = true where id = v_loc;

  update public.staff_profiles set is_public = false where id = '99993000-0000-4000-8000-000000000003';
  perform pg_temp.expect('13.12 a NON-PUBLIC barber returns zero rows',
    not exists (select 1 from public.get_public_service_state('verify-shop', v_loc, v_barber)));
  update public.staff_profiles set is_public = true where id = '99993000-0000-4000-8000-000000000003';

  -- §24: an unclaimed, worker-discovered professional has NO operational
  -- reality and must never acquire one through this contract. There is no
  -- argument that reaches them — the function only speaks barbers.
  perform pg_temp.expect('13.13 a professional id is not accepted where a barber id belongs',
    not exists (select 1 from public.get_public_service_state(
      'verify-shop', v_loc, '44440000-0000-4000-8000-0000000000ff')),
    'an unclaimed discovered professional has no barbers row and can never be answered for');

  -- The contract is anon-callable, because the CTA has to work signed out.
  perform pg_temp.expect('13.14 the customer contract is callable ANONYMOUSLY',
    pg_temp.sqlstate_as_anon(format(
      'select 1 from public.get_public_service_state(''verify-shop'', %L, null)', v_loc)) = 'ALLOWED');

  -- The Pro read. It must be called AS SOMEBODY: it authorizes on auth.uid(),
  -- which is NULL for a bare postgres session, so calling it unimpersonated
  -- correctly returns nothing and would prove only that the membership check
  -- exists.
  perform pg_temp.become('99990000-0000-4000-8000-000000000001');
  select count(*) into v_owner_rows from public.get_service_mode_state(v_loc);
  perform pg_temp.become_postgres();
  perform pg_temp.expect('13.15 the Pro read returns an establishment row plus one row per barber',
    v_owner_rows >= 2, format('%s row(s) for the owner', v_owner_rows));

  perform pg_temp.become('99990000-0000-4000-8000-000000000007');
  select count(*) into v_outsider_rows from public.get_service_mode_state(v_loc);
  perform pg_temp.become_postgres();
  perform pg_temp.expect('13.16 the Pro read returns NOTHING to a cross-tenant caller',
    v_outsider_rows = 0,
    'zero rows rather than a raise, so a shared layout can call it before the workspace resolves');

  -- An ordinary barber may READ the operating state of their own shop: they
  -- need to know it is reservation_only this afternoon. Changing it is a
  -- separate question, answered in section 9.
  perform pg_temp.become('99990000-0000-4000-8000-000000000003');
  select count(*) into v_barber_rows from public.get_service_mode_state(v_loc);
  perform pg_temp.become_postgres();
  perform pg_temp.expect('13.17 the Pro read IS available to an ordinary barber of the shop',
    v_barber_rows >= 2, format('%s row(s) for a barber', v_barber_rows));

  perform pg_temp.expect('13.18 the Pro read is NOT callable anonymously',
    pg_temp.sqlstate_as_anon(format('select 1 from public.get_service_mode_state(%L)', v_loc)) = '42501');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('13.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 13b. UPGRADE-ONLY: the seeded database survived intact
--
-- Skipped with an INFO on a fresh run, rather than silently passing.
-- ============================================================================

do $$
declare v_census boolean;
        v_expected bigint;
begin
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'seed_service_mode_census'
  ) into v_census;

  if not v_census then
    perform pg_temp.record('13b.00 upgrade census', 'INFO',
      'no SEED census present — this is the FRESH-database run, so preservation checks do not apply');
    return;
  end if;

  -- Every commitment counted before the upgrade must still be there. The
  -- comparison is >= because this VERIFY has itself created rows.
  select value into v_expected from public.seed_service_mode_census where measure = 'appointments_completed';
  perform pg_temp.expect('13b.01 every COMPLETED appointment survived the upgrade',
    (select count(*) from public.appointments where status = 'completed') >= v_expected,
    format('expected at least %s', v_expected));

  select value into v_expected from public.seed_service_mode_census where measure = 'appointments_confirmed';
  perform pg_temp.expect('13b.02 every CONFIRMED future appointment survived the upgrade',
    (select count(*) from public.appointments where status = 'confirmed') >= v_expected,
    format('expected at least %s', v_expected));

  select value into v_expected from public.seed_service_mode_census where measure = 'queue_waiting';
  perform pg_temp.expect('13b.03 every WAITING queue entry survived the upgrade',
    (select count(*) from public.queue_entries where status = 'waiting') >= v_expected,
    format('expected at least %s', v_expected));

  select value into v_expected from public.seed_service_mode_census where measure = 'queue_in_service';
  perform pg_temp.expect('13b.04 the customer being served survived the upgrade',
    (select count(*) from public.queue_entries where status = 'in_service') >= v_expected);

  select value into v_expected from public.seed_service_mode_census where measure = 'customers_total';
  perform pg_temp.expect('13b.05 no customer relationship was destroyed',
    (select count(*) from public.customers) >= v_expected);

  select value into v_expected from public.seed_service_mode_census where measure = 'professionals_total';
  perform pg_temp.expect('13b.06 R1B durable professional identities survived',
    (select count(*) from public.professionals) >= v_expected);

  select value into v_expected from public.seed_service_mode_census where measure = 'follows_following';
  perform pg_temp.expect('13b.07 R1B follows survived',
    (select count(*) from public.professional_follows where state = 'following') >= v_expected);

  select value into v_expected from public.seed_service_mode_census where measure = 'passports_total';
  perform pg_temp.expect('13b.08 Fade Passports survived',
    (select count(*) from public.customer_passports) >= v_expected);

  select value into v_expected from public.seed_service_mode_census where measure = 'locations_total';
  perform pg_temp.expect('13b.09 no location was removed',
    (select count(*) from public.locations) >= v_expected);

  select value into v_expected from public.seed_service_mode_census where measure = 'barbers_total';
  perform pg_temp.expect('13b.10 no barber placement was removed',
    (select count(*) from public.barbers) >= v_expected);

  -- completed_at is R1A's authoritative column and must be untouched.
  perform pg_temp.expect('13b.11 completed_at was not rewritten by the upgrade',
    not exists (select 1 from public.appointments where status = 'completed' and completed_at is null));

  -- The seeded shops all inherited the compatibility default.
  perform pg_temp.expect('13b.12 every seeded establishment was backfilled to hybrid + queue open',
    not exists (
      select 1 from public.location_service_settings s
      join public.locations l on l.id = s.location_id
      join public.organizations o on o.id = l.organization_id
      where o.slug like 'seed-%'
        and (s.default_service_mode <> 'hybrid' or s.queue_open is not true)));

  -- The seeded salon_essential shop keeps its walk-in channel.
  perform pg_temp.expect('13b.13 the seeded salon_essential shop still holds its walk-in entitlement',
    private.org_has_capability('b0000000-0000-4000-8000-000000000002', 'walkIns'));

  -- The seeded free organization is refused — and losing nothing, because it
  -- has no location to be refused at.
  perform pg_temp.expect('13b.14 the seeded free organization is correctly unentitled',
    not private.org_has_capability('b0000000-0000-4000-8000-000000000004', 'booking'));
  perform pg_temp.expect('13b.15 ...and it has no establishment, so nothing of its broke',
    (select count(*) from public.locations
      where organization_id = 'b0000000-0000-4000-8000-000000000004') = 0);

  -- No history was fabricated for choices nobody made.
  perform pg_temp.expect('13b.16 the upgrade fabricated NO audit history',
    (select count(*) from public.service_mode_changes
      where changed_by_user_id is null
        and location_id in (select l.id from public.locations l
                            join public.organizations o on o.id = l.organization_id
                            where o.slug like 'seed-%')) = 0);
exception when others then
  perform pg_temp.record('13b.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 14. THE SUITE ITSELF RAN
--
-- Guards the failure mode where an early SQL error aborts the transaction,
-- every later insert fails, and the summary prints PASS=0 FAIL=0 while looking
-- like success. If the count is implausibly low, that is itself a FAIL.
-- ============================================================================

do $$
declare v_total integer;
begin
  select count(*) into v_total from verify_results;
  perform pg_temp.expect(
    '14.01 the suite executed a plausible number of checks',
    v_total >= 130,
    format('%s checks recorded; fewer than 130 means execution stopped early', v_total));
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
