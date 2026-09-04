-- FadeUp — B1, chantier 2: a read that writes cannot be read over HTTP.
--
-- THE DEFECT, MEASURED
--
--   POST /rest/v1/rpc/get_public_service_state  ->  405
--   {"code":"25006","message":"cannot execute INSERT in a read-only transaction"}
--
-- for anon and for authenticated, on every organization, including ones with
-- nothing to do with the P1c demonstration set.
--
-- THE CAUSE, EXACTLY
--
-- The function is STABLE — correctly, it is a read — and its body opens with
--
--   perform private.ensure_location_service_settings(p_location_id);
--
-- which is an INSERT ... ON CONFLICT DO NOTHING. PostgREST runs a STABLE or
-- IMMUTABLE function inside a READ ONLY transaction and answers GET or POST on
-- it; Postgres refuses the INSERT with 25006 and PostgREST surfaces that as
-- 405. psql opens no such transaction, which is why P1a validated this
-- function by hand and P1c only found it from a browser.
--
-- None of the usual 405 causes apply and each was checked: EXECUTE is granted
-- to anon and authenticated; there is no overload; the schema cache is
-- current; the argument names match what the client sends. Marking the
-- function VOLATILE would also make the 405 disappear — and is the wrong fix.
-- It would keep a write on the hot path of every public profile view, forfeit
-- PostgREST's read-only guarantee for a function whose whole job is to read,
-- and leave the identical defect in get_service_mode_state.
--
-- THE FIX: TAKE THE WRITE OUT OF THE READ
--
-- ensure_location_service_settings exists so no reader needs a "what if there
-- is no row" branch. That is a fine goal reached the wrong way: it buys the
-- absent branch with a write. This file gives readers the branch, in one
-- place, as a function that returns the settings row OR the compatibility
-- default the ensure would have inserted — hybrid, queue open — for a location
-- that exists.
--
-- The observable behaviour is therefore IDENTICAL to today's, including for
-- the pathological case: today a missing row is created as (hybrid, open) and
-- then read back; after this file it is read as (hybrid, open) without being
-- created. There are zero such rows in production right now (18 locations, 18
-- settings rows) — the trigger on locations has always created them — so this
-- is a defensive path, not a live one.
--
-- ensure_location_service_settings itself is UNTOUCHED and stays on the write
-- paths, where a transaction is read-write and materialising the row is
-- exactly right.
--
-- get_service_mode_state carries the same defect and is fixed in the same
-- file: it is STABLE, calls the same ensure, and would answer 405 to every
-- authenticated professional the moment P3 called it over HTTP.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. The read-side settings resolver
--
-- Returns exactly one row for an existing location and zero rows for a
-- location that does not exist — so "unknown location" stays distinguishable
-- from "location with default settings", which a coalesce on the caller's side
-- would have collapsed.
-- ---------------------------------------------------------------------------

