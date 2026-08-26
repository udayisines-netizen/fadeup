-- ============================================================================
-- FadeUp — VERIFY: R1B, the Social-First identity and relationship foundation
--
-- Companion to MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql.
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
-- Safe to run repeatedly: all fixtures live in a transaction that is rolled
-- back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
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

-- Returns the SQLSTATE of a refusal, or 'ALLOWED' if the statement succeeded.
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

begin;

-- ============================================================================
-- FIXTURES
-- ============================================================================

create temporary table v (k text primary key, id uuid);
grant select on v to public;

insert into v (k, id) values
  ('org1', gen_random_uuid()), ('org2', gen_random_uuid()), ('org3', gen_random_uuid()),
  ('owner1', gen_random_uuid()), ('owner2', gen_random_uuid()),
  ('pro', gen_random_uuid()),        -- one human, two shops
  ('pro2', gen_random_uuid()),       -- a second professional, shop 1
  ('cust', gen_random_uuid()),       -- an ordinary customer
  ('cust2', gen_random_uuid()),      -- a second customer
  ('attacker', gen_random_uuid()),   -- squats a victim's contact details
  ('admin', gen_random_uuid()),      -- platform admin
  ('claimant', gen_random_uuid()),   -- claims the external identity
  ('rival', gen_random_uuid()),      -- races the claimant
  ('outsider', gen_random_uuid());   -- member of no organization

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       k || '+r1b@fadeup.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()
from v
where k in ('owner1', 'owner2', 'pro', 'pro2', 'cust', 'cust2', 'attacker',
            'admin', 'claimant', 'rival', 'outsider');

insert into public.platform_members (user_id, role)
select id, 'platform_admin' from v where k = 'admin';

do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ((select id from v where k = 'org1'), 'R1B Shop One', 'r1b-shop-one', true);

  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ((select id from v where k = 'org2'), 'R1B Shop Two', 'r1b-shop-two', true);

  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ((select id from v where k = 'org3'), 'R1B Claimant Shop', 'r1b-shop-three', true);
end $$;

insert into public.locations (organization_id, name, city, country, timezone, is_active)
values ((select id from v where k = 'org1'), 'One Main', 'Lyon', 'FR', 'UTC', true),
       ((select id from v where k = 'org2'), 'Two Main', 'Paris', 'FR', 'UTC', true);

insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
values ((select id from v where k = 'org1'), 'Fade One', 30, 2500, true),
       ((select id from v where k = 'org2'), 'Fade Two', 30, 2700, true);

insert into v (k, id)
select 'loc1', id from public.locations where organization_id = (select id from v where k = 'org1') limit 1;
insert into v (k, id)
select 'loc2', id from public.locations where organization_id = (select id from v where k = 'org2') limit 1;
insert into v (k, id)
select 'svc1', id from public.services where organization_id = (select id from v where k = 'org1') limit 1;
insert into v (k, id)
select 'svc2', id from public.services where organization_id = (select id from v where k = 'org2') limit 1;

insert into public.memberships (organization_id, user_id, role) values
  ((select id from v where k = 'org1'), (select id from v where k = 'owner1'), 'owner'),
  ((select id from v where k = 'org2'), (select id from v where k = 'owner2'), 'owner'),
  ((select id from v where k = 'org3'), (select id from v where k = 'claimant'), 'owner'),
  ((select id from v where k = 'org1'), (select id from v where k = 'pro'), 'barber'),
  ((select id from v where k = 'org2'), (select id from v where k = 'pro'), 'barber'),
  ((select id from v where k = 'org1'), (select id from v where k = 'pro2'), 'barber');

insert into public.barbers (organization_id, staff_profile_id)
select sp.organization_id, sp.id from public.staff_profiles sp
where sp.user_id in ((select id from v where k = 'pro'), (select id from v where k = 'pro2'));

insert into v (k, id)
select 'barber1', b.id from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
where sp.user_id = (select id from v where k = 'pro')
  and b.organization_id = (select id from v where k = 'org1');

insert into v (k, id)
select 'barber2', b.id from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
where sp.user_id = (select id from v where k = 'pro')
  and b.organization_id = (select id from v where k = 'org2');

insert into v (k, id)
select 'barber3', b.id from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
where sp.user_id = (select id from v where k = 'pro2');

insert into v (k, id)
select 'prof1', b.professional_id from public.barbers b where b.id = (select id from v where k = 'barber1');
insert into v (k, id)
select 'prof2', b.professional_id from public.barbers b where b.id = (select id from v where k = 'barber3');

insert into public.customer_profiles (user_id, display_name)
values ((select id from v where k = 'cust'), 'R1B Customer'),
       ((select id from v where k = 'cust2'), 'R1B Customer Two');

-- ============================================================================
-- 1. STRUCTURE, RLS AND PRIVILEGES
-- ============================================================================

do $$
declare
  t text;
  v_tables text[] := array['professionals', 'professional_follows',
                           'customer_professional_relationships',
                           'professional_claims', 'prospect_professionals'];
begin
  foreach t in array v_tables loop
    perform pg_temp.expect(
      format('1.1 %s exists', t),
      exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = t));

    perform pg_temp.expect(
      format('1.2 %s has RLS enabled AND forced', t),
      (select c.relrowsecurity and c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t),
      'enabled alone exempts the owner, and several definer functions run as postgres');

    -- Supabase default privileges hand anon everything on a new public table.
    -- This is the single most likely way an R1B table ships world-writable.
    perform pg_temp.expect(
      format('1.3 %s grants anon NOTHING', t),
      not exists (select 1 from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = t and grantee = 'anon'),
      'pg_default_acl grants anon arwdDxtm on every new public table unless revoked');

    perform pg_temp.expect(
      format('1.4 %s grants authenticated no INSERT/DELETE/TRUNCATE', t),
      not exists (select 1 from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = t
                    and grantee = 'authenticated'
                    and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')),
      'every mutation goes through a SECURITY DEFINER RPC');
  end loop;
exception when others then
  perform pg_temp.record('1.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
begin
  -- professionals is the one table with a client UPDATE path, and it must be
  -- presentational columns only.
  perform pg_temp.expect(
    '1.5 professionals: authenticated may UPDATE only presentational columns',
    not has_column_privilege('authenticated', 'public.professionals', 'claim_state', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.professionals', 'user_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.professionals', 'claimed_at', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.professionals', 'source', 'UPDATE')
    and has_column_privilege('authenticated', 'public.professionals', 'display_name', 'UPDATE')
    and has_column_privilege('authenticated', 'public.professionals', 'is_public', 'UPDATE'));

  perform pg_temp.expect(
    '1.6 professionals.source is not SELECTable by a client',
    not has_column_privilege('authenticated', 'public.professionals', 'source', 'SELECT'),
    'that an identity came from acquisition is internal provenance');

  perform pg_temp.expect(
    '1.7 professional_follows.follower_user_id is not SELECTable by a client',
    not has_column_privilege('authenticated', 'public.professional_follows', 'follower_user_id', 'SELECT'),
    'RLS already scopes rows to the owner; withholding the column means a leak needs two mistakes');

  perform pg_temp.expect(
    '1.8 barbers.professional_id is not INSERT or UPDATE grantable',
    not has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'INSERT')
    and not has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'UPDATE'),
    'a shop must not be able to point a roster seat at an identity it does not own');

  perform pg_temp.expect(
    '1.9 the database still has ZERO anon RLS policies',
    (select count(*) from pg_policies where schemaname = 'public' and 'anon' = any(roles)) = 0,
    'the anonymous contract is curated projections, never a readable table');

  perform pg_temp.expect(
    '1.10 no R1B table has an INSERT/UPDATE/DELETE policy for authenticated',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename in ('professional_follows', 'customer_professional_relationships',
                          'professional_claims', 'prospect_professionals')
        and cmd <> 'SELECT'),
    'trigger/RPC-maintained tables have no write policy at all, mirroring appointment_claim_tokens');

  perform pg_temp.expect(
    '1.11 the acquisition worker gets nothing on the social tables',
    not exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'prospect_worker'
        and table_name in ('professionals', 'professional_follows',
                           'customer_professional_relationships',
                           'professional_claims', 'customer_passports')),
    'R1A tightened worker privileges because it parses third-party scraped content');
