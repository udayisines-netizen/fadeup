-- FadeUp — LOT D: the Professional workspace
--
-- LOT D is mostly a frontend lot. These are the four things the database
-- genuinely could not express, each confirmed against the live schema before
-- being written rather than assumed.
--
-- ============================================================================
-- 1. SPLIT SHIFTS WERE STRUCTURALLY IMPOSSIBLE
-- ============================================================================
--
--   barber_working_hours has `unique (barber_id, day_of_week)` and one
--   start_time/end_time pair. location_hours is the same shape. So a day is
--   exactly one continuous window, and the lunch closure that almost every
--   French salon actually works — 09:00-12:00, 14:00-19:00 — cannot be
--   represented at all. The LOT B onboarding note ("one window per day for
--   now") was describing this limit.
--
--   Two ways to fix it:
--
--     a. Drop the unique constraint and allow many rows per day. Cleanest in
--        theory, but it is not additive: `apply_weekly_hours` upserts with
--        `on conflict (barber_id, day_of_week)`, and every existing read
--        assumes one row. It would rewrite working code across three lots.
--
--     b. Add an optional SECOND interval to the same row.
--
--   (b) is chosen. It needs no constraint change, no upsert change, and no
--   read to be rewritten — a NULL second interval behaves exactly as today.
--   It covers the real case (a midday break) precisely. A shop needing three
--   intervals in one day carves the third out with a time block below, which
--   is the more honest model for an irregular gap anyway.
--
-- ============================================================================
-- 2. THERE WAS NO BLOCKED-TIME MODEL
-- ============================================================================
--
--   barber_availability_exceptions is `unique (barber_id, exception_date)`
--   and REPLACES the day's window. It can say "off today" or "today I work
--   10-14 instead", but it cannot say "busy 12:00-13:00" without destroying
--   the rest of the day.
--
--   appointments.blocked_range is not the answer either: it is a column ON an
--   appointment, and inventing placeholder appointments for lunch would put
--   fake customers in the CRM, in counts, and in the booking history.
--
--   So: public.time_blocks, a first-class range. Blocks may overlap each
--   other freely (a break inside a meeting is not a contradiction), so there
--   is deliberately no exclusion constraint here — unlike appointments, where
--   overlap is the thing being prevented.
--
-- ============================================================================
-- 3. THE SLOT MATH EXISTED TWICE AND HAD ALREADY DRIFTED
-- ============================================================================
--
--   get_available_slots (staff, INVOKER) and get_public_available_slots
--   (anon, DEFINER) carry the same algorithm. Keeping them separate is
--   correct — they sit on different trust boundaries — but duplicating the
--   MATH meant the past-time trim was added to one and not the other, and
--   split shifts plus time blocks would have drifted the same way.
--
--   The computation moves to private.compute_available_slots. Both callers
--   keep their own, unchanged validation and simply ask it the arithmetic
--   question. Neither gains authority it did not have.
--
-- ============================================================================
-- 4. COMPLETED / NO-SHOW HAD NO CONTROLLED TRANSITION
-- ============================================================================
--
--   The schedule page PATCHes appointments.status directly. RLS makes that
--   safe from a tenant point of view, but nothing validates the transition,
--   so completed -> pending is reachable, and nothing records who decided or
--   notifies anyone. LOT C established the transition-RPC pattern; these two
--   join it.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Split shifts
-- ---------------------------------------------------------------------------

alter table public.barber_working_hours
  add column if not exists second_start_time time,
  add column if not exists second_end_time time;

alter table public.location_hours
  add column if not exists second_open_time time,
  add column if not exists second_close_time time;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barber_working_hours_second_interval_valid') then
    alter table public.barber_working_hours
      add constraint barber_working_hours_second_interval_valid
      check (
        -- Both NULL (the ordinary single-window day) or both set and ordered,
        -- and the afternoon must start after the morning ends. A "second"
        -- interval that overlaps or precedes the first is not a split shift,
        -- it is a data-entry mistake.
        (second_start_time is null and second_end_time is null)
        or (
          second_start_time is not null and second_end_time is not null
          and second_start_time < second_end_time
          and start_time is not null and end_time is not null
          and second_start_time >= end_time
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'location_hours_second_interval_valid') then
    alter table public.location_hours
      add constraint location_hours_second_interval_valid
      check (
        (second_open_time is null and second_close_time is null)
        or (
          second_open_time is not null and second_close_time is not null
          and second_open_time < second_close_time
          and open_time is not null and close_time is not null
          and second_open_time >= close_time
        )
      );
  end if;
end $$;

comment on column public.barber_working_hours.second_start_time is
  'Optional afternoon interval, for a day split by a midday break. NULL means the ordinary single-window day and behaves exactly as before. Must begin at or after end_time — see the constraint.';
comment on column public.location_hours.second_open_time is
  'Optional afternoon opening interval. NULL means one continuous window, unchanged.';

-- ---------------------------------------------------------------------------
-- 2. Time blocks
-- ---------------------------------------------------------------------------

create table if not exists public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Nullable: a block can be personal to one professional across the whole
  -- organization, or scoped to where they physically are.
  location_id uuid references public.locations (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_blocks_time_order check (ends_at > starts_at),
  constraint time_blocks_reason_length check (reason is null or char_length(reason) <= 200)
);

comment on table public.time_blocks is
  'Time a professional is unavailable for reasons that are not an appointment: lunch, a break, a meeting, an errand. Deliberately NOT modelled as an appointment — placeholder appointments would put fake customers into the CRM, into counts and into booking history. Blocks may overlap each other, so unlike appointments there is no exclusion constraint.';

comment on column public.time_blocks.reason is
  'Shown to staff on the calendar. Never shown to a customer — the public booking surface only learns that the time is unavailable, not why.';

-- The calendar's range scan and the slot functions' overlap test.
create index if not exists time_blocks_barber_range_idx on public.time_blocks (barber_id, starts_at, ends_at);
create index if not exists time_blocks_organization_range_idx on public.time_blocks (organization_id, starts_at);

drop trigger if exists time_blocks_set_updated_at on public.time_blocks;
create trigger time_blocks_set_updated_at
  before update on public.time_blocks
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant, matching the pattern every other business
-- table uses: enforced by trigger rather than only by RLS, so it also holds
-- for service_role and direct SQL.
--
-- SECURITY DEFINER, unlike the older consistency triggers, and deliberately:
-- BEFORE triggers run before the RLS WITH CHECK, so an INVOKER version asks
-- "can YOU see a barber in that org" and a caller from another tenant — who
-- cannot see the row at all — is rejected with a phantom tenant-mismatch
-- instead of the authorization error that actually applies. Reading the real
-- rows here lets RLS answer the authorization question, which is its job.
-- The function only ever reads and raises; it grants nothing.
create or replace function public.check_time_block_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'time_blocks.barber_id must belong to the same organization_id';
  end if;

  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'time_blocks.location_id must belong to the same organization_id';
  end if;

  return new;
end;
$$;

drop trigger if exists time_blocks_check_consistency on public.time_blocks;
create trigger time_blocks_check_consistency
  before insert or update on public.time_blocks
  for each row execute function public.check_time_block_consistency();

alter table public.time_blocks enable row level security;
alter table public.time_blocks force row level security;

-- select: any org member. Everyone on the floor needs to see why a slot is
-- unavailable, same breadth as appointments.
drop policy if exists time_blocks_select on public.time_blocks;
create policy time_blocks_select
  on public.time_blocks for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

-- write: front-of-house manages anyone's time; a barber manages their OWN.
-- Blocking your own lunch should not require finding a manager, and
-- private.is_own_barber (LOT 11) already answers "is this me" precisely.
drop policy if exists time_blocks_insert on public.time_blocks;
create policy time_blocks_insert
  on public.time_blocks for insert to authenticated
  with check (
    (select private.can_manage_appointments(organization_id))
    or (select private.is_own_barber(barber_id))
  );

drop policy if exists time_blocks_update on public.time_blocks;
create policy time_blocks_update
  on public.time_blocks for update to authenticated
  using (
    (select private.can_manage_appointments(organization_id))
    or (select private.is_own_barber(barber_id))
  )
  with check (
    (select private.can_manage_appointments(organization_id))
    or (select private.is_own_barber(barber_id))
  );

drop policy if exists time_blocks_delete on public.time_blocks;
create policy time_blocks_delete
  on public.time_blocks for delete to authenticated
  using (
    (select private.can_manage_appointments(organization_id))
    or (select private.is_own_barber(barber_id))
  );

-- Realtime: a manager blocking a barber's afternoon must reach that barber's
-- open calendar. RLS-filtered per subscriber, like every other table here.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'time_blocks'
  ) then
    alter publication supabase_realtime add table public.time_blocks;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The slot math, in ONE place
--
--    private, SECURITY INVOKER, and doing no authorization of any kind: it is
--    pure arithmetic over rows the CALLER has already validated and may
--    already read. Both public wrappers keep their own checks exactly as they
--    were, which is what stops this from becoming a way around either trust
--    boundary.
-- ---------------------------------------------------------------------------

/** A local time on a date, as an instant range in the business's timezone. */
create or replace function private.day_window(p_date date, p_from time, p_to time, p_timezone text)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from is null or p_to is null then 'empty'::tstzrange
    else tstzrange(
      (p_date::timestamp + p_from) at time zone p_timezone,
      (p_date::timestamp + p_to) at time zone p_timezone,
      '[)'
    )
  end;
$$;

/**
 * The first step boundary at or after now — how the past-time trim is applied.
 * Stepping from the window's own start keeps the grid aligned: a 15-minute
 * shop that opens at 09:00 still offers :00/:15/:30/:45 at 14:07, not 14:07.
 */
create or replace function private.next_step_from(p_window_start timestamptz, p_step_minutes integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_window_start >= now() then p_window_start
    else p_window_start + make_interval(mins =>
      (ceil(extract(epoch from (now() - p_window_start)) / (p_step_minutes * 60)) * p_step_minutes)::integer)
  end;
$$;

revoke execute on function private.day_window(date, time, time, text) from public, anon;
revoke execute on function private.next_step_from(timestamptz, integer) from public, anon;
grant execute on function private.day_window(date, time, time, text) to authenticated;
grant execute on function private.next_step_from(timestamptz, integer) to authenticated;

create or replace function private.compute_available_slots(
  p_barber_id uuid,
  p_location_id uuid,
  p_date date,
  p_timezone text,
  p_duration_minutes integer,
  p_buffer_before_minutes integer,
  p_buffer_after_minutes integer,
  p_slot_step_minutes integer,
  -- The public wrapper trims past times; the staff one historically did not,
  -- and that difference was a real drift bug. Now it is an explicit argument.
  p_exclude_past boolean
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day_of_week smallint := extract(dow from p_date);
  v_loc record;
  v_exception record;
  v_work record;
  -- FOUND is reset by every subsequent query, and a record whose SELECT INTO
  -- matched nothing has all-NULL fields rather than being false-y. Both make
  -- `if not v_row.something` silently do the wrong thing, so each lookup
  -- captures its own explicit boolean immediately.
  v_has_exception boolean;
  v_has_work boolean;
  -- Up to two windows a day, after the split-shift change.
  v_windows tstzrange[];
begin
  select lh.is_closed, lh.open_time, lh.close_time, lh.second_open_time, lh.second_close_time
    into v_loc
    from public.location_hours lh
    where lh.location_id = p_location_id and lh.day_of_week = v_day_of_week;

  if not found or v_loc.is_closed then
    return;
  end if;

  select ex.is_unavailable, ex.start_time, ex.end_time
    into v_exception
    from public.barber_availability_exceptions ex
    where ex.barber_id = p_barber_id and ex.exception_date = p_date;
  v_has_exception := found;

  if v_has_exception and v_exception.is_unavailable then
    return;
  end if;

  if v_has_exception then
    -- A same-date exception replaces the weekly schedule entirely, as it
    -- always has. Exceptions carry no second interval: an irregular day with
    -- a gap in it is a time block, which is the model that actually fits.
    v_windows := array[
      private.day_window(p_date, v_exception.start_time, v_exception.end_time, p_timezone)
    ];
  else
    select wh.is_off, wh.start_time, wh.end_time, wh.second_start_time, wh.second_end_time
      into v_work
      from public.barber_working_hours wh
      where wh.barber_id = p_barber_id and wh.day_of_week = v_day_of_week;
    v_has_work := found;

    if not v_has_work or v_work.is_off then
      return;
    end if;

    v_windows := array[
      private.day_window(p_date, v_work.start_time, v_work.end_time, p_timezone)
    ];
    if v_work.second_start_time is not null then
      v_windows := v_windows || private.day_window(p_date, v_work.second_start_time, v_work.second_end_time, p_timezone);
    end if;
  end if;

  -- Intersect every professional window with every location window. A shop
  -- open 09-12 and 14-19 with a barber working 10-18 yields 10-12 and 14-18:
  -- the product of the two, not one merged span.
  return query
  with location_windows as (
    select private.day_window(p_date, v_loc.open_time, v_loc.close_time, p_timezone) as w
    union all
    select private.day_window(p_date, v_loc.second_open_time, v_loc.second_close_time, p_timezone)
      where v_loc.second_open_time is not null
  ),
  barber_windows as (
    select unnest(v_windows) as w
  ),
  usable as (
    select (b.w * l.w) as w
    from barber_windows b
    cross join location_windows l
    where b.w && l.w
  ),
  bounded as (
    select
      case
        when p_exclude_past then private.next_step_from(lower(w), p_slot_step_minutes)
        else lower(w)
      end as range_start,
      upper(w) - make_interval(mins => p_duration_minutes) as range_end
    from usable
  ),
  candidates as (
    select generate_series(range_start, range_end, make_interval(mins => p_slot_step_minutes)) as candidate_start
    from bounded
    where range_start <= range_end
  )
  select distinct
    c.candidate_start,
    c.candidate_start + make_interval(mins => p_duration_minutes)
  from candidates c
  where not exists (
    -- An existing appointment, buffers included. Unchanged from before.
    select 1
    from public.appointments a
    where a.barber_id = p_barber_id
      and a.status not in ('cancelled', 'no_show')
      and tstzrange(
            c.candidate_start - make_interval(mins => p_buffer_before_minutes),
            c.candidate_start + make_interval(mins => p_duration_minutes + p_buffer_after_minutes),
            '[)'
          ) && a.blocked_range
  )
  and not exists (
    -- NEW: a time block. Buffers are deliberately NOT applied here — a block
    -- is the professional's own stated unavailability, not an appointment
    -- needing turnaround either side of it.
    select 1
    from public.time_blocks tb
    where tb.barber_id = p_barber_id
      and tstzrange(c.candidate_start, c.candidate_start + make_interval(mins => p_duration_minutes), '[)')
          && tstzrange(tb.starts_at, tb.ends_at, '[)')
  )
  order by 1;
end;
$$;

comment on function private.compute_available_slots(uuid, uuid, date, text, integer, integer, integer, integer, boolean) is
  'The slot arithmetic, in one place. Pure computation with NO authorization: both public wrappers validate first and keep their own trust boundary. Understands split shifts (two windows a day, intersected with the location''s) and time blocks. Extracted because the two copies had already drifted — the past-time trim existed in only one.';

revoke execute on function private.compute_available_slots(uuid, uuid, date, text, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function private.compute_available_slots(uuid, uuid, date, text, integer, integer, integer, integer, boolean) to authenticated;

-- Both wrappers keep their own validation verbatim and delegate the maths.

create or replace function public.get_available_slots(
  p_organization_id uuid,
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_date date,
  p_slot_step_minutes integer default 15
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_duration integer; v_before integer; v_after integer; v_timezone text;
begin
  if p_slot_step_minutes <= 0 then
    raise exception 'p_slot_step_minutes must be positive';
  end if;

  select duration_minutes, buffer_before_minutes, buffer_after_minutes
    into v_duration, v_before, v_after
    from public.services
    where id = p_service_id and organization_id = p_organization_id and is_active;
  if not found then return; end if;

  select timezone into v_timezone
    from public.locations
    where id = p_location_id and organization_id = p_organization_id;
  if not found then return; end if;

  -- SECURITY INVOKER, as before: this reads appointments under the caller's
  -- own RLS, so it only ever returns slot data for an org they can see.
  -- p_exclude_past is TRUE now — staff were being offered 9am at noon, which
  -- was the drift this extraction removes.
  return query select * from private.compute_available_slots(
    p_barber_id, p_location_id, p_date, v_timezone,
    v_duration, v_before, v_after, p_slot_step_minutes, true);
end;
$$;

comment on function public.get_available_slots(uuid, uuid, uuid, uuid, date, integer) is
  'Bookable slots for staff. SECURITY INVOKER — respects the caller''s own RLS. Now shares private.compute_available_slots with the public wrapper, so split shifts, time blocks and the past-time trim can never again exist in one and not the other.';

revoke execute on function public.get_available_slots(uuid, uuid, uuid, uuid, date, integer) from public, anon;
grant execute on function public.get_available_slots(uuid, uuid, uuid, uuid, date, integer) to authenticated;

create or replace function public.get_public_available_slots(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_date date,
  p_slot_step_minutes integer default 15
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_organization_id uuid; v_timezone text;
  v_duration integer; v_before integer; v_after integer;
begin
  if p_slot_step_minutes <= 0 then
    raise exception 'p_slot_step_minutes must be positive';
  end if;

  if p_date < current_date then return; end if;

  -- Every id re-validated against the organization resolved from the slug.
  -- Preserved verbatim from 20260809150000 — anon has no RLS to lean on.
  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then return; end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then return; end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration, v_before, v_after
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then return; end if;

  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable and sp.is_active and sp.is_public
      and sp.location_id = p_location_id
  ) then
    return;
  end if;

  return query select * from private.compute_available_slots(
    p_barber_id, p_location_id, p_date, v_timezone,
    v_duration, v_before, v_after, p_slot_step_minutes, true);
end;
$$;

comment on function public.get_public_available_slots(text, uuid, uuid, uuid, date, integer) is
  'Anon-callable slot lookup. Validation unchanged and still complete (org by slug, then every id re-checked against it); only the arithmetic moved to private.compute_available_slots, which also excludes time blocks so a professional''s lunch is genuinely unbookable.';

revoke execute on function public.get_public_available_slots(text, uuid, uuid, uuid, date, integer) from public;
grant execute on function public.get_public_available_slots(text, uuid, uuid, uuid, date, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. A time block must actually block — on EVERY path
--
--     book_public_appointment, reschedule_appointment and any staff-side
--     insert are three different doors into the same table, and LOT C's
--     reschedule validates hours not at all (it leans entirely on the GiST
--     constraint). Teaching each RPC about time blocks separately would
--     recreate exactly the drift that section 3 just removed.
--
--     So this is a trigger: one rule, at the data layer, that no code path
--     can route around — the same reasoning that makes double-booking an
--     exclusion constraint rather than a check in each caller.
--
--     It fires only when the booking's TIME or professional actually changes.
--     A block placed over an already-booked hour is legitimate (it stops NEW
--     bookings and leaves the existing one alone), and without that guard
--     merely marking that appointment completed would fail.
-- ---------------------------------------------------------------------------

create or replace function public.check_appointment_time_blocks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Cancellations and no-shows release time; they are never blocked.
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.barber_id is not distinct from old.barber_id then
    return new;
  end if;

  if new.barber_id is not null and exists (
    select 1
    from public.time_blocks tb
    where tb.barber_id = new.barber_id
      and tstzrange(new.starts_at, new.ends_at, '[)') && tstzrange(tb.starts_at, tb.ends_at, '[)')
  ) then
    -- Deliberately does not name the reason: this message reaches anonymous
    -- customers, and "Karim is at the dentist" is not theirs to know.
    raise exception 'the professional is unavailable at the requested time'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_check_time_blocks on public.appointments;
create trigger appointments_check_time_blocks
  before insert or update on public.appointments
  for each row execute function public.check_appointment_time_blocks();

comment on function public.check_appointment_time_blocks() is
  'Rejects a booking overlapping the professional''s blocked time, on every path into the table rather than in each RPC. Skipped when a row''s time and professional are unchanged, so a block laid over an existing appointment never prevents that appointment from being completed or cancelled.';

-- book_public_appointment: the hours check now understands split shifts.
--
-- Rebased on the LOT 13 (20260813150000) definition, NOT the original LOT 9
-- one: LOT 13 added signed-in customer linking, the anonymous claim token and
-- a fifth return column. Only the window derivation changes here — every
-- identity check, the customer-linking block, the claim token and the return
-- shape are preserved exactly, and the GiST constraints remain the final
-- race-free authority on conflicts.
create or replace function public.book_public_appointment(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  claim_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_timezone text;
  v_duration_minutes integer;
  v_buffer_before_minutes integer;
  v_buffer_after_minutes integer;
  v_day_of_week smallint;
  v_local_date date;
  v_loc record;
  v_exception record;
  v_work record;
  v_has_exception boolean;
  v_has_work boolean;
  v_barber_windows tstzrange[];
  v_location_windows tstzrange[];
  v_requested tstzrange;
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_user_id uuid;
  v_customer_id uuid;
  v_claim_token text;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' and coalesce(btrim(p_customer_email), '') = '' then
    raise exception 'at least one of customer_phone or customer_email is required';
  end if;

  if p_starts_at <= now() then
    raise exception 'starts_at must be in the future';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then
    raise exception 'location is not available for booking';
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    raise exception 'service is not available for booking at this location';
  end if;

  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    raise exception 'barber is not available for this service at this location';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);
  v_requested := tstzrange(p_starts_at, v_ends_at, '[)');

  -- Re-derive the requested window in the location's local time and re-check
  -- it ourselves — the client is never trusted to have only ever requested a
  -- time we already offered.
  v_local_date := (p_starts_at at time zone v_timezone)::date;
  v_day_of_week := extract(dow from v_local_date);

  select lh.is_closed, lh.open_time, lh.close_time, lh.second_open_time, lh.second_close_time
    into v_loc
    from public.location_hours lh
    where lh.location_id = p_location_id and lh.day_of_week = v_day_of_week;

  if not found or v_loc.is_closed then
    raise exception 'location is closed at the requested time';
  end if;

  v_location_windows := array[private.day_window(v_local_date, v_loc.open_time, v_loc.close_time, v_timezone)];
  if v_loc.second_open_time is not null then
    v_location_windows := v_location_windows
      || private.day_window(v_local_date, v_loc.second_open_time, v_loc.second_close_time, v_timezone);
  end if;

  select ex.is_unavailable, ex.start_time, ex.end_time
    into v_exception
    from public.barber_availability_exceptions ex
    where ex.barber_id = p_barber_id and ex.exception_date = v_local_date;
  v_has_exception := found;

  if v_has_exception and v_exception.is_unavailable then
    raise exception 'barber is unavailable on the requested date';
  end if;

  if v_has_exception then
    v_barber_windows := array[private.day_window(v_local_date, v_exception.start_time, v_exception.end_time, v_timezone)];
  else
    select wh.is_off, wh.start_time, wh.end_time, wh.second_start_time, wh.second_end_time
      into v_work
      from public.barber_working_hours wh
      where wh.barber_id = p_barber_id and wh.day_of_week = v_day_of_week;
    v_has_work := found;

    if not v_has_work or v_work.is_off then
      raise exception 'barber does not work on the requested date';
    end if;

    v_barber_windows := array[private.day_window(v_local_date, v_work.start_time, v_work.end_time, v_timezone)];
    if v_work.second_start_time is not null then
      v_barber_windows := v_barber_windows
        || private.day_window(v_local_date, v_work.second_start_time, v_work.second_end_time, v_timezone);
    end if;
  end if;

  -- The whole appointment must fit inside ONE intersected window. A booking
  -- that starts before lunch and ends after it is not "within hours" just
  -- because both endpoints happen to fall in some open interval.
  if not exists (
    select 1
    from unnest(v_barber_windows) b(w)
    cross join unnest(v_location_windows) l(w)
    where (b.w * l.w) @> v_requested
  ) then
    raise exception 'requested time is outside available hours';
  end if;

  -- Signed-in booker: resolve (or create) their own CRM row for this shop so
  -- the appointment is owned from the moment it exists. Anonymous booker:
  -- v_customer_id stays null and a claim token is issued below. (LOT 13.)
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, p_customer_email
    );
  end if;

  -- Time blocks are enforced by appointments_check_time_blocks, which covers
  -- this path and every other one.
  --
  -- The appointments_barber_no_overlap / appointments_chair_no_overlap GiST
  -- exclusion constraints (LOT 8) remain the final, race-free guarantee: if
  -- two visitors request the same slot concurrently, exactly one of these
  -- inserts succeeds and the other raises, regardless of the checks above.
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'pending', p_notes, null
  )
  returning * into v_appointment;

  -- Anonymous booking: issue the one-time proof-of-booking token. 72h is
  -- deliberately short — it exists to bridge "book now, make an account in
  -- the next few minutes", not to be a durable credential. (LOT 13.)
  if v_user_id is null then
    v_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.appointment_claim_tokens (appointment_id, token_hash, expires_at)
    values (
      v_appointment.id,
      encode(extensions.digest(v_claim_token, 'sha256'), 'hex'),
      now() + interval '72 hours'
    );
  end if;

  return query select v_appointment.id, v_appointment.starts_at, v_appointment.ends_at, v_appointment.status, v_claim_token;
end;
$$;

comment on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) is
  'Anon-callable: the only path to create an appointment without a session. SECURITY DEFINER — fully re-validates every id against the organization resolved from the slug and re-derives the requested window server-side, then relies on the LOT 8 GiST exclusion constraints for the final race-free conflict guarantee. Creates status=pending. Signed-in bookers get appointments.customer_id stamped; anonymous ones get a single-use 72h claim_token (hash-stored). Now split-shift aware: the appointment must fit entirely inside ONE intersected open window, so a booking spanning the lunch closure is refused rather than accepted because both ends happen to land in open time.';

revoke execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- apply_weekly_hours: able to SAVE a split shift.
--
-- The second interval is optional in the payload, so every existing caller —
-- onboarding, the hours editor — keeps working unchanged and simply omits it.
create or replace function public.apply_weekly_hours(
  p_organization_id uuid,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_days jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_dow smallint;
  v_closed boolean;
  v_open time;
  v_close time;
  v_second_open time;
  v_second_close time;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set hours'
      using errcode = '42501';
  end if;

  if p_location_id is null and p_barber_id is null then
    raise exception 'pass a location, a professional, or both';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.locations l where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    v_dow := (v_item ->> 'day_of_week')::smallint;
    v_closed := coalesce((v_item ->> 'is_closed')::boolean, (v_item ->> 'is_off')::boolean, false);
    v_open := nullif(v_item ->> 'open_time', '')::time;
    v_close := nullif(v_item ->> 'close_time', '')::time;
    v_second_open := nullif(v_item ->> 'second_open_time', '')::time;
    v_second_close := nullif(v_item ->> 'second_close_time', '')::time;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'day_of_week must be 0 (Sunday) through 6 (Saturday)';
    end if;
    if not v_closed and (v_open is null or v_close is null or v_open >= v_close) then
      raise exception 'an open day needs open_time earlier than close_time';
    end if;

    -- Validated here as well as by the table constraint, so the caller gets a
    -- sentence rather than a constraint name.
    if not v_closed and (v_second_open is not null or v_second_close is not null) then
      if v_second_open is null or v_second_close is null then
        raise exception 'a split shift needs both second_open_time and second_close_time';
      end if;
      if v_second_open >= v_second_close then
        raise exception 'the second interval needs its start earlier than its end';
      end if;
      if v_second_open < v_close then
        raise exception 'the second interval must begin after the first one ends';
      end if;
    end if;

    -- A closed day carries no intervals at all.
    if v_closed then
      v_open := null; v_close := null; v_second_open := null; v_second_close := null;
    end if;

    if p_location_id is not null then
      insert into public.location_hours (
        organization_id, location_id, day_of_week, is_closed,
        open_time, close_time, second_open_time, second_close_time)
      values (p_organization_id, p_location_id, v_dow, v_closed,
              v_open, v_close, v_second_open, v_second_close)
      on conflict (location_id, day_of_week) do update set
        is_closed = excluded.is_closed,
        open_time = excluded.open_time,
        close_time = excluded.close_time,
        second_open_time = excluded.second_open_time,
        second_close_time = excluded.second_close_time;
    end if;

    if p_barber_id is not null then
      insert into public.barber_working_hours (
        organization_id, barber_id, day_of_week, is_off,
        start_time, end_time, second_start_time, second_end_time)
      values (p_organization_id, p_barber_id, v_dow, v_closed,
              v_open, v_close, v_second_open, v_second_close)
      on conflict (barber_id, day_of_week) do update set
        is_off = excluded.is_off,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        second_start_time = excluded.second_start_time,
        second_end_time = excluded.second_end_time;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) is
  'Upserts a whole week of opening hours for a location and/or working hours for a professional in one call. Idempotent via the existing unique constraints. Now accepts an optional second interval per day, so the midday closure most salons actually work is expressible; omitting it preserves the previous single-window behaviour exactly.';

revoke execute on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Completing the operational end of the lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.complete_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  -- Front-of-house, or the barber whose appointment it is: marking your own
  -- client done from the chair is the whole point of Chair Mode.
  if not (
    (select private.can_manage_appointments(v_appointment.organization_id))
    or (select private.is_own_barber(v_appointment.barber_id))
  ) then
    raise exception 'not authorized to manage this appointment' using errcode = '42501';
  end if;

  if v_appointment.status = 'completed' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'only a confirmed appointment can be completed' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'completed', decided_at = now(), decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  return v_appointment;
end;
$$;

comment on function public.complete_appointment(uuid) is
  'Marks a confirmed appointment completed. Row-locked, state-guarded and idempotent, so the raw status PATCH that allowed completed -> pending is no longer the only path. Emits no notification: the customer was there, and telling them what they just experienced is noise.';

revoke execute on function public.complete_appointment(uuid) from public, anon;
grant execute on function public.complete_appointment(uuid) to authenticated;

create or replace function public.mark_appointment_no_show(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (
    (select private.can_manage_appointments(v_appointment.organization_id))
    or (select private.is_own_barber(v_appointment.barber_id))
  ) then
    raise exception 'not authorized to manage this appointment' using errcode = '42501';
  end if;

  if v_appointment.status = 'no_show' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'only a confirmed appointment can be marked as a no-show' using errcode = '22023';
  end if;

  -- no_show is already in the exclusion predicate, so this releases the slot
  -- exactly as a cancellation does. No resolution is set: the status IS the
  -- explanation, and resolution describes why something was cancelled.
  update public.appointments
    set status = 'no_show', decided_at = now(), decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  return v_appointment;
end;
$$;

comment on function public.mark_appointment_no_show(uuid) is
  'Marks a confirmed appointment as a no-show, releasing the slot through the existing exclusion predicate. No fee, no charge, no notification — that is LOT K and a product decision, not a side effect of recording what happened.';

revoke execute on function public.mark_appointment_no_show(uuid) from public, anon;
grant execute on function public.mark_appointment_no_show(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. One enriched calendar read
--
--    The schedule page fetched appointments and then resolved barber, service
--    and customer names from separately-fetched lists client-side. That works
--    for one day and becomes an N+1-shaped problem across a week or a month.
--    One range query, joined once, is what the calendar consumes everywhere.
--
--    Range-bounded by contract: the caller must pass a window. There is no
--    way to ask this for an organization's entire history.
-- ---------------------------------------------------------------------------

create or replace function public.get_calendar_appointments(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_location_id uuid default null,
  p_barber_id uuid default null
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  resolution public.appointment_resolution,
  expires_at timestamptz,
  location_id uuid,
  location_name text,
  location_timezone text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  price_cents integer,
  customer_name text,
  customer_phone text,
  notes text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.starts_at, a.ends_at, a.status, a.resolution, a.expires_at,
    a.location_id, l.name, l.timezone,
    a.barber_id, sp.display_name,
    a.service_id, s.name, s.price_cents,
    a.customer_name, a.customer_phone, a.notes, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_barber_id is null or a.barber_id = p_barber_id)
    -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
    -- Any org member may read the shop's schedule, exactly as the
    -- appointments_select policy already allows.
    and ((select private.is_org_member(p_organization_id)) or (select private.is_platform_admin()))
  order by a.starts_at;
$$;

comment on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Range-bounded, pre-joined calendar read. Returns nothing — rather than raising — for a non-member, so it is safe to call from a shared layout. Deliberately omits customer_email and customer_id: the calendar needs a name and a phone number to run a day, not the CRM record.';

revoke execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;

-- The range scan this read performs, and the one the day view performs most.
create index if not exists appointments_org_starts_at_idx
  on public.appointments (organization_id, starts_at);
