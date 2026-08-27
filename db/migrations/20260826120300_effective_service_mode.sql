-- FadeUp — SERVICE MODE: the one resolver
--
-- ONE DOMAIN TRUTH
--
-- There is exactly one implementation of service-mode precedence in FadeUp, and
-- it is private.effective_service_mode. The booking guard, the queue guard, the
-- Pro read RPC and the customer read RPC all call it. None of them reimplements
-- the ordering, and neither does the frontend — the resolver hands back the
-- answer AND its provenance, so a client renders "queue only until 15:30,
-- because you set it" without knowing the rules that produced it.
--
-- Four resolvers that agree today would be four resolvers that disagree after
-- the next change, and the one that disagrees silently would be the enforcement
-- path.
--
-- THE PRECEDENCE
--
--   1. active BARBER temporary override
--   2. active LOCATION temporary override
--   3. BARBER persistent override        (barbers.service_mode_override)
--   4. LOCATION default                  (location_service_settings)
--
-- The specific beats the general, and the temporary beats the standing
-- arrangement, at every level. A barber saying "not me, not right now" is the
-- most specific statement anyone can make about a chair, so it wins outright —
-- including over a manager's location-wide temporary override. That is not an
-- authorization hole: a manager who needs to override a barber can set that
-- barber's override directly (they are permitted to), and doing so is recorded
-- against them by name in service_mode_changes. Silently outranking a barber's
-- own "I'm unavailable" would produce bookings for someone who has said they
-- cannot take them.
--
-- WHY IT RESOLVES ON (location_id, barber_id) AND NOT ON barber_id ALONE
--
-- The pair is what the row being admitted actually carries. Both
-- appointments and queue_entries have a NOT NULL location_id, and a barber_id
-- that is nullable on the queue side ("any available barber" — a genuine
-- walk-in request, not an unset value).
--
-- Resolving from the pair means:
--
--   * a queue entry with no barber naturally answers at location scope only,
--     with no special case anywhere;
--   * enforcement judges the establishment the booking is actually FOR, rather
--     than wherever the barber's staff profile currently points — and
--     staff_profiles.location_id is nullable and ON DELETE SET NULL, so it is
--     not something an invariant should lean on;
--   * a professional working at two establishments (R18) resolves differently
--     at each, with no schema change.
--
-- ACTIVE MEANS ACTIVE NOW, DECIDED HERE
--
--   cleared_at is null
--   and starts_at <= now()
--   and (expires_at is null or expires_at > now())
--
-- STABLE, not IMMUTABLE, because it reads now() and mutable tables. Marking it
-- IMMUTABLE would let the planner fold a mode into a cached plan and serve an
-- expired override forever, which is the exact failure this design exists to
-- rule out.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The two mode predicates
--
-- Deliberately tiny, deliberately central. Every "can this channel take a new
-- customer" question in the codebase resolves through these two functions, so
-- that adding a fifth mode later is a change in one place rather than a search
-- for every `= 'hybrid'` comparison someone wrote inline.
--
-- IMMUTABLE is correct here and only here: these are pure functions of the enum
-- value, reading nothing.
-- ---------------------------------------------------------------------------

create or replace function private.mode_allows_booking(p_mode public.service_mode)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mode in ('hybrid', 'reservation_only');
$$;

comment on function private.mode_allows_booking(public.service_mode) is
  'Does this service mode admit a NEW reservation? hybrid and reservation_only yes; queue_only and unavailable no. NOT the final answer — booking admission also requires the R2 booking entitlement, a valid operational identity, and the existing availability rules. NULL in, NULL out, and every caller treats NULL as deny.';

create or replace function private.mode_allows_queue(p_mode public.service_mode)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mode in ('hybrid', 'queue_only');
$$;

comment on function private.mode_allows_queue(public.service_mode) is
  'Does this service mode admit a NEW queue entry? hybrid and queue_only yes; reservation_only and unavailable no. NOT the final answer — queue admission also requires the R2 walk-in/queue entitlement AND queue_open, which this function deliberately says nothing about. Service mode never replaces queue_open.';

revoke all on function private.mode_allows_booking(public.service_mode) from public, anon, authenticated;
revoke all on function private.mode_allows_queue(public.service_mode) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The resolver
--
-- Returns provenance alongside the mode, because a client that has to
-- re-derive "where did this come from" is a client that has reimplemented the
-- precedence — and would eventually disagree with the guard that actually
-- refuses the booking.
--
-- `source` is a stable machine token, never a sentence:
--
--   barber_temporary_override
--   location_temporary_override
--   barber_override
--   location_default
--
-- No authorization of its own. It lives in `private`, is not reachable through
-- PostgREST, has EXECUTE granted to no client role, and every public caller
-- establishes the actor's relationship to the tenant first. Called directly it
-- would answer questions about any location in the database.
-- ---------------------------------------------------------------------------

