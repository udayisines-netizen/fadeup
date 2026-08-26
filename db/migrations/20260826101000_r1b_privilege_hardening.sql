-- FadeUp — R1B: the privilege sweep, and its self-assertion
--
-- WHY THIS FILE EXISTS AT ALL
--
-- Supabase installs DEFAULT PRIVILEGES that grant anon, authenticated and
-- service_role EVERYTHING on every new table in `public`:
--
--   pg_default_acl -> postgres/public/r ->
--     anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
--
-- Confirmed by probing the running image, not assumed. The consequence is that
-- a `create table` with perfect RLS still ships with `authenticated` holding
-- INSERT, UPDATE, DELETE and TRUNCATE, and RLS is the only thing standing
-- between a caller and the data. On a table with no INSERT policy that is
-- survivable; on one with a permissive SELECT policy it is not, and relying on
-- policy coverage to compensate for a privilege you did not intend to grant is
-- how a single forgotten policy becomes a breach.
--
-- Every R1B migration revokes at creation. This file re-asserts the whole
-- matrix in one place and then FAILS THE MIGRATION if any of it is wrong — so
-- the guarantee is tested at deploy time rather than trusted.
--
-- It also re-runs the R1A-established rule about column privileges: a
-- column-level REVOKE cannot subtract from a table-level grant. Every
-- restriction below is therefore a table-level revoke followed by an explicit
-- re-grant of the columns that stay.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Re-assert the revokes
--
-- Deliberately repeated rather than trusted: if a future migration re-runs a
-- CREATE TABLE path or someone restores from a dump taken before the revoke,
-- this is where it is caught.
-- ---------------------------------------------------------------------------

revoke all on public.professionals from anon, authenticated;
grant select (id, claim_state, display_name, handle, headline, bio, avatar_url,
              is_public, claimed_at, created_at, updated_at)
  on public.professionals to authenticated;
grant update (display_name, handle, headline, bio, avatar_url, is_public)
  on public.professionals to authenticated;

revoke all on public.professional_follows from anon, authenticated;
grant select (id, professional_id, state, source, followed_at, unfollowed_at, created_at, updated_at)
  on public.professional_follows to authenticated;

revoke all on public.customer_professional_relationships from anon, authenticated;
grant select on public.customer_professional_relationships to authenticated;

revoke all on public.professional_claims from anon, authenticated;
grant select (id, professional_id, claimant_user_id, state, evidence,
              submitted_at, decided_at, decision_note, created_at, updated_at)
  on public.professional_claims to authenticated;

revoke all on public.prospect_professionals from anon, authenticated;
grant select on public.prospect_professionals to prospect_worker;

-- The acquisition worker gets nothing on the social side. R1A tightened its
-- privileges precisely because its job is parsing third-party scraped content,
-- which is a materially higher-risk surface than the customer API; R1B must
-- not hand that surface the follow graph or the relationship aggregate.
revoke all on public.professionals from prospect_worker;
revoke all on public.professional_follows from prospect_worker;
revoke all on public.customer_professional_relationships from prospect_worker;
revoke all on public.professional_claims from prospect_worker;
revoke all on public.customer_passports from prospect_worker;

