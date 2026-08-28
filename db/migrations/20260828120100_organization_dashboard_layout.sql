begin;

-- ============================================================================
-- FadeUp R5 — the Pro dashboard layout, owned by the SHOP
--
-- §24: "Layout preference is COMMON TO THE SHOP. NOT personal per staff
-- member. If one authorized user changes the layout, authorized users of that
-- shop should see the saved new layout."
--
-- That sentence is the entire reason this is a table rather than localStorage.
-- A per-browser preference would satisfy "the dashboard can be rearranged" and
-- fail the requirement completely: the owner would arrange the shop's morning
-- view on the desk machine and the manager would see the default on the tablet
-- by the chairs.
--
-- WHY THE ROW IS KEYED ON THE ORGANIZATION AND NOTHING ELSE
--
-- One layout per shop, enforced by the primary key. There is no user column in
-- the key, so there is no shape in which a per-member layout can exist by
-- accident — the requirement is expressed by the schema, not by a convention
-- the next lot has to remember.
--
-- `updated_by` is recorded but is NOT part of the key. It answers "who last
-- rearranged this" for an owner who finds the dashboard changed, which is a
-- real support question; it never scopes a read.
--
-- ============================================================================
-- WHY THE MODULE VOCABULARY IS NOT AN ENUM
-- ============================================================================
--
-- The obvious modelling is an enum of module names with a CHECK. It would make
-- every new dashboard card a migration, which is the wrong coupling: a card is
-- a presentational unit that lives entirely in the frontend, and a schema
-- change to add one would guarantee that the schema and the UI drift the first
-- time somebody ships a card without one.
--
-- So the constraints are SHAPE constraints — bounded length, a conservative
-- key pattern, no duplicates — and the client ignores any key it does not
-- recognise. An obsolete key left behind by a removed card is inert rather
-- than a broken dashboard, and a card added by the frontend works immediately.
--
-- The keys are also not secrets and not tenant data: they are the names of UI
-- panels. The tenant fact here is the ORDER a particular shop chose.
--
-- ============================================================================
-- WHY WRITE AUTHORIZATION IS RLS AND NOT AN RPC
-- ============================================================================
--
-- §40: "Dashboard layout writes must respect organization authorization."
-- The check is exactly "is the caller an owner or manager of this org", which
-- `private.has_org_role` already answers and which the rest of this schema
-- already expresses as a policy. An RPC would add a second place where that
-- question is answered, and a second place is where the answers diverge.
--
-- A `barber` or `receptionist` can therefore READ the shop layout — they have
-- to, it is the dashboard they are looking at — and cannot change it. The
-- write policies name the two roles that own shop configuration everywhere
-- else in FadeUp.
--
-- Idempotent: safe to re-run.
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The shape predicate.
--
-- A function rather than an inline CHECK because both halves of the rule need
-- to look at the array as a SET — "every element matches this pattern" and
-- "no element repeats" — and a CHECK constraint may not contain a subquery.
-- Marked IMMUTABLE, which it is: it reads nothing but its argument.
-- ----------------------------------------------------------------------------
create or replace function private.valid_dashboard_module_keys(p_keys text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_keys is not null
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as key)
    and not exists (
      select 1
      from unnest(p_keys) as key
      where key is null or key !~ '^[a-z][a-z0-9_]{0,39}$'
    );
$$;

comment on function private.valid_dashboard_module_keys(text[]) is
  'CHECK predicate for organization_dashboard_layouts.module_order: every key is a conservative lowercase identifier and no key repeats. Deliberately NOT a vocabulary — dashboard modules are presentational and adding one must not require a migration.';

revoke execute on function private.valid_dashboard_module_keys(text[]) from public, anon;

-- `authenticated` MUST keep EXECUTE, and this is the one place in FadeUp where
-- a `private.` function is granted to it.
--
-- A CHECK constraint that calls a function is evaluated as the WRITING role,
-- not as the table owner. Revoking this from `authenticated` — which is the
-- house style for everything in `private`, and was the first thing tried here
-- — does not harden the constraint, it makes every INSERT by a real user fail
-- with "permission denied for function valid_dashboard_module_keys". Found by
-- running the write as an owner through RLS rather than by reading the DDL.
--
-- Granting it discloses nothing: the function reads no table, takes no
-- session state, and is IMMUTABLE over its own argument. The caller can learn
-- exactly what the constraint would already have told them by failing.
grant execute on function private.valid_dashboard_module_keys(text[]) to authenticated;

