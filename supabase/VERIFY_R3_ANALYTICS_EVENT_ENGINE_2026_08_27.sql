-- ============================================================================
-- FadeUp — VERIFY: R3, the analytics and event engine
--
-- Run against a DISPOSABLE database only. It creates organizations, accounts,
-- appointments and queue entries, and it deliberately performs attacks
-- (impersonation, cross-tenant reads, forged context). Never point it at a
-- production-like database.
--
--   scripts/disposable-db-test.sh \
--     --verify supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--
-- WHAT THIS SUITE IS TRYING TO CATCH
--
-- Analytics fails quietly. A broken booking is a support ticket within the
-- hour; a broken funnel is a number in a deck that nobody can tell is wrong.
-- So the checks below are weighted towards the failures that produce no
-- symptom:
--
--   * an event that exists when the business fact does not (the click-counted-
--     as-conversion failure, §5);
--   * an event counted twice (§6);
--   * an event attributed to the wrong actor or the wrong tenant (§11);
--   * a commercial snapshot that silently follows the CURRENT plan (§8);
--   * analytics taking a booking down with it (§14) — the one failure here
--     that is NOT quiet, and the most damaging.
--
-- Zero FAIL rows is the pass condition, on BOTH paths this file serves — a
-- fresh replay and an upgrade over a populated pre-R3 database. Section 15
-- decides which one is running and says so in the output; sections 16 and 17
-- are the halves that only one path can assert.
-- ============================================================================

\set ON_ERROR_STOP off

drop table if exists pg_temp.verify_results;

create temp table verify_results (
  check_name text not null,
  status text not null,
  detail text
);

create or replace function pg_temp.record(p_check text, p_status text, p_detail text default null)
returns void language sql as $$
  insert into verify_results (check_name, status, detail) values (p_check, p_status, p_detail);
$$;

create or replace function pg_temp.expect(p_check text, p_condition boolean, p_detail text default null)
returns void language sql as $$
  insert into verify_results (check_name, status, detail)
  values (p_check, case when p_condition then 'PASS' else 'FAIL' end, p_detail);
$$;

-- Impersonation must set BOTH claim GUCs: the live stack's auth.uid() parses
-- request.jwt.claims, the older disposable image reads request.jwt.claim.sub.
-- Setting only one leaves auth.uid() NULL, which silently turns every "an
-- attacker cannot" test into "an anonymous caller cannot" — a weaker claim.
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

/** How many events of one kind exist for one subject. The workhorse. */
create or replace function pg_temp.events(p_name text, p_org uuid default null)
returns bigint language sql as $$
  select count(*)
  from public.analytics_events e
  where e.event_name = p_name
    and (p_org is null or e.organization_id = p_org);
$$;


-- ---------------------------------------------------------------------------
-- STATE AT ENTRY, captured before this file creates anything
--
-- The strongest form of the no-backfill claim is "applying the lot wrote zero
-- events, anywhere" — but it can only be measured HERE, before the suite's own
-- fixtures start emitting. Asserting it later would be asserting that this
-- file had done nothing, which is false by design.
--
-- Both paths check it. On a fresh replay it proves no migration writes an
-- event at install time; on an upgrade it proves MASTER did not backfill a
-- populated database.
-- ---------------------------------------------------------------------------

create temp table verify_entry_state as
select
  (select count(*) from public.analytics_events)               as events_at_entry,
  (select count(*) from public.analytics_ingestion_rejections) as rejections_at_entry;


-- ============================================================================
-- 0. FIXTURES
-- ============================================================================

do $$
begin
  insert into auth.users (id, email) values
    ('33330000-0000-4000-8000-000000000001', 'r3.owner@verify.invalid'),
    ('33330000-0000-4000-8000-000000000002', 'r3.manager@verify.invalid'),
    ('33330000-0000-4000-8000-000000000003', 'r3.barber@verify.invalid'),
    ('33330000-0000-4000-8000-000000000004', 'r3.customer@verify.invalid'),
    ('33330000-0000-4000-8000-000000000005', 'r3.customer.two@verify.invalid'),
    ('33330000-0000-4000-8000-000000000006', 'r3.outsider@verify.invalid'),
    ('33330000-0000-4000-8000-000000000007', 'r3.rival.owner@verify.invalid'),
    ('33330000-0000-4000-8000-000000000008', 'r3.platform@verify.invalid'),
    -- A customer used by NOTHING else in this file. The cross-lot chain in
    -- §13 needs an account with no existing professional_follows edge:
    -- auto-follow is ON CONFLICT DO NOTHING with no DO UPDATE branch — by
    -- design, so it can never reverse an explicit unfollow — so reusing a
    -- customer who had already followed manually would suppress the very edge
    -- the test exists to observe, and the failure would look like a product
    -- bug rather than a fixture collision.
    ('33330000-0000-4000-8000-000000000009', 'r3.chain@verify.invalid')
  on conflict (id) do nothing;

  insert into public.organizations (id, name, slug) values
    ('33331000-0000-4000-8000-000000000001', 'R3 Verify Shop',  'r3-verify-shop'),
    -- A real second tenant, so every cross-tenant check has an actual other
    -- side rather than a hypothetical one.
    ('33331000-0000-4000-8000-000000000002', 'R3 Verify Rival', 'r3-verify-rival')
  on conflict (id) do nothing;

  perform private.ensure_organization_commercial_state('33331000-0000-4000-8000-000000000001');
  perform private.ensure_organization_commercial_state('33331000-0000-4000-8000-000000000002');

  -- salon_pro so booking and walk-in capabilities are actually entitled: the
  -- Service Mode lot made admission consult org_has_capability, and a `free`
  -- fixture could not create the appointments this suite measures.
  update public.organization_commercial_state
     set plan_key = 'salon_pro', status = 'active'
   where organization_id in ('33331000-0000-4000-8000-000000000001',
                             '33331000-0000-4000-8000-000000000002');

  insert into public.memberships (organization_id, user_id, role) values
    ('33331000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000001', 'owner'),
    ('33331000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000002', 'manager'),
    ('33331000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000003', 'barber'),
    ('33331000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-000000000007', 'owner')
  on conflict do nothing;

  insert into public.platform_members (user_id, role)
  values ('33330000-0000-4000-8000-000000000008', 'platform_admin')
  on conflict do nothing;
exception when others then
  perform pg_temp.record('0.01 fixtures: accounts and tenants', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- Each fixture stage is its OWN statement. A single DO block would roll the
-- whole thing back on the first surprise, and every later section would then
-- fail for a reason that has nothing to do with what it is testing — which is
-- exactly what happened on the first run of this suite.
do $$
begin
  insert into public.locations (id, organization_id, name, timezone, is_active) values
    ('33332000-0000-4000-8000-000000000001', '33331000-0000-4000-8000-000000000001', 'R3 Main',  'Europe/Paris', true),
    ('33332000-0000-4000-8000-000000000002', '33331000-0000-4000-8000-000000000002', 'Rival Main', 'Europe/Paris', true)
  on conflict (id) do nothing;
exception when others then
  perform pg_temp.record('0.02a fixtures: establishments', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- staff_profiles is NOT inserted here: handle_new_membership already created
-- one for every membership above, and inserting a second collides on
-- (organization_id, user_id). The fixture adopts the row the product made,
-- which is also a more faithful starting state than one this file invented.
do $$
declare v_staff uuid;
begin
  select id into v_staff from public.staff_profiles
  where organization_id = '33331000-0000-4000-8000-000000000001'
    and user_id = '33330000-0000-4000-8000-000000000003';

  update public.staff_profiles
     set location_id = '33332000-0000-4000-8000-000000000001',
         display_name = 'R3 Barber', is_public = true, is_active = true
   where id = v_staff;

  -- barbers_assign_professional (R1B) mints the durable professional identity
  -- on insert, so professional_id is populated without this fixture choosing it.
  insert into public.barbers (id, organization_id, staff_profile_id, is_bookable) values
    ('33334000-0000-4000-8000-000000000001', '33331000-0000-4000-8000-000000000001', v_staff, true)
  on conflict (id) do nothing;
exception when others then
  perform pg_temp.record('0.02b fixtures: bookable barber', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
begin
  insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active) values
    ('33335000-0000-4000-8000-000000000001', '33331000-0000-4000-8000-000000000001', 'R3 Fade', 30, 2500, true)
  on conflict (id) do nothing;
exception when others then
  perform pg_temp.record('0.02c fixtures: service', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect('0.03 fixture barber carries a durable professional identity',
  (select professional_id is not null from public.barbers
   where id = '33334000-0000-4000-8000-000000000001'));


-- ============================================================================
-- 1. SCHEMA SHAPE
-- ============================================================================

select pg_temp.expect('1.01 analytics_events exists',
  to_regclass('public.analytics_events') is not null);

select pg_temp.expect('1.02 analytics_event_definitions exists',
  to_regclass('public.analytics_event_definitions') is not null);

select pg_temp.expect('1.03 analytics_ingestion_rejections exists',
  to_regclass('public.analytics_ingestion_rejections') is not null);

-- Every conceptual field the R3 brief names, present under the name the query
-- layer and the documentation both use. A renamed column is a silently broken
-- report, not an error.
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing
  from unnest(array[
    'id','event_name','event_version','occurred_at','ingested_at',
    'actor_type','actor_user_id','customer_id','professional_id',
    'organization_id','location_id','barber_id','appointment_id',
    'queue_entry_id','passport_id','prospect_id','acquisition_source',
    'acquisition_source_record_id','event_origin','platform','session_id',
    'locale','country_code','plan_key','commercial_family','properties',
    'correlation_id','causation_id','dedupe_key'
  ]) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'analytics_events' and column_name = c
  );

  perform pg_temp.expect('1.04 every R3 event column is present',
    v_missing is null, v_missing);
end $$;

-- §12: columns that must NOT exist. A schema is the only durable place to
-- record a privacy decision — a column that exists WILL eventually be filled.
do $$
declare v_present text;
begin
  select string_agg(column_name, ', ') into v_present
  from information_schema.columns
  where table_schema = 'public' and table_name = 'analytics_events'
    and column_name in (
      'ip_address','user_agent','device_id','fingerprint',
      'latitude','longitude','customer_email','customer_phone','referrer'
    );

  perform pg_temp.expect('1.05 no PII or fingerprinting column exists',
    v_present is null, v_present);
end $$;

do $$
declare v_missing text;
begin
  select string_agg(i, ', ') into v_missing
  from unnest(array[
    'analytics_events_dedupe_key_unique',
    'analytics_events_org_name_time_idx',
    'analytics_events_name_time_idx',
    'analytics_events_actor_time_idx',
    'analytics_events_professional_name_time_idx',
    'analytics_events_occurred_at_brin'
  ]) as i
  where not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'analytics_events' and indexname = i
  );

  perform pg_temp.expect('1.06 the six planned indexes exist', v_missing is null, v_missing);
end $$;

select pg_temp.expect('1.07 the dedupe index is UNIQUE and PARTIAL',
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'analytics_events_dedupe_key_unique'
      and indexdef ilike '%unique%'
      and indexdef ilike '%where (dedupe_key is not null)%'
  ));

