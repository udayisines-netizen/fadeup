-- ============================================================================
-- FadeUp — MASTER: LOT E, booking auto-confirm + currency exposure
-- Generated 2026-08-19. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-lot-e.sh
-- Verify in sync:   scripts/generate-master-lot-e.sh --check
--
-- WHAT THIS IS
--
--   TWO changes, both small, both consequential.
--
--   1. A NORMAL BOOKING IS NOW CONFIRMED IMMEDIATELY.
--
--      LOT C built a request/approval loop because slots were being held by
--      rows nobody could answer. That fixed the bug and also made every
--      ordinary booking wait for a human. But the business already answered:
--      opening hours, working hours, split shifts, blocked time, services,
--      durations, buffers and eligibility ARE the answer. A shop that
--      publishes 10:00 as available has said yes to 10:00.
--
--      So book_public_appointment now creates status=confirmed, and a
--      customer rescheduling into another genuinely available slot STAYS
--      confirmed instead of dropping back to pending.
--
--   2. THE BUSINESS'S CURRENCY NOW REACHES THE BROWSER.
--
--      organizations.currency has been correct since LOT B and was returned by
--      no read path at all, so the frontend carried five copies of a
--      hardcoded-USD formatter. Every service price in FadeUp rendered in
--      dollars: a Paris salon charging 25 € showed its own customers "$25.00".
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. CONCURRENCY IS UNCHANGED, because it never depended on the approval
--      step. The race is decided by the GiST exclusion constraint, whose
--      predicate covers pending and confirmed identically:
--
--          WHERE (status <> ALL (ARRAY['cancelled', 'no_show']))
--
--      Two visitors racing one slot produced exactly one appointment before
--      and produce exactly one now. The constraint is not touched.
--      scripts/lot-e-concurrency-test.sh proves this with real simultaneous
--      connections, not by reasoning.
--
--   B. HISTORICAL PENDING ROWS ARE NOT MIGRATED. They were created under a
--      promise that a human would answer; silently confirming them would give
--      customers appointments nobody agreed to. They keep their semantics and
--      the sweep keeps expiring them. `pending` remains a real, supported
--      state for legacy rows and for any future approval-required workflow.
--
--   C. RESCHEDULE GAINED A CHECK IT NEVER HAD. reschedule_appointment
--      validated no opening hours at all — survivable only because a customer
--      move became a request a human reviewed. With no human in the normal
--      path that would have allowed a booking at three in the morning, so the
--      window check moved into private.slot_is_within_hours and BOTH booking
--      and reschedule now use it.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. New public bookings appear as CONFIRMED, not in /app/requests.
--   2. The business is notified "New booking" and the customer "Booking
--      confirmed" — never a request-then-confirmation pair for one booking.
--   3. Prices render in each shop's own currency. Shops whose currency was
--      never set fall back to EUR; check organizations.currency for any shop
--      trading outside the euro area before announcing this to them.
--   4. get_my_appointments and get_calendar_appointments gain columns. Both
--      are consumed only by the FadeUp web app, which is deployed together
--      with this.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Adds no column, rewrites no data, changes no policy, drops no table.
--   * Does not touch the GiST exclusion constraints.
--   * The DROP FUNCTION statements are shape changes to four read functions,
--     each recreated immediately afterwards in the same transaction.
--   * Contains no Worker V2 objects.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260819210000_booking_auto_confirm.sql
-- ============================================================================

