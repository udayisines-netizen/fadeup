-- FadeUp — Wave 1, Phase 6: appointment ownership hardening
--
-- Fixes one security defect and one functional gap that share a single root
-- cause: nothing ever bound an appointment created through the public
-- booking flow to a real customer account.
--
-- 1. SECURITY — claim_customer_records(p_phone, p_email) (added earlier in
--    this same wave, 20260813120000) trusted CALLER-SUPPLIED contact info
--    as proof of ownership. Any authenticated user could call
--    claim_customer_records(null, 'victim@example.com') and, if the victim
--    had ever booked anonymously with that address and had no account yet,
--    the attacker's user_id was written onto the victim's public.customers
--    row. get_my_appointments() resolves purely through customers.user_id,
--    so the attacker then read the victim's entire appointment history
--    (shop, barber, times, notes, price) and could cancel those
--    appointments via cancel_my_appointment(). The integer return value
--    also made it an existence oracle for enumerating phones/emails.
--
--    That two-argument function is DROPPED here, not patched. Restricting
--    it to the caller's own auth.users.email would NOT be a real fix on
--    this deployment: GOTRUE_MAILER_AUTOCONFIRM is deployment-configurable
--    (infra/supabase/docker-compose.yml), so email_confirmed_at is not
--    reliable proof that the caller controls the address. An identity
--    control whose safety silently depends on an env var being in the
--    right position is not a control.
--
-- 2. FUNCTIONAL — with that function gone, the wave's core journey
--    (book -> create account -> see appointments) needs a safe mechanism.
--    The pre-existing appointments_link_customer trigger (LOT 12) does
--    already create a public.customers row from a booking's contact info
--    and stamp appointments.customer_id, so bookings are not orphaned —
--    but that row has user_id = null, and get_my_appointments resolves
--    through customers.user_id, so the booking stays invisible to the
--    customer until some mechanism attaches an ACCOUNT to it. Removing the
--    unsafe claim RPC removes the only such mechanism, so a safe one has
--    to replace it rather than the journey simply regressing.
--
-- The replacement uses only ownership facts that cannot be forged:
--
--   a. Booking WHILE SIGNED IN. book_public_appointment now resolves the
--      caller's own public.customers row for that organization, keyed on
--      (organization_id, user_id), and stamps appointments.customer_id.
--      No guessing: the caller is creating this record right now, in a
--      session they demonstrably hold. An existing unlinked CRM row is
--      NEVER adopted on the strength of a typed-in phone/email.
--
--   b. Booking ANONYMOUSLY, then creating an account. The booking returns
--      a single-use, high-entropy, time-limited claim token, shown once on
--      the success screen and carried into signup. Only the person who
--      actually made that booking ever holds it. Same sha256 pattern as
--      platform_invitations and customer_passport_shares: raw token
--      returned once, only the hash is ever stored.
--
-- This replaces "I say this email is mine" with "I hold the secret issued
-- at booking time", which is independent of any mailer configuration.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Drop the unsafe claim RPC.
-- ---------------------------------------------------------------------------

drop function if exists public.claim_customer_records(text, text);

-- ---------------------------------------------------------------------------
-- 2. Claim tokens for anonymous bookings.
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_claim_tokens (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint appointment_claim_tokens_expires_future check (expires_at > created_at)
);

comment on table public.appointment_claim_tokens is
  'Single-use, time-limited proof that the holder is the person who made a specific anonymous booking. Issued by book_public_appointment when there is no session, redeemed by redeem_appointment_claim after the customer creates an account. Only the sha256 hash is stored — the raw token exists exactly once, in the booking response.';

create index if not exists appointment_claim_tokens_appointment_id_idx
  on public.appointment_claim_tokens (appointment_id);

alter table public.appointment_claim_tokens enable row level security;
alter table public.appointment_claim_tokens force row level security;

-- No policies at all, deliberately. This table is reachable ONLY through
-- the two SECURITY DEFINER functions below. A client-chosen token_hash
-- would defeat the entire design (same reasoning as
-- customer_passport_shares), and nobody — customer or staff — has any
-- legitimate reason to read the hashes directly.

-- ---------------------------------------------------------------------------
-- 3. Shared helper: resolve the caller's own CRM row for an organization.
-- ---------------------------------------------------------------------------

