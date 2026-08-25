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
