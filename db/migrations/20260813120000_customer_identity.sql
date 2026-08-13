-- FadeUp — Wave 1 Phase 3: customer identity bridge
-- Migration: customer_profiles + customers.user_id bridge + claim_customer_records
--
-- The core Wave 1 gap (see docs/wave-1/PLAN.md section 1): FadeUp already
-- has real customer auth.users accounts (/customer/signup,
-- /customer/login) and a separate, per-organization, staff-owned CRM table
-- (public.customers — see 20260809180000_customers.sql) with NO link
-- between them. A signed-up customer today cannot see any booking they've
-- ever made, because nothing connects their auth identity to the
-- customers/appointments rows a shop created for them.
--
-- Two distinct concepts, kept deliberately separate (do not merge them):
--
--   1. public.customer_profiles — the CUSTOMER-OWNED, PORTABLE identity.
--      One row per auth.users account, org-agnostic. This is what a
--      customer actually controls: their own name/phone/onboarding
--      preferences. This is the anchor Fade Passport (Phase 5) attaches to.
--
--   2. public.customers (existing) — the SHOP-OWNED CRM contact, one row
--      PER organization a customer has interacted with (walk-ins with no
--      account keep working exactly as before — customers.user_id is
--      nullable). customers.user_id is the bridge: once set, that org's
--      CRM contact is known to belong to a real logged-in customer.
--
-- Every customer-app read (appointments, favorites, passport, etc.) goes
-- through narrowly-scoped SECURITY DEFINER RPCs, NOT a broad new RLS SELECT
-- policy on `customers` — customers.notes is internal shop/staff data and
-- must never become readable by the customer it's about (see Phase 5's
-- Fade Passport internal-notes-separation requirement, which this decision
-- protects structurally from the start). customer_profiles itself is safe
-- for direct RLS since it holds only the customer's own data with zero
-- cross-tenant surface.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_haircut_frequency') then
    create type public.customer_haircut_frequency as enum ('weekly', 'every_2_weeks', 'every_3_weeks', 'monthly', 'less_often', 'depends');
  end if;
  if not exists (select 1 from pg_type where typname = 'customer_appointment_preference') then
    create type public.customer_appointment_preference as enum ('appointment', 'walk_in', 'either');
  end if;
  if not exists (select 1 from pg_type where typname = 'customer_style_preference') then
    create type public.customer_style_preference as enum ('fade', 'taper', 'crop', 'buzz', 'afro', 'curly', 'long', 'beard_focus', 'other');
  end if;
end $$;

create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text,
  phone text,
  email text,
  haircut_frequency public.customer_haircut_frequency,
  style_preference public.customer_style_preference,
  style_notes text,
  appointment_preference public.customer_appointment_preference,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_profiles_style_notes_length check (style_notes is null or char_length(style_notes) <= 500)
);

comment on table public.customer_profiles is
  'The customer-owned, portable identity — one row per auth.users account, org-agnostic. Not created automatically at signup (an account that never touches the customer app has no row here, which is a legitimate normal state); created/updated by the customer themselves via onboarding or their profile screen. Distinct from public.customers, the per-organization staff-owned CRM contact.';

create index if not exists customer_profiles_user_id_idx on public.customer_profiles (user_id);

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
  before update on public.customer_profiles
  for each row execute function public.set_updated_at();

alter table public.customer_profiles enable row level security;
alter table public.customer_profiles force row level security;

-- Strict owner-only — no anon access, no cross-customer access, no
-- shop/staff access of any kind. A customer's own portable data.
drop policy if exists customer_profiles_select on public.customer_profiles;
create policy customer_profiles_select
  on public.customer_profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists customer_profiles_insert on public.customer_profiles;
create policy customer_profiles_insert
  on public.customer_profiles
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists customer_profiles_update on public.customer_profiles;
create policy customer_profiles_update
  on public.customer_profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists customer_profiles_delete on public.customer_profiles;
create policy customer_profiles_delete
  on public.customer_profiles
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- customers.user_id bridge --------------------------------------------------
-- Nullable: a walk-in with no account stays exactly as it works today.
-- Partial unique per-org: the same person can be a customer at several
-- shops (several customers rows), but never twice, linked to the same
-- account, within one shop.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'user_id'
  ) then
    alter table public.customers add column user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

comment on column public.customers.user_id is
  'Bridge to the customer''s own portable identity (customer_profiles), set by claim_customer_records() once they have an account with matching contact info. Nullable — most rows created before this migration, and every future walk-in with no account, stay unlinked. Never grants the linked customer direct SELECT/UPDATE on this row (customers.notes is internal shop data) — customer-facing reads go through dedicated RPCs only.';

create unique index if not exists customers_org_user_unique on public.customers (organization_id, user_id) where user_id is not null;
create index if not exists customers_user_id_idx on public.customers (user_id) where user_id is not null;

-- claim_customer_records ----------------------------------------------------
-- Lets a just-signed-up-or-logged-in customer retroactively link every
-- existing customers row (across every organization — a customer's past
-- visits to different shops, all created before they ever had a FadeUp
-- account) that matches contact info THEY THEMSELVES supplied, and that
-- isn't already linked to someone else. Same trust model as the existing
-- link_customer_from_contact_info trigger (phone first, then email) — not a
-- new risk profile, the established one applied to a new column. Never
-- touches a row already linked to a different user_id (idempotent, safe to
-- call repeatedly, e.g. after every booking).
create or replace function public.claim_customer_records(p_phone text, p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_claimed integer;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'claim_customer_records requires an authenticated session';
  end if;

  if (p_phone is null or btrim(p_phone) = '') and (p_email is null or btrim(p_email) = '') then
    return 0;
  end if;

  with claimed as (
    update public.customers
    set user_id = v_user_id
    where user_id is null
      and (
        (p_phone is not null and btrim(p_phone) <> '' and phone = p_phone)
        or (p_email is not null and btrim(p_email) <> '' and email = p_email)
      )
    returning 1
  )
  select count(*) into v_claimed from claimed;

  return v_claimed;
end;
$$;

comment on function public.claim_customer_records(text, text) is
  'Authenticated-only. Links every unlinked public.customers row matching the caller''s own phone/email (across all organizations) to their account. Idempotent — never touches a row already linked to a different user_id. Called by the frontend right after an authenticated booking, and after saving onboarding contact info.';

revoke execute on function public.claim_customer_records(text, text) from public, anon;
grant execute on function public.claim_customer_records(text, text) to authenticated;