select pg_temp.expect('1.08 the chronological index is BRIN, not a B-tree',
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'analytics_events_occurred_at_brin'
      and indexdef ilike '%using brin%'
  ));

-- §20 forbids over-indexing. Anything beyond the six planned indexes plus the
-- primary key is a write cost inside every booking transaction, paid for a
-- report nobody has written.
select pg_temp.expect('1.09 analytics_events is not over-indexed',
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'analytics_events') <= 7,
  (select string_agg(indexname, ', ') from pg_indexes
   where schemaname = 'public' and tablename = 'analytics_events'));

-- No foreign keys, deliberately. History must outlive its subject, and a
-- cascade here would let deleting a barber erase the record of the services
-- they delivered — the exact defect R0 found on appointments.barber_id.
select pg_temp.expect('1.10 analytics_events has no foreign keys',
  (select count(*) from pg_constraint
   where conrelid = 'public.analytics_events'::regclass and contype = 'f') = 0);


-- ============================================================================
-- 2. APPEND-ONLY
-- ============================================================================

do $$
declare v_id uuid;
begin
  v_id := private.emit_analytics_event(
    p_event_name => 'discovery_viewed',
    p_event_origin => 'public_web',
    p_properties => '{"surface":"marketplace"}'::jsonb);
  perform pg_temp.expect('2.01 an event can be written at all', v_id is not null);
exception when others then
  perform pg_temp.record('2.01 an event can be written at all', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- As POSTGRES: the strongest form of the claim. If the owner of the table
-- cannot rewrite history, nobody can.
do $$
begin
  update public.analytics_events set event_name = 'search_performed'
  where event_name = 'discovery_viewed';
  perform pg_temp.record('2.02 UPDATE refused even for postgres', 'FAIL', 'the update succeeded');
exception when others then
  perform pg_temp.expect('2.02 UPDATE refused even for postgres', sqlstate = '22023', sqlerrm);
end $$;

do $$
begin
  delete from public.analytics_events where event_name = 'discovery_viewed';
  perform pg_temp.record('2.03 DELETE refused even for postgres', 'FAIL', 'the delete succeeded');
exception when others then
  perform pg_temp.expect('2.03 DELETE refused even for postgres', sqlstate = '22023', sqlerrm);
end $$;

do $$
begin
  perform private.purge_analytics_events(now() - interval '10 days');
  perform pg_temp.record('2.05 retention purge refuses a recent cutoff', 'FAIL', 'accepted a 10-day cutoff');
exception when others then
  perform pg_temp.expect('2.05 retention purge refuses a recent cutoff', sqlstate = '22023', sqlerrm);
end $$;


-- ============================================================================
-- 3. RLS, GRANTS AND FUNCTION SAFETY
-- ============================================================================

do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('analytics_events','analytics_event_definitions','analytics_ingestion_rejections')
    and not (c.relrowsecurity and c.relforcerowsecurity);

  perform pg_temp.expect('3.01 RLS enabled AND forced on all three tables', v_bad is null, v_bad);
end $$;

do $$
declare v_bad text;
begin
  select string_agg(format('%s can %s', r, p), ', ') into v_bad
  from unnest(array['anon','authenticated']) r
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
  where has_table_privilege(r, 'public.analytics_events', p);

  perform pg_temp.expect('3.02 no client role holds ANY privilege on analytics_events',
    v_bad is null, v_bad);
end $$;

select pg_temp.expect('3.03 analytics_events has no RLS policy at all',
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'analytics_events') = 0,
  'the posture is "unreachable", not "selectively readable"');

do $$
declare v_bad text;
begin
  select string_agg(format('%s on %s', r, t), ', ') into v_bad
  from unnest(array['anon','authenticated']) r
  cross join unnest(array['public.analytics_event_definitions','public.analytics_ingestion_rejections']) t
  where has_table_privilege(r, t, 'SELECT') or has_table_privilege(r, t, 'INSERT');

  perform pg_temp.expect('3.04 taxonomy and diagnostics are not client-readable', v_bad is null, v_bad);
end $$;

-- Every R3 function pins search_path, definer or not: an unqualified name
-- resolves through the CALLER's search_path either way, which is a
-- privilege-escalation primitive.
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
    and (p.proname like 'analytics\_%' or p.proname like '%\_analytics\_%'
         or p.proname in ('track_analytics_event','purge_analytics_events',
                          'emit_analytics_event','try_emit_analytics_event',
                          'get_organization_analytics_summary','get_professional_analytics_summary',
                          'get_organization_retention_cohort','get_platform_analytics_funnel'))
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
    );

  perform pg_temp.expect('3.05 every R3 function pins search_path', v_bad is null, v_bad);
end $$;

do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated']) r
  where n.nspname = 'private'
    and (p.proname like '%analytics%' or p.proname like 'purge_analytics%')
    and has_function_privilege(r, p.oid, 'EXECUTE');

  perform pg_temp.expect('3.06 no client role can execute a private analytics function',
    v_bad is null, v_bad);
end $$;

-- The five client contracts, and nothing else in `public`, may be executed by
-- a client role. A sixth appearing here is scope leaking into the API surface.
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated']) r
  where n.nspname = 'public'
    and (p.proname like 'analytics\_%' or p.proname = 'reject_analytics_event_mutation')
    and has_function_privilege(r, p.oid, 'EXECUTE');

  perform pg_temp.expect('3.07 no analytics trigger function is client-executable',
    v_bad is null, v_bad);
end $$;

select pg_temp.expect('3.08 track_analytics_event is executable by anon',
  has_function_privilege('anon',
    'public.track_analytics_event(text,text,uuid,uuid,uuid,uuid,jsonb,text,text,uuid)', 'EXECUTE'),
  'discovery happens signed out; a contract that only saw authenticated traffic would start the funnel in the middle');

select pg_temp.expect('3.09 the organization summary is NOT executable by anon',
  not has_function_privilege('anon',
    'public.get_organization_analytics_summary(uuid,timestamptz,timestamptz)', 'EXECUTE'));

select pg_temp.expect('3.10 the platform funnel is NOT executable by anon',
  not has_function_privilege('anon',
    'public.get_platform_analytics_funnel(timestamptz,timestamptz)', 'EXECUTE'));

select pg_temp.expect('3.11 all 13 analytics triggers are attached',
  (select count(*) from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
     and t.tgname in (
       'organization_follows_analytics','professional_follows_analytics',
       'customer_favorites_analytics','appointments_analytics_insert',
       'appointments_analytics_update','queue_entries_analytics_insert',
       'queue_entries_analytics_update','customer_passports_analytics',
       'customer_professional_relationships_analytics','prospect_professionals_analytics',
       'professional_claims_analytics_insert','professional_claims_analytics_update',
       'commercial_plan_changes_analytics')) = 13);


-- ============================================================================
-- 4. THE TAXONOMY
-- ============================================================================

