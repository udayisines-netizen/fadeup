-- ============================================================================
-- FadeUp — MASTER: R1A, data integrity & security foundation
-- Generated 2026-08-25. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r1a.sh
-- Verify in sync:   scripts/generate-master-r1a.sh --check
--
-- WHAT THIS IS
--
--   R1A closes the integrity and identity defects that R1B's social layer
--   would otherwise build on top of. It adds NO social feature: no
--   professionals, no follows, no verified-client, no claim flow, no external
--   profiles. Those are R1B and are deliberately not here.
--
--   The order matters. A "verified client" badge means "this person was
--   actually served by this professional." Today that claim cannot be
--   supported, because:
--
--     * an anonymous booking could be adopted by whoever typed the victim's
--       phone number into a customer row first;
--     * any staff member could PATCH an appointment straight to `completed`,
--       with no completion time recorded at all;
--     * queue timestamps arrived from the client and were stored unchecked,
--       backwards, backdated;
--     * removing a barber row silently removed every appointment that
--       professional had ever served;
--     * a shop could repoint a customer record at a different account.
--
--   Every one of those was REPRODUCED on a disposable replay of production
--   before the corresponding migration was written. Building reputation on
--   that substrate would have made the badge a lie.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. REMOVING A BARBER IS NOW DEACTIVATION, NOT ROW REMOVAL.
--      appointments.barber_id becomes ON DELETE RESTRICT, so removing a
--      professional who has any appointment now fails loudly with 23503
--      instead of destroying revenue history. The supported path is
--      public.offboard_barber(uuid), which makes them unbookable and removes
--      them from public surfaces. THIS IS THE ONLY BEHAVIOUR CHANGE A SHOP
--      CAN NOTICE.
--
--      Account erasure stays possible: staff_profiles.user_id becomes NULLABLE
--      with ON DELETE SET NULL, so erasing an account DETACHES the person from
--      the roster record rather than cascading away the shop's business
--      records. Erasing an identity and destroying a business's history are
--      different operations, and only the first is the user's to demand.
--
--   B. APPOINTMENT STATUS NOW HAS A TRANSITION GUARD WITH NO ROLE BYPASS.
--      It is a SEPARATE trigger, not folded into
--      restrict_appointment_self_update() — that function opens by exempting
--      owner/manager/receptionist, so anything folded in would inherit the
--      exemption and leave the larger, manager-side forgery path open.
--      The legal set is docs/v2/R1A_TRANSITION_MATRIX.md, derived by reading
--      every status writer in db/migrations. Two edges would have been missed
--      by writing the guard from intuition, and breaking either would have
--      broken a live subsystem: the customer reschedule (confirmed -> pending)
--      and the bulk no-show sweep (confirmed -> no_show, no decided_at).
--
--   C. NO HISTORICAL DATA IS FABRICATED. completed_at is backfilled ONLY from
--      decided_at, and only where complete_appointment() actually wrote both.
--      It is never inferred from starts_at: a scheduled start is when an
--      appointment was DUE to begin, not evidence that it happened. Rows whose
--      completion time is genuinely unknown stay NULL, and the migration
--      RAISE NOTICEs how many. Unknown is recorded as unknown.
--
--   D. SEVERAL COLUMNS ARE NOW SERVER-OWNED, VIA A TABLE-LEVEL REVOKE.
--      A column-level REVOKE cannot subtract from a table-level grant — it is
--      a silent no-op, confirmed with has_column_privilege(). So each
--      protected column required revoking the privilege at TABLE level and
--      re-granting every other column explicitly. That is a wider blast radius
--      than it looks: it changes exactly what PostgREST may write. The
--      companion VERIFY asserts the resulting matrix column by column rather
--      than assuming it.
--
--   E. TWO RPCs ARE REPRODUCED VERBATIM WITH EXACTLY TWO LINES CHANGED EACH
--      (book_public_appointment, join_public_queue), because CREATE OR REPLACE
--      needs the whole body. The diff was checked mechanically, not by eye.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Removing a barber who has history now returns 23503. Shops that removed
--      staff that way must use offboard_barber() instead. Nothing in the
--      FadeUp web app does this today — it toggles is_bookable — but RLS, not
--      the frontend, is the boundary, and RLS permitted it.
--   2. An anonymous booking or queue join whose phone/email matches an
--      ACCOUNT-OWNED customer row is now left unlinked instead of adopting it.
--      Matching against UNOWNED rows — the walk-in recognition path — is
--      unchanged.
--   3. Illegal status transitions now raise 22023 for every caller, including
--      owner, manager and service_role.
--   4. Client-supplied queue timestamps are ignored; the server stamps them.
--      The columns stay writable, so the existing web client keeps working.
--   5. Fade Passports can no longer be removed by their owner.
--   6. professional_applications.internal_note is no longer SELECTable by
--      authenticated, and the acquisition worker can no longer read
--      email_outbox.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Creates no table, removes no table, removes no column, truncates
--     nothing.
--   * Rewrites data in exactly one place: the completed_at backfill described
--     in (C), which only ever copies decided_at.
--   * Does not touch the GiST exclusion constraints that decide booking races.
--   * Contains no R1B / social objects.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260825100000_customer_link_ownership.sql
-- ============================================================================

