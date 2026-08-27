-- FadeUp — SERVICE MODE: the read contracts
--
-- TWO AUDIENCES, TWO SHAPES, ONE TRUTH
--
-- Both functions here answer from private.effective_service_mode and the
-- private.*_admission_allowed composers. Neither reimplements precedence, and
-- neither is allowed to: a customer-facing contract that computed the mode
-- slightly differently from the trigger that refuses the booking would show a
-- Book button that fails on tap, which is worse than showing nothing.
--
--   get_public_service_state   anon + authenticated. What a customer, or the
--                              future mobile app, is allowed to know.
--   get_service_mode_state     authenticated org members. What a Pro needs to
--                              operate the establishment.
--
-- WHY THE PUBLIC ONE TAKES A SLUG
--
-- Every existing public read in FadeUp resolves the organization from
-- p_organization_slug and then re-validates every id it was handed against it
-- (get_public_organization, list_public_barbers, get_public_queue_status). This
-- follows that pattern exactly, and for the same reason: a function that
-- accepted a bare location_id would answer questions about any location id
-- anyone cared to guess. With the slug, an id from a different tenant simply
-- fails to match and the function returns nothing.
--
-- ZERO ROWS IS THE REFUSAL, AND IT IS DELIBERATELY INDISTINGUISHABLE
--
-- Unknown slug, wrong tenant, inactive location, non-public barber, barber not
-- placed here — all return zero rows, identically. No error message
-- distinguishes them, because a distinguishable one is an oracle: it would let
-- an anonymous caller enumerate which location ids exist, which barbers are
-- inactive, and which shops have shut down.
--
-- UNCLAIMED AND EXTERNAL PROFESSIONALS GET NOTHING, BY CONSTRUCTION
--
-- This matters more than it looks. R1B/R10 create public.professionals rows for
-- professionals the acquisition worker DISCOVERED — real people who have never
-- heard of FadeUp. They have a public identity and no operational reality.
--
-- This function is reachable only through a public.barbers row: an actual
-- roster placement, in an actual organization, at an actual active location,
-- with a public and active staff profile. A discovered-but-unclaimed
-- professional has no such row, so there is no query shape that makes this
-- function invent availability, a service mode, a queue state or a booking
-- promise on their behalf. The safety is structural rather than a filter
-- someone could later forget to apply.
--
-- WHAT booking_accepting_new_entries DOES AND DOES NOT MEAN
--
-- It means: a new booking would not be refused by entitlement or by service
-- mode. It does NOT mean a slot exists. Slot computation is
-- get_public_available_slots, it is expensive, it depends on a date and a
-- service, and it stays exactly where it is. Conflating the two here would let
-- the UI promise a time the availability engine has never offered — which is a
-- worse customer experience than the honest "this shop takes reservations, now
-- go and pick one".
--
-- The queue side has no such caveat: queue_accepting_new_entries genuinely is
-- the final answer, because joining a queue needs no slot.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The customer contract
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
security definer
stable
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

  perform private.ensure_location_service_settings(p_location_id);

  select m.mode, m.source, m.expires_at
    into v_mode, v_source, v_expires_at
  from private.effective_service_mode(p_location_id, p_barber_id) m;

  select s.queue_open into v_queue_open
  from public.location_service_settings s
  where s.location_id = p_location_id;

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
  'The customer-facing service-state contract, and the one the future mobile Customer app consumes. Anon-callable. Re-derives the organization from the slug and re-validates the location and barber against it, exactly as every other public read does; returns ZERO ROWS — indistinguishably — for an unknown slug, a foreign tenant, an inactive location or a non-public barber, so it is not an existence oracle. Unreachable for unclaimed/external professionals by construction: it requires a real barbers placement, which a discovered-but-unclaimed professional does not have, so no fabricated availability or queue state can ever be produced for one. booking_accepting_new_entries means "not refused by entitlement or mode" and is NOT slot availability — that remains get_public_available_slots. queue_accepting_new_entries IS final, because joining a queue needs no slot. Exposes no actor ids, no override history and no internal authorization state.';

revoke execute on function public.get_public_service_state(text, uuid, uuid) from public;
grant execute on function public.get_public_service_state(text, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The Pro contract
--
-- One call returns everything the operational surface needs: the
-- establishment's default and queue state, the active location override, and
-- every barber's effective mode with its provenance. One row per barber plus a
-- location-scope row, rather than N+1 calls from a screen that lists a roster.
--
-- Returns nothing — rather than raising — for a caller who is not a member, so
-- it is safe to call from a shared layout that renders before the caller's
-- workspace is known. That is the same choice get_booking_requests made, for
-- the same reason.
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
security definer
stable
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

  perform private.ensure_location_service_settings(p_location_id);

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
  from public.location_service_settings s
  cross join lateral private.effective_service_mode(p_location_id, null) m
  where s.location_id = p_location_id;

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
  join public.location_service_settings s on s.location_id = p_location_id
  cross join lateral private.effective_service_mode(p_location_id, b.id) m
  where b.organization_id = v_organization_id
    and sp.location_id = p_location_id
  order by 3;
end;
$$;

comment on function public.get_service_mode_state(uuid) is
  'The Pro operating view of one establishment: the location default and queue_open, plus every barber placed there with their persistent override, effective mode and provenance — one call rather than N+1 from a roster screen. Any org member may read it (a barber needs to know the shop is reservation_only this afternoon); CHANGING it is a separate question answered by private.assert_service_mode_authority. Returns nothing rather than raising for a non-member, so it is safe to call from a shared layout that renders before the workspace is resolved.';

revoke execute on function public.get_service_mode_state(uuid) from public, anon;
grant execute on function public.get_service_mode_state(uuid) to authenticated;
