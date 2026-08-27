-- FadeUp — SERVICE MODE: the controls
--
-- THE ONLY WAY TO CHANGE A SERVICE MODE
--
-- location_service_settings, barbers.service_mode_override and
-- service_mode_overrides all have zero client write privilege. These five RPCs
-- are the entire mutation surface, and each of them does the same four things
-- in the same order, in one transaction:
--
--   1. derive the tenant from the OBJECT, never from an argument
--   2. authorize the actor from auth.uid()
--   3. take the mutex
--   4. write the change AND its history row together
--
-- CALLER-SUPPLIED IDS ARE ARGUMENTS, NOT CREDENTIALS
--
-- Every one of these functions takes a location_id or a barber_id. None of them
-- takes an organization_id, and that is deliberate rather than incidental: an
-- organization_id parameter is an invitation to authorize against the value the
-- caller sent instead of against the object they named. The tenant is looked up
-- FROM the location or the barber, and the actor's membership is then checked
-- against what was found. Passing someone else's location id gets a refusal,
-- never a foothold.
--
-- WHO MAY DO WHAT
--
--   establishment default        owner / manager
--   establishment queue_open     owner / manager / receptionist
--   barber persistent override   owner / manager, or that barber themselves
--   location temporary override  owner / manager
--   barber temporary override    owner / manager, or that barber themselves
--
-- queue_open is wider on purpose. "Stop taking walk-ins, we're at capacity" is
-- a front-of-house judgement made a dozen times a week by whoever is on the
-- desk; making it an owner-only act would mean it never gets used and the queue
-- fills with people who cannot be served. Changing the establishment's DEFAULT
-- MODE is a different kind of decision — it is how the shop presents itself —
-- and stays with owner/manager. private.can_manage_appointments is the existing
-- owner/manager/receptionist predicate and is reused rather than re-spelled.
--
-- A barber may manage THEIR OWN override and nobody else's. private.is_own_barber
-- (R1B) resolves that from auth.uid() through staff_profiles, so a barber cannot
-- reach a colleague by passing their id. A manager may manage any barber in
-- their own organization, and the history row records which of the two it was.
--
-- prospect_worker is granted nothing here and is asserted to hold nothing in
-- 20260826120700. The acquisition worker discovers shops; it has no business
-- deciding whether one is taking walk-ins.
--
-- THE MUTEX, AND WHY IT IS TAKEN BEFORE READING
--
-- Every function takes `SELECT ... FOR UPDATE` on the establishment's
-- location_service_settings row before it reads anything it will act on. That
-- single row serialises the whole feature for that establishment: two managers
-- racing a mode change, a manager racing a barber, two barbers racing their own
-- overrides, and — critically — a mode change racing an admission, because the
-- admission guard in 20260826120500 takes FOR SHARE on the same row.
--
-- Reading before locking would produce exactly the bug this design is for: two
-- transactions both read `hybrid`, both decide, and the loser's decision
-- overwrites the winner's with a value computed from state that no longer
-- exists.
--
-- No function here upgrades a share lock to an exclusive one, and every
-- function locks exactly one row, so there is no lock-ordering cycle and no
-- deadlock to reason about.
--
-- ABSOLUTE INSTANTS ONLY
--
-- set_service_mode_temporary_override takes p_expires_at as a timestamptz. It
-- never takes "today", "30 minutes" or "until closing". Those are UI
-- affordances, resolved against the ESTABLISHMENT'S timezone by the caller
-- before the request is made. A backend that accepted them would have to guess
-- whose midnight was meant, and would guess with the server's timezone.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The shared authority check
--
-- Written once so that five call sites cannot drift into five slightly
-- different ideas of who is allowed to do this. Returns the organization it
-- resolved, so the caller uses the tenant this function actually authorized
-- against rather than looking it up a second time and hoping it matches.
-- ---------------------------------------------------------------------------

