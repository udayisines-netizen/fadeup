-- FadeUp — R2: the privilege sweep, and its self-assertion
--
-- WHY THIS FILE EXISTS AT ALL
--
-- Supabase installs DEFAULT PRIVILEGES that grant anon, authenticated and
-- service_role EVERYTHING on every new table in `public`:
--
--   pg_default_acl -> postgres/public/r -> anon=arwdDxtm, authenticated=arwdDxtm
--
-- So a `create table` with perfect RLS still ships with `authenticated` holding
-- INSERT, UPDATE, DELETE and TRUNCATE, and RLS is the only thing standing
-- between a caller and the data. On the commercial tables that is not a
-- survivable posture: an UPDATE privilege on organization_commercial_state,
-- combined with a single future permissive policy, is a self-service upgrade to
-- multi_scale.
--
-- Every R2 migration revokes at creation. This file re-asserts the entire
-- matrix in one place and FAILS THE MIGRATION if any of it is wrong, so the
-- guarantee is tested at deploy time rather than trusted. It is the direct
-- sibling of 20260826101000 (R1B) and deliberately not a modification of it:
-- R1B is already validated and its assertions must keep meaning what they meant.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Re-assert the revokes
-- ---------------------------------------------------------------------------

revoke all on public.commercial_plans from anon, authenticated;
revoke all on public.commercial_capabilities from anon, authenticated;
revoke all on public.plan_capabilities from anon, authenticated;
revoke all on public.organization_commercial_state from anon, authenticated;
revoke all on public.commercial_plan_changes from anon, authenticated;

grant select on public.commercial_plans to authenticated;
grant select on public.commercial_capabilities to authenticated;
grant select on public.plan_capabilities to authenticated;
grant select on public.organization_commercial_state to authenticated;
grant select on public.commercial_plan_changes to authenticated;

-- The acquisition worker gets NOTHING commercial. R1A tightened its privileges
-- precisely because its job is parsing third-party scraped content, which is a
-- materially higher-risk surface than the customer API. It discovers prospects;
-- it has no business knowing, still less writing, what any tenant pays. R1B
-- withheld the social graph from it for the same reason and R2 withholds the
-- commercial model.
revoke all on public.commercial_plans from prospect_worker;
revoke all on public.commercial_capabilities from prospect_worker;
revoke all on public.plan_capabilities from prospect_worker;
revoke all on public.organization_commercial_state from prospect_worker;
revoke all on public.commercial_plan_changes from prospect_worker;

revoke execute on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) from prospect_worker;
revoke execute on function public.get_organization_entitlements(uuid) from prospect_worker;
revoke execute on function public.my_organization_has_capability(uuid, text) from prospect_worker;

