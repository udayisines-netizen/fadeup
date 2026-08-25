-- FadeUp — R1: durable professional identity
-- Migration: professionals, barbers.professional_id
--
-- THE DEFECT THIS FIXES
--
-- Until now a professional's identity IS `barbers.id`. That row is
-- organization-scoped and cascades from BOTH organizations and
-- staff_profiles, so:
--
--   * a barber who changes shop gets a new barbers.id — a new public
--     identity, and any followers/verified clients/social proof attached to
--     the old one would be orphaned;
--   * an externally-discovered professional (Worker) has no barbers row at
--     all — no org, no membership, no auth user — so today they cannot have
--     an identity in FadeUp.
--
-- `professionals` is the durable, organization-INDEPENDENT identity. One row
-- per real professional, surviving shop changes, role changes and membership
-- changes. `barbers` keeps its own id and every existing FK and public route
-- (`/s/:slug/barbers/:id`) untouched — it merely gains a pointer.
--
-- ONE TABLE FOR CLAIMED AND EXTERNAL IDENTITIES
--
-- user_id null  = unclaimed (an external profile Worker discovered)
-- user_id set   = claimed by a real FadeUp account
--
-- This is deliberate, and it is what makes external profiles safe. ALL
-- operational data — availability, services, working hours, appointments,
-- queue entries — hangs off `barbers`/`organizations`, never off
-- `professionals`. An unclaimed professional has no barbers row, so it is
-- STRUCTURALLY IMPOSSIBLE for a Worker-created profile to imply a bookable
-- slot, a live queue, a wait time or an active schedule. The guarantee is
-- the absence of the modelling, not a filter applied later.
--
-- WHY text + CHECK RATHER THAN ENUMS
--
-- Every state column here is expected to grow (verification tiers, claim
-- outcomes). `20260809100400_memberships.sql` already documents the cost of
-- the alternative — "adding a new role later requires alter type ... add
-- value" — and `profiles_locale_valid`/`profiles_theme_valid` already
-- establish text+CHECK as a repository convention for evolving value sets.
--
-- WHY NO citext FOR `handle`
--
-- citext is not installed, and installing it into `public` breaks the
-- universal `set search_path = ''` convention: with an empty search_path the
-- citext operator is unreachable, so comparisons silently degrade to
-- case-sensitive text while the unique index keeps its case-insensitive
-- opclass. The failure is silent and asymmetric. `unique (lower(handle))`
-- is what `customers_org_email_unique` already does.
--
-- Idempotent: safe to re-run. Statement-level idempotent, because migrations
-- are applied per-file with no explicit BEGIN — each statement autocommits,
-- so a mid-file failure must leave a re-runnable state.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professionals
-- ---------------------------------------------------------------------------

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),

  -- null = unclaimed/external. UNIQUE so one account never holds two
  -- identities. Note this does NOT by itself stop one identity being handed
  -- to a second account — see the claim takeover guard in
  -- 20260824100900_external_professional_claims.sql.
  user_id uuid unique references auth.users (id) on delete set null,

  -- Worker provenance. ON DELETE SET NULL, never CASCADE: platform admins can
  -- delete prospects, and a claimed professional identity must not disappear
  -- because someone tidied the sales pipeline.
  prospect_id uuid references public.prospects (id) on delete set null,

  -- Reserved for the social lots (R6/R7). Nullable so no backfill has to
  -- invent handles, but the uniqueness rule exists from day one.
  handle text,

  display_name text not null,
  headline text,
  bio text,
  avatar_url text,

  source text not null default 'fadeup',
  claim_state text not null default 'unclaimed',
  verification_state text not null default 'not_verified',

  -- Public visibility is OPT-IN and must never be inherited from
  -- staff_profiles.is_public (which defaults true). An inactive or private
  -- staff member becoming a public professional would be a privacy
  -- regression, and the columns share a name — which is exactly how that
  -- mistake gets made.
  is_public boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professionals_display_name_not_blank check (btrim(display_name) <> ''),
  constraint professionals_handle_format check (handle is null or handle ~ '^[a-z0-9_]{3,30}$'),
  constraint professionals_source_valid check (source in ('fadeup', 'worker')),
  constraint professionals_claim_state_valid check (claim_state in ('unclaimed', 'claim_pending', 'claimed')),
  constraint professionals_verification_state_valid check (verification_state in ('not_verified', 'pending', 'verified', 'revoked')),

  -- claim_state must not drift from ownership, or the public projection
  -- happily serves a "claimed" professional with no owner.
  --
  -- Stated as an IMPLICATION, not an equivalence. The strict form
  --     (claim_state = 'claimed') = (user_id is not null)
  -- is a trap: user_id is `on delete set null`, so deleting an auth account
  -- performs UPDATE professionals SET user_id = NULL, which leaves
  -- claim_state = 'claimed' and violates the constraint. Every backfilled
  -- professional is 'claimed', so the strict form makes it IMPOSSIBLE to
  -- delete any barber's account — breaking Supabase Auth admin deletion and
  -- GDPR erasure for every professional on the platform.
  --
  -- The implication says the thing that actually matters — a claimed identity
  -- always has an owner — while leaving room for the demotion trigger below
  -- to move the row to 'unclaimed' as the account disappears.
  constraint professionals_claim_state_matches_owner
    check (claim_state <> 'claimed' or user_id is not null)
);

