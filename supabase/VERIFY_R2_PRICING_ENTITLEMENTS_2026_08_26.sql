-- ============================================================================
-- FadeUp — VERIFY: R2, the pricing and entitlements foundation
--
-- Companion to MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql.
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
-- FAIL with the SQLSTATE. Without that, an error in block 6 would abort the
-- transaction, every later insert into verify_results would fail too, and the
-- summary would print PASS=0 FAIL=0 — a suite that reports nothing while
-- looking like it reported success. Section 15 checks the count for the same
-- reason.
--
-- WHAT THIS SUITE DOES NOT TEST
--   True parallelism. Every check here runs in ONE session, so "the second
--   attempt is refused" proves serialized contention, not a race. The genuine
--   two-connection races — two managers creating the same third location, two
--   invitations onto a Solo plan, a downgrade racing a location insert — are in
--   scripts/r2-concurrency-test.sh, which fires real simultaneous connections.
--   Section 13 asserts that the locking MECHANISM is present; the script proves
--   it works.
--
-- Safe to run repeatedly: all fixtures live in a transaction that is rolled
-- back at the end.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
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

-- Puts a fixture ON a plan directly, as postgres, bypassing the platform-admin
-- RPC. Used only to set up capacity tests; authorization is never tested this
-- way — section 7 goes through the real RPC.
create or replace function pg_temp.put_on_plan(p_org uuid, p_plan text)
returns void language sql as $$
  update public.organization_commercial_state
  set plan_key = p_plan, status = 'active', entitlement_source = 'platform_grant'
  where organization_id = p_org;
$$;

begin;

-- ============================================================================
-- 1. THE PLAN CATALOGUE
--
-- The prices below are restated as literals so that a change to the seed and a
-- change to the test cannot be the same edit.
-- ============================================================================

do $$
declare r record;
begin
  perform pg_temp.expect(
    '1.01 exactly eight canonical plans exist',
    (select count(*) from public.commercial_plans) = 8,
    (select string_agg(plan_key, ', ' order by plan_key) from public.commercial_plans));

  for r in
    select * from (values
      ('free',            'free',        'Free',      0),
      ('solo',            'independent', 'Solo',      1900),
      ('salon_essential', 'salon',       'Essential', 2900),
      ('salon_pro',       'salon',       'Pro',       4900),
      ('salon_business',  'salon',       'Business',  7900),
      ('multi_growth',    'multi_salon', 'Growth',    9900),
      ('multi_pro',       'multi_salon', 'Pro',       14900),
      ('multi_scale',     'multi_salon', 'Scale',     24900)
    ) as e(plan_key, fam, display_name, price_minor)
  loop
    perform pg_temp.expect(
      format('1.02 %s is "%s" at %s minor EUR in family %s',
             r.plan_key, r.display_name, r.price_minor, r.fam),
      exists (
        select 1 from public.commercial_plans p
        where p.plan_key = r.plan_key
          and p.commercial_family::text = r.fam
          and p.display_name = r.display_name
          and p.price_minor = r.price_minor
          and p.price_currency = 'EUR'
      ));
  end loop;

  for r in
    select * from (values
      ('free',            1,  1),
      ('solo',            1,  1),
      ('salon_essential', 1,  null::integer),
      ('salon_pro',       1,  null),
      ('salon_business',  1,  null),
      ('multi_growth',    2,  null),
      ('multi_pro',       5,  null),
      ('multi_scale',     10, null)
    ) as e(plan_key, max_est, max_pro)
  loop
    perform pg_temp.expect(
      format('1.03 %s covers %s establishment(s) and %s professional(s)',
             r.plan_key, r.max_est, coalesce(r.max_pro::text, 'unlimited')),
      exists (
        select 1 from public.commercial_plans p
        where p.plan_key = r.plan_key
          and p.max_establishments = r.max_est
          and p.max_operational_professionals is not distinct from r.max_pro
      ));
  end loop;
exception when others then
  perform pg_temp.record('1.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
begin
  -- IDENTITY. The display word "Pro" names two different products at two
  -- different prices; the machine keys are what logic may branch on.
  perform pg_temp.expect(
    '1.04 salon_pro and multi_pro are distinct identities sharing one label',
    (select count(*) from public.commercial_plans where display_name = 'Pro') = 2
    and (select price_minor from public.commercial_plans where plan_key = 'salon_pro') = 4900
    and (select price_minor from public.commercial_plans where plan_key = 'multi_pro') = 14900,
    'branching on the label "Pro" would conflate a EUR 49 single salon with a EUR 149 five-salon group');

  perform pg_temp.expect(
    '1.05 plan_key is the primary key, so identity cannot collide',
    exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.commercial_plans'::regclass
        and c.contype = 'p'
        and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (plan_key)'
    ));

  perform pg_temp.expect(
    '1.06 display_name carries NO unique constraint',
    not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.commercial_plans'::regclass
        and c.contype = 'u'
        and pg_get_constraintdef(c.oid) like '%display_name%'
    ),
    'deliberate: two plans legitimately read "Pro", and a unique constraint would force one to be renamed for the database''s convenience');

  perform pg_temp.expect(
    '1.07 price is not an identity — it carries no unique constraint either',
    not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.commercial_plans'::regclass
        and c.contype = 'u'
        and pg_get_constraintdef(c.oid) like '%price_minor%'
    ));

  -- OBSOLETE PRICING. The pre-R2 assumptions were EUR 20 independent and
  -- EUR 35/39/69 per-location shop tiers. None may be canonical.
  perform pg_temp.expect(
    '1.08 obsolete subscription prices (EUR 20/35/39/69) are absent',
    not exists (
      select 1 from public.commercial_plans where price_minor in (2000, 3500, 3900, 6900)
    ),
    (select coalesce(string_agg(format('%s=%s', plan_key, price_minor), ', '), 'none present')
     from public.commercial_plans where price_minor in (2000, 3500, 3900, 6900)));

  perform pg_temp.expect(
    '1.09 exactly one recommended plan in each family that offers a choice',
    not exists (
      select 1 from public.commercial_plans
      group by commercial_family
      having (count(*) > 1 and count(*) filter (where is_recommended) <> 1)
          or (count(*) = 1 and count(*) filter (where is_recommended) <> 0)
    ),
    'salon_pro and multi_pro are the two recommended plans');

  perform pg_temp.expect(
    '1.10 the four commercial families are exactly free/independent/salon/multi_salon',
    (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'commercial_family')
    = array['free', 'independent', 'salon', 'multi_salon']);