-- FadeUp — R1A: an anonymous booking may never adopt an owned customer record
--
-- THE VECTOR THIS CLOSES (reproduced end-to-end before this migration)
--
-- 1. Attacker signs up and books at shop S, typing the VICTIM's phone number.
--    private.resolve_customer_for_user creates a customers row owned by the
--    attacker (user_id = attacker) carrying the victim's contact details.
--    Nothing verifies that the attacker owns that phone number.
-- 2. The victim later books ANONYMOUSLY at S with their own phone.
--    link_customer_from_contact_info() matches on (organization_id, phone)
--    and attaches the victim's appointment to the ATTACKER's customer row.
-- 3. get_my_appointments() resolves through customers.user_id, so the attacker
--    reads the victim's booking — shop, barber, service, time, price — and
--    cancel_my_appointment() cancels it.
--
-- The queue variant is cheaper still: join_public_queue needs no slot, no
-- service and no barber, and get_my_queue_status then leaks the victim's live
-- queue position to the attacker.
--
-- 20260813160000_claim_scope_fix.sql closed the ADOPTION direction — a
-- signed-in attacker taking over an existing unlinked row. It never closed the
-- PRIMING direction, where the attacker plants the contact details first on a
-- row they legitimately own.
--
-- WHY ALL FOUR LOOKUPS
--
-- The function does phone-then-email, and then, if its `insert ... on conflict
-- do nothing` yields no row, repeats phone-then-email as a fallback. Filtering
-- only the first two is useless: the insert collides with
-- customers_org_phone_unique, returns nothing, and the UNFILTERED fallback
-- lands straight back on the attacker's row. There are exactly four SELECT
-- paths and all four are filtered here.
--
-- WHAT HAPPENS INSTEAD
--
-- If the only contact match is a row already owned by an account, the booking
-- or queue entry is left with customer_id NULL — safely unlinked. For an
-- anonymous appointment, book_public_appointment then issues the single-use
-- 72h claim token, and redeem_appointment_claim re-points that one appointment
-- at a CRM row the redeemer owns. That path exists precisely for this.
--
-- UX TRADE-OFF, STATED PLAINLY
--
-- A customer who already has an account but books ANONYMOUSLY with their own
-- phone is no longer auto-linked, and must redeem the claim token to see the
-- booking in their account. That is a real cost. It is the correct trade: the
-- alternative is leaving a live takeover primitive under every future feature.
-- Signed-in bookings are unaffected — book_public_appointment and
-- join_public_queue set customer_id via resolve_customer_for_user before the
-- trigger runs, and the trigger returns early when customer_id is non-null.
--
-- NOT CHANGED: waitlist. An earlier draft claimed this vector reached
-- waitlist_entries. Independent review disproved it — waitlist_entries_insert
-- requires has_org_role(owner/manager/receptionist), there is no anon policy
-- and no public RPC, so no customer or anonymous visitor can reach this
-- trigger through waitlist. The trigger still fires there for staff-created
-- rows, and the same filter applies, but no behaviour a customer can reach
-- changes.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

create or replace function public.link_customer_from_contact_info()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  -- This trigger is shared across appointments (which has customer_email)
  -- and queue_entries (which does not — walk-ins are phone-only). new.<col>
  -- is resolved against the row type of whichever table fired the trigger,
  -- so a bare `new.customer_email` reference throws "record new has no
  -- field customer_email" the moment this fires on queue_entries. Going
  -- through to_jsonb(new) sidesteps that: a missing key just yields NULL.
  v_customer_phone text := (to_jsonb(new) ->> 'customer_phone');
  v_customer_email text := (to_jsonb(new) ->> 'customer_email');