comment on table public.professionals is
  'The durable, organization-independent professional identity. Survives shop changes, role changes and membership changes. Serves BOTH claimed identities (user_id set) and external/unclaimed ones discovered by Worker (user_id null). Carries no operational data by design — availability, services, hours, appointments and queue entries all remain anchored to barbers/organizations, which is what makes an unclaimed profile structurally incapable of implying FadeUp operational state.';

comment on column public.professionals.prospect_id is
  'Worker provenance. NOT exposed to any client role (see the column REVOKE below) — it is a join key into the entire prospect_* sales estate, and its mere presence discloses that this tenant was scraped before they signed up.';

comment on column public.professionals.is_public is
  'Opt-in. Never inherited from staff_profiles.is_public, which defaults to true.';

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'professionals_handle_lower_unique') then
    create unique index professionals_handle_lower_unique on public.professionals (lower(handle)) where handle is not null;
  end if;
end $$;

-- Not optional: with prospect_id ON DELETE SET NULL, every prospects delete
-- would otherwise seq-scan professionals.
create index if not exists professionals_prospect_id_idx on public.professionals (prospect_id) where prospect_id is not null;

create index if not exists professionals_public_idx on public.professionals (is_public) where is_public;

drop trigger if exists professionals_set_updated_at on public.professionals;
create trigger professionals_set_updated_at
  before update on public.professionals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1b. barbers.professional_id — the column only
--
-- Added here, ahead of the RLS policies below, because professionals_select
-- references it. Migrations run without an explicit BEGIN (each statement
-- autocommits), so a forward reference is a hard failure, not a deferred one.
-- The FK, its validation and its index live in section 5 with the rest of the
-- barbers work.
--
-- Nullable with no default: a catalog-only change, no table rewrite.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'barbers' and column_name = 'professional_id'
  ) then
    alter table public.barbers add column professional_id uuid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Column-level hardening