exception when others then
  perform pg_temp.record('1.5 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 2. PROFESSIONAL IDENTITY
-- ============================================================================

do $$
declare
  v_prof1 uuid := (select id from v where k = 'prof1');
begin
  perform pg_temp.expect(
    '2.1 every barbers row has a professional identity',
    (select count(*) from public.barbers where professional_id is null) = 0);

  perform pg_temp.expect(
    '2.2 one human at two shops yields exactly ONE identity',
    (select count(distinct professional_id) from public.barbers
     where id in ((select id from v where k = 'barber1'), (select id from v where k = 'barber2'))) = 1,
    'this is the defect the whole lot exists to fix');

  perform pg_temp.expect(
    '2.3 a barber-backed identity is claimed, by the right account',
    (select claim_state = 'claimed' and user_id = (select id from v where k = 'pro')
            and claimed_at is not null
     from public.professionals where id = v_prof1));

  perform pg_temp.expect(
    '2.4 a new identity is NOT public — is_public is never inherited',
    (select not is_public from public.professionals where id = v_prof1),
    'staff_profiles.is_public is the shop''s roster decision, not the person''s platform consent');

  perform pg_temp.expect(
    '2.5 no handle is invented',
    (select handle is null from public.professionals where id = v_prof1));

  -- The identity survives losing a shop. offboard_barber is R1A's supported
  -- path and it must not reach the identity at all.
  perform pg_temp.become((select id from v where k = 'owner2'));
  perform public.offboard_barber((select id from v where k = 'barber2'));
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '2.6 offboarding a roster seat leaves the durable identity untouched',
    (select claim_state = 'claimed' from public.professionals where id = v_prof1)
    and (select professional_id = v_prof1 from public.barbers where id = (select id from v where k = 'barber2')));

  perform pg_temp.expect(
    '2.7 offboarding does not delete the barbers row or its history',
    exists (select 1 from public.barbers where id = (select id from v where k = 'barber2')));
exception when others then
  perform pg_temp.record('2.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
begin
  -- Deletion semantics, one FK at a time.
  perform pg_temp.expect(
    '2.8 an identity backing a roster row cannot be deleted (RESTRICT)',
    pg_temp.sqlstate_of(format(
      'delete from public.professionals where id = %L', (select id from v where k = 'prof1'))) = '23503');

  perform pg_temp.expect(
    '2.9 a client cannot forge claim_state through a direct UPDATE',
    pg_temp.sqlstate_as((select id from v where k = 'pro'), format(
      'update public.professionals set claim_state = ''unclaimed'' where id = %L',
      (select id from v where k = 'prof1'))) = '42501');

  perform pg_temp.expect(
    '2.10 even a privileged direct UPDATE cannot move claim_state',
    pg_temp.sqlstate_of(format(
      'update public.professionals set claim_state = ''unclaimed'', user_id = null, claimed_at = null where id = %L',
      (select id from v where k = 'prof1'))) = '42501',
    'the guard trigger exempts no role, matching how R1A guards appointment transitions');

  perform pg_temp.expect(
    '2.11 a professional cannot repoint their identity at another account',
    pg_temp.sqlstate_as((select id from v where k = 'pro'), format(
      'update public.professionals set user_id = %L where id = %L',
      (select id from v where k = 'attacker'), (select id from v where k = 'prof1'))) = '42501');

  -- The contradictory states the brief names explicitly.
  perform pg_temp.expect(
    '2.12 claimed_at cannot coexist with claim_state = unclaimed',
    pg_temp.sqlstate_of(
      'insert into public.professionals (claim_state, claimed_at, display_name) values (''unclaimed'', now(), ''X'')') = '23514');

  perform pg_temp.expect(
    '2.13 an unclaimed identity cannot carry a user_id',
    pg_temp.sqlstate_of(format(
      'insert into public.professionals (claim_state, user_id, display_name) values (''unclaimed'', %L, ''X'')',
      (select id from v where k = 'outsider'))) = '23514');

  perform pg_temp.expect(
    '2.14 a claimed identity cannot exist without an account',
    pg_temp.sqlstate_of(
      'insert into public.professionals (claim_state, claimed_at, display_name) values (''claimed'', now(), ''X'')') = '23514');
exception when others then
  perform pg_temp.record('2.8 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- Account erasure detaches; it neither dead-ends nor cascades.
do $$
declare
  v_erase uuid := gen_random_uuid();
  v_prof uuid;
  v_barber uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_erase, 'authenticated', 'authenticated',
          'erase+r1b@fadeup.test', 'x', '{}', '{}', now(), now());

  insert into public.memberships (organization_id, user_id, role)
  values ((select id from v where k = 'org1'), v_erase, 'barber');

  insert into public.barbers (organization_id, staff_profile_id)
  select sp.organization_id, sp.id from public.staff_profiles sp
  where sp.user_id = v_erase
  returning id, professional_id into v_barber, v_prof;

  delete from auth.users where id = v_erase;

  perform pg_temp.expect(
    '2.15 erasing an account does NOT dead-end on the identity FK',
    not exists (select 1 from auth.users where id = v_erase));

  perform pg_temp.expect(
    '2.16 erasure DETACHES the identity into a coherent unclaimed row',
    (select claim_state = 'unclaimed' and user_id is null and claimed_at is null and not is_public
     from public.professionals where id = v_prof),
    'the person existed and the roster proves it; nobody controls the identity now');

  perform pg_temp.expect(
    '2.17 the roster row and its identity link both survive erasure',
    (select professional_id = v_prof from public.barbers where id = v_barber));
exception when others then
  perform pg_temp.record('2.15 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 3. FOLLOW
-- ============================================================================

do $$
declare
  v_prof1 uuid := (select id from v where k = 'prof1');
  v_cust uuid := (select id from v where k = 'cust');
  v_first timestamptz;
begin
  perform pg_temp.become(v_cust);
  perform public.follow_professional(v_prof1);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.1 a manual follow creates one following edge',
    (select count(*) from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof1 and state = 'following') = 1);

  select followed_at into v_first from public.professional_follows
  where follower_user_id = v_cust and professional_id = v_prof1;

  perform pg_sleep(0.02);

  perform pg_temp.become(v_cust);
  perform public.follow_professional(v_prof1);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.2 following twice is idempotent — still exactly one row',
    (select count(*) from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof1) = 1);

  perform pg_temp.expect(
    '3.3 re-following does NOT restate when following began',
    (select followed_at from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof1) = v_first,
    'timestamps must be truthful; only a genuine transition moves them');

  perform pg_temp.become(v_cust);
  perform public.unfollow_professional(v_prof1);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.4 unfollow sets a durable tombstone',
    (select state = 'unfollowed' and unfollowed_at is not null and source = 'manual'
     from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof1));
exception when others then
  perform pg_temp.record('3.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof1 uuid := (select id from v where k = 'prof1');
  v_cust uuid := (select id from v where k = 'cust');
  v_first_unfollow timestamptz;
begin
  select unfollowed_at into v_first_unfollow from public.professional_follows
  where follower_user_id = v_cust and professional_id = v_prof1;

  perform pg_sleep(0.02);
  perform pg_temp.become(v_cust);
  perform public.unfollow_professional(v_prof1);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.5 repeat unfollow keeps the FIRST refusal',
    (select unfollowed_at from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof1) = v_first_unfollow,
    'that is when the customer actually decided');

  -- A deliberate manual follow is the ONE thing that may reverse an unfollow.
  perform pg_temp.become(v_cust);
  perform public.follow_professional(v_prof1);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.6 a manual follow reactivates after an explicit unfollow',
    (select state = 'following' and unfollowed_at is null and source = 'manual'
     from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof1));