create or replace function private.effective_service_mode(
  p_location_id uuid,
  p_barber_id uuid default null
)
returns table (
  mode public.service_mode,
  source text,
  starts_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
stable
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

    -- 4. the establishment default — the floor of the precedence, and the
    --    reason every location is guaranteed a settings row.
    select 4,
           s.default_service_mode,
           'location_default',
           null::timestamptz,
           null::timestamptz
    from public.location_service_settings s
    where s.location_id = p_location_id
  )
  select c.mode, c.source, c.starts_at, c.expires_at
  from candidates c
  order by c.precedence
  limit 1;
$$;

comment on function private.effective_service_mode(uuid, uuid) is
  'THE service-mode resolver — the only implementation of precedence in FadeUp. Resolves for the (location_id, barber_id) pair carried by the row being admitted: barber temporary override > location temporary override > barber persistent override > establishment default. Returns the mode AND its provenance (source, starts_at, expires_at) so no caller — including the frontend — has to reimplement the ordering. Expiry is decided here and nowhere else: an override with expires_at <= now() is simply not a candidate, so correctness needs no cron, worker or open browser. Returns zero rows only when the location has no settings row, which callers treat as deny. STABLE, never IMMUTABLE: it reads now(). Performs no authorization; callers must establish the actor first.';

revoke all on function private.effective_service_mode(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The composed admission questions
--
-- These are what enforcement and both read RPCs actually ask, so that the
-- composition rule — entitlement AND mode AND runtime state — is written once
-- instead of being reassembled slightly differently in four places. That kind
-- of drift is how a gate ends up decorative on one path.
--
-- BOOKING requires the R2 `booking` capability.
--
-- QUEUE requires `walkIns` OR `liveQueue`, and the disjunction is deliberate.
-- R2's matrix gives salon_essential `walkIns` WITHOUT `liveQueue`; demanding
-- liveQueue would silently withdraw a walk-in channel that plan pays for, which
-- is a pricing change, and this lot changes no pricing. The question this gate
-- asks is "is this organization entitled to operate a walk-in/queue channel at
-- all" — free has neither key and is refused, every plan that sells one is
-- admitted. Separating the public intake surface from the staff queue console
-- is a packaging question that belongs to R2, not here.
--
-- Neither function takes a lock. Locking belongs to the enforcement path in
-- 20260826120500, which needs it; the read RPCs must not take row locks on
-- behalf of someone merely looking at a page.
-- ---------------------------------------------------------------------------

create or replace function private.booking_admission_allowed(
  p_organization_id uuid,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    private.org_has_capability(p_organization_id, 'booking')
    and private.mode_allows_booking((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m)),
    false
  );
$$;

comment on function private.booking_admission_allowed(uuid, uuid, uuid) is
  'Composed answer to "may a NEW reservation be admitted here?": the R2 booking entitlement AND the effective service mode. Fails closed on every unknown — no commercial state, no settings row, NULL argument — via the coalesce. Deliberately does NOT answer whether a slot exists; that stays with get_public_available_slots, and conflating the two would let the UI promise a time the availability engine has not offered.';

create or replace function private.queue_admission_allowed(
  p_organization_id uuid,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      private.org_has_capability(p_organization_id, 'walkIns')
      or private.org_has_capability(p_organization_id, 'liveQueue')
    )
    and private.mode_allows_queue((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m))
    and (select s.queue_open from public.location_service_settings s where s.location_id = p_location_id),
    false
  );
$$;

comment on function private.queue_admission_allowed(uuid, uuid, uuid) is
  'Composed answer to "may a NEW queue entry be admitted here?": the R2 walk-in/queue entitlement AND the effective service mode AND queue_open. All three are independent facts and all three must hold — service mode never replaces queue_open, and queue_open never overrides the mode. The entitlement is a disjunction of walkIns/liveQueue because R2 sells salon_essential the first without the second; requiring liveQueue would withdraw a paid channel, which would be a pricing change. Fails closed on every unknown.';

revoke all on function private.booking_admission_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.queue_admission_allowed(uuid, uuid, uuid) from public, anon, authenticated;