begin
  if new.customer_id is not null then
    if not exists (
      select 1 from public.customers c
      where c.id = new.customer_id and c.organization_id = new.organization_id
    ) then
      raise exception 'customer_id must belong to the same organization_id';
    end if;
    return new;
  end if;

  if v_customer_phone is null and v_customer_email is null then
    return new;
  end if;

  if v_customer_phone is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and phone = v_customer_phone
        and user_id is null
      limit 1;
  end if;

  if v_customer_id is null and v_customer_email is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
        and user_id is null
      limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (organization_id, name, phone, email)
    values (new.organization_id, new.customer_name, v_customer_phone, v_customer_email)
    on conflict do nothing
    returning id into v_customer_id;

    -- A concurrent booking may have won the customers_org_phone_unique /
    -- customers_org_email_unique race between our SELECT and INSERT above
    -- (ON CONFLICT DO NOTHING then returns no row) — re-select rather than
    -- leave this booking unlinked over a benign, expected race.
    if v_customer_id is null then
      if v_customer_phone is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and phone = v_customer_phone
            and user_id is null limit 1;
      end if;
      if v_customer_id is null and v_customer_email is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
            and user_id is null limit 1;
      end if;
    end if;
  end if;

  new.customer_id := v_customer_id;
  return new;
end;
$$;




-- ============================================================================
-- END db/migrations/20260825100000_customer_link_ownership.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100100_appointment_completion_integrity.sql
-- ============================================================================

-- FadeUp — R1A: authoritative appointment completion
-- Migration: appointments.completed_at + a transition guard with NO role bypass
--
-- TWO DEFECTS, BOTH REPRODUCED BEFORE THIS MIGRATION
--
-- 1. There is no completion timestamp. `decided_at` carries three different
--    meanings — a request was accepted, a booking was cancelled, a service was
--    completed — and `book_public_appointment` deliberately leaves it NULL for
--    auto-confirmed bookings ("nobody decided"). So "when was this served?" has
--    no trustworthy answer.
--
-- 2. Status transitions are unguarded. Proven on a disposable replay: the
--    assigned barber issued a bare `UPDATE appointments SET status='completed'`
--    on a PENDING row and it succeeded, with `decided_at` left NULL — worse
--    evidence than the RPC path produces. complete_appointment() enforces
--    `confirmed -> completed`, but nothing forces anyone to call it.
--
-- WHY A SEPARATE TRIGGER, AND WHY THIS IS THE WHOLE POINT
--
-- restrict_appointment_self_update() looks like the natural home for this. It
-- is not. That function OPENS by exempting owner/manager/receptionist, so
-- anything folded into it inherits that exemption and the manager-side forgery
-- path — the larger one, since managers can PATCH any status on any row —
-- stays wide open. The guard below is a separate trigger with no role bypass.
--
-- AUTHORIZATION vs INVARIANT
--
-- Different questions; this file answers only the second. RLS decides WHO MAY
-- ACT on a row. This guard decides WHAT STATE MAY FOLLOW WHAT. A manager may
-- cancel an appointment; nobody — manager, owner, platform admin, service_role
-- or a direct SQL session — may resurrect a completed one. So it does not
-- consult auth.uid() except for the one edge that is legitimately
-- caller-dependent.
--
-- THE LEGAL SET comes from docs/v2/R1A_TRANSITION_MATRIX.md, built by reading
-- every status writer in db/migrations. Two edges would have been missed by
-- writing this from intuition:
--
--   * confirmed -> pending, from a CUSTOMER reschedule
--     (20260819100000_booking_loop.sql: v_new_status := case when v_is_business
--     then v_appointment.status else 'pending' end).
--   * confirmed -> no_show in BULK, from apply_appointment_no_show_rule
--     (20260810100000), which is SECURITY INVOKER and sets no decided_at.
--
-- Breaking either would break reschedule or the no-show sweep.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. completed_at
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'completed_at'
  ) then
    alter table public.appointments add column completed_at timestamptz;
  end if;
end $$;

comment on column public.appointments.completed_at is
  'When the service was actually delivered. Stamped by enforce_appointment_transition() on entry to status=completed and never writable by a client. NULL on a completed row means the completion time is genuinely unknown — historically, a row completed by a raw PATCH before R1A. Unknown is recorded as unknown; it is never inferred from starts_at.';

-- ---------------------------------------------------------------------------
-- 2. Backfill — only where existing data genuinely proves completion time
--
-- complete_appointment() is the sole writer of BOTH status='completed' and
-- decided_at together, so on a completed row a non-null decided_at is a real
-- record of when a human marked it done. That value is trustworthy.
--
-- Everything else stays NULL. This migration does NOT fall back to starts_at:
-- a scheduled start is when the appointment was DUE to begin, not evidence
-- that it happened, and writing it into the column future verified-client
-- logic will read would manufacture historical evidence. The count left
-- unknown is reported, not treated as an error.
-- ---------------------------------------------------------------------------

do $$
declare
  v_filled integer;
  v_unknown integer;