select pg_temp.expect('4.01 all seven event families are represented',
  (select count(distinct family) from public.analytics_event_definitions
   where family in ('discovery','social','booking','queue','passport','acquisition','commercial')) = 7);

select pg_temp.expect('4.02 every conversion event is server-emitted',
  not exists (
    select 1 from public.analytics_event_definitions
    where event_name in ('appointment_created','appointment_completed','appointment_cancelled',
                         'queue_joined','queue_completed','claim_approved',
                         'organization_followed','professional_followed','organization_favorited')
      and emission <> 'server'),
  'a conversion built on a client event counts button presses, not business facts');

select pg_temp.expect('4.03 every event carries a version',
  not exists (select 1 from public.analytics_event_definitions where event_version < 1));

select pg_temp.expect('4.04 deferred contracts exist and are documented',
  (select count(*) from public.analytics_event_definitions where status = 'deferred') >= 4);

select pg_temp.expect('4.05 no client event is marked idempotent',
  not exists (select 1 from public.analytics_event_definitions
              where emission = 'client' and is_idempotent),
  'repeated views and searches are legitimately separate events (§6)');


-- ============================================================================
-- 5. INGESTION SECURITY
-- ============================================================================

-- The central §11 claim, stated as a fact about the SIGNATURE rather than
-- about a check inside the body: there is nowhere to put an actor.
select pg_temp.expect('5.01 track_analytics_event accepts no actor parameter',
  not exists (
    select 1 from pg_proc p, unnest(coalesce(p.proargnames, array[]::text[])) a
    where p.proname = 'track_analytics_event'
      and a in ('p_actor_user_id','p_actor_type','p_user_id','p_actor')),
  'impersonation is impossible because the argument does not exist');

select pg_temp.expect('5.02 track_analytics_event accepts no timestamp or dedupe key',
  not exists (
    select 1 from pg_proc p, unnest(coalesce(p.proargnames, array[]::text[])) a
    where p.proname = 'track_analytics_event'
      and a in ('p_occurred_at','p_dedupe_key','p_plan_key','p_commercial_family','p_country_code')));

-- Raw client INSERT, attempted for real rather than inferred from a grant.
select pg_temp.expect('5.03 an authenticated client cannot raw-INSERT an event',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$insert into public.analytics_events (event_name, actor_type, event_origin)
       values ('search_performed', 'customer', 'public_web')$q$) <> 'ALLOWED');

select pg_temp.expect('5.04 an anonymous client cannot raw-INSERT an event',
  pg_temp.sqlstate_as_anon(
    $q$insert into public.analytics_events (event_name, actor_type, event_origin)
       values ('search_performed', 'anonymous', 'public_web')$q$) <> 'ALLOWED');

select pg_temp.expect('5.05 an authenticated client cannot SELECT the raw log',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    'select 1 from public.analytics_events limit 1') <> 'ALLOWED');

select pg_temp.expect('5.06 a client cannot call the internal emitter directly',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$select private.emit_analytics_event('search_performed', 'public_web',
        '33330000-0000-4000-8000-000000000001'::uuid)$q$) <> 'ALLOWED',
  'the emitter accepts an arbitrary actor; a grant on it would be the impersonation hole');

-- A browser cannot write a business fact, whatever it claims.
select pg_temp.expect('5.07 a client cannot emit a server-authoritative event',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$select public.track_analytics_event('appointment_completed', 'customer_web',
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) <> 'ALLOWED');

select pg_temp.expect('5.08 a client cannot emit a deferred event',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$select public.track_analytics_event('claim_started', 'customer_web')$q$) <> 'ALLOWED');

select pg_temp.expect('5.09 a client cannot claim a backend origin',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$select public.track_analytics_event('search_performed', 'backend')$q$) <> 'ALLOWED');

select pg_temp.expect('5.10 an anonymous caller cannot claim an authenticated origin',
  pg_temp.sqlstate_as_anon(
    $q$select public.track_analytics_event('search_performed', 'customer_web')$q$) <> 'ALLOWED',
  'otherwise signed-in engagement is uncountable');

-- §11: an arbitrary organization id from a browser is exactly what CLAUDE.md
-- says never to trust.
select pg_temp.expect('5.11 a client cannot attribute an event to an unknown organization',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$select public.track_analytics_event('booking_started', 'customer_web',
        '00000000-0000-4000-8000-0000000000ff'::uuid)$q$) <> 'ALLOWED');

select pg_temp.expect('5.12 a client cannot pair one tenant''s location with another tenant',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000004',
    $q$select public.track_analytics_event('booking_started', 'customer_web',
        '33331000-0000-4000-8000-000000000001'::uuid,
        '33332000-0000-4000-8000-000000000002'::uuid)$q$) <> 'ALLOWED',
  'incoherent context corrupts BOTH tenants'' reports at once');

