-- ============================================================================
-- FadeUp — VERIFY: R1, social-first and acquisition domain foundation
--
-- Companion to MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql.
--
-- Emits one row per check:  check_name | status  where status is
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected result: 0 FAIL rows.
--
-- This file asserts BEHAVIOUR, not that objects were created. The point of R1
-- is a set of invariants — an explicit unfollow survives a later booking, a
-- confirmed booking is not evidence of a haircut, a barber cannot publish a
-- celebrity without consent, an anonymous caller cannot act in someone else's
-- name — and each of those is exercised here against real rows.
--
-- Safe to run repeatedly: every fixture lives inside a transaction that is
-- rolled back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
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
-- claim GUCs are set so this behaves identically on the live stack and on the
-- disposable image.
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

-- Did an operation get REFUSED for a security reason?
--
-- Deliberately NOT `when others`. A catch-all returns true for a typo'd table
-- name, a syntax error, or an unrelated NOT NULL violation — so every
-- "an attacker cannot do X" assertion would pass even if the SQL under test
-- were nonsense, and the suite would look green while testing nothing.
--
-- Only these are treated as a genuine refusal:
--   42501 insufficient_privilege  — a REVOKE or a missing grant
--   P0001 raise_exception         — one of this lot's guard triggers
--   23514 check_violation         — a CHECK constraint
--   23505 unique_violation        — a uniqueness guard
-- Anything else is re-raised, so a broken test fails loudly instead of
-- silently passing.
create or replace function pg_temp.refused(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception
  when insufficient_privilege or raise_exception or check_violation or unique_violation then
    return true;
  when others then
    raise notice 'UNEXPECTED SQLSTATE % in refusal check: %', sqlstate, sqlerrm;
    raise;
end;
$$;

-- Backwards-compatible alias used by a few checks where any failure is the
-- point (kept explicit rather than silently aliasing the strict one).
create or replace function pg_temp.raises(p_sql text)
returns boolean language plpgsql as $$
begin
  return pg_temp.refused(p_sql);
end;
$$;

-- Does an operation raise WHEN PERFORMED BY A SPECIFIC USER?
--
-- This exists because impersonation must set BOTH claim GUCs. The live stack's
-- auth.uid() parses request.jwt.claims; the older auth.uid() on the disposable
-- image reads request.jwt.claim.sub. Setting only the former makes auth.uid()
-- return NULL here — which silently turns every "an attacker cannot do X" test
-- into "an anonymous caller cannot do X", a much weaker and different claim,
-- and it also trips the `auth.uid() is null` server-side stand-down in the
-- guard triggers. pg_temp.become() already sets both; this is its equivalent
-- for the negative assertions.
create or replace function pg_temp.raises_as(p_user_id uuid, p_sql text)
returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return false;
exception
  when insufficient_privilege or raise_exception or check_violation or unique_violation then
    -- The failed subtransaction already restored the role.
    return true;
  when others then
    raise notice 'UNEXPECTED SQLSTATE % in refusal check: %', sqlstate, sqlerrm;
    raise;
end;
$$;

-- How many rows of a table can an anonymous visitor actually see?
--
-- Two different mechanisms can deny anon: an RLS policy that matches no rows
-- (returns 0), or the absence of a table-level SELECT grant (raises
-- "permission denied"). Both are correct answers to "anon must not read
-- this", and R1 uses both — professionals has its SELECT re-granted to
-- authenticated only, while the rest rely on RLS. This collapses the two into
-- the property that actually matters: zero visibility.
create or replace function pg_temp.anon_visible_rows(p_table text)
returns integer language plpgsql as $$
declare
  v_n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  execute format('select count(*) from %s', p_table) into v_n;
  execute 'reset role';
  return v_n;
exception
  when insufficient_privilege then
    -- Denied by a missing table-level SELECT grant. The failed statement
    -- rolled back the SET LOCAL ROLE with its subtransaction.
    return 0;
  when others then
    -- A misspelled table name must NOT read as "anon cannot see it".
    raise notice 'UNEXPECTED SQLSTATE % probing %: %', sqlstate, p_table, sqlerrm;
    raise;
end;
$$;

begin;

-- ============================================================================
-- 0. BACKFILL VERIFICATION  (§31, §70, §71)
--
-- Runs FIRST, before this file creates any fixture of its own, so the counts
-- it compares are still the ones the upgrade produced.
--
-- These checks are conditional on public.r1_backfill_baseline, which only
-- exists when SEED_R1_PRE_UPGRADE_FIXTURE_2026_08_24.sql was loaded before
-- MASTER. On a fresh database there is nothing to backfill and the section
-- reports INFO instead of inventing a result — a skipped check must never
-- look like a passed one.
-- ============================================================================

do $$
declare
  v_has_baseline boolean;
  v_expected bigint;
  v_actual bigint;
  v_mobile uuid;
  v_quiet uuid;
  v_owner uuid;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'r1_backfill_baseline'
  ) into v_has_baseline;

  if not v_has_baseline then
    perform pg_temp.record('0.0 backfill verification', 'INFO',
      'skipped — no pre-upgrade seed present (fresh-database run)');
    return;
  end if;

  select u.id into v_mobile from auth.users u where u.email = 'mobile_pro+seed@fadeup.test';
  select u.id into v_quiet  from auth.users u where u.email = 'quiet_pro+seed@fadeup.test';
  select u.id into v_owner  from auth.users u where u.email = 'owner_a+seed@fadeup.test';

  -- NO DATA LOST. Nothing R1 does may remove a pre-existing row.
  select v into v_expected from public.r1_backfill_baseline where k = 'barbers';
  select count(*) into v_actual from public.barbers;
  perform pg_temp.expect('0.1 no barbers row was lost', v_actual >= v_expected,
    format('before=%s after=%s', v_expected, v_actual));

  select v into v_expected from public.r1_backfill_baseline where k = 'staff_profiles';
  select count(*) into v_actual from public.staff_profiles;
  perform pg_temp.expect('0.2 no staff_profiles row was lost', v_actual >= v_expected,
    format('before=%s after=%s', v_expected, v_actual));

  select v into v_expected from public.r1_backfill_baseline where k = 'memberships';
  select count(*) into v_actual from public.memberships;
  perform pg_temp.expect('0.3 no membership was lost', v_actual >= v_expected,
    format('before=%s after=%s', v_expected, v_actual));

  select v into v_expected from public.r1_backfill_baseline where k = 'customer_profiles';
  select count(*) into v_actual from public.customer_profiles;
  perform pg_temp.expect('0.4 no registered customer was lost', v_actual >= v_expected,
    format('before=%s after=%s', v_expected, v_actual));

  -- ROWS MIGRATED: every pre-existing barber now has an identity.
  select count(*) into v_actual from public.barbers where professional_id is null;
  perform pg_temp.expect('0.5 every pre-existing barber was linked to an identity', v_actual = 0,
    format('%s unlinked', v_actual));

  -- ONE IDENTITY PER HUMAN, even across two shops (§99).
  select v into v_expected from public.r1_backfill_baseline where k = 'distinct_barber_users';
  select count(*) into v_actual from public.professionals where source = 'fadeup';
  perform pg_temp.expect(
    '0.6 exactly one professional per distinct barber account — no duplicates',
    v_actual = v_expected,
    format('distinct barber accounts before=%s, fadeup-sourced professionals after=%s', v_expected, v_actual));

  select count(distinct professional_id) into v_actual
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where sp.user_id = v_mobile;
  perform pg_temp.expect(
    '0.7 a barber working at two shops has ONE identity shared by both rows',
    v_actual = 1, format('distinct identities = %s', v_actual));

  -- PRIVACY: is_public must not be inherited from staff_profiles.
  perform pg_temp.expect(
    '0.8 a public-but-inactive staff profile did NOT become a public professional',
    (select not p.is_public from public.professionals p where p.user_id = v_quiet),
    'staff_profiles.is_public was true; professionals.is_public must be false');

  perform pg_temp.expect(
    '0.9 an inactive staff member still received a durable identity',
    exists (select 1 from public.professionals where user_id = v_quiet),
    'identity is not activity');

  -- An owner who never took appointments is not a professional.
  perform pg_temp.expect(
    '0.10 a non-barber owner got NO professional identity',
    not exists (select 1 from public.professionals where user_id = v_owner));

  -- PASSPORTS.
  select count(*) into v_actual
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);
  perform pg_temp.expect('0.11 every pre-existing registered customer was issued a Passport',
    v_actual = 0, format('%s without a passport', v_actual));

  select count(*) into v_actual from public.customer_passports where passport_number is null;
  perform pg_temp.expect('0.12 every Passport, including legacy rows, has a number',
    v_actual = 0, format('%s unnumbered', v_actual));

  -- The legacy passport must have been NUMBERED, not rewritten.
  perform pg_temp.expect(
    '0.13 numbering a legacy Passport preserved its existing content',
    (select p.usual_haircut = 'Skin fade' and p.fade_type = 'low'
     from public.customer_passports p
     join auth.users u on u.id = p.user_id
     where u.email = 'cust_legacy+seed@fadeup.test'));

  select count(*) into v_actual from (
    select passport_number from public.customer_passports
    where passport_number is not null
    group by passport_number having count(*) > 1) d;
  perform pg_temp.expect('0.14 the backfill produced no duplicate passport numbers', v_actual = 0);

  -- ORPHANS.
  select count(*) into v_actual
  from public.barbers b
  where b.professional_id is not null
    and not exists (select 1 from public.professionals p where p.id = b.professional_id);
  perform pg_temp.expect('0.15 no orphan professional_id on barbers', v_actual = 0);

  perform pg_temp.record('0.16 backfill verification', 'INFO', 'ran against a seeded pre-R1 database');