exception when others then
  perform pg_temp.record('1.04 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 2. NO PER-SEAT, NO PER-LOCATION MULTIPLICATION
--
-- If these hold, "price x count" is not a policy FadeUp chose not to apply —
-- it is arithmetic with no operand.
-- ============================================================================

do $$
declare v_cols text;
begin
  select coalesce(string_agg(format('%s.%s', table_name, column_name), ', '), '')
    into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('commercial_plans', 'organization_commercial_state', 'plan_capabilities')
    and (column_name like '%seat%' or column_name like '%quantity%'
         or column_name like 'per\_%' or column_name like '%\_per\_%'
         or column_name like '%unit_price%');

  perform pg_temp.expect(
    '2.01 no seat/quantity/per-unit column exists on any commercial table',
    v_cols = '',
    coalesce(nullif(v_cols, ''), 'none — there is no number for a price to be multiplied by'));

  perform pg_temp.expect(
    '2.02 commercial_plans carries exactly one price and one currency',
    (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'commercial_plans'
       and column_name like '%price%') = 2,
    'a second price axis is the shape of "base + per unit"');

  select coalesce(string_agg(column_name, ', '), '') into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'organization_commercial_state'
    and (column_name like '%count%' or column_name like '%barber%'
         or column_name like '%staff%' or column_name like '%member%');

  perform pg_temp.expect(
    '2.03 commercial state carries no headcount — team is not a billing input',
    v_cols = '',
    coalesce(nullif(v_cols, ''), 'none'));

  -- The multi-salon prices are TOTALS. Asserted as explicit non-equality
  -- against the per-establishment reading, because that is the specific error
  -- this pricing model exists to prevent.
  perform pg_temp.expect(
    '2.04 multi_growth is EUR 99 TOTAL for 2 establishments, not 99 x 2',
    (select price_minor from public.commercial_plans where plan_key = 'multi_growth') = 9900
    and (select price_minor from public.commercial_plans where plan_key = 'multi_growth') <> 19800);

  perform pg_temp.expect(
    '2.05 multi_pro is EUR 149 TOTAL for 5 establishments, not 149 x 5',
    (select price_minor from public.commercial_plans where plan_key = 'multi_pro') = 14900
    and (select price_minor from public.commercial_plans where plan_key = 'multi_pro') <> 74500);

  perform pg_temp.expect(
    '2.06 multi_scale is EUR 249 TOTAL for 10 establishments, not 249 x 10',
    (select price_minor from public.commercial_plans where plan_key = 'multi_scale') = 24900
    and (select price_minor from public.commercial_plans where plan_key = 'multi_scale') <> 249000);

  perform pg_temp.expect(
    '2.07 every salon and multi plan has UNLIMITED professionals (team included)',
    not exists (
      select 1 from public.commercial_plans
      where commercial_family in ('salon', 'multi_salon')
        and max_operational_professionals is not null
    ),
    'NULL, deliberately — a large number would be a multiplier waiting to be found');
exception when others then
  perform pg_temp.record('2.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 3. THE CAPABILITY CATALOGUE AND THE MATRIX
-- ============================================================================

do $$
declare r record;
begin
  perform pg_temp.expect(
    '3.01 the capability catalogue has the 30 audited application capabilities',
    (select count(*) from public.commercial_capabilities) = 30,
    format('found %s', (select count(*) from public.commercial_capabilities)));

  perform pg_temp.expect(
    '3.02 every capability declares live/planned with non-empty evidence',
    not exists (
      select 1 from public.commercial_capabilities
      where status not in ('live', 'planned') or btrim(evidence) = ''
    ));

  perform pg_temp.expect(
    '3.03 Fade Passport is in EVERY plan, including free',
    not exists (
      select 1 from public.commercial_plans p
      where not exists (
        select 1 from public.plan_capabilities pc
        where pc.plan_key = p.plan_key and pc.capability_key = 'passport'
      )
    ),
    'a customer owns their Passport and carries it between shops — paywalling it would break the thing that makes it worth having');

  perform pg_temp.expect(
    '3.04 every plan resolves to a non-empty capability set',
    not exists (
      select 1 from public.commercial_plans p
      where not exists (select 1 from public.plan_capabilities pc where pc.plan_key = p.plan_key)
    ));

  perform pg_temp.expect(
    '3.05 free is strictly smaller than solo',
    (select count(*) from public.plan_capabilities where plan_key = 'free')
    < (select count(*) from public.plan_capabilities where plan_key = 'solo'),
    format('free=%s, solo=%s',
      (select count(*) from public.plan_capabilities where plan_key = 'free'),
      (select count(*) from public.plan_capabilities where plan_key = 'solo')));

  perform pg_temp.expect(
    '3.06 free grants NO booking, customers, team or queue — presence, not the operating system',
    not exists (
      select 1 from public.plan_capabilities
      where plan_key = 'free'
        and capability_key in ('booking', 'customers', 'customerHistory', 'team', 'liveQueue', 'chairs')
    ));

  perform pg_temp.expect(
    '3.07 the matrix references no capability outside the catalogue',
    not exists (
      select 1 from public.plan_capabilities pc
      where not exists (
        select 1 from public.commercial_capabilities c where c.capability_key = pc.capability_key
      )
    ));

  perform pg_temp.expect(
    '3.08 every catalogued capability is packaged by at least one plan',
    not exists (
      select 1 from public.commercial_capabilities c
      where not exists (
        select 1 from public.plan_capabilities pc where pc.capability_key = c.capability_key
      )
    ),
    (select coalesce(string_agg(c.capability_key, ', '), 'none orphaned')
     from public.commercial_capabilities c
     where not exists (select 1 from public.plan_capabilities pc where pc.capability_key = c.capability_key)));

  -- Monotonic within each family: a dearer plan never packages LESS. A pricing
  -- page that says "everything in Essential, plus…" has to be true.
  for r in
    select a.plan_key as cheaper, b.plan_key as dearer
    from public.commercial_plans a
    join public.commercial_plans b
      on b.commercial_family = a.commercial_family and b.tier = a.tier + 1
  loop
    perform pg_temp.expect(
      format('3.09 %s packages everything %s does', r.dearer, r.cheaper),
      not exists (
        select 1 from public.plan_capabilities pc
        where pc.plan_key = r.cheaper
          and not exists (
            select 1 from public.plan_capabilities pd
            where pd.plan_key = r.dearer and pd.capability_key = pc.capability_key
          )
      ));
  end loop;
exception when others then
  perform pg_temp.record('3.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- FIXTURES
--
-- Four organizations and eight accounts, so the enforcement sections have
-- something to enforce against. All rolled back at the end.
-- ============================================================================

create temporary table v (k text primary key, id uuid);

do $$
declare r record;
begin
  insert into v (k, id) values
    ('owner_solo',  'dddddddd-0000-4000-8000-000000000010'),
    ('owner_salon', 'dddddddd-0000-4000-8000-000000000011'),
    ('owner_multi', 'dddddddd-0000-4000-8000-000000000012'),
    ('barber',      'dddddddd-0000-4000-8000-000000000013'),
    ('customer',    'dddddddd-0000-4000-8000-000000000014'),
    ('outsider',    'dddddddd-0000-4000-8000-000000000015'),
    ('admin',       'dddddddd-0000-4000-8000-000000000016'),
    ('support',     'dddddddd-0000-4000-8000-000000000017'),
    ('org_solo',    'dddddddd-0000-4000-8000-000000000001'),
    ('org_salon',   'dddddddd-0000-4000-8000-000000000002'),
    ('org_multi',   'dddddddd-0000-4000-8000-000000000003'),
    ('org_other',   'dddddddd-0000-4000-8000-000000000004');

  for r in
    select k, id from v
    where k in ('owner_solo','owner_salon','owner_multi','barber','customer','outsider','admin','support')
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
            'r2-verify-' || r.k || '@fadeup.test', 'x', '{}', '{}', now(), now());
  end loop;

  insert into public.platform_members (user_id, role, note) values
    ((select id from v where k = 'admin'), 'platform_admin', 'R2 VERIFY'),
    -- platform_support deliberately does NOT satisfy is_platform_admin();
    -- 20260810130000 argues that it must carry no financial authority.
    ((select id from v where k = 'support'), 'platform_support', 'R2 VERIFY');

  for r in
    select * from (values
      ('org_solo',  'R2 Verify Solo',  'r2-verify-solo'),
      ('org_salon', 'R2 Verify Salon', 'r2-verify-salon'),
      ('org_multi', 'R2 Verify Multi', 'r2-verify-multi'),
      ('org_other', 'R2 Verify Other', 'r2-verify-other')
    ) as o(k, name, slug)
  loop
    perform set_config('fadeup.org_creation_authorized', 'on', true);
    perform set_config('fadeup.skip_org_owner_membership', 'on', true);
    insert into public.organizations (id, name, slug)
    values ((select id from v where k = r.k), r.name, r.slug);
  end loop;

  insert into public.memberships (organization_id, user_id, role) values
    ((select id from v where k = 'org_solo'),  (select id from v where k = 'owner_solo'),  'owner'),
    ((select id from v where k = 'org_salon'), (select id from v where k = 'owner_salon'), 'owner'),
    ((select id from v where k = 'org_salon'), (select id from v where k = 'barber'),      'barber'),
    ((select id from v where k = 'org_multi'), (select id from v where k = 'owner_multi'), 'owner'),
    ((select id from v where k = 'org_other'), (select id from v where k = 'outsider'),    'owner');
exception when others then
  perform pg_temp.record('FIXTURES (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 4. COMMERCIAL STATE: EXACTLY ONE PER ORGANIZATION, DEFAULTING SAFE
-- ============================================================================

do $$
begin
  perform pg_temp.expect(
    '4.01 every organization in the database has commercial state',
    not exists (
      select 1 from public.organizations o
      where not exists (
        select 1 from public.organization_commercial_state s where s.organization_id = o.id
      )
    ),
    format('%s organization(s) without state',
      (select count(*) from public.organizations o
       where not exists (select 1 from public.organization_commercial_state s
                         where s.organization_id = o.id))));

  perform pg_temp.expect(
    '4.02 organization_id is the PRIMARY KEY, so a second row is unrepresentable',
    exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.organization_commercial_state'::regclass
        and c.contype = 'p'
        and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (organization_id)'
    ),
    'load-bearing beyond tidiness: the capacity triggers lock this row as the per-organization mutex');

  perform pg_temp.expect(
    '4.03 a NEW organization defaults to free/active/early_access',
    (select plan_key = 'free' and status = 'active' and entitlement_source = 'early_access'
     from public.organization_commercial_state
     where organization_id = (select id from v where k = 'org_solo')),
    'the honest default for an organization that has paid nothing, and the safe one — free is the most restrictive plan');

  perform pg_temp.expect(
    '4.04 a new organization opens its audit trail',
    exists (
      select 1 from public.commercial_plan_changes
      where organization_id = (select id from v where k = 'org_solo')
        and previous_plan_key is null and new_plan_key = 'free'
    ));

  perform pg_temp.expect(
    '4.05 NOTHING in the database claims billing as its entitlement source',
    not exists (select 1 from public.organization_commercial_state where entitlement_source = 'billing'),
    'no billing provider is integrated, so a billing source would be fabricated evidence');

  perform pg_temp.expect(
    '4.06 no provider reference is populated anywhere',
    not exists (
      select 1 from public.organization_commercial_state
      where provider is not null or provider_customer_ref is not null
         or provider_subscription_ref is not null
    ),
    'R2 is provider-agnostic; the columns exist so a later billing lot needs no migration');

  perform pg_temp.expect(
    '4.07 free cannot be past_due or canceled (23514)',
    pg_temp.sqlstate_of(format(
      'update public.organization_commercial_state set status = ''past_due'' where organization_id = %L',
      (select id from v where k = 'org_solo'))) = '23514',
    'free + past_due is unrepresentable: there is nothing to owe');
exception when others then
  perform pg_temp.record('4.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 5. THE EFFECTIVE RESOLVER
-- ============================================================================

do $$
declare v_org uuid;
begin
  v_org := (select id from v where k = 'org_salon');
  perform pg_temp.put_on_plan(v_org, 'salon_pro');

  perform pg_temp.expect(
    '5.01 an active plan resolves to itself',
    private.effective_plan_key(v_org) = 'salon_pro');

  perform pg_temp.expect(
    '5.02 salon_pro grants liveQueue',
    private.org_has_capability(v_org, 'liveQueue'));

  perform pg_temp.expect(
    '5.03 salon_pro does NOT grant multiLocation',
    not private.org_has_capability(v_org, 'multiLocation'));

  perform pg_temp.expect(
    '5.04 an UNKNOWN capability fails closed',
    not private.org_has_capability(v_org, 'thisCapabilityDoesNotExist'),
    'a gate that fails open on a typo is decorative');

  perform pg_temp.expect(
    '5.05 an UNKNOWN organization fails closed',
    not private.org_has_capability('dddddddd-0000-4000-8000-0000000000ff', 'booking'));

  perform pg_temp.expect(
    '5.06 a NULL organization fails closed',
    not private.org_has_capability(null, 'booking'));

  perform pg_temp.expect(
    '5.07 a packaged-but-UNBUILT capability resolves FALSE even on the plan that packages it',
    exists (select 1 from public.plan_capabilities
            where plan_key = 'salon_pro' and capability_key = 'retentionAutomation')
    and not private.org_has_capability(v_org, 'retentionAutomation'),
    'status = planned; FadeUp does not sell access to something it has not built');

  -- STATUS semantics, applied once, in the resolver.
  update public.organization_commercial_state set status = 'past_due' where organization_id = v_org;
  perform pg_temp.expect(
    '5.08 past_due KEEPS the plan — a failed payment is a conversation, not a shutdown',
    private.effective_plan_key(v_org) = 'salon_pro'
    and private.org_has_capability(v_org, 'liveQueue'));

  update public.organization_commercial_state set status = 'canceled' where organization_id = v_org;
  perform pg_temp.expect(
    '5.09 canceled degrades to free — network presence, nothing deleted',
    private.effective_plan_key(v_org) = 'free'
    and not private.org_has_capability(v_org, 'liveQueue')
    and private.org_has_capability(v_org, 'passport'),
    'the Passport stays, because it is the customer''s and not the shop''s');

  perform pg_temp.expect(
    '5.10 the assigned plan is still visible while canceled',
    (select plan_key from public.organization_commercial_state where organization_id = v_org) = 'salon_pro',
    'effective_plan_key derives; it does not rewrite history');

  update public.organization_commercial_state set status = 'active' where organization_id = v_org;
  perform pg_temp.expect(
    '5.11 reactivating restores capabilities with no data reconstruction',
    private.org_has_capability(v_org, 'liveQueue'));
exception when others then
  perform pg_temp.record('5.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 6. AUTHORIZATION AND CROSS-TENANT ISOLATION
-- ============================================================================

do $$
declare
  v_salon uuid;
  v_other uuid;
  v_state text;
  v_bool boolean;
begin
  v_salon := (select id from v where k = 'org_salon');
  v_other := (select id from v where k = 'org_other');

  perform pg_temp.expect(
    '6.01 a member reads their own entitlements',
    pg_temp.sqlstate_as((select id from v where k = 'owner_salon'),
      format('select * from public.get_organization_entitlements(%L)', v_salon)) = 'ALLOWED');

  perform pg_temp.expect(
    '6.02 a member of ANOTHER organization is refused (42501)',
    pg_temp.sqlstate_as((select id from v where k = 'outsider'),
      format('select * from public.get_organization_entitlements(%L)', v_salon)) = '42501');

  perform pg_temp.expect(
    '6.03 a customer with no membership anywhere is refused (42501)',
    pg_temp.sqlstate_as((select id from v where k = 'customer'),
      format('select * from public.get_organization_entitlements(%L)', v_salon)) = '42501');

  -- NO EXISTENCE ORACLE. A non-existent organization must produce the SAME
  -- refusal as one that exists and belongs to someone else.
  v_state := pg_temp.sqlstate_as((select id from v where k = 'outsider'),
    'select * from public.get_organization_entitlements(''dddddddd-0000-4000-8000-0000000000fe'')');
  perform pg_temp.expect(
    '6.04 a NON-EXISTENT organization is refused identically — no existence oracle',
    v_state = '42501'
    and v_state = pg_temp.sqlstate_as((select id from v where k = 'outsider'),
      format('select * from public.get_organization_entitlements(%L)', v_salon)),
    format('both refusals are %s', v_state));

  perform pg_temp.expect(
    '6.05 anon cannot call the entitlement resolver at all',
    pg_temp.sqlstate_as_anon(format('select * from public.get_organization_entitlements(%L)', v_salon))
      in ('42501', '42883'));

  perform pg_temp.become((select id from v where k = 'outsider'));
  select public.my_organization_has_capability(v_salon, 'booking') into v_bool;
  perform pg_temp.become_postgres();
  perform pg_temp.expect(
    '6.06 my_organization_has_capability returns FALSE for a non-member, not an error',
    v_bool = false,
    'false is also the answer for a non-existent organization and an unknown capability, so all cases are indistinguishable');

  perform pg_temp.become((select id from v where k = 'outsider'));
  perform pg_temp.expect(
    '6.07 RLS hides another tenant''s commercial state row',
    not exists (select 1 from public.organization_commercial_state where organization_id = v_salon));
  perform pg_temp.expect(
    '6.08 RLS shows the caller their OWN commercial state row',
    exists (select 1 from public.organization_commercial_state where organization_id = v_other));
  perform pg_temp.expect(
    '6.09 RLS hides another tenant''s commercial history',
    not exists (select 1 from public.commercial_plan_changes where organization_id = v_salon));
  perform pg_temp.become_postgres();

  -- A barber is a member, so they may see which plan their shop is on; the
  -- decision history is owner/manager only.
  perform pg_temp.become((select id from v where k = 'barber'));
  perform pg_temp.expect(
    '6.10 a barber may see which plan their shop is on',
    exists (select 1 from public.organization_commercial_state where organization_id = v_salon));
  perform pg_temp.expect(
    '6.11 a barber may NOT read the commercial decision history',
    not exists (select 1 from public.commercial_plan_changes where organization_id = v_salon));
  perform pg_temp.become_postgres();

  -- anon is refused at the PRIVILEGE layer, not merely filtered to zero rows by
  -- RLS. That is the stronger property and the one 20260826110700 asserts: a
  -- future permissive policy could not open these tables to anon, because anon
  -- holds no SELECT to begin with.
  perform pg_temp.expect(
    '6.12 anon is refused commercial state at the privilege layer, not filtered by RLS',
    pg_temp.sqlstate_as_anon('select 1 from public.organization_commercial_state') = '42501');
  perform pg_temp.expect(
    '6.13 anon is refused the plan catalogue at the privilege layer',
    pg_temp.sqlstate_as_anon('select 1 from public.commercial_plans') = '42501',
    'the marketing pricing page renders the application''s compiled catalogue, so nothing anonymous needs to read this');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('6.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 7. NOBODY CAN GRANT THEMSELVES A PLAN
-- ============================================================================

do $$
declare v_salon uuid;
begin
  v_salon := (select id from v where k = 'org_salon');

  -- The direct write path. Not "refused by a policy that happens to be
  -- correct" — there is no privilege for the statement to use.
  perform pg_temp.expect(
    '7.01 an OWNER cannot PATCH a paid plan onto their own organization',
    pg_temp.sqlstate_as((select id from v where k = 'owner_salon'), format(
      'update public.organization_commercial_state set plan_key = ''multi_scale'' where organization_id = %L',
      v_salon)) = '42501');

  perform pg_temp.expect(
    '7.02 a BARBER cannot PATCH a paid plan',
    pg_temp.sqlstate_as((select id from v where k = 'barber'), format(
      'update public.organization_commercial_state set plan_key = ''salon_business'' where organization_id = %L',
      v_salon)) = '42501');

  perform pg_temp.expect(
    '7.03 a CUSTOMER cannot PATCH a paid plan',
    pg_temp.sqlstate_as((select id from v where k = 'customer'), format(
      'update public.organization_commercial_state set plan_key = ''multi_scale'' where organization_id = %L',
      v_salon)) = '42501');

  perform pg_temp.expect(
    '7.04 an owner cannot INSERT commercial state',
    pg_temp.sqlstate_as((select id from v where k = 'owner_salon'),
      'insert into public.organization_commercial_state (organization_id, plan_key) values (gen_random_uuid(), ''multi_scale'')')
      = '42501');

  perform pg_temp.expect(
    '7.05 an owner cannot set entitlement_source = billing to fake a payment',
    pg_temp.sqlstate_as((select id from v where k = 'owner_salon'), format(
      'update public.organization_commercial_state set status = ''active'', entitlement_source = ''billing'' where organization_id = %L',
      v_salon)) = '42501');

  perform pg_temp.expect(
    '7.06 anon cannot write commercial state',
    pg_temp.sqlstate_as_anon(format(
      'update public.organization_commercial_state set plan_key = ''multi_scale'' where organization_id = %L',
      v_salon)) = '42501');

  perform pg_temp.expect(
    '7.07 nobody can edit the plan CATALOGUE to change a price',
    pg_temp.sqlstate_as((select id from v where k = 'owner_salon'),
      'update public.commercial_plans set price_minor = 0 where plan_key = ''multi_scale''') = '42501');

  -- The RPC path.
  perform pg_temp.expect(
    '7.08 an OWNER cannot call assign_commercial_plan (42501)',
    pg_temp.sqlstate_as((select id from v where k = 'owner_salon'),
      format('select public.assign_commercial_plan(%L, ''multi_scale'')', v_salon)) = '42501',
    'the party being charged cannot decide what it owes');

  perform pg_temp.expect(
    '7.09 a CUSTOMER cannot call assign_commercial_plan (42501)',
    pg_temp.sqlstate_as((select id from v where k = 'customer'),
      format('select public.assign_commercial_plan(%L, ''salon_pro'')', v_salon)) = '42501');

  perform pg_temp.expect(
    '7.10 PLATFORM SUPPORT cannot change a plan — support has no financial authority',
    pg_temp.sqlstate_as((select id from v where k = 'support'),
      format('select public.assign_commercial_plan(%L, ''multi_scale'')', v_salon)) = '42501');

  perform pg_temp.expect(
    '7.11 anon cannot call assign_commercial_plan',
    pg_temp.sqlstate_as_anon(format('select public.assign_commercial_plan(%L, ''multi_scale'')', v_salon))
      in ('42501', '42883'));

  -- A platform admin CAN, and the change is recorded honestly.
  perform pg_temp.expect(
    '7.12 a PLATFORM ADMIN can assign a plan',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      format('select public.assign_commercial_plan(%L, ''salon_business'', ''active'', ''R2 VERIFY'')', v_salon))
      = 'ALLOWED');

  perform pg_temp.expect(
    '7.13 the assignment is stamped platform_grant, never billing',
    (select plan_key = 'salon_business' and entitlement_source = 'platform_grant'
            and assigned_by = (select id from v where k = 'admin')
     from public.organization_commercial_state where organization_id = v_salon),
    'no argument to the RPC can dress a staff decision up as a payment');

  perform pg_temp.expect(
    '7.14 the assignment appended an audit row naming the actor',
    exists (
      select 1 from public.commercial_plan_changes
      where organization_id = v_salon and new_plan_key = 'salon_business'
        and changed_by = (select id from v where k = 'admin')
    ));

  perform pg_temp.expect(
    '7.15 the audit trail is append-only even for postgres',
    pg_temp.sqlstate_of(format(
      'update public.commercial_plan_changes set change_reason = ''rewritten'' where organization_id = %L',
      v_salon)) = '42501',
    'an audit trail the most powerful role can rewrite is a log, not an audit trail');

  perform pg_temp.expect(
    '7.16 the audit trail cannot be deleted either',
    pg_temp.sqlstate_of(format(
      'delete from public.commercial_plan_changes where organization_id = %L', v_salon)) = '42501');

  perform pg_temp.expect(
    '7.17 an UNKNOWN plan fails closed (22023)',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      format('select public.assign_commercial_plan(%L, ''enterprise_unlimited'')', v_salon)) = '22023');

  perform pg_temp.expect(
    '7.18 a NULL plan fails closed',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      format('select public.assign_commercial_plan(%L, null)', v_salon)) = '22023');

  perform pg_temp.expect(
    '7.19 assign_commercial_plan takes NO actor argument — identity is the session only',
    (select count(*) from information_schema.parameters
     where specific_schema = 'public'
       and specific_name like 'assign_commercial_plan%'
       and parameter_name in ('p_actor', 'p_user_id', 'p_changed_by')) = 0);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('7.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 8. THE SOLO INVARIANT: EXACTLY ONE OPERATIONAL PROFESSIONAL
-- ============================================================================

do $$
declare
  v_org uuid;
  v_sp1 uuid;
  v_sp2 uuid;
  v_prof_before bigint;
begin
  v_org := (select id from v where k = 'org_solo');
  perform pg_temp.put_on_plan(v_org, 'solo');

  insert into public.locations (id, organization_id, name, timezone, is_active)
  values ('dddddddd-0000-4000-8000-000000000020', v_org, 'Solo Chair', 'UTC', true);

  -- The owner already HAS a staff profile: creating the membership provisioned
  -- one (on_membership_created). Inserting a second would violate
  -- staff_profiles_org_user_unique, which is a fixture bug rather than a
  -- finding, so reuse the row the product actually produces.
  select sp.id into v_sp1
  from public.staff_profiles sp
  where sp.organization_id = v_org and sp.user_id = (select id from v where k = 'owner_solo');

  update public.staff_profiles
  set location_id = 'dddddddd-0000-4000-8000-000000000020', is_active = true
  where id = v_sp1;

  perform pg_temp.expect(
    '8.01 the FIRST operational professional is allowed on solo',
    pg_temp.sqlstate_of(format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp1)) = 'ALLOWED');

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_active, is_public)
  values (v_org, null, 'dddddddd-0000-4000-8000-000000000020', 'Solo Second Barber', true, true)
  returning id into v_sp2;

  perform pg_temp.expect(
    '8.02 the SECOND operational professional is REFUSED on solo (P0001)',
    pg_temp.sqlstate_of(format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp2)) = 'P0001',
    'Solo is one independent professional, not a cheap multi-barber salon');

  perform pg_temp.expect(
    '8.03 the refusal holds for a BYPASSRLS session — it is not an RLS policy',
    (select rolbypassrls from pg_roles where rolname = current_user)
    and pg_temp.sqlstate_of(format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp2)) = 'P0001',
    'this session bypasses RLS entirely and is still refused, which an RLS with-check could never achieve');

  -- FREE carries the same cap, for the same reason: if a free organization
  -- could roster five barbers, the free tier would quietly be the product and
  -- every paid plan would be optional.
  perform pg_temp.put_on_plan(v_org, 'free');
  perform pg_temp.expect(
    '8.04 FREE also refuses a second operational professional',
    pg_temp.sqlstate_of(format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp2)) = 'P0001');

  perform pg_temp.put_on_plan(v_org, 'solo');

  -- OFFBOARD -> REACTIVATE must not be a bypass.
  v_prof_before := (select count(*) from public.professionals);
  update public.staff_profiles set is_active = false where id = v_sp1;

  perform pg_temp.expect(
    '8.05 an INACTIVE roster row frees capacity — deactivation is the non-destructive route',
    pg_temp.sqlstate_of(format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp2)) = 'ALLOWED');

  perform pg_temp.expect(
    '8.06 REACTIVATING the offboarded professional is REFUSED — offboard/downgrade/re-onboard is not a bypass',
    pg_temp.sqlstate_of(format(
      'update public.staff_profiles set is_active = true where id = %L', v_sp1)) = 'P0001');

  perform pg_temp.expect(
    '8.07 NO durable professional identity was destroyed by any of the above',
    (select count(*) from public.professionals) >= v_prof_before,
    format('%s identities before, %s after — R2 caps roster PLACEMENTS, never identity',
      v_prof_before, (select count(*) from public.professionals)));

  perform pg_temp.expect(
    '8.08 the offboarded roster row still exists and still points at its identity',
    exists (
      select 1 from public.barbers b
      where b.staff_profile_id = v_sp1 and b.professional_id is not null
    ));
