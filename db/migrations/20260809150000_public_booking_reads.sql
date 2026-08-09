-- FadeUp — LOT 9: public booking
-- Migration: public booking read RPCs
--
-- The anon-facing surface for a public booking page at /s/{slug} (see the
-- "public (anon) lookup" gap flagged explicitly in
-- 20260809100300_organizations.sql). Deliberately built as narrowly-scoped
-- SECURITY DEFINER RPCs returning only curated columns — not broad anon
-- SELECT policies on organizations/locations/services/staff_profiles —
-- following the same pattern as get_invitation_by_token
-- (20260809110100_onboarding_rpcs.sql). A broad anon policy would expose
-- every column of those tables to anyone; these RPCs expose exactly what a
-- booking page needs and nothing else.
--
-- Every function re-derives organization_id from the slug and validates
-- every other id against that organization_id itself — no id is ever
-- trusted just because the client passed it, matching this repo's tenant-
-- isolation rule for anon-facing code in particular.
--
-- Idempotent: safe to re-run.

-- get_public_organization -----------------------------------------------------
-- Minimal identity for a booking page header. No rows for an unknown slug.
create or replace function public.get_public_organization(p_slug text)
returns table (id uuid, name text, slug text)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, o.name, o.slug
  from public.organizations o
  where o.slug = p_slug;
$$;

comment on function public.get_public_organization(text) is
  'Anon-callable: minimal org identity (id/name/slug) for a public booking page header. No rows for an unknown slug.';

revoke execute on function public.get_public_organization(text) from public;
grant execute on function public.get_public_organization(text) to anon, authenticated;

-- list_public_locations --------------------------------------------------------
-- Only is_active locations — an inactive location was deliberately hidden
-- from booking by staff (see locations.is_active), and this must stay
-- hidden from the public booking surface too.
create or replace function public.list_public_locations(p_organization_slug text)
returns table (
  id uuid,
  name text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  timezone text
)
language sql
security definer
stable
set search_path = ''
as $$
  select l.id, l.name, l.address_line1, l.address_line2, l.city, l.region, l.postal_code, l.country, l.timezone
  from public.locations l
  join public.organizations o on o.id = l.organization_id
  where o.slug = p_organization_slug and l.is_active;
$$;

comment on function public.list_public_locations(text) is
  'Anon-callable: active locations for a public booking page, by organization slug.';

revoke execute on function public.list_public_locations(text) from public;
grant execute on function public.list_public_locations(text) to anon, authenticated;

-- list_public_services ----------------------------------------------------------
-- Only is_active services that actually have a service_locations row for
-- p_location_id (explicit-join philosophy from LOT 7: no service_locations
-- row means "not offered here," so it must not appear as bookable here).
create or replace function public.list_public_services(p_organization_slug text, p_location_id uuid)
returns table (
  id uuid,
  category_id uuid,
  category_name text,
  name text,
  description text,
  duration_minutes integer,
  price_cents integer
)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.category_id, sc.name, s.name, s.description, s.duration_minutes, s.price_cents
  from public.services s
  join public.organizations o on o.id = s.organization_id
  join public.service_locations sl on sl.service_id = s.id and sl.location_id = p_location_id
  left join public.service_categories sc on sc.id = s.category_id
  where o.slug = p_organization_slug and s.is_active
  order by coalesce(sc.display_order, 0), s.name;
$$;

comment on function public.list_public_services(text, uuid) is
  'Anon-callable: active services actually offered at p_location_id (via service_locations), by organization slug. p_location_id is validated implicitly by the join — a location from another org simply yields zero rows.';

revoke execute on function public.list_public_services(text, uuid) from public;
grant execute on function public.list_public_services(text, uuid) to anon, authenticated;

-- list_public_barbers ------------------------------------------------------------
-- Bookable, public-facing barbers eligible for a specific service.
--
-- Documented simplification: staff_profiles.location_id is a barber's
-- single "primary location" (see 20260809120000_staff_profiles.sql) — there
-- is no barber-to-multiple-locations join table in this schema yet. A
-- barber whose primary location isn't p_location_id will not appear here
-- even if they occasionally work there. Revisit alongside LOT 21
-- (multi-location advanced ops) if that turns out to matter in practice.
create or replace function public.list_public_barbers(p_organization_slug text, p_location_id uuid, p_service_id uuid)
returns table (
  barber_id uuid,
  display_name text,
  title text,
  bio text,
  avatar_url text
)
language sql
security definer
stable
set search_path = ''
as $$
  select b.id, sp.display_name, sp.title, sp.bio, sp.avatar_url
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
  where o.slug = p_organization_slug
    and b.is_bookable
    and sp.is_active
    and sp.is_public
    and sp.location_id = p_location_id
  order by sp.display_name;
$$;

comment on function public.list_public_barbers(text, uuid, uuid) is
  'Anon-callable: bookable, public staff_profiles-visible barbers eligible (via barber_services) for p_service_id, whose primary location is p_location_id, by organization slug.';

revoke execute on function public.list_public_barbers(text, uuid, uuid) from public;
grant execute on function public.list_public_barbers(text, uuid, uuid) to anon, authenticated;