end $$;

-- ============================================================================
-- FIXTURES
--
-- Two organizations. pro_1 is a barber at BOTH of them — that is the case
-- that proves one human yields one durable identity, and it is also the case
-- that would leak cross-tenant history if the relationship key were wrong.
-- ============================================================================

create temporary table v_ids (k text primary key, v uuid);
grant select on v_ids to public;

insert into v_ids (k, v) values
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('pro_1', gen_random_uuid()),
  ('pro_2', gen_random_uuid()),
  ('cust_1', gen_random_uuid()),
  ('victim', gen_random_uuid()),
  ('attacker', gen_random_uuid()),
  ('celeb', gen_random_uuid()),
  ('platform', gen_random_uuid()),
  ('outsider', gen_random_uuid());

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v.v, 'authenticated', 'authenticated',
       v.k || '+r1@fadeup.test', 'x', '{}'::jsonb,
       jsonb_build_object('full_name', initcap(replace(v.k, '_', ' '))), now(), now()
from v_ids v;

insert into public.platform_members (user_id, role)
values ((select v from v_ids where k = 'platform'), 'platform_owner')
on conflict do nothing;

-- Organizations. The creation trigger would otherwise make auth.uid() the
-- owner; these GUCs are the documented stand-down path from
-- 20260818200000_organization_creation_hardening.sql.
do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);

  insert into public.organizations (id, name, slug, marketplace_visible)
  values
    ((select v from v_ids where k = 'owner_a'), 'Fade Factory A', 'fade-factory-a', true),
    ((select v from v_ids where k = 'owner_b'), 'Fade Factory B', 'fade-factory-b', true);
end $$;

insert into v_ids (k, v) values ('org_a', (select v from v_ids where k = 'owner_a'));
insert into v_ids (k, v) values ('org_b', (select v from v_ids where k = 'owner_b'));

insert into public.locations (id, organization_id, name, city, country, is_active)
values
  (gen_random_uuid(), (select v from v_ids where k = 'org_a'), 'A Main', 'Paris', 'FR', true),
  (gen_random_uuid(), (select v from v_ids where k = 'org_b'), 'B Main', 'Paris', 'FR', true);

insert into v_ids (k, v)
select 'loc_a', id from public.locations where organization_id = (select v from v_ids where k = 'org_a');
insert into v_ids (k, v)
select 'loc_b', id from public.locations where organization_id = (select v from v_ids where k = 'org_b');

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values
  (gen_random_uuid(), (select v from v_ids where k = 'org_a'), 'Fade', 30, 2500, true),
  (gen_random_uuid(), (select v from v_ids where k = 'org_b'), 'Fade', 30, 2500, true);

insert into v_ids (k, v)
select 'svc_a', id from public.services where organization_id = (select v from v_ids where k = 'org_a');
insert into v_ids (k, v)
select 'svc_b', id from public.services where organization_id = (select v from v_ids where k = 'org_b');

-- Memberships auto-create staff_profiles via the pre-existing
-- on_membership_created trigger, so the roster is built the real way.
insert into public.memberships (organization_id, user_id, role) values
  ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'owner_a'), 'owner'),
  ((select v from v_ids where k = 'org_b'), (select v from v_ids where k = 'owner_b'), 'owner'),
  ((select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'pro_1'), 'barber'),
  ((select v from v_ids where k = 'org_b'), (select v from v_ids where k = 'pro_1'), 'barber'),
  ((select v from v_ids where k = 'org_b'), (select v from v_ids where k = 'pro_2'), 'barber');

update public.staff_profiles set location_id = (select v from v_ids where k = 'loc_a')
where organization_id = (select v from v_ids where k = 'org_a');
update public.staff_profiles set location_id = (select v from v_ids where k = 'loc_b')
where organization_id = (select v from v_ids where k = 'org_b');

insert into public.barbers (organization_id, staff_profile_id)
select sp.organization_id, sp.id
from public.staff_profiles sp
where sp.user_id in ((select v from v_ids where k = 'pro_1'), (select v from v_ids where k = 'pro_2'));

insert into v_ids (k, v)
select 'bar_1a', b.id from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
where sp.user_id = (select v from v_ids where k = 'pro_1')
  and b.organization_id = (select v from v_ids where k = 'org_a');

insert into v_ids (k, v)
select 'bar_1b', b.id from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
where sp.user_id = (select v from v_ids where k = 'pro_1')
  and b.organization_id = (select v from v_ids where k = 'org_b');

insert into v_ids (k, v)
select 'bar_2b', b.id from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
where sp.user_id = (select v from v_ids where k = 'pro_2');

insert into v_ids (k, v)
select 'prof_1', b.professional_id from public.barbers b where b.id = (select v from v_ids where k = 'bar_1a');
insert into v_ids (k, v)
select 'prof_2', b.professional_id from public.barbers b where b.id = (select v from v_ids where k = 'bar_2b');