exception when others then
  perform pg_temp.record('8.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 9. ESTABLISHMENT CAPACITY
-- ============================================================================

do $$
declare
  v_org uuid;
  v_n integer;
  v_plan text;
begin
  v_org := (select id from v where k = 'org_multi');

  -- SINGLE-SALON PLANS: exactly one operating salon, at every tier and price.
  for v_n in 1..3 loop
    v_plan := (array['salon_essential','salon_pro','salon_business'])[v_n];
    update public.locations set is_active = false where organization_id = v_org;
    perform pg_temp.put_on_plan(v_org, v_plan);

    perform pg_temp.expect(
      format('9.0%s %s allows the FIRST establishment', v_n, v_plan),
      pg_temp.sqlstate_of(format(
        'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Salon Site %s'', ''UTC'', true)',
        v_org, v_n)) = 'ALLOWED');

    perform pg_temp.expect(
      format('9.1%s %s REFUSES a second operating salon', v_n, v_plan),
      pg_temp.sqlstate_of(format(
        'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Second Salon %s'', ''UTC'', true)',
        v_org, v_n)) = 'P0001',
      'a second establishment requires the Multi-salons family — never another EUR 29/49/79 under the same plan');
  end loop;

  -- MULTI-SALON CAPS.
  update public.locations set is_active = false where organization_id = v_org;

  perform pg_temp.put_on_plan(v_org, 'multi_growth');
  perform pg_temp.expect(
    '9.20 multi_growth allows 2 establishments',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) select %L, ''Growth '' || n, ''UTC'', true from generate_series(1,2) n',
      v_org)) = 'ALLOWED');
  perform pg_temp.expect(
    '9.21 multi_growth REFUSES a 3rd establishment',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Growth 3'', ''UTC'', true)',
      v_org)) = 'P0001');
  perform pg_temp.expect(
    '9.22 the multi_growth price did not change with the establishment count',
    (select price_minor from public.commercial_plans where plan_key = 'multi_growth') = 9900);

  perform pg_temp.put_on_plan(v_org, 'multi_pro');
  perform pg_temp.expect(
    '9.23 multi_pro allows up to 5 establishments',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) select %L, ''Pro '' || n, ''UTC'', true from generate_series(3,5) n',
      v_org)) = 'ALLOWED');
  perform pg_temp.expect(
    '9.24 multi_pro REFUSES a 6th establishment',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Pro 6'', ''UTC'', true)',
      v_org)) = 'P0001');
  perform pg_temp.expect(
    '9.25 the multi_pro price did not change with the establishment count',
    (select price_minor from public.commercial_plans where plan_key = 'multi_pro') = 14900);

  perform pg_temp.put_on_plan(v_org, 'multi_scale');
  perform pg_temp.expect(
    '9.26 multi_scale allows up to 10 establishments',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) select %L, ''Scale '' || n, ''UTC'', true from generate_series(6,10) n',
      v_org)) = 'ALLOWED');
  perform pg_temp.expect(
    '9.27 multi_scale REFUSES an 11th establishment',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Scale 11'', ''UTC'', true)',
      v_org)) = 'P0001');
  perform pg_temp.expect(
    '9.28 the multi_scale price did not change with the establishment count',
    (select price_minor from public.commercial_plans where plan_key = 'multi_scale') = 24900);

  perform pg_temp.expect(
    '9.29 exactly 10 establishments are active at the cap',
    private.org_active_establishments(v_org) = 10,
    format('found %s', private.org_active_establishments(v_org)));

  -- An INACTIVE establishment consumes no capacity, which is what makes coming
  -- back into compliance non-destructive.
  update public.locations set is_active = false
  where id = (select id from public.locations where organization_id = v_org and is_active limit 1);

  perform pg_temp.expect(
    '9.30 deactivating an establishment frees capacity WITHOUT deleting it',
    private.org_active_establishments(v_org) = 9
    and (select count(*) from public.locations where organization_id = v_org) >= 10);

  perform pg_temp.expect(
    '9.31 an INACTIVE establishment may be created beyond the cap — it operates nothing',
    pg_temp.sqlstate_of(format(
      'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Dormant'', ''UTC'', false)',
      v_org)) = 'ALLOWED');

  -- Back to the cap, then prove reactivation past it is refused.
  update public.locations set is_active = true
  where id = (select id from public.locations
              where organization_id = v_org and not is_active order by name limit 1);

  perform pg_temp.expect(
    '9.32 reactivating past the cap is REFUSED — deactivate/downgrade/reactivate is not a bypass',
    private.org_active_establishments(v_org) = 10
    and pg_temp.sqlstate_of(format(
      'update public.locations set is_active = true where id = (select id from public.locations where organization_id = %L and not is_active limit 1)',
      v_org)) = 'P0001');
