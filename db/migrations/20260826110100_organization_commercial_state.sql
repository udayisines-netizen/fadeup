-- FadeUp — R2: what commercial agreement an organization is actually under
--
-- ONE ROW PER ORGANIZATION, AND THE BROWSER CANNOT WRITE IT
--
-- The entire point of this table is that it is the ONLY place the answer to
-- "what may this organization do commercially" is stored, and that no client
-- holds a privilege that could change it. Concretely:
--
--   * anon and authenticated have every privilege REVOKED at table level;
--   * there is no INSERT, UPDATE or DELETE policy for any client role, so even
--     if a privilege were re-granted by a careless future migration, RLS would
--     still refuse;
--   * writes happen through exactly two paths — the AFTER INSERT trigger that
--     gives a new organization its default state, and
--     public.assign_commercial_plan() in 20260826110600, which requires
--     platform admin;
--   * every plan change is mirrored into an append-only audit table.
--
-- A member PATCHing `plan_key = 'multi_scale'` onto their own organization is
-- not "blocked by a policy that happens to be correct". There is no grant for
-- the statement to use.
--
-- PROVIDER-AGNOSTIC BY DESIGN. NO BILLING PROVIDER IS CHOSEN HERE.
--
-- R2 is not the billing lot. There is no Stripe, no checkout, no webhook, no
-- price id and no payment method anywhere in this schema. What exists is three
-- deliberately opaque text columns — provider, provider_customer_ref,
-- provider_subscription_ref — that a later billing layer can populate without
-- another schema migration, and which R2 leaves NULL everywhere.
--
-- The rule that outlives the provider choice: THIS ROW IS AUTHORITATIVE FOR
-- ACCESS DECISIONS, always. A provider is a source of billing events that
-- update this row; it is never consulted at request time and never overrides
-- it. That is what makes an entitlement check a local, fast, always-available
-- answer rather than a network call that can fail open.
--
-- WHY status IS SEPARATE FROM plan_key
--
--   plan_key   which package. free is a package.
--   status     whether that package is currently in force.
--
-- Collapsing them would make "free" mean both "the Free plan" and "the paid
-- plan that lapsed", and Constitution/R2 are explicit that FREE IS NOT AN
-- ERROR STATE. An organization on `free` is `active`. An organization whose
-- salon_pro payment failed is `salon_pro` + `past_due` and keeps its identity,
-- its social graph and its history while the commercial question is resolved.
--
-- WHY entitlement_source EXISTS, AND WHAT THE BACKFILL IS ALLOWED TO CLAIM
--
--   'billing'        a billing provider is the reason this plan is in force.
--                    R2 never writes this value. Nothing in this repository
--                    can, because no billing integration exists.
--   'platform_grant' FadeUp staff deliberately granted this plan. Auditable,
--                    attributable, and honest about being a decision rather
--                    than a payment.
--   'early_access'   the plan is in force because FadeUp is pre-billing and
--                    every organization has the product. This is a REAL and
--                    CURRENT commercial fact, already stated publicly on the
--                    pricing FAQ; recording it is not the same as fabricating a
--                    payment, and 20260826110200 uses only this value.
--
-- No column in this table asserts that money changed hands, and none ever
-- should until a provider actually says so.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Closed sets, so enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'commercial_status') then
    -- Deliberately three values, not four. There is no 'trialing': FadeUp runs
    -- no trial today, and an enum value that nothing can produce is a branch
    -- every future reader has to reason about for nothing.
    create type public.commercial_status as enum ('active', 'past_due', 'canceled');
  end if;

  if not exists (select 1 from pg_type where typname = 'entitlement_source') then
    create type public.entitlement_source as enum ('early_access', 'platform_grant', 'billing');
  end if;
end $$;

comment on type public.commercial_status is
  'Whether the assigned plan is currently in force. free + active is the normal, healthy state of a network-tier organization — free is NEVER an error, an expiry or a failed trial.';