exception when others then
  perform pg_temp.record('3.5 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof1 uuid := (select id from v where k = 'prof1');
  v_cust2 uuid := (select id from v where k = 'cust2');
begin
  -- Unfollowing something never followed lays a pure tombstone, and it must
  -- not claim a follow that never happened.
  perform pg_temp.become(v_cust2);
  perform public.unfollow_professional(v_prof1);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.7 a pure unfollow tombstone has NULL followed_at',
    (select state = 'unfollowed' and followed_at is null and unfollowed_at is not null
     from public.professional_follows
     where follower_user_id = v_cust2 and professional_id = v_prof1),
    'stamping followed_at here would record a follow that never occurred');

  -- Forgery. There is no parameter that names the follower, so the only route
  -- is a direct INSERT — which must be refused by privilege, not by policy.
  perform pg_temp.expect(
    '3.8 a client cannot forge another customer''s follow edge',
    pg_temp.sqlstate_as((select id from v where k = 'attacker'), format(
      'insert into public.professional_follows (follower_user_id, professional_id, state, followed_at)
       values (%L, %L, ''following'', now())',
      (select id from v where k = 'cust'), v_prof1)) = '42501');

  perform pg_temp.expect(
    '3.9 a client cannot clear another customer''s unfollow intent',
    pg_temp.sqlstate_as((select id from v where k = 'attacker'), format(
      'update public.professional_follows set state = ''following'', unfollowed_at = null
       where follower_user_id = %L', v_cust2)) = '42501');

  perform pg_temp.expect(
    '3.10 anonymous callers cannot follow anything',
    pg_temp.sqlstate_as_anon(format('select public.follow_professional(%L)', v_prof1)) = '42501');

  perform pg_temp.expect(
    '3.11 an UNCLAIMED identity cannot be followed',
    pg_temp.sqlstate_as((select id from v where k = 'cust'),
      'select public.follow_professional((select id from public.professionals where claim_state = ''unclaimed'' limit 1))') = '42704',
    'an external profile must never accrue social proof about a FadeUp presence it does not have');
exception when others then
  perform pg_temp.record('3.7 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- RLS row visibility, checked by actually reading as each party.
do $$
declare
  v_seen integer;
begin
  perform pg_temp.become((select id from v where k = 'attacker'));
  select count(*) into v_seen from public.professional_follows;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.12 an unrelated account sees ZERO follow edges',
    v_seen = 0);

  perform pg_temp.become((select id from v where k = 'cust'));
  select count(*) into v_seen from public.professional_follows;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.13 a customer sees exactly their own edges',
    v_seen = 1);

  -- The professional does NOT get a follower list in R1B. Who follows you is
  -- the follower's private state; the public contract exposes only a count.
  perform pg_temp.become((select id from v where k = 'pro'));
  select count(*) into v_seen from public.professional_follows;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '3.14 a professional cannot enumerate their own followers',
    v_seen = 0,
    'R6/R7 may decide to expose this deliberately; it must not arrive as a policy side effect');
exception when others then
  perform pg_temp.record('3.12 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 4. AUTO-FOLLOW AND ITS PROVENANCE
-- ============================================================================

do $$
declare
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_cust uuid := (select id from v where k = 'cust');
  v_appt uuid := gen_random_uuid();
begin
  -- A genuine, self-booked, confirmed appointment.
  insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                   customer_name, starts_at, ends_at, status, booked_by_user_id)
  values (v_appt, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber3'), (select id from v where k = 'svc1'),
          'R1B Customer', now() + interval '3 days', now() + interval '3 days 30 minutes',
          'confirmed', v_cust);

  perform pg_temp.expect(
    '4.1 a confirmed self-booked appointment creates an auto-follow',
    (select state = 'following' and source = 'auto'
     from public.professional_follows
     where follower_user_id = v_cust and professional_id = v_prof2));
exception when others then
  perform pg_temp.record('4.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_attacker uuid := (select id from v where k = 'attacker');
  v_appt uuid := gen_random_uuid();
  v_cust_row uuid := gen_random_uuid();
begin
  -- CONTACT SQUATTING, re-run against the social layer. The attacker owns a
  -- customers row carrying a victim's details. An anonymous booking lands on
  -- it. booked_by_user_id is NULL because nobody signed in, so the attacker
  -- must gain nothing.
  insert into public.customers (id, organization_id, user_id, name, phone)
  values (v_cust_row, (select id from v where k = 'org1'), v_attacker, 'Victim', '+33600009999');

  insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                   customer_id, customer_name, starts_at, ends_at, status, booked_by_user_id)
  values (v_appt, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber3'), (select id from v where k = 'svc1'),
          v_cust_row, 'Victim', now() + interval '4 days', now() + interval '4 days 30 minutes',
          'confirmed', null);

  perform pg_temp.expect(
    '4.2 contact squatting creates NO follow for the attacker',
    not exists (select 1 from public.professional_follows
                where follower_user_id = v_attacker),
    'customers.user_id is a bridge, never evidence — R1A D-1 re-tested at the social layer');

  perform pg_temp.expect(
    '4.3 an unattributed booking fabricates no follow at all',
    (select count(*) from public.professional_follows where professional_id = v_prof2) = 1,
    'lossy by design: the alternative is inventing a relationship for someone who never acted');
exception when others then
  perform pg_temp.record('4.2 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_cust2 uuid := (select id from v where k = 'cust2');
  v_appt uuid := gen_random_uuid();
  v_appt2 uuid := gen_random_uuid();
begin
  -- THE INVARIANT. Explicit unfollow, then a later genuine booking.
  perform pg_temp.become(v_cust2);
  perform public.unfollow_professional(v_prof2);
  perform pg_temp.become_postgres();

  insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                   customer_name, starts_at, ends_at, status, booked_by_user_id)
  values (v_appt, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber3'), (select id from v where k = 'svc1'),
          'R1B Customer Two', now() + interval '5 days', now() + interval '5 days 30 minutes',
          'confirmed', v_cust2);

  perform pg_temp.expect(
    '4.4 EXPLICIT UNFOLLOW SURVIVES A LATER GENUINE BOOKING',
    (select state = 'unfollowed' and source = 'manual'
     from public.professional_follows
     where follower_user_id = v_cust2 and professional_id = v_prof2),
    'Constitution §3.4 — auto-follow is ON CONFLICT DO NOTHING with no DO UPDATE branch');

  -- And a repeated/duplicated event still cannot flip it.
  insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                   customer_name, starts_at, ends_at, status, booked_by_user_id)
  values (v_appt2, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber3'), (select id from v where k = 'svc1'),
          'R1B Customer Two', now() + interval '6 days', now() + interval '6 days 30 minutes',
          'confirmed', v_cust2);

  perform pg_temp.expect(
    '4.5 a repeated qualifying event is duplicate-safe and still loses',
    (select count(*) from public.professional_follows
     where follower_user_id = v_cust2 and professional_id = v_prof2) = 1
    and (select state = 'unfollowed' from public.professional_follows
         where follower_user_id = v_cust2 and professional_id = v_prof2));