--
-- anon/authenticated hold blanket ALL privileges on every public table (the
-- Supabase image's default privileges); RLS is the only gate, and RLS has no
-- column granularity. Column REVOKEs are therefore the only real control
-- over which fields a client can read or write on a row it legitimately
-- reaches. PostgREST honours them.
-- ---------------------------------------------------------------------------

-- IMPORTANT MECHANIC: a column-level REVOKE cannot subtract from a
-- table-level grant. `anon`/`authenticated` hold table-level ALL here, so
-- `revoke update (col) ...` is a silent no-op — has_column_privilege still
-- returns true. The only way to express "every column except these" is to
-- revoke the privilege at TABLE level and re-grant the permitted columns.
--
-- SELECT: prospect_id and source are withheld. prospect_id is a join key into
-- the whole prospect_* sales estate; source discloses that this tenant was
-- scraped before they signed up. user_id is deliberately NOT withheld —
-- org members can already see the same person's staff_profiles.user_id, so
-- withholding it here buys nothing and would break ordinary
-- `?user_id=eq.<me>` lookups.
--
-- UPDATE: only presentational fields. Identity, provenance, claim and
-- verification are server-owned.

revoke select, update on public.professionals from authenticated, anon;

grant select (id, user_id, handle, display_name, headline, bio, avatar_url,
              claim_state, verification_state, is_public, created_at, updated_at)
  on public.professionals to authenticated;

grant update (handle, display_name, headline, bio, avatar_url, is_public)
  on public.professionals to authenticated;

-- Belt and braces: the REVOKE stops a direct client write, this stops any
-- path that reaches the row with more privilege than it should have.
-- Modelled on the existing guard_professional_application_update().
create or replace function public.guard_professional_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Three trusted paths stand down:
  --
  --  * auth.uid() null — a server-side path (trigger cascade, migration,
  --    scheduler), the same allowance professional_applications' guard makes;
  --  * a platform admin;
  --  * a session-local flag set by the claim RPCs.
  --
  -- The flag exists because SECURITY DEFINER does NOT change auth.uid():
  -- inside claim_professional_profile the caller is still the claimant, yet
  -- that function legitimately moves claim_state. Without the flag this guard
  -- blocks the very RPC that is supposed to own the transition. The pattern
  -- is the one 20260818200000_organization_creation_hardening.sql already
  -- established with fadeup.org_creation_authorized, including is_local =>
  -- true so it can never outlive the transaction that set it.
  if (select auth.uid()) is null
     or (select private.is_platform_admin())
     or coalesce(current_setting('fadeup.professional_identity_authorized', true), '') = 'on' then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.prospect_id is distinct from old.prospect_id
     or new.source is distinct from old.source
     or new.claim_state is distinct from old.claim_state
     or new.verification_state is distinct from old.verification_state then
    raise exception 'professionals: identity, provenance, claim and verification columns are not client-writable';
  end if;

  return new;
end;
$$;

drop trigger if exists professionals_guard_update on public.professionals;
create trigger professionals_guard_update
  before update on public.professionals
  for each row execute function public.guard_professional_update();

-- ---------------------------------------------------------------------------
-- 2b. Demote an identity whose owner's account has been deleted
--
-- user_id is `on delete set null`, so deleting an auth account issues
-- UPDATE professionals SET user_id = NULL. Without this trigger the row would
-- keep claim_state = 'claimed' with no owner: the constraint above tolerates
-- it (it is only an implication), but the public projection would then report
-- is_claimed = false while claim_state still said 'claimed', and no claim
-- could ever be filed against the orphan because claim_professional_profile
-- only accepts 'unclaimed' targets.
--
-- Referential-integrity actions DO fire row triggers, and this one sorts
-- before professionals_guard_update ('d' < 'g') so the demotion happens
-- before the guard inspects the row. The guard stands down anyway during an
-- admin delete, because auth.uid() is null on that path.
-- ---------------------------------------------------------------------------

create or replace function public.demote_orphaned_professional()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is not null and new.user_id is null then
    new.claim_state := 'unclaimed';
  end if;
  return new;
end;
$$;

comment on function public.demote_orphaned_professional() is
  'BEFORE UPDATE on professionals: when the owning auth account is deleted and user_id is set to NULL, returns the identity to unclaimed. Without it, deleting a barber''s account would leave a claimed-but-ownerless identity that nobody could ever claim again.';

drop trigger if exists professionals_demote_orphaned on public.professionals;
create trigger professionals_demote_orphaned
  before update on public.professionals
  for each row execute function public.demote_orphaned_professional();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
--
-- select: the professional themselves; org members for professionals linked
--   to a barber in their org (so a team roster can render); platform admin.
--   Anonymous/public reads go through get_public_professional() only.
-- insert/update/delete: no client INSERT or DELETE at all — identities are
--   created by the barbers trigger, the backfill, or a platform RPC. UPDATE
--   is limited to the professional's own presentational fields.
-- ---------------------------------------------------------------------------

alter table public.professionals enable row level security;
alter table public.professionals force row level security;

drop policy if exists professionals_select on public.professionals;
create policy professionals_select
  on public.professionals
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.barbers b
      where b.professional_id = professionals.id
        and (select private.is_org_member(b.organization_id))
    )
    or (select private.is_platform_admin())
  );

drop policy if exists professionals_update_own on public.professionals;
create policy professionals_update_own
  on public.professionals
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists professionals_update_platform on public.professionals;
create policy professionals_update_platform
  on public.professionals
  for update
  to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- 4. ensure_professional_for_user
--
-- The single idempotent way a FadeUp-native identity comes into existence.
-- Concurrency-safe: the insert arbitrates on the user_id unique index rather
-- than doing select-then-insert.
-- ---------------------------------------------------------------------------