comment on type public.entitlement_source is
  'Why this plan is in force. billing = a provider said so (R2 never writes it; no provider exists). platform_grant = FadeUp staff decided. early_access = pre-billing, everyone has the product. Nothing here claims a payment occurred.';

-- ---------------------------------------------------------------------------
-- 2. organization_commercial_state
--
-- organization_id is both the PK and the FK, which is how "exactly one row per
-- organization" is spelled without a second unique index. That single-row
-- property is load-bearing beyond tidiness: the capacity triggers in
-- 20260826110400/500 take `SELECT ... FOR UPDATE` on this row and use it as the
-- per-organization mutex that serialises concurrent location and roster
-- creation. If an organization could have two commercial rows, two concurrent
-- transactions could lock different ones and both pass the same cap check.
--
-- FK behaviour:
--   organization_id  ON DELETE CASCADE. Commercial state describes an
--                    organization and is meaningless without it; leaving an
--                    orphan row would let a recreated slug inherit a stranger's
--                    plan. Note this is a cascade INTO the commercial model,
--                    never out of it — deleting a plan or a professional
--                    identity never deletes anything here, and nothing here
--                    ever deletes an establishment, a customer or a
--                    professional. Commercial deletion does not cascade into
--                    social identity, which is R1B's guarantee and R2 must not
--                    weaken it.
--   plan_key         ON DELETE RESTRICT. A plan an organization is on cannot be
--                    deleted out from under it. ON UPDATE CASCADE so a rename
--                    (which should never happen) would carry rather than break.
--   assigned_by      ON DELETE SET NULL. Erasing a staff account must not
--                    dead-end on a foreign key, and must not destroy the
--                    organization's commercial state. The audit table keeps the
--                    history either way.
-- ---------------------------------------------------------------------------

create table if not exists public.organization_commercial_state (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,

  plan_key text not null default 'free'
    references public.commercial_plans (plan_key) on update cascade on delete restrict,

  status public.commercial_status not null default 'active',

  entitlement_source public.entitlement_source not null default 'early_access',

  -- When the CURRENT plan took effect. Not a billing period boundary — R2 has
  -- no billing periods.
  assigned_at timestamptz not null default now(),

  -- Who decided. NULL for the automatic default a new organization receives and
  -- for the backfill, both of which are the system rather than a person.
  assigned_by uuid references auth.users (id) on delete set null,

  assignment_note text,

  -- Opaque, provider-agnostic. R2 leaves all three NULL and writes none of
  -- them. A later billing lot fills them in without a schema change.
  provider text,
  provider_customer_ref text,
  provider_subscription_ref text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A provider reference without a named provider is an orphan string nobody
  -- can interpret. Either the provider is known or there are no refs.
  constraint organization_commercial_state_provider_refs_need_provider
    check (provider is not null
           or (provider_customer_ref is null and provider_subscription_ref is null)),

  -- Free is never past_due and never canceled: there is nothing to owe and
  -- nothing to cancel. Without this, "free + past_due" becomes representable
  -- and every consumer has to decide what it means.
  constraint organization_commercial_state_free_is_active
    check (plan_key <> 'free' or status = 'active'),

  -- R2 writes no billing evidence. This constraint is deliberately narrow: it
  -- says a 'billing' source must name its provider, so the value cannot be set
  -- as a bare boast. It does not, and must not, try to prove a payment.
  constraint organization_commercial_state_billing_needs_provider
    check (entitlement_source <> 'billing' or provider is not null)
);

comment on table public.organization_commercial_state is
  'Exactly one row per organization: which commercial plan is in force, whether it is in force, and why. THE authoritative input to every entitlement decision. anon and authenticated hold no privilege on this table and there is no client-facing write policy of any kind — the only writers are the new-organization default trigger and public.assign_commercial_plan(), which requires platform admin. organization_id is the primary key so the row can also serve as the per-organization mutex the capacity triggers lock.';