create table if not exists public.organization_dashboard_layouts (
  -- The key IS the requirement. One layout per shop, no user dimension.
  organization_id uuid primary key
    references public.organizations (id)
    on delete cascade,

  -- Ordered list of module keys. Order is the whole payload; a module absent
  -- from the array is one this shop has hidden.
  module_order text[] not null,

  updated_at timestamptz not null default now(),

  -- Who last changed it. ON DELETE SET NULL: an erased account must not take
  -- the shop's dashboard with it.
  updated_by uuid
    references auth.users (id)
    on delete set null,

  -- Bounded so a client bug cannot store an unbounded array in a row every
  -- member of the shop reads on every dashboard load.
  constraint organization_dashboard_layouts_size
    check (array_length(module_order, 1) between 1 and 32),

  -- Conservative key shape, and no duplicates. Not a vocabulary — see the note
  -- above — but enough that the column can never hold prose, a URL, or an
  -- injection attempt dressed as a module name, and enough that a module
  -- cannot be listed twice and render twice.
  constraint organization_dashboard_layouts_keys_valid
    check (private.valid_dashboard_module_keys(module_order))
);

comment on table public.organization_dashboard_layouts is
  'The Pro dashboard module order, owned by the ORGANIZATION rather than by a member — R5 §24. Keyed on organization_id alone so a per-user layout cannot exist by accident. Readable by every member of the shop, writable only by owner/manager. Module keys are validated for shape, not against a vocabulary: dashboard cards are presentational and adding one must not require a migration, so an unrecognised key is inert rather than invalid.';

comment on column public.organization_dashboard_layouts.module_order is
  'Ordered module keys. Order is the payload; a module missing from the array is hidden for this shop. Unknown keys are ignored by the client.';

comment on column public.organization_dashboard_layouts.updated_by is
  'Who last rearranged the shop dashboard. Recorded for support ("why did this move?"), never used to scope a read — the layout is the shop''s, not this person''s.';

drop trigger if exists organization_dashboard_layouts_set_updated_at
  on public.organization_dashboard_layouts;

create trigger organization_dashboard_layouts_set_updated_at
  before update on public.organization_dashboard_layouts
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- RLS / LEAST PRIVILEGE
-- ============================================================================

alter table public.organization_dashboard_layouts enable row level security;
alter table public.organization_dashboard_layouts force row level security;

drop policy if exists organization_dashboard_layouts_select
  on public.organization_dashboard_layouts;

-- Every member reads the shop's layout, because it is the dashboard they are
-- looking at. A platform admin does not: this is a UI preference, and support
-- access to it buys nothing that would justify widening the surface.
create policy organization_dashboard_layouts_select
  on public.organization_dashboard_layouts
  for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists organization_dashboard_layouts_insert
  on public.organization_dashboard_layouts;

create policy organization_dashboard_layouts_insert
  on public.organization_dashboard_layouts
  for insert
  to authenticated
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

drop policy if exists organization_dashboard_layouts_update
  on public.organization_dashboard_layouts;

-- USING and WITH CHECK both, and both naming the SAME organization: without
-- the WITH CHECK an authorized manager of shop A could UPDATE their own row's
-- organization_id to shop B and carry the row across the tenant boundary.
create policy organization_dashboard_layouts_update
  on public.organization_dashboard_layouts
  for update
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  )
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

drop policy if exists organization_dashboard_layouts_delete
  on public.organization_dashboard_layouts;

-- Deleting the row is how a shop returns to the product default, so it is the
-- same authority as changing it.
create policy organization_dashboard_layouts_delete
  on public.organization_dashboard_layouts
  for delete
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

revoke all
  on table public.organization_dashboard_layouts
  from public, anon, authenticated;

-- No column-level grant on organization_id for UPDATE: the tenant anchor is
-- not editable, so the only way to move a layout between shops is to delete
-- one row and insert another, both of which need authority in BOTH shops.
grant select, insert, delete on table public.organization_dashboard_layouts to authenticated;
grant update (module_order, updated_by) on table public.organization_dashboard_layouts to authenticated;

commit;
