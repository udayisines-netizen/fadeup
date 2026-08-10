-- FadeUp — LOT 12: customer CRM
-- Migration: customers
--
-- The real entity `appointments`/`queue_entries` deferred since LOT 8/10
-- (documented there as "a placeholder, not a design mistake"). This is
-- that placeholder being paid off.
--
-- Idempotent: safe to re-run.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (btrim(name) <> '')
);

comment on table public.customers is
  'Real customer entity, org-scoped. Populated both by staff directly (LOT 12 CRM UI) and automatically by the link_customer_from_contact_info trigger on appointments/queue_entries (matches or creates by phone/email at booking time).';

create index if not exists customers_organization_id_idx on public.customers (organization_id);

-- Partial unique indexes (not full-table unique — phone/email are both
-- nullable, and NULL never conflicts with NULL, which is exactly what we
-- want: two customers who both lack a phone number are not "duplicates").
-- These back the find-or-create trigger's matching logic below and are the
-- actual race-safety guarantee (the trigger's own SELECT-then-INSERT has a
-- narrow window under concurrent bookings; the unique index turns a missed
-- race into a clean, catchable conflict rather than a silent duplicate).
create unique index if not exists customers_org_phone_unique on public.customers (organization_id, phone) where phone is not null;
create unique index if not exists customers_org_email_unique on public.customers (organization_id, lower(email)) where email is not null;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- Row Level Security -------------------------------------------------------
-- select: any org member — barbers seeing who they're serving is a
-- reasonable read, same breadth as appointments/queue_entries.
-- insert/update/delete: owner/manager/receptionist, matching
-- appointments/queue_entries exactly — front-of-house manages customer
-- records.

alter table public.customers enable row level security;
alter table public.customers force row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select
  on public.customers
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists customers_insert on public.customers;
create policy customers_insert
  on public.customers
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists customers_update on public.customers;
create policy customers_update
  on public.customers
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists customers_delete on public.customers;
create policy customers_delete
  on public.customers
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));