-- The TRIGGER functions. Postgres grants EXECUTE to PUBLIC by default on every
-- new function, and a trigger function that lands in `public` is no exception.
-- Firing a trigger does not re-check EXECUTE (the privilege is checked when the
-- trigger is CREATED), so revoking here costs nothing and closes a small but
-- real surface: enforce_commercial_state_integrity() and
-- handle_new_organization_commercial_state() are both callable by name today,
-- and a definer function reachable by anon is exactly the shape of mistake the
-- rest of this file exists to catch.
revoke execute on function public.handle_new_organization_commercial_state() from public, anon, authenticated;
revoke execute on function public.reject_commercial_history_mutation() from public, anon, authenticated;
revoke execute on function public.enforce_establishment_capacity() from public, anon, authenticated;
revoke execute on function public.enforce_barber_capacity() from public, anon, authenticated;
revoke execute on function public.enforce_staff_reactivation_capacity() from public, anon, authenticated;
revoke execute on function public.enforce_commercial_state_integrity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Assert the result, table by table
--
-- The migration fails rather than logging a warning. A privilege matrix that is
-- "probably right" is the thing this file exists to eliminate.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2a. authenticated may hold SELECT and nothing else. anon, PUBLIC and
  --     prospect_worker may hold nothing at all.
  for r in
    select t.table_name, g.grantee, g.privilege_type
    from (values
      ('commercial_plans'), ('commercial_capabilities'), ('plan_capabilities'),
      ('organization_commercial_state'), ('commercial_plan_changes')
    ) as t(table_name)
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = t.table_name
    where g.grantee in ('anon', 'authenticated', 'PUBLIC', 'prospect_worker')
      and (g.grantee <> 'authenticated' or g.privilege_type <> 'SELECT')
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.table_name, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception 'R2 privilege check failed — unexpected grants:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2b. RLS enabled AND forced. Enabled alone exempts the table owner, and
  --     several definer functions run as postgres — which holds BYPASSRLS in
  --     this stack, so the forcing is what makes the posture legible rather
  --     than accidental.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('commercial_plans', 'commercial_capabilities', 'plan_capabilities',
                        'organization_commercial_state', 'commercial_plan_changes')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  loop
    v_bad := v_bad || ' ' || r.relname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 RLS check failed — not enabled+forced on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2c. EVERY R2 function pins search_path — deliberately not filtered to
  --     SECURITY DEFINER. An unqualified name resolves through the CALLER's
  --     search_path in either case, which is a privilege-escalation primitive:
  --     a caller creates their own `commercial_plans` in a schema they control
  --     and the function reads capacity from there instead. Definer functions
  --     make it worse, not different.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ensure_organization_commercial_state', 'handle_new_organization_commercial_state',
        'reject_commercial_history_mutation',
        'effective_plan_key', 'org_has_capability', 'assert_org_capability',
        'org_active_establishments', 'org_active_professionals',
        'get_organization_entitlements', 'my_organization_has_capability',
        'enforce_establishment_capacity', 'assert_professional_capacity',
        'enforce_barber_capacity', 'enforce_staff_reactivation_capacity',
        'enforce_commercial_state_integrity', 'assign_commercial_plan'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 search_path check failed — not pinned on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2d. anon may execute NOTHING R2 added. R2 has no anonymous surface at all:
  --     the marketing pricing page renders the application's compiled
  --     catalogue, so there is no anonymous read to serve and certainly no
  --     anonymous mutation. An assignment RPC reachable without a session would
  --     make every check in 20260826110600 decorative.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'assign_commercial_plan', 'get_organization_entitlements',
        'my_organization_has_capability', 'ensure_organization_commercial_state',
        'effective_plan_key', 'org_has_capability', 'assert_org_capability',
        'org_active_establishments', 'org_active_professionals',
        'assert_professional_capacity',
        -- The trigger functions too. They are ordinary functions that happen to
        -- be wired to a trigger, and PUBLIC holds EXECUTE on them by default.
        'handle_new_organization_commercial_state', 'reject_commercial_history_mutation',
        'enforce_establishment_capacity', 'enforce_barber_capacity',
        'enforce_staff_reactivation_capacity', 'enforce_commercial_state_integrity'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 EXECUTE check failed — anon can execute:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2e. The `private` helpers are not an API. authenticated must reach the
  --     commercial model only through the two public RPCs, which check
  --     membership; a directly callable private.org_has_capability(uuid, text)
  --     would answer questions about any organization in the database.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'ensure_organization_commercial_state', 'effective_plan_key',
        'org_has_capability', 'assert_org_capability',
        'org_active_establishments', 'org_active_professionals',
        'assert_professional_capacity'
      )
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 EXECUTE check failed — authenticated can call a private commercial helper directly:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_anon_policies integer;
begin
  -- 2f. The database has had ZERO anon RLS policies since it shipped. R1B
  --     asserted it; R2 adds none either. Asserted globally rather than for R2
  --     tables, because the number that matters is the total.
  select count(*) into v_anon_policies
  from pg_policies
  where schemaname = 'public' and 'anon' = any(roles);

  if v_anon_policies > 0 then
    raise exception 'R2 anon-policy check failed — % anon policies exist; R2 must add none', v_anon_policies
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The pricing-model assertions
--
-- These are not privilege checks. They are the structural guarantees that make
-- "FadeUp does not charge per barber, per seat or per location" true by
-- construction rather than by policy — asserted here because this is the file
-- that runs last and fails loudest.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
  r record;
