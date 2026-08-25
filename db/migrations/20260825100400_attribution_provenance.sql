-- FadeUp — R1A: trustworthy booking attribution
-- Migration: appointments.booked_by_user_id, queue_entries.booked_by_user_id
--
-- WHY THIS COLUMN EXISTS
--
-- Everything social that FadeUp will build needs one honest answer to "which
-- ACCOUNT made this booking". The obvious candidate, customers.user_id, cannot
-- give it: that column is reachable by contact-detail squatting (closed in
-- 20260825100000, but the column remains a convenience bridge, not evidence)
-- and is settable to any account by any owner/manager/receptionist.
--
-- created_by cannot give it either — both self-service RPCs insert
-- created_by = null explicitly.
--
-- So the fact is recorded rather than inferred. booked_by_user_id is stamped
-- ONLY from auth.uid(), inside book_public_appointment and join_public_queue,
-- which already compute it to resolve the caller's own CRM row through
-- private.resolve_customer_for_user (which matches on user_id ONLY, never on a
-- typed-in phone). Anonymous bookings and staff-created rows carry NULL and
-- attribute to nobody.
--
-- WHY INSERT IS REVOKED, NOT ONLY UPDATE
--
-- Revoking UPDATE alone leaves the column forgeable in a single step, because
-- `authenticated` holds blanket table-level INSERT and appointments_insert's
-- RLS only checks org role. A shop owner could insert a customers row carrying
-- any account id they know, then insert an appointment naming it — minting
-- attribution for a customer who never acted. Shops legitimately hold their
-- own customers' ids, so the precondition is met for every real customer.
--
-- A column-level REVOKE cannot subtract from a table-level grant, so the
-- privilege is revoked at TABLE level and every other column re-granted.
-- The two RPCs are unaffected: they are SECURITY DEFINER owned by postgres.
--
-- THE TWO FUNCTION BODIES BELOW ARE REPRODUCED VERBATIM from their current
-- definitions (book_public_appointment from 20260819210000_booking_auto_confirm,
-- join_public_queue from 20260813160000_claim_scope_fix) with exactly TWO lines
-- changed in each: the insert column list and the insert values list.
-- Signatures, parameters, return shapes, validation, claim-token issuance and
-- grants are unchanged. No booking behaviour changes.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='appointments' and column_name='booked_by_user_id') then
    alter table public.appointments
      add column booked_by_user_id uuid references auth.users (id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='queue_entries' and column_name='booked_by_user_id') then
    alter table public.queue_entries
      add column booked_by_user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

comment on column public.appointments.booked_by_user_id is
  'The authenticated account that ITSELF created this booking, stamped from auth.uid() inside book_public_appointment. NULL for anonymous bookings and for rows created by staff. This is the ONLY trustworthy account attribution for an appointment: customer_id is resolved from caller-typed contact details and must never be used to attribute social or verified-client facts.';

comment on column public.queue_entries.booked_by_user_id is
  'The authenticated account that ITSELF joined this queue, stamped from auth.uid() inside join_public_queue. NULL for anonymous kiosk check-in and staff-added walk-ins. Same trust rule as appointments.booked_by_user_id.';

revoke insert, update on public.appointments from authenticated, anon;
grant insert (id, organization_id, location_id, barber_id, chair_id, service_id,
              customer_name, customer_phone, customer_email, starts_at, ends_at,
              buffer_before_minutes, buffer_after_minutes, status, notes,
              created_by, created_at, updated_at, customer_id, expires_at,
              resolution, resolution_note, decided_at, decided_by, rescheduled_to)
  on public.appointments to authenticated;
grant update (organization_id, location_id, barber_id, chair_id, service_id,
              customer_name, customer_phone, customer_email, starts_at, ends_at,
              buffer_before_minutes, buffer_after_minutes, status, notes,
              created_by, created_at, updated_at, customer_id, expires_at,
              resolution, resolution_note, decided_at, decided_by, rescheduled_to)
  on public.appointments to authenticated;

revoke insert, update on public.queue_entries from authenticated, anon;
grant insert (id, organization_id, location_id, barber_id, service_id, customer_name,
              customer_phone, status, notes, called_at, service_started_at,
              completed_at, created_by, created_at, updated_at, customer_id)
  on public.queue_entries to authenticated;
grant update (organization_id, location_id, barber_id, service_id, customer_name,
              customer_phone, status, notes, called_at, service_started_at,
              completed_at, created_by, created_at, updated_at, customer_id)
  on public.queue_entries to authenticated;

create index if not exists appointments_booked_by_user_id_idx
  on public.appointments (booked_by_user_id) where booked_by_user_id is not null;
create index if not exists queue_entries_booked_by_user_id_idx
  on public.queue_entries (booked_by_user_id) where booked_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- book_public_appointment — verbatim, +2 lines
-- ---------------------------------------------------------------------------

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

  -- The client is never trusted to have only ever requested a time we offered.
  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
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

  -- CONFIRMED, not pending. Everything above has already established that the
  -- shop works this time, at this place, for this service, with this
  -- professional — there is no further question for a human to answer.
  --
  -- decided_at/decided_by stay NULL on purpose: nobody decided. That is what
  -- distinguishes an auto-confirmed booking from one a receptionist accepted,
  -- and it is worth being able to tell them apart later.
  --
  -- appointments_check_time_blocks (LOT D) runs before the insert lands, and
  -- the GiST exclusion constraints remain the final race-free authority: two
  -- visitors racing this exact slot still produce exactly one appointment.
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by, booked_by_user_id
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'confirmed', p_notes, null, v_user_id
  )
  returning * into v_appointment;

  -- Anonymous booking: issue the one-time proof-of-booking token. (LOT 13.)
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
  'Anon-callable: the only path to create an appointment without a session. Creates status=CONFIRMED — the shop already answered by publishing the slot. Every id is re-validated against the organization resolved from the slug, the window is re-derived server-side through private.slot_is_within_hours, time blocks are enforced by trigger, and the LOT 8 GiST exclusion constraints remain the final race-free conflict guarantee. Signed-in bookers get customer_id stamped; anonymous ones get a single-use 72h claim_token.';

revoke execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- join_public_queue — verbatim, +2 lines
-- ---------------------------------------------------------------------------

create or replace function public.join_public_queue(
  p_organization_slug text,
  p_location_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_barber_id uuid default null,
  p_service_id uuid default null
)
returns table (id uuid, status public.queue_status, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
  v_user_id uuid;
  v_customer_id uuid;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active
  ) then
    raise exception 'location is not available';
  end if;

  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
  ) then
    raise exception 'requested barber is not available';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
  ) then
    raise exception 'requested service is not available';
  end if;

  -- Signed-in walk-in: attach the entry to the caller's OWN customer record
  -- for this shop so get_my_queue_status can find it. Anonymous kiosk
  -- check-in leaves this null and behaves exactly as before.
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by, booked_by_user_id)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null, v_user_id)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;

comment on function public.join_public_queue(text, uuid, text, text, uuid, uuid) is
  'Anon-callable kiosk self-check-in: adds a waiting queue_entries row. SECURITY DEFINER — re-validates organization/location/barber/service against the slug, same pattern as book_public_appointment (LOT 9). When the caller is authenticated, stamps customer_id with their own CRM row for that shop (resolved on user_id only, never on a typed-in phone) so the entry is visible through get_my_queue_status.';

revoke execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) from public;
grant execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) to anon, authenticated;