create or replace function private.assert_service_mode_authority(
  p_location_id uuid,
  p_barber_id uuid default null,
  p_allow_receptionist boolean default false
)
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_barber_location uuid;
begin
  -- The tenant comes from the OBJECT. Nothing the caller sent is trusted to
  -- describe who owns what.
  select l.organization_id into v_organization_id
  from public.locations l
  where l.id = p_location_id;

  if not found then
    -- Same refusal as a permission failure, and deliberately so: a distinct
    -- "no such location" would let anyone probe which location ids exist across
    -- every tenant in the database.
    raise exception 'not authorized to manage service mode for this establishment'
      using errcode = '42501';
  end if;

  if p_barber_id is not null then
    -- The barber must belong to the same tenant AND be placed at this
    -- establishment. Checking the tenant alone would let a manager of a
    -- multi-salon organization aim an override at a barber in another salon,
    -- where the resolver would never apply it.
    select sp.location_id into v_barber_location
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id and b.organization_id = v_organization_id;

    if not found or v_barber_location is distinct from p_location_id then
      raise exception 'not authorized to manage service mode for this professional'
        using errcode = '42501';
    end if;
  end if;

  -- Manager path: owner/manager always; receptionist only where the operation
  -- is a front-of-house one (queue_open).
  if (select private.has_org_role(
        v_organization_id,
        array['owner', 'manager']::public.membership_role[])) then
    return v_organization_id;
  end if;

  if p_allow_receptionist
     and (select private.can_manage_appointments(v_organization_id)) then
    return v_organization_id;
  end if;

  -- Self path: a barber managing their own placement. Resolved from auth.uid()
  -- through staff_profiles by private.is_own_barber (R1B) — the caller's
  -- p_barber_id is the thing being checked, never the thing doing the checking.
  if p_barber_id is not null and (select private.is_own_barber(p_barber_id)) then
    return v_organization_id;
  end if;

  raise exception 'not authorized to manage service mode here'
    using errcode = '42501';
end;
$$;

comment on function private.assert_service_mode_authority(uuid, uuid, boolean) is
  'The single authority check behind every service-mode control. Derives the tenant FROM the location (never from a caller-supplied organization_id), verifies the barber is in that tenant and placed at that establishment, then admits owner/manager, optionally receptionist for front-of-house operations, or the barber themselves via private.is_own_barber. Returns the organization it authorized against so callers do not re-derive it. Raises 42501 for an unknown location rather than a distinct error, so it cannot be used to enumerate location ids across tenants.';

revoke all on function private.assert_service_mode_authority(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The establishment default
-- ---------------------------------------------------------------------------

create or replace function public.set_location_service_mode(
  p_location_id uuid,
  p_mode public.service_mode
)
returns public.location_service_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_previous public.service_mode;
  v_row public.location_service_settings;
begin
  if p_mode is null then
    raise exception 'a service mode is required' using errcode = '22023';
  end if;

  v_organization_id := private.assert_service_mode_authority(p_location_id, null, false);

  perform private.ensure_location_service_settings(p_location_id);

  -- THE MUTEX. Everything below is serialised per establishment, and every
  -- concurrent admission is either already committed or will read the value
  -- this transaction is about to write.
  select s.default_service_mode into v_previous
  from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  update public.location_service_settings s
     set default_service_mode = p_mode
   where s.location_id = p_location_id
  returning * into v_row;

  -- Recorded even when the value did not change. "Someone looked at this and
  -- confirmed it" is itself worth knowing when reconstructing a Saturday, and
  -- a conditional insert would make the history's silences ambiguous.
  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    previous_mode, new_mode, changed_by_user_id
  ) values (
    v_organization_id, 'location_default', 'location', p_location_id, null,
    v_previous, p_mode, (select auth.uid())
  );

  return v_row;
end;
$$;

comment on function public.set_location_service_mode(uuid, public.service_mode) is
  'Sets the ESTABLISHMENT default service mode. owner/manager only. Per location, never per organization — a multi-salon group changes one salon at a time. Takes the establishment mutex before reading, so it orders deterministically against concurrent admissions and other mode changes. Governs NEW admissions only: existing appointments and queue entries are never touched, cancelled or altered by this call. Writes the audit row in the same transaction, including when the value is unchanged.';

revoke execute on function public.set_location_service_mode(uuid, public.service_mode) from public, anon;
grant execute on function public.set_location_service_mode(uuid, public.service_mode) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. queue_open — the runtime state, kept separate on purpose
--
-- This function changes queue_open and NOTHING else. It does not read, infer or
-- adjust the service mode, and set_location_service_mode does not read, infer
-- or adjust queue_open. A shop that pauses walk-ins for lunch and then switches
-- to reservation_only for the afternoon must find its queue still paused when
-- it switches back — not silently reopened because the mode moved.
-- ---------------------------------------------------------------------------

create or replace function public.set_location_queue_open(
  p_location_id uuid,
  p_queue_open boolean
)
returns public.location_service_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_previous boolean;
  v_row public.location_service_settings;
