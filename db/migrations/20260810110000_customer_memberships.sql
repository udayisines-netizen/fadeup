-- FadeUp — LOT 14: recurring customer memberships
-- Migration: membership_plans, customer_memberships
--
-- Naming note: `public.memberships` already exists (LOT 2) — a STAFF
-- member's role within an organization. This is a completely different
-- concept (a CUSTOMER's recurring subscription to a shop, e.g. "Unlimited
-- Fades Monthly"), so it gets its own, unambiguous table names:
-- `membership_plans` (the plan a shop offers) and `customer_memberships`
-- (one customer's enrollment in one). Never call these "memberships" in
-- code or UI copy without the "customer" qualifier, to avoid exactly the
-- confusion the naming here is designed to prevent.
--
-- Scope boundary: no real recurring billing yet — that's LOT 16 (Payment
-- Architecture). This lot is the data model and status lifecycle only:
-- price_cents is what the plan costs, current_period_end is when the
-- current period lapses, but nothing here actually charges a card or
-- renews a period automatically. A shop tracks/enforces membership status
-- manually (or via LOT 16's future billing integration writing to these
-- same tables) until real payment processing exists.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'billing_interval') then
    create type public.billing_interval as enum ('weekly', 'monthly', 'yearly');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_membership_status') then
    create type public.customer_membership_status as enum ('active', 'paused', 'cancelled', 'expired');
  end if;
end
$$;

comment on type public.customer_membership_status is
  'active/paused/cancelled/expired are all staff-driven in this lot — no automated billing-driven transition exists yet (LOT 16).';

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null,
  billing_interval public.billing_interval not null default 'monthly',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_plans_name_not_blank check (btrim(name) <> ''),
  constraint membership_plans_price_cents_non_negative check (price_cents >= 0)
);

comment on table public.membership_plans is
  'A recurring plan a shop offers customers (e.g. "Unlimited Fades Monthly"). Not a staff role — see public.memberships for that. No real billing yet (LOT 16); price_cents/billing_interval describe the plan, nothing here charges a card.';

create index if not exists membership_plans_organization_id_idx on public.membership_plans (organization_id);

drop trigger if exists membership_plans_set_updated_at on public.membership_plans;
create trigger membership_plans_set_updated_at
  before update on public.membership_plans
  for each row execute function public.set_updated_at();

create table if not exists public.customer_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  plan_id uuid not null references public.membership_plans (id) on delete restrict,
  status public.customer_membership_status not null default 'active',
  started_at timestamptz not null default now(),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_memberships_period_valid check (current_period_end > current_period_start)
);

comment on table public.customer_memberships is
  'One customer''s enrollment in one membership_plans row. current_period_end is tracked, not enforced by any billing job yet (LOT 16) — a shop currently reviews/renews these manually.';

create index if not exists customer_memberships_organization_id_idx on public.customer_memberships (organization_id);
create index if not exists customer_memberships_customer_id_idx on public.customer_memberships (customer_id);
create index if not exists customer_memberships_plan_id_idx on public.customer_memberships (plan_id);

-- A customer may have historical (cancelled/expired) memberships, but only
-- ONE active-or-paused enrollment at a time — otherwise "is this customer
-- a member right now" has no single answer. Partial unique index, not a
-- CHECK constraint, since it spans multiple rows.
create unique index if not exists customer_memberships_one_open_per_customer
  on public.customer_memberships (customer_id)
  where status in ('active', 'paused');

drop trigger if exists customer_memberships_set_updated_at on public.customer_memberships;
create trigger customer_memberships_set_updated_at
  before update on public.customer_memberships
  for each row execute function public.set_updated_at();

-- check_customer_membership_consistency ---------------------------------------
create or replace function public.check_customer_membership_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization_id as the customer membership';
  end if;

  if not exists (
    select 1 from public.membership_plans p where p.id = new.plan_id and p.organization_id = new.organization_id
  ) then
    raise exception 'plan_id must belong to the same organization_id as the customer membership';
  end if;

  return new;
end;
$$;

drop trigger if exists customer_memberships_check_consistency on public.customer_memberships;
create trigger customer_memberships_check_consistency
  before insert or update on public.customer_memberships
  for each row execute function public.check_customer_membership_consistency();

-- Row Level Security -------------------------------------------------------

alter table public.membership_plans enable row level security;
alter table public.membership_plans force row level security;

-- Plan management (pricing/what's offered) is an owner/manager decision —
-- narrower than the owner/manager/receptionist write access used for
-- day-to-day booking tables. Matches services/service_categories (LOT 7).
drop policy if exists membership_plans_select on public.membership_plans;
create policy membership_plans_select
  on public.membership_plans
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists membership_plans_insert on public.membership_plans;
create policy membership_plans_insert
  on public.membership_plans
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists membership_plans_update on public.membership_plans;
create policy membership_plans_update
  on public.membership_plans
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists membership_plans_delete on public.membership_plans;
create policy membership_plans_delete
  on public.membership_plans
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

alter table public.customer_memberships enable row level security;
alter table public.customer_memberships force row level security;

-- Enrolling/managing a customer's membership is front-of-house work, same
-- role set as appointments/queue_entries/customers/waitlist_entries.
drop policy if exists customer_memberships_select on public.customer_memberships;
create policy customer_memberships_select
  on public.customer_memberships
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists customer_memberships_insert on public.customer_memberships;
create policy customer_memberships_insert
  on public.customer_memberships
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists customer_memberships_update on public.customer_memberships;
create policy customer_memberships_update
  on public.customer_memberships
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists customer_memberships_delete on public.customer_memberships;
create policy customer_memberships_delete
  on public.customer_memberships
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