-- Customer CRM rows, linked to real accounts, as resolve_customer_for_user
-- would leave them.
insert into public.customers (organization_id, name, phone, email, user_id) values
  ((select v from v_ids where k = 'org_a'), 'Cust One', '+33600000001', 'cust1@fadeup.test', (select v from v_ids where k = 'cust_1')),
  ((select v from v_ids where k = 'org_a'), 'Victim', '+33600000002', 'victim@fadeup.test', (select v from v_ids where k = 'victim')),
  ((select v from v_ids where k = 'org_b'), 'Cust One B', '+33600000001', 'cust1@fadeup.test', (select v from v_ids where k = 'cust_1')),
  ((select v from v_ids where k = 'org_a'), 'Celeb', '+33600000003', 'celeb@fadeup.test', (select v from v_ids where k = 'celeb'));

insert into v_ids (k, v)
select 'crm_cust1_a', id from public.customers where organization_id = (select v from v_ids where k = 'org_a') and user_id = (select v from v_ids where k = 'cust_1');
insert into v_ids (k, v)
select 'crm_victim_a', id from public.customers where organization_id = (select v from v_ids where k = 'org_a') and user_id = (select v from v_ids where k = 'victim');
insert into v_ids (k, v)
select 'crm_cust1_b', id from public.customers where organization_id = (select v from v_ids where k = 'org_b') and user_id = (select v from v_ids where k = 'cust_1');
insert into v_ids (k, v)
select 'crm_celeb_a', id from public.customers where organization_id = (select v from v_ids where k = 'org_a') and user_id = (select v from v_ids where k = 'celeb');

-- Registered customers -> Fade Passports issue automatically.
insert into public.customer_profiles (user_id, display_name) values
  ((select v from v_ids where k = 'cust_1'), 'Cust One'),
  ((select v from v_ids where k = 'victim'), 'Victim'),
  ((select v from v_ids where k = 'celeb'), 'Celeb');

-- ============================================================================
-- 1. IDENTITY  (§99)
-- ============================================================================

select pg_temp.expect(
  '1.1 every barbers row has a durable professional identity',
  (select count(*) = 0 from public.barbers where professional_id is null));

select pg_temp.expect(
  '1.2 one human working at two shops yields ONE professional identity',
  (select b1.professional_id = b2.professional_id
   from public.barbers b1, public.barbers b2
   where b1.id = (select v from v_ids where k = 'bar_1a')
     and b2.id = (select v from v_ids where k = 'bar_1b')),
  'pro_1 is a barber at org A and org B');

select pg_temp.expect(
  '1.3 distinct humans get distinct identities',
  (select v from v_ids where k = 'prof_1') <> (select v from v_ids where k = 'prof_2'));

select pg_temp.expect(
  '1.4 a backfilled/derived identity is claimed and owned',
  (select claim_state = 'claimed' and user_id = (select v from v_ids where k = 'pro_1')
   from public.professionals where id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '1.5 identity is NOT public by default (never inherited from staff_profiles.is_public)',
  (select not is_public from public.professionals where id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '1.6 claim_state and ownership can never disagree',
  (select count(*) = 0 from public.professionals
   where (claim_state = 'claimed') <> (user_id is not null)));

-- Identity survives losing a shop membership: deleting the barbers row must
-- leave the professional standing.
do $$
declare v_prof uuid;
begin
  select professional_id into v_prof from public.barbers where id = (select v from v_ids where k = 'bar_2b');
  delete from public.barbers where id = (select v from v_ids where k = 'bar_2b');
  perform pg_temp.expect(
    '1.7 professional identity survives removal from a shop',
    exists (select 1 from public.professionals where id = v_prof));
end $$;

-- ============================================================================
-- 2. FOLLOW  (§100)
-- ============================================================================

do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'cust_1'));
  perform public.follow_professional((select v from v_ids where k = 'prof_1'));
  perform public.follow_professional((select v from v_ids where k = 'prof_1'));
  perform public.follow_professional((select v from v_ids where k = 'prof_1'));
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '2.1 repeated Follow is idempotent — exactly one edge',
  (select count(*) = 1 from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '2.2 the edge is following/manual',
  (select state = 'following' and source = 'manual' and not has_explicit_unfollow
   from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')));

do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'cust_1'));
  perform public.unfollow_professional((select v from v_ids where k = 'prof_1'));
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '2.3 Unfollow works and records durable intent',
  (select state = 'unfollowed' and has_explicit_unfollow
   from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')));

-- THE KEY INVARIANT: a later eligible booking must not resurrect the follow.
do $$
declare v_appt uuid;
begin
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    (select v from v_ids where k = 'crm_cust1_a'),
    'Cust One', '+33600000001', now() + interval '2 days', now() + interval '2 days 30 minutes',
    'confirmed', (select v from v_ids where k = 'cust_1')
  ) returning id into v_appt;
  insert into v_ids (k, v) values ('appt_after_unfollow', v_appt);
end $$;

select pg_temp.expect(
  '2.4 an explicit Unfollow SURVIVES a later confirmed booking (auto-follow must not override intent)',
  (select state = 'unfollowed' and has_explicit_unfollow
   from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '2.5 a client cannot erase its own unfollow intent by writing the table directly',
  pg_temp.raises_as((select v from v_ids where k = 'cust_1'), format(
    $q$ update public.professional_follows set has_explicit_unfollow = false
        where follower_user_id = '%s'; $q$,
    (select v from v_ids where k = 'cust_1'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- 3. AUTO-FOLLOW  (§101)
-- ============================================================================

do $$
begin
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    (select v from v_ids where k = 'crm_celeb_a'),
    'Celeb', '+33600000003', now() + interval '3 days', now() + interval '3 days 30 minutes',
    'confirmed', (select v from v_ids where k = 'celeb')
  );
end $$;

select pg_temp.expect(
  '3.1 a self-booked confirmed appointment auto-follows the professional',
  (select state = 'following' and source = 'auto'
   from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'celeb')
     and professional_id = (select v from v_ids where k = 'prof_1')));

-- Retried/duplicated booking events must not duplicate the edge.
do $$
begin
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    (select v from v_ids where k = 'crm_celeb_a'),
    'Celeb', '+33600000003', now() + interval '4 days', now() + interval '4 days 30 minutes',
    'confirmed', (select v from v_ids where k = 'celeb')
  );
end $$;

select pg_temp.expect(
  '3.2 a second confirmed booking creates no duplicate edge',
  (select count(*) = 1 from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'celeb')
     and professional_id = (select v from v_ids where k = 'prof_1')));

-- ============================================================================
-- 4. THE ATTRIBUTION ATTACK  (the reason booked_by_user_id exists)
--
-- An anonymous caller books, typing the VICTIM's phone number. The
-- pre-existing link trigger will attach the booking to the victim's CRM row —
-- that part is expected and unchanged. What must NOT happen is any social
-- fact being attributed to the victim's account.
-- ============================================================================

do $$
declare v_appt uuid;
begin
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id,
    customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    'Victim', '+33600000002', now() + interval '5 days', now() + interval '5 days 30 minutes',
    'confirmed', null   -- anonymous: exactly what book_public_appointment leaves
  ) returning id into v_appt;
  insert into v_ids (k, v) values ('appt_attack', v_appt);
end $$;