exception when others then
  perform pg_temp.record('9.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 9b. THE CAPS FIRE FOR A REAL AUTHENTICATED CALLER
--
-- Everything above runs as postgres, which proves the caps are not RLS policies
-- but does NOT prove they still work through the door a browser actually uses.
-- That matters because 20260826110700 revokes EXECUTE on the trigger functions
-- from anon and authenticated: Postgres checks EXECUTE when a trigger is
-- CREATED and not when it fires, so the revoke is safe — but "is safe" is a
-- claim about Postgres internals, and a claim like that should be tested rather
-- than believed.
--
-- The distinction these assertions turn on: SQLSTATE 42501 would mean the
-- caller was stopped by a PRIVILEGE and the trigger never ran; P0001 means the
-- capacity trigger ran and said no. Only the second is the behaviour R2
-- promises.
-- ============================================================================

do $$
declare
  v_org uuid;
  v_owner uuid;
  v_sp uuid;
begin
  v_org := (select id from v where k = 'org_other');
  v_owner := (select id from v where k = 'outsider');
  perform pg_temp.put_on_plan(v_org, 'salon_pro');

  perform pg_temp.expect(
    '9.40 an authenticated owner CAN create their first establishment',
    pg_temp.sqlstate_as(v_owner, format(
      'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Real First'', ''UTC'', true)',
      v_org)) = 'ALLOWED');

  perform pg_temp.expect(
    '9.41 an authenticated owner is refused a SECOND establishment by the TRIGGER (P0001, not 42501)',
    pg_temp.sqlstate_as(v_owner, format(
      'insert into public.locations (organization_id, name, timezone, is_active) values (%L, ''Real Second'', ''UTC'', true)',
      v_org)) = 'P0001',
    '42501 here would mean the revoked EXECUTE had disabled the trigger instead of the cap refusing the row');

  -- The same, through the roster door.
  perform pg_temp.put_on_plan(v_org, 'solo');

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_active, is_public)
  select v_org, null,
         (select id from public.locations where organization_id = v_org and is_active limit 1),
         'Real Pro One', true, true
  returning id into v_sp;

  perform pg_temp.expect(
    '9.42 an authenticated owner CAN roster their first professional on solo',
    pg_temp.sqlstate_as(v_owner, format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp)) = 'ALLOWED');

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_active, is_public)
  select v_org, null,
         (select id from public.locations where organization_id = v_org and is_active limit 1),
         'Real Pro Two', true, true
  returning id into v_sp;

  perform pg_temp.expect(
    '9.43 an authenticated owner is refused a SECOND professional on solo by the TRIGGER (P0001)',
    pg_temp.sqlstate_as(v_owner, format(
      'insert into public.barbers (organization_id, staff_profile_id, is_bookable) values (%L, %L, true)',
      v_org, v_sp)) = 'P0001');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('9.40 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 10. TEAM IS INCLUDED — HEADCOUNT IS NOT A BILLING MULTIPLIER
-- ============================================================================

do $$
declare
  v_org uuid;
  v_loc uuid;
  v_sp uuid;
  v_price_before integer;
  v_n integer;
begin
  v_org := (select id from v where k = 'org_salon');
  perform pg_temp.put_on_plan(v_org, 'salon_essential');

  insert into public.locations (id, organization_id, name, timezone, is_active)
  values ('dddddddd-0000-4000-8000-000000000040', v_org, 'Team Salon', 'UTC', true)
  returning id into v_loc;

  v_price_before := (select price_minor from public.commercial_plans where plan_key = 'salon_essential');

  for v_n in 1..10 loop
    insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_active, is_public)
    values (v_org, null, v_loc, 'Team Barber ' || v_n, true, true)
    returning id into v_sp;

    insert into public.barbers (organization_id, staff_profile_id, is_bookable)
    values (v_org, v_sp, true);
  end loop;

  perform pg_temp.expect(
    '10.01 ten professionals can be rostered on salon_essential',
    private.org_active_professionals(v_org) >= 10,
    format('%s active professionals', private.org_active_professionals(v_org)));

  perform pg_temp.expect(
    '10.02 salon_essential still costs EUR 29 with ten barbers',
    (select price_minor from public.commercial_plans where plan_key = 'salon_essential') = v_price_before
    and v_price_before = 2900,
    'staff count is not a billing multiplier — there is no per-seat amount to multiply');

  perform pg_temp.expect(
    '10.03 the commercial state row has exactly the twelve intended columns and no headcount',
    (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'organization_commercial_state'
       and column_name not in ('organization_id','plan_key','status','entitlement_source',
                               'assigned_at','assigned_by','assignment_note',
                               'provider','provider_customer_ref','provider_subscription_ref',
                               'created_at','updated_at')) = 0,
    'the full column list, pinned — a new column here is how a billing input gets introduced');

  perform pg_temp.expect(
    '10.04 salon_pro remains EUR 49 and salon_business EUR 79 regardless of team size',
    (select price_minor from public.commercial_plans where plan_key = 'salon_pro') = 4900
    and (select price_minor from public.commercial_plans where plan_key = 'salon_business') = 7900);