exception when others then
  perform pg_temp.record('4.4 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_cust uuid := (select id from v where k = 'cust');
  v_before integer;
  v_after integer;
begin
  -- Duplicate delivery of the SAME event: re-asserting an already-confirmed
  -- status must not fire the trigger a second time.
  select count(*) into v_before from public.professional_follows;

  update public.appointments set status = 'confirmed'
  where booked_by_user_id = v_cust and status = 'confirmed';

  select count(*) into v_after from public.professional_follows;

  perform pg_temp.expect(
    '4.6 re-asserting an already-confirmed status creates no second edge',
    v_before = v_after);
exception when others then
  perform pg_temp.record('4.6 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof1 uuid := (select id from v where k = 'prof1');
  v_q uuid := gen_random_uuid();
begin
  insert into public.queue_entries (id, organization_id, location_id, barber_id, service_id,
                                    customer_name, status, booked_by_user_id)
  values (v_q, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber1'), (select id from v where k = 'svc1'),
          'Outsider', 'waiting', (select id from v where k = 'outsider'));

  perform pg_temp.expect(
    '4.7 a WAITING queue entry creates no follow',
    not exists (select 1 from public.professional_follows
                where follower_user_id = (select id from v where k = 'outsider')),
    'joining a line says nothing about who served you');

  update public.queue_entries set status = 'called' where id = v_q;
  update public.queue_entries set status = 'in_service' where id = v_q;
  update public.queue_entries set status = 'completed' where id = v_q;

  perform pg_temp.expect(
    '4.8 a SERVED walk-in does auto-follow',
    (select state = 'following' and source = 'auto'
     from public.professional_follows
     where follower_user_id = (select id from v where k = 'outsider') and professional_id = v_prof1));
exception when others then
  perform pg_temp.record('4.7 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 5. THE RELATIONSHIP AGGREGATE
-- ============================================================================

do $$
declare
  v_cust uuid := (select id from v where k = 'cust');
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
begin
  insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                   customer_name, starts_at, ends_at, status, booked_by_user_id)
  values (v_a1, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber3'), (select id from v where k = 'svc1'),
          'R1B Customer', now() + interval '10 days', now() + interval '10 days 30 minutes',
          'confirmed', v_cust);
  update public.appointments set status = 'completed' where id = v_a1;

  perform pg_temp.expect(
    '5.1 a completed service writes a relationship row',
    (select completed_interaction_count = 1
            and organization_id = (select id from v where k = 'org1')
     from public.customer_professional_relationships
     where customer_user_id = v_cust and professional_id = v_prof2));

  perform pg_sleep(0.02);

  insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                   customer_name, starts_at, ends_at, status, booked_by_user_id)
  values (v_a2, (select id from v where k = 'org1'), (select id from v where k = 'loc1'),
          (select id from v where k = 'barber3'), (select id from v where k = 'svc1'),
          'R1B Customer', now() + interval '11 days', now() + interval '11 days 30 minutes',
          'confirmed', v_cust);
  update public.appointments set status = 'completed' where id = v_a2;

  perform pg_temp.expect(
    '5.2 a second completed service increments rather than duplicating',
    (select count(*) from public.customer_professional_relationships
     where customer_user_id = v_cust and professional_id = v_prof2) = 1
    and (select completed_interaction_count = 2
         from public.customer_professional_relationships
         where customer_user_id = v_cust and professional_id = v_prof2));

  perform pg_temp.expect(
    '5.3 the first/last window spans both services',
    (select first_completed_at <= last_completed_at
     from public.customer_professional_relationships
     where customer_user_id = v_cust and professional_id = v_prof2));

  -- Duplicate delivery, both shapes.
  --
  -- (a) The same UPDATE replayed. R1A's guard treats status -> same status as
  --     a no-op rather than a transition, so this SUCCEEDS — and the counter
  --     must still not move, because the relationship trigger fires only on
  --     ENTRY to completed.
  perform pg_temp.expect(
    '5.4 replaying the same completed status is a harmless no-op',
    pg_temp.sqlstate_of(format(
      'update public.appointments set status = ''completed'' where id = %L', v_a2)) = 'ALLOWED');

  perform pg_temp.expect(
    '5.5 and it did NOT inflate the counter',
    (select completed_interaction_count = 2
     from public.customer_professional_relationships
     where customer_user_id = v_cust and professional_id = v_prof2),
    'the trigger fires on entry to completed, not on every write that mentions it');

  -- (b) Any attempt to leave and re-enter completed, which is the only way a
  --     second increment could ever be reached. R1A made the state terminal.
  perform pg_temp.expect(
    '5.5b completed is terminal, so it cannot be re-entered at all',
    pg_temp.sqlstate_of(format(
      'update public.appointments set status = ''confirmed'' where id = %L', v_a2)) = '22023');

  perform pg_temp.expect(
    '5.6 a FOLLOW alone creates no relationship — follower is not verified client',
    not exists (
      select 1 from public.customer_professional_relationships
      where customer_user_id = (select id from v where k = 'cust2')),
    'Constitution §3.2: different facts, different sources of truth');

  perform pg_temp.expect(
    '5.7 a merely CONFIRMED booking creates no relationship',
    not exists (
      select 1 from public.customer_professional_relationships
      where customer_user_id = (select id from v where k = 'outsider')
        and professional_id = v_prof2),
    'Constitution §3.3: a confirmed booking is not a haircut');

  perform pg_temp.expect(
    '5.8 a relationship row cannot be repointed at another customer',
    pg_temp.sqlstate_of(format(
      'update public.customer_professional_relationships set customer_user_id = %L where customer_user_id = %L',
      (select id from v where k = 'attacker'), v_cust)) = '42501');
exception when others then
  perform pg_temp.record('5.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_written bigint;
  v_removed bigint;
  v_cust uuid := (select id from v where k = 'cust');
  v_prof2 uuid := (select id from v where k = 'prof2');
begin
  -- Corrupt the counter deliberately, then prove reconciliation repairs it
  -- from evidence rather than trusting the stored value.
  update public.customer_professional_relationships
  set completed_interaction_count = 99
  where customer_user_id = v_cust and professional_id = v_prof2;

  perform pg_temp.expect(
    '5.9 reconciliation is refused for a non-platform caller',
    pg_temp.sqlstate_as(v_cust, 'select public.reconcile_customer_professional_relationships()') = '42501');

  -- Scoped to ONE professional, deliberately: it exercises the scoping
  -- argument, and it proves the scope actually holds by leaving every other
  -- professional's aggregate alone (section 11 depends on that being true).
  perform pg_temp.become((select id from v where k = 'admin'));
  select rows_written, rows_removed into v_written, v_removed
  from public.reconcile_customer_professional_relationships(v_prof2);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '5.10 reconciliation restores the canonical count from evidence',
    (select completed_interaction_count = 2
     from public.customer_professional_relationships
     where customer_user_id = v_cust and professional_id = v_prof2),
    format('rows_written=%s rows_removed=%s', v_written, v_removed));

  -- And an aggregate with no evidence behind it is removed, not left standing.
  insert into public.customer_professional_relationships
    (customer_user_id, professional_id, organization_id,
     completed_interaction_count, first_completed_at, last_completed_at)
  values ((select id from v where k = 'attacker'), v_prof2, (select id from v where k = 'org1'),
          5, now(), now());

  perform pg_temp.become((select id from v where k = 'admin'));
  perform public.reconcile_customer_professional_relationships(v_prof2);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '5.11 reconciliation removes an aggregate the evidence does not support',
    not exists (select 1 from public.customer_professional_relationships
                where customer_user_id = (select id from v where k = 'attacker')));
exception when others then
  perform pg_temp.record('5.9 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- Cross-tenant isolation on the one tenant-scoped R1B table.
do $$
declare
  v_seen integer;
begin
  perform pg_temp.become((select id from v where k = 'owner2'));
  select count(*) into v_seen from public.customer_professional_relationships;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '5.12 shop B cannot read a relationship earned at shop A',
    v_seen = 0,
    'organization_id is the RLS anchor and it is immutable');

  perform pg_temp.become((select id from v where k = 'owner1'));
  select count(*) into v_seen from public.customer_professional_relationships;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '5.13 shop A can read its own',
    v_seen >= 1);

  perform pg_temp.become((select id from v where k = 'attacker'));
  select count(*) into v_seen from public.customer_professional_relationships;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '5.14 an account in no organization, with no history, reads nothing',
    v_seen = 0);
exception when others then
  perform pg_temp.record('5.12 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 6. FADE PASSPORT
-- ============================================================================

do $$
declare
  v_new uuid := gen_random_uuid();
begin
  perform pg_temp.expect(
    '6.1 every registered customer has a Passport',
    not exists (
      select 1 from public.customer_profiles cp
      where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id)),
    'Constitution §2.2 — it exists automatically, with no "Get Passport" action');

  perform pg_temp.expect(
    '6.2 every Passport has a number and an issue time',
    not exists (select 1 from public.customer_passports
                where passport_number is null or issued_at is null));

  perform pg_temp.expect(
    '6.3 Passport numbers are unique, enforced by the database',
    (select count(*) from (
       select passport_number from public.customer_passports
       group by passport_number having count(*) > 1) d) = 0
    and exists (select 1 from pg_indexes
                where schemaname = 'public' and indexname = 'customer_passports_passport_number_unique'));

  perform pg_temp.expect(
    '6.4 the number is non-sequential and high-entropy in shape',
    (select bool_and(passport_number ~ '^FP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$')
     from public.customer_passports));

  -- A new customer gets one automatically, with no explicit issuance call.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_new, 'authenticated', 'authenticated',
          'newcust+r1b@fadeup.test', 'x', '{}', '{}', now(), now());

  insert into public.customer_profiles (user_id, display_name) values (v_new, 'Brand New');

  perform pg_temp.expect(
    '6.5 a brand-new customer is issued a Passport automatically',
    exists (select 1 from public.customer_passports where user_id = v_new));

  perform pg_temp.expect(
    '6.6 an account that is not a customer is NOT issued one',
    not exists (select 1 from public.customer_passports
                where user_id = (select id from v where k = 'outsider')),
    'a professional or platform login is not a customer; issuing one would make the number meaningless');
exception when others then
  perform pg_temp.record('6.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- A caller-chosen number is overwritten, not honoured.
do $$
declare
  v_chooser uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_chooser, 'authenticated', 'authenticated',
          'chooser+r1b@fadeup.test', 'x', '{}', '{}', now(), now());

  insert into public.customer_passports (user_id, passport_number, issued_at)
  values (v_chooser, 'FP-DEAD-BEEF-DEAD-BEEF-DEAD', timestamptz '2000-01-01');

  perform pg_temp.expect(
    '6.7 a chosen Passport number is overwritten server-side, even for postgres',
    (select passport_number <> 'FP-DEAD-BEEF-DEAD-BEEF-DEAD'
     from public.customer_passports where user_id = v_chooser),
    'the stamping trigger exempts no caller');

  perform pg_temp.expect(
    '6.8 a client holds no INSERT privilege on passport_number at all',
    not has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'INSERT'));