create or replace function private.location_service_settings_effective(p_location_id uuid)
returns table (
  location_id uuid,
  organization_id uuid,
  default_service_mode public.service_mode,
  queue_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id,
    l.organization_id,
    coalesce(s.default_service_mode, 'hybrid'::public.service_mode),
    coalesce(s.queue_open, true)
  from public.locations l
  left join public.location_service_settings s on s.location_id = l.id
  where l.id = p_location_id;
$$;

comment on function private.location_service_settings_effective(uuid) is
  'The READ-side twin of private.ensure_location_service_settings: same compatibility default (hybrid, queue open), no INSERT. Every STABLE reader uses this, so a public read stays executable inside the READ ONLY transaction PostgREST opens for it. Returns no row for a location that does not exist, so callers can still tell absence from default.';

revoke all on function private.location_service_settings_effective(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. effective_service_mode — candidate 4 stops requiring a materialised row
--
-- Unchanged in every other respect: same four candidates, same precedence,
-- same NULL-is-inherit sentinel on the barber override.
-- ---------------------------------------------------------------------------

create or replace function private.effective_service_mode(p_location_id uuid, p_barber_id uuid default null)
returns table (mode public.service_mode, source text, starts_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    -- 1. the barber's own temporary override
    select 1 as precedence,
           o.mode,
           'barber_temporary_override'::text as source,
           o.starts_at,
           o.expires_at
    from public.service_mode_overrides o
    where p_barber_id is not null
      and o.scope = 'barber'
      and o.barber_id = p_barber_id
      and o.cleared_at is null
      and o.starts_at <= now()
      and (o.expires_at is null or o.expires_at > now())

    union all

    -- 2. the establishment's temporary override
    select 2,
           o.mode,
           'location_temporary_override',
           o.starts_at,
           o.expires_at
    from public.service_mode_overrides o
    where o.scope = 'location'
      and o.location_id = p_location_id
      and o.cleared_at is null
      and o.starts_at <= now()
      and (o.expires_at is null or o.expires_at > now())

    union all

    -- 3. the barber's standing arrangement. NULL is the inherit sentinel and
    --    must not become a candidate, or every inheriting barber would resolve
    --    to a NULL mode instead of falling through to the establishment.
    select 3,
           b.service_mode_override,
           'barber_override',
           null::timestamptz,
           null::timestamptz
    from public.barbers b
    where p_barber_id is not null
      and b.id = p_barber_id
      and b.service_mode_override is not null

    union all

    -- 4. the establishment default — the floor of the precedence. Read through
    --    the resolver instead of the table, so this arm no longer depends on a
    --    row having been INSERTed by whoever got here first.
    select 4,
           s.default_service_mode,
           'location_default',
           null::timestamptz,
           null::timestamptz
    from private.location_service_settings_effective(p_location_id) s
  )
  select c.mode, c.source, c.starts_at, c.expires_at
  from candidates c
  order by c.precedence
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. queue_admission_allowed — same substitution, same answer
-- ---------------------------------------------------------------------------

create or replace function private.queue_admission_allowed(p_organization_id uuid, p_location_id uuid, p_barber_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      private.org_has_capability(p_organization_id, 'walkIns')
      or private.org_has_capability(p_organization_id, 'liveQueue')
    )
    and private.mode_allows_queue((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m))
    and (select s.queue_open from private.location_service_settings_effective(p_location_id) s),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. get_public_service_state — the write comes out
--
-- Everything else is byte-for-byte the previous body: same organization
-- lookup, same active-location test, same barber-placement test (the one that
-- keeps unclaimed and external identities out, since they have no barbers
-- row), same returned columns in the same order.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_service_state(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns table (
  location_id uuid,
  barber_id uuid,
  effective_service_mode public.service_mode,
  mode_source text,
  mode_expires_at timestamptz,
  mode_allows_booking boolean,
  mode_allows_queue boolean,
  queue_open boolean,
  queue_accepting_new_entries boolean,
  booking_accepting_new_entries boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_mode public.service_mode;
  v_source text;
  v_expires_at timestamptz;
  v_queue_open boolean;
begin
  select o.id into v_organization_id
  from public.organizations o
  where o.slug = p_organization_slug;
  if not found then
    return;
  end if;

  -- The location must belong to THAT organization and be operating. An
  -- inactive location is not a shop a customer can act on.
  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id
      and l.organization_id = v_organization_id
      and l.is_active
  ) then
    return;
  end if;

  -- If a barber was named they must be a real, public, bookable placement AT
  -- this establishment. This is the check that keeps unclaimed and external
  -- professionals out — they have no barbers row to satisfy it.
  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    return;
  end if;

  select m.mode, m.source, m.expires_at
    into v_mode, v_source, v_expires_at
  from private.effective_service_mode(p_location_id, p_barber_id) m;

  select s.queue_open into v_queue_open
  from private.location_service_settings_effective(p_location_id) s;

  return query
  select
    p_location_id,
    p_barber_id,
    v_mode,
    v_source,
    -- The customer's client needs this to schedule its own refetch: an override
    -- that lapses on its own writes no row and therefore emits no realtime
    -- event, so a screen with no timer would sit on a stale answer until
    -- something else happened to invalidate it.
    v_expires_at,
    coalesce(private.mode_allows_booking(v_mode), false),
    coalesce(private.mode_allows_queue(v_mode), false),
    coalesce(v_queue_open, false),
    private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id),
    private.booking_admission_allowed(v_organization_id, p_location_id, p_barber_id);
end;
$$;

comment on function public.get_public_service_state(text, uuid, uuid) is
  'Anon-callable. What a public profile is allowed to offer right now: effective service mode, where that mode comes from, when it lapses, and whether booking and queue are actually admitting. Contains NO write — B1 removed an ensure_location_service_settings call that made PostgREST answer 405 (25006) to every caller, because a STABLE function runs in a READ ONLY transaction. Keep it that way: any write added here takes the public profile offline again.';

-- ---------------------------------------------------------------------------
-- 5. get_service_mode_state — the same defect, the same fix
--
-- The two return-query arms joined location_service_settings directly, so
-- without the ensure they would have returned NO rows for a location missing
-- its settings row rather than the defaults. They read through the resolver
-- instead. Membership check, roster semantics and ordering are unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.get_service_mode_state(p_location_id uuid)
returns table (
  scope public.service_mode_scope,
  barber_id uuid,
  barber_display_name text,
  location_default_service_mode public.service_mode,
  barber_service_mode_override public.service_mode,
  effective_service_mode public.service_mode,
  mode_source text,
  mode_starts_at timestamptz,
  mode_expires_at timestamptz,
  queue_open boolean,
  mode_allows_booking boolean,
  mode_allows_queue boolean,
  booking_accepting_new_entries boolean,
  queue_accepting_new_entries boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select l.organization_id into v_organization_id
  from public.locations l
  where l.id = p_location_id;
  if not found then
    return;
  end if;

  -- Membership, derived from auth.uid(). Any member may READ the operating
  -- state of their own establishment — a barber needs to see that the shop is
  -- reservation_only this afternoon. Changing it is a different question,
  -- answered by private.assert_service_mode_authority in 20260826120400.
  if not (
    (select private.is_org_member(v_organization_id))
    or (select private.is_platform_admin())
  ) then
    return;
  end if;

  -- The establishment row.
  return query
  select
    'location'::public.service_mode_scope,
    null::uuid,
    null::text,
    s.default_service_mode,
    null::public.service_mode,
    m.mode,
    m.source,
    m.starts_at,
    m.expires_at,
    s.queue_open,
    coalesce(private.mode_allows_booking(m.mode), false),
    coalesce(private.mode_allows_queue(m.mode), false),
    private.booking_admission_allowed(v_organization_id, p_location_id, null),
    private.queue_admission_allowed(v_organization_id, p_location_id, null)
  from private.location_service_settings_effective(p_location_id) s
  cross join lateral private.effective_service_mode(p_location_id, null) m;

  -- One row per barber placed here. Inactive and non-public staff are included
  -- deliberately: this is the operator's own roster view, and a manager needs
  -- to see the mode of someone they are about to bring back on shift.
  return query
  select
    'barber'::public.service_mode_scope,
    b.id,
    sp.display_name,
    s.default_service_mode,
    b.service_mode_override,
    m.mode,
    m.source,
    m.starts_at,
    m.expires_at,
    s.queue_open,
    coalesce(private.mode_allows_booking(m.mode), false),
    coalesce(private.mode_allows_queue(m.mode), false),
    private.booking_admission_allowed(v_organization_id, p_location_id, b.id),
    private.queue_admission_allowed(v_organization_id, p_location_id, b.id)
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  cross join lateral private.location_service_settings_effective(p_location_id) s
  cross join lateral private.effective_service_mode(p_location_id, b.id) m
  where b.organization_id = v_organization_id
    and sp.location_id = p_location_id
  order by 3;
end;
$$;

comment on function public.get_service_mode_state(uuid) is
  'Org-member only. The operator''s own view of service mode at one establishment: the location row, then one row per barber placed there. Contains NO write — B1 removed the same ensure_location_service_settings call that broke get_public_service_state over HTTP, for the same reason.';

commit;