begin
  update public.appointments
  set completed_at = decided_at
  where status = 'completed'
    and completed_at is null
    and decided_at is not null;
  get diagnostics v_filled = row_count;

  select count(*) into v_unknown
  from public.appointments where status = 'completed' and completed_at is null;

  raise notice 'R1A completion backfill: % rows given a completion time from decided_at; % completed rows have NO trustworthy completion time and are deliberately left NULL',
    v_filled, v_unknown;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The transition guard
--
-- BEFORE UPDATE, no role bypass. Fires for every caller including service_role
-- and direct SQL, because an impossible state transition is impossible
-- regardless of who asks.
--
-- Errors use 22023, matching the code the existing RPCs already raise for a
-- refused transition, so callers see one consistent class.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_appointment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from public.appointment_status := old.status;
  v_to   public.appointment_status := new.status;
  v_is_reschedule boolean;
begin
  -- Not a status change: this guard has no opinion. Column-level rules live in
  -- restrict_appointment_self_update, deliberately separate.
  if v_from is not distinct from v_to then
    return new;
  end if;

  -- Terminal states are business records. Nothing moves them, no role exempt.
  if v_from in ('completed', 'cancelled', 'no_show') then
    raise exception 'appointment is already % and cannot change state', v_from
      using errcode = '22023';
  end if;

  -- The one caller-dependent edge. reschedule_appointment sets this
  -- transaction-local flag for exactly its own UPDATE — the same mechanism the
  -- existing LOT 11 column guard already relies on — and a CUSTOMER move
  -- re-opens the shop's decision by returning the row to pending.
  v_is_reschedule := coalesce(current_setting('fadeup.appointment_reschedule', true), '') = 'on';

  if v_from = 'confirmed' and v_to = 'pending' then
    if not v_is_reschedule then
      raise exception 'a confirmed appointment can only return to pending through a customer reschedule'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if not (
    (v_from = 'pending'   and v_to in ('confirmed', 'cancelled'))
    or (v_from = 'confirmed' and v_to in ('completed', 'cancelled', 'no_show'))
  ) then
    raise exception 'illegal appointment transition % -> %', v_from, v_to
      using errcode = '22023';
  end if;

  -- Stamp completion here, so status and completed_at can never disagree and no
  -- caller supplies a completion time of their choosing. A pre-existing value
  -- is preserved so a re-run cannot rewrite history.
  if v_to = 'completed' then
    new.completed_at := coalesce(old.completed_at, now());
  end if;

  return new;
end;
$$;

comment on function public.enforce_appointment_transition() is
  'BEFORE UPDATE invariant on appointments.status. Enforces the transition matrix in docs/v2/R1A_TRANSITION_MATRIX.md for EVERY caller, with no role exemption — deliberately NOT part of restrict_appointment_self_update(), which exempts owner/manager/receptionist and would have passed that exemption on. Also stamps completed_at, so completion time is server-authoritative.';

-- Named appointments_enforce_* so it sorts before appointments_restrict_*
-- ('e' < 'r'): the invariant is checked before column-level rules, so an
-- impossible transition is refused regardless of which columns moved.
drop trigger if exists appointments_enforce_transition on public.appointments;
create trigger appointments_enforce_transition
  before update on public.appointments
  for each row execute function public.enforce_appointment_transition();

-- ---------------------------------------------------------------------------
-- 4. completed_at is server-owned
--
-- A column-level REVOKE cannot subtract from a table-level grant, so the
-- privilege is revoked at table level and every other column re-granted.
-- ---------------------------------------------------------------------------

revoke update on public.appointments from authenticated, anon;
grant update (organization_id, location_id, barber_id, chair_id, service_id,
              customer_name, customer_phone, customer_email, starts_at, ends_at,
              buffer_before_minutes, buffer_after_minutes, status, notes,
              created_by, created_at, updated_at, customer_id, expires_at,
              resolution, resolution_note, decided_at, decided_by, rescheduled_to)
  on public.appointments to authenticated;


-- ============================================================================
-- END db/migrations/20260825100100_appointment_completion_integrity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100200_queue_service_integrity.sql
-- ============================================================================