exception when others then
  perform pg_temp.record('6.7 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_cust uuid := (select id from v where k = 'cust');
  v_number text;
begin
  select passport_number into v_number from public.customer_passports where user_id = v_cust;

  perform pg_temp.expect(
    '6.9 a Passport number cannot be reassigned',
    pg_temp.sqlstate_of(format(
      'update public.customer_passports set passport_number = ''FP-0000-0000-0000-0000-0001'' where user_id = %L',
      v_cust)) = '42501');

  perform pg_temp.expect(
    '6.10 a Passport cannot be moved to another account',
    pg_temp.sqlstate_of(format(
      'update public.customer_passports set user_id = %L where user_id = %L',
      (select id from v where k = 'attacker'), v_cust)) = '42501');

  perform pg_temp.expect(
    '6.11 issued_at is server-owned',
    pg_temp.sqlstate_of(format(
      'update public.customer_passports set issued_at = timestamptz ''2000-01-01'' where user_id = %L',
      v_cust)) = '42501');

  perform pg_temp.expect(
    '6.12 a Passport still cannot be deleted (R1A guarantee preserved)',
    pg_temp.sqlstate_as(v_cust, format(
      'delete from public.customer_passports where user_id = %L', v_cust)) = '42501');

  perform pg_temp.expect(
    '6.13 issuance is retry-safe — exactly one Passport per account',
    (select count(*) from public.customer_passports where user_id = v_cust) = 1);

  perform pg_temp.expect(
    '6.14 the number did not move across all of the above',
    (select passport_number from public.customer_passports where user_id = v_cust) = v_number);
exception when others then
  perform pg_temp.record('6.9 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- The live PostgREST save path must still work. This is the exact shape
-- apps/web/src/lib/queries/passport.ts issues: upsert with user_id in the
-- ON CONFLICT SET list.
do $$
declare
  v_cust uuid := (select id from v where k = 'cust');
  v_number text;
  v_state text;
begin
  select passport_number into v_number from public.customer_passports where user_id = v_cust;

  v_state := pg_temp.sqlstate_as(v_cust, format($q$
    insert into public.customer_passports (user_id, usual_haircut, fade_type, side_length,
                                           top_length, beard_preferences, preferences_notes)
    values (%L, 'Skin fade', 'skin', '0.5', '3', 'trimmed', 'notes')
    on conflict (user_id) do update
      set user_id = excluded.user_id,
          usual_haircut = excluded.usual_haircut,
          fade_type = excluded.fade_type,
          side_length = excluded.side_length,
          top_length = excluded.top_length,
          beard_preferences = excluded.beard_preferences,
          preferences_notes = excluded.preferences_notes
  $q$, v_cust));

  perform pg_temp.expect(
    '6.15 the PostgREST upsert with user_id in the SET list STILL SUCCEEDS',
    v_state = 'ALLOWED',
    coalesce(v_state, 'null') || ' — R1A recorded this as load-bearing; a withheld user_id UPDATE breaks the live app');

  perform pg_temp.expect(
    '6.16 that upsert saved the content and did not disturb the number',
    (select usual_haircut = 'Skin fade' and passport_number = v_number
     from public.customer_passports where user_id = v_cust));
exception when others then
  perform pg_temp.record('0.5 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 7. CLAIMS
-- ============================================================================

do $$
declare
  v_prospect uuid := gen_random_uuid();
  v_external uuid;
begin
  insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
  values (v_prospect, 'barbershop', 'independent', 'qualified', 'Verify Discovered Shop', 'FR');

  perform pg_temp.expect(
    '7.1 an ordinary account cannot mint an external professional',
    pg_temp.sqlstate_as((select id from v where k = 'cust'), format(
      'select public.create_external_professional(%L)', v_prospect)) = '42501');

  perform pg_temp.expect(
    '7.2 anon cannot mint an external professional',
    pg_temp.sqlstate_as_anon(format(
      'select public.create_external_professional(%L)', v_prospect)) = '42501');

  perform pg_temp.become((select id from v where k = 'admin'));
  v_external := public.create_external_professional(v_prospect);
  perform pg_temp.become_postgres();

  insert into v (k, id) values ('external', v_external), ('prospect', v_prospect);

  perform pg_temp.expect(
    '7.3 an external identity is unclaimed, not public, acquisition-sourced',
    (select claim_state = 'unclaimed' and not is_public and source = 'acquisition'
            and user_id is null and claimed_at is null
     from public.professionals where id = v_external));

  perform pg_temp.expect(
    '7.4 its display name comes from the prospect, not from the caller',
    (select display_name = 'Verify Discovered Shop' from public.professionals where id = v_external));

  perform pg_temp.expect(
    '7.5 an external identity has NO barbers row — so no operational state can exist',
    not exists (select 1 from public.barbers where professional_id = v_external),
    'Constitution §5.5 is satisfied by the absence of the modelling, not by a render-time filter');

  -- Idempotent per canonical prospect.
  perform pg_temp.become((select id from v where k = 'admin'));
  perform pg_temp.expect(
    '7.6 minting is idempotent per prospect',
    public.create_external_professional(v_prospect) = v_external);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.7 exactly one identity exists for that prospect',
    (select count(*) from public.prospect_professionals where prospect_id = v_prospect) = 1);
exception when others then
  perform pg_temp.record('7.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_external uuid := (select id from v where k = 'external');
  v_claimant uuid := (select id from v where k = 'claimant');
  v_rival uuid := (select id from v where k = 'rival');
  v_claim uuid;
  v_claim_rival uuid;
begin
  perform pg_temp.expect(
    '7.8 anon cannot file a claim',
    pg_temp.sqlstate_as_anon(format('select public.submit_professional_claim(%L)', v_external)) = '42501');

  perform pg_temp.become(v_claimant);
  v_claim := public.submit_professional_claim(v_external, 'This is my shop');
  perform pg_temp.become_postgres();
  insert into v (k, id) values ('claim', v_claim);

  perform pg_temp.expect(
    '7.9 filing a claim grants NOTHING — the identity is still unclaimed',
    (select claim_state = 'unclaimed' and user_id is null
     from public.professionals where id = v_external));

  perform pg_temp.become(v_claimant);
  perform pg_temp.expect(
    '7.10 a duplicate submission is idempotent, not a second pending claim',
    public.submit_professional_claim(v_external, 'again') = v_claim);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.11 exactly one pending claim exists for that claimant',
    (select count(*) from public.professional_claims
     where professional_id = v_external and claimant_user_id = v_claimant and state = 'pending') = 1);

  -- A rival may also file. Two pending claims is legitimate; two APPROVALS is
  -- not, and that is what the unique index prevents.
  perform pg_temp.become(v_rival);
  v_claim_rival := public.submit_professional_claim(v_external, 'no, mine');
  perform pg_temp.become_postgres();
  insert into v (k, id) values ('claim_rival', v_claim_rival);

  perform pg_temp.expect(
    '7.12 a claimant cannot self-approve',
    pg_temp.sqlstate_as(v_claimant, format(
      'select public.review_professional_claim(%L, ''approve'')', v_claim)) = '42501');

  perform pg_temp.expect(
    '7.13 a claimant cannot direct-PATCH their own claim to approved',
    pg_temp.sqlstate_as(v_claimant, format(
      'update public.professional_claims set state = ''approved'' where id = %L', v_claim)) = '42501');
exception when others then
  perform pg_temp.record('7.8 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_seen integer;
begin
  perform pg_temp.become((select id from v where k = 'claimant'));
  select count(*) into v_seen from public.professional_claims;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.14 a claimant sees only their own claim, never a rival''s',
    v_seen = 1);
exception when others then
  perform pg_temp.record('7.14 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_external uuid := (select id from v where k = 'external');
  v_claim uuid := (select id from v where k = 'claim');
  v_claim_rival uuid := (select id from v where k = 'claim_rival');
  v_claimant uuid := (select id from v where k = 'claimant');
  v_prospect uuid := (select id from v where k = 'prospect');
  v_result public.professional_claims;
begin
  perform pg_temp.become((select id from v where k = 'admin'));
  select * into v_result from public.review_professional_claim(v_claim, 'approve', 'verified by phone');
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.15 approval claims the identity for the claimant',
    (select claim_state = 'claimed' and user_id = v_claimant and claimed_at is not null
     from public.professionals where id = v_external));

  perform pg_temp.expect(
    '7.16 the claim records who decided and when',
    v_result.state = 'approved' and v_result.decided_at is not null and v_result.decided_by is not null);

  perform pg_temp.expect(
    '7.17 the rival''s pending claim is closed, not left to collide later',
    (select state = 'rejected' from public.professional_claims where id = v_claim_rival));

  perform pg_temp.expect(
    '7.18 approval is auditable',
    exists (select 1 from public.platform_audit_log
            where action = 'professional_claim_approved' and target_id = v_claim));

  -- The reverse acquisition linkage. This is the first writer of a column that
  -- has existed since the acquisition schema shipped.
  perform pg_temp.expect(
    '7.19 prospects.converted_organization_id is set from the claimant''s own org',
    (select converted_organization_id = (select id from v where k = 'org3')
     from public.prospects where id = v_prospect),
    'derived from the single owner membership; never taken from a caller parameter');

  -- Idempotent re-approval: the row lock makes a double-clicked Approve safe.
  perform pg_temp.become((select id from v where k = 'admin'));
  perform public.review_professional_claim(v_claim, 'approve');
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.20 re-approving repeats no side effect and no audit entry',
    (select count(*) from public.platform_audit_log
     where action = 'professional_claim_approved' and target_id = v_claim) = 1);

  perform pg_temp.expect(
    '7.21 an already-claimed identity cannot be claimed by anyone else',
    pg_temp.sqlstate_as((select id from v where k = 'attacker'), format(
      'select public.submit_professional_claim(%L)', v_external)) = '42501',
    'taking over a claimed profile is unrepresentable, not merely slow');

  perform pg_temp.expect(
    '7.22 a terminal claim cannot be revived',
    pg_temp.sqlstate_of(format(
      'update public.professional_claims set state = ''pending'', decided_at = null where id = %L',
      v_claim_rival)) = '22023');

  perform pg_temp.expect(
    '7.23 an account that already holds an identity cannot claim a second',
    pg_temp.sqlstate_as((select id from v where k = 'pro'),
      'select public.submit_professional_claim((select id from public.professionals where claim_state = ''unclaimed'' limit 1))') = '42501',
    'that would need a merge, and a silent merge would destroy one person''s history — R17 owns it');
exception when others then
  perform pg_temp.record('7.15 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- Simultaneous approval: exactly one winner, and the unique index — not the
-- lock — is what guarantees it.
do $$
declare
  v_prospect uuid := gen_random_uuid();
  v_external uuid;
  v_c1 uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated', 'authenticated',
          'racea+r1b@fadeup.test', 'x', '{}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated', 'authenticated',
          'raceb+r1b@fadeup.test', 'x', '{}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', v_c, 'authenticated', 'authenticated',
          'racec+r1b@fadeup.test', 'x', '{}', '{}', now(), now());

  insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
  values (v_prospect, 'barbershop', 'independent', 'qualified', 'Race Shop', 'FR');

  perform pg_temp.become((select id from v where k = 'admin'));
  v_external := public.create_external_professional(v_prospect);
  perform pg_temp.become_postgres();

  perform pg_temp.become(v_a);
  v_c1 := public.submit_professional_claim(v_external);
  perform pg_temp.become_postgres();

  perform pg_temp.become(v_b);
  perform public.submit_professional_claim(v_external);
  perform pg_temp.become_postgres();

  perform pg_temp.become((select id from v where k = 'admin'));
  perform public.review_professional_claim(v_c1, 'approve');
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.24 exactly ONE approved claim can ever exist per identity',
    (select count(*) from public.professional_claims
     where professional_id = v_external and state = 'approved') = 1);

  perform pg_temp.expect(
    '7.25 the losing claim was closed rather than left pending',
    not exists (select 1 from public.professional_claims
                where professional_id = v_external and state = 'pending'));

  -- Now plant a fresh pending claim directly and force it to approved,
  -- bypassing the RPC entirely. The index must refuse it on its own.
  insert into public.professional_claims (professional_id, claimant_user_id, state)
  values (v_external, v_c, 'pending');

  perform pg_temp.expect(
    '7.26 a forced second approval is refused by the unique index (23505)',
    pg_temp.sqlstate_of(format(
      'update public.professional_claims set state = ''approved'', decided_by = %L
       where professional_id = %L and claimant_user_id = %L',
      (select id from v where k = 'admin'), v_external, v_c)) = '23505',
    'the RPC''s row lock is defence in depth; professional_claims_one_approval is the guarantee');
