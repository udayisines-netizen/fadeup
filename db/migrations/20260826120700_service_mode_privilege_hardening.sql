-- FadeUp — SERVICE MODE: privilege hardening
--
-- WHY A SEPARATE FILE THAT MOSTLY ASSERTS
--
-- Every preceding file in this lot revokes and grants as it goes. This one
-- exists because "we were careful in six files" is not a property anyone can
-- check, and because the two failure modes that matter most are both SILENT:
--
--   * PUBLIC holds EXECUTE on a new function by default. A trigger function is
--     an ordinary function that happens to be wired to a trigger, so
--     enforce_booking_service_mode is directly callable by anyone unless it is
--     revoked — and it is SECURITY DEFINER.
--   * A future migration that adds a column, or re-grants a table, can undo a
--     protection established here without anything failing.
--
-- So this file revokes what must be revoked, and then ASSERTS the whole
-- posture. An assertion that fails aborts the replay loudly, which is the only
-- way a privilege regression gets noticed before production. It is the same
-- shape as 20260826101000 (R1B) and 20260826110700 (R2).
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PUBLIC holds EXECUTE on every new function by default. Take it back.
--
-- The trigger functions matter most: they are SECURITY DEFINER, they are owned
-- by postgres, and a direct call with a hand-built record would run definer
-- code with attacker-chosen arguments. They are only ever meant to be reached
-- by the trigger machinery.
-- ---------------------------------------------------------------------------

revoke all on function public.enforce_booking_service_mode() from public, anon, authenticated;
revoke all on function public.enforce_queue_service_mode() from public, anon, authenticated;
revoke all on function public.handle_new_location_service_settings() from public, anon, authenticated;
revoke all on function public.check_location_service_settings_consistency() from public, anon, authenticated;
revoke all on function public.check_service_mode_override_consistency() from public, anon, authenticated;
revoke all on function public.reject_service_mode_history_mutation() from public, anon, authenticated;

-- The five control RPCs and the two read RPCs already revoked PUBLIC in their
-- own files and granted the roles they need. Re-stated here so that this file
-- is a complete statement of the lot's execute posture rather than half of one.
revoke execute on function public.set_location_service_mode(uuid, public.service_mode) from public;
revoke execute on function public.set_location_queue_open(uuid, boolean) from public;
revoke execute on function public.set_barber_service_mode_override(uuid, public.service_mode) from public;
revoke execute on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) from public;
revoke execute on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) from public;
revoke execute on function public.get_public_service_state(text, uuid, uuid) from public;
revoke execute on function public.get_service_mode_state(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. prospect_worker, explicitly
--
-- The acquisition worker discovers barbershops. It has no business deciding
-- whether one is taking walk-ins, and R1B/R2 both took the trouble to keep its
-- privileges from creeping. The role only exists in the live stack, so the
-- revoke is guarded — but the ASSERTION below runs either way, so a future
-- grant to it cannot slip through unnoticed in an environment where it does
-- exist.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    execute 'revoke all on public.location_service_settings from prospect_worker';
    execute 'revoke all on public.service_mode_overrides from prospect_worker';
    execute 'revoke all on public.service_mode_changes from prospect_worker';
    execute 'revoke all on function public.set_location_service_mode(uuid, public.service_mode) from prospect_worker';
    execute 'revoke all on function public.set_location_queue_open(uuid, boolean) from prospect_worker';
    execute 'revoke all on function public.set_barber_service_mode_override(uuid, public.service_mode) from prospect_worker';
    execute 'revoke all on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) from prospect_worker';
    execute 'revoke all on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) from prospect_worker';
    execute 'revoke all on function public.get_service_mode_state(uuid) from prospect_worker';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3a. Every new table has RLS enabled AND forced.
--
-- ENABLE alone is not enough: without FORCE, the table OWNER bypasses every
-- policy, and in this stack the owner is postgres — which is what a definer
-- function runs as.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'location_service_settings', 'service_mode_overrides', 'service_mode_changes'
      )
      and not (c.relrowsecurity and c.relforcerowsecurity)
  loop
    v_bad := v_bad || ' ' || r.relname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode RLS check failed — not enabled+forced on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3b. Every function this lot added pins search_path.