create or replace function private.resolve_customer_for_user(
  p_organization_id uuid,
  p_user_id uuid,
  p_name text,
  p_phone text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  if p_user_id is null or p_organization_id is null then
    return null;
  end if;

  -- Already linked in this organization — the only lookup that is proof of
  -- anything. Never match an unlinked row on a caller-supplied phone/email:
  -- that is precisely the takeover vector this migration removes.
  select c.id into v_customer_id
    from public.customers c
    where c.organization_id = p_organization_id and c.user_id = p_user_id;
  if found then
    return v_customer_id;
  end if;

  -- Otherwise create this customer's own CRM row for the organization.
  -- on conflict do nothing covers customers_org_phone_unique /
  -- customers_org_email_unique: if a DIFFERENT, unlinked row in this org
  -- already holds that phone or email, we deliberately do NOT adopt it and
  -- do NOT fail the caller's booking — we simply leave the appointment
  -- unlinked, exactly as it behaved before this migration.
  insert into public.customers (organization_id, user_id, name, phone, email)
  values (
    p_organization_id,
    p_user_id,
    coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Customer'),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), '')
  )
  on conflict do nothing
  returning id into v_customer_id;

  return v_customer_id;
end;
$$;

comment on function private.resolve_customer_for_user(uuid, uuid, text, text, text) is
  'Returns the caller-owned public.customers row id for an organization, creating it if absent. Matches ONLY on (organization_id, user_id) — never adopts a pre-existing unlinked row based on caller-supplied contact details. Returns null rather than raising if a unique-index collision means no owned row can be created.';

revoke execute on function private.resolve_customer_for_user(uuid, uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. book_public_appointment — links the appointment when signed in,
--    issues a claim token when not.
--
--    Return shape changes (adds claim_token), so this is DROP + CREATE
--    rather than CREATE OR REPLACE — same precedent as get_public_barber
--    in 20260813110000. Every existing validation below is preserved
--    verbatim from 20260809150100; only the customer-linking block at the
--    end and the new return column are added.
-- ---------------------------------------------------------------------------

drop function if exists public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text);

create function public.book_public_appointment(
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

  -- Signed-in booker: resolve (or create) their own CRM row for this shop
  -- so the appointment is owned from the moment it exists. Anonymous
  -- booker: v_customer_id stays null and a claim token is issued below.
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, p_customer_email
    );
  end if;

  -- The appointments_barber_no_overlap / appointments_chair_no_overlap GiST
  -- exclusion constraints (LOT 8) are the final, race-free guarantee here —
  -- if two visitors request the same slot concurrently, exactly one of
  -- these inserts succeeds and the other raises, regardless of the checks
  -- above.
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
  -- the next few minutes", not to be a durable credential.
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
  'Anon-callable: the only path to create an appointment without a session. SECURITY DEFINER — fully re-validates every id against the organization resolved from the slug and re-checks the requested time against business/working hours itself, then relies on the LOT 8 GiST exclusion constraints for the final race-free conflict guarantee. Creates status=pending (a booking request), not confirmed. When the booker is authenticated, stamps appointments.customer_id with their own CRM row for that shop; when anonymous, returns a single-use 72h claim_token (hash-stored) that lets them attach the booking to an account they create afterwards.';

revoke execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. redeem_appointment_claim — the safe replacement for claim_customer_records.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_appointment_claim(p_token text)
returns table (
  claimed boolean,
  organization_name text,
  starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_token_id uuid;
  v_appointment_id uuid;
  v_appointment public.appointments;
  v_customer_id uuid;
  v_owned_customer_id uuid;
  v_row_owner uuid;
  v_organization_name text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'redeem_appointment_claim requires an authenticated session';
  end if;

  if p_token is null or btrim(p_token) = '' then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  -- Single-use and time-limited, checked in one statement so two concurrent
  -- redemptions cannot both win.
  update public.appointment_claim_tokens t
    set redeemed_at = now(), redeemed_by = v_user_id
    where t.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
      and t.redeemed_at is null
      and t.expires_at > now()
    returning t.id, t.appointment_id into v_token_id, v_appointment_id;

  if v_token_id is null then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  select * into v_appointment from public.appointments a where a.id = v_appointment_id;

  -- The pre-existing appointments_link_customer trigger (LOT 12) has
  -- already pointed this appointment at a public.customers row derived from
  -- the booking's own contact info — that row simply has user_id = null,
  -- which is exactly why the booking is invisible in the customer app. So
  -- the work here is attaching an ACCOUNT to the right CRM row, not
  -- creating one from scratch.
  select c.id into v_owned_customer_id
    from public.customers c
    where c.organization_id = v_appointment.organization_id and c.user_id = v_user_id;

  if v_owned_customer_id is not null then
    -- The caller already has their own CRM row at this shop. Point the
    -- appointment at it rather than linking a second row (which
    -- customers_org_user_unique forbids anyway).
    update public.appointments a set customer_id = v_owned_customer_id where a.id = v_appointment_id;
    v_customer_id := v_owned_customer_id;

  elsif v_appointment.customer_id is not null then
    select c.user_id into v_row_owner from public.customers c where c.id = v_appointment.customer_id;

    if v_row_owner is null then
      -- Unowned CRM row built from this very booking's contact details, and
      -- the caller holds the token proving they made that booking. This is
      -- the normal path.
      update public.customers c set user_id = v_user_id
        where c.id = v_appointment.customer_id and c.user_id is null;
      v_customer_id := v_appointment.customer_id;
    elsif v_row_owner = v_user_id then
      v_customer_id := v_appointment.customer_id;
    else
      -- Another account already owns that shop's contact record. A spent
      -- token must never take a record away from an existing owner.
      return query select false, null::text, null::timestamptz;
      return;
    end if;

  else
    v_customer_id := private.resolve_customer_for_user(
      v_appointment.organization_id, v_user_id,
      v_appointment.customer_name, v_appointment.customer_phone, v_appointment.customer_email
    );
    if v_customer_id is null then
      return query select false, null::text, null::timestamptz;
      return;
    end if;
    update public.appointments a set customer_id = v_customer_id where a.id = v_appointment_id;
  end if;

  select o.name into v_organization_name
    from public.organizations o where o.id = v_appointment.organization_id;

  return query select true, v_organization_name, v_appointment.starts_at;
end;
$$;

comment on function public.redeem_appointment_claim(text) is
  'Authenticated-only. Attaches the appointment identified by a single-use booking claim token to the caller''s account. Proof of ownership is possession of the token issued at booking time — never a caller-asserted phone/email (see this migration''s header for the takeover vector that replaced).';

revoke execute on function public.redeem_appointment_claim(text) from public, anon;
grant execute on function public.redeem_appointment_claim(text) to authenticated;
