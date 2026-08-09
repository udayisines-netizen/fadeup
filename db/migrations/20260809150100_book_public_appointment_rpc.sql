-- FadeUp — LOT 9: public booking
-- Migration: book_public_appointment RPC
--
-- The only path an anonymous visitor has to create an appointments row.
-- appointments has no anon INSERT policy at all (LOT 8) — on purpose, so
-- every public write funnels through this single, fully-validated,
-- SECURITY DEFINER gate rather than a broad anon INSERT policy that would
-- let a client claim any organization_id/location_id/barber_id/service_id
-- combination it likes.
--
-- Every foreign id is re-validated against the organization resolved from
-- p_organization_slug (never trusted just because the client sent it), and
-- the requested time is independently re-checked against location_hours /
-- barber_working_hours / barber_availability_exceptions (the same window
-- logic as get_public_available_slots) — a client is never trusted to have
-- only ever requested a time this function itself already offered.
-- Overlap with an existing appointment is still additionally guaranteed
-- race-free by the appointments_barber_no_overlap/..._chair_no_overlap GiST
-- exclusion constraints (LOT 8) regardless of anything checked here.
--
-- Public bookings are created with status = 'pending', not 'confirmed' —
-- this is a booking *request* that shows up on the shop's schedule
-- immediately (the exclusion constraint holds the slot) for
-- owner/manager/receptionist to confirm or decline via the existing
-- appointments UPDATE policy; instant auto-confirmation is not implemented
-- and would be a deliberate future product decision, not an oversight.
--
-- Idempotent: safe to re-run.

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
  status public.appointment_status
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
  v_local_start_time time;
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
  v_ends_at timestamptz;
  v_local_end_time time;
  v_appointment public.appointments;
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

  v_ends_at := p_starts_at + (v_duration_minutes || ' minutes')::interval;

  -- Re-derive the requested window in the location's local time and
  -- re-check it against business/working hours ourselves — the client is
  -- never trusted to have only ever requested a time we already offered.
  v_local_date := (p_starts_at at time zone v_timezone)::date;
  v_local_start_time := (p_starts_at at time zone v_timezone)::time;
  v_local_end_time := (v_ends_at at time zone v_timezone)::time;
  v_day_of_week := extract(dow from v_local_date);

  select is_closed, open_time, close_time
    into v_loc_is_closed, v_loc_open_time, v_loc_close_time
    from public.location_hours
    where location_id = p_location_id and day_of_week = v_day_of_week;

  if not found or v_loc_is_closed then
    raise exception 'location is closed at the requested time';
  end if;

  select true, is_unavailable, start_time, end_time
    into v_exception_found, v_exception_is_unavailable, v_exception_start_time, v_exception_end_time
    from public.barber_availability_exceptions
    where barber_id = p_barber_id and exception_date = v_local_date;

  if v_exception_found and v_exception_is_unavailable then
    raise exception 'barber is unavailable on the requested date';
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
      raise exception 'barber does not work on the requested date';
    end if;

    v_window_start := v_work_start_time;
    v_window_end := v_work_end_time;
  end if;

  v_window_start := greatest(v_window_start, v_loc_open_time);
  v_window_end := least(v_window_end, v_loc_close_time);

  if v_local_start_time < v_window_start or v_local_end_time > v_window_end then
    raise exception 'requested time is outside available hours';
  end if;

  -- The appointments_barber_no_overlap / appointments_chair_no_overlap GiST
  -- exclusion constraints (LOT 8) are the final, race-free guarantee here —
  -- if two visitors request the same slot concurrently, exactly one of
  -- these inserts succeeds and the other raises, regardless of the checks
  -- above.
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'pending', p_notes, null
  )
  returning * into v_appointment;

  return query select v_appointment.id, v_appointment.starts_at, v_appointment.ends_at, v_appointment.status;
end;
$$;

comment on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) is
  'Anon-callable: the only path to create an appointment without a session. SECURITY DEFINER — fully re-validates every id against the organization resolved from the slug and re-checks the requested time against business/working hours itself, then relies on the LOT 8 GiST exclusion constraints for the final race-free conflict guarantee. Creates status=pending (a booking request), not confirmed.';

revoke execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;