exception when others then
  perform pg_temp.record('10.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 11. DOWNGRADES FAIL SAFELY AND DESTROY NOTHING
-- ============================================================================

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_locs_before bigint;
  v_active_before integer;
  v_pros_before bigint;
  v_appts_before bigint;
  v_customers_before bigint;
  v_passports_before bigint;
  v_follows_before bigint;
  v_rels_before bigint;
begin
  v_org := (select id from v where k = 'org_multi');
  v_admin := (select id from v where k = 'admin');

  -- Section 9 left this organization at the multi_scale cap with some dormant
  -- rows alongside. It is deliberately NOT reactivated here: blanket-enabling
  -- every location would exceed the cap and trip the very trigger this section
  -- is not testing.
  perform pg_temp.put_on_plan(v_org, 'multi_scale');

  v_locs_before      := (select count(*) from public.locations where organization_id = v_org);
  v_active_before    := private.org_active_establishments(v_org);
  v_pros_before      := (select count(*) from public.professionals);
  v_appts_before     := (select count(*) from public.appointments);
  v_customers_before := (select count(*) from public.customers);
  v_passports_before := (select count(*) from public.customer_passports);
  v_follows_before   := (select count(*) from public.professional_follows);
  v_rels_before      := (select count(*) from public.customer_professional_relationships);

  perform pg_temp.record('11.00 fixture state before downgrade attempts', 'INFO',
    format('%s active establishments of %s total', v_active_before, v_locs_before));

  perform pg_temp.expect(
    '11.01 multi_scale with >5 establishments cannot downgrade to multi_pro',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''multi_pro'')', v_org)) = 'P0001');

  perform pg_temp.expect(
    '11.02 multi_scale with >2 establishments cannot downgrade to multi_growth',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''multi_growth'')', v_org)) = 'P0001');

  perform pg_temp.expect(
    '11.03 a multi-establishment group cannot downgrade to a single-salon plan',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''salon_pro'')', v_org)) = 'P0001');

  perform pg_temp.expect(
    '11.04 it cannot downgrade to solo either',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''solo'')', v_org)) = 'P0001');

  perform pg_temp.expect(
    '11.05 the plan is UNCHANGED after every refused downgrade',
    (select plan_key from public.organization_commercial_state where organization_id = v_org) = 'multi_scale');

  -- The point: a refusal is not a partial application.
  perform pg_temp.expect(
    '11.06 NO establishment was removed or deactivated to make a downgrade fit',
    (select count(*) from public.locations where organization_id = v_org) = v_locs_before
    and private.org_active_establishments(v_org) = v_active_before);

  perform pg_temp.expect(
    '11.07 no professional identity was destroyed',
    (select count(*) from public.professionals) = v_pros_before);

  perform pg_temp.expect(
    '11.08 no appointment, customer, Passport, follow or relationship was destroyed',
    (select count(*) from public.appointments) = v_appts_before
    and (select count(*) from public.customers) = v_customers_before
    and (select count(*) from public.customer_passports) = v_passports_before
    and (select count(*) from public.professional_follows) = v_follows_before
    and (select count(*) from public.customer_professional_relationships) = v_rels_before);

  perform pg_temp.expect(
    '11.09 a multi-professional salon cannot downgrade to solo',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''solo'')', (select id from v where k = 'org_salon'))) = 'P0001');

  -- The non-destructive route DOWN works: deactivate first, then downgrade.
  update public.locations set is_active = false
  where organization_id = v_org
    and id in (
      select id from public.locations
      where organization_id = v_org and is_active
      order by name
      offset 2
    );

  perform pg_temp.expect(
    '11.10 after deactivating down to 2, the downgrade to multi_growth SUCCEEDS',
    private.org_active_establishments(v_org) = 2
    and pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''multi_growth'')', v_org)) = 'ALLOWED',
    'the organization decides what it no longer operates; FadeUp never decides that for them');

  perform pg_temp.expect(
    '11.11 the deactivated establishments still EXIST after the downgrade',
    (select count(*) from public.locations where organization_id = v_org) = v_locs_before,
    'access became restricted; nothing was destroyed');

  -- CANCELLING is always possible, however large the organization. Moving back
  -- UP to multi_scale first is an upgrade, so it is never blocked.
  perform pg_temp.put_on_plan(v_org, 'multi_scale');

  perform pg_temp.expect(
    '11.12 a large organization can ALWAYS be cancelled — cancellation is not a downgrade',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''multi_scale'', ''canceled'')', v_org)) = 'ALLOWED');

  perform pg_temp.expect(
    '11.13 cancelling destroyed no establishment',
    (select count(*) from public.locations where organization_id = v_org) = v_locs_before);

  perform pg_temp.expect(
    '11.14 an already-over-capacity organization can still be moved UPWARD',
    pg_temp.sqlstate_as(v_admin, format(
      'select public.assign_commercial_plan(%L, ''multi_scale'', ''active'')', v_org)) = 'ALLOWED',
    'a rule that froze an over-capacity organization would punish the wrong party');
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.record('11.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 12. RLS, PRIVILEGES, SECURITY DEFINER, INDEXES, FOREIGN KEYS, TRIGGERS
-- ============================================================================

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('commercial_plans','commercial_capabilities','plan_capabilities',
                        'organization_commercial_state','commercial_plan_changes')
  loop
    perform pg_temp.expect(
      format('12.01 %s has RLS enabled AND forced', r.relname),
      r.relrowsecurity and r.relforcerowsecurity);
  end loop;

  select coalesce(string_agg(format('%s/%s/%s', table_name, grantee, privilege_type), ', '), '')
    into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('commercial_plans','commercial_capabilities','plan_capabilities',
                       'organization_commercial_state','commercial_plan_changes')
    and grantee in ('anon','PUBLIC','prospect_worker');

  perform pg_temp.expect(
    '12.02 anon, PUBLIC and prospect_worker hold NOTHING on any commercial table',
    v_bad = '', coalesce(nullif(v_bad, ''), 'none'));

  select coalesce(string_agg(format('%s/%s', table_name, privilege_type), ', '), '')
    into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('commercial_plans','commercial_capabilities','plan_capabilities',
                       'organization_commercial_state','commercial_plan_changes')
    and grantee = 'authenticated' and privilege_type <> 'SELECT';

  perform pg_temp.expect(
    '12.03 authenticated holds SELECT and nothing else',
    v_bad = '', coalesce(nullif(v_bad, ''), 'SELECT only'));

  select coalesce(string_agg(format('%s/%s/%s', tablename, policyname, cmd), ', '), '')
    into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('commercial_plans','commercial_capabilities','plan_capabilities',
                      'organization_commercial_state','commercial_plan_changes')
    and cmd <> 'SELECT';

  perform pg_temp.expect(
    '12.04 there is NO write policy of any kind on any commercial table',
    v_bad = '', coalesce(nullif(v_bad, ''), 'none'));

  perform pg_temp.expect(
    '12.05 the database still has ZERO anon RLS policies',
    (select count(*) from pg_policies where schemaname = 'public' and 'anon' = any(roles)) = 0,
    'unchanged since the schema shipped; R1B asserted it and R2 adds none');

  perform pg_temp.expect(
    '12.06 prospect_worker cannot execute any R2 function',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private')
        and p.proname in ('assign_commercial_plan','get_organization_entitlements',
                          'my_organization_has_capability','org_has_capability',
                          'effective_plan_key','assert_professional_capacity')
        and has_function_privilege('prospect_worker', p.oid, 'execute')
    ),
    'R1A least privilege: the worker parses third-party scraped content and has no business knowing what any tenant pays');