select pg_temp.expect(
  '4.1 the anonymous booking DID attach to the victim CRM row (pre-existing behaviour, unchanged)',
  (select customer_id = (select v from v_ids where k = 'crm_victim_a')
   from public.appointments where id = (select v from v_ids where k = 'appt_attack')),
  'confirms the attack precondition really exists');

select pg_temp.expect(
  '4.2 ATTACK BLOCKED: no follow edge was forged in the victim''s name',
  (select count(*) = 0 from public.professional_follows
   where follower_user_id = (select v from v_ids where k = 'victim')));

-- Escalate: the shop marks that fraudulent appointment completed.
do $$
begin
  update public.appointments set status = 'completed'
  where id = (select v from v_ids where k = 'appt_attack');
end $$;

select pg_temp.expect(
  '4.3 ATTACK BLOCKED: completing it did not make the victim a verified client',
  (select count(*) = 0 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'victim')));

-- ============================================================================
-- 5. VERIFIED CLIENT  (§102, §20)
-- ============================================================================

select pg_temp.expect(
  '5.1 a follower alone is NOT a verified client',
  (select count(*) = 0 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'celeb')),
  'celeb auto-follows prof_1 but has completed nothing');

select pg_temp.expect(
  '5.2 a FUTURE confirmed booking is NOT evidence of a completed haircut',
  (select count(*) = 0 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'celeb')
     and professional_id = (select v from v_ids where k = 'prof_1')));

do $$
declare v_appt uuid;
begin
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    (select v from v_ids where k = 'crm_celeb_a'),
    'Celeb', '+33600000003', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
    'confirmed', (select v from v_ids where k = 'celeb')
  ) returning id into v_appt;
  update public.appointments set status = 'completed' where id = v_appt;
end $$;

select pg_temp.expect(
  '5.3 a COMPLETED appointment establishes a genuine relationship',
  (select completed_interaction_count >= 1 and established_by = 'appointment'
   from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'celeb')
     and professional_id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '5.4 a verified client is not automatically a follower and vice versa (separate sources of truth)',
  (select count(*) = 0 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'cust_1')),
  'cust_1 followed then unfollowed prof_1, and has completed nothing yet');