-- FadeUp — R1A: the queue records what happened, not what a client claimed
--
-- REPRODUCED BEFORE THIS MIGRATION, as the assigned barber, in ONE statement:
--
--   update queue_entries set status='completed',
--     called_at          = now() - interval '10 days',
--     service_started_at = now() - interval '10 days 5 minutes',
--     completed_at       = now() - interval '10 days 20 minutes'
--   where id = ...;                                     -- accepted, no error
--
-- The service completed BEFORE it started BEFORE it was called, ten days in
-- the past. `customer_id` can be repointed in the same statement. Nothing in
-- the schema objected: restrict_queue_entry_self_update() explicitly permits
-- "status, timestamps and notes", and check_queue_entry_consistency() only
-- validates org scoping. The timestamps are written by the browser —
-- apps/web/src/lib/queries/queue.ts:183-206 maps each status to a column and
-- PATCHes both.
--
-- Unconstrained in value, in ordering AND in attribution. That is a
-- general-purpose evidence-forgery primitive, and any future claim that a
-- customer was served rests on it.
--
-- WHAT CHANGES
--
-- The server stamps the lifecycle timestamps on the state change and
-- OVERWRITES whatever the client sent. The columns stay writable so the
-- existing frontend keeps working unmodified — the value is simply no longer
-- trusted. A monotonicity CHECK makes causally impossible orderings
-- unrepresentable, and customer_id freezes once the entry leaves `waiting`,
-- because after that point the row is evidence about a specific person.
--
-- The transition rule is deliberately permissive FORWARD (waiting -> called ->
-- in_service -> completed, skipping allowed) so no current queue UX breaks,
-- and strict BACKWARD: a terminal entry never re-opens.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

create or replace function private.queue_stage(p public.queue_status)
returns integer language sql immutable set search_path = '' as $$
  select case p when 'waiting' then 0 when 'called' then 1
                when 'in_service' then 2 when 'completed' then 3 else 9 end;
$$;

create or replace function public.enforce_queue_transition()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_from public.queue_status := old.status;
  v_to   public.queue_status := new.status;
begin
  -- customer_id is evidence once the entry has been called. Frozen for every
  -- caller; a mis-assigned walk-in is corrected while still `waiting`.
  if old.status <> 'waiting' and new.customer_id is distinct from old.customer_id then
    raise exception 'queue_entries.customer_id cannot be reassigned after the entry has been called'
      using errcode = '22023';
  end if;

  if v_from is not distinct from v_to then
    return new;
  end if;

  if v_from in ('completed', 'cancelled', 'no_show') then
    raise exception 'queue entry is already % and cannot change state', v_from
      using errcode = '22023';
  end if;

  if v_to in ('cancelled', 'no_show') then
    return new;                       -- abandoning is always allowed
  end if;

  if private.queue_stage(v_to) <= private.queue_stage(v_from) then
    raise exception 'illegal queue transition % -> %', v_from, v_to
      using errcode = '22023';
  end if;

  -- Server-authoritative. coalesce(old, now()) so a re-run cannot rewrite a
  -- stamp that already exists, and any client-supplied value is discarded.
  if v_to = 'called'     then new.called_at          := coalesce(old.called_at, now()); end if;
  if v_to = 'in_service' then new.service_started_at := coalesce(old.service_started_at, now());
                              new.called_at          := coalesce(old.called_at, now()); end if;
  if v_to = 'completed'  then new.completed_at       := coalesce(old.completed_at, now());
                              new.service_started_at := coalesce(old.service_started_at, now());
                              new.called_at          := coalesce(old.called_at, now()); end if;
  return new;
end;
$$;

comment on function public.enforce_queue_transition() is
  'BEFORE UPDATE invariant on queue_entries. Stamps the lifecycle timestamps server-side, discarding client-supplied values; forbids backward and terminal-exit transitions; freezes customer_id once the entry has been called. No role exemption — an impossible transition is impossible for every caller.';

drop trigger if exists queue_entries_enforce_transition on public.queue_entries;
create trigger queue_entries_enforce_transition
  before update on public.queue_entries
  for each row execute function public.enforce_queue_transition();

-- Causally impossible orderings become unrepresentable. Added NOT VALID: a
-- database that already contains forged rows must not fail the migration.
-- Validation is attempted and reported, never forced.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'queue_entries_timestamps_monotonic') then
    alter table public.queue_entries
      add constraint queue_entries_timestamps_monotonic check (
        (called_at is null or called_at >= created_at)
        and (service_started_at is null or called_at is null or service_started_at >= called_at)
        and (completed_at is null or service_started_at is null or completed_at >= service_started_at)
      ) not valid;
  end if;
end $$;

do $$
begin
  alter table public.queue_entries validate constraint queue_entries_timestamps_monotonic;
  raise notice 'R1A queue: monotonicity constraint validated against existing rows';
exception when check_violation then
  raise notice 'R1A queue: monotonicity constraint left NOT VALID - existing rows violate it (pre-R1A forged or malformed timestamps). New and updated rows are still enforced. Clean the data, then VALIDATE separately.';
end $$;


-- ============================================================================
-- END db/migrations/20260825100200_queue_service_integrity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100300_appointment_history_durability.sql
-- ============================================================================