comment on column public.organization_commercial_state.plan_key is
  'Which package. Machine identity only — never a display name, never a price. Defaults to free, which is a legitimate network state and not a failure.';
comment on column public.organization_commercial_state.status is
  'Whether the package is in force. Separate from plan_key on purpose: collapsing them would make "free" mean both the Free plan and a plan that lapsed.';
comment on column public.organization_commercial_state.entitlement_source is
  'Why the plan is in force. R2 never writes billing: no billing provider is integrated, and marking an organization paid because someone clicked a plan in a browser is exactly the fabrication this column exists to make visible.';
comment on column public.organization_commercial_state.provider is
  'Opaque billing-provider name. NULL throughout R2. Present so a later billing lot needs no schema migration, and so it is obvious that no provider is the source of truth for access — this row is.';

create index if not exists organization_commercial_state_plan_key_idx
  on public.organization_commercial_state (plan_key);
create index if not exists organization_commercial_state_status_idx
  on public.organization_commercial_state (status);

drop trigger if exists organization_commercial_state_set_updated_at on public.organization_commercial_state;
create trigger organization_commercial_state_set_updated_at
  before update on public.organization_commercial_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. commercial_plan_changes — the append-only record
--
-- Plan assignment is the single most abusable operation R2 adds, so it leaves
-- a trail that cannot be edited afterwards. Append-only is enforced twice: no
-- role is granted UPDATE or DELETE, and a trigger refuses both regardless of
-- privilege, which also covers postgres and service_role.
--
-- Kept separate from public.audit_logs deliberately. audit_logs is a generic
-- tenant activity feed readable by owners/managers; this is commercial history
-- with a fixed shape that a billing reconciliation will need to join on, and
-- burying it in a jsonb payload would make that join guesswork.
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_plan_changes (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- NULL for the very first assignment (an organization coming into existence
  -- has no previous plan). ON DELETE RESTRICT: history must keep naming a real
  -- plan.
  previous_plan_key text
    references public.commercial_plans (plan_key) on update cascade on delete restrict,
  new_plan_key text not null
    references public.commercial_plans (plan_key) on update cascade on delete restrict,

  previous_status public.commercial_status,
  new_status public.commercial_status not null,

  entitlement_source public.entitlement_source not null,

  -- NULL when the system did it (default assignment, backfill). Never NULL for
  -- a platform-admin assignment — assign_commercial_plan() always has a caller.
  changed_by uuid references auth.users (id) on delete set null,

  change_reason text,

  created_at timestamptz not null default now(),

  constraint commercial_plan_changes_not_a_noop
    check (previous_plan_key is distinct from new_plan_key
           or previous_status is distinct from new_status)
);

comment on table public.commercial_plan_changes is
  'Append-only commercial history: every plan or status transition, who caused it and why. Enforced append-only by trigger as well as by privilege, so it holds for postgres and service_role too. Deliberately not folded into audit_logs: a billing reconciliation needs a fixed shape to join on, not a jsonb payload.';

create index if not exists commercial_plan_changes_organization_idx
  on public.commercial_plan_changes (organization_id, created_at desc);

create or replace function public.reject_commercial_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- No role exemption, on purpose. An audit trail that the most powerful role
  -- can rewrite is a log, not an audit trail.
  raise exception 'commercial_plan_changes is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

comment on function public.reject_commercial_history_mutation() is
  'Refuses UPDATE and DELETE on commercial_plan_changes for every role including postgres and service_role. Privilege revocation alone would leave the trail rewritable by the roles that matter most.';

drop trigger if exists commercial_plan_changes_append_only on public.commercial_plan_changes;
create trigger commercial_plan_changes_append_only
  before update or delete on public.commercial_plan_changes
  for each row execute function public.reject_commercial_history_mutation();