select pg_temp.expect(
  '5.5 a client cannot forge a relationship by writing the table directly',
  pg_temp.raises_as((select v from v_ids where k = 'attacker'), format(
    $q$ insert into public.customer_professional_relationships
          (customer_user_id, professional_id, organization_id, first_completed_at, last_completed_at, completed_interaction_count, established_by)
        values ('%s', '%s', '%s', now(), now(), 99, 'appointment'); $q$,
    (select v from v_ids where k = 'attacker'),
    (select v from v_ids where k = 'prof_1'), (select v from v_ids where k = 'org_a'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- 6. CROSS-TENANT RELATIONSHIP ISOLATION  (§109)
--
-- pro_1 serves cust_1 at org A, then at org B. Org B must never see the org A
-- history, and org A must not lose it.
-- ============================================================================

do $$
declare v_appt uuid;
begin
  -- two completions at org A
  for i in 1..2 loop
    insert into public.appointments (
      organization_id, location_id, barber_id, service_id, customer_id,
      customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
    ) values (
      (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
      (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
      (select v from v_ids where k = 'crm_cust1_a'),
      -- Offset by hours as well as days: bar_1a already has celeb's completed
      -- appointment at now() - 2 days, and appointments_barber_no_overlap is a
      -- real GiST exclusion constraint that will (correctly) reject a clash.
      'Cust One', '+33600000001',
      now() - (i || ' days')::interval - interval '6 hours',
      now() - (i || ' days')::interval - interval '6 hours' + interval '30 minutes',
      'confirmed', (select v from v_ids where k = 'cust_1')
    ) returning id into v_appt;
    update public.appointments set status = 'completed' where id = v_appt;
  end loop;

  -- one completion at org B, same professional
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, starts_at, ends_at, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_b'), (select v from v_ids where k = 'loc_b'),
    (select v from v_ids where k = 'bar_1b'), (select v from v_ids where k = 'svc_b'),
    (select v from v_ids where k = 'crm_cust1_b'),
    'Cust One B', '+33600000001', now() - interval '1 hour', now() - interval '30 minutes',
    'confirmed', (select v from v_ids where k = 'cust_1')
  ) returning id into v_appt;
  update public.appointments set status = 'completed' where id = v_appt;
end $$;

select pg_temp.expect(
  '6.1 the same professional at two shops produces TWO tenant-scoped rows',
  (select count(*) = 2 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '6.2 org A keeps its own history (2 completions)',
  (select completed_interaction_count = 2 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')
     and organization_id = (select v from v_ids where k = 'org_a')));

select pg_temp.expect(
  '6.3 org B sees ONLY its own single completion, not org A''s history',
  (select completed_interaction_count = 1 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'cust_1')
     and professional_id = (select v from v_ids where k = 'prof_1')
     and organization_id = (select v from v_ids where k = 'org_b')));

-- RLS: owner_b must not be able to read the org A row at all.
do $$
declare v_visible integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_b'));
  select count(*) into v_visible from public.customer_professional_relationships
  where organization_id = (select v from v_ids where k = 'org_a');
  perform pg_temp.become_postgres();
  perform pg_temp.expect('6.4 shop B cannot READ shop A''s relationship rows', v_visible = 0);
end $$;

do $$
declare v_visible integer;
begin
  perform pg_temp.become((select v from v_ids where k = 'outsider'));
  select count(*) into v_visible from public.customer_professional_relationships;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('6.5 an unrelated account sees no relationships at all', v_visible = 0);
end $$;

select pg_temp.expect(
  '6.6 the relationship tenant is immutable',
  pg_temp.raises(format(
    $q$ update public.customer_professional_relationships set organization_id = '%s'
        where organization_id = '%s'; $q$,
    (select v from v_ids where k = 'org_b'), (select v from v_ids where k = 'org_a'))));

-- ============================================================================
-- 7. QUEUE COMPLETION MUST NOT BREAK  (§112, and the 42501 regression)
-- ============================================================================

do $$
declare v_q uuid;
begin
  insert into public.queue_entries (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, status, booked_by_user_id
  ) values (
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    (select v from v_ids where k = 'crm_cust1_a'),
    'Cust One', '+33600000001', 'waiting', (select v from v_ids where k = 'cust_1')
  ) returning id into v_q;
  insert into v_ids (k, v) values ('queue_1', v_q);
end $$;

-- The real client path: a plain PATCH as role `authenticated`, exactly as
-- apps/web/src/lib/queries/queue.ts issues it.
do $$
declare v_failed boolean;
begin
  perform pg_temp.become((select v from v_ids where k = 'owner_a'));
  v_failed := pg_temp.raises(format(
    $q$ update public.queue_entries set status = 'completed', completed_at = now() where id = '%s'; $q$,
    (select v from v_ids where k = 'queue_1')));
  perform pg_temp.become_postgres();
  perform pg_temp.expect(
    '7.1 a barber can still mark a queue client done via a direct PATCH (no 42501 from the new trigger)',
    not v_failed);
end $$;

select pg_temp.expect(
  '7.2 the completed queue visit established a relationship',
  (select count(*) = 1 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'cust_1')
     and organization_id = (select v from v_ids where k = 'org_a')
     and professional_id = (select v from v_ids where k = 'prof_1')),
  'merged into the existing org A row rather than creating a second one');

-- ============================================================================
-- 8. FADE PASSPORT  (§104)
-- ============================================================================

select pg_temp.expect(
  '8.1 every registered customer has a Fade Passport, issued automatically',
  (select count(*) = 0 from public.customer_profiles cp
   where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id)));

select pg_temp.expect(
  '8.2 exactly one Passport per customer',
  (select count(*) = 3 from public.customer_passports
   where user_id in (select v from v_ids where k in ('cust_1', 'victim', 'celeb'))));

select pg_temp.expect(
  '8.3 every Passport has a number',
  (select count(*) = 0 from public.customer_passports where passport_number is null));

do $$
declare v_a text; v_b text;
begin
  v_a := public.ensure_customer_passport((select v from v_ids where k = 'cust_1'));
  v_b := public.ensure_customer_passport((select v from v_ids where k = 'cust_1'));
  perform pg_temp.expect(
    '8.4 ensure is idempotent — repeated calls return the SAME passport number',
    v_a = v_b and v_a is not null);
end $$;

select pg_temp.expect(
  '8.5 no duplicate passport numbers',
  (select count(*) = 0 from (
     select passport_number from public.customer_passports
     where passport_number is not null group by passport_number having count(*) > 1) d));

select pg_temp.expect(
  '8.6 a customer cannot choose their own passport number',
  pg_temp.raises_as((select v from v_ids where k = 'cust_1'), format(
    $q$ update public.customer_passports set passport_number = 'FPVANITY' where user_id = '%s'; $q$,
    (select v from v_ids where k = 'cust_1'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '8.7 passport_number is never returned by the anon share RPC',
  (select count(*) = 0
   from information_schema.routines r
   join information_schema.parameters p on p.specific_name = r.specific_name
   where r.routine_schema = 'public'
     and r.routine_name = 'get_shared_passport'
     and p.parameter_name = 'passport_number'));

-- ============================================================================
-- 9. EXTERNAL / UNCLAIMED PROFILE  (§107)
-- ============================================================================

do $$
declare v_prospect uuid; v_ext uuid;
begin
  insert into public.prospects (type, entity_kind, status, canonical_name, country)
  values ('barbershop', 'independent', 'discovered', 'Scraped Fades', 'FR')
  returning id into v_prospect;
  insert into v_ids (k, v) values ('prospect_1', v_prospect);

  perform pg_temp.become((select v from v_ids where k = 'platform'));
  v_ext := public.create_external_professional(v_prospect, 'Scraped Fades');
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('prof_ext', v_ext);
end $$;

select pg_temp.expect(
  '9.1 an external profile is explicitly UNCLAIMED and unowned',
  (select claim_state = 'unclaimed' and user_id is null and source = 'worker'
   from public.professionals where id = (select v from v_ids where k = 'prof_ext')));

select pg_temp.expect(
  '9.2 an external profile is not public and not verified by default',
  (select not is_public and verification_state = 'not_verified'
   from public.professionals where id = (select v from v_ids where k = 'prof_ext')));

select pg_temp.expect(
  '9.3 an external profile has NO operational state — no barber row, so no availability, queue or schedule can exist',
  (select count(*) = 0 from public.barbers where professional_id = (select v from v_ids where k = 'prof_ext')));

select pg_temp.expect(
  '9.4 an external profile has no invented verified-client count',
  (select count(*) = 0 from public.customer_professional_relationships
   where professional_id = (select v from v_ids where k = 'prof_ext')));

select pg_temp.expect(
  '9.5 creating an external professional is idempotent per prospect',
  (select count(*) = 1 from public.professionals
   where prospect_id = (select v from v_ids where k = 'prospect_1')));

do $$
declare v_second uuid;
begin
  perform pg_temp.become((select v from v_ids where k = 'platform'));
  v_second := public.create_external_professional((select v from v_ids where k = 'prospect_1'), 'Scraped Fades');
  perform pg_temp.become_postgres();
  perform pg_temp.expect(
    '9.6 re-publishing the same prospect returns the SAME identity, never a duplicate',
    v_second = (select v from v_ids where k = 'prof_ext'));
end $$;

select pg_temp.expect(
  '9.7 an ordinary user cannot create external professionals',
  pg_temp.raises_as((select v from v_ids where k = 'attacker'), format(
    $q$ select public.create_external_professional('%s', 'Mine Now'); $q$,
    (select v from v_ids where k = 'prospect_1'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- 10. CLAIM  (§108)
-- ============================================================================

do $$
declare v_claim uuid;
begin
  perform pg_temp.become((select v from v_ids where k = 'attacker'));
  v_claim := public.claim_professional_profile((select v from v_ids where k = 'prof_ext'), '{"proof":"none"}'::jsonb);
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('claim_attacker', v_claim);
end $$;

select pg_temp.expect(
  '10.1 filing a claim grants NO control — the profile stays unowned',
  (select user_id is null and claim_state = 'claim_pending'
   from public.professionals where id = (select v from v_ids where k = 'prof_ext')));

select pg_temp.expect(
  '10.2 a claimant cannot approve their own claim',
  pg_temp.raises_as((select v from v_ids where k = 'attacker'), format(
    $q$ update public.professional_profile_claims set state = 'approved' where id = '%s'; $q$,
    (select v from v_ids where k = 'claim_attacker'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '10.3 a claimant cannot call the platform approval RPC',
  pg_temp.raises_as((select v from v_ids where k = 'attacker'), format(
    $q$ select public.approve_professional_claim('%s'); $q$,
    (select v from v_ids where k = 'claim_attacker'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- A second claimant may file concurrently — the platform arbitrates.
do $$
declare v_claim2 uuid;
begin
  perform pg_temp.become((select v from v_ids where k = 'outsider'));
  v_claim2 := public.claim_professional_profile((select v from v_ids where k = 'prof_ext'));
  perform pg_temp.become_postgres();
  insert into v_ids (k, v) values ('claim_outsider', v_claim2);
end $$;

select pg_temp.expect(
  '10.4 two different claimants may both be pending',
  (select count(*) = 2 from public.professional_profile_claims
   where professional_id = (select v from v_ids where k = 'prof_ext') and state = 'pending'));

do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'platform'));
  perform public.approve_professional_claim((select v from v_ids where k = 'claim_attacker'));
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '10.5 approval transfers ownership exactly once',
  (select user_id = (select v from v_ids where k = 'attacker') and claim_state = 'claimed'
   from public.professionals where id = (select v from v_ids where k = 'prof_ext')));

select pg_temp.expect(
  '10.6 the competing claim was rejected, not left pending',
  (select state = 'rejected' from public.professional_profile_claims
   where id = (select v from v_ids where k = 'claim_outsider')));

select pg_temp.expect(
  '10.7 only ONE approved claim can ever exist per profile',
  (select count(*) = 1 from public.professional_profile_claims
   where professional_id = (select v from v_ids where k = 'prof_ext') and state = 'approved'));

select pg_temp.expect(
  '10.8 an already-claimed profile cannot be claimed again',
  pg_temp.raises_as((select v from v_ids where k = 'outsider'), format(
    $q$ select public.claim_professional_profile('%s'); $q$,
    (select v from v_ids where k = 'prof_ext'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- TAKEOVER: a claim against an identity that already has an owner.
do $$
declare v_claim3 uuid;
begin
  insert into public.professional_profile_claims (professional_id, claimant_user_id, state)
  values ((select v from v_ids where k = 'prof_1'), (select v from v_ids where k = 'outsider'), 'pending')
  returning id into v_claim3;
  insert into v_ids (k, v) values ('claim_takeover', v_claim3);
end $$;

select pg_temp.expect(
  '10.9 TAKEOVER BLOCKED: approving a claim on an already-owned identity is refused',
  pg_temp.raises_as((select v from v_ids where k = 'platform'), format(
    $q$ select public.approve_professional_claim('%s'); $q$,
    (select v from v_ids where k = 'claim_takeover'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '10.10 the original owner still holds their identity after the blocked takeover',
  (select user_id = (select v from v_ids where k = 'pro_1')
   from public.professionals where id = (select v from v_ids where k = 'prof_1')));

select pg_temp.expect(
  '10.11 claim state is independent of any subscription concept',
  (select count(*) = 0 from information_schema.columns
   where table_schema = 'public' and table_name in ('professionals', 'professional_profile_claims')
     and column_name ~ 'plan|price|subscription|stripe|tier|entitlement'));

-- ============================================================================
-- 11. PUBLIC SOCIAL PROOF  (§103, §26, §88)
-- ============================================================================

do $$
begin
  update public.professionals set is_public = true where id = (select v from v_ids where k = 'prof_1');

  insert into public.customer_public_profiles (user_id, username, display_name, is_public, persona_category)
  values ((select v from v_ids where k = 'celeb'), 'celeb', 'Celeb', true, 'artist');
end $$;

select pg_temp.expect(
  '11.1 a new public profile is never born verified',
  (select verification_state = 'not_verified'
   from public.customer_public_profiles where user_id = (select v from v_ids where k = 'celeb')));

select pg_temp.expect(
  '11.2 a customer CANNOT self-verify',
  pg_temp.raises_as((select v from v_ids where k = 'celeb'), format(
    $q$ update public.customer_public_profiles set verification_state = 'verified' where user_id = '%s'; $q$,
    (select v from v_ids where k = 'celeb'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'platform'));
  perform public.set_customer_verification((select v from v_ids where k = 'celeb'), 'verified', 'confirmed by label');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '11.3 the platform can verify, and the audit record is written atomically',
  (select verification_state = 'verified' from public.customer_public_profiles
   where user_id = (select v from v_ids where k = 'celeb'))
  and exists (select 1 from public.platform_audit_log
              where action = 'customer_verification.changed'
                and target_id = (select v from v_ids where k = 'celeb')));

select pg_temp.expect(
  '11.4 the verified customer is NOT yet publishable as social proof (no consent)',
  (select count(*) = 0 from public.list_public_professional_showcases(
     (select v from v_ids where k = 'prof_1'))));

-- The professional asks.
do $$
declare v_rel uuid;
begin
  select id into v_rel from public.customer_professional_relationships
  where customer_user_id = (select v from v_ids where k = 'celeb')
    and professional_id = (select v from v_ids where k = 'prof_1');
  insert into v_ids (k, v) values ('rel_celeb', v_rel);

  perform pg_temp.become((select v from v_ids where k = 'pro_1'));
  insert into public.professional_client_showcases (professional_id, customer_user_id, relationship_id, consent_state)
  values ((select v from v_ids where k = 'prof_1'), (select v from v_ids where k = 'celeb'), v_rel, 'pending');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '11.5 a pending request does NOT publish anything',
  (select count(*) = 0 from public.list_public_professional_showcases(
     (select v from v_ids where k = 'prof_1'))));

select pg_temp.expect(
  '11.6 the professional cannot approve their own showcase request',
  -- Asserts the OUTCOME, not the mechanism. RLS denies this by matching zero
  -- rows rather than by raising — the UPDATE policy's USING clause requires
  -- customer_user_id = auth.uid(), and the professional is not the customer.
  -- "Nothing happened" is the property that matters; whether the refusal
  -- arrives as an exception or as an empty result is an implementation detail
  -- the test must not depend on.
  (select pg_temp.raises_as((select v from v_ids where k = 'pro_1'), format(
     $q$ update public.professional_client_showcases set consent_state = 'approved'
         where professional_id = '%s'; $q$,
     (select v from v_ids where k = 'prof_1'))) is not null)
  and (select consent_state = 'pending' from public.professional_client_showcases
       where professional_id = (select v from v_ids where k = 'prof_1')),
  'consent remained pending after the professional attempted to approve it');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '11.7 a professional cannot attach a relationship belonging to a different pair',
  pg_temp.raises(format(
    $q$ insert into public.professional_client_showcases
          (professional_id, customer_user_id, relationship_id, consent_state)
        values ('%s', '%s', '%s', 'pending'); $q$,
    (select v from v_ids where k = 'prof_1'), (select v from v_ids where k = 'attacker'),
    (select v from v_ids where k = 'rel_celeb'))));

-- The customer consents.
do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'celeb'));
  update public.professional_client_showcases set consent_state = 'approved'
  where customer_user_id = (select v from v_ids where k = 'celeb');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '11.8 with consent, the relationship becomes publishable',
  (select count(*) = 1 from public.list_public_professional_showcases(
     (select v from v_ids where k = 'prof_1'))));

select pg_temp.expect(
  '11.9 the public projection exposes NO booking history, dates, counts or ids',
  (select count(*) = 4 from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'list_public_professional_showcases'
     and p.parameter_mode = 'OUT'),
  'exactly display_name, username, avatar_url, is_verified');

-- Privacy override: going private must un-publish, even with consent intact.
do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'celeb'));
  update public.customer_public_profiles set is_public = false
  where user_id = (select v from v_ids where k = 'celeb');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '11.10 a customer going private immediately un-publishes the showcase',
  (select count(*) = 0 from public.list_public_professional_showcases(
     (select v from v_ids where k = 'prof_1'))));

do $$
begin
  perform pg_temp.become((select v from v_ids where k = 'celeb'));
  update public.customer_public_profiles set is_public = true
  where user_id = (select v from v_ids where k = 'celeb');
  update public.professional_client_showcases set consent_state = 'revoked'
  where customer_user_id = (select v from v_ids where k = 'celeb');
  perform pg_temp.become_postgres();
end $$;

select pg_temp.expect(
  '11.11 revoking consent immediately un-publishes',
  (select count(*) = 0 from public.list_public_professional_showcases(
     (select v from v_ids where k = 'prof_1'))));

select pg_temp.expect(
  '11.12 revoked consent is TERMINAL — it cannot be re-opened',
  pg_temp.raises(format(
    $q$ update public.professional_client_showcases set consent_state = 'pending'
        where customer_user_id = '%s'; $q$,
    (select v from v_ids where k = 'celeb'))));

select pg_temp.expect(
  '11.13 the professional cannot DELETE a revoked request in order to ask again',
  (select count(*) = 1 from public.professional_client_showcases
   where professional_id = (select v from v_ids where k = 'prof_1')),
  'no DELETE policy exists for anyone, so the row survives');

do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- 12. ANONYMOUS ACCESS  (§110)
-- ============================================================================

do $$
begin
  perform pg_temp.expect('12.1 anon cannot read professionals directly',
    pg_temp.anon_visible_rows('public.professionals') = 0);
  perform pg_temp.expect('12.2 anon cannot read the social graph',
    pg_temp.anon_visible_rows('public.professional_follows') = 0);
  perform pg_temp.expect('12.3 anon cannot read relationships',
    pg_temp.anon_visible_rows('public.customer_professional_relationships') = 0);
  perform pg_temp.expect('12.4 anon cannot read customer public profile rows directly',
    pg_temp.anon_visible_rows('public.customer_public_profiles') = 0);
  perform pg_temp.expect('12.5 anon cannot read Worker prospects',
    pg_temp.anon_visible_rows('public.prospects') = 0);
  perform pg_temp.expect('12.6 anon cannot read raw Worker observations',
    pg_temp.anon_visible_rows('public.prospect_source_records') = 0);
  perform pg_temp.expect('12.7 anon cannot read claims',
    pg_temp.anon_visible_rows('public.professional_profile_claims') = 0);
  perform pg_temp.expect('12.8 anon cannot read Fade Passports',
    pg_temp.anon_visible_rows('public.customer_passports') = 0);
  perform pg_temp.expect('12.8b anon cannot read the private customer identity',
    pg_temp.anon_visible_rows('public.customer_profiles') = 0);
  perform pg_temp.expect('12.8c anon cannot read shop CRM contacts',
    pg_temp.anon_visible_rows('public.customers') = 0);
end $$;

do $$
declare v_rows integer;
begin
  perform pg_temp.become_anon();
  select count(*) into v_rows from public.get_public_professional((select v from v_ids where k = 'prof_1'));
  perform pg_temp.become_postgres();
  perform pg_temp.expect('12.9 anon CAN read the curated public professional projection', v_rows = 1);
end $$;

do $$
declare v_rows integer;
begin
  perform pg_temp.become_anon();
  select count(*) into v_rows from public.get_public_professional((select v from v_ids where k = 'prof_ext'));
  perform pg_temp.become_postgres();
  perform pg_temp.expect(
    '12.10 a non-public professional returns zero rows, not an error (indistinguishable from a wrong id)',
    v_rows = 0);
end $$;

select pg_temp.expect(
  '12.11 the public professional projection never exposes prospect_id, user_id or source',
  (select count(*) = 0 from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'get_public_professional'
     and p.parameter_mode = 'OUT'
     and p.parameter_name in ('prospect_id', 'user_id', 'source')));

-- ============================================================================
-- 13. TENANT ISOLATION OF IDENTITY  (§109, cross-tenant hijack)
-- ============================================================================

select pg_temp.expect(
  '13.1 shop B''s barber row legitimately resolves to pro_1''s identity',
  (select b.professional_id = (select v from v_ids where k = 'prof_1')
   from public.barbers b where b.id = (select v from v_ids where k = 'bar_1b')));

do $$
declare v_after uuid;
begin
  -- Attempt to hijack: force bar_1b to claim prof_2's identity.
  update public.barbers set professional_id = (select v from v_ids where k = 'prof_2')
  where id = (select v from v_ids where k = 'bar_1b');
  select professional_id into v_after from public.barbers where id = (select v from v_ids where k = 'bar_1b');
  perform pg_temp.expect(
    '13.2 HIJACK BLOCKED: a supplied professional_id is overwritten by the derived one',
    v_after = (select v from v_ids where k = 'prof_1'));
end $$;

-- ============================================================================
-- 14. PLATFORM INVARIANTS
-- ============================================================================

select pg_temp.expect(
  '14.1 every R1 table has RLS ENABLED and FORCED',
  (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('professionals', 'professional_follows',
                       'customer_professional_relationships', 'customer_public_profiles',
                       'professional_client_showcases', 'professional_profile_claims')
     and not (c.relrowsecurity and c.relforcerowsecurity)));

select pg_temp.expect(
  '14.2 no table in the database has lost RLS',
  (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity)));

select pg_temp.expect(
  '14.3 no policy anywhere grants access to anon or PUBLIC',
  (select count(*) = 0 from pg_policy p
   where exists (
     select 1 from unnest(p.polroles) r
     where r = 0 or pg_get_userbyid(r) = 'anon')));

select pg_temp.expect(
  '14.4 every SECURITY DEFINER function pins search_path',
  (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));

select pg_temp.expect(
  '14.5 R1 introduced no SMS concept anywhere',
  (select count(*) = 0 from information_schema.columns
   where table_schema = 'public'
     and table_name in ('professionals', 'professional_follows', 'customer_professional_relationships',
                        'customer_public_profiles', 'professional_client_showcases', 'professional_profile_claims')
     and column_name ~ 'sms|twilio'));

select pg_temp.record('14.6 professionals count', 'INFO',
  (select count(*)::text from public.professionals));
select pg_temp.record('14.7 relationship rows', 'INFO',
  (select count(*)::text from public.customer_professional_relationships));
select pg_temp.record('14.8 follow edges', 'INFO',
  (select count(*)::text from public.professional_follows));

-- ============================================================================
-- 15. RECONCILIATION
-- ============================================================================

do $$
declare v_before integer; v_rebuilt integer; v_after integer; v_count_a integer;
begin
  select count(*) into v_before from public.customer_professional_relationships;

  -- Corrupt the aggregate, then prove it is recoverable from source.
  update public.customer_professional_relationships set completed_interaction_count = 999;

  perform pg_temp.become((select v from v_ids where k = 'platform'));
  v_rebuilt := public.rebuild_customer_professional_relationships();
  perform pg_temp.become_postgres();

  select count(*) into v_after from public.customer_professional_relationships;
  select completed_interaction_count into v_count_a
  from public.customer_professional_relationships
  where customer_user_id = (select v from v_ids where k = 'cust_1')
    and professional_id = (select v from v_ids where k = 'prof_1')
    and organization_id = (select v from v_ids where k = 'org_a');

  perform pg_temp.expect('15.1 rebuild touches every row', v_rebuilt = v_before and v_after = v_before);
  perform pg_temp.expect(
    '15.2 rebuild restores the true count from appointments/queue_entries, proving the aggregate is recoverable',
    v_count_a = 3,
    'org A: 2 completed appointments + 1 completed queue visit');
end $$;

select pg_temp.expect(
  '15.3 reconciliation is platform-only',
  pg_temp.raises_as(
    (select v from v_ids where k = 'attacker'),
    $q$ select public.rebuild_customer_professional_relationships(); $q$));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- ============================================================================
-- 16. COLUMN PRIVILEGES
--
-- Four migrations rest their security model on "revoke at table level, then
-- re-grant the permitted columns", and nothing asserted it. That gap is
-- exactly what let a defect through in review: withholding
-- customer_passports.user_id silently broke the Fade Passport editor for
-- every customer, because PostgREST's upsert puts user_id in the ON CONFLICT
-- SET list. These checks pin the grant surface so a future edit that widens
-- or narrows it fails here.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- table, column, role, expected privilege, should_have
      ('professionals',            'prospect_id',       'SELECT', false),
      ('professionals',            'source',            'SELECT', false),
      ('professionals',            'display_name',      'SELECT', true),
      ('professionals',            'claim_state',       'UPDATE', false),
      ('professionals',            'verification_state','UPDATE', false),
      ('professionals',            'user_id',           'UPDATE', false),
      ('professionals',            'bio',               'UPDATE', true),
      ('barbers',                  'professional_id',   'UPDATE', false),
      ('barbers',                  'is_bookable',       'UPDATE', true),
      ('appointments',             'booked_by_user_id', 'UPDATE', false),
      ('appointments',             'booked_by_user_id', 'INSERT', false),
      ('appointments',             'status',            'UPDATE', true),
      ('appointments',             'status',            'INSERT', true),
      ('queue_entries',            'booked_by_user_id', 'UPDATE', false),
      ('queue_entries',            'booked_by_user_id', 'INSERT', false),
      ('queue_entries',            'status',            'UPDATE', true),
      ('queue_entries',            'completed_at',      'UPDATE', true),
      ('customer_public_profiles', 'verification_state','UPDATE', false),
      ('customer_public_profiles', 'is_public',         'UPDATE', true),
      ('customer_passports',       'passport_number',   'UPDATE', false),
      -- MUST be granted: PostgREST upsert puts user_id in the SET list.
      ('customer_passports',       'user_id',           'UPDATE', true),
      ('customer_passports',       'usual_haircut',     'UPDATE', true)
    ) as v(tbl, col, priv, should_have)
  loop
    perform pg_temp.expect(
      format('16.%s authenticated %s %s.%s', case when r.should_have then 'may' else 'may NOT' end,
             r.priv, r.tbl, r.col),
      has_column_privilege('authenticated', 'public.' || r.tbl, r.col, r.priv) = r.should_have,
      format('%s on %s.%s expected %s', r.priv, r.tbl, r.col, r.should_have));
  end loop;
end $$;

-- ============================================================================
-- 17. REGRESSIONS FOUND IN ADVERSARIAL REVIEW
--
-- Each of these corresponds to a defect that was caught only by a reviewer
-- probing the running database, because no assertion covered it.
-- ============================================================================

-- C1: the Fade Passport editor. This is the EXACT statement PostgREST emits
-- for apps/web/src/lib/queries/passport.ts's
-- `.upsert({ user_id, ... }, { onConflict: 'user_id' })`.
do $$
declare v_failed boolean;
begin
  v_failed := pg_temp.raises_as(
    (select v from v_ids where k = 'cust_1'),
    format($q$ insert into public.customer_passports (user_id, usual_haircut)
               values ('%s', 'Mid fade')
               on conflict (user_id) do update
               set user_id = excluded.user_id, usual_haircut = excluded.usual_haircut; $q$,
           (select v from v_ids where k = 'cust_1')));
  perform pg_temp.expect(
    '17.1 a customer can SAVE their Fade Passport (PostgREST upsert incl. user_id in the SET list)',
    not v_failed);
end $$;

select pg_temp.expect(
  '17.2 the saved Passport actually changed',
  (select usual_haircut = 'Mid fade' from public.customer_passports
   where user_id = (select v from v_ids where k = 'cust_1')));

-- H2: booked_by_user_id must not be forgeable on INSERT.
select pg_temp.expect(
  '17.3 a shop owner cannot FORGE booked_by_user_id on a new appointment',
  pg_temp.raises_as((select v from v_ids where k = 'owner_a'), format(
    $q$ insert into public.appointments
          (organization_id, location_id, barber_id, service_id,
           customer_name, starts_at, ends_at, status, booked_by_user_id)
        values ('%s', '%s', '%s', '%s', 'Forged', now() + interval '40 days',
                now() + interval '40 days 30 minutes', 'completed', '%s'); $q$,
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a'),
    (select v from v_ids where k = 'victim'))),
  'without this, a shop could mint verified clients and follows in any customer''s name');

do $$ begin perform pg_temp.become_postgres(); end $$;

select pg_temp.expect(
  '17.4 the forgery attempt created no relationship for the victim',
  (select count(*) = 0 from public.customer_professional_relationships
   where customer_user_id = (select v from v_ids where k = 'victim')));

select pg_temp.expect(
  '17.5 a shop owner cannot forge booked_by_user_id on a queue entry either',
  pg_temp.raises_as((select v from v_ids where k = 'owner_a'), format(
    $q$ insert into public.queue_entries
          (organization_id, location_id, barber_id, customer_name, status, booked_by_user_id)
        values ('%s', '%s', '%s', 'Forged', 'waiting', '%s'); $q$,
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'victim'))));

do $$ begin perform pg_temp.become_postgres(); end $$;

-- An ordinary staff-created appointment (no forged attribution) must still work.
do $$
declare v_failed boolean;
begin
  v_failed := pg_temp.raises_as((select v from v_ids where k = 'owner_a'), format(
    $q$ insert into public.appointments
          (organization_id, location_id, barber_id, service_id,
           customer_name, starts_at, ends_at, status)
        values ('%s', '%s', '%s', '%s', 'Walk-in', now() + interval '41 days',
                now() + interval '41 days 30 minutes', 'confirmed'); $q$,
    (select v from v_ids where k = 'org_a'), (select v from v_ids where k = 'loc_a'),
    (select v from v_ids where k = 'bar_1a'), (select v from v_ids where k = 'svc_a')));
  perform pg_temp.expect(
    '17.6 BOOKING NOT REGRESSED: staff can still create an ordinary appointment',
    not v_failed);
end $$;

do $$ begin perform pg_temp.become_postgres(); end $$;

-- H1: deleting a professional's account must be possible.
do $$
declare
  v_user uuid;
  v_prof uuid;
  v_failed boolean;
begin
  v_user := (select v from v_ids where k = 'pro_2');
  select id into v_prof from public.professionals where user_id = v_user;

  begin
    delete from auth.users where id = v_user;
    v_failed := false;
  exception when others then
    v_failed := true;
    raise notice 'professional account deletion failed: % %', sqlstate, sqlerrm;
  end;

  perform pg_temp.expect(
    '17.7 a professional''s auth account CAN be deleted (GDPR erasure / admin delete)',
    not v_failed);

  perform pg_temp.expect(
    '17.8 the orphaned identity survives and is demoted to unclaimed',
    (select claim_state = 'unclaimed' and user_id is null
     from public.professionals where id = v_prof));
end $$;

-- M5: the rebuild must be a true rebuild, removing rows whose evidence is gone.
do $$
declare v_before integer; v_after integer;
begin
  insert into public.customer_professional_relationships
    (customer_user_id, professional_id, organization_id,
     first_completed_at, last_completed_at, completed_interaction_count, established_by)
  values ((select v from v_ids where k = 'outsider'), (select v from v_ids where k = 'prof_1'),
          (select v from v_ids where k = 'org_a'), now(), now(), 7, 'appointment');

  select count(*) into v_before from public.customer_professional_relationships
  where customer_user_id = (select v from v_ids where k = 'outsider');

  perform pg_temp.become((select v from v_ids where k = 'platform'));
  perform public.rebuild_customer_professional_relationships();
  perform pg_temp.become_postgres();

  select count(*) into v_after from public.customer_professional_relationships
  where customer_user_id = (select v from v_ids where k = 'outsider');

  perform pg_temp.expect(
    '17.9 rebuild DELETES a relationship with no supporting evidence',
    v_before = 1 and v_after = 0,
    'an upsert-only rebuild would have left it in place');
end $$;

-- ============================================================================
-- RESULTS
-- ============================================================================

select check_name, status, coalesce(detail, '') as detail
from verify_results order by seq;

select
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail,
  count(*) filter (where status = 'INFO') as info
from verify_results;

rollback;