-- The actor is derived, and derived correctly, from the session.
do $$
declare v_actor uuid; v_type text;
begin
  perform pg_temp.become('33330000-0000-4000-8000-000000000004');
  perform public.track_analytics_event('discovery_viewed', 'customer_web',
    null, null, null, null, '{"surface":"marketplace"}'::jsonb);
  perform pg_temp.become_postgres();

  select actor_user_id, actor_type::text into v_actor, v_type
  from public.analytics_events
  where event_name = 'discovery_viewed' and event_origin = 'customer_web'
  order by ingested_at desc limit 1;

  perform pg_temp.expect('5.13 the actor is derived from auth.uid()',
    v_actor = '33330000-0000-4000-8000-000000000004', coalesce(v_actor::text, 'null'));
  perform pg_temp.expect('5.14 the actor type is classified from real state',
    v_type = 'customer', v_type);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('5.13 the actor is derived from auth.uid()', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- A shop owner is staff, not a customer — the same call, a different classification.
do $$
declare v_type text;
begin
  perform pg_temp.become('33330000-0000-4000-8000-000000000001');
  perform public.track_analytics_event('discovery_viewed', 'customer_web',
    null, null, null, null, '{"surface":"customer_discover"}'::jsonb);
  perform pg_temp.become_postgres();

  select actor_type::text into v_type
  from public.analytics_events
  where event_name = 'discovery_viewed'
    and actor_user_id = '33330000-0000-4000-8000-000000000001'
  order by ingested_at desc limit 1;

  perform pg_temp.expect('5.15 organization staff are classified as staff', v_type = 'staff', v_type);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('5.15 organization staff are classified as staff', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 6. PRIVACY (§12)
-- ============================================================================

do $$
begin
  perform private.emit_analytics_event('search_performed', 'public_web',
    p_properties => '{"customer_phone":"+33600000000"}'::jsonb);
  perform pg_temp.record('6.01 a forbidden property key is refused', 'FAIL', 'accepted');
exception when others then
  perform pg_temp.expect('6.01 a forbidden property key is refused', sqlstate = '22023', sqlerrm);
end $$;

do $$
begin
  -- The realistic accident: an innocuous key with an address in the value.
  perform private.emit_analytics_event('search_performed', 'public_web',
    p_properties => '{"identifier":"someone@example.com"}'::jsonb);
  perform pg_temp.record('6.02 an email-shaped VALUE is refused', 'FAIL', 'accepted');
exception when others then
  perform pg_temp.expect('6.02 an email-shaped VALUE is refused', sqlstate = '22023', sqlerrm);
end $$;

do $$
begin
  perform private.emit_analytics_event('search_performed', 'public_web',
    p_properties => '{"customer":{"name":"Ada","town":"Paris"}}'::jsonb);
  perform pg_temp.record('6.03 a nested object is refused', 'FAIL', 'accepted');
exception when others then
  perform pg_temp.expect('6.03 a nested object is refused', sqlstate = '22023', sqlerrm);
end $$;

do $$
begin
  perform private.emit_analytics_event('search_performed', 'public_web',
    p_properties => jsonb_build_object('blob', repeat('x', 8000)));
  perform pg_temp.record('6.04 an oversized payload is refused', 'FAIL', 'accepted');
exception when others then
  perform pg_temp.expect('6.04 an oversized payload is refused', true, sqlerrm);
end $$;


-- ============================================================================
-- 7. SOCIAL EVENTS — from state, never from a button
-- ============================================================================

do $$
declare v_org uuid := '33331000-0000-4000-8000-000000000001';
begin
  -- The organization must be publicly visible for follow_organization to
  -- accept it; a private shop is genuinely unfollowable.
  update public.organizations set is_active = true where id = v_org;
exception when others then null;
end $$;

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_user uuid := '33330000-0000-4000-8000-000000000004';
  v_before bigint;
begin
  v_before := pg_temp.events('organization_followed', v_org);

  insert into public.organization_follows
    (follower_user_id, organization_id, is_following, followed_at)
  values (v_user, v_org, true, now())
  on conflict (follower_user_id, organization_id)
  do update set is_following = true, followed_at = now(), unfollowed_at = null;

  perform pg_temp.expect('7.01 following a shop creates exactly one event',
    pg_temp.events('organization_followed', v_org) = v_before + 1);

  perform pg_temp.expect('7.02 the follow event names the follower',
    exists (select 1 from public.analytics_events
            where event_name = 'organization_followed'
              and organization_id = v_org and actor_user_id = v_user));

  perform pg_temp.expect('7.03 the follow event is server-origin',
    exists (select 1 from public.analytics_events
            where event_name = 'organization_followed'
              and organization_id = v_org and event_origin = 'backend'),
    'a conversion event must never carry a browser origin');
exception when others then
  perform pg_temp.record('7.01 following a shop creates exactly one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- THE DOUBLE-CLICK CASE. Re-following an already-followed shop changes no
-- state, so it must produce no second event.
do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_user uuid := '33330000-0000-4000-8000-000000000004';
  v_before bigint;
begin
  v_before := pg_temp.events('organization_followed', v_org);

  update public.organization_follows
     set is_following = true, followed_at = now(), updated_at = now()
   where follower_user_id = v_user and organization_id = v_org;

  perform pg_temp.expect('7.04 re-following an already-followed shop emits nothing',
    pg_temp.events('organization_followed', v_org) = v_before,
    format('before=%s after=%s', v_before, pg_temp.events('organization_followed', v_org)));
end $$;

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_user uuid := '33330000-0000-4000-8000-000000000004';
  v_before bigint;
begin
  v_before := pg_temp.events('organization_unfollowed', v_org);

  update public.organization_follows
     set is_following = false, unfollowed_at = now(), updated_at = now()
   where follower_user_id = v_user and organization_id = v_org;

  perform pg_temp.expect('7.05 unfollowing creates exactly one event',
    pg_temp.events('organization_unfollowed', v_org) = v_before + 1);
end $$;

-- §6's other half: a SECOND genuine follow, later, must NOT be swallowed by
-- the first. A permanent dedupe key here would make the social funnel
-- monotonically wrong and nothing would ever surface it.
do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_user uuid := '33330000-0000-4000-8000-000000000004';
  v_before bigint;
begin
  v_before := pg_temp.events('organization_followed', v_org);

  -- Real time, not a fabricated future one: the emitter correctly refuses an
  -- event dated ahead of now(), and the dedupe key is microsecond-resolved so
  -- two transitions in the same second still separate.
  update public.organization_follows
     set is_following = true, followed_at = now(),
         unfollowed_at = null, updated_at = now()
   where follower_user_id = v_user and organization_id = v_org;

  perform pg_temp.expect('7.06 a genuine RE-follow is a separate event',
    pg_temp.events('organization_followed', v_org) = v_before + 1,
    'repeats are legitimate; only duplicates of one transition are absorbed');
end $$;

do $$
declare
  v_pro uuid;
  v_before bigint;
begin
  select professional_id into v_pro from public.barbers
  where id = '33334000-0000-4000-8000-000000000001';

  v_before := (select count(*) from public.analytics_events
               where event_name = 'professional_followed' and professional_id = v_pro);

  insert into public.professional_follows
    (follower_user_id, professional_id, state, source, followed_at)
  values ('33330000-0000-4000-8000-000000000005', v_pro, 'following', 'manual', now())
  on conflict (follower_user_id, professional_id) do nothing;

  perform pg_temp.expect('7.07 following a professional creates one event',
    (select count(*) from public.analytics_events
     where event_name = 'professional_followed' and professional_id = v_pro) = v_before + 1);

  perform pg_temp.expect('7.08 the professional follow carries no organization',
    exists (select 1 from public.analytics_events
            where event_name = 'professional_followed'
              and professional_id = v_pro and organization_id is null),
    'the edge is to a durable identity that outlives any shop placement');

  perform pg_temp.expect('7.09 the follow source is recorded',
    exists (select 1 from public.analytics_events
            where event_name = 'professional_followed' and professional_id = v_pro
              and properties ->> 'source' = 'manual'));
exception when others then
  perform pg_temp.record('7.07 following a professional creates one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_before bigint;
  v_fav uuid;
begin
  v_before := pg_temp.events('organization_favorited', v_org);

  insert into public.customer_favorites (user_id, organization_id)
  values ('33330000-0000-4000-8000-000000000004', v_org)
  returning id into v_fav;

  perform pg_temp.expect('7.10 favoriting a shop creates one event',
    pg_temp.events('organization_favorited', v_org) = v_before + 1);

  perform pg_temp.expect('7.11 the favorite records its scope',
    exists (select 1 from public.analytics_events
            where event_name = 'organization_favorited' and organization_id = v_org
              and properties ->> 'scope' = 'shop'));

  v_before := pg_temp.events('organization_unfavorited', v_org);
  delete from public.customer_favorites where id = v_fav;

  perform pg_temp.expect('7.12 removing a favorite creates one event',
    pg_temp.events('organization_unfavorited', v_org) = v_before + 1);
exception when others then
  perform pg_temp.record('7.10 favoriting a shop creates one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 8. BOOKING LIFECYCLE
-- ============================================================================

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_appt uuid;
  v_before bigint;
begin
  v_before := pg_temp.events('appointment_created', v_org);

  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id,
     customer_name, starts_at, ends_at, status)
  values ('33336000-0000-4000-8000-000000000001', v_org,
     '33332000-0000-4000-8000-000000000001', '33334000-0000-4000-8000-000000000001',
     '33335000-0000-4000-8000-000000000001', 'R3 Customer',
     now() + interval '2 days', now() + interval '2 days 30 minutes', 'confirmed')
  returning id into v_appt;

  perform pg_temp.expect('8.01 creating an appointment creates one event',
    pg_temp.events('appointment_created', v_org) = v_before + 1);

  perform pg_temp.expect('8.02 the event carries the durable professional identity',
    exists (select 1 from public.analytics_events
            where event_name = 'appointment_created' and appointment_id = v_appt
              and professional_id is not null),
    'barber_id is a placement; professional_id survives them changing shop');

  perform pg_temp.expect('8.03 the event carries no customer contact detail',
    not exists (
      select 1 from public.analytics_events e, jsonb_object_keys(e.properties) k
      where e.appointment_id = v_appt
        and (k ilike '%name%' or k ilike '%phone%' or k ilike '%email%' or k ilike '%starts%')));

  v_before := pg_temp.events('appointment_completed', v_org);

  update public.appointments set status = 'completed' where id = v_appt;

  perform pg_temp.expect('8.04 completion creates EXACTLY ONE event',
    pg_temp.events('appointment_completed', v_org) = v_before + 1,
    'the conversion event of the entire customer funnel');

  perform pg_temp.expect('8.05 completion is timed by completed_at, not by now()',
    (select e.occurred_at = a.completed_at
     from public.analytics_events e join public.appointments a on a.id = e.appointment_id
     where e.event_name = 'appointment_completed' and e.appointment_id = v_appt));
exception when others then
  perform pg_temp.record('8.01 creating an appointment creates one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- IDEMPOTENCY UNDER RETRY. R1A's transition guard refuses to leave a terminal
-- state, so a retried completion cannot produce a second event — and even if a
-- trigger fired twice, the permanent dedupe key absorbs it.
do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_before bigint;
begin
  v_before := pg_temp.events('appointment_completed', v_org);

  begin
    update public.appointments set status = 'completed'
    where id = '33336000-0000-4000-8000-000000000001';
  exception when others then
    null; -- the transition guard refusing is the expected outcome
  end;

  perform pg_temp.expect('8.06 a retried completion never double-counts',
    pg_temp.events('appointment_completed', v_org) = v_before);

  perform pg_temp.expect('8.07 exactly one row carries the completion dedupe key',
    (select count(*) from public.analytics_events
     where dedupe_key = 'appointment:33336000-0000-4000-8000-000000000001:completed') = 1);
end $$;

-- A FAILED business action must produce NO success event. This is §5 stated
-- as an experiment rather than a principle.
do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_before bigint;
begin
  v_before := pg_temp.events('appointment_completed', v_org);

  begin
    -- An impossible transition: R1A forbids leaving a terminal state.
    update public.appointments set status = 'cancelled'
    where id = '33336000-0000-4000-8000-000000000001';
    perform pg_temp.record('8.08 a refused transition emits no event', 'FAIL',
      'the illegal transition was accepted');
  exception when others then
    perform pg_temp.expect('8.08 a refused transition emits no event',
      pg_temp.events('appointment_completed', v_org) = v_before
      and pg_temp.events('appointment_cancelled', v_org) = 0);
  end;
end $$;

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_appt uuid := '33336000-0000-4000-8000-000000000002';
  v_before bigint;
begin
  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id,
     customer_name, starts_at, ends_at, status)
  values (v_appt, v_org, '33332000-0000-4000-8000-000000000001',
     '33334000-0000-4000-8000-000000000001', '33335000-0000-4000-8000-000000000001',
     'R3 Cancel', now() + interval '3 days', now() + interval '3 days 30 minutes', 'confirmed');

  v_before := pg_temp.events('appointment_cancelled', v_org);
  update public.appointments set status = 'cancelled' where id = v_appt;

  perform pg_temp.expect('8.09 cancellation creates one event',
    pg_temp.events('appointment_cancelled', v_org) = v_before + 1);
exception when others then
  perform pg_temp.record('8.09 cancellation creates one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 9. QUEUE LIFECYCLE
-- ============================================================================

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_entry uuid := '33337000-0000-4000-8000-000000000001';
  v_before bigint;
begin
  v_before := pg_temp.events('queue_joined', v_org);

  insert into public.queue_entries
    (id, organization_id, location_id, barber_id, service_id, customer_name, status)
  values (v_entry, v_org, '33332000-0000-4000-8000-000000000001',
     '33334000-0000-4000-8000-000000000001', '33335000-0000-4000-8000-000000000001',
     'R3 Walkin', 'waiting');

  perform pg_temp.expect('9.01 joining the queue creates one event',
    pg_temp.events('queue_joined', v_org) = v_before + 1);

  update public.queue_entries set status = 'called' where id = v_entry;
  perform pg_temp.expect('9.02 being called creates one event',
    pg_temp.events('queue_called', v_org) = 1);

  update public.queue_entries set status = 'in_service' where id = v_entry;
  perform pg_temp.expect('9.03 service starting creates one event',
    pg_temp.events('queue_service_started', v_org) = 1);

  v_before := pg_temp.events('queue_completed', v_org);
  update public.queue_entries set status = 'completed' where id = v_entry;

  perform pg_temp.expect('9.04 queue completion creates exactly one event',
    pg_temp.events('queue_completed', v_org) = v_before + 1);

  perform pg_temp.expect('9.05 queue completion is timed by the server-stamped column',
    (select e.occurred_at = q.completed_at
     from public.analytics_events e join public.queue_entries q on q.id = e.queue_entry_id
     where e.event_name = 'queue_completed' and e.queue_entry_id = v_entry),
    'R1A stamps these server-side and discards client-supplied values');

  perform pg_temp.expect('9.06 "any available barber" is recorded as a fact',
    exists (select 1 from public.analytics_events
            where event_name = 'queue_joined' and queue_entry_id = v_entry
              and properties ->> 'requested_specific_barber' = 'true'));
exception when others then
  perform pg_temp.record('9.01 joining the queue creates one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 10. THE COMMERCIAL SNAPSHOT (§8)
--
-- The failure this catches is invisible: if plan_key were joined at read time
-- instead of frozen at write time, every historical report would silently
-- re-attribute itself the moment a shop changed plan, and no test that only
-- looked at today's numbers would notice.
-- ============================================================================

select pg_temp.expect('10.01 events captured the plan in force at the time',
  (select plan_key from public.analytics_events
   where event_name = 'appointment_completed'
     and organization_id = '33331000-0000-4000-8000-000000000001'
   limit 1) = 'salon_pro',
  (select coalesce(plan_key, 'null') from public.analytics_events
   where event_name = 'appointment_completed'
     and organization_id = '33331000-0000-4000-8000-000000000001' limit 1));

select pg_temp.expect('10.02 the commercial family was captured too',
  (select commercial_family::text from public.analytics_events
   where event_name = 'appointment_completed'
     and organization_id = '33331000-0000-4000-8000-000000000001'
   limit 1) = 'salon');

-- Now move the shop to a different plan and prove HISTORY DOES NOT MOVE.
do $$
declare v_org uuid := '33331000-0000-4000-8000-000000000001';
begin
  update public.organization_commercial_state
     set plan_key = 'salon_essential'
   where organization_id = v_org;

  perform pg_temp.expect('10.03 changing plan does not rewrite historical events',
    (select plan_key from public.analytics_events
     where event_name = 'appointment_completed' and organization_id = v_org
     limit 1) = 'salon_pro',
    'a service delivered on salon_pro was delivered on salon_pro, forever');

  -- And a NEW event records the new terms, so the snapshot is live rather
  -- than merely frozen at install time.
  insert into public.queue_entries
    (id, organization_id, location_id, barber_id, service_id, customer_name, status)
  values ('33337000-0000-4000-8000-000000000002', v_org,
     '33332000-0000-4000-8000-000000000001', '33334000-0000-4000-8000-000000000001',
     '33335000-0000-4000-8000-000000000001', 'R3 After Downgrade', 'waiting');

  perform pg_temp.expect('10.04 a new event records the NEW terms',
    (select plan_key from public.analytics_events
     where queue_entry_id = '33337000-0000-4000-8000-000000000002'
       and event_name = 'queue_joined') = 'salon_essential');

  update public.organization_commercial_state set plan_key = 'salon_pro'
   where organization_id = v_org;
exception when others then
  perform pg_temp.record('10.03 changing plan does not rewrite historical events', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect('10.05 plan assignment itself is measured',
  pg_temp.events('plan_assigned', '33331000-0000-4000-8000-000000000001') >= 1);


-- ============================================================================
-- 11. ANALYTICS FAILURE MUST NOT BREAK THE PRODUCT (§14)
--
-- The most important section in this file. Everything else here protects a
-- number; this protects a customer.
-- ============================================================================

do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_user uuid := '33330000-0000-4000-8000-000000000006';
  v_rejects_before bigint;
  v_followed boolean;
begin
  v_rejects_before := (select count(*) from public.analytics_ingestion_rejections);

  -- Break emission for real, by removing the event contract the follow trigger
  -- depends on. Nothing subtler would prove the point: a mocked failure tests
  -- the mock.
  delete from public.analytics_event_definitions where event_name = 'organization_followed';

  insert into public.organization_follows
    (follower_user_id, organization_id, is_following, followed_at)
  values (v_user, v_org, true, now())
  on conflict (follower_user_id, organization_id) do nothing;

  select is_following into v_followed
  from public.organization_follows
  where follower_user_id = v_user and organization_id = v_org;

  perform pg_temp.expect('11.01 the Follow SUCCEEDS while analytics is broken',
    coalesce(v_followed, false),
    'analytics must never be able to refuse a customer''s action');

  perform pg_temp.expect('11.02 the failure was recorded, not swallowed silently',
    (select count(*) from public.analytics_ingestion_rejections) > v_rejects_before);

  perform pg_temp.expect('11.03 the rejection names the event and the stage',
    exists (select 1 from public.analytics_ingestion_rejections
            where event_name = 'organization_followed' and stage = 'server_emit'));

  perform pg_temp.expect('11.04 the rejection stores no payload',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'analytics_ingestion_rejections'
        and column_name in ('properties','payload','actor_user_id')),
    'a rejected payload is the likeliest place for forbidden PII to survive');

  -- Restore the contract.
  insert into public.analytics_event_definitions
    (event_name, event_version, family, emission, status, is_idempotent, requires_organization, description)
  values ('organization_followed', 1, 'social', 'server', 'wired', false, true,
          'A customer began following a barbershop.')
  on conflict (event_name) do nothing;
exception when others then
  perform pg_temp.record('11.01 the Follow SUCCEEDS while analytics is broken', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 12. THE READ CONTRACTS — tenant isolation
-- ============================================================================

select pg_temp.expect('12.01 an outsider cannot read a shop''s analytics',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000006',
    $q$select * from public.get_organization_analytics_summary(
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) = '42501');

select pg_temp.expect('12.02 a RIVAL TENANT''S OWNER cannot read it either',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000007',
    $q$select * from public.get_organization_analytics_summary(
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) = '42501',
  'the core multi-tenancy claim, exercised against a real second tenant');

-- A barber is a member of the organization. `is_org_member` would have let
-- them read the shop's conversion rates; `has_org_role` does not.
select pg_temp.expect('12.03 an ordinary barber cannot read shop analytics',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000003',
    $q$select * from public.get_organization_analytics_summary(
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) = '42501');

select pg_temp.expect('12.04 the owner CAN read their own analytics',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000001',
    $q$select * from public.get_organization_analytics_summary(
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) = 'ALLOWED');

select pg_temp.expect('12.05 a manager can read them',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000002',
    $q$select * from public.get_organization_analytics_summary(
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) = 'ALLOWED');

select pg_temp.expect('12.06 an unknown organization id is refused, not answered with zeros',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000001',
    $q$select * from public.get_organization_analytics_summary(
        '00000000-0000-4000-8000-0000000000aa'::uuid)$q$) = '42501',
  'answering with zeros would confirm the id does not exist');

select pg_temp.expect('12.07 the platform funnel refuses a non-admin',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000001',
    'select * from public.get_platform_analytics_funnel()') = '42501');

select pg_temp.expect('12.08 the platform funnel admits a platform admin',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000008',
    'select * from public.get_platform_analytics_funnel()') = 'ALLOWED');

select pg_temp.expect('12.09 an oversized window is refused',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000001',
    $q$select * from public.get_organization_analytics_summary(
        '33331000-0000-4000-8000-000000000001'::uuid,
        now() - interval '900 days', now())$q$) = '22023',
  'an unbounded aggregate over an append-only log grows without limit');

-- The read contracts must return AGGREGATES ONLY. A column named for an actor
-- or a session would hand a shop owner the identity of everyone who looked at
-- their profile.
do $$
declare v_bad text;
begin
  select string_agg(format('%s.%s', p.proname, a), ', ') into v_bad
  from pg_proc p, unnest(coalesce(p.proargnames, array[]::text[])) a
  where p.proname in ('get_organization_analytics_summary','get_professional_analytics_summary',
                      'get_organization_retention_cohort','get_platform_analytics_funnel')
    -- Precise, not substring: `distinct_anonymous_sessions` is a COUNT and is
    -- exactly what §13 asks for. What must never appear is an identity —
    -- a session_id, an actor id, an account or an address.
    and (a ilike '%actor%' or a = 'session_id' or a ilike '%user_id%'
         or a ilike '%email%' or a ilike '%customer_name%');

  perform pg_temp.expect('12.10 no read contract projects an actor or a session',
    v_bad is null, v_bad);
end $$;

-- And the numbers are actually right.
do $$
declare
  v_completed bigint;
  v_follows bigint;
  v_queue bigint;
begin
  perform pg_temp.become('33330000-0000-4000-8000-000000000001');
  select appointments_completed, follows, queue_completions
    into v_completed, v_follows, v_queue
  from public.get_organization_analytics_summary(
    '33331000-0000-4000-8000-000000000001'::uuid,
    now() - interval '1 day', now() + interval '1 day');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('12.11 the summary counts the completed appointment',
    v_completed = 1, v_completed::text);
  perform pg_temp.expect('12.12 the summary counts the follows',
    v_follows >= 1, v_follows::text);
  perform pg_temp.expect('12.13 the summary counts the queue completion',
    v_queue = 1, v_queue::text);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('12.11 the summary counts the completed appointment', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare v_rate numeric;
begin
  perform pg_temp.become('33330000-0000-4000-8000-000000000001');
  select booking_conversion_rate into v_rate
  from public.get_organization_analytics_summary(
    '33331000-0000-4000-8000-000000000001'::uuid,
    now() - interval '1 day', now() + interval '1 day');
  perform pg_temp.become_postgres();

  -- Two appointments created, one completed.
  perform pg_temp.expect('12.14 the conversion rate divides by appointments CREATED',
    v_rate = 0.5000, coalesce(v_rate::text, 'null'));
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('12.14 the conversion rate divides by appointments CREATED', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- A tenant with no activity gets NULL, not 0%. "No answer" and "0% success"
-- are different statements and a shop reads them very differently.
do $$
declare v_rate numeric;
begin
  perform pg_temp.become('33330000-0000-4000-8000-000000000007');
  select booking_conversion_rate into v_rate
  from public.get_organization_analytics_summary(
    '33331000-0000-4000-8000-000000000002'::uuid,
    now() - interval '1 day', now() + interval '1 day');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('12.15 no bookings yields NULL, never 0%%',
    v_rate is null, coalesce(v_rate::text, 'null'));
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('12.15 no bookings yields NULL, never 0%%', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- The rival tenant's own summary must not contain this tenant's rows.
do $$
declare v_total bigint;
begin
  perform pg_temp.become('33330000-0000-4000-8000-000000000007');
  select appointments_created + queue_joins + follows into v_total
  from public.get_organization_analytics_summary(
    '33331000-0000-4000-8000-000000000002'::uuid,
    now() - interval '1 day', now() + interval '1 day');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('12.16 one tenant''s summary contains none of another''s events',
    v_total = 0, v_total::text);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('12.16 one tenant''s summary contains none of another''s events', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- The professional's own numbers are theirs, not their employer's.
do $$
declare v_pro uuid; v_state text;
begin
  select professional_id into v_pro from public.barbers
  where id = '33334000-0000-4000-8000-000000000001';

  v_state := pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000001',
    format($q$select * from public.get_professional_analytics_summary(%L::uuid)$q$, v_pro));

  perform pg_temp.expect('12.17 a shop owner cannot read their barber''s cross-shop numbers',
    v_state = '42501', v_state);

  v_state := pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000003',
    format($q$select * from public.get_professional_analytics_summary(%L::uuid)$q$, v_pro));

  perform pg_temp.expect('12.18 the professional CAN read their own', v_state = 'ALLOWED', v_state);
end $$;

select pg_temp.expect('12.19 the retention cohort contract exists and is role-gated',
  pg_temp.sqlstate_as('33330000-0000-4000-8000-000000000006',
    $q$select * from public.get_organization_retention_cohort(
        '33331000-0000-4000-8000-000000000001'::uuid)$q$) = '42501');


-- ============================================================================
-- 13. PASSPORT AND ACQUISITION
-- ============================================================================

do $$
declare v_before bigint;
begin
  v_before := pg_temp.events('passport_issued');

  insert into public.customer_passports (user_id)
  values ('33330000-0000-4000-8000-000000000006')
  on conflict (user_id) do nothing;

  perform pg_temp.expect('13.01 issuing a Passport creates one event',
    pg_temp.events('passport_issued') >= v_before);

  perform pg_temp.expect('13.02 the Passport event carries no preference content',
    not exists (
      select 1 from public.analytics_events e, jsonb_object_keys(e.properties) k
      where e.event_name = 'passport_issued'
        and (k ilike '%haircut%' or k ilike '%fade%' or k ilike '%beard%' or k ilike '%length%')),
    '§17 — private Passport history is never exposed through analytics');

  perform pg_temp.expect('13.03 the Passport event carries no organization',
    not exists (select 1 from public.analytics_events
                where event_name = 'passport_issued' and organization_id is not null),
    'the Passport is customer-owned and portable');
exception when others then
  perform pg_temp.record('13.01 issuing a Passport creates one event', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- 13.04-13.08 — THE CROSS-LOT CHAIN, exercised rather than assumed.
--
-- A completed appointment with real account attribution sets off three R1B
-- triggers before any R3 trigger sees it: auto-follow on entry to confirmed,
-- relationship recording on entry to completed, and the relationship's own
-- INSERT. R3 instruments the last two of those and the first indirectly. The
-- previous version of this check asserted `count >= 0`, which is true of every
-- possible database and therefore tested nothing — it would have passed with
-- the relationship trigger deleted.
--
-- booked_by_user_id is what all of this keys on: R1B chose it because it is
-- the only account attribution a shop cannot fabricate.
do $$
declare
  v_org uuid := '33331000-0000-4000-8000-000000000001';
  v_customer uuid := '33330000-0000-4000-8000-000000000009';
  v_appt uuid := '33336000-0000-4000-8000-000000000010';
  v_pro uuid;
  v_rel_before bigint;
  v_follow_before bigint;
  v_count integer;
begin
  select professional_id into v_pro from public.barbers
  where id = '33334000-0000-4000-8000-000000000001';

  v_rel_before := pg_temp.events('passport_relationship_created', v_org);
  v_follow_before := (select count(*) from public.analytics_events
                      where event_name = 'professional_followed'
                        and professional_id = v_pro);

  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id,
     customer_name, booked_by_user_id, starts_at, ends_at, status)
  values (v_appt, v_org, '33332000-0000-4000-8000-000000000001',
     '33334000-0000-4000-8000-000000000001', '33335000-0000-4000-8000-000000000001',
     'R3 Chain', v_customer,
     now() + interval '20 days', now() + interval '20 days' + interval '30 minutes',
     'confirmed');

  -- R1B auto-follows on entry to confirmed. R3 must record that as a follow
  -- whose SOURCE is auto — a follower count that cannot separate a deliberate
  -- follow from one earned by a booking is not evidence of anything.
  perform pg_temp.expect('13.04 an auto-follow is measured, and marked auto',
    exists (select 1 from public.analytics_events
            where event_name = 'professional_followed'
              and professional_id = v_pro
              and properties ->> 'source' = 'auto'),
    'R1B creates the edge; R3 must not report it as a manual follow');

  update public.appointments set status = 'completed' where id = v_appt;

  perform pg_temp.expect('13.05 a first completed service creates one relationship event',
    pg_temp.events('passport_relationship_created', v_org) = v_rel_before + 1,
    format('before=%s after=%s', v_rel_before,
           pg_temp.events('passport_relationship_created', v_org)));

  perform pg_temp.expect('13.06 the relationship event names the durable identity',
    exists (select 1 from public.analytics_events
            where event_name = 'passport_relationship_created'
              and organization_id = v_org and professional_id = v_pro));

  -- THE TRANSFORMATION THAT MUST *NOT* PRODUCE AN EVENT. A second service by
  -- the same customer with the same professional UPDATES the existing
  -- relationship row rather than inserting one. The R3 trigger is INSERT-only,
  -- so the count must not move — while the relationship's own counter does.
  v_rel_before := pg_temp.events('passport_relationship_created', v_org);

  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id,
     customer_name, booked_by_user_id, starts_at, ends_at, status)
  values ('33336000-0000-4000-8000-000000000011', v_org,
     '33332000-0000-4000-8000-000000000001', '33334000-0000-4000-8000-000000000001',
     '33335000-0000-4000-8000-000000000001', 'R3 Chain Two', v_customer,
     now() + interval '25 days', now() + interval '25 days' + interval '30 minutes',
     'confirmed');
  update public.appointments set status = 'completed'
   where id = '33336000-0000-4000-8000-000000000011';

  select completed_interaction_count into v_count
  from public.customer_professional_relationships
  where customer_user_id = v_customer and professional_id = v_pro
    and organization_id = v_org;

  perform pg_temp.expect('13.07 a returning customer increments the relationship',
    v_count = 2, coalesce(v_count::text, 'null'));

  perform pg_temp.expect('13.08 but creates NO second relationship-created event',
    pg_temp.events('passport_relationship_created', v_org) = v_rel_before,
    'the event marks a relationship coming into existence, not every visit');
exception when others then
  perform pg_temp.record('13.04 an auto-follow is measured, and marked auto', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- §9: the same real professional found through several sources must convert
-- ONCE. The linkage table is unique per prospect, and the event is keyed on
-- the professional, so multi-source discovery cannot inflate the count.
select pg_temp.expect('13.05 the acquisition event hangs off the unified linkage',
  exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'prospect_professionals'
      and t.tgname = 'prospect_professionals_analytics'
      and not t.tgisinternal),
  'hooking `professionals` instead would count every identity as an acquisition');

select pg_temp.expect('13.06 external_profile_created is keyed on the professional, not the source',
  (select is_idempotent from public.analytics_event_definitions
   where event_name = 'external_profile_created'));

select pg_temp.expect('13.07 the platform funnel counts DISTINCT converted professionals',
  (select p.prosrc ilike '%count(distinct s.professional_id)%'
   from pg_proc p where p.proname = 'get_platform_analytics_funnel'),
  'counting approval events instead would undo the emitter''s care');


-- ============================================================================
-- 14. EVENT VERSIONING (§7)
-- ============================================================================

select pg_temp.expect('14.01 every recorded event carries a version',
  not exists (select 1 from public.analytics_events where event_version is null or event_version < 1));

select pg_temp.expect('14.02 the version is stamped from the registry, not joined at read time',
  (select p.prosrc ilike '%v_def.event_version%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'emit_analytics_event'),
  'joining at read time would retroactively relabel every historical row');


-- ============================================================================
-- 15. WHICH PATH IS THIS?
--
-- One VERIFY file serves two genuinely different tests, and they must not be
-- allowed to blur into each other:
--
--   FRESH    every migration replayed in order onto an empty database.
--            Proves the lot installs correctly and behaves correctly.
--
--   UPGRADE  the base replay stopped immediately before R3, a populated
--            pre-analytics database seeded on top, then MASTER applied.
--            Proves the lot can be installed over a LIVE product without
--            rewriting its history or breaking its trade.
--
-- The fresh path cannot test preservation, because there is nothing to
-- preserve. The upgrade path is the only one that can. So each path asserts
-- what it is actually able to assert, and — importantly — each asserts that it
-- IS the path it thinks it is. A mis-invoked run that silently took the fresh
-- path while the operator believed they were testing an upgrade would report a
-- clean sheet having tested nothing about upgrading at all.
-- ============================================================================

create or replace function pg_temp.is_upgrade_run()
returns boolean language sql stable as $$
  select to_regclass('r3_upgrade_baseline.snapshot') is not null
     and exists (select 1 from public.organizations
                 where id = '44441000-0000-4000-8000-000000000001');
$$;

do $$
begin
  if pg_temp.is_upgrade_run() then
    perform pg_temp.record('15.00 test path', 'INFO',
      'UPGRADE — pre-R3 baseline + populated seed + MASTER. Section 16 asserts; section 17 is skipped.');
  else
    perform pg_temp.record('15.00 test path', 'INFO',
      'FRESH — full migration replay onto an empty database. Section 17 asserts; section 16 is skipped.');
  end if;
end $$;

-- The two markers must never both be present, and never both absent. Either
-- would mean the harness did something other than what it was asked, and every
-- conclusion drawn from the run would be about a database nobody described.
select pg_temp.expect('15.01 the run is unambiguously one path or the other',
  (to_regclass('r3_upgrade_baseline.snapshot') is not null)
    = (exists (select 1 from public.organizations
               where id = '44441000-0000-4000-8000-000000000001')),
  'the seed schema and the seeded tenant must appear together or not at all');


-- ============================================================================
-- 16. UPGRADE PATH — PRESERVATION AND FORWARD CORRECTNESS
--
-- Skipped entirely on a fresh run. Every check here is either a proof that
-- pre-R3 data survived UNCHANGED, or a proof that the product still transforms
-- correctly afterwards. There are no presence checks: "the follow is still
-- there" passes just as happily against a migration that repointed it.
-- ============================================================================

-- 16.01-16.09 — PRESERVATION, BY FINGERPRINT.
--
-- The seed recorded an md5 over an ordered projection of every row that
-- constitutes this tenant's history, immediately before MASTER ran. Here the
-- SAME function recomputes it. A changed value, an added row, a removed row
-- and a reordered set are all a different digest.
--
-- Sharing r3_upgrade_baseline.digest() between the two sides is the whole
-- point: a VERIFY that re-implemented the projection could drift from the seed
-- and produce two different queries agreeing about nothing — which looks
-- exactly like a passing test.
-- One row per entity, numbered in a plain counter rather than a window
-- function, so a failure says WHICH part of the shop's history moved instead
-- of only that something did.
do $$
declare
  r record;
  v_now_count bigint;
  v_now_fp text;
  v_i integer := 0;
begin
  if not pg_temp.is_upgrade_run() then
    perform pg_temp.record('16.00 upgrade preservation', 'INFO',
      'skipped — fresh run, there is no pre-R3 history to preserve');
    return;
  end if;

  for r in select entity, row_count, fingerprint from r3_upgrade_baseline.snapshot order by entity loop
    v_i := v_i + 1;
    select d.row_count, d.fingerprint into v_now_count, v_now_fp
    from r3_upgrade_baseline.digest(r.entity) d;

    perform pg_temp.expect(
      format('16.%s %s survived the upgrade unchanged', lpad(v_i::text, 2, '0'), r.entity),
      v_now_fp = r.fingerprint and v_now_count = r.row_count,
      case
        when v_now_count <> r.row_count
          then format('row count moved: %s -> %s', r.row_count, v_now_count)
        when v_now_fp <> r.fingerprint
          then format('%s row(s) unchanged in number but changed in content (%s -> %s)',
                      r.row_count, left(r.fingerprint, 12), left(v_now_fp, 12))
        else format('%s row(s)', r.row_count)
      end);
  end loop;
end $$;

-- 16.10-16.14 — NO FABRICATED HISTORY.
--
-- Stronger than "the tenant has no events", because the seeded tenant does not
-- merely have completed appointments: R1B's triggers already turned those into
-- a professional_follows edge and a customer_professional_relationships row
-- before R3 existed. Those are exactly the facts a well-meaning backfill would
-- have reached for. None of them may have produced an event.
do $$
declare
  v_org uuid := '44441000-0000-4000-8000-000000000001';
  v_user uuid := '44440000-0000-4000-8000-000000000003';
  v_rels integer;
  v_follows integer;
begin
  if not pg_temp.is_upgrade_run() then
    return;
  end if;

  perform pg_temp.expect('16.10 the upgrade fabricated NO events for the tenant',
    (select count(*) from public.analytics_events where organization_id = v_org) = 0,
    (select count(*)::text from public.analytics_events where organization_id = v_org));

  -- The pre-existing facts a backfill would have mined, proven to exist...
  select count(*) into v_rels from public.customer_professional_relationships
   where organization_id = v_org;
  select count(*) into v_follows from public.professional_follows
   where follower_user_id = v_user;

  perform pg_temp.expect('16.11 the pre-R3 relationship really does exist',
    v_rels >= 1, v_rels::text || ' relationship(s)');
  perform pg_temp.expect('16.12 the pre-R3 auto-follow really does exist',
    v_follows >= 1, v_follows::text || ' follow(s)');

  -- ...and proven to have produced nothing.
  perform pg_temp.expect('16.13 and neither produced a fabricated event',
    not exists (
      select 1 from public.analytics_events
      where event_name in ('passport_relationship_created', 'professional_followed',
                           'organization_followed', 'organization_favorited',
                           'passport_issued', 'appointment_completed', 'queue_completed')
        and (organization_id = v_org or actor_user_id = v_user)),
    'there is no honest occurred_at, actor or plan for a service delivered before instrumentation');

  -- Measured at file entry, not here: by this point the suite's own sections
  -- have deliberately emitted events, and asserting a global zero now would
  -- assert that this file had done nothing.
  perform pg_temp.expect('16.14 MASTER wrote no event anywhere, not merely none for this tenant',
    (select events_at_entry from verify_entry_state) = 0,
    (select events_at_entry::text from verify_entry_state));

  perform pg_temp.expect('16.15 and MASTER logged no ingestion rejection either',
    (select rejections_at_entry from verify_entry_state) = 0,
    'a rejection at install time would mean a trigger fired during the migration');
end $$;

-- 16.20-16.29 — FORWARD CORRECTNESS.
--
-- The shop must still be able to trade, and everything from the upgrade
-- forward must be measured correctly. This is where the thirteen new triggers
-- meet rows they did not create.
--
-- Deliberately ordered AFTER the preservation checks: these mutate the seeded
-- data on purpose, and running them first would destroy the thing 16.01-16.09
-- exists to measure.
do $$
declare
  v_org uuid := '44441000-0000-4000-8000-000000000001';
  v_user uuid := '44440000-0000-4000-8000-000000000003';
  v_appt uuid := '44445000-0000-4000-8000-000000000003';
  v_entry uuid := '44446000-0000-4000-8000-000000000002';
  v_pro uuid;
  v_rel_count_before integer;
  v_rel_count_after integer;
begin
  if not pg_temp.is_upgrade_run() then
    return;
  end if;

  select professional_id into v_pro from public.barbers
  where id = '44443000-0000-4000-8000-000000000001';

  select completed_interaction_count into v_rel_count_before
  from public.customer_professional_relationships
  where customer_user_id = v_user and professional_id = v_pro and organization_id = v_org;

  -- The live commitment, completed through its real lifecycle.
  update public.appointments set status = 'completed' where id = v_appt;

  perform pg_temp.expect('16.20 a seeded commitment can still be completed after the upgrade',
    (select status::text from public.appointments where id = v_appt) = 'completed',
    'if any of the thirteen new triggers raised, a working shop would have stopped trading');

  perform pg_temp.expect('16.21 the completion time is server-stamped, not seeded',
    (select completed_at is not null and completed_at > now() - interval '1 minute'
     from public.appointments where id = v_appt),
    'R1A stamps it on the transition; the seed left it NULL');

  perform pg_temp.expect('16.22 that completion produced EXACTLY ONE event',
    (select count(*) from public.analytics_events
     where appointment_id = v_appt and event_name = 'appointment_completed') = 1,
    'history is not invented, but everything from the upgrade forward is recorded');

  perform pg_temp.expect('16.23 the event is timed by completed_at, not by ingest time',
    (select e.occurred_at = a.completed_at
     from public.analytics_events e join public.appointments a on a.id = e.appointment_id
     where e.event_name = 'appointment_completed' and e.appointment_id = v_appt));

  perform pg_temp.expect('16.24 the event carries the durable identity behind the seeded barber',
    (select professional_id from public.analytics_events
     where appointment_id = v_appt and event_name = 'appointment_completed') = v_pro,
    'derived from barbers.professional_id, a row the seed created and R3 did not touch');

  perform pg_temp.expect('16.25 the event captured the plan actually in force',
    (select plan_key from public.analytics_events
     where appointment_id = v_appt and event_name = 'appointment_completed') = 'salon_pro');

  -- THE TRANSFORMATION, not a presence check: the seeded relationship row
  -- already existed with a count, and this completion must INCREMENT it
  -- without producing a second relationship-created event.
  select completed_interaction_count into v_rel_count_after
  from public.customer_professional_relationships
  where customer_user_id = v_user and professional_id = v_pro and organization_id = v_org;

  perform pg_temp.expect('16.26 the pre-existing relationship was incremented, not replaced',
    v_rel_count_after = v_rel_count_before + 1,
    format('%s -> %s', coalesce(v_rel_count_before::text, 'null'),
                       coalesce(v_rel_count_after::text, 'null')));

  perform pg_temp.expect('16.27 incrementing it produced no relationship-created event',
    (select count(*) from public.analytics_events
     where event_name = 'passport_relationship_created' and organization_id = v_org) = 0,
    'the relationship came into existence before R3; only its counter moved');

  -- The customer standing in the shop while the upgrade ran.
  update public.queue_entries set status = 'completed' where id = v_entry;

  perform pg_temp.expect('16.28 a waiting walk-in can still be served after the upgrade',
    (select status::text from public.queue_entries where id = v_entry) = 'completed');

  perform pg_temp.expect('16.29 and that service produced exactly one queue event',
    (select count(*) from public.analytics_events
     where queue_entry_id = v_entry and event_name = 'queue_completed') = 1);
exception when others then
  perform pg_temp.record('16.20 a seeded commitment can still be completed after the upgrade',
    'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- 16.30-16.32 — THE MUTATIONS ABOVE CHANGED EXACTLY WHAT THEY MEANT TO.
--
-- Re-fingerprinting after the deliberate changes closes the last hole: without
-- it, a run in which the analytics triggers had also quietly rewritten the
-- follow graph or the favorites would still pass everything above, because
-- nothing after 16.09 looks at them again.
do $$
declare
  v_fp text;
  v_count bigint;
  v_baseline record;
begin
  if not pg_temp.is_upgrade_run() then
    return;
  end if;

  -- Appointments and queue entries SHOULD have moved: two rows changed status.
  select d.fingerprint into v_fp from r3_upgrade_baseline.digest('appointments') d;
  select fingerprint into v_baseline from r3_upgrade_baseline.snapshot where entity = 'appointments';
  perform pg_temp.expect('16.30 the deliberate completion did change the appointments digest',
    v_fp is distinct from v_baseline.fingerprint,
    'a digest that did NOT move would mean the fingerprint is not sensitive to status');

  -- Everything untouched must still be untouched.
  select d.row_count, d.fingerprint into v_count, v_fp
  from r3_upgrade_baseline.digest('organization_follows') d;
  perform pg_temp.expect('16.31 the follow graph was not touched by any of it',
    (select s.fingerprint = v_fp and s.row_count = v_count
     from r3_upgrade_baseline.snapshot s where s.entity = 'organization_follows'));

  select d.row_count, d.fingerprint into v_count, v_fp
  from r3_upgrade_baseline.digest('customer_favorites') d;
  perform pg_temp.expect('16.32 favorites were not touched by any of it',
    (select s.fingerprint = v_fp and s.row_count = v_count
     from r3_upgrade_baseline.snapshot s where s.entity = 'customer_favorites'));
end $$;


-- ============================================================================
-- 17. FRESH PATH — WHAT ONLY THIS PATH CAN ASSERT
--
-- Skipped entirely on an upgrade run. Its job is the mirror image of §16: to
-- make it impossible for a fresh run to be mistaken for an upgrade run, and to
-- assert the property only a full replay can establish — that db/migrations,
-- replayed in filename order onto an empty database, produces exactly the same
-- schema MASTER produces.
-- ============================================================================

do $$
begin
  if pg_temp.is_upgrade_run() then
    perform pg_temp.record('17.00 fresh-path checks', 'INFO',
      'skipped — this was an upgrade run; section 16 asserted instead');
    return;
  end if;

  -- No seed, no seeded tenant, no baseline. Asserted rather than assumed, so
  -- a half-loaded seed cannot leave §16 silently skipped while the summary
  -- still reads clean.
  perform pg_temp.expect('17.01 no upgrade seed leaked into the fresh run',
    to_regclass('r3_upgrade_baseline.snapshot') is null
    and not exists (select 1 from public.organizations
                    where slug = 'seed-r3-salon'));

  -- The property only a replay can prove: the migrations built the analytics
  -- engine on their own, without MASTER. If these are absent on a fresh run,
  -- the lot works only as a concatenated artefact — which would mean a
  -- developer running migrations locally gets a different database from the
  -- one production has.
  perform pg_temp.expect('17.02 the replay alone built the event log',
    to_regclass('public.analytics_events') is not null);

  perform pg_temp.expect('17.03 the replay alone seeded the full taxonomy',
    (select count(*) from public.analytics_event_definitions) = 40,
    (select count(*)::text from public.analytics_event_definitions));

  perform pg_temp.expect('17.04 the replay alone attached all thirteen triggers',
    (select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
       and t.tgname like '%_analytics%') >= 13);

  -- The replay must have emitted NOTHING. Measured at file entry, before this
  -- suite's fixtures existed, so it is an exact count rather than an
  -- id-exclusion heuristic that a new fixture would quietly erode.
  perform pg_temp.expect('17.05 no migration wrote an event at install time',
    (select events_at_entry from verify_entry_state) = 0,
    (select events_at_entry::text from verify_entry_state));

  perform pg_temp.expect('17.06 and no migration logged an ingestion rejection',
    (select rejections_at_entry from verify_entry_state) = 0,
    (select rejections_at_entry::text from verify_entry_state));
end $$;


-- ============================================================================
-- RESULTS
--
-- The path is printed first and separately. A summary that did not say which
-- of the two tests ran is a summary somebody will eventually read as covering
-- both.
-- ============================================================================

\echo ''
\echo '=========== VERIFY: R3 — ANALYTICS AND EVENT ENGINE ==========='

select detail as test_path from verify_results where check_name = '15.00 test path';

select check_name, status, detail from verify_results order by check_name;

\echo ''
\echo '--- summary ---'
select
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail,
  count(*) filter (where status = 'INFO') as info,
  count(*) as total
from verify_results;

\echo ''
\echo '--- failures (expected: none) ---'
select check_name, detail from verify_results where status = 'FAIL' order by check_name;