exception when others then
  perform pg_temp.record('7.24 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- Withdrawal, and the conversion writer's refusal to overwrite.
do $$
declare
  v_prospect uuid := gen_random_uuid();
  v_external uuid;
  v_claim uuid;
begin
  insert into public.prospects (id, type, entity_kind, status, canonical_name, country,
                                converted_organization_id)
  values (v_prospect, 'barbershop', 'independent', 'customer', 'Already Converted', 'FR',
          (select id from v where k = 'org1'));

  perform pg_temp.become((select id from v where k = 'admin'));
  v_external := public.create_external_professional(v_prospect);
  perform pg_temp.become_postgres();

  perform pg_temp.become((select id from v where k = 'owner2'));
  v_claim := public.submit_professional_claim(v_external);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '7.27 a claimant can withdraw their own pending claim',
    pg_temp.sqlstate_as((select id from v where k = 'owner2'), format(
      'select public.withdraw_professional_claim(%L)', v_claim)) = 'ALLOWED');

  perform pg_temp.expect(
    '7.28 withdrawing someone else''s claim is refused, never a silent no-op',
    pg_temp.sqlstate_as((select id from v where k = 'attacker'), format(
      'select public.withdraw_professional_claim(%L)', v_claim)) = '42704');

  perform pg_temp.expect(
    '7.29 a withdrawn claim leaves the identity unclaimed',
    (select claim_state = 'unclaimed' from public.professionals where id = v_external));

  perform pg_temp.expect(
    '7.30 an existing conversion is never overwritten',
    (select converted_organization_id = (select id from v where k = 'org1')
     from public.prospects where id = v_prospect),
    'a prospect converts once; sales has already acted on it');
exception when others then
  perform pg_temp.record('7.27 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 8. PUBLICATION AND THE PUBLIC CONTRACT
-- ============================================================================

do $$
declare
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_external uuid := (select id from v where k = 'external');
begin
  perform pg_temp.expect(
    '8.1 EXISTENCE IS NOT PUBLICATION — an existing identity projects nothing',
    (select count(*) from public.get_public_professional(v_prof2)) = 0);

  perform pg_temp.expect(
    '8.2 an UNCLAIMED identity cannot be published at all',
    pg_temp.sqlstate_of(format(
      'update public.professionals set is_public = true where id = %L',
      (select id from public.professionals where claim_state = 'unclaimed' limit 1))) = '23514',
    'R10 removes that CHECK clause deliberately; until then the schema refuses the state');

  -- Publish the claimed one, the way its owner would.
  perform pg_temp.become((select id from v where k = 'pro2'));
  update public.professionals set is_public = true where id = v_prof2;
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '8.3 a published claimed identity projects to anonymous callers',
    (select count(*) from public.get_public_professional(v_prof2)) = 1);

  perform pg_temp.expect(
    '8.4 the CLAIMED projection carries a follower count',
    pg_get_function_result('public.get_public_professional(uuid)'::regprocedure) like '%follower_count%');

  perform pg_temp.expect(
    '8.5 the UNCLAIMED projection is a DIFFERENT shape with NO count',
    pg_get_function_result('public.get_public_external_professional(uuid)'::regprocedure) not like '%follower_count%'
    and pg_get_function_result('public.get_public_external_professional(uuid)'::regprocedure) like '%is_claimed%',
    'a future operational column physically cannot join the unclaimed contract');

  perform pg_temp.expect(
    '8.6 no projection exposes availability, queue, wait time, schedule or appointments',
    not (pg_get_function_result('public.get_public_professional(uuid)'::regprocedure)
         || pg_get_function_result('public.get_public_professional_by_handle(text)'::regprocedure)
         || pg_get_function_result('public.get_public_external_professional(uuid)'::regprocedure))
        ~* '(avail|queue|wait|schedul|appoint|client_count|verified|realtime|presence|price|location)');

  perform pg_temp.expect(
    '8.7 unclaimed publication is DISABLED for this rollout — zero rows for every input',
    (select count(*) from public.get_public_external_professional(v_external)) = 0
    and not exists (select 1 from public.professionals where claim_state = 'unclaimed' and is_public));
