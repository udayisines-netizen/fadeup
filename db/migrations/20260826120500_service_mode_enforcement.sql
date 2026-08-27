-- FadeUp — SERVICE MODE: enforcement, where a browser cannot reach
--
-- WHAT WAS ACTUALLY POSSIBLE BEFORE THIS FILE
--
-- Two things, both proven by reading the schema rather than assumed.
--
-- 1. SERVICE MODE HAD NO ENFORCEMENT AT ALL, because it did not exist. Hiding
--    the Book button would have been the entire mechanism.
--
-- 2. THE R2 ENTITLEMENT GATE WAS NEVER HUNG ON A DOOR. R2 built
--    private.org_has_capability and private.assert_org_capability and wired
--    them into capacity triggers and the plan-assignment RPC — but NOT into
--    booking or queue admission. Searching the whole of db/migrations for a
--    caller finds only R2's own assertion lists. So the commercial rule
--    "Free is presence, not an operating system" was, on these two paths,
--    enforced by nothing.
--
--    That is not currently exploitable in production data — the R2 backfill
--    (20260826110200) only assigns `free` to an organization with zero active
--    locations AND zero active professionals, and both admission paths require
--    a valid active location, so no operating shop is on `free` today. But
--    nothing prevented one from being put there, and §16 is explicit that a
--    known entitlement bypass gets wired up in this lot. It is wired here,
--    using R2's existing helper, with no new commercial logic of any kind.
--
-- WHY A TRIGGER, AND WHY BEFORE INSERT
--
-- There are four ways to create an appointment and three to create a queue
-- entry, found by searching every migration rather than by trusting the
-- application:
--
--   book_public_appointment      SECURITY DEFINER, granted to anon
--   join_public_queue            SECURITY DEFINER, granted to anon
--   direct PostgREST INSERT      authenticated, column grant + RLS org role
--   service_role / postgres      BYPASSRLS
--
-- A check inside the two RPCs would cover two of them. An RLS `with check`
-- would cover three and evaporate for exactly the privileged writers §34 says
-- must not be exempt. A BEFORE INSERT trigger fires for every one, including
-- psql, and that is what "the database enforces it" has to mean.
--
-- Centralised, not duplicated: both triggers call the same
-- private.*_admission_allowed composers from 20260826120300, so the booking
-- path and the queue path cannot drift into subtly different ideas of what is
-- allowed. Duplicating the checks is how one path ends up decorative.
--
-- INSERT ONLY. THIS IS THE WHOLE POINT.
--
-- The trigger fires on INSERT and on nothing else. Service mode governs NEW
-- ADMISSIONS; it says nothing whatever about commitments that already exist.
-- Concretely, all of the following keep working in every mode, including
-- `unavailable`:
--
--   * checking in, starting, completing, cancelling or no-showing an existing
--     appointment — the whole R1A lifecycle
--   * calling, serving and completing everyone already in the queue
--   * reschedule_appointment, which UPDATEs the existing row rather than
--     inserting a replacement (verified: 20260819210000 preserves the row and
--     its status), so it never reaches this trigger and needs no exemption —
--     and therefore no caller-controlled skip flag has to exist
--
-- A shop that switches to reservation_only with three people waiting still has
-- three people waiting, and still serves them. It simply admits no fourth.
--
-- NO BYPASS
--
-- There is no GUC, no session variable, no parameter and no role exemption.
-- A restore that must reinstate rows an establishment's current mode would
-- refuse is `pg_restore --disable-triggers`: explicit, loud, and auditable —
-- which a magic setting some future RPC learns to set would not be.
--
-- THE LOCK, AND WHY IT IS SHARED
--
-- The guard takes FOR SHARE on the establishment's location_service_settings
-- row. The controls in 20260826120400 take FOR UPDATE on the same row.
--
--   * Many admissions proceed concurrently — they only conflict with a writer,
--     not with each other. An exclusive lock here would serialise every walk-in
--     at a busy shop behind every other one, for no correctness gain.
--   * A mode change waits for in-flight admissions, then blocks new ones until
--     it commits.
--   * An admission that arrives mid-change waits, and — this is the part that
--     matters — under READ COMMITTED a blocked row lock re-reads the row as of
--     the moment it is granted. So the loser sees the NEW mode, never the stale
--     one it queued behind. There is no window in which a mode change commits
--     and an admission computed against the old mode commits after it.
--   * No transaction here upgrades a share lock to exclusive, so the two lock
--     modes cannot form a deadlock cycle.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Booking admission
-- ---------------------------------------------------------------------------

create or replace function public.enforce_booking_service_mode()
returns trigger
language plpgsql
-- SECURITY DEFINER: the composers read organization_commercial_state, on which
-- every client role has had its privileges revoked and which has FORCE RLS. The
-- definer (postgres) can read it; the anonymous customer booking a haircut
-- cannot, and must not need to. search_path is pinned and every name is
-- schema-qualified, so a caller cannot substitute their own tables.
security definer
set search_path = ''
as $$
declare
  v_mode public.service_mode;
  v_source text;