-- get_public_available_slots -----------------------------------------------------
-- Anon-safe equivalent of public.get_available_slots (LOT 8,
-- 20260809140100_appointment_slots_rpc.sql). Deliberately a SEPARATE
-- function rather than a shared implementation: get_available_slots is
-- SECURITY INVOKER and relies entirely on the caller's own RLS for its
-- tenant-isolation guarantee ("only ever returns slot data for an org the
-- caller already has access to" — see its comment). Anon has no RLS access
-- at all, so this function must be SECURITY DEFINER with its OWN explicit
-- validation (organization by slug, location active + belongs to org,
-- service active + offered at that location, barber bookable + eligible +
-- public + belongs to that location) before it may bypass RLS to read
-- public.appointments for conflict checking. Merging these two into one
-- function would mean one code path serving two different trust
-- boundaries — exactly the kind of thing that causes RLS/authorization
-- bugs. The slot-computation math itself is intentionally identical to
-- get_available_slots; keep both in sync if that math ever changes.
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
  v_organization_id uuid;
  v_duration_minutes integer;
  v_buffer_before_minutes integer;
  v_buffer_after_minutes integer;
  v_timezone text;
  v_day_of_week smallint;
  v_loc_is_closed boolean;
  v_loc_open_time time;
  v_loc_close_time time;
  v_exception_found boolean;
  v_exception_is_unavailable boolean;
  v_exception_start_time time;
  v_exception_end_time time;
  v_work_found boolean;
  v_work_is_off boolean;
  v_work_start_time time;
  v_work_end_time time;
  v_window_start time;
  v_window_end time;
  v_range_start timestamptz;
  v_range_end timestamptz;
begin
  if p_slot_step_minutes <= 0 then
    raise exception 'p_slot_step_minutes must be positive';
  end if;

  if p_date < current_date then
    return;
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    return;
  end if;

  -- Re-validate every id against v_organization_id — never trust that a
  -- client-supplied location/barber/service id actually belongs to the org
  -- resolved from the slug.
  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then
    return;
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    return;
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
    return;
  end if;

  v_day_of_week := extract(dow from p_date);

  select is_closed, open_time, close_time
    into v_loc_is_closed, v_loc_open_time, v_loc_close_time
    from public.location_hours
    where location_id = p_location_id and day_of_week = v_day_of_week;

  if not found or v_loc_is_closed then
    return;
  end if;

  select true, is_unavailable, start_time, end_time
    into v_exception_found, v_exception_is_unavailable, v_exception_start_time, v_exception_end_time
    from public.barber_availability_exceptions
    where barber_id = p_barber_id and exception_date = p_date;

  if v_exception_found and v_exception_is_unavailable then
    return;
  end if;

  if v_exception_found then
    v_window_start := v_exception_start_time;
    v_window_end := v_exception_end_time;
  else
    select true, is_off, start_time, end_time
      into v_work_found, v_work_is_off, v_work_start_time, v_work_end_time
      from public.barber_working_hours
      where barber_id = p_barber_id and day_of_week = v_day_of_week;

    if not v_work_found or v_work_is_off then
      return;
    end if;

    v_window_start := v_work_start_time;
    v_window_end := v_work_end_time;
  end if;

  v_window_start := greatest(v_window_start, v_loc_open_time);
  v_window_end := least(v_window_end, v_loc_close_time);

  if v_window_start >= v_window_end then
    return;
  end if;

  v_range_start := (p_date::timestamp + v_window_start) at time zone v_timezone;
  v_range_end := (p_date::timestamp + v_window_end) at time zone v_timezone - (v_duration_minutes || ' minutes')::interval;

  -- Never offer a slot that has already passed (a same-day booking page
  -- load after opening time should not offer 9am if it's already noon).
  if v_range_start < now() then
    v_range_start := v_range_start + ceil(extract(epoch from (now() - v_range_start)) / (p_slot_step_minutes * 60)) * (p_slot_step_minutes || ' minutes')::interval;
  end if;

  if v_range_start > v_range_end then
    return;
  end if;

  return query
  with candidates as (
    select generate_series(v_range_start, v_range_end, (p_slot_step_minutes || ' minutes')::interval) as candidate_start
  )
  select
    candidates.candidate_start as slot_start,
    candidates.candidate_start + (v_duration_minutes || ' minutes')::interval as slot_end
  from candidates
  where not exists (
    select 1
    from public.appointments a
    where a.barber_id = p_barber_id
      and a.status not in ('cancelled', 'no_show')
      and tstzrange(
            candidates.candidate_start - (v_buffer_before_minutes || ' minutes')::interval,
            candidates.candidate_start + (v_duration_minutes || ' minutes')::interval + (v_buffer_after_minutes || ' minutes')::interval,
            '[)'
          ) && a.blocked_range
  )
  order by candidates.candidate_start;
end;
$$;

comment on function public.get_public_available_slots(text, uuid, uuid, uuid, date, integer) is
  'Anon-callable equivalent of get_available_slots (LOT 8). SECURITY DEFINER with its own full validation (org by slug, location/service/barber all re-checked against that org and against each other) since anon has no RLS to lean on. Kept deliberately separate from get_available_slots rather than shared — see migration comment.';

revoke execute on function public.get_public_available_slots(text, uuid, uuid, uuid, date, integer) from public;
grant execute on function public.get_public_available_slots(text, uuid, uuid, uuid, date, integer) to anon, authenticated;