begin
  if p_queue_open is null then
    raise exception 'queue_open is required' using errcode = '22023';
  end if;

  -- Receptionists included: closing the line is a front-of-house judgement.
  v_organization_id := private.assert_service_mode_authority(p_location_id, null, true);

  perform private.ensure_location_service_settings(p_location_id);

  select s.queue_open into v_previous
  from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  update public.location_service_settings s
     set queue_open = p_queue_open
   where s.location_id = p_location_id
  returning * into v_row;

  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    previous_queue_open, new_queue_open, changed_by_user_id
  ) values (
    v_organization_id, 'queue_open', 'location', p_location_id, null,
    v_previous, p_queue_open, (select auth.uid())
  );

  return v_row;
end;
$$;

comment on function public.set_location_queue_open(uuid, boolean) is
  'Opens or closes the live queue for NEW entries at one establishment. owner/manager/receptionist — closing the line is a front-of-house judgement made several times a week, and restricting it to owners would mean it never gets used. Changes queue_open and NOTHING else: it never reads or adjusts the service mode, exactly as a mode change never reads or adjusts this. Closing the queue does NOT cancel, remove or alter anyone already waiting — it only stops new arrivals joining.';

revoke execute on function public.set_location_queue_open(uuid, boolean) from public, anon;
grant execute on function public.set_location_queue_open(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The barber's persistent override
--
-- p_mode NULL is the documented way to go back to inheriting, not a missing
-- argument. There is no separate "clear" function, because clearing is exactly
-- "set it to inherit" and two functions would be two chances to forget the
-- audit row.
-- ---------------------------------------------------------------------------

create or replace function public.set_barber_service_mode_override(
  p_barber_id uuid,
  p_mode public.service_mode default null
)
returns public.barbers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_organization_id uuid;
  v_previous public.service_mode;
  v_row public.barbers;
begin
  -- The establishment is derived from the barber's placement, because the
  -- caller does not supply one — and the mutex has to be the same row the
  -- admission guard locks, or the two would not serialise against each other.
  select sp.location_id into v_location_id
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where b.id = p_barber_id;

  if not found or v_location_id is null then
    -- Either the barber does not exist, or they are not placed at an
    -- establishment. A barber with no location has no establishment default to
    -- override and no mutex to serialise on; the fix is to place them, which is
    -- a roster action, not a service-mode one.
    raise exception 'not authorized to manage service mode for this professional'
      using errcode = '42501';
  end if;

  v_organization_id := private.assert_service_mode_authority(v_location_id, p_barber_id, false);

  perform private.ensure_location_service_settings(v_location_id);

  -- Same mutex as everything else at this establishment.
  perform 1 from public.location_service_settings s
  where s.location_id = v_location_id
  for update;

  select b.service_mode_override into v_previous
  from public.barbers b where b.id = p_barber_id;

  update public.barbers b
     set service_mode_override = p_mode
   where b.id = p_barber_id
  returning * into v_row;

  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    previous_mode, new_mode, changed_by_user_id
  ) values (
    v_organization_id, 'barber_override', 'barber', v_location_id, p_barber_id,
    v_previous, p_mode, (select auth.uid())
  );

  return v_row;
end;
$$;

comment on function public.set_barber_service_mode_override(uuid, public.service_mode) is
  'Sets a barber placement''s PERSISTENT service mode. owner/manager of that organization, or that barber themselves (resolved from auth.uid(), never from the supplied id). p_mode NULL is the documented way to return to inheriting the establishment default — there is no separate clear function, because clearing IS setting it to inherit. Takes the establishment mutex, so it orders against location mode changes and concurrent admissions. Existing appointments and queue entries are never affected.';

revoke execute on function public.set_barber_service_mode_override(uuid, public.service_mode) from public, anon;
grant execute on function public.set_barber_service_mode_override(uuid, public.service_mode) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Temporary overrides
--
-- Set is "clear the current one, insert the new one", both inside the mutex.
-- That is what makes the partial unique index in 20260826120200 hold under
-- concurrency instead of producing a unique violation that a user would see as
-- a mysterious failure: the second writer waits, then clears what the first
-- wrote, then inserts. Last writer wins, exactly one active row, deterministic.
-- ---------------------------------------------------------------------------

create or replace function public.set_service_mode_temporary_override(
  p_scope public.service_mode_scope,
  p_location_id uuid,
  p_mode public.service_mode,
  p_expires_at timestamptz default null,
  p_barber_id uuid default null
)
returns public.service_mode_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_now timestamptz := now();
  v_actor uuid := (select auth.uid());
  v_row public.service_mode_overrides;