create or replace function private.ensure_professional_for_user(p_user_id uuid, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  select id into v_id from public.professionals where user_id = p_user_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.professionals (user_id, display_name, source, claim_state)
  values (p_user_id, coalesce(nullif(btrim(p_display_name), ''), 'Professional'), 'fadeup', 'claimed')
  on conflict (user_id) do nothing
  returning id into v_id;

  -- Lost a concurrent race: the other transaction created it. Re-select
  -- rather than fail.
  if v_id is null then
    select id into v_id from public.professionals where user_id = p_user_id;
  end if;

  return v_id;
end;
$$;

comment on function private.ensure_professional_for_user(uuid, text) is
  'Idempotent find-or-create of the durable professional identity for an account. Race-safe via the user_id unique index, never select-then-insert.';

-- ---------------------------------------------------------------------------
-- 5. barbers.professional_id — FK, validation, index
--
-- The column itself was added in section 1b. The FK is added NOT VALID and
-- validated separately: a plain ADD CONSTRAINT ... FOREIGN KEY takes
-- SHARE ROW EXCLUSIVE on both tables and scans barbers while holding it,
-- blocking every write.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'barbers_professional_id_fkey'
  ) then
    -- ON DELETE RESTRICT is correct and deliberate. It fires only when
    -- deleting the REFERENCED professionals row; deleting an organization
    -- still cascades its barbers rows away and leaves the professional
    -- standing with zero barbers — precisely the durable-identity outcome.
    -- CASCADE here would mean deleting a professional cascades into
    -- appointments/barber_services/working_hours; SET NULL would silently
    -- orphan operational rows from identity.
    alter table public.barbers
      add constraint barbers_professional_id_fkey
      foreign key (professional_id) references public.professionals (id)
      on delete restrict
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'barbers_professional_id_fkey' and not convalidated
  ) then
    alter table public.barbers validate constraint barbers_professional_id_fkey;
  end if;
end $$;

-- Mandatory, not an optimisation: ON DELETE RESTRICT makes PostgreSQL search
-- barbers for referencing rows on every professionals delete. Unindexed that
-- is a seq scan under lock. Also serves the profile-load join.
create index if not exists barbers_professional_id_idx
  on public.barbers (professional_id) where professional_id is not null;

comment on column public.barbers.professional_id is
  'The durable professional identity this operational barber row belongs to. Assigned by trigger from staff_profiles.user_id — never client-supplied. Nullable only as a transitional state; see docs/v2/R1_MIGRATION_PLAN.md for the R2 SET NOT NULL step.';

-- ---------------------------------------------------------------------------
-- 6. Assignment trigger
--
-- Two problems solved by one trigger:
--
--   1. POPULATION. A backfill alone would link only today's rows; every
--      barber created afterwards would have professional_id null, silently
--      losing verified-client evidence for exactly the newest professionals.
--
--   2. CROSS-TENANT HIJACK. barbers_update's WITH CHECK constrains only
--      organization_id, so shop B's owner could PATCH their own barber row
--      to point at shop A's star professional — minting follows, relationships
--      and showcase requests attributed to a professional who has never
--      worked there.
--
-- The trigger therefore DERIVES professional_id authoritatively and ignores
-- whatever the client supplied. BEFORE, so it holds for service_role and
-- direct SQL too — the same reasoning as the existing
-- check_barber_staff_profile_consistency.
-- ---------------------------------------------------------------------------

create or replace function public.assign_barber_professional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_display_name text;
begin
  select sp.user_id, sp.display_name
    into v_user_id, v_display_name
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if v_user_id is null then
    return new;
  end if;

  new.professional_id := private.ensure_professional_for_user(v_user_id, v_display_name);
  return new;
end;
$$;

comment on function public.assign_barber_professional() is
  'BEFORE INSERT OR UPDATE on barbers: derives professional_id from staff_profiles.user_id, ignoring any client-supplied value. This is both the population path for new barbers and the guard against one organization pointing its barber row at another organization''s professional identity.';

-- Named `barbers_link_...` so it sorts AFTER
-- barbers_check_staff_profile_consistency ('l' > 'c') and the tenant
-- invariant is validated before identity is assigned. Same-timing triggers
-- fire in alphabetical order by name; this ordering is deliberate, not
-- incidental. (Either order is in fact safe, since all of them share one
-- transaction and a failed check aborts the statement regardless — but the
-- ordering should be chosen, not inherited from a name.)
drop trigger if exists barbers_assign_professional on public.barbers;
drop trigger if exists barbers_link_professional on public.barbers;
create trigger barbers_link_professional
  before insert or update on public.barbers
  for each row execute function public.assign_barber_professional();

-- Defence in depth. The trigger above already derives professional_id
-- unconditionally, so a client-supplied value is discarded regardless; this
-- makes the attempt fail loudly instead of silently. Same mechanic as above —
-- revoke UPDATE at table level, then re-grant every column except this one.
revoke update on public.barbers from authenticated, anon;
grant update (organization_id, staff_profile_id, is_bookable, created_at, updated_at)
  on public.barbers to authenticated;
