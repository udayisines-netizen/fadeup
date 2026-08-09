-- FadeUp — LOT 11: chair mode (phase 1 — self-service status updates)
-- Migration: appointment/queue self-service by the assigned barber
--
-- LOT 8 (appointments) and LOT 10 (queue_entries) both deliberately left
-- barbers read-only, documenting "self-service status updates from the
-- chair are deferred to Chair Mode (LOT 11)." This migration is that
-- deferral being paid off — a barber may now update the STATUS (and a
-- couple of narrowly-scoped operational fields) of an appointment/queue
-- entry assigned specifically to them, and nothing else about it.
--
-- This is deliberately NOT a broad "barbers can update their own rows"
-- policy. RLS alone (USING/WITH CHECK) cannot restrict WHICH COLUMNS an
-- UPDATE touches — only whether the row as a whole is allowed. A permissive
-- RLS policy scoped to "it's my appointment" would let a barber rename the
-- customer, move the appointment to a different time, or reassign it to a
-- different barber, none of which "update my own status from the chair"
-- should allow. So this is TWO layers together: an RLS policy that decides
-- WHO (the assigned barber) may touch the row at all, plus a BEFORE UPDATE
-- trigger that decides WHICH COLUMNS a non-managing caller may actually
-- change, rejecting anything else. owner/manager/receptionist remain
-- unrestricted by the trigger (only self-service callers are restricted),
-- so nothing about their existing full-edit capability changes.
--
-- Idempotent: safe to re-run.

-- private.is_own_barber -------------------------------------------------------
-- True if the calling user IS the barber identified by p_barber_id (via
-- staff_profiles.user_id). Does not need an organization_id parameter：
-- barber_id already determines the organization via its own FK, and the
-- calling context (an appointments/queue_entries row's own tenant-
-- consistency trigger) already guarantees barber_id belongs to that row's
-- organization_id — this helper only needs to answer "is this me."
create or replace function private.is_own_barber(p_barber_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id and sp.user_id = (select auth.uid())
  );
$$;

comment on function private.is_own_barber(uuid) is
  'True if the calling user is the barber identified by p_barber_id, via staff_profiles.user_id.';

revoke execute on function private.is_own_barber(uuid) from public, anon;
grant execute on function private.is_own_barber(uuid) to authenticated;

-- appointments: self-service UPDATE ---------------------------------------------
-- Additional PERMISSIVE policy — Postgres OR's multiple permissive
-- policies for the same command together, so this only ADDS capability on
-- top of the existing owner/manager/receptionist appointments_update
-- policy (LOT 8); it does not replace or narrow it.
drop policy if exists appointments_update_self on public.appointments;
create policy appointments_update_self
  on public.appointments
  for update
  to authenticated
  using ((select private.is_own_barber(barber_id)))
  with check ((select private.is_own_barber(barber_id)));

create or replace function public.restrict_appointment_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Managing roles keep full edit rights untouched by this trigger.
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  -- Everyone else who could reach this far already passed RLS as "the
  -- assigned barber" (appointments_update_self above) — restrict them to
  -- status and notes only.
  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.chair_id is distinct from old.chair_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.buffer_before_minutes is distinct from old.buffer_before_minutes
    or new.buffer_after_minutes is distinct from old.buffer_after_minutes
  then
    raise exception 'a barber may only update status and notes on their own appointments';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_restrict_self_update on public.appointments;
create trigger appointments_restrict_self_update
  before update on public.appointments
  for each row execute function public.restrict_appointment_self_update();

-- queue_entries: self-service UPDATE ---------------------------------------------
-- Same two-layer approach: an additional permissive RLS policy scoped to
-- "my assigned queue entry," plus a trigger restricting non-managing
-- callers to status/timestamp/notes fields only.
drop policy if exists queue_entries_update_self on public.queue_entries;
create policy queue_entries_update_self
  on public.queue_entries
  for update
  to authenticated
  using (barber_id is not null and (select private.is_own_barber(barber_id)))
  with check (barber_id is not null and (select private.is_own_barber(barber_id)));

create or replace function public.restrict_queue_entry_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
  then
    raise exception 'a barber may only update status, timestamps and notes on their own queue entries';
  end if;

  return new;
end;
$$;

drop trigger if exists queue_entries_restrict_self_update on public.queue_entries;
create trigger queue_entries_restrict_self_update
  before update on public.queue_entries
  for each row execute function public.restrict_queue_entry_self_update();
