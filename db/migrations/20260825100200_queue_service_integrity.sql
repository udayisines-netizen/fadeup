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