--
-- Deliberately NOT filtered to SECURITY DEFINER. An unqualified name resolves
-- through the CALLER's search_path either way, which is a privilege-escalation
-- primitive: a caller creates their own `service_mode_overrides` in a schema
-- they control and the resolver reads the mode from there instead. Being a
-- definer makes it worse, not different.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ensure_location_service_settings', 'handle_new_location_service_settings',
        'check_location_service_settings_consistency',
        'check_service_mode_override_consistency', 'reject_service_mode_history_mutation',
        'mode_allows_booking', 'mode_allows_queue', 'effective_service_mode',
        'booking_admission_allowed', 'queue_admission_allowed',
        'assert_service_mode_authority',
        'set_location_service_mode', 'set_location_queue_open',
        'set_barber_service_mode_override',
        'set_service_mode_temporary_override', 'clear_service_mode_temporary_override',
        'enforce_booking_service_mode', 'enforce_queue_service_mode',
        'get_public_service_state', 'get_service_mode_state'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode search_path check failed — not pinned on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3c. anon may execute exactly ONE thing this lot added.
--
-- get_public_service_state is the customer contract and is anon-callable by
-- design. Everything else — every control, the Pro read, every trigger
-- function, every private helper — must be unreachable without a session.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ensure_location_service_settings', 'handle_new_location_service_settings',
        'check_location_service_settings_consistency',
        'check_service_mode_override_consistency', 'reject_service_mode_history_mutation',
        'mode_allows_booking', 'mode_allows_queue', 'effective_service_mode',
        'booking_admission_allowed', 'queue_admission_allowed',
        'assert_service_mode_authority',
        'set_location_service_mode', 'set_location_queue_open',
        'set_barber_service_mode_override',
        'set_service_mode_temporary_override', 'clear_service_mode_temporary_override',
        'enforce_booking_service_mode', 'enforce_queue_service_mode',
        'get_service_mode_state'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode EXECUTE check failed — anon can execute:%', v_bad
      using errcode = 'P0001';
  end if;

  -- The converse, asserted too: the one anon-callable function must actually be
  -- callable, or the customer surface silently loses its CTA.
  if not has_function_privilege('anon', 'public.get_public_service_state(text, uuid, uuid)', 'execute') then
    raise exception 'service mode EXECUTE check failed — anon cannot call get_public_service_state'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3d. The `private` helpers are not an API.
--
-- authenticated must reach the service-mode model only through the public RPCs,
-- which check membership. A directly callable private.effective_service_mode
-- would answer "what mode is this location in?" for every location in the
-- database, and private.assert_service_mode_authority would be an oracle for
-- which locations a user can manage.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'ensure_location_service_settings', 'mode_allows_booking', 'mode_allows_queue',
        'effective_service_mode', 'booking_admission_allowed', 'queue_admission_allowed',
        'assert_service_mode_authority'
      )
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode EXECUTE check failed — a client role can call a private helper directly:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3e. No client role may WRITE any service-mode state directly.
--
-- This is the assertion that keeps the whole design honest. If any of these
-- became true, a manager could change a mode without an audit row, without the
-- mutex, and — for the barber override — without the rule that a barber owns
-- their own placement.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select t.tbl, g.grantee, p.priv
    from unnest(array[
      'public.location_service_settings',
      'public.service_mode_overrides',
      'public.service_mode_changes'
    ]) as t(tbl)
    cross join unnest(array['anon', 'authenticated']) as g(grantee)
    cross join unnest(array['insert', 'update', 'delete']) as p(priv)
    where has_table_privilege(g.grantee, t.tbl, p.priv)
  loop
    v_bad := v_bad || format(' %s:%s:%s', r.tbl, r.grantee, r.priv);
  end loop;

  -- The barber override column, checked the same way. barbers itself is
  -- legitimately writable — this is specifically about the one new column.
  if has_column_privilege('authenticated', 'public.barbers', 'service_mode_override', 'update')
     or has_column_privilege('authenticated', 'public.barbers', 'service_mode_override', 'insert')
     or has_column_privilege('anon', 'public.barbers', 'service_mode_override', 'update')
     or has_column_privilege('anon', 'public.barbers', 'service_mode_override', 'insert') then
    v_bad := v_bad || ' public.barbers.service_mode_override:client-writable';
  end if;

  if v_bad <> '' then
    raise exception 'service mode write check failed — a client role can write service-mode state directly:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3f. anon may not READ the internal tables either.