-- ---------------------------------------------------------------------------
-- 4. Every organization gets commercial state, automatically
--
-- Modelled on the existing handle_new_organization() convention: the
-- organization row drives its own dependent row through an AFTER INSERT
-- trigger, rather than trusting a caller to make a second write that RLS could
-- not authorize anyway.
--
-- The default is `free`. That is the honest answer for an organization that has
-- just come into existence and has paid nothing, and it is also the SAFE
-- answer: free is the most restrictive plan in the catalogue, so a state row
-- that appears by accident grants the least.
--
-- ensure_organization_commercial_state() is separately callable because the
-- capacity triggers need a guaranteed row to lock. If a row is somehow missing
-- — a restore from a pre-R2 dump, a future code path that inserts an
-- organization in an unexpected way — the alternative to creating a free row on
-- demand is a hard failure on an operation the organization may well be
-- entitled to perform. Creating the most restrictive row is the fail-safe
-- direction: it can only ever deny more than the truth, never less.
-- ---------------------------------------------------------------------------

create or replace function private.ensure_organization_commercial_state(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_commercial_state (organization_id, plan_key, status, entitlement_source)
  values (p_organization_id, 'free', 'active', 'early_access')
  on conflict (organization_id) do nothing;
end;
$$;

comment on function private.ensure_organization_commercial_state(uuid) is
  'Idempotently gives an organization its default commercial state (free/active/early_access). Free is both the honest default for an organization that has paid nothing and the SAFE default, because it is the most restrictive plan in the catalogue — a row that appears by accident can only deny more than the truth, never less. Not reachable by any client: private schema, EXECUTE granted to no client role.';

revoke all on function private.ensure_organization_commercial_state(uuid) from public, anon, authenticated;

create or replace function public.handle_new_organization_commercial_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_organization_commercial_state(new.id);

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (new.id, null, 'free', null, 'active', 'early_access', null,
     'Automatic default state for a newly created organization.');

  return new;
end;
$$;

comment on function public.handle_new_organization_commercial_state() is
  'AFTER INSERT on organizations: gives the new organization its default free/active commercial state and opens its audit trail. A separate trigger from handle_new_organization() so the two concerns — who owns this shop, what has this shop paid for — stay independently reviewable and independently revertible.';

drop trigger if exists organizations_ensure_commercial_state on public.organizations;
create trigger organizations_ensure_commercial_state
  after insert on public.organizations
  for each row execute function public.handle_new_organization_commercial_state();

-- ---------------------------------------------------------------------------
-- 5. RLS and privileges
--
-- READ: members of the organization, and platform admins. An organization's own
-- staff seeing which plan they are on is the whole point of a pricing surface
-- that knows who is looking at it. A customer, or a member of a DIFFERENT
-- organization, sees nothing — commercial state is tenant-private.
--
-- WRITE: nobody. Not a narrow policy, not a role exemption — no INSERT, UPDATE
-- or DELETE policy exists on either table, and the table-level privileges are
-- revoked as well. The only writers are SECURITY DEFINER functions.
--
-- The audit table is narrower still: owner/manager rather than any member. A
-- receptionist or barber has no business reading the commercial decision
-- history of the shop they work in.
-- ---------------------------------------------------------------------------

alter table public.organization_commercial_state enable row level security;
alter table public.organization_commercial_state force row level security;
alter table public.commercial_plan_changes enable row level security;
alter table public.commercial_plan_changes force row level security;

revoke all on public.organization_commercial_state from anon, authenticated, prospect_worker;
revoke all on public.commercial_plan_changes from anon, authenticated, prospect_worker;

grant select on public.organization_commercial_state to authenticated;
grant select on public.commercial_plan_changes to authenticated;

drop policy if exists organization_commercial_state_select on public.organization_commercial_state;
create policy organization_commercial_state_select
  on public.organization_commercial_state
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists commercial_plan_changes_select on public.commercial_plan_changes;
create policy commercial_plan_changes_select
  on public.commercial_plan_changes
  for select
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

do $$
begin
  raise notice 'R2 organization commercial state installed';
end $$;