-- FadeUp — R1A: a completed service survives the roster
--
-- REPRODUCED BEFORE THIS MIGRATION: authenticated as the organization OWNER,
-- `DELETE FROM public.barbers WHERE id = ...` — the exact statement PostgREST
-- issues for `DELETE /rest/v1/barbers?id=eq...` — took the appointment count
-- for that professional from 1 to 0. `barbers_delete` grants this to
-- owner/manager with no further guard.
--
-- This is not a hypothetical about a future UI button. The frontend never
-- deletes a barbers row (apps/web/src/lib/queries/barbers.ts does INSERT and
-- UPDATE only, toggling is_bookable to remove someone from the roster) — but
-- in a PostgREST system the frontend is not the security boundary. RLS is, and
-- RLS permits it today.
--
-- There are TWO cascade paths into appointments, and closing only one is
-- pointless:
--     barbers                      -> appointments  (ON DELETE CASCADE)
--     auth.users -> staff_profiles -> barbers -> appointments
--
-- WHAT CHANGES, AND THE DEAD END IT MUST NOT CREATE
--
-- 1. appointments.barber_id becomes ON DELETE RESTRICT. Deleting a barber who
--    has any appointment now fails loudly with 23503 instead of silently
--    destroying revenue history.
--
-- 2. That alone would make account deletion impossible forever: erasing an
--    auth.users row cascades to staff_profiles, to barbers, and would then be
--    blocked by the new RESTRICT. Erasure would dead-end on a foreign key
--    error with no supported path. So staff_profiles.user_id becomes NULLABLE
--    with ON DELETE SET NULL.
--
--    Deleting an account therefore DETACHES the person from the roster record
--    and leaves the service history standing, rather than deleting business
--    records. The staff row survives as an unowned tombstone: RLS predicates
--    all compare user_id to auth.uid(), and NULL matches nobody, so a detached
--    profile grants no access to anyone.
--
--    This is the correct separation. Authentication erasure and destruction of
--    a shop's business records are different operations, and only the first is
--    the user's to demand.
--
-- 3. Routine offboarding is not deletion and never was. offboard_barber()
--    below makes the existing convention explicit and callable.
--
-- OPERATIONAL CONSEQUENCE: a shop that previously "removed" a barber by
-- deleting the row must now deactivate instead. That is the intended
-- behaviour change and the only one in this migration.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Detachable staff identity
--    Must come first, or step 2 creates the account-deletion dead end.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_profiles'
      and column_name = 'user_id' and is_nullable = 'NO'
  ) then
    alter table public.staff_profiles alter column user_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'staff_profiles_user_id_fkey' and confdeltype = 'c'
  ) then
    alter table public.staff_profiles drop constraint staff_profiles_user_id_fkey;
    alter table public.staff_profiles
      add constraint staff_profiles_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end $$;

comment on column public.staff_profiles.user_id is
  'The account behind this roster record. NULLABLE and ON DELETE SET NULL: erasing an account detaches the person and leaves the shop''s service history intact, rather than cascading it away. A NULL user_id is a tombstone — every RLS predicate compares it to auth.uid(), which NULL never matches.';

-- ---------------------------------------------------------------------------
-- 2. The service record is protected
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_barber_id_fkey' and confdeltype = 'c'
  ) then
    alter table public.appointments drop constraint appointments_barber_id_fkey;
    alter table public.appointments
      add constraint appointments_barber_id_fkey
      foreign key (barber_id) references public.barbers (id)
      on delete restrict
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_barber_id_fkey' and not convalidated
  ) then
    alter table public.appointments validate constraint appointments_barber_id_fkey;
  end if;
end $$;

-- Configuration children keep CASCADE deliberately: working hours, service
-- eligibility and time blocks describe a barber's CURRENT setup, not what
-- happened. Only the service record is history.
--
-- queue_entries.barber_id is already ON DELETE SET NULL and is left alone —
-- queue history already survives, losing attribution, which is honest.

-- ---------------------------------------------------------------------------
-- 3. The supported offboarding path
-- ---------------------------------------------------------------------------