begin
  perform private.ensure_location_service_settings(new.location_id);

  -- THE LOCK. Shared, taken before the mode is read, released at commit.
  perform 1
  from public.location_service_settings s
  where s.location_id = new.location_id
  for share;

  -- The commercial question first, and through R2's own helper — this file
  -- adds no commercial logic and knows no plan names.
  perform private.assert_org_capability(new.organization_id, 'booking');

  select m.mode, m.source into v_mode, v_source
  from private.effective_service_mode(new.location_id, new.barber_id) m;

  if v_mode is null or not private.mode_allows_booking(v_mode) then
    -- The message names the mode and where it came from, so a professional who
    -- has forgotten they set a one-hour override an hour ago is told exactly
    -- that, rather than being handed a generic refusal. It deliberately carries
    -- no organization or location id: error strings end up in logs a wider
    -- audience reads.
    raise exception 'new reservations are not being accepted (service mode: %)',
      coalesce(v_mode::text, 'unknown')
      using errcode = '42501',
            hint = format(
              'The effective service mode comes from %s. Existing appointments are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  return new;
end;
$$;

comment on function public.enforce_booking_service_mode() is
  'BEFORE INSERT on appointments: the ONE place a new reservation is admitted or refused. Fires for every writer — the anon RPC, a direct PostgREST insert by staff, service_role and postgres alike — because RLS would exempt the privileged ones. Composes the R2 booking entitlement with the effective service mode; adds no commercial logic of its own. INSERT only, deliberately: every existing appointment keeps its full R1A lifecycle in every mode, and reschedule_appointment UPDATEs rather than inserting, so it neither reaches this trigger nor needs a bypass flag.';

drop trigger if exists appointments_enforce_service_mode on public.appointments;
create trigger appointments_enforce_service_mode
  before insert on public.appointments
  for each row execute function public.enforce_booking_service_mode();

-- ---------------------------------------------------------------------------
-- 2. Queue admission
--
-- Three independent facts, all of which must hold, and each of which is
-- reported distinctly when it is the one that failed. A shop told "walk-ins are
-- closed" when the real reason is that the queue is paused for ten minutes will
-- go looking in the wrong settings screen.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_queue_service_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode public.service_mode;
  v_source text;
  v_queue_open boolean;
begin
  perform private.ensure_location_service_settings(new.location_id);

  select s.queue_open into v_queue_open
  from public.location_service_settings s
  where s.location_id = new.location_id
  for share;

  -- walkIns OR liveQueue — see 20260826120300 for why this is a disjunction:
  -- R2 sells salon_essential walkIns without liveQueue, and demanding liveQueue
  -- would withdraw a channel that plan pays for, which would be a pricing
  -- change this lot is forbidden to make.
  if not (
    private.org_has_capability(new.organization_id, 'walkIns')
    or private.org_has_capability(new.organization_id, 'liveQueue')
  ) then
    -- Raised through R2's own assert so the message and SQLSTATE match every
    -- other entitlement refusal in the product.
    perform private.assert_org_capability(new.organization_id, 'liveQueue');
  end if;

  select m.mode, m.source into v_mode, v_source
  from private.effective_service_mode(new.location_id, new.barber_id) m;

  if v_mode is null or not private.mode_allows_queue(v_mode) then
    raise exception 'new queue entries are not being accepted (service mode: %)',
      coalesce(v_mode::text, 'unknown')
      using errcode = '42501',
            hint = format(
              'The effective service mode comes from %s. Customers already in the queue are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  -- Reported separately from the mode, because it is a separate fact with a
  -- separate control and a separate fix. Service mode never replaces
  -- queue_open, and this is where that distinction becomes visible to a human.
  if not coalesce(v_queue_open, false) then
    raise exception 'the live queue is currently closed to new entries'
      using errcode = '42501',
            hint = 'Reopen the queue to admit new walk-ins. This is separate from the service mode, and customers already waiting are unaffected.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_queue_service_mode() is
  'BEFORE INSERT on queue_entries: the ONE place a new walk-in is admitted or refused. Fires for every writer including service_role and postgres. Requires all three independent facts — the R2 walk-in/queue entitlement, a mode that allows the queue, and queue_open — and reports distinctly which one failed, because each has a different control and a different fix. INSERT only: everyone already waiting keeps their full R1A lifecycle in every mode, and closing the queue never removes them.';

drop trigger if exists queue_entries_enforce_service_mode on public.queue_entries;
create trigger queue_entries_enforce_service_mode
  before insert on public.queue_entries
  for each row execute function public.enforce_queue_service_mode();

-- ---------------------------------------------------------------------------
-- 3. Trigger firing order, stated rather than left to luck
--
-- PostgreSQL fires BEFORE ROW triggers in alphabetical order by trigger name.
-- The relevant existing neighbours are:
--
--   appointments:  appointments_check_consistency, appointments_check_time_blocks,
--                  appointments_enforce_service_mode, appointments_set_blocked_range
--   queue_entries: queue_entries_check_consistency,
--                  queue_entries_enforce_service_mode
--
-- Both new triggers therefore run AFTER the tenant-consistency check, which is
-- the order we want: consistency establishes that location_id and barber_id
-- genuinely belong to organization_id, and only then does this file resolve a
-- mode from them. Resolving first would mean answering a question about a pair
-- of ids that had not yet been proven to belong together.
--
-- This is an assertion rather than a comment, so that renaming a trigger cannot
-- quietly reverse the order.
-- ---------------------------------------------------------------------------

do $$
begin
  if 'appointments_enforce_service_mode' <= 'appointments_check_consistency' then
    raise exception 'service-mode trigger would fire before the tenant-consistency check on appointments'
      using errcode = 'P0001';
  end if;
  if 'queue_entries_enforce_service_mode' <= 'queue_entries_check_consistency' then
    raise exception 'service-mode trigger would fire before the tenant-consistency check on queue_entries'
      using errcode = 'P0001';
  end if;
end $$;