-- FadeUp — LOT E phase 0: a normal booking is confirmed immediately.
--
-- ============================================================================
-- THE PRODUCT DECISION
-- ============================================================================
--
--   LOT C built a request/approval loop because slots were being held by rows
--   nobody could answer. That fixed the bug, but it also made every ordinary
--   booking wait for a human.
--
--   The business has already answered. Opening hours, working hours, split
--   shifts, blocked time, services, durations, buffers and eligibility ARE the
--   answer — a shop that publishes 10:00 as available has said yes to 10:00.
--   Asking again is asking the same question twice, and the second ask is the
--   one that loses the customer.
--
--   So: a slot that survives full server-side revalidation becomes a CONFIRMED
--   appointment, immediately.
--
-- ============================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ============================================================================
--
--   1. It does not weaken a single guarantee. Every check that ran before
--      still runs, in the same order, on the same trust boundary. The only
--      change is the status the row is born with.
--
--   2. It does not migrate historical `pending` rows. Those were created under
--      a promise ("the shop will answer") and rewriting them would break that
--      promise retroactively — a customer who was told to expect a reply would
--      silently have a confirmed appointment they never agreed to. They keep
--      their semantics and the sweep keeps expiring them.
--
--   3. It does not delete the approval architecture. `pending` remains a real,
--      supported state: legacy rows live in it, and a future workflow that
--      genuinely needs approval (a first-time client, a high-value service)
--      can use it without rebuilding anything.
--
-- ============================================================================
-- WHY CONCURRENCY IS STILL SAFE
-- ============================================================================
--
--   It is safe for exactly the reason it was safe before: the race was NEVER
--   decided by the status. It is decided by the GiST exclusion constraint
--
--       EXCLUDE USING gist (barber_id WITH =, blocked_range WITH &&)
--         WHERE (status <> ALL (ARRAY['cancelled','no_show']))
--
--   which covers `pending` and `confirmed` identically. Two visitors inserting
--   the same slot concurrently produced exactly one row before and produce
--   exactly one row now; the loser gets a conflict either way. Removing a
--   human approval step does not touch that, because approval was never what
--   made it correct.
--
--   The time-block trigger (LOT D) and the hours check below both run BEFORE
--   the constraint, and neither is a substitute for it.
--
-- ============================================================================
-- THE ONE REAL GAP THIS HAD TO CLOSE
-- ============================================================================
--
--   `reschedule_appointment` never validated opening hours at all. Under LOT C
--   that was survivable: a customer move returned the row to `pending`, so a
--   human saw 03:00 and declined it. Auto-confirm removes that human, which
--   would have turned a soft gap into a booking at three in the morning.
--
--   So the window check moves into `private.slot_is_within_hours` and BOTH
--   paths use it. That is now the third caller of the same split-shift-aware
--   window maths, and the reason it is a function rather than a fourth copy.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The shared window validator
--
--    private, SECURITY INVOKER, no authorization of any kind: it answers
--    "does this range fit inside a window this professional actually works",
--    nothing more. Callers do their own identity and eligibility checks.
-- ---------------------------------------------------------------------------

