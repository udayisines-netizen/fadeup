-- FadeUp — R1: trustworthy attribution provenance
-- Migration: appointments.booked_by_user_id, queue_entries.booked_by_user_id
--
-- WHY THIS EXISTS — read this before changing anything below.
--
-- R1 attaches social meaning (auto-follow, verified-client relationships) to
-- bookings. Deciding WHOSE account a booking belongs to is therefore now a
-- security decision, and the obvious answer is wrong.
--
-- The obvious answer is appointments.customer_id -> customers.user_id. But
-- link_customer_from_contact_info() (BEFORE INSERT on BOTH appointments and
-- queue_entries, 20260809180100) find-or-creates that customers row by
-- matching the CALLER-TYPED customer_phone, then lower(customer_email). The
-- row a booking lands on is chosen by data the booker supplies. This is the
-- same untrusted edge 20260813160000_claim_scope_fix.sql was written to stop
-- trusting.
--
-- The attack it would enable:
--
--   1. Victim V books once while signed in. resolve_customer_for_user stamps
--      V's phone/email onto V's own linked CRM row R (R.user_id = V).
--   2. Attacker A, SIGNED OUT, calls book_public_appointment at that shop and
--      types V's phone. auth.uid() is null, so customer_id stays null and the
--      trigger matches R.
--   3. book_public_appointment inserts that row ALREADY status='confirmed'.
--      Naive attribution would resolve R.user_id = V and create
--      professional_follows(follower_user_id = V, source='auto') — a public
--      social action forged in V's name, by an unauthenticated caller.
--   4. When the shop completes it, V becomes a "verified client" of a barber
--      V has never met, and the shop learns V's auth.users UUID.
--
-- join_public_queue is a cheaper variant: no slot, no service, and shops
-- complete queue entries as routine work.
--
-- created_by CANNOT be used as the signal — both self-service RPCs insert
-- created_by = null explicitly (see the unchanged bodies below).
--
-- THE FIX
--
-- Record the trustworthy fact explicitly instead of inferring it. Both RPCs
-- already compute the right value and discard it: when the caller is
-- authenticated they resolve customer_id through
-- private.resolve_customer_for_user, which matches ON user_id ONLY, never on
-- a typed-in phone. booked_by_user_id preserves that distinction.
--
--   authenticated self-service booking -> booked_by_user_id = auth.uid()
--   anonymous booking                  -> NULL
--   staff-created row                  -> NULL (staff never call these RPCs)
--
-- R1's attribution triggers require booked_by_user_id IS NOT NULL *and*
-- booked_by_user_id = customers.user_id. The attacker's booking carries NULL,
-- so it attributes to nobody. Nothing is ever attributed to an account that
-- did not itself act.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It does not add `and c.user_id is null` to link_customer_from_contact_info().
-- That was considered and rejected: (a) it would not work, because that
-- function's `on conflict do nothing` is followed by an UNFILTERED re-select
-- fallback that lands straight back on the victim's row; and (b) filtering the
-- fallback too would stop legitimate anonymous re-bookings from linking to
-- their own CRM row, silently breaking get_my_appointments — a booking
-- regression, which mission §48 forbids. The root defect belongs to the lot
-- that owns that trigger; see docs/v2/DEPRECATIONS.md.
--
-- THE TWO FUNCTION BODIES BELOW ARE REPRODUCED VERBATIM from their current
-- definitions (book_public_appointment from 20260819210000_booking_auto_confirm.sql,
-- join_public_queue from 20260813160000_claim_scope_fix.sql) with exactly TWO
-- lines changed in each: the insert column list and the insert values list.
-- Signatures, parameters, return shapes, validation, claim-token issuance and
-- grants are all unchanged. Nothing about booking behaviour changes.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The provenance columns
--
-- Nullable, no default -> catalog-only change, no table rewrite, brief lock.
-- ON DELETE SET NULL: deleting an account must not delete the shop's
-- appointment history.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'booked_by_user_id'
  ) then
    alter table public.appointments
      add column booked_by_user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'queue_entries' and column_name = 'booked_by_user_id'
  ) then
    alter table public.queue_entries
      add column booked_by_user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

comment on column public.appointments.booked_by_user_id is
  'The authenticated account that ITSELF created this booking, stamped from auth.uid() inside book_public_appointment. NULL for anonymous bookings and for rows created by staff. This is the ONLY trustworthy account attribution for an appointment: customer_id is resolved from caller-typed contact details and must never be used to attribute social or verified-client facts.';

comment on column public.queue_entries.booked_by_user_id is
  'The authenticated account that ITSELF joined this queue, stamped from auth.uid() inside join_public_queue. NULL for anonymous kiosk check-in and staff-added walk-ins. Same trust rule as appointments.booked_by_user_id.';

-- A client must never be able to assert this column — that would hand the
-- attacker back exactly the forgery this migration removes. Column-level
-- REVOKE cannot subtract from a table-level grant, so the privilege is
-- revoked at table level and every other column re-granted.
-- INSERT is revoked as well as UPDATE, and that is not belt-and-braces — it
-- is the difference between the attribution guarantee holding and not.
--
-- Revoking only UPDATE leaves the column forgeable in one step, because
-- `authenticated` holds blanket table-level INSERT and appointments_insert's
-- RLS only checks org role. A shop owner could therefore:
--
--   1. insert a customers row carrying any auth.users UUID they know
--      (customers.user_id is INSERT-grantable and has no guard), then
--   2. insert an appointment with status='completed' and
--      booked_by_user_id = that victim's UUID,
--
-- and mint a verified-client relationship — or, with status='confirmed', a
-- public follow edge — in the name of a customer who never acted. Shops
-- legitimately hold their own customers' UUIDs, so the precondition is met
-- for every real customer they have.
--
-- The two self-service RPCs are unaffected: they are SECURITY DEFINER owned
-- by postgres, which is not subject to these grants.
revoke insert, update on public.appointments from authenticated, anon;
grant insert (organization_id, location_id, barber_id, chair_id, service_id,
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
grant insert (organization_id, location_id, barber_id, service_id, customer_name,
              customer_phone, status, notes, called_at, service_started_at,
              completed_at, created_by, created_at, updated_at, customer_id)
  on public.queue_entries to authenticated;
grant update (organization_id, location_id, barber_id, service_id, customer_name,
              customer_phone, status, notes, called_at, service_started_at,
              completed_at, created_by, created_at, updated_at, customer_id)
  on public.queue_entries to authenticated;

-- Attribution lookups filter on this column for a single account.
create index if not exists appointments_booked_by_user_id_idx
  on public.appointments (booked_by_user_id) where booked_by_user_id is not null;
create index if not exists queue_entries_booked_by_user_id_idx
  on public.queue_entries (booked_by_user_id) where booked_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. book_public_appointment — verbatim, +2 lines
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
-- 3. join_public_queue — verbatim, +2 lines
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