exception when others then
  perform pg_temp.record('8.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_count integer;
  v_rows integer;
begin
  select follower_count into v_count from public.get_public_professional(v_prof2);

  perform pg_temp.expect(
    '8.8 the follower count is computed from the canonical edges',
    v_count = (select count(*) from public.professional_follows
               where professional_id = v_prof2 and state = 'following'));

  perform pg_temp.expect(
    '8.9 an explicit unfollow removes the follower from the public count',
    v_count = 1,
    'cust auto-followed, cust2 explicitly unfollowed — the tombstone is not counted');

  perform pg_temp.become_anon();
  select count(*) into v_rows from public.get_public_professional(v_prof2);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('8.10 anon can call the projection', v_rows = 1);

  perform pg_temp.expect(
    '8.11 anon cannot SELECT the identity table directly',
    pg_temp.sqlstate_as_anon('select count(*) from public.professionals') = '42501');

  perform pg_temp.expect(
    '8.12 anon cannot SELECT the follow graph',
    pg_temp.sqlstate_as_anon('select count(*) from public.professional_follows') = '42501');

  perform pg_temp.expect(
    '8.13 anon cannot SELECT the relationship aggregate',
    pg_temp.sqlstate_as_anon('select count(*) from public.customer_professional_relationships') = '42501');

  perform pg_temp.expect(
    '8.14 anon cannot SELECT the claim queue',
    pg_temp.sqlstate_as_anon('select count(*) from public.professional_claims') = '42501');

  perform pg_temp.expect(
    '8.15 anon cannot SELECT acquisition provenance',
    pg_temp.sqlstate_as_anon('select count(*) from public.prospect_professionals') = '42501');

  perform pg_temp.expect(
    '8.16 an ordinary account cannot SELECT acquisition provenance either',
    pg_temp.sqlstate_as((select id from v where k = 'cust'),
      'select count(*) from public.prospect_professionals') = '42501',
    'no ordinary account has business asking whether FadeUp scraped a shop');

  perform pg_temp.expect(
    '8.17 an ordinary account cannot read professionals.source',
    pg_temp.sqlstate_as((select id from v where k = 'cust'),
      'select source from public.professionals limit 1') = '42501');
exception when others then
  perform pg_temp.record('8.8 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prof2 uuid := (select id from v where k = 'prof2');
  v_rows integer;
begin
  -- Going private makes the profile indistinguishable from one that never
  -- existed: zero rows, never an error.
  perform pg_temp.become((select id from v where k = 'pro2'));
  update public.professionals set is_public = false where id = v_prof2;
  perform pg_temp.become_postgres();

  perform pg_temp.become_anon();
  select count(*) into v_rows from public.get_public_professional(v_prof2);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '8.18 a non-public professional returns zero rows, not an error',
    v_rows = 0);

  perform pg_temp.become((select id from v where k = 'cust'));
  select count(*) into v_rows from public.list_my_followed_professionals();
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '8.19 a customer keeps seeing a professional they follow who has gone private',
    v_rows >= 1,
    'their own relationship, not a public listing');

  perform pg_temp.expect(
    '8.20 the follow list takes no parameter, so there is nothing to forge',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_my_followed_professionals'
       and p.pronargs = 0) = 1);
exception when others then
  perform pg_temp.record('8.18 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 9. SECURITY DEFINER SURFACE
-- ============================================================================

do $$
declare
  r record;
  v_unpinned text := '';
  v_missing text := '';
  fn text;
  -- Every function R1B adds, definer or not. search_path must be pinned on all
  -- of them: an unqualified name in a trigger resolves through the CALLER's
  -- search_path, and that is a privilege-escalation primitive whether or not
  -- the function is SECURITY DEFINER.
  v_all text[] := array[
    'assign_barber_professional', 'guard_professional_identity', 'is_own_professional',
    'auto_follow_professional', 'follow_professional', 'unfollow_professional',
    'appointments_auto_follow', 'queue_entries_auto_follow',
    'record_completed_interaction', 'appointments_record_relationship',
    'queue_entries_record_relationship', 'guard_customer_professional_relationship',
    'reconcile_customer_professional_relationships',
    'generate_passport_number', 'stamp_passport_identity', 'guard_passport_identity',
    'ensure_customer_passport', 'customer_profiles_issue_passport',
    'create_external_professional', 'record_prospect_conversion',
    'submit_professional_claim', 'withdraw_professional_claim',
    'review_professional_claim', 'enforce_professional_claim_transition',
    'professional_follower_count', 'get_public_professional',
    'get_public_professional_by_handle', 'get_public_external_professional',
    'list_my_followed_professionals'];
begin
  foreach fn in array v_all loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname = fn
    ) then
      v_missing := v_missing || ' ' || fn;
    end if;
  end loop;

  perform pg_temp.expect(
    '9.1 every R1B function exists',
    v_missing = '', coalesce(nullif(v_missing, ''), format('all %s present', array_length(v_all, 1))));

  for r in
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any(v_all)
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                      where c like 'search_path=%')
  loop
    v_unpinned := v_unpinned || ' ' || r.proname;
  end loop;

  perform pg_temp.expect(
    '9.2 every R1B function pins search_path',
    v_unpinned = '', coalesce(nullif(v_unpinned, ''), 'all pinned'));
exception when others then
  perform pg_temp.record('9.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- anon may execute exactly the three anon-facing projections and nothing
  -- else R1B added.
  for r in
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('follow_professional', 'unfollow_professional',
                        'submit_professional_claim', 'withdraw_professional_claim',
                        'review_professional_claim', 'create_external_professional',
                        'reconcile_customer_professional_relationships',
                        'list_my_followed_professionals', 'auto_follow_professional',
                        'record_completed_interaction', 'ensure_customer_passport',
                        'generate_passport_number', 'record_prospect_conversion',
                        'professional_follower_count')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  perform pg_temp.expect(
    '9.3 anon can execute no R1B mutation or private function',
    v_bad = '', coalesce(nullif(v_bad, ''), 'none'));

  perform pg_temp.expect(
    '9.4 the three anon projections ARE executable by anon',
    has_function_privilege('anon', 'public.get_public_professional(uuid)', 'execute')
    and has_function_privilege('anon', 'public.get_public_professional_by_handle(text)', 'execute')
    and has_function_privilege('anon', 'public.get_public_external_professional(uuid)', 'execute'));

  perform pg_temp.expect(
    '9.5 private helpers are not executable by authenticated',
    not has_function_privilege('authenticated', 'private.auto_follow_professional(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.ensure_customer_passport(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.record_prospect_conversion(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.professional_follower_count(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.generate_passport_number()', 'execute'));

  perform pg_temp.expect(
    '9.5b the one private helper authenticated NEEDS is granted, and anon is not',
    has_function_privilege('authenticated', 'private.is_own_professional(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.is_own_professional(uuid)', 'execute'),
    'the relationship SELECT policy calls it, so withholding it would break a legitimate read');

  perform pg_temp.expect(
    '9.6 no R1B SECURITY DEFINER function trusts a caller-supplied organization',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proargnames, array[]::text[])) as a(nm)
      where n.nspname in ('public', 'private') and p.prosecdef
        and p.proname in ('follow_professional', 'unfollow_professional',
                          'submit_professional_claim', 'withdraw_professional_claim',
                          'review_professional_claim', 'create_external_professional',
                          'get_public_professional', 'get_public_external_professional',
                          'list_my_followed_professionals')
        and a.nm ~* 'organization'),
    'the claim path DERIVES the conversion organization from the claimant''s own membership');
exception when others then
  perform pg_temp.record('9.3 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 10. INDEXES AND FOREIGN KEY DELETION SEMANTICS
-- ============================================================================

do $$
declare
  v_expected text[] := array[
    'professionals_handle_unique', 'barbers_professional_id_idx',
    'barbers_org_professional_unique', 'professional_follows_professional_idx',
    'professional_follows_follower_idx',
    'customer_professional_relationships_professional_idx',
    'customer_professional_relationships_org_recent_idx',
    'professional_claims_one_approval', 'professional_claims_one_pending',
    'professional_claims_queue', 'customer_passports_passport_number_unique',
    'prospect_professionals_professional_idx'];
  v_missing text := '';
  i text;
begin
  foreach i in array v_expected loop
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i) then
      v_missing := v_missing || ' ' || i;
    end if;
  end loop;

  perform pg_temp.expect('10.1 every R1B index exists', v_missing = '',
    coalesce(nullif(v_missing, ''), 'all present'));