create or replace function private.slot_is_within_hours(
  p_barber_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local_date date := (p_starts_at at time zone p_timezone)::date;
  v_day_of_week smallint := extract(dow from (p_starts_at at time zone p_timezone)::date);
  v_loc record;
  v_exception record;
  v_work record;
  v_has_exception boolean;
  v_has_work boolean;
  v_barber_windows tstzrange[];
  v_location_windows tstzrange[];
  v_requested tstzrange := tstzrange(p_starts_at, p_ends_at, '[)');
begin
  select lh.is_closed, lh.open_time, lh.close_time, lh.second_open_time, lh.second_close_time
    into v_loc
    from public.location_hours lh
    where lh.location_id = p_location_id and lh.day_of_week = v_day_of_week;

  if not found or v_loc.is_closed then
    return false;
  end if;

  v_location_windows := array[private.day_window(v_local_date, v_loc.open_time, v_loc.close_time, p_timezone)];
  if v_loc.second_open_time is not null then
    v_location_windows := v_location_windows
      || private.day_window(v_local_date, v_loc.second_open_time, v_loc.second_close_time, p_timezone);
  end if;

  select ex.is_unavailable, ex.start_time, ex.end_time
    into v_exception
    from public.barber_availability_exceptions ex
    where ex.barber_id = p_barber_id and ex.exception_date = v_local_date;
  v_has_exception := found;

  if v_has_exception and v_exception.is_unavailable then
    return false;
  end if;

  if v_has_exception then
    v_barber_windows := array[private.day_window(v_local_date, v_exception.start_time, v_exception.end_time, p_timezone)];
  else
    select wh.is_off, wh.start_time, wh.end_time, wh.second_start_time, wh.second_end_time
      into v_work
      from public.barber_working_hours wh
      where wh.barber_id = p_barber_id and wh.day_of_week = v_day_of_week;
    v_has_work := found;

    if not v_has_work or v_work.is_off then
      return false;
    end if;

    v_barber_windows := array[private.day_window(v_local_date, v_work.start_time, v_work.end_time, p_timezone)];
    if v_work.second_start_time is not null then
      v_barber_windows := v_barber_windows
        || private.day_window(v_local_date, v_work.second_start_time, v_work.second_end_time, p_timezone);
    end if;
  end if;

  -- Containment in ONE intersected window. An appointment starting before the
  -- lunch closure and ending after it is not "within hours" merely because
  -- both of its endpoints land in open time.
  return exists (
    select 1
    from unnest(v_barber_windows) b(w)
    cross join unnest(v_location_windows) l(w)
    where (b.w * l.w) @> v_requested
  );
end;
$$;

comment on function private.slot_is_within_hours(uuid, uuid, timestamptz, timestamptz, text) is
  'Does this exact range fit inside one window the professional actually works, at a location that is open? Split-shift aware. Pure predicate with no authorization — shared by book_public_appointment and reschedule_appointment so the two can never disagree about what "within hours" means.';

revoke execute on function private.slot_is_within_hours(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function private.slot_is_within_hours(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. book_public_appointment — the same validation, a different birth status
--
--    Rebased on the LOT D definition. Every identity check, the customer
--    linking, the claim token and the return shape are preserved exactly; the
--    inline window derivation is replaced by the shared predicate and the
--    inserted status becomes 'confirmed'.
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
    status, notes, created_by
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'confirmed', p_notes, null
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
-- 3. Notifications for a booking nobody has to answer
--
--    The old trigger fired only for `pending` and told the shop a REQUEST was
--    waiting. A confirmed booking needs the opposite shape: tell the shop
--    something is booked, and tell the customer it is confirmed — once each,
--    never a request-then-confirmation pair for the same booking.
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    -- Legacy / explicit-approval path, unchanged.
    perform private.emit_booking_notification(
      new, 'booking_request_created', 'business',
      'New booking request', new.customer_name, 'booking_request_created');
    return new;
  end if;

  if new.status = 'confirmed' then
    -- The shop learns it has a booking...
    perform private.emit_booking_notification(
      new, 'booking_confirmed', 'business',
      'New booking', new.customer_name, null, ':new');

    -- ...and the customer learns it is confirmed. Distinct dedupe suffixes so
    -- these two never collide on the unique dedupe_key, and so a later
    -- staff-side confirm_booking_request on the same appointment cannot be
    -- swallowed by this row.
    perform private.emit_booking_notification(
      new, 'booking_confirmed', 'customer',
      'Booking confirmed', new.customer_name, 'booking_confirmed', ':new');
  end if;

  return new;
end;
$$;

comment on function public.notify_new_appointment() is
  'Fires once when an appointment is created. A pending row still announces a REQUEST to the business (legacy path). A confirmed row announces a BOOKING to the business and a CONFIRMATION to the customer — never both a request and a confirmation for the same booking. Email intents go to email_outbox, so SMTP being down can never roll back a booking.';

drop trigger if exists appointments_notify_new_request on public.appointments;
drop trigger if exists appointments_notify_new on public.appointments;
create trigger appointments_notify_new
  after insert on public.appointments
  for each row execute function public.notify_new_appointment();

-- The old single-purpose function has no remaining callers.
drop function if exists public.notify_new_booking_request();

-- ---------------------------------------------------------------------------
-- 4. reschedule_appointment — a valid move stays confirmed
--
--    Under LOT C a customer move returned the row to `pending` so a human
--    could sanity-check it. With auto-confirm there is no human in the normal
--    path, so the sanity check becomes the server's job: the destination is
--    validated against real opening/working hours (and, through the LOT D
--    trigger, against blocked time) before the move is allowed.
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_barber_id uuid default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_is_business boolean;
  v_is_customer boolean;
  v_barber_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_timezone text;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  v_is_business := (select private.can_manage_appointments(v_appointment.organization_id));
  v_is_customer := v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  );

  if not (v_is_business or v_is_customer) then
    raise exception 'not authorized to reschedule this booking' using errcode = '42501';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled' using errcode = '22023';
  end if;

  if p_starts_at <= now() then
    raise exception 'the new time must be in the future' using errcode = '22023';
  end if;

  v_barber_id := coalesce(p_barber_id, v_appointment.barber_id);

  -- A different professional must still belong to this shop and still be
  -- eligible for this service. Never trusted from the caller.
  if v_barber_id <> v_appointment.barber_id then
    if not exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.barber_services bs on bs.barber_id = b.id and bs.service_id = v_appointment.service_id
      where b.id = v_barber_id
        and b.organization_id = v_appointment.organization_id
        and b.is_bookable and sp.is_active and sp.is_public
    ) then
      raise exception 'that professional is not available for this service' using errcode = '22023';
    end if;
  end if;

  -- Duration comes from the SNAPSHOT on the appointment, not from the service
  -- as it stands today: a price list edited since booking must not silently
  -- change the length of an appointment already agreed.
  v_duration := (extract(epoch from (v_appointment.ends_at - v_appointment.starts_at)) / 60)::integer;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  select l.timezone into v_timezone
    from public.locations l where l.id = v_appointment.location_id;

  -- NEW IN LOT E. Previously this relied entirely on a human seeing the new
  -- time, because a customer move became a request. Nobody sees it now, so
  -- the destination has to be genuinely bookable — not merely unoccupied.
  if not private.slot_is_within_hours(v_barber_id, v_appointment.location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours' using errcode = '22023';
  end if;

  -- The status is PRESERVED. A confirmed appointment moved to another valid
  -- slot is still a confirmed appointment: the shop said yes to the slot, and
  -- the customer has not stopped being expected.
  --
  -- Raised for exactly this UPDATE, after the checks above — it tells the LOT
  -- 11 column guard that this is the sanctioned reschedule path rather than a
  -- barber editing a time directly.
  perform set_config('fadeup.appointment_reschedule', 'on', true);

  -- One statement. The GiST exclusion constraint is the authority on whether
  -- the destination is free; if it raises, nothing here has changed and the
  -- original appointment is left exactly as it was. There is never a moment
  -- with two appointments.
  update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at,
        barber_id = v_barber_id,
        decided_at = case when v_is_business then now() else decided_at end,
        decided_by = case when v_is_business then (select auth.uid()) else decided_by end
    where id = p_appointment_id
    returning * into v_appointment;

  perform set_config('fadeup.appointment_reschedule', 'off', true);

  perform private.emit_booking_notification(
    v_appointment, 'booking_rescheduled',
    case when v_is_business then 'customer' else 'business' end,
    'Appointment moved',
    v_appointment.customer_name,
    'booking_rescheduled',
    ':' || extract(epoch from v_appointment.starts_at)::bigint::text
  );

  return v_appointment;
end;
$$;

comment on function public.reschedule_appointment(uuid, timestamptz, uuid) is
  'Moves an appointment and PRESERVES its status — a confirmed booking moved to another genuinely available slot stays confirmed, for customers as well as staff. The destination is validated against real opening/working hours (private.slot_is_within_hours), against blocked time (the LOT D trigger) and finally against the GiST exclusion constraint, which leaves the original row untouched if the destination is taken. The dedupe suffix carries the new start time so a customer moving twice is notified twice.';

revoke execute on function public.reschedule_appointment(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260819210000_booking_auto_confirm.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260819220000_currency_exposure.sql
-- ============================================================================

-- FadeUp — LOT E phase 1: make the business's currency reachable.
--
-- ============================================================================
-- THE BUG
-- ============================================================================
--
--   organizations.currency has existed since LOT B and was correct. It simply
--   never reached the browser: not one read path returned it. So the frontend
--   had five copies of
--
--       (cents / 100).toLocaleString(undefined, { style: 'currency',
--                                                 currency: 'USD' })
--
--   and every service price in FadeUp — booking flow, public profile,
--   marketplace card, service editor, customer's appointment list — rendered
--   in US dollars. A Paris salon charging 25 € showed its own customers
--   "$25.00".
--
--   This is a display bug with the shape of a trust bug: the number a customer
--   is quoted is the number they expect to pay.
--
-- ============================================================================
-- WHY THESE FOUR AND NOT THE SEARCH FUNCTIONS
-- ============================================================================
--
--   Adding a column to a `returns table` means DROP + CREATE. That is fine for
--   a ten-line function; it is a poor trade for search_public_organizations
--   and search_public_professionals, which are large, carry the marketplace's
--   geo/ranking logic, and would have to be reproduced in full here just to
--   append one column — the exact copy-paste that goes stale.
--
--   So the two search functions are left ALONE, and a small batch lookup is
--   added instead. A marketplace list resolves every visible shop's currency
--   in one extra round trip, and the ranking logic keeps exactly one
--   definition.
--
-- Additive: no column is added, no data is rewritten, no policy changes.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The public organization read
-- ---------------------------------------------------------------------------

drop function if exists public.get_public_organization(text);

create function public.get_public_organization(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  currency text,
  country_code text
)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, o.name, o.slug, coalesce(o.currency, 'EUR'), o.country_code
  from public.organizations o
  where o.slug = p_slug;
$$;

comment on function public.get_public_organization(text) is
  'Public shop header, by slug. Now carries the shop''s own currency so its prices are quoted in the money its customers will actually pay — a London salon in GBP even to a visitor browsing from Paris. FadeUp performs no conversion, so this is the ONLY currency a price may be shown in.';

revoke execute on function public.get_public_organization(text) from public;
grant execute on function public.get_public_organization(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Batch currency lookup, for lists that span shops
--
--    A marketplace page shows results from many organizations and cannot ask
--    for each one separately. Deliberately returns ONLY id and currency:
--    anything more would be a second, less-guarded copy of the public
--    organization read.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_currencies(p_organization_ids uuid[])
returns table (organization_id uuid, currency text)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, coalesce(o.currency, 'EUR')
  from public.organizations o
  where o.id = any(coalesce(p_organization_ids, array[]::uuid[]))
  -- Only shops that have chosen to be publicly listed. A private
  -- organization's existence must not be confirmable by probing this.
  and o.marketplace_visible;
$$;

comment on function public.get_public_currencies(uuid[]) is
  'Currencies for a set of publicly listed organizations, so a marketplace list can price every card correctly in one round trip. Returns nothing for an id that is not publicly visible, so it cannot be used to probe for private organizations.';

revoke execute on function public.get_public_currencies(uuid[]) from public;
grant execute on function public.get_public_currencies(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The customer's own appointments
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_appointments();

create function public.get_my_appointments()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  price_cents integer,
  currency text,
  location_timezone text,
  resolution public.appointment_resolution,
  resolution_note text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.organization_id, o.name, o.slug, a.location_id, l.name,
    a.barber_id, sp.display_name, a.service_id, s.name,
    a.starts_at, a.ends_at, a.status, s.price_cents,
    coalesce(o.currency, 'EUR'),
    -- The shop's timezone travels with the appointment: a customer abroad must
    -- still read the time the salon means, not the one their phone assumes.
    l.timezone,
    a.resolution, a.resolution_note, a.expires_at, a.created_at
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  )
  order by a.starts_at desc;
$$;

comment on function public.get_my_appointments() is
  'A signed-in customer''s own appointments across every shop they use. Now carries each shop''s currency AND its location timezone, because a customer''s list genuinely spans businesses in different countries and both were previously assumed from the device.';

revoke execute on function public.get_my_appointments() from public, anon;
grant execute on function public.get_my_appointments() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The professional calendar read
-- ---------------------------------------------------------------------------

drop function if exists public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid);

create function public.get_calendar_appointments(
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
  currency text,
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
    a.service_id, s.name, s.price_cents, coalesce(o.currency, 'EUR'),
    a.customer_name, a.customer_phone, a.notes, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  join public.organizations o on o.id = a.organization_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_barber_id is null or a.barber_id = p_barber_id)
    -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
    and ((select private.is_org_member(p_organization_id)) or (select private.is_platform_admin()))
  order by a.starts_at;
$$;

comment on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Range-bounded, pre-joined calendar read. Returns nothing — rather than raising — for a non-member, so it is safe to call from a shared layout. Carries the organization''s currency so a group operating in several countries prices each shop''s calendar correctly. Still deliberately omits customer_email and customer_id.';

revoke execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260819220000_currency_exposure.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next step: run
--   supabase/VERIFY_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
-- and confirm 0 unexpected FAIL rows (expected: 59 PASS / 0 FAIL / 6 INFO).
-- ============================================================================
