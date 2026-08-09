-- FadeUp — LOT 8: appointment engine
-- Migration: get_available_slots RPC
--
-- Computes bookable start/end times for one barber, at one location, for
-- one service, on one date. Intersects location_hours with
-- barber_working_hours (both keyed by day_of_week, 0=Sunday..6=Saturday —
-- see location_hours/barber_working_hours migration comments), applies a
-- same-date barber_availability_exceptions override if one exists, then
-- excludes any candidate slot that would overlap an existing non-cancelled,
-- non-no-show appointment's blocked_range (buffers included).
--
-- Simplification, documented rather than silently assumed: barber_working_hours
-- is not location-scoped (a barber has one weekly schedule, not one per
-- location), so this function evaluates that schedule's times in the
-- *location's* timezone. For a barber who only ever works at one location
-- this is exactly correct; for a barber shared across locations in
-- different timezones it is an approximation. Revisit if/when multi-location
-- barber scheduling (LOT 21) needs per-location working hours.
--
-- SECURITY INVOKER (the default) — this function reads public.appointments,
-- public.services etc. under the calling user's own RLS, so it only ever
-- returns slot data for an org the caller already has access to. It is not
-- anon-callable: LOT 9 (public booking) will need its own anon-safe wrapper
-- that validates the organization/service/barber differently, not a grant
-- on this function.
--
-- Idempotent: safe to re-run.

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

  select duration_minutes, buffer_before_minutes, buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services
    where id = p_service_id and organization_id = p_organization_id and is_active;

  if not found then
    return;
  end if;

  select timezone into v_timezone
    from public.locations
    where id = p_location_id and organization_id = p_organization_id;

  if not found then
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
    -- A non-unavailable exception replaces the barber's regular hours for
    -- this specific date entirely (it is not merged with the weekly
    -- schedule).
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

comment on function public.get_available_slots(uuid, uuid, uuid, uuid, date, integer) is
  'Bookable (slot_start, slot_end) pairs for one barber/location/service/date, intersecting location_hours and barber_working_hours, applying same-date barber_availability_exceptions, and excluding conflicts with existing non-cancelled/non-no-show appointments (buffers included). SECURITY INVOKER — respects the caller''s own RLS, not anon-callable.';

revoke execute on function public.get_available_slots(uuid, uuid, uuid, uuid, date, integer) from public, anon;
grant execute on function public.get_available_slots(uuid, uuid, uuid, uuid, date, integer) to authenticated;