begin
  -- 3a. NO QUANTITY TO MULTIPLY BY. If a column named like a seat, a unit or a
  --     per-something count ever appears on a commercial table, "price x count"
  --     becomes one line of arithmetic away. The defence is that the number
  --     does not exist. max_* columns are CAPS and are named accordingly.
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('commercial_plans', 'organization_commercial_state', 'plan_capabilities')
      and (
        c.column_name like '%seat%'
        or c.column_name like '%quantity%'
        or c.column_name like 'per\_%'
        or c.column_name like '%\_per\_%'
        or c.column_name like '%unit_price%'
        or c.column_name like '%included\_%'
      )
  loop
    v_bad := v_bad || format(' %s.%s', r.table_name, r.column_name);
  end loop;

  if v_bad <> '' then
    raise exception
      'R2 pricing-model check failed — a per-unit/quantity column exists on a commercial table, which is how per-seat billing gets introduced:%',
      v_bad using errcode = 'P0001';
  end if;

  -- 3b. Exactly two price columns on commercial_plans: price_minor and
  --     price_currency. A third is the shape of "base + per unit".
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'commercial_plans'
      and column_name like '%price%'
  ) <> 2 then
    raise exception 'R2 pricing-model check failed — commercial_plans must have exactly price_minor and price_currency'
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_bad text := '';
begin
  -- 3c. Team size is not a billing input. The commercial state row must carry
  --     no count of members, barbers, staff or users — if it did, the number
  --     would eventually be multiplied by something.
  select coalesce(string_agg(' ' || column_name, ''), '')
    into v_bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'organization_commercial_state'
    and (column_name like '%count%' or column_name like '%barber%'
         or column_name like '%staff%' or column_name like '%member%');

  if v_bad <> '' then
    raise exception
      'R2 pricing-model check failed — organization_commercial_state carries a headcount column; team is included and must never be a billing input:%',
      v_bad using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. R1A and R1B guarantees, re-asserted
--
-- R2 touched none of these, which is exactly why they are worth checking: a lot
-- that believes it changed nothing is the one most likely to have. These are
-- the specific column protections R1A and R1B recorded as load-bearing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
begin
  if has_column_privilege('authenticated', 'public.appointments', 'completed_at', 'UPDATE') then
    v_bad := v_bad || ' appointments.completed_at';
  end if;

  if has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'UPDATE') then
    v_bad := v_bad || ' appointments.booked_by_user_id';
  end if;

  if has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'UPDATE') then
    v_bad := v_bad || ' barbers.professional_id';
  end if;

  if has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'INSERT')
     or has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.passport_number';
  end if;

  -- R1A recorded this one as load-bearing in the OTHER direction: the live
  -- Passport save is an upsert on user_id, and ON CONFLICT DO UPDATE needs
  -- UPDATE on every column in its SET list.
  if not has_column_privilege('authenticated', 'public.customer_passports', 'user_id', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.user_id-MISSING-UPDATE';
  end if;

  if v_bad <> '' then
    raise exception 'R2 regression check failed — an R1A/R1B column protection changed:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  -- The durable identity model must be intact. R2 enforces caps on ROSTER
  -- PLACEMENTS and must never have reached into identity to do it.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'professionals'
  ) then
    raise exception 'R2 regression check failed: public.professionals is gone' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'professional_follows'
  ) then
    raise exception 'R2 regression check failed: the follow graph is gone' using errcode = 'P0001';
  end if;

  -- No commercial column may appear on the identity table. Claim state is not
  -- subscription state (Constitution 5.6), and the moment a plan column lands
  -- on professionals the two axes are one field again.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professionals'
      and (column_name like '%plan%' or column_name like '%subscription%'
           or column_name like '%entitlement%' or column_name like '%price%'
           or column_name like '%paid%')
  ) then
    raise exception 'R2 regression check failed: a commercial column was added to public.professionals — claim state is not subscription state'
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 privilege hardening: all checks passed';
end $$;