exception when others then
  perform pg_temp.record('12.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare
  r record;
  v_names text[] := array[
    'ensure_organization_commercial_state','handle_new_organization_commercial_state',
    'reject_commercial_history_mutation','effective_plan_key','org_has_capability',
    'assert_org_capability','org_active_establishments','org_active_professionals',
    'get_organization_entitlements','my_organization_has_capability',
    'enforce_establishment_capacity','assert_professional_capacity','enforce_barber_capacity',
    'enforce_staff_reactivation_capacity','enforce_commercial_state_integrity',
    'assign_commercial_plan'];
begin
  perform pg_temp.expect(
    '12.10 all 16 R2 functions exist',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and p.proname = any(v_names)) = 16,
    format('found %s', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname in ('public','private') and p.proname = any(v_names))));

  for r in
    select p.proname, n.nspname,
           exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                   where c like 'search_path=%') as pinned
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.proname = any(v_names)
  loop
    perform pg_temp.expect(
      format('12.11 %s.%s pins search_path', r.nspname, r.proname),
      r.pinned,
      'an unqualified name resolves through the CALLER search_path, definer or not — that is the escalation primitive');
  end loop;

  perform pg_temp.expect(
    '12.12 anon can execute NO R2 function',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private') and p.proname = any(v_names)
        and has_function_privilege('anon', p.oid, 'execute')
    ));

  perform pg_temp.expect(
    '12.13 authenticated can execute the two public RPCs and NO private helper',
    has_function_privilege('authenticated', 'public.get_organization_entitlements(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.my_organization_has_capability(uuid, text)', 'execute')
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = any(v_names)
        and has_function_privilege('authenticated', p.oid, 'execute')
    ),
    'a directly callable private.org_has_capability would answer questions about any organization in the database');

  perform pg_temp.expect(
    '12.14 no R2 RPC accepts a caller-identity argument',
    (select count(*) from information_schema.parameters
     where specific_schema in ('public','private')
       and (specific_name like 'get_organization_entitlements%'
            or specific_name like 'my_organization_has_capability%'
            or specific_name like 'assign_commercial_plan%')
       and parameter_name in ('p_user_id','p_actor','p_caller','p_role')) = 0);
