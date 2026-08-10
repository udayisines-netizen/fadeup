-- FadeUp — LOT 13: waitlist + no-show rules
-- Migration: waitlist_entries, no-show automation
--
-- Two independent pieces of "deterministic business automation":
--
-- 1. `waitlist_entries` — a customer who wants a slot that doesn't exist
--    right now (fully booked day, no matching opening). Deliberately a
--    distinct concept from `queue_entries` (LOT 10, someone physically
--    present right now) and `appointments` (a confirmed future slot) —
--    conflating "waiting in the shop" with "waiting for an opening to be
--    scheduled" would blur two different staff workflows. Staff-managed
--    only in this pass (no anon-facing join RPC yet) — a documented scope
--    boundary, see the "Not yet built" note in docs/database.md.
--
-- 2. Automated no-show marking: a `confirmed` appointment whose window has
--    passed by a grace period without being marked `completed`/`cancelled`
--    is, deterministically, a no-show — a shop shouldn't have to remember
--    to do this by hand for every stood-up booking. Implemented as a
--    callable SECURITY DEFINER function rather than a pg_cron job: this
--    self-hosted stack does not have pg_cron enabled yet (`create
--    extension` alone is not sufficient — it also needs
--    shared_preload_libraries + cron.database_name at the Postgres
--    cluster level, a config-and-restart change, not a migration), so the
--    application layer invokes this function opportunistically instead
--    (see apps/web/src/lib/queries/appointments.ts's
--    useApplyNoShowRule, fired once when staff load today's schedule).
--    Revisit alongside LOT 25 (Production Infrastructure) if true
--    background scheduling turns out to matter — the function itself is
--    already written to be safely callable from a real cron job the
--    moment one exists, with no changes needed.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'waitlist_status') then
    create type public.waitlist_status as enum ('waiting', 'notified', 'booked', 'cancelled', 'expired');
  end if;
end
$$;

comment on type public.waitlist_status is
  'waiting: default. notified/booked/cancelled/expired are all staff-driven transitions in this pass — no automated notification exists yet (LOT 19).';

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  desired_service_id uuid references public.services (id) on delete set null,
  desired_barber_id uuid references public.barbers (id) on delete set null,
  notes text,
  status public.waitlist_status not null default 'waiting',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_entries_customer_name_not_blank check (btrim(customer_name) <> '')
);

comment on table public.waitlist_entries is
  'A customer waiting for a future opening — not someone physically present (see queue_entries) or already booked (see appointments). Staff-managed; no public join flow yet.';

create index if not exists waitlist_entries_organization_id_idx on public.waitlist_entries (organization_id);
create index if not exists waitlist_entries_location_id_idx on public.waitlist_entries (location_id);
create index if not exists waitlist_entries_customer_id_idx on public.waitlist_entries (customer_id) where customer_id is not null;

drop trigger if exists waitlist_entries_set_updated_at on public.waitlist_entries;
create trigger waitlist_entries_set_updated_at
  before update on public.waitlist_entries
  for each row execute function public.set_updated_at();

-- Reuses the LOT 12 find-or-create trigger — it already tolerates tables
-- missing customer_email (via to_jsonb) and simply needs organization_id/
-- customer_name/customer_phone/customer_email columns to exist, all of
-- which waitlist_entries has.
drop trigger if exists waitlist_entries_link_customer on public.waitlist_entries;
create trigger waitlist_entries_link_customer
  before insert on public.waitlist_entries
  for each row execute function public.link_customer_from_contact_info();

-- check_waitlist_entry_consistency ------------------------------------------
-- Same tenant-consistency guard shape as appointments/queue_entries: every
-- FK reference must belong to the SAME organization_id as the row itself,
-- enforced even for a direct-SQL/service_role write, not just RLS-gated
-- client writes.
create or replace function public.check_waitlist_entry_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.locations l where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'location_id must belong to the same organization_id as the waitlist entry';
  end if;

  if new.desired_service_id is not null and not exists (
    select 1 from public.services s where s.id = new.desired_service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'desired_service_id must belong to the same organization_id as the waitlist entry';
  end if;

  if new.desired_barber_id is not null and not exists (
    select 1 from public.barbers b where b.id = new.desired_barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'desired_barber_id must belong to the same organization_id as the waitlist entry';
  end if;

  return new;
end;
$$;

drop trigger if exists waitlist_entries_check_consistency on public.waitlist_entries;
create trigger waitlist_entries_check_consistency
  before insert or update on public.waitlist_entries
  for each row execute function public.check_waitlist_entry_consistency();

-- Row Level Security -------------------------------------------------------
-- Same shape as appointments/queue_entries/customers: any org member reads,
-- owner/manager/receptionist write.

alter table public.waitlist_entries enable row level security;
alter table public.waitlist_entries force row level security;

drop policy if exists waitlist_entries_select on public.waitlist_entries;
create policy waitlist_entries_select
  on public.waitlist_entries
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists waitlist_entries_insert on public.waitlist_entries;
create policy waitlist_entries_insert
  on public.waitlist_entries
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists waitlist_entries_update on public.waitlist_entries;
create policy waitlist_entries_update
  on public.waitlist_entries
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists waitlist_entries_delete on public.waitlist_entries;
create policy waitlist_entries_delete
  on public.waitlist_entries
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

-- apply_appointment_no_show_rule ---------------------------------------------
-- Transitions any `confirmed` appointment whose blocked window ended more
-- than NO_SHOW_GRACE_MINUTES ago into `no_show`. SECURITY INVOKER (not
-- DEFINER) deliberately — this only ever touches rows the calling role can
-- already update per existing appointments RLS (owner/manager/
-- receptionist), so there is no privilege to elevate; running as INVOKER
-- keeps it inside that same authorization boundary rather than needing its
-- own separate one. Idempotent to call repeatedly (already-no_show rows
-- don't match the WHERE clause a second time).
create or replace function public.apply_appointment_no_show_rule(p_organization_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grace_minutes constant integer := 30;
  v_updated_count integer;
begin
  update public.appointments
  set status = 'no_show'
  where organization_id = p_organization_id
    and status = 'confirmed'
    and ends_at < (now() - make_interval(mins => v_grace_minutes));

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

comment on function public.apply_appointment_no_show_rule(uuid) is
  'Marks confirmed appointments more than 30 minutes past their end time as no_show. SECURITY INVOKER — relies entirely on existing appointments UPDATE RLS (owner/manager/receptionist), grants no elevated access. Called opportunistically from the app (no pg_cron in this stack yet); safe to also wire to a real scheduled job later with zero changes.';

revoke execute on function public.apply_appointment_no_show_rule(uuid) from public;
grant execute on function public.apply_appointment_no_show_rule(uuid) to authenticated;