create or replace function public.offboard_barber(p_barber_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_sp uuid;
begin
  select organization_id, staff_profile_id into v_org, v_sp
  from public.barbers where id = p_barber_id;

  if v_org is null then
    raise exception 'barber not found' using errcode = '42704';
  end if;

  if not (select private.has_org_role(v_org, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to manage this roster' using errcode = '42501';
  end if;

  update public.barbers set is_bookable = false where id = p_barber_id;
  update public.staff_profiles set is_active = false, is_public = false where id = v_sp;
end;
$$;

comment on function public.offboard_barber(uuid) is
  'Owner/manager only. The supported way to remove a professional from a roster: makes them unbookable and removes them from public surfaces, while leaving their appointment history intact. Deleting the barbers row is no longer possible once history exists (ON DELETE RESTRICT) and was never the intended path.';

revoke execute on function public.offboard_barber(uuid) from public, anon;
grant execute on function public.offboard_barber(uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260825100300_appointment_history_durability.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100400_attribution_provenance.sql
-- ============================================================================

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


-- ============================================================================
-- END db/migrations/20260825100400_attribution_provenance.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100500_customer_identity_binding.sql
-- ============================================================================

-- FadeUp — R1A: a shop cannot decide which account a customer record belongs to
--
-- REPRODUCED BEFORE THIS MIGRATION: as the organization OWNER,
-- `UPDATE customers SET user_id = '<any auth.users id>'` succeeded outright.
-- customers_update's WITH CHECK constrains organization_id and nothing else,
-- and no trigger freezes the column. Cross-tenant ROW relocation is correctly
-- blocked; cross-tenant IDENTITY assertion was not.
--
-- Blast radius today is one shop's own records, which is why this was first
-- filed as MEDIUM. It is HIGH because of what it composes with: chained with
-- contact squatting and completion forgery it gave a single dishonest manager
-- a low-effort path to a complete, internally consistent "this named person
-- was our customer and we served them" record about someone who never was.
--
-- customers.user_id is written legitimately in exactly one place —
-- private.resolve_customer_for_user, which INSERTs a row for the caller keyed
-- on (organization_id, user_id) — and deliberately never re-pointed: the
-- claim-token redemption path was narrowed in 20260813160000 specifically so
-- that it "never mutates customers.user_id on a row it did not create".
--
-- So there is no legitimate client UPDATE of this column, and it is frozen for
-- every ordinary session. Server-side paths (auth.uid() null) and platform
-- admins are still permitted, matching guard_professional_application_update.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

create or replace function public.guard_customers_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  raise exception 'customers.user_id identifies the account that owns this record and cannot be reassigned by a shop'
    using errcode = '42501';
end;
$$;

comment on function public.guard_customers_identity() is
  'BEFORE UPDATE on customers: freezes user_id against client sessions. The column is set once, by private.resolve_customer_for_user, for the account that is actually acting; nothing else may re-point it. Server-side paths and platform admins pass, matching the existing application-guard convention.';

drop trigger if exists customers_guard_identity on public.customers;
create trigger customers_guard_identity
  before update on public.customers
  for each row execute function public.guard_customers_identity();


-- ============================================================================
-- END db/migrations/20260825100500_customer_identity_binding.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100600_integrity_indexes.sql
-- ============================================================================

-- FadeUp — R1A: the two indexes today's queries actually need
--
-- Only indexes justified by a query that exists or by a foreign-key action
-- introduced in R1A. No speculative social indexes: the tables they would
-- serve do not exist, and an index without a query is a write-path cost.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- 1. "Which shops does this person work at?"
--
-- staff_profiles has indexes on organization_id and location_id, and a unique
-- on (organization_id, user_id) whose LEADING column is organization_id — so a
-- predicate on user_id alone cannot use it. Confirmed by EXPLAIN: Seq Scan.
-- That is the foundational cross-organization identity lookup, and it is also
-- what private.is_own_barber and get_my_access resolve through.
create index if not exists staff_profiles_user_id_idx
  on public.staff_profiles (user_id) where user_id is not null;

-- 2. "Which customers has this professional served?"
--
-- The only usable index today is (barber_id, starts_at): it is not selective
-- on status and does not carry customer_id, so every candidate row is a heap
-- fetch. This is the hot path for any client list or reputation surface.
--
-- Partial on the terminal state, so it stays small and is not disturbed by the
-- churn of pending/confirmed rows.
create index if not exists appointments_barber_customer_completed_idx
  on public.appointments (barber_id, customer_id)
  where status = 'completed';


-- ============================================================================
-- END db/migrations/20260825100600_integrity_indexes.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100800_passport_persistence.sql
-- ============================================================================

-- FadeUp — R1A: a Fade Passport cannot be made to not exist
--
-- PRODUCT_CONSTITUTION §2.2: "Every registered customer owns exactly one Fade
-- Passport... It is not something a customer creates, opts into, or can be
-- missing."
--
-- customer_passports_delete currently lets the customer delete their own
-- Passport row. Nothing reissues it — so the invariant is violable today by a
-- single DELETE, and would stay violable after R1B adds automatic issuance,
-- because that trigger fires on customer_profiles INSERT, which has already
-- happened by then.
--
-- The DELETE policy is removed. Nothing else changes: the customer keeps full
-- SELECT/INSERT/UPDATE on their own Passport, so they can still clear every
-- field. What they cannot do is destroy the row that the product guarantees
-- exists.
--
-- Erasure is unaffected: customer_passports.user_id references auth.users ON
-- DELETE CASCADE, so deleting the account still removes the Passport with it.
-- This closes the "delete it while keeping the account" path, not erasure.
--
-- NOT DONE HERE: automatic issuance, passport_number, issued_at. Those are
-- R1B — this migration only stops the invariant being broken in the meantime.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

drop policy if exists customer_passports_delete on public.customer_passports;

revoke delete on public.customer_passports from authenticated, anon;

comment on table public.customer_passports is
  'The customer-owned, portable Fade Passport. One row per auth.users account. No field here is ever shop/staff-internal data — customer-visible by construction, not by a later filter. The row itself cannot be deleted by the customer (PRODUCT_CONSTITUTION 2.2: a Passport can never be missing); it is removed only when the account itself is erased, by cascade.';


-- ============================================================================
-- END db/migrations/20260825100800_passport_persistence.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260825100900_internal_least_privilege.sql
-- ============================================================================

-- FadeUp — R1A: three over-grants of internal data
--
-- 1. THE COLD-OUTREACH WORKER CAN READ EVERY TENANT'S TRANSACTIONAL EMAIL
--
--    20260813170000_professional_applications.sql grants prospect_worker
--    SELECT on email_outbox with a `using (true)` policy. email_outbox has no
--    organization_id and no anchor of any kind, and private.emit_booking_
--    notification writes recipient address plus a payload carrying customer
--    name, organization name, service and appointment time — for every
--    booking, in every tenant.
--
--    The grant is not merely broad, it is unnecessary: private.claim_next_email
--    is SECURITY DEFINER and `returns setof public.email_outbox`, so the worker
--    already receives exactly the rows it claimed. Nothing breaks when the
--    standing grant is removed.
--
--    Mitigating, and why this is HIGH rather than CRITICAL: `authenticator` is
--    not a member of prospect_worker, so no JWT can reach it. The exposure
--    requires compromise of the worker's own credential — and the worker's job
--    is fetching and parsing third-party scraped content, which is a materially
--    higher-risk surface than the customer API.
--
-- 2. AN APPLICANT CAN READ THE INTERNAL NOTE WRITTEN ABOUT THEM
--
--    professional_applications.internal_note is documented "Platform-only.
--    Never returned by any applicant-facing read path", and
--    get_my_professional_application does omit it. But the SELECT policy is
--    row-level (`user_id = auth.uid() or is_platform_admin()`) and
--    `authenticated` holds table-wide SELECT, so one
--    `.select('internal_note')` returns it.
--
--    The existing column-guard convention (`is distinct from` triggers) covers
--    UPDATE and has no SELECT analogue. The only mechanism that protects a
--    column against SELECT is a table-level revoke plus a selective re-grant —
--    verified to work here, contrary to an earlier reading that table-level
--    grants make column ACLs impossible. They do, which is exactly why the
--    table-level grant must go first.
--
-- 3. A PROSPECT EXISTENCE ORACLE
--
--    prospect_effective_locale(uuid) is SECURITY DEFINER, granted to
--    authenticated, and has no role check — any signed-in user can confirm
--    whether a UUID is a real prospect and read its locale. No PII, no
--    mutation, so LOW; it is fixed here because it costs one line and it is
--    the only genuine instance of the pattern an earlier audit wrongly
--    attributed to several other acquisition RPCs, all of which do re-derive
--    is_platform_admin() in-body.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- 1 -------------------------------------------------------------------------
drop policy if exists email_outbox_worker_select on public.email_outbox;
revoke select on public.email_outbox from prospect_worker;

-- 2 -------------------------------------------------------------------------
revoke select on public.professional_applications from authenticated, anon;
grant select (id, user_id, first_name, last_name, email, phone, business_name,
              professional_type, city, address_line1, postal_code, country,
              staff_count, website, instagram, business_identifier, status,
              submitted_at, reviewed_at, reviewed_by, rejection_reason,
              organization_id, created_at, updated_at)
  on public.professional_applications to authenticated;

comment on column public.professional_applications.internal_note is
  'Platform-only reviewer note. Withheld from `authenticated` by column grant, not merely omitted from an RPC: the SELECT policy is row-level and the applicant''s own row matches it, so without the grant restriction a single .select(''internal_note'') returned the reviewer''s private assessment to its subject. Platform staff read it through their own path.';

-- 3 -------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prospect_effective_locale'
  ) then
    execute 'revoke execute on function public.prospect_effective_locale(uuid) from authenticated';
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260825100900_internal_least_privilege.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next step: run
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows.
-- ============================================================================