begin
  if p_scope is null or p_mode is null then
    raise exception 'scope and mode are required' using errcode = '22023';
  end if;

  if (p_scope = 'barber') <> (p_barber_id is not null) then
    raise exception 'barber scope requires a barber, location scope forbids one'
      using errcode = '22023';
  end if;

  -- An override that has already expired would be inert the moment it is
  -- written — accepting it would leave the author believing they had changed
  -- something. NULL stays legal: it means "until manually changed".
  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'the override end time must be in the future' using errcode = '22023';
  end if;

  v_organization_id := private.assert_service_mode_authority(
    p_location_id, p_barber_id, false
  );

  perform private.ensure_location_service_settings(p_location_id);

  -- THE MUTEX, before the clear and the insert, so the pair is atomic against
  -- another writer and against every concurrent admission.
  perform 1 from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  -- Supersede whatever is current for this exact target. Not deleted: the row
  -- stays as history, and cleared_at is what the unique index keys on.
  update public.service_mode_overrides o
     set cleared_at = v_now,
         cleared_by_user_id = v_actor
   where o.cleared_at is null
     and o.scope = p_scope
     and (
       (p_scope = 'location' and o.location_id = p_location_id)
       or (p_scope = 'barber' and o.barber_id = p_barber_id)
     );

  insert into public.service_mode_overrides (
    organization_id, scope, location_id, barber_id, mode,
    starts_at, expires_at, created_by_user_id
  ) values (
    v_organization_id, p_scope, p_location_id, p_barber_id, p_mode,
    v_now, p_expires_at, v_actor
  )
  returning * into v_row;

  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    new_mode, expires_at, changed_by_user_id
  ) values (
    v_organization_id, 'temporary_override_set', p_scope, p_location_id, p_barber_id,
    p_mode, p_expires_at, v_actor
  );

  return v_row;
end;
$$;

comment on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) is
  'Creates a temporary service-mode override at establishment or barber scope, superseding any override currently active on that exact target. owner/manager for either scope; a barber may also set their own. p_expires_at is an ABSOLUTE instant or NULL for "until manually changed" — the UI resolves "30 minutes"/"today"/"until closing" against the establishment''s timezone before calling, and this function never receives a duration or a vague string. Supersede-then-insert happens inside the establishment mutex, which is what makes "exactly one active override" hold under concurrency instead of surfacing as a unique violation.';

revoke execute on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) from public, anon;
grant execute on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) to authenticated;

create or replace function public.clear_service_mode_temporary_override(
  p_scope public.service_mode_scope,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_now timestamptz := now();
  v_actor uuid := (select auth.uid());
  v_cleared integer;
begin
  if p_scope is null then
    raise exception 'scope is required' using errcode = '22023';
  end if;

  if (p_scope = 'barber') <> (p_barber_id is not null) then
    raise exception 'barber scope requires a barber, location scope forbids one'
      using errcode = '22023';
  end if;

  v_organization_id := private.assert_service_mode_authority(
    p_location_id, p_barber_id, false
  );

  perform private.ensure_location_service_settings(p_location_id);

  perform 1 from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  update public.service_mode_overrides o
     set cleared_at = v_now,
         cleared_by_user_id = v_actor
   where o.cleared_at is null
     and o.scope = p_scope
     and (
       (p_scope = 'location' and o.location_id = p_location_id)
       or (p_scope = 'barber' and o.barber_id = p_barber_id)
     );

  get diagnostics v_cleared = row_count;

  -- Nothing to clear is a legitimate outcome, not an error: the override may
  -- have expired naturally a minute ago, and a Pro tapping "back to normal" on
  -- a slightly stale screen should get the state they asked for, not a failure.
  -- No history row is written in that case — nothing changed.
  if v_cleared > 0 then
    insert into public.service_mode_changes (
      organization_id, change_kind, scope, location_id, barber_id,
      changed_by_user_id
    ) values (
      v_organization_id, 'temporary_override_cleared', p_scope, p_location_id, p_barber_id,
      v_actor
    );
  end if;

  return v_cleared;
end;
$$;

comment on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) is
  'Clears the active temporary override on one target, returning the effective mode to the next precedence level (barber persistent override, then establishment default). Returns the number of rows cleared; zero is a legitimate outcome — the override may have expired naturally — and is not an error, because a Pro tapping "back to normal" on a stale screen should get the state they asked for. Rows are marked cleared, never deleted, so the history survives.';

revoke execute on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) from public, anon;
grant execute on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) to authenticated;