exception when others then
  perform pg_temp.record('12.10 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('commercial_plans_family_tier_idx'),
      ('plan_capabilities_capability_idx'),
      ('organization_commercial_state_plan_key_idx'),
      ('organization_commercial_state_status_idx'),
      ('commercial_plan_changes_organization_idx')
    ) as i(name)
  loop
    perform pg_temp.expect(
      format('12.20 index %s exists', r.name),
      exists (select 1 from pg_indexes where schemaname = 'public' and indexname = r.name));
  end loop;

  for r in
    select * from (values
      ('organization_commercial_state_organization_id_fkey', 'c', 'commercial state is meaningless without its organization'),
      ('organization_commercial_state_plan_key_fkey',        'r', 'a plan an organization is on cannot be deleted out from under it'),
      ('organization_commercial_state_assigned_by_fkey',     'n', 'erasing a staff account must not dead-end on a foreign key'),
      ('plan_capabilities_plan_key_fkey',                    'r', 'removing a plan that still packages capabilities must be explicit'),
      ('plan_capabilities_capability_key_fkey',              'r', 'removing a capability must not silently shrink four plans'),
      ('commercial_plan_changes_organization_id_fkey',       'c', 'history follows its organization'),
      ('commercial_plan_changes_new_plan_key_fkey',          'r', 'history must keep naming a real plan'),
      ('commercial_plan_changes_changed_by_fkey',            'n', 'the actor may be erased; the record stays')
    ) as f(conname, expected, why)
  loop
    perform pg_temp.expect(
      format('12.21 FK %s is ON DELETE %s', r.conname,
             case r.expected when 'c' then 'CASCADE' when 'r' then 'RESTRICT' else 'SET NULL' end),
      (select confdeltype = r.expected from pg_constraint where conname = r.conname),
      r.why);
  end loop;

  for r in
    select * from (values
      ('locations_enforce_establishment_capacity',     'public.locations'),
      ('barbers_enforce_professional_capacity',        'public.barbers'),
      ('staff_profiles_enforce_professional_capacity', 'public.staff_profiles'),
      ('organization_commercial_state_integrity',      'public.organization_commercial_state'),
      ('organizations_ensure_commercial_state',        'public.organizations'),
      ('commercial_plan_changes_append_only',          'public.commercial_plan_changes')
    ) as t(name, tbl)
  loop
    perform pg_temp.expect(
      format('12.22 trigger %s is attached to %s', r.name, r.tbl),
      exists (select 1 from pg_trigger where tgname = r.name
                and tgrelid = r.tbl::regclass and not tgisinternal));
  end loop;

  -- R1B's identity trigger must still be there: R2 adds a cap in FRONT of
  -- identity minting, and must never have replaced it.
  perform pg_temp.expect(
    '12.23 R1B''s barbers_assign_professional trigger is intact',
    exists (select 1 from pg_trigger where tgname = 'barbers_assign_professional'
              and tgrelid = 'public.barbers'::regclass and not tgisinternal));