--
-- A customer learns the effective mode through get_public_service_state, which
-- curates the answer and returns nothing for an establishment they have no
-- business seeing. Raw rows carry actor ids, override history and — on
-- location_service_settings — an existence oracle for every location id.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select t.tbl
    from unnest(array[
      'public.location_service_settings',
      'public.service_mode_overrides',
      'public.service_mode_changes'
    ]) as t(tbl)
    where has_table_privilege('anon', t.tbl, 'select')
  loop
    v_bad := v_bad || ' ' || r.tbl;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode read check failed — anon can select:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3g. prospect_worker gained nothing.
--
-- Asserted separately from the revoke above. Worker V2 requires no
-- service-mode privilege to do its job, and R1B/R2 both took the trouble to
-- keep its privileges from creeping.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  if not exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    return;
  end if;

  for r in
    select t.tbl, p.priv
    from unnest(array[
      'public.location_service_settings',
      'public.service_mode_overrides',
      'public.service_mode_changes'
    ]) as t(tbl)
    cross join unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
    where has_table_privilege('prospect_worker', t.tbl, p.priv)
  loop
    v_bad := v_bad || format(' %s:%s', r.tbl, r.priv);
  end loop;

  for r in
    select p.proname as tbl, ''::text as priv
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'set_location_service_mode', 'set_location_queue_open',
        'set_barber_service_mode_override', 'set_service_mode_temporary_override',
        'clear_service_mode_temporary_override', 'get_service_mode_state',
        'effective_service_mode', 'assert_service_mode_authority'
      )
      and has_function_privilege('prospect_worker', p.oid, 'execute')
  loop
    v_bad := v_bad || ' fn:' || r.tbl;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode privilege check failed — prospect_worker holds:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3h. The enforcement triggers actually exist and are BEFORE INSERT.
--
-- The single most valuable assertion in this file. Every other check in this
-- lot is about someone reaching state they should not; this one is about the
-- guard silently not being there at all — which is what a `drop trigger` in a
-- future migration, or a table rebuild, would produce. A service mode nothing
-- enforces is a UI preference.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and t.tgname = 'appointments_enforce_service_mode'
      and not t.tgisinternal
      -- tgtype bit 1 (value 2) = BEFORE, bit 2 (value 4) = INSERT
      and (t.tgtype & 2) <> 0
      and (t.tgtype & 4) <> 0
  ) then
    v_bad := v_bad || ' appointments';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.queue_entries'::regclass
      and t.tgname = 'queue_entries_enforce_service_mode'
      and not t.tgisinternal
      and (t.tgtype & 2) <> 0
      and (t.tgtype & 4) <> 0
  ) then
    v_bad := v_bad || ' queue_entries';
  end if;

  if v_bad <> '' then
    raise exception 'service mode enforcement check failed — BEFORE INSERT guard missing on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3i. The R2 entitlement gate is genuinely wired into admission.
--
-- §16's whole point. R2 built org_has_capability and no admission path called
-- it; this lot's claim to have fixed that is checked here by reading the
-- function bodies, so that a future edit which quietly drops the capability
-- check fails the replay rather than reopening the bypass in silence.
-- ---------------------------------------------------------------------------

do $$
declare
  v_booking text;
  v_queue text;
begin
  select p.prosrc into v_booking
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_booking_service_mode';

  select p.prosrc into v_queue
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_queue_service_mode';

  if v_booking is null or v_booking not like '%org_capability%' then
    raise exception 'service mode entitlement check failed — booking admission does not consult the R2 capability helper'
      using errcode = 'P0001';
  end if;

  if v_queue is null or v_queue not like '%org_has_capability%' then
    raise exception 'service mode entitlement check failed — queue admission does not consult the R2 capability helper'
      using errcode = 'P0001';
  end if;
end $$;