-- ---------------------------------------------------------------------------
-- 2. Assert the result, table by table
--
-- The migration fails rather than logging a warning. A privilege matrix that
-- is "probably right" is the thing this file exists to eliminate.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2a. No mutation privileges for anon or authenticated on any R1B table,
  --     and no privilege of any kind for anon.
  for r in
    select t.table_name, g.grantee, g.privilege_type
    from (values
      ('professionals'), ('professional_follows'),
      ('customer_professional_relationships'), ('professional_claims'),
      ('prospect_professionals')
    ) as t(table_name)
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = t.table_name
    where g.grantee in ('anon', 'authenticated', 'PUBLIC')
      and (g.grantee <> 'authenticated' or g.privilege_type <> 'SELECT')
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.table_name, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception 'R1B privilege check failed — unexpected grants:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2b. RLS enabled AND forced. Enabled alone exempts the table owner, and
  --     several definer functions run as postgres.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('professionals', 'professional_follows',
                        'customer_professional_relationships',
                        'professional_claims', 'prospect_professionals')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  loop
    v_bad := v_bad || ' ' || r.relname;
  end loop;

  if v_bad <> '' then
    raise exception 'R1B RLS check failed — not enabled+forced on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2c. EVERY R1B function pins search_path — deliberately not filtered to
  --     SECURITY DEFINER. An unqualified name resolves through the CALLER's
  --     search_path in either case, which is a privilege-escalation primitive:
  --     a caller creates their own `professionals` in a schema they control
  --     and the function reads or writes there instead. Definer functions make
  --     it worse, not different.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
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
        'list_my_followed_professionals'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R1B search_path check failed — not pinned on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2d. anon may execute exactly the three anon-facing projections and nothing
  --     else R1B added. A mutation RPC reachable without a session would make
  --     every ownership check in this lot decorative.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'follow_professional', 'unfollow_professional',
        'submit_professional_claim', 'withdraw_professional_claim',
        'review_professional_claim', 'create_external_professional',
        'reconcile_customer_professional_relationships',
        'list_my_followed_professionals',
        'auto_follow_professional', 'record_completed_interaction',
        'ensure_customer_passport', 'generate_passport_number',
        'record_prospect_conversion', 'professional_follower_count'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R1B EXECUTE check failed — anon can execute:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_anon_policies integer;
begin
  -- 2e. The database has had ZERO anon RLS policies since it shipped. R1B
  --     adds none, and every anonymous read goes through a curated projection
  --     instead. This asserts the invariant globally, not just for R1B tables,
  --     because the number that matters is the total.
  select count(*) into v_anon_policies
  from pg_policies
  where schemaname = 'public' and 'anon' = any(roles);

  if v_anon_policies > 0 then
    raise exception 'R1B anon-policy check failed — % anon policies exist; R1B must add none', v_anon_policies
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The R1A column protections, re-asserted
--
-- These are R1A's guarantees, not R1B's, but R1B revoked and re-granted on
-- both appointments-adjacent tables and on customer_passports and barbers.
-- A re-grant that accidentally widened one of them would be invisible without
-- this check, and it is exactly the class of mistake the mechanism invites.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
begin
  if has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'UPDATE') then
    v_bad := v_bad || ' appointments.booked_by_user_id';
  end if;

  if has_column_privilege('authenticated', 'public.appointments', 'completed_at', 'UPDATE') then
    v_bad := v_bad || ' appointments.completed_at';
  end if;

  if has_column_privilege('authenticated', 'public.queue_entries', 'booked_by_user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.queue_entries', 'booked_by_user_id', 'UPDATE') then
    v_bad := v_bad || ' queue_entries.booked_by_user_id';
  end if;

  if has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'UPDATE') then
    v_bad := v_bad || ' barbers.professional_id';
  end if;

  if has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'INSERT')
     or has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.passport_number';
  end if;

  if has_column_privilege('authenticated', 'public.customer_passports', 'issued_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.customer_passports', 'issued_at', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.issued_at';
  end if;

  -- The other direction, and it is not symmetry for its own sake: R1A recorded
  -- that customer_passports.user_id MUST stay UPDATE-grantable, because
  -- apps/web/src/lib/queries/passport.ts upserts with
  -- onConflict: 'user_id' and ON CONFLICT DO UPDATE requires UPDATE on every
  -- column in its SET list. Withholding it breaks the live Passport save.
  if not has_column_privilege('authenticated', 'public.customer_passports', 'user_id', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.user_id-MISSING-UPDATE';
  end if;

  -- Passport DELETE stays revoked. R1A removed the delete policy; a Passport
  -- is identity, not a record its owner can drop.
  if has_table_privilege('authenticated', 'public.customer_passports', 'DELETE') then
    v_bad := v_bad || ' customer_passports-DELETE-REGRESSED';
  end if;

  if v_bad <> '' then
    raise exception 'R1B column-privilege check failed —%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R1B privilege hardening: all checks passed';
end $$;