exception when others then
  perform pg_temp.record('10.1 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_bad text := '';
  r record;
  v_expected jsonb := jsonb_build_object(
    'barbers_professional_id_fkey', 'r',
    'professionals_user_id_fkey', 'n',
    'professional_follows_follower_user_id_fkey', 'c',
    'professional_follows_professional_id_fkey', 'c',
    'customer_professional_relationships_customer_user_id_fkey', 'c',
    'customer_professional_relationships_professional_id_fkey', 'c',
    'customer_professional_relationships_organization_id_fkey', 'c',
    'professional_claims_professional_id_fkey', 'c',
    'professional_claims_claimant_user_id_fkey', 'c',
    'professional_claims_decided_by_fkey', 'n',
    'prospect_professionals_prospect_id_fkey', 'c',
    'prospect_professionals_professional_id_fkey', 'r');
begin
  for r in select key, value from jsonb_each_text(v_expected) loop
    if not exists (
      select 1 from pg_constraint
      where conname = r.key and contype = 'f' and confdeltype = r.value
    ) then
      v_bad := v_bad || format(' %s(want %s)', r.key, r.value);
    end if;
  end loop;

  perform pg_temp.expect(
    '10.2 every R1B foreign key has the DELIBERATELY chosen delete action',
    v_bad = '', coalesce(nullif(v_bad, ''), 'r=RESTRICT c=CASCADE n=SET NULL, all as designed'));
exception when others then
  perform pg_temp.record('10.2 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_prospect uuid := gen_random_uuid();
  v_external uuid;
begin
  insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
  values (v_prospect, 'barbershop', 'independent', 'discovered', 'Delete Probe', 'FR');

  perform pg_temp.become((select id from v where k = 'admin'));
  v_external := public.create_external_professional(v_prospect);
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '10.3 an identity with acquisition provenance cannot be deleted (RESTRICT)',
    pg_temp.sqlstate_of(format('delete from public.professionals where id = %L', v_external)) = '23503',
    'provenance is evidence');

  perform pg_temp.expect(
    '10.4 deleting the prospect removes the LINK, not the identity',
    pg_temp.sqlstate_of(format('delete from public.prospects where id = %L', v_prospect)) = 'ALLOWED'
    and exists (select 1 from public.professionals where id = v_external));
exception when others then
  perform pg_temp.record('10.3 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_before integer;
begin
  -- Service history must not cascade away through any new path.
  select count(*) into v_before from public.appointments;

  perform pg_temp.expect('10.5 appointment history exists to protect', v_before > 0);

  perform pg_temp.expect(
    '10.6 deleting a barber that owns history is still refused (R1A preserved)',
    pg_temp.sqlstate_of(format(
      'delete from public.barbers where id = %L', (select id from v where k = 'barber3'))) = '23503');

  perform pg_temp.expect(
    '10.7 appointment history is intact after that refusal',
    (select count(*) from public.appointments) = v_before);
exception when others then
  perform pg_temp.record('10.5 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 11. UPGRADE-ONLY — the seeded pre-R1B database
--
-- Reported as INFO and skipped on a fresh database: these rows only exist when
-- SEED_R1B_PRE_UPGRADE_2026_08_26.sql was loaded before MASTER.
-- ============================================================================

do $$
declare
  v_seeded boolean;
  v_prof_a uuid;
  v_prof_erased uuid;
begin
  select exists (select 1 from public.organizations where id = 'bbbbbbbb-0000-4000-8000-000000000001')
    into v_seeded;

  if not v_seeded then
    perform pg_temp.record('11.0 pre-R1B upgrade fixtures', 'INFO',
      'not present — this is the fresh-database run');
    return;
  end if;

  perform pg_temp.record('11.0 pre-R1B upgrade fixtures', 'INFO', 'present — upgrade assertions run');

  select professional_id into v_prof_a from public.barbers
  where id = 'bbbbbbbb-0000-4000-8000-000000000050';

  perform pg_temp.expect(
    '11.1 the backfill gave the two-shop barber ONE identity across both rosters',
    v_prof_a = (select professional_id from public.barbers
                where id = 'bbbbbbbb-0000-4000-8000-000000000051'));

  perform pg_temp.expect(
    '11.2 that identity is claimed by the right account',
    (select claim_state = 'claimed' and user_id = 'bbbbbbbb-0000-4000-8000-000000000012'
     from public.professionals where id = v_prof_a));

  perform pg_temp.expect(
    '11.3 the deterministic tie-break took the EARLIEST staff profile''s name',
    (select display_name = 'Ash Two-Shops (A)' from public.professionals where id = v_prof_a),
    'ordered by (user_id, created_at, id), so a re-run produces the same result');

  perform pg_temp.expect(
    '11.4 claimed_at is the earliest roster date, not the migration date',
    (select claimed_at = timestamptz '2026-01-10 09:00:00+00'
     from public.professionals where id = v_prof_a),
    'stamping now() would claim a ten-year-old shop''s staff were all claimed today');

  -- The detached roster row: R1A's erasure path made this reachable.
  select professional_id into v_prof_erased from public.barbers
  where id = 'bbbbbbbb-0000-4000-8000-000000000052';

  perform pg_temp.expect(
    '11.5 a roster row whose account was erased still gets a durable identity',
    v_prof_erased is not null);

  perform pg_temp.expect(
    '11.6 and that identity is UNCLAIMED, not a fabricated claimed one',
    (select claim_state = 'unclaimed' and user_id is null and claimed_at is null
     from public.professionals where id = v_prof_erased),
    'the person worked here; nobody controls the identity now');

  perform pg_temp.expect(
    '11.7 no backfilled identity was published',
    not exists (select 1 from public.professionals
                where is_public and source = 'fadeup'
                  and id in (select professional_id from public.barbers)),
    'is_public is never inherited from staff_profiles');

  perform pg_temp.expect(
    '11.8 no handle was invented for anyone',
    not exists (select 1 from public.professionals where handle is not null));

  perform pg_temp.expect(
    '11.9 historical appointments survived the upgrade intact',
    (select count(*) from public.appointments
     where id in ('bbbbbbbb-0000-4000-8000-000000000080', 'bbbbbbbb-0000-4000-8000-000000000081',
                  'bbbbbbbb-0000-4000-8000-000000000082', 'bbbbbbbb-0000-4000-8000-000000000083')) = 4);
exception when others then
  perform pg_temp.record('11.0 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_seeded boolean;
begin
  select exists (select 1 from public.customer_passports where id = 'bbbbbbbb-0000-4000-8000-000000000060')
    into v_seeded;
  if not v_seeded then return; end if;

  perform pg_temp.expect(
    '11.10 a pre-existing Passport was given a number',
    (select passport_number is not null and issued_at is not null
     from public.customer_passports where id = 'bbbbbbbb-0000-4000-8000-000000000060'));

  perform pg_temp.expect(
    '11.11 and its CONTENT was not touched',
    (select usual_haircut = 'Mid fade, scissors on top'
            and fade_type = 'mid'
            and preferences_notes = 'No clippers above the crown please'
            and created_at = timestamptz '2026-02-02 11:00:00+00'
     from public.customer_passports where id = 'bbbbbbbb-0000-4000-8000-000000000060'));

  perform pg_temp.expect(
    '11.12 a customer who never opened the Passport screen was issued one',
    exists (select 1 from public.customer_passports
            where user_id = 'bbbbbbbb-0000-4000-8000-000000000014'));

  perform pg_temp.expect(
    '11.13 an account with no customer_profiles row was NOT issued one',
    not exists (select 1 from public.customer_passports
                where user_id = 'bbbbbbbb-0000-4000-8000-000000000015'));
exception when others then
  perform pg_temp.record('11.10 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  v_seeded boolean;
  v_prof uuid;
  v_written bigint;
  v_removed bigint;
begin
  select exists (select 1 from public.appointments where id = 'bbbbbbbb-0000-4000-8000-000000000080')
    into v_seeded;
  if not v_seeded then return; end if;

  select professional_id into v_prof from public.barbers where id = 'bbbbbbbb-0000-4000-8000-000000000050';

  perform pg_temp.expect(
    '11.14 R1B does NOT retroactively backfill the relationship aggregate',
    not exists (select 1 from public.customer_professional_relationships
                where customer_user_id = 'bbbbbbbb-0000-4000-8000-000000000013'),
    'deferred deliberately: it is derivable on demand, and the migration must not rewrite the appointments table');

  -- Reconciliation is how history is brought in, and it must be exactly right.
  perform pg_temp.become((select id from v where k = 'admin'));
  select rows_written, rows_removed into v_written, v_removed
  from public.reconcile_customer_professional_relationships();
  perform pg_temp.become_postgres();

  perform pg_temp.expect(
    '11.15 reconciliation reproduces the aggregate from historical evidence',
    (select completed_interaction_count = 2
     from public.customer_professional_relationships
     where customer_user_id = 'bbbbbbbb-0000-4000-8000-000000000013' and professional_id = v_prof),
    'two completed self-booked appointments with a trustworthy completed_at; the third has completed_at NULL and is EXCLUDED rather than invented');

  perform pg_temp.expect(
    '11.16 the SQUAT earns the attacker nothing',
    not exists (select 1 from public.customer_professional_relationships
                where customer_user_id = 'bbbbbbbb-0000-4000-8000-000000000017')
    and not exists (select 1 from public.professional_follows
                    where follower_user_id = 'bbbbbbbb-0000-4000-8000-000000000017'),
    'the anonymous booking landed on the attacker''s customers row and attributed to nobody');

  perform pg_temp.expect(
    '11.17 a served historical walk-in IS counted',
    exists (select 1 from public.customer_professional_relationships
            where customer_user_id = 'bbbbbbbb-0000-4000-8000-000000000014'),
    'Constitution §3.3 names a served queue visit as completed-service evidence');

  perform pg_temp.expect(
    '11.18 an already-converted prospect keeps its conversion',
    (select converted_organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
     from public.prospects where id = 'bbbbbbbb-0000-4000-8000-0000000000a1'));
exception when others then
  perform pg_temp.record('11.14 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
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