exception when others then
  perform pg_temp.record('12.20 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 13. THE LOCKING MECHANISM IS PRESENT
--
-- One session cannot prove a race. What it CAN prove is that the code takes the
-- lock at all — if FOR UPDATE were removed, every cap above would still pass
-- while becoming racy in production. The real two-connection races are in
-- scripts/r2-concurrency-test.sh.
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select * from (values
      ('public',  'enforce_establishment_capacity'),
      ('private', 'assert_professional_capacity'),
      ('public',  'assign_commercial_plan')
    ) as f(nsp, name)
  loop
    perform pg_temp.expect(
      format('13.01 %s.%s takes FOR UPDATE on the commercial-state row before counting',
             r.nsp, r.name),
      (select p.prosrc ~* 'organization_commercial_state[\s\S]{0,255}for update'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = r.nsp and p.proname = r.name),
      'the exactly-one-row-per-organization primary key is what makes this a usable mutex');
  end loop;

  perform pg_temp.expect(
    '13.02 the capacity triggers have NO session-GUC override',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private')
        and p.proname in ('enforce_establishment_capacity','enforce_barber_capacity',
                          'assert_professional_capacity','enforce_staff_reactivation_capacity',
                          'enforce_commercial_state_integrity')
        and p.prosrc ~* 'current_setting'
    ),
    'a magic setting is a bypass a future RPC could learn to set; a restore uses pg_restore --disable-triggers, which is explicit and loud');
exception when others then
  perform pg_temp.record('13.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 14. THE BACKFILL, AND WHAT R2 DID NOT DESTROY
--
-- Only meaningful on the UPGRADE run, where SEED_R2_PRE_UPGRADE created
-- organizations of every shape before MASTER was applied. Guarded, so the
-- fresh-database run records INFO rather than a spurious FAIL.
-- ============================================================================

do $$
declare v_seeded boolean;
begin
  select exists (select 1 from public.organizations where id = 'cccccccc-0000-4000-8000-000000000003')
    into v_seeded;

  if not v_seeded then
    perform pg_temp.record('14.00 pre-R2 fixtures', 'INFO',
      'absent — this is the FRESH-database run; section 14 applies to the upgrade run only');
    return;
  end if;

  perform pg_temp.record('14.00 pre-R2 fixtures', 'INFO', 'present — verifying the upgrade');

  -- THE BACKFILL DERIVATION, branch by branch.
  perform pg_temp.expect(
    '14.01 an EMPTY organization backfills to free',
    (select plan_key from public.organization_commercial_state
     where organization_id = 'cccccccc-0000-4000-8000-000000000001') = 'free',
    '0 locations, 0 professionals — it starts where a new organization starts');

  perform pg_temp.expect(
    '14.02 a ONE-location ONE-professional organization backfills to solo',
    (select plan_key from public.organization_commercial_state
     where organization_id = 'cccccccc-0000-4000-8000-000000000002') = 'solo');

  perform pg_temp.expect(
    '14.03 a ONE-location THREE-professional salon backfills to salon_essential',
    (select plan_key from public.organization_commercial_state
     where organization_id = 'cccccccc-0000-4000-8000-000000000003') = 'salon_essential',
    'the CHEAPEST covering single-salon plan — not salon_pro, however much of the product it uses. Usage does not infer a tier.');

  perform pg_temp.expect(
    '14.04 a FOUR-location group backfills to multi_pro',
    (select plan_key from public.organization_commercial_state
     where organization_id = 'cccccccc-0000-4000-8000-000000000004') = 'multi_pro',
    'multi_growth covers 2 and would not fit; multi_pro is the cheapest that does');

  perform pg_temp.expect(
    '14.05 an ELEVEN-location group backfills to multi_scale with the overage recorded',
    (select plan_key from public.organization_commercial_state
     where organization_id = 'cccccccc-0000-4000-8000-000000000005') = 'multi_scale'
    and (select assignment_note like '%OVER CAPACITY%' from public.organization_commercial_state
         where organization_id = 'cccccccc-0000-4000-8000-000000000005'));

  perform pg_temp.expect(
    '14.06 the over-capacity group kept ALL ELEVEN establishments',
    (select count(*) from public.locations
     where organization_id = 'cccccccc-0000-4000-8000-000000000005' and is_active) = 11,
    'the backfill records the discrepancy; it never resolves it by removing an establishment');

  perform pg_temp.expect(
    '14.07 EVERY backfilled row is early_access with no provider and no payment claimed',
    not exists (
      select 1 from public.organization_commercial_state
      where organization_id::text like 'cccccccc-%'
        and (entitlement_source <> 'early_access' or provider is not null)
    ));

  perform pg_temp.expect(
    '14.08 the salon''s INACTIVE annex did not count towards capacity',
    (select count(*) from public.locations
     where organization_id = 'cccccccc-0000-4000-8000-000000000003') = 2
    and private.org_active_establishments('cccccccc-0000-4000-8000-000000000003') = 1);

  perform pg_temp.expect(
    '14.09 the salon''s OFFBOARDED barber did not count towards the professional cap',
    (select count(*) from public.barbers
     where organization_id = 'cccccccc-0000-4000-8000-000000000003') = 4
    and private.org_active_professionals('cccccccc-0000-4000-8000-000000000003') = 3,
    'four roster rows, three active — offboarding deactivates and never deletes');

  -- NON-DESTRUCTION of R1A/R1B data.
  perform pg_temp.expect(
    '14.10 both seeded appointments survive with their trustworthy completion',
    (select count(*) from public.appointments
     where id in ('cccccccc-0000-4000-8000-000000000060','cccccccc-0000-4000-8000-000000000061')
       and status = 'completed' and completed_at is not null) = 2);

  perform pg_temp.expect(
    '14.11 the Passport survives with its content and its number intact',
    (select usual_haircut = 'Low fade, textured top'
            and preferences_notes = 'Leave the beard line square'
            and passport_number is not null
     from public.customer_passports
     where user_id = 'cccccccc-0000-4000-8000-000000000018'));

  perform pg_temp.expect(
    '14.12 the follow edge R1B created survives',
    exists (select 1 from public.professional_follows
            where follower_user_id = 'cccccccc-0000-4000-8000-000000000018'));

  perform pg_temp.expect(
    '14.13 the relationship aggregate R1B created survives',
    exists (select 1 from public.customer_professional_relationships
            where customer_user_id = 'cccccccc-0000-4000-8000-000000000018'));

  perform pg_temp.expect(
    '14.14 the CLAIMED professional identity is untouched — claim state is not subscription state',
    (select claim_state = 'claimed'
            and user_id = 'cccccccc-0000-4000-8000-000000000019'
            and source = 'acquisition'
     from public.professionals where id = 'cccccccc-0000-4000-8000-000000000090'));

  perform pg_temp.expect(
    '14.15 acquisition provenance survives',
    exists (select 1 from public.prospect_professionals
            where professional_id = 'cccccccc-0000-4000-8000-000000000090'
              and prospect_id = 'cccccccc-0000-4000-8000-000000000080'));

  -- Every roster row backed by a real ACCOUNT keeps its durable identity. The
  -- one exception is R1B's own, and it is a deliberate refusal rather than a
  -- gap: assign_barber_professional() leaves professional_id NULL when the
  -- staff profile is an account-erasure tombstone (user_id IS NULL), because
  -- inventing a claimed identity for a deleted account would be fabrication.
  -- R2 must neither fabricate one nor destroy the ones that exist.
  perform pg_temp.expect(
    '14.16 every roster row backed by an ACCOUNT still points at a durable identity',
    not exists (
      select 1 from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      where b.organization_id::text like 'cccccccc-%'
        and sp.user_id is not null
        and b.professional_id is null
    ));

  perform pg_temp.expect(
    '14.17 the account-erasure tombstone roster row is left honestly UNLINKED',
    (select b.professional_id is null
     from public.barbers b
     where b.id = 'cccccccc-0000-4000-8000-000000000048'),
    'R1B refuses to invent an identity for a deleted account, and R2 does not invent one either');

  perform pg_temp.expect(
    '14.18 the seeded customer record survives',
    exists (select 1 from public.customers where id = 'cccccccc-0000-4000-8000-000000000050'));

  perform pg_temp.expect(
    '14.19 the served walk-in survives',
    (select status = 'completed' from public.queue_entries
     where id = 'cccccccc-0000-4000-8000-000000000070'));
exception when others then
  perform pg_temp.record('14.0 (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 15. THE SUITE ITSELF RAN
--
-- Guards the failure mode the brief names explicitly: an early SQL error aborts
-- the transaction, every later insert fails, and the summary prints
-- PASS=0 FAIL=0 while looking like success. If the count is implausibly low,
-- that is itself a FAIL.
-- ============================================================================

do $$
declare v_total integer;
begin
  select count(*) into v_total from verify_results;
  perform pg_temp.expect(
    '15.01 the suite executed a plausible number of checks',
    v_total >= 120,
    format('%s checks recorded; fewer than 120 means execution stopped early', v_total));
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
