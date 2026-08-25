-- ============================================================================
-- FadeUp — MASTER: R1, social-first and acquisition domain foundation
-- Generated 2026-08-24. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r1.sh
-- Verify in sync:   scripts/generate-master-r1.sh --check
--
-- WHAT THIS IS
--
--   The first lot of the Social-First V2 rebuild allowed to change the domain
--   model. It establishes six new tables and extends four existing ones. It
--   drops nothing, rewrites nothing, and deletes no row.
--
--   1. PROFESSIONAL IDENTITY BECOMES DURABLE.
--
--      Until now a professional's public identity WAS `barbers.id` — a row
--      scoped to one organization and cascade-deleted with it. A barber
--      changing shop got a new identity, so followers, verified clients and
--      social proof would have been orphaned; and an externally discovered
--      professional could not have an identity at all.
--
--      `professionals` is org-independent and outlives membership. `barbers`
--      keeps its own id, so every public route (/s/:slug/barbers/:id) and
--      every existing foreign key is untouched — it merely gains a pointer.
--
--   2. ONE TABLE SERVES CLAIMED AND EXTERNAL IDENTITIES.
--
--      user_id null = an unclaimed profile Worker discovered. This is what
--      makes external profiles safe: all operational data (availability,
--      services, hours, appointments, queue) hangs off barbers/organizations,
--      never off professionals. An unclaimed professional has no barbers row,
--      so it is STRUCTURALLY IMPOSSIBLE for it to imply a bookable slot, a
--      live queue or a wait time. The guarantee is the absence of the
--      modelling, not a filter applied later.
--
--   3. FOLLOW AND VERIFIED CLIENT ARE SEPARATE, WITH SEPARATE EVIDENCE.
--
--      A follow is created by intent. A verified client is created by
--      COMPLETED service. Neither is ever derived from the other. A confirmed
--      booking may auto-follow; it is never evidence that a haircut happened.
--
--   4. AN EXPLICIT UNFOLLOW IS PERMANENT.
--
--      professional_follows.has_explicit_unfollow is sticky intent. A later
--      booking cannot silently re-follow someone the customer removed.
--
--   5. PUBLISHING A CLIENT REQUIRES THAT CLIENT'S CONSENT.
--
--      "Already cutting X" needs four independent facts: a genuine completed
--      relationship, the customer's approval, the customer's profile being
--      public, and — for the tick — live verification. The professional may
--      only ever ASK.
--
--   6. EVERY REGISTERED CUSTOMER NOW HAS A FADE PASSPORT.
--
--      customer_passports already existed and already enforced one per
--      account; it was simply never issued automatically and had no stable
--      identifier. Both are fixed here. No new table was created for it.
--
-- THE DECISION AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. WHY appointments AND queue_entries GAIN booked_by_user_id.
--
--      Attributing social facts through appointments.customer_id ->
--      customers.user_id is EXPLOITABLE, and the exploit is a descendant of
--      the one 20260813160000_claim_scope_fix.sql already removed.
--      link_customer_from_contact_info() attaches a booking to the CRM row it
--      matches from the CALLER-TYPED phone, then email. So an unauthenticated
--      caller who types a victim's phone number would have caused a follow
--      edge in the victim's name, and — once the shop marked it completed —
--      verified-client status with a barber the victim never met.
--
--      booked_by_user_id is stamped ONLY from auth.uid(), inside
--      book_public_appointment and join_public_queue. Anonymous bookings and
--      staff-created rows carry NULL and attribute to nobody.
--
--      CONSEQUENCE, STATED PLAINLY: a staff-created appointment and an
--      anonymous walk-in do NOT establish verified-client status, even when
--      genuinely completed, because FadeUp cannot prove which account
--      received that service. This is deliberate. It is also what stops a
--      shop inflating its own verified-client count by typing strangers'
--      phone numbers.
--
--   B. WHAT THIS DOES NOT DO. There is no plan, price, subscription or
--      entitlement column anywhere. claim_state answers "who controls this
--      identity", never "what have they paid for". A claimed profile is Free.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Creating a customer_profiles row now also issues a Fade Passport.
--   2. A signed-in customer's confirmed booking auto-follows that
--      professional, unless they have previously unfollowed them.
--   3. Completing an appointment or queue visit records a relationship.
--   4. book_public_appointment and join_public_queue keep identical
--      signatures and return shapes; they stamp one extra column.
--   5. No UI changes. R1 ships no frontend.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Adds no NOT NULL column to an existing table, so no table is rewritten.
--   * Drops no table, no column, no policy and no function.
--   * Deletes no row. The only UPDATEs are the two idempotent backfills.
--   * Every new table is created with RLS enabled AND forced.
--   * The barbers foreign key is added NOT VALID and validated separately, so
--     it never scans barbers under SHARE ROW EXCLUSIVE.
--   * All three new triggers on appointments/queue_entries are AFTER triggers
--     that contain their own errors: an ordinary failure inside them is logged
--     as a warning and discarded rather than rolling back the booking or the
--     queue completion. The one class they do not contain is a cancellation
--     (statement_timeout / pg_cancel_backend), which PL/pgSQL's OTHERS
--     deliberately excludes and which must abort the statement. Each trigger
--     does two index probes and one upsert.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260824100000_professional_identity.sql
-- ============================================================================

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


-- ============================================================================
-- END db/migrations/20260824100000_professional_identity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100100_professional_identity_backfill.sql
-- ============================================================================

-- FadeUp — R1: backfill durable professional identities
--
-- Separate from 20260824100000_professional_identity.sql on purpose: schema
-- migration and data migration are kept apart so each is understandable and
-- recoverable on its own (mission §10).
--
-- WHAT IT DOES
--
-- One `professionals` row per DISTINCT staff_profiles.user_id that has a
-- `barbers` row, then points every barbers row at it.
--
-- WHY "distinct user", NOT "one per barbers row"
--
-- staff_profiles is UNIQUE (organization_id, user_id) and barbers is UNIQUE
-- (staff_profile_id), so a person who is a barber at two shops has TWO
-- barbers rows. Keying the backfill on the barbers row would mint two
-- identities for one human — precisely the duplicate-identity outcome
-- mission §99 forbids. Keying on user_id yields one identity that both
-- barbers rows point at, which is the entire point of the table.
--
-- EDGE CASES, RESOLVED AGAINST THE REAL CONSTRAINTS
--
--   * Barber in two organizations -> 2 barbers rows, 1 professionals row,
--     both professional_id values equal. Correct and intended.
--   * staff_profiles.is_active = false -> still gets an identity. Identity is
--     not activity. Nothing leaks: professionals.is_public defaults false.
--   * A barbers row whose staff_profile was deleted -> IMPOSSIBLE.
--     barbers.staff_profile_id is NOT NULL with ON DELETE CASCADE, so the
--     barbers row is deleted with it. The join below cannot lose rows.
--
-- is_public IS NOT COPIED from staff_profiles. staff_profiles.is_public
-- defaults to TRUE; professionals.is_public defaults to FALSE and public
-- presence must be opted into deliberately. The columns share a name, which
-- is exactly how that privacy regression would get introduced.
--
-- IDEMPOTENT AND RESTART-SAFE
--
-- Both statements are guarded (`on conflict do nothing`,
-- `where professional_id is null`), so re-running is a no-op and an
-- interrupted run simply resumes. This matters because MASTER replays this
-- file against a database that already contains real rows.
--
-- NOTE ON AUDITABILITY: the UPDATE fires barbers_set_updated_at, rewriting
-- barbers.updated_at for every linked row. That is a one-off, migration-wide
-- timestamp churn, not a real edit — recorded here so it is not later
-- mistaken for activity.

set lock_timeout = '5s';

do $$
declare
  v_expected integer;
  v_before integer;
  v_after integer;
  v_unlinked integer;
begin
  select count(distinct sp.user_id)
    into v_expected
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id;

  select count(*) into v_before from public.professionals;

  -- DISTINCT ON needs a deterministic tie-break, or a user with staff
  -- profiles at two shops gets an arbitrary display_name — and a restarted
  -- migration could pick a different one, making the backfill restart-safe
  -- but not idempotent in content.
  insert into public.professionals (user_id, display_name, source, claim_state)
  select distinct on (sp.user_id)
    sp.user_id,
    coalesce(nullif(btrim(sp.display_name), ''), 'Professional'),
    'fadeup',
    'claimed'
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  order by sp.user_id, sp.created_at asc, sp.id asc
  on conflict (user_id) do nothing;

  select count(*) into v_after from public.professionals;

  update public.barbers b
  set professional_id = p.id
  from public.staff_profiles sp
  join public.professionals p on p.user_id = sp.user_id
  where sp.id = b.staff_profile_id
    and b.professional_id is null;

  select count(*) into v_unlinked from public.barbers where professional_id is null;

  raise notice 'R1 professional identity backfill: % distinct barber accounts expected, professionals % -> %, barbers still unlinked: %',
    v_expected, v_before, v_after, v_unlinked;
end $$;

-- Completeness assertion.
--
-- Deliberately NOT "count(professionals) = count(distinct barber users)":
-- that equality breaks the moment a legitimate non-backfill professional
-- exists (an external Worker profile, or a barber created after this ran),
-- so it is not a re-runnable assertion. The invariant that actually matters,
-- and stays true forever, is that no barbers row is left without an identity.
do $$
declare
  v_unlinked integer;
begin
  select count(*) into v_unlinked from public.barbers where professional_id is null;
  if v_unlinked > 0 then
    raise exception 'R1 backfill incomplete: % barbers rows have no professional_id', v_unlinked;
  end if;
end $$;

-- Every backfilled identity must be internally consistent: claimed implies an
-- owner. The table CHECK already enforces this, but asserting it here turns a
-- silent future regression in the backfill query into a loud migration
-- failure.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.professionals
  where (claim_state = 'claimed') <> (user_id is not null);
  if v_bad > 0 then
    raise exception 'R1 backfill produced % professionals with claim_state/user_id disagreement', v_bad;
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260824100100_professional_identity_backfill.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100200_attribution_provenance.sql
-- ============================================================================

-- FadeUp — R1: trustworthy attribution provenance
-- Migration: appointments.booked_by_user_id, queue_entries.booked_by_user_id
--
-- WHY THIS EXISTS — read this before changing anything below.
--
-- R1 attaches social meaning (auto-follow, verified-client relationships) to
-- bookings. Deciding WHOSE account a booking belongs to is therefore now a
-- security decision, and the obvious answer is wrong.
--
-- The obvious answer is appointments.customer_id -> customers.user_id. But
-- link_customer_from_contact_info() (BEFORE INSERT on BOTH appointments and
-- queue_entries, 20260809180100) find-or-creates that customers row by
-- matching the CALLER-TYPED customer_phone, then lower(customer_email). The
-- row a booking lands on is chosen by data the booker supplies. This is the
-- same untrusted edge 20260813160000_claim_scope_fix.sql was written to stop
-- trusting.
--
-- The attack it would enable:
--
--   1. Victim V books once while signed in. resolve_customer_for_user stamps
--      V's phone/email onto V's own linked CRM row R (R.user_id = V).
--   2. Attacker A, SIGNED OUT, calls book_public_appointment at that shop and
--      types V's phone. auth.uid() is null, so customer_id stays null and the
--      trigger matches R.
--   3. book_public_appointment inserts that row ALREADY status='confirmed'.
--      Naive attribution would resolve R.user_id = V and create
--      professional_follows(follower_user_id = V, source='auto') — a public
--      social action forged in V's name, by an unauthenticated caller.
--   4. When the shop completes it, V becomes a "verified client" of a barber
--      V has never met, and the shop learns V's auth.users UUID.
--
-- join_public_queue is a cheaper variant: no slot, no service, and shops
-- complete queue entries as routine work.
--
-- created_by CANNOT be used as the signal — both self-service RPCs insert
-- created_by = null explicitly (see the unchanged bodies below).
--
-- THE FIX
--
-- Record the trustworthy fact explicitly instead of inferring it. Both RPCs
-- already compute the right value and discard it: when the caller is
-- authenticated they resolve customer_id through
-- private.resolve_customer_for_user, which matches ON user_id ONLY, never on
-- a typed-in phone. booked_by_user_id preserves that distinction.
--
--   authenticated self-service booking -> booked_by_user_id = auth.uid()
--   anonymous booking                  -> NULL
--   staff-created row                  -> NULL (staff never call these RPCs)
--
-- R1's attribution triggers require booked_by_user_id IS NOT NULL *and*
-- booked_by_user_id = customers.user_id. The attacker's booking carries NULL,
-- so it attributes to nobody. Nothing is ever attributed to an account that
-- did not itself act.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It does not add `and c.user_id is null` to link_customer_from_contact_info().
-- That was considered and rejected: (a) it would not work, because that
-- function's `on conflict do nothing` is followed by an UNFILTERED re-select
-- fallback that lands straight back on the victim's row; and (b) filtering the
-- fallback too would stop legitimate anonymous re-bookings from linking to
-- their own CRM row, silently breaking get_my_appointments — a booking
-- regression, which mission §48 forbids. The root defect belongs to the lot
-- that owns that trigger; see docs/v2/DEPRECATIONS.md.
--
-- THE TWO FUNCTION BODIES BELOW ARE REPRODUCED VERBATIM from their current
-- definitions (book_public_appointment from 20260819210000_booking_auto_confirm.sql,
-- join_public_queue from 20260813160000_claim_scope_fix.sql) with exactly TWO
-- lines changed in each: the insert column list and the insert values list.
-- Signatures, parameters, return shapes, validation, claim-token issuance and
-- grants are all unchanged. Nothing about booking behaviour changes.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The provenance columns
--
-- Nullable, no default -> catalog-only change, no table rewrite, brief lock.
-- ON DELETE SET NULL: deleting an account must not delete the shop's
-- appointment history.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'booked_by_user_id'
  ) then
    alter table public.appointments
      add column booked_by_user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'queue_entries' and column_name = 'booked_by_user_id'
  ) then
    alter table public.queue_entries
      add column booked_by_user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

comment on column public.appointments.booked_by_user_id is
  'The authenticated account that ITSELF created this booking, stamped from auth.uid() inside book_public_appointment. NULL for anonymous bookings and for rows created by staff. This is the ONLY trustworthy account attribution for an appointment: customer_id is resolved from caller-typed contact details and must never be used to attribute social or verified-client facts.';

comment on column public.queue_entries.booked_by_user_id is
  'The authenticated account that ITSELF joined this queue, stamped from auth.uid() inside join_public_queue. NULL for anonymous kiosk check-in and staff-added walk-ins. Same trust rule as appointments.booked_by_user_id.';

-- A client must never be able to assert this column — that would hand the
-- attacker back exactly the forgery this migration removes. Column-level
-- REVOKE cannot subtract from a table-level grant, so the privilege is
-- revoked at table level and every other column re-granted.
-- INSERT is revoked as well as UPDATE, and that is not belt-and-braces — it
-- is the difference between the attribution guarantee holding and not.
--
-- Revoking only UPDATE leaves the column forgeable in one step, because
-- `authenticated` holds blanket table-level INSERT and appointments_insert's
-- RLS only checks org role. A shop owner could therefore:
--
--   1. insert a customers row carrying any auth.users UUID they know
--      (customers.user_id is INSERT-grantable and has no guard), then
--   2. insert an appointment with status='completed' and
--      booked_by_user_id = that victim's UUID,
--
-- and mint a verified-client relationship — or, with status='confirmed', a
-- public follow edge — in the name of a customer who never acted. Shops
-- legitimately hold their own customers' UUIDs, so the precondition is met
-- for every real customer they have.
--
-- The two self-service RPCs are unaffected: they are SECURITY DEFINER owned
-- by postgres, which is not subject to these grants.
revoke insert, update on public.appointments from authenticated, anon;
grant insert (organization_id, location_id, barber_id, chair_id, service_id,
              customer_name, customer_phone, customer_email, starts_at, ends_at,
              buffer_before_minutes, buffer_after_minutes, status, notes,
              created_by, created_at, updated_at, customer_id, expires_at,
              resolution, resolution_note, decided_at, decided_by, rescheduled_to)
  on public.appointments to authenticated;
grant update (organization_id, location_id, barber_id, chair_id, service_id,
              customer_name, customer_phone, customer_email, starts_at, ends_at,
              buffer_before_minutes, buffer_after_minutes, status, notes,
              created_by, created_at, updated_at, customer_id, expires_at,
              resolution, resolution_note, decided_at, decided_by, rescheduled_to)
  on public.appointments to authenticated;

revoke insert, update on public.queue_entries from authenticated, anon;
grant insert (organization_id, location_id, barber_id, service_id, customer_name,
              customer_phone, status, notes, called_at, service_started_at,
              completed_at, created_by, created_at, updated_at, customer_id)
  on public.queue_entries to authenticated;
grant update (organization_id, location_id, barber_id, service_id, customer_name,
              customer_phone, status, notes, called_at, service_started_at,
              completed_at, created_by, created_at, updated_at, customer_id)
  on public.queue_entries to authenticated;

-- Attribution lookups filter on this column for a single account.
create index if not exists appointments_booked_by_user_id_idx
  on public.appointments (booked_by_user_id) where booked_by_user_id is not null;
create index if not exists queue_entries_booked_by_user_id_idx
  on public.queue_entries (booked_by_user_id) where booked_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. book_public_appointment — verbatim, +2 lines
-- ---------------------------------------------------------------------------

create or replace function public.book_public_appointment(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  claim_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_timezone text;
  v_duration_minutes integer;
  v_buffer_before_minutes integer;
  v_buffer_after_minutes integer;
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_user_id uuid;
  v_customer_id uuid;
  v_claim_token text;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' and coalesce(btrim(p_customer_email), '') = '' then
    raise exception 'at least one of customer_phone or customer_email is required';
  end if;

  if p_starts_at <= now() then
    raise exception 'starts_at must be in the future';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then
    raise exception 'location is not available for booking';
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    raise exception 'service is not available for booking at this location';
  end if;

  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    raise exception 'barber is not available for this service at this location';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  -- The client is never trusted to have only ever requested a time we offered.
  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours';
  end if;

  -- Signed-in booker: resolve (or create) their own CRM row for this shop so
  -- the appointment is owned from the moment it exists. Anonymous booker:
  -- v_customer_id stays null and a claim token is issued below. (LOT 13.)
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, p_customer_email
    );
  end if;

  -- CONFIRMED, not pending. Everything above has already established that the
  -- shop works this time, at this place, for this service, with this
  -- professional — there is no further question for a human to answer.
  --
  -- decided_at/decided_by stay NULL on purpose: nobody decided. That is what
  -- distinguishes an auto-confirmed booking from one a receptionist accepted,
  -- and it is worth being able to tell them apart later.
  --
  -- appointments_check_time_blocks (LOT D) runs before the insert lands, and
  -- the GiST exclusion constraints remain the final race-free authority: two
  -- visitors racing this exact slot still produce exactly one appointment.
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by, booked_by_user_id
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'confirmed', p_notes, null, v_user_id
  )
  returning * into v_appointment;

  -- Anonymous booking: issue the one-time proof-of-booking token. (LOT 13.)
  if v_user_id is null then
    v_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.appointment_claim_tokens (appointment_id, token_hash, expires_at)
    values (
      v_appointment.id,
      encode(extensions.digest(v_claim_token, 'sha256'), 'hex'),
      now() + interval '72 hours'
    );
  end if;

  return query select v_appointment.id, v_appointment.starts_at, v_appointment.ends_at, v_appointment.status, v_claim_token;
end;
$$;

comment on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) is
  'Anon-callable: the only path to create an appointment without a session. Creates status=CONFIRMED — the shop already answered by publishing the slot. Every id is re-validated against the organization resolved from the slug, the window is re-derived server-side through private.slot_is_within_hours, time blocks are enforced by trigger, and the LOT 8 GiST exclusion constraints remain the final race-free conflict guarantee. Signed-in bookers get customer_id stamped; anonymous ones get a single-use 72h claim_token.';

revoke execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. join_public_queue — verbatim, +2 lines
-- ---------------------------------------------------------------------------

create or replace function public.join_public_queue(
  p_organization_slug text,
  p_location_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_barber_id uuid default null,
  p_service_id uuid default null
)
returns table (id uuid, status public.queue_status, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
  v_user_id uuid;
  v_customer_id uuid;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active
  ) then
    raise exception 'location is not available';
  end if;

  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
  ) then
    raise exception 'requested barber is not available';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
  ) then
    raise exception 'requested service is not available';
  end if;

  -- Signed-in walk-in: attach the entry to the caller's OWN customer record
  -- for this shop so get_my_queue_status can find it. Anonymous kiosk
  -- check-in leaves this null and behaves exactly as before.
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by, booked_by_user_id)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null, v_user_id)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;

comment on function public.join_public_queue(text, uuid, text, text, uuid, uuid) is
  'Anon-callable kiosk self-check-in: adds a waiting queue_entries row. SECURITY DEFINER — re-validates organization/location/barber/service against the slug, same pattern as book_public_appointment (LOT 9). When the caller is authenticated, stamps customer_id with their own CRM row for that shop (resolved on user_id only, never on a typed-in phone) so the entry is visible through get_my_queue_status.';

revoke execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) from public;
grant execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) to anon, authenticated;


-- ============================================================================
-- END db/migrations/20260824100200_attribution_provenance.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100300_social_graph_follows.sql
-- ============================================================================

-- FadeUp — R1: the social graph
-- Migration: professional_follows + follow/unfollow RPCs + auto-follow
--
-- FOLLOW IS NOT FAVOURITE, AND FOLLOW IS NOT VERIFIED CLIENT.
--
-- customer_favorites (20260813130000) already exists and is KEPT: it is a
-- private, owner-only bookmark with no public projection. A follow is a
-- public social edge with intent history. Different concepts, both real,
-- neither replaces the other.
--
-- Follower and Verified Client are separate relationships with separate
-- sources of truth and must never be derived from one another. A follow is
-- created by intent; a verified client is created by completed service (see
-- 20260824100400). Nothing in this file reads or writes relationships, and
-- nothing in that file reads or writes follows.
--
-- ONE ROW PER EDGE, MUTATED IN PLACE
--
-- The unique (follower_user_id, professional_id) constraint is what makes
-- Follow idempotent and race-safe: every write is
-- `insert ... on conflict ... do update`, never select-then-insert. Two
-- concurrent Follow requests serialise on one row lock and produce one edge.
--
-- EXPLICIT UNFOLLOW IS STICKY
--
-- has_explicit_unfollow is the intent flag that makes an Unfollow mean
-- something. Once the customer deliberately unfollows, auto-follow must never
-- silently re-follow them on their next booking. Only a deliberate manual
-- Follow clears it.
--
--   manual follow    -> following  / manual / has_explicit_unfollow = false
--   manual unfollow  -> unfollowed / manual / has_explicit_unfollow = TRUE
--   auto, no row     -> following  / auto   / false
--   auto, flag set   -> NOTHING HAPPENS
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professional_follows
-- ---------------------------------------------------------------------------

create table if not exists public.professional_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references auth.users (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,

  state text not null default 'following',
  source text not null default 'manual',

  -- Sticky. Set by a manual unfollow, cleared only by a manual follow.
  has_explicit_unfollow boolean not null default false,

  followed_at timestamptz,
  unfollowed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_follows_unique unique (follower_user_id, professional_id),
  constraint professional_follows_state_valid check (state in ('following', 'unfollowed')),
  constraint professional_follows_source_valid check (source in ('manual', 'auto')),

  -- No legal action produces this combination. Encoding it means the §17
  -- invariant is protected by the database rather than by every write path
  -- remembering the rule.
  constraint professional_follows_intent_consistent
    check (not (state = 'following' and has_explicit_unfollow))
);

comment on table public.professional_follows is
  'The social graph edge: one row per (customer account, professional), mutated in place. state is the current edge; has_explicit_unfollow is durable intent that survives it. Never derived from bookings, and never used to derive verified-client status.';

comment on column public.professional_follows.has_explicit_unfollow is
  'TRUE once the customer has deliberately unfollowed. Suppresses auto-follow permanently until they deliberately follow again. Not client-writable — a PATCH setting this false would erase the opt-out.';

-- Follower count: partial index so the count touches only live edges.
create index if not exists professional_follows_professional_following_idx
  on public.professional_follows (professional_id) where state = 'following';

-- "Professionals I follow", newest first. follower_user_id leads, which is
-- also the RLS predicate column, so the policy is index-friendly.
create index if not exists professional_follows_follower_recent_idx
  on public.professional_follows (follower_user_id, followed_at desc) where state = 'following';

-- NOTE: no bare (follower_user_id) index — it is a strict prefix of
-- professional_follows_unique and would be redundant.

drop trigger if exists professional_follows_set_updated_at on public.professional_follows;
create trigger professional_follows_set_updated_at
  before update on public.professional_follows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — read your own edges, write nothing directly
--
-- There is deliberately NO INSERT, UPDATE or DELETE policy. All mutation goes
-- through the SECURITY DEFINER functions below, which own the state machine.
-- A client able to write this table directly could set state/source/
-- has_explicit_unfollow into combinations the state machine never produces.
--
-- Follower COUNTS are public, via the projection RPC. The follower LIST is
-- not exposed in R1.
-- ---------------------------------------------------------------------------

alter table public.professional_follows enable row level security;
alter table public.professional_follows force row level security;

drop policy if exists professional_follows_select on public.professional_follows;
create policy professional_follows_select
  on public.professional_follows
  for select
  to authenticated
  using (
    follower_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- Belt and braces alongside "no write policy": RLS already denies these, this
-- makes the intent explicit and survives someone adding a policy carelessly.
revoke insert, update, delete on public.professional_follows from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. follow_professional / unfollow_professional
-- ---------------------------------------------------------------------------

create or replace function public.follow_professional(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'follow_professional requires an authenticated session';
  end if;

  if not exists (select 1 from public.professionals where id = p_professional_id) then
    raise exception 'professional not found';
  end if;

  -- Idempotent by constraint, not by prior SELECT. A deliberate follow also
  -- clears the sticky unfollow — the customer has opted back in.
  insert into public.professional_follows (
    follower_user_id, professional_id, state, source, has_explicit_unfollow, followed_at
  )
  values (v_user_id, p_professional_id, 'following', 'manual', false, now())
  on conflict (follower_user_id, professional_id) do update
  set state = 'following',
      source = 'manual',
      has_explicit_unfollow = false,
      followed_at = coalesce(public.professional_follows.followed_at, now()),
      unfollowed_at = null;
end;
$$;

comment on function public.follow_professional(uuid) is
  'Authenticated-only. Idempotent manual Follow — repeated calls produce one edge. Clears any previous explicit-unfollow intent, since the customer has deliberately opted back in.';

revoke execute on function public.follow_professional(uuid) from public, anon;
grant execute on function public.follow_professional(uuid) to authenticated;

create or replace function public.unfollow_professional(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'unfollow_professional requires an authenticated session';
  end if;

  -- Recorded even if no edge exists: "I do not want to follow this person"
  -- is meaningful intent on its own, and it is what stops a later booking
  -- from auto-following them.
  insert into public.professional_follows (
    follower_user_id, professional_id, state, source, has_explicit_unfollow, unfollowed_at
  )
  values (v_user_id, p_professional_id, 'unfollowed', 'manual', true, now())
  on conflict (follower_user_id, professional_id) do update
  set state = 'unfollowed',
      source = 'manual',
      has_explicit_unfollow = true,
      unfollowed_at = now();
end;
$$;

comment on function public.unfollow_professional(uuid) is
  'Authenticated-only. Idempotent manual Unfollow. Records durable intent (has_explicit_unfollow) so a later eligible booking cannot silently re-follow the professional.';

revoke execute on function public.unfollow_professional(uuid) from public, anon;
grant execute on function public.unfollow_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. try_auto_follow
--
-- Never overrides intent. If any row already exists — following, or
-- unfollowed with the sticky flag — this does nothing at all.
-- ---------------------------------------------------------------------------

create or replace function private.try_auto_follow(p_user_id uuid, p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_professional_id is null then
    return;
  end if;

  -- do nothing (not do update): an existing edge always wins, whatever its
  -- state. This single clause is what makes an explicit Unfollow permanent.
  insert into public.professional_follows (
    follower_user_id, professional_id, state, source, has_explicit_unfollow, followed_at
  )
  values (p_user_id, p_professional_id, 'following', 'auto', false, now())
  on conflict (follower_user_id, professional_id) do nothing;
end;
$$;

comment on function private.try_auto_follow(uuid, uuid) is
  'Best-effort, idempotent auto-follow. ON CONFLICT DO NOTHING, so it never overrides an existing edge — an explicitly unfollowed professional is never re-followed, and a retried booking never creates a duplicate.';

-- ---------------------------------------------------------------------------
-- 5. Auto-follow on a confirmed booking
--
-- FIRES ON INSERT OR UPDATE, and that is essential rather than defensive:
-- book_public_appointment inserts rows ALREADY status='confirmed', and
-- appointments.status itself defaults to 'confirmed'. An UPDATE-only trigger
-- would be dead code on the primary booking path.
--
-- ATTRIBUTION: booked_by_user_id only — see 20260824100200 for why
-- customer_id must never be trusted for this. The customers row is
-- additionally required to belong to that same account, so a future code
-- path that stamps booked_by_user_id without resolving the customer properly
-- loses a follow (harmless) rather than forging one.
--
-- SECURITY DEFINER is required, not stylistic: appointments can be updated by
-- a plain PostgREST PATCH as role `authenticated`, which has no write access
-- to professional_follows and is subject to FORCE RLS. An invoker-rights
-- trigger would raise 42501 and abort the booking.
--
-- FAILURE CONTAINMENT, STATED ACCURATELY.
--
-- Early returns cover the expected misses. The exception block covers
-- ordinary errors — unique and FK violations, deadlock, serialization
-- failure, an FK racing a user deletion — so a dropped auto-follow is a lost
-- side-effect rather than a rolled-back booking.
--
-- It does NOT cover everything, and the difference matters: PL/pgSQL's
-- OTHERS deliberately does not match QUERY_CANCELED or ASSERT_FAILURE. A
-- statement_timeout (Supabase sets one per role) therefore still aborts the
-- statement, and with it the booking. That is the correct behaviour — a
-- trigger must not swallow a cancellation the server or the client asked for
-- — but it means "this can never break a booking" would be an overclaim. The
-- honest statement is: this cannot break a booking through any error it is
-- allowed to catch, and the work it does is two index probes and one upsert.
--
-- Auto-follow is explicitly best-effort and lossy. Unlike relationships it is
-- NOT reconstructible, because reconciliation could not distinguish "never
-- followed" from "explicitly unfollowed".
-- ---------------------------------------------------------------------------

create or replace function public.appointments_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.booked_by_user_id is null or new.barber_id is null then
    return new;
  end if;

  -- The account that acted must also own the CRM row this booking landed on.
  if new.customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.user_id = new.booked_by_user_id
  ) then
    return new;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = new.barber_id;

  if v_professional_id is null then
    return new;
  end if;

  perform private.try_auto_follow(new.booked_by_user_id, v_professional_id);
  return new;

exception when others then
  raise warning 'appointments_auto_follow suppressed error for appointment %: %', new.id, sqlerrm;
  return new;
end;
$$;

comment on function public.appointments_auto_follow() is
  'AFTER INSERT OR UPDATE on appointments: on reaching status=confirmed, auto-follows the professional on behalf of the account that ITSELF made the booking. Attributes only via booked_by_user_id, never via caller-typed contact details. Best-effort — never raises, so it cannot break a booking.';

-- Named appointments_social_* so it sorts AFTER the existing operational
-- trigger appointments_notify_new ('s' > 'n'). Deliberate, not incidental.
drop trigger if exists appointments_social_auto_follow on public.appointments;
create trigger appointments_social_auto_follow
  after insert or update on public.appointments
  for each row execute function public.appointments_auto_follow();


-- ============================================================================
-- END db/migrations/20260824100300_social_graph_follows.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100400_customer_professional_relationships.sql
-- ============================================================================

-- FadeUp — R1: genuine customer <-> professional relationships
-- Migration: customer_professional_relationships + completion triggers
--
-- CONFIRMED IS NOT COMPLETED.
--
-- A confirmed booking is enough to auto-follow (20260824100300). It is NOT
-- evidence that a haircut happened. Only a completed appointment or a
-- completed queue visit establishes a relationship, and therefore
-- Verified Client status. A future-dated confirmed appointment can never
-- produce one.
--
-- HYBRID MATERIALISED AGGREGATE
--
-- appointments and queue_entries remain the SOURCE OF TRUTH. This table is a
-- rebuildable aggregate over them, maintained on completion. Chosen over pure
-- derivation because a public profile load would otherwise aggregate the two
-- largest tables in the system per professional on every view; chosen over an
-- independent materialisation because "rebuildable" means any bug is
-- correctable by recomputation instead of restore. rebuild_customer_
-- professional_relationships() below is what makes that claim real.
--
-- WHY organization_id IS IN THE UNIQUE KEY
--
-- This is the whole point of the shop dimension, and getting it wrong is a
-- cross-tenant leak. With a two-column key (customer, professional), an
-- upsert would overwrite organization_id with whichever shop most recently
-- completed a service. Concretely: professional P serves customer C twenty
-- times at shop A, then moves to shop B — the exact scenario the durable
-- professionals table exists to support — and serves C once. Shop B would
-- then read completed_interaction_count = 21 with first_completed_at from two
-- years earlier: twenty services transacted at a competitor, exposed to B.
-- Shop A would simultaneously lose access to history that genuinely happened
-- at A. A row's tenant would be decided by a write from a different tenant.
--
-- One row per (customer, professional, shop). "Is a verified client of P" is
-- then an EXISTS across that professional's rows, computed in the projection
-- RPC — the aggregate is the professional's fact, the row is the tenant's.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. customer_professional_relationships
-- ---------------------------------------------------------------------------

create table if not exists public.customer_professional_relationships (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- NOT NULL + CASCADE, deliberately. This is an aggregate whose evidence
  -- (appointments, queue_entries) already cascades from organizations.
  -- Keeping the aggregate after its evidence is gone would assert history
  -- that can no longer be rebuilt. Durability (§14) is a promise about
  -- IDENTITY — professionals rows survive shop deletion — not about per-shop
  -- service history whose underlying records have been erased.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  first_completed_at timestamptz not null,
  last_completed_at timestamptz not null,
  completed_interaction_count integer not null default 0,
  established_by text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_professional_relationships_unique
    unique (customer_user_id, professional_id, organization_id),
  constraint customer_professional_relationships_count_non_negative
    check (completed_interaction_count >= 0),
  constraint customer_professional_relationships_established_by_valid
    check (established_by in ('appointment', 'queue')),
  constraint customer_professional_relationships_dates_ordered
    check (last_completed_at >= first_completed_at)
);

comment on table public.customer_professional_relationships is
  'Genuine completed-service relationships, one row per (customer account, professional, organization). A rebuildable aggregate over appointments/queue_entries, which remain the source of truth. Verified Client means a row here with completed_interaction_count >= 1 — it is NEVER derived from follows, and follows are never derived from it.';

comment on column public.customer_professional_relationships.organization_id is
  'The shop where these services happened. Part of the unique key and immutable: without it, a professional changing shop would carry the previous shop''s service history into the new shop''s RLS scope.';

-- Verified-client count for a professional, across shops.
create index if not exists customer_professional_relationships_professional_idx
  on public.customer_professional_relationships (professional_id);

-- The org-member read path.
create index if not exists customer_professional_relationships_org_idx
  on public.customer_professional_relationships (organization_id, last_completed_at desc);

-- NOTE: deliberately NOT partial on completed_interaction_count >= 1 — the
-- writers never insert a zero, so the predicate is always true and would only
-- cost planner time.

drop trigger if exists customer_professional_relationships_set_updated_at on public.customer_professional_relationships;
create trigger customer_professional_relationships_set_updated_at
  before update on public.customer_professional_relationships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Immutability guard
--
-- The unique key stops a duplicate; this stops the tenant of an existing row
-- being reassigned, which would move a shop's history into another shop's
-- RLS scope without creating any new row at all.
-- ---------------------------------------------------------------------------

create or replace function public.guard_relationship_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id is distinct from old.professional_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'customer_professional_relationships: identity columns are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_professional_relationships_guard on public.customer_professional_relationships;
create trigger customer_professional_relationships_guard
  before update on public.customer_professional_relationships
  for each row execute function public.guard_relationship_update();

-- ---------------------------------------------------------------------------
-- 3. RLS — read only, and never by another tenant
--
-- NO INSERT, UPDATE or DELETE policy exists. This table is trigger-maintained
-- exclusively. Without that rule an authenticated user could POST themselves
-- a relationship with completed_interaction_count = 99 against any
-- professional and forge Verified Client status outright.
--
-- The SECURITY DEFINER triggers write through FORCE RLS because they are
-- owned by postgres (rolbypassrls). This is the same shape
-- appointment_claim_tokens already uses: enable + force, zero policies, and
-- all writes via definer functions.
-- ---------------------------------------------------------------------------

alter table public.customer_professional_relationships enable row level security;
alter table public.customer_professional_relationships force row level security;

drop policy if exists customer_professional_relationships_select on public.customer_professional_relationships;
create policy customer_professional_relationships_select
  on public.customer_professional_relationships
  for select
  to authenticated
  using (
    -- the customer themselves
    customer_user_id = (select auth.uid())
    -- the professional the relationship is about
    or exists (
      select 1 from public.professionals p
      where p.id = customer_professional_relationships.professional_id
        and p.user_id = (select auth.uid())
    )
    -- members of the shop where it happened — and ONLY that shop
    or (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

revoke insert, update, delete on public.customer_professional_relationships from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. record_service_relationship
--
-- The one write path. Idempotent per completion event by construction of the
-- unique key; a retried completion increments the counter, which is correct —
-- each genuine completion is a genuine interaction.
-- ---------------------------------------------------------------------------

create or replace function private.record_service_relationship(
  p_customer_user_id uuid,
  p_professional_id uuid,
  p_organization_id uuid,
  p_occurred_at timestamptz,
  p_evidence text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer_user_id is null or p_professional_id is null or p_organization_id is null then
    return;
  end if;

  insert into public.customer_professional_relationships (
    customer_user_id, professional_id, organization_id,
    first_completed_at, last_completed_at, completed_interaction_count, established_by
  )
  values (
    p_customer_user_id, p_professional_id, p_organization_id,
    coalesce(p_occurred_at, now()), coalesce(p_occurred_at, now()), 1, p_evidence
  )
  on conflict (customer_user_id, professional_id, organization_id) do update
  set first_completed_at = least(
        public.customer_professional_relationships.first_completed_at,
        excluded.first_completed_at),
      last_completed_at = greatest(
        public.customer_professional_relationships.last_completed_at,
        excluded.last_completed_at),
      completed_interaction_count =
        public.customer_professional_relationships.completed_interaction_count + 1;
  -- established_by is deliberately not updated: it records what FIRST
  -- established the relationship.
end;
$$;

comment on function private.record_service_relationship(uuid, uuid, uuid, timestamptz, text) is
  'The single write path for completed-service relationships. Upsert on the (customer, professional, organization) key; keeps the earliest first_completed_at and the latest last_completed_at, and preserves the original established_by.';

-- ---------------------------------------------------------------------------
-- 5. Completion triggers
--
-- SECURITY DEFINER is REQUIRED, not stylistic. Queue completion is not an
-- RPC — apps/web/src/lib/queries/queue.ts issues a raw PostgREST PATCH as
-- role `authenticated`, which has no write access here and is subject to
-- FORCE RLS. An invoker-rights trigger would raise 42501, abort the PATCH,
-- and a barber could not mark a client done.
--
-- INSERT OR UPDATE, because a completed row can be inserted directly (a
-- manager via PostgREST), not only transitioned into.
--
-- FAILURE CONTAINMENT, STATED ACCURATELY. Early returns cover expected
-- misses; the exception block covers ordinary errors — deadlock,
-- serialization failure, FK races, constraint violations. It does NOT cover
-- QUERY_CANCELED or ASSERT_FAILURE, which PL/pgSQL's OTHERS deliberately
-- excludes, so a statement_timeout still aborts the statement and with it the
-- completion. That is correct: a trigger must not swallow a cancellation.
--
-- Swallowing the rest is defensible HERE AND NOWHERE ELSE in this codebase
-- precisely because this table is rebuildable — see section 6. A dropped
-- aggregate row is recoverable; a rolled-back haircut is not. The warning
-- keeps it visible in logs rather than truly silent.
--
-- ATTRIBUTION is via booked_by_user_id only, never customer_id -> user_id.
-- See 20260824100200 for the attack that rule prevents.
-- ---------------------------------------------------------------------------

create or replace function public.appointments_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.booked_by_user_id is null or new.barber_id is null then
    return new;
  end if;

  if new.customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.user_id = new.booked_by_user_id
  ) then
    return new;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = new.barber_id;

  if v_professional_id is null then
    return new;
  end if;

  -- starts_at, not now(): the time the service happened, so a rebuild from
  -- source reproduces exactly the same value.
  perform private.record_service_relationship(
    new.booked_by_user_id, v_professional_id, new.organization_id,
    new.starts_at, 'appointment'
  );
  return new;

exception when others then
  raise warning 'appointments_relationship suppressed error for appointment %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists appointments_social_relationship on public.appointments;
create trigger appointments_social_relationship
  after insert or update on public.appointments
  for each row execute function public.appointments_relationship();

create or replace function public.queue_entries_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  -- queue_entries.barber_id is NULLABLE (an unassigned walk-in, or a barber
  -- row since deleted via ON DELETE SET NULL). No barber means no
  -- professional to relate to.
  if new.booked_by_user_id is null or new.barber_id is null then
    return new;
  end if;

  if new.customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.user_id = new.booked_by_user_id
  ) then
    return new;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = new.barber_id;

  if v_professional_id is null then
    return new;
  end if;

  -- coalesce(completed_at, updated_at) — the SAME expression the rebuild uses,
  -- so recomputing from source reproduces this row exactly rather than
  -- inventing a different timestamp for the same visit.
  perform private.record_service_relationship(
    new.booked_by_user_id, v_professional_id, new.organization_id,
    coalesce(new.completed_at, new.updated_at, now()), 'queue'
  );
  return new;

exception when others then
  raise warning 'queue_entries_relationship suppressed error for queue entry %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists queue_entries_social_relationship on public.queue_entries;
create trigger queue_entries_social_relationship
  after insert or update on public.queue_entries
  for each row execute function public.queue_entries_relationship();

-- ---------------------------------------------------------------------------
-- 6. Reconciliation
--
-- This is what makes "the triggers may safely swallow errors" a real
-- guarantee rather than an excuse. It recomputes the entire aggregate from
-- the source tables using exactly the same rules the triggers apply.
--
-- Platform-only. Not scheduled by R1 — no job infrastructure belongs in this
-- lot — but available for corrective use and for verification.
-- ---------------------------------------------------------------------------

create or replace function public.rebuild_customer_professional_relationships()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'rebuild_customer_professional_relationships is platform-only';
  end if;

  -- DELETE-then-recompute, not upsert-only. An upsert would leave behind rows
  -- whose evidence has since disappeared (an appointment moved off
  -- 'completed', a queue entry deleted), which would make this a "top up"
  -- rather than a rebuild — and the whole justification for letting the
  -- triggers swallow errors is that this function restores TRUTH.
  --
  -- It also corrects counter drift. The triggers increment by one per
  -- transition INTO a completed state, so a row that flaps
  -- completed -> waiting -> completed counts twice for one real visit. That
  -- is a deliberate trade (the trigger cannot cheaply know whether it has
  -- already counted a given row), and this function is the authoritative
  -- correction: it counts evidence rows, not transitions.
  delete from public.customer_professional_relationships r
  where not exists (
    select 1 from public.appointments a
    join public.customers c on c.id = a.customer_id and c.user_id = a.booked_by_user_id
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id = r.customer_user_id
      and b.professional_id = r.professional_id
      and a.organization_id = r.organization_id
  )
  and not exists (
    select 1 from public.queue_entries q
    join public.customers c on c.id = q.customer_id and c.user_id = q.booked_by_user_id
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id = r.customer_user_id
      and b.professional_id = r.professional_id
      and q.organization_id = r.organization_id
  );

  with evidence as (
    select a.booked_by_user_id as customer_user_id,
           b.professional_id,
           a.organization_id,
           a.starts_at as occurred_at,
           'appointment' as evidence_kind
    from public.appointments a
    join public.customers c on c.id = a.customer_id and c.user_id = a.booked_by_user_id
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id is not null
      and b.professional_id is not null

    union all

    select q.booked_by_user_id,
           b.professional_id,
           q.organization_id,
           coalesce(q.completed_at, q.updated_at),
           'queue'  -- same expression as queue_entries_relationship()
    from public.queue_entries q
    join public.customers c on c.id = q.customer_id and c.user_id = q.booked_by_user_id
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id is not null
      and b.professional_id is not null
  ),
  aggregated as (
    select customer_user_id, professional_id, organization_id,
           min(occurred_at) as first_completed_at,
           max(occurred_at) as last_completed_at,
           count(*)::integer as completed_interaction_count,
           (array_agg(evidence_kind order by occurred_at asc))[1] as established_by
    from evidence
    group by customer_user_id, professional_id, organization_id
  ),
  upserted as (
    insert into public.customer_professional_relationships (
      customer_user_id, professional_id, organization_id,
      first_completed_at, last_completed_at, completed_interaction_count, established_by
    )
    select * from aggregated
    on conflict (customer_user_id, professional_id, organization_id) do update
    set first_completed_at = excluded.first_completed_at,
        last_completed_at = excluded.last_completed_at,
        completed_interaction_count = excluded.completed_interaction_count,
        established_by = excluded.established_by
    returning 1
  )
  select count(*)::integer into v_rows from upserted;

  return v_rows;
end;
$$;

comment on function public.rebuild_customer_professional_relationships() is
  'Platform-only. Recomputes every completed-service relationship from appointments/queue_entries using the same rules as the completion triggers. This is the recovery path that makes it safe for those triggers to swallow errors rather than roll back a booking or a queue completion.';

revoke execute on function public.rebuild_customer_professional_relationships() from public, anon;
grant execute on function public.rebuild_customer_professional_relationships() to authenticated;


-- ============================================================================
-- END db/migrations/20260824100400_customer_professional_relationships.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100500_customer_public_profiles.sql
-- ============================================================================

-- FadeUp — R1: opt-in public customer identity + verification
-- Migration: customer_public_profiles
--
-- PRIVATE BY DEFAULT.
--
-- customer_profiles (20260813120000) is the customer's PRIVATE portable
-- identity — phone, email, preferences — under strict owner-only RLS. This
-- table is a SEPARATE, opt-in public projection. Separate on purpose: if the
-- public fields lived on customer_profiles, then every future "expose the
-- public profile" query would be one forgotten column list away from leaking
-- a phone number. Two tables means the private columns are not merely
-- filtered out of the public path — they are not reachable from it at all.
--
-- is_public defaults to FALSE. A normal customer has no public presence, and
-- creating a row here does not create one.
--
-- WHY VERIFICATION CANNOT BE SELF-SERVICE
--
-- The obvious RLS shape for an owner-editable row is
--   using (user_id = auth.uid()) with check (user_id = auth.uid())
-- and that permits updating EVERY COLUMN OF THAT ROW. RLS is row-level; it
-- has no column granularity. With only that policy, a customer issues
--   PATCH /rest/v1/customer_public_profiles?user_id=eq.<me>
--   {"verification_state":"verified","is_public":true}
-- and is now a verified public figure, with no audit record to contradict it.
--
-- Two independent controls stop this:
--
--   1. A table-level REVOKE of UPDATE, then a re-GRANT of only the
--      presentational columns. (A column-level REVOKE would be a silent
--      no-op here — it cannot subtract from the blanket table-level grant
--      that anon/authenticated already hold.)
--   2. guard_customer_public_profile_update(), so any path that reaches the
--      row with more privilege than a normal client still cannot move
--      verification.
--
-- Verification is written ONLY by set_customer_verification(), which is
-- platform-only and writes the state and its audit record in the same
-- transaction, so the trail can never lag the state.
--
-- WHY THERE IS NO customer_verification_events TABLE
--
-- platform_audit_log already exists and already is exactly this: append-only,
-- platform-admin-SELECT-only, (actor_user_id, action, target_type, target_id,
-- metadata jsonb, created_at). Creating a second audit table because the
-- concept has a product name would be duplication, not modelling.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. customer_public_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.customer_public_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Reserved for R6/R7, like professionals.handle. Nullable so nothing has to
  -- invent one, but the uniqueness rule exists from day one.
  username text,

  display_name text,
  avatar_url text,
  bio text,

  -- Opt-in. This is the flag that keeps a normal customer private (§23).
  is_public boolean not null default false,

  persona_category text,
  verification_state text not null default 'not_verified',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_public_profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,30}$'),
  constraint customer_public_profiles_persona_valid
    check (persona_category is null or persona_category in
      ('artist', 'athlete', 'creator', 'public_figure', 'other')),
  constraint customer_public_profiles_verification_valid
    check (verification_state in ('not_verified', 'pending', 'verified', 'revoked')),
  constraint customer_public_profiles_bio_length
    check (bio is null or char_length(bio) <= 500)
);

comment on table public.customer_public_profiles is
  'The opt-in PUBLIC projection of a customer identity. Deliberately separate from customer_profiles, which holds private contact data — the private columns are not reachable from any public path, rather than being filtered out of one. is_public defaults false: a normal customer stays private.';

comment on column public.customer_public_profiles.verification_state is
  'Platform-controlled. Not writable by the customer: see the table-level UPDATE revoke and guard_customer_public_profile_update(). Changed only by set_customer_verification(), which writes the audit record atomically.';

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'customer_public_profiles_username_lower_unique') then
    create unique index customer_public_profiles_username_lower_unique
      on public.customer_public_profiles (lower(username)) where username is not null;
  end if;
end $$;

create index if not exists customer_public_profiles_public_idx
  on public.customer_public_profiles (is_public) where is_public;

drop trigger if exists customer_public_profiles_set_updated_at on public.customer_public_profiles;
create trigger customer_public_profiles_set_updated_at
  before update on public.customer_public_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Column-level hardening
-- ---------------------------------------------------------------------------

revoke update on public.customer_public_profiles from authenticated, anon;
grant update (username, display_name, avatar_url, bio, is_public, persona_category)
  on public.customer_public_profiles to authenticated;

create or replace function public.guard_customer_public_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  if new.verification_state is distinct from old.verification_state then
    raise exception 'customer_public_profiles.verification_state is not self-service';
  end if;

  return new;
end;
$$;

drop trigger if exists customer_public_profiles_guard on public.customer_public_profiles;
create trigger customer_public_profiles_guard
  before update on public.customer_public_profiles
  for each row execute function public.guard_customer_public_profile_update();

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- The owner manages their own row. Anonymous/public reads go exclusively
-- through the projection RPC in 20260824101000, which requires is_public —
-- there is no anon policy here, matching this codebase's rule that zero
-- policies grant to anon.
-- ---------------------------------------------------------------------------

alter table public.customer_public_profiles enable row level security;
alter table public.customer_public_profiles force row level security;

drop policy if exists customer_public_profiles_select on public.customer_public_profiles;
create policy customer_public_profiles_select
  on public.customer_public_profiles
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

drop policy if exists customer_public_profiles_insert on public.customer_public_profiles;
create policy customer_public_profiles_insert
  on public.customer_public_profiles
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    -- A new profile can never arrive pre-verified.
    and verification_state = 'not_verified'
  );

drop policy if exists customer_public_profiles_update on public.customer_public_profiles;
create policy customer_public_profiles_update
  on public.customer_public_profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists customer_public_profiles_update_platform on public.customer_public_profiles;
create policy customer_public_profiles_update_platform
  on public.customer_public_profiles
  for update
  to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

drop policy if exists customer_public_profiles_delete on public.customer_public_profiles;
create policy customer_public_profiles_delete
  on public.customer_public_profiles
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. set_customer_verification
--
-- The only way verification_state ever moves. State change and audit record
-- are written together, so the audit trail cannot disagree with reality.
-- ---------------------------------------------------------------------------

create or replace function public.set_customer_verification(
  p_user_id uuid,
  p_state text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_from text;
begin
  v_actor := (select auth.uid());

  if not (select private.is_platform_admin()) then
    raise exception 'set_customer_verification is platform-only';
  end if;

  if p_state not in ('not_verified', 'pending', 'verified', 'revoked') then
    raise exception 'invalid verification state: %', p_state;
  end if;

  select verification_state into v_from
  from public.customer_public_profiles where user_id = p_user_id;

  if v_from is null then
    raise exception 'customer has no public profile';
  end if;

  update public.customer_public_profiles
  set verification_state = p_state
  where user_id = p_user_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'customer_verification.changed',
    'customer_public_profile',
    p_user_id,
    jsonb_build_object(
      'from_state', v_from,
      'to_state', p_state,
      'reason', p_reason
    )
  );
end;
$$;

comment on function public.set_customer_verification(uuid, text, text) is
  'Platform-only. The single path that moves a customer''s verification_state, writing the state change and its platform_audit_log record in one transaction. The customer can never call this for themselves, and the rationale recorded here is never readable by the customer it concerns.';

revoke execute on function public.set_customer_verification(uuid, text, text) from public, anon;
grant execute on function public.set_customer_verification(uuid, text, text) to authenticated;


-- ============================================================================
-- END db/migrations/20260824100500_customer_public_profiles.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100600_professional_client_showcases.sql
-- ============================================================================

-- FadeUp — R1: publishable social proof
-- Migration: professional_client_showcases
--
-- RELATIONSHIP TRUTH IS NOT PERMISSION TO PUBLISH IT.
--
-- That a customer genuinely used a barber, and that the customer is verified,
-- says nothing about whether the barber may advertise it. "Already cutting
-- <public figure> ✓" requires a third, separate fact: the customer said yes.
-- This table is that fact and nothing else.
--
-- WHO MAY DO WHAT
--
--   professional -> may INSERT a request, always as 'pending', nothing else
--   customer     -> the ONLY party who may move consent
--   nobody       -> may DELETE
--
-- The professional having no DELETE is not an oversight. With DELETE, a
-- 'declined' or 'revoked' row is reset by delete-then-reinsert, and the
-- customer can be re-solicited indefinitely — consent bypass by attrition.
-- For the same reason 'revoked' is terminal in the transition guard.
--
-- WHY relationship_id ALONE IS NOT ENOUGH
--
-- A NOT NULL FK proves that SOME relationship row exists. It does not prove
-- that THIS one binds THIS professional to THIS customer. Since RLS WITH
-- CHECK is evaluated against client-supplied values, a professional could
-- otherwise attach any relationship UUID they have ever seen — including one
-- from a completely different pair — and the "genuineness is a foreign key"
-- guarantee would be worthless. guard_showcase_binding() closes that: the
-- referenced relationship must name the same professional AND the same
-- customer AND record at least one completed interaction.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professional_client_showcases
-- ---------------------------------------------------------------------------

create table if not exists public.professional_client_showcases (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  customer_user_id uuid not null references auth.users (id) on delete cascade,

  -- NOT NULL: a showcase cannot exist without a real completed-service
  -- relationship. Bound to the right parties by guard_showcase_binding().
  relationship_id uuid not null
    references public.customer_professional_relationships (id) on delete cascade,

  consent_state text not null default 'pending',

  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_client_showcases_unique unique (professional_id, customer_user_id),
  constraint professional_client_showcases_consent_valid
    check (consent_state in ('pending', 'approved', 'declined', 'revoked'))
);

comment on table public.professional_client_showcases is
  'Consent to publish a customer<->professional relationship as social proof. Relationship TRUTH lives in customer_professional_relationships; this table is only PERMISSION. A showcase is publishable when consent is approved, the customer''s public profile is public, and the underlying relationship is genuine.';

-- The public projection reads approved rows for one professional.
create index if not exists professional_client_showcases_professional_approved_idx
  on public.professional_client_showcases (professional_id) where consent_state = 'approved';

-- The customer's consent inbox.
create index if not exists professional_client_showcases_customer_pending_idx
  on public.professional_client_showcases (customer_user_id) where consent_state = 'pending';

-- FK maintenance.
create index if not exists professional_client_showcases_relationship_idx
  on public.professional_client_showcases (relationship_id);

drop trigger if exists professional_client_showcases_set_updated_at on public.professional_client_showcases;
create trigger professional_client_showcases_set_updated_at
  before update on public.professional_client_showcases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Binding guard
-- ---------------------------------------------------------------------------

create or replace function public.guard_showcase_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.customer_professional_relationships r
    where r.id = new.relationship_id
      and r.professional_id = new.professional_id
      and r.customer_user_id = new.customer_user_id
      and r.completed_interaction_count >= 1
  ) then
    raise exception 'showcase relationship must name the same professional and customer and record a completed service';
  end if;
  return new;
end;
$$;

comment on function public.guard_showcase_binding() is
  'BEFORE INSERT OR UPDATE: the referenced relationship must bind exactly this professional and this customer, with at least one completed interaction. Without this, a NOT NULL FK proves only that some relationship exists somewhere.';

drop trigger if exists professional_client_showcases_binding on public.professional_client_showcases;
create trigger professional_client_showcases_binding
  before insert or update on public.professional_client_showcases
  for each row execute function public.guard_showcase_binding();

-- ---------------------------------------------------------------------------
-- 3. Consent transition guard
--
-- Only the customer moves consent. Legal transitions:
--
--   pending  -> approved | declined
--   declined -> approved            (a customer may change their mind)
--   approved -> revoked
--   revoked  -> (nothing)           terminal
-- ---------------------------------------------------------------------------

create or replace function public.guard_showcase_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if new.consent_state is not distinct from old.consent_state then
    return new;
  end if;

  v_actor := (select auth.uid());

  -- Server-side paths (migrations, definer RPCs) and platform admins are
  -- allowed through; every ordinary session must be the customer.
  if v_actor is not null and not (select private.is_platform_admin())
     and v_actor <> new.customer_user_id then
    raise exception 'only the customer may decide whether a relationship is published';
  end if;

  if old.consent_state = 'revoked' then
    raise exception 'a revoked showcase is terminal and cannot be re-opened';
  end if;

  if not (
    (old.consent_state = 'pending'  and new.consent_state in ('approved', 'declined'))
    or (old.consent_state = 'declined' and new.consent_state = 'approved')
    or (old.consent_state = 'approved' and new.consent_state = 'revoked')
  ) then
    raise exception 'illegal showcase consent transition: % -> %', old.consent_state, new.consent_state;
  end if;

  new.decided_at := now();
  if new.consent_state = 'revoked' then
    new.revoked_at := now();
  end if;

  return new;
end;
$$;

comment on function public.guard_showcase_consent() is
  'BEFORE UPDATE: only the customer (or a platform admin, or a server-side path) may move consent_state, and only along legal transitions. revoked is terminal — combined with the absence of any DELETE policy, this is what stops a professional re-soliciting a customer who already said no.';

drop trigger if exists professional_client_showcases_consent on public.professional_client_showcases;
create trigger professional_client_showcases_consent
  before update on public.professional_client_showcases
  for each row execute function public.guard_showcase_consent();

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- Per-command policies are mandatory here. A single FOR ALL policy would let
-- the professional update consent, which is the entire thing this table
-- exists to prevent.
-- ---------------------------------------------------------------------------

alter table public.professional_client_showcases enable row level security;
alter table public.professional_client_showcases force row level security;

drop policy if exists professional_client_showcases_select on public.professional_client_showcases;
create policy professional_client_showcases_select
  on public.professional_client_showcases
  for select
  to authenticated
  using (
    customer_user_id = (select auth.uid())
    or exists (
      select 1 from public.professionals p
      where p.id = professional_client_showcases.professional_id
        and p.user_id = (select auth.uid())
    )
    or (select private.is_platform_admin())
  );

-- The professional may only ever ASK.
drop policy if exists professional_client_showcases_insert on public.professional_client_showcases;
create policy professional_client_showcases_insert
  on public.professional_client_showcases
  for insert
  to authenticated
  with check (
    consent_state = 'pending'
    and decided_at is null
    and revoked_at is null
    and exists (
      select 1 from public.professionals p
      where p.id = professional_client_showcases.professional_id
        and p.user_id = (select auth.uid())
    )
  );

-- Only the customer may answer.
drop policy if exists professional_client_showcases_update on public.professional_client_showcases;
create policy professional_client_showcases_update
  on public.professional_client_showcases
  for update
  to authenticated
  using (customer_user_id = (select auth.uid()))
  with check (customer_user_id = (select auth.uid()));

-- Deliberately NO delete policy for anyone. See the header.

-- The professional must not be able to pre-set decision fields on insert, and
-- the customer must not rewrite the binding. Table-level revoke then re-grant,
-- because a column-level revoke cannot subtract from the blanket grant.
revoke insert, update, delete on public.professional_client_showcases from authenticated, anon;
grant insert (professional_id, customer_user_id, relationship_id, consent_state)
  on public.professional_client_showcases to authenticated;
grant update (consent_state)
  on public.professional_client_showcases to authenticated;


-- ============================================================================
-- END db/migrations/20260824100600_professional_client_showcases.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100700_fade_passport_identity.sql
-- ============================================================================

-- FadeUp — R1: Fade Passport identity
-- Migration: customer_passports.passport_number + automatic issuance
--
-- NO NEW TABLE. customer_passports (20260813140000) already exists and
-- already enforces exactly one passport per account — user_id is UNIQUE with
-- an FK to auth.users. Creating a `fade_passports` table because the product
-- has a name would duplicate a live entity, orphan the existing photos and
-- share links that reference it, and buy nothing.
--
-- What was genuinely missing is only this:
--
--   1. a STABLE PUBLIC IDENTIFIER for the passport (passport_number);
--   2. AUTOMATIC issuance — today a passport exists only if the customer
--      happens to create one, so "every registered customer owns exactly one
--      Fade Passport" is not true yet;
--   3. an idempotent ensure/backfill path.
--
-- WHAT "REGISTERED CUSTOMER" MEANS HERE
--
-- Anchored to customer_profiles, NOT to auth.users. That is deliberate and it
-- follows this codebase's own definition: 20260813120000_customer_identity.sql
-- states that an auth account which never touches the customer app has no
-- customer_profiles row, and that this "is a legitimate normal state". A
-- professional's or platform admin's login is not a customer and must not be
-- issued a Fade Passport.
--
-- PASSPORT NUMBER IS AN IDENTIFIER, NOT AN AUTHENTICATOR
--
-- 80 bits from gen_random_bytes(10), so the space cannot be enumerated. It is
-- deliberately NOT returned by get_shared_passport or any other anon-callable
-- function, and R1 adds no lookup-by-number path.
--
-- If a future lot adds one (a "scan my passport" flow), understand what that
-- would create: a NON-EXPIRING, NON-REVOCABLE bearer credential, strictly
-- weaker than customer_passport_shares — which already exists beside it and
-- does this properly with a hashed, expiring, revocable token. Lookup by
-- number must go through that mechanism, not around it.
--
-- WALLET IS A SEPARATE CONCEPT
--
-- Nothing here models an Apple/Google Wallet installation. A customer owns a
-- Passport whether or not they ever install it on a device; the install is a
-- different entity belonging to the lot that builds it. No column below
-- implies a device.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports' and column_name = 'passport_number'
  ) then
    alter table public.customer_passports add column passport_number text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports' and column_name = 'issued_at'
  ) then
    alter table public.customer_passports add column issued_at timestamptz;
  end if;
end $$;

-- Unique from the moment the column exists, so no window allows a duplicate.
-- Partial: rows predating the backfill are briefly null and must not collide
-- with each other on NULL.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'customer_passports_number_unique') then
    create unique index customer_passports_number_unique
      on public.customer_passports (passport_number) where passport_number is not null;
  end if;
end $$;

comment on column public.customer_passports.passport_number is
  'Stable public identifier for this Fade Passport. 80 bits of randomness — non-sequential and non-enumerable by design. An IDENTIFIER, NOT AN AUTHENTICATOR: it is never returned by any anon-callable function, and any future lookup-by-number flow must go through the revocable, expiring customer_passport_shares token instead of treating this value as a credential.';

comment on column public.customer_passports.issued_at is
  'When the Passport was issued. Distinct from created_at only for rows issued by the R1 backfill, where created_at predates the concept.';

-- Clients may read their own number but must never choose it.
--
-- user_id IS in the re-grant, and must be. The customer app saves a Passport
-- with a PostgREST upsert (apps/web/src/lib/queries/passport.ts —
-- `.upsert({ user_id, ... }, { onConflict: 'user_id' })`), which emits
-- ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id, ...
-- ON CONFLICT DO UPDATE requires UPDATE privilege on EVERY column in the SET
-- list, so withholding user_id makes the whole save fail with
-- "permission denied for table customer_passports".
--
-- Before this migration that was survivable, because most customers had no
-- passport row and the INSERT arm ran. The trigger below now guarantees every
-- registered customer HAS one, so the conflict arm always runs — withholding
-- user_id here would break the Fade Passport editor for 100% of customers.
--
-- Granting it is safe: the pre-existing RLS UPDATE policy pins
-- user_id = auth.uid() on both USING and WITH CHECK, and user_id is UNIQUE,
-- so a customer can neither move their passport to another account nor
-- collide with one.
--
-- passport_number and issued_at remain withheld — those the client must never
-- choose.
revoke update on public.customer_passports from authenticated, anon;
grant update (user_id, usual_haircut, fade_type, side_length, top_length,
              beard_preferences, preferences_notes, updated_at)
  on public.customer_passports to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Number generation
-- ---------------------------------------------------------------------------

create or replace function private.generate_passport_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_candidate := 'FP' || upper(encode(extensions.gen_random_bytes(10), 'hex'));

    if not exists (
      select 1 from public.customer_passports where passport_number = v_candidate
    ) then
      return v_candidate;
    end if;

    -- At 80 bits a collision is not a real event; this loop exists so that if
    -- one ever happens the answer is a different number, not a failed signup.
    if v_attempt >= 5 then
      raise exception 'could not generate a unique passport number after % attempts', v_attempt;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ensure_customer_passport
--
-- Idempotent and concurrency-safe. Arbitrates on the pre-existing user_id
-- unique index rather than doing select-then-insert, so two concurrent
-- signups (or a retried one) produce exactly one Passport.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_customer_passport(p_user_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_number text;
begin
  v_user_id := coalesce(p_user_id, (select auth.uid()));
  if v_user_id is null then
    raise exception 'ensure_customer_passport requires a user';
  end if;

  -- Only the caller's own passport may be ensured by a client session.
  -- p_user_id is accepted for the trigger and the backfill, which run with
  -- auth.uid() null.
  if (select auth.uid()) is not null
     and v_user_id <> (select auth.uid())
     and not (select private.is_platform_admin()) then
    raise exception 'ensure_customer_passport may only be called for your own account';
  end if;

  insert into public.customer_passports (user_id, passport_number, issued_at)
  values (v_user_id, private.generate_passport_number(), now())
  on conflict (user_id) do nothing;

  select passport_number into v_number
  from public.customer_passports where user_id = v_user_id;

  -- A passport that predates this migration exists but has no number yet.
  -- Assign one without disturbing anything else on the row.
  if v_number is null then
    update public.customer_passports
    set passport_number = private.generate_passport_number(),
        issued_at = coalesce(issued_at, created_at, now())
    where user_id = v_user_id and passport_number is null
    returning passport_number into v_number;
  end if;

  return v_number;
end;
$$;

comment on function public.ensure_customer_passport(uuid) is
  'Idempotent: guarantees exactly one Fade Passport, with a number, for the given account. Race-safe via the user_id unique index — concurrent or retried creation yields one passport. Callable by a customer for themselves only; the trigger and backfill pass p_user_id with no session.';

revoke execute on function public.ensure_customer_passport(uuid) from public, anon;
grant execute on function public.ensure_customer_passport(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Automatic issuance
--
-- AFTER INSERT on customer_profiles: becoming a registered customer issues
-- the Passport. This is what makes "exactly one per registered customer" true
-- rather than aspirational.
--
-- Cannot raise: a failure here would abort customer onboarding, and a missing
-- passport is recoverable (the backfill and ensure_customer_passport both fix
-- it) whereas a failed signup is not.
-- ---------------------------------------------------------------------------

create or replace function public.customer_profiles_ensure_passport()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_customer_passport(new.user_id);
  return new;
exception when others then
  raise warning 'customer_profiles_ensure_passport suppressed error for user %: %', new.user_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists customer_profiles_issue_passport on public.customer_profiles;
create trigger customer_profiles_issue_passport
  after insert on public.customer_profiles
  for each row execute function public.customer_profiles_ensure_passport();


-- ============================================================================
-- END db/migrations/20260824100700_fade_passport_identity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100800_fade_passport_backfill.sql
-- ============================================================================

-- FadeUp — R1: issue Fade Passports to existing customers
--
-- Separate from 20260824100700 so schema and data stay independently
-- reviewable and recoverable (mission §10).
--
-- Two populations, both handled idempotently:
--
--   1. registered customers with NO passport at all — issue one;
--   2. passports created before this migration, which have no number —
--      assign one, touching nothing else on the row.
--
-- Anchored to customer_profiles, matching this codebase's definition of a
-- registered customer (see the header of 20260824100700).
--
-- RESTART-SAFE AND RE-RUNNABLE: every statement is guarded, so re-running is
-- a no-op and an interrupted run resumes. This matters because MASTER replays
-- it against a database that already holds real customers.

set lock_timeout = '5s';

do $$
declare
  v_customers integer;
  v_missing integer;
  v_unnumbered integer;
  v_after integer;
begin
  select count(*) into v_customers from public.customer_profiles;

  select count(*) into v_missing
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);

  select count(*) into v_unnumbered
  from public.customer_passports where passport_number is null;

  -- SET-BASED, not row-by-row.
  --
  -- MASTER wraps every R1 migration in ONE transaction, and an earlier one
  -- takes a brief ACCESS EXCLUSIVE lock on `appointments` to add a column.
  -- That lock is held until COMMIT. A PL/pgSQL loop doing one INSERT plus one
  -- uniqueness probe per registered customer would therefore hold bookings
  -- and the queue unreadable for as long as the loop runs — minutes, on a
  -- real customer base. Two set-based statements keep that window short.
  --
  -- gen_random_bytes() is VOLATILE, so it is evaluated once per row and each
  -- row gets its own number. At 80 bits a collision inside one statement is
  -- not a real event; if one ever occurred the unique index would raise and
  -- the migration would fail loudly rather than issue a duplicate — which is
  -- the correct outcome, and re-running resumes cleanly.

  -- 1. Issue missing passports.
  insert into public.customer_passports (user_id, passport_number, issued_at)
  select cp.user_id,
         'FP' || upper(encode(extensions.gen_random_bytes(10), 'hex')),
         now()
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id)
  on conflict (user_id) do nothing;

  -- 2. Number the pre-existing passports.
  update public.customer_passports
  set passport_number = 'FP' || upper(encode(extensions.gen_random_bytes(10), 'hex')),
      issued_at = coalesce(issued_at, created_at, now())
  where passport_number is null;

  select count(*) into v_after from public.customer_passports;

  raise notice 'R1 Fade Passport backfill: % registered customers, % had no passport, % had no number, passports now %',
    v_customers, v_missing, v_unnumbered, v_after;
end $$;

-- ---------------------------------------------------------------------------
-- Verification (§70) — assert the invariants, do not merely hope for them.
-- ---------------------------------------------------------------------------

-- Every registered customer has exactly one Passport. "Exactly one" is
-- already guaranteed structurally by customer_passports.user_id being UNIQUE,
-- so what needs asserting is "at least one".
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);

  if v_missing > 0 then
    raise exception 'R1 passport backfill incomplete: % registered customers still have no Fade Passport', v_missing;
  end if;
end $$;

-- Every Passport has a number.
do $$
declare
  v_unnumbered integer;
begin
  select count(*) into v_unnumbered from public.customer_passports where passport_number is null;
  if v_unnumbered > 0 then
    raise exception 'R1 passport backfill incomplete: % passports have no number', v_unnumbered;
  end if;
end $$;

-- No duplicate numbers. The partial unique index makes this impossible; the
-- assertion exists so that a future change which weakens the index fails
-- loudly here instead of silently issuing two identical passport numbers.
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes from (
    select passport_number from public.customer_passports
    where passport_number is not null
    group by passport_number having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception 'R1 passport backfill produced % duplicate passport numbers', v_dupes;
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260824100800_fade_passport_backfill.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824100900_external_professional_claims.sql
-- ============================================================================

-- FadeUp — R1: external profiles and the claim lifecycle
-- Migration: professional_profile_claims
--
-- WHAT R1 ADDS TO WORKER, AND WHAT IT DOES NOT
--
-- The Worker discovery pipeline already exists and is mature. Source ->
-- observation -> match -> canonical -> dedupe are all modelled:
-- prospect_sources, prospect_source_records (external_id, source_url,
-- raw_payload, confidence, fetched_at, last_verified_at), prospect_identity_
-- matches (matching_rule, matched_attributes, confidence, rules_version,
-- merge_applied), prospect_duplicates (confidence, status, reviewed_by) and
-- prospects itself. R1 adds NO new observation, matching or dedupe structure,
-- and touches none of those tables.
--
-- Only two things were genuinely missing:
--
--   1. an EXTERNAL PROFILE — which is not a new table either. A
--      Worker-discovered professional is a `professionals` row with
--      source='worker', prospect_id set, user_id null, claim_state
--      'unclaimed'. See 20260824100000 for why that is safe: no barbers row
--      means no availability, no queue, no schedule, no appointments. Worker
--      cannot invent operational truth because the columns to express it do
--      not exist on that table.
--
--   2. the CLAIM lifecycle — this file.
--
-- CLAIM IS NOT SUBSCRIPTION
--
-- claim_state answers "who controls this identity". Nothing here answers
-- "what have they paid for". There is no plan, price, tier or entitlement
-- column anywhere in R1; a claimed profile is Free until R2 says otherwise.
--
-- SECURITY: MODELLED ON professional_applications
--
-- 20260813170000_professional_applications.sql solves the structurally
-- identical problem (registration must not hand out a tenant) and states the
-- principle this file follows: AUTHENTICATED != AUTHORIZED. The claim row is
-- the workflow, never the permission.
--
-- THE TAKEOVER RISK, AND WHY user_id UNIQUE IS NOT THE GUARD
--
-- It is tempting to argue that professionals.user_id being UNIQUE prevents
-- two owners. It does not. It prevents one ACCOUNT owning two IDENTITIES.
-- It does nothing to stop one IDENTITY being handed to a second ACCOUNT:
-- every backfilled professional already has user_id set, and approving a
-- claim by user A against professional P where P.user_id = B would simply
-- overwrite it — B silently loses their identity, their followers and their
-- verified clients, with no unique violation anywhere, because B never filed
-- a claim to collide with.
--
-- The actual guards are:
--   * approval refuses any target whose user_id is already set;
--   * one approved claim per professional, ever (partial unique);
--   * one pending claim per (professional, claimant) — multiple DIFFERENT
--     claimants may be pending at once, which is necessary because the
--     platform arbitrates between them;
--   * SELECT ... FOR UPDATE on the professionals row inside the approval
--     transaction, so two concurrent approvals serialise.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professional_profile_claims
-- ---------------------------------------------------------------------------

create table if not exists public.professional_profile_claims (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  claimant_user_id uuid not null references auth.users (id) on delete cascade,

  state text not null default 'pending',
  evidence jsonb not null default '{}'::jsonb,

  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_profile_claims_state_valid
    check (state in ('pending', 'approved', 'rejected', 'withdrawn'))
);

comment on table public.professional_profile_claims is
  'The lifecycle by which a real professional takes ownership of an external, Worker-discovered profile. Platform-arbitrated: filing a claim grants nothing. Separate from professional_applications, which creates a NEW organization — this takes over an EXISTING identity.';

-- At most one approved claim per professional, permanently. This is the
-- storage-layer guarantee that two concurrent approvals cannot both win.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'professional_profile_claims_one_approved') then
    create unique index professional_profile_claims_one_approved
      on public.professional_profile_claims (professional_id) where state = 'approved';
  end if;
end $$;

-- One pending claim per claimant per professional — stops spam, while still
-- allowing several different claimants to be pending simultaneously.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'professional_profile_claims_one_pending_per_claimant') then
    create unique index professional_profile_claims_one_pending_per_claimant
      on public.professional_profile_claims (professional_id, claimant_user_id) where state = 'pending';
  end if;
end $$;

create index if not exists professional_profile_claims_claimant_idx
  on public.professional_profile_claims (claimant_user_id, submitted_at desc);

-- The platform review queue, mirroring professional_applications' convention.
create index if not exists professional_profile_claims_pending_queue_idx
  on public.professional_profile_claims (submitted_at) where state = 'pending';

drop trigger if exists professional_profile_claims_set_updated_at on public.professional_profile_claims;
create trigger professional_profile_claims_set_updated_at
  before update on public.professional_profile_claims
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Guard — the claimant may withdraw, and nothing else
--
-- Without this the claimant self-approves in a single PATCH. The partial
-- unique index would not help: it enforces that at most ONE approval exists,
-- not that the approval was legitimate — the attacker simply wins the race to
-- be that one.
-- ---------------------------------------------------------------------------

create or replace function public.guard_professional_claim_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  if new.professional_id is distinct from old.professional_id
     or new.claimant_user_id is distinct from old.claimant_user_id
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'professional_profile_claims: only the platform may decide a claim';
  end if;

  -- The one state change a claimant may make themselves.
  if new.state is distinct from old.state
     and not (old.state = 'pending' and new.state = 'withdrawn') then
    raise exception 'professional_profile_claims: a claimant may only withdraw a pending claim';
  end if;

  return new;
end;
$$;

drop trigger if exists professional_profile_claims_guard on public.professional_profile_claims;
create trigger professional_profile_claims_guard
  before update on public.professional_profile_claims
  for each row execute function public.guard_professional_claim_update();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.professional_profile_claims enable row level security;
alter table public.professional_profile_claims force row level security;

drop policy if exists professional_profile_claims_select on public.professional_profile_claims;
create policy professional_profile_claims_select
  on public.professional_profile_claims
  for select
  to authenticated
  using (
    claimant_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

drop policy if exists professional_profile_claims_insert on public.professional_profile_claims;
create policy professional_profile_claims_insert
  on public.professional_profile_claims
  for insert
  to authenticated
  with check (
    claimant_user_id = (select auth.uid())
    and state = 'pending'
    and decided_at is null
    and decided_by is null
    and rejection_reason is null
  );

drop policy if exists professional_profile_claims_update_own on public.professional_profile_claims;
create policy professional_profile_claims_update_own
  on public.professional_profile_claims
  for update
  to authenticated
  using (claimant_user_id = (select auth.uid()) and state = 'pending')
  with check (claimant_user_id = (select auth.uid()));

drop policy if exists professional_profile_claims_update_platform on public.professional_profile_claims;
create policy professional_profile_claims_update_platform
  on public.professional_profile_claims
  for update
  to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- No DELETE policy: a decided claim is a permanent record.

-- Consistency with the other five new tables: anon holds no write grant.
-- RLS already denies it (no policy grants to anon anywhere in this database),
-- so this is defence in depth, not a fix.
revoke insert, update, delete on public.professional_profile_claims from anon;

-- ---------------------------------------------------------------------------
-- 4. create_external_professional
--
-- The controlled path by which Worker publication (R10) creates an unclaimed
-- identity. It exists in R1 so that the SAFE DEFAULTS are a function
-- contract rather than a convention a future lot has to remember: an external
-- profile is always unowned, always unclaimed, always non-public, always
-- unverified. Nothing here can fabricate operational state.
--
-- R1 does not mass-import anything (§77).
-- ---------------------------------------------------------------------------

create or replace function public.create_external_professional(
  p_prospect_id uuid,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'create_external_professional is platform-only';
  end if;

  if p_prospect_id is null then
    raise exception 'an external professional must reference a prospect';
  end if;

  -- One external identity per prospect. Idempotent by design: a re-run of a
  -- publication job must not mint a second identity for the same real shop.
  select id into v_id from public.professionals where prospect_id = p_prospect_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.professionals (
    user_id, prospect_id, display_name, source, claim_state, verification_state, is_public
  )
  values (
    null, p_prospect_id,
    coalesce(nullif(btrim(p_display_name), ''), 'Barber'),
    'worker', 'unclaimed', 'not_verified', false
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_external_professional(uuid, text) is
  'Platform-only. Creates an UNCLAIMED external professional identity from a Worker prospect, with safe defaults enforced in code: no owner, unclaimed, not public, not verified. Idempotent per prospect.';

revoke execute on function public.create_external_professional(uuid, text) from public, anon;
grant execute on function public.create_external_professional(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. claim_professional_profile — filing a claim grants nothing
-- ---------------------------------------------------------------------------

create or replace function public.claim_professional_profile(
  p_professional_id uuid,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_owner uuid;
  v_found boolean;
  v_claim_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'claim_professional_profile requires an authenticated session';
  end if;

  select p.user_id, true into v_owner, v_found
  from public.professionals p where p.id = p_professional_id;

  if v_found is not true then
    raise exception 'professional not found';
  end if;

  -- An already-owned identity is not claimable. This is the social-engineering
  -- entry point if left open.
  if v_owner is not null then
    raise exception 'this profile is already claimed';
  end if;

  insert into public.professional_profile_claims (professional_id, claimant_user_id, evidence)
  values (p_professional_id, v_user_id, coalesce(p_evidence, '{}'::jsonb))
  on conflict (professional_id, claimant_user_id) where state = 'pending'
  do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    select id into v_claim_id
    from public.professional_profile_claims
    where professional_id = p_professional_id
      and claimant_user_id = v_user_id
      and state = 'pending';
  end if;

  -- Signal that a decision is outstanding. Deliberately does NOT set user_id:
  -- claim_state 'claim_pending' still satisfies the
  -- professionals_claim_state_matches_owner constraint, because only
  -- 'claimed' requires an owner.
  --
  -- guard_professional_update() blocks client-driven claim_state changes, and
  -- SECURITY DEFINER does not change auth.uid() — the caller here is still the
  -- claimant. This transaction-local flag is the documented stand-down, the
  -- same shape as fadeup.org_creation_authorized.
  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals
  set claim_state = 'claim_pending'
  where id = p_professional_id and claim_state = 'unclaimed';

  -- Reset immediately. is_local => true scopes the flag to the TRANSACTION,
  -- not the statement, so leaving it on would disable the guard for every
  -- later statement in the same transaction. The three precedents
  -- (20260818200000, 20260813170000, 20260818220000) all set it back to
  -- 'off'; this copies that half of the pattern too.
  perform set_config('fadeup.professional_identity_authorized', 'off', true);

  return v_claim_id;
end;
$$;

comment on function public.claim_professional_profile(uuid, jsonb) is
  'Authenticated-only. Files a PENDING claim on an unclaimed external profile. Idempotent — repeated calls return the existing pending claim. Grants no control whatsoever; only approve_professional_claim does that, and only a platform admin may call it.';

revoke execute on function public.claim_professional_profile(uuid, jsonb) from public, anon;
grant execute on function public.claim_professional_profile(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. withdraw_professional_claim
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_professional_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  update public.professional_profile_claims
  set state = 'withdrawn'
  where id = p_claim_id
    and claimant_user_id = (select auth.uid())
    and state = 'pending'
  returning professional_id into v_professional_id;

  if v_professional_id is null then
    raise exception 'claim not found, not yours, or not pending';
  end if;

  -- Return the profile to unclaimed if nobody else is still waiting.
  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals p
  set claim_state = 'unclaimed'
  where p.id = v_professional_id
    and p.user_id is null
    and not exists (
      select 1 from public.professional_profile_claims c
      where c.professional_id = v_professional_id and c.state = 'pending'
    );

  perform set_config('fadeup.professional_identity_authorized', 'off', true);
end;
$$;

revoke execute on function public.withdraw_professional_claim(uuid) from public, anon;
grant execute on function public.withdraw_professional_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. approve_professional_claim — platform only
--
-- FOR UPDATE on the professionals row is what serialises two concurrent
-- approvals: the second waits, then sees user_id already set and refuses.
-- The partial unique index is the second, independent guarantee.
--
-- THE DELIBERATE FAIL-CLOSED
--
-- If the claimant already has their own professional identity — the most
-- likely real case, a barber Worker scraped who later signed up natively —
-- this raises rather than proceeding. The correct resolution is a MERGE:
-- repoint barbers, follows and relationships onto one survivor and tombstone
-- the other, with an audit record. R1 does not build the claim engine (§43),
-- and a half-considered merge here would silently destroy social graph data.
-- Failing closed is the safe answer; merge is a hard prerequisite for R17.
-- ---------------------------------------------------------------------------

create or replace function public.approve_professional_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.professional_profile_claims;
  v_owner uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'approve_professional_claim is platform-only';
  end if;

  select * into v_claim
  from public.professional_profile_claims
  where id = p_claim_id and state = 'pending';

  if not found then
    raise exception 'claim not found or not pending';
  end if;

  -- Serialise concurrent approvals on the target identity.
  select user_id into v_owner
  from public.professionals
  where id = v_claim.professional_id
  for update;

  if v_owner is not null then
    raise exception 'this profile is already owned; approving would transfer it away from its current owner';
  end if;

  if exists (select 1 from public.professionals where user_id = v_claim.claimant_user_id) then
    raise exception 'claimant already has a professional identity; merging two identities is not implemented in R1 (see docs/v2/DEPRECATIONS.md)';
  end if;

  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals
  set user_id = v_claim.claimant_user_id,
      claim_state = 'claimed'
  where id = v_claim.professional_id;

  -- Reset before the remaining statements in this function run, so they
  -- execute with the guard active.
  perform set_config('fadeup.professional_identity_authorized', 'off', true);

  update public.professional_profile_claims
  set state = 'approved',
      decided_at = now(),
      decided_by = (select auth.uid())
  where id = p_claim_id;

  -- Every other pending claim on this identity loses.
  update public.professional_profile_claims
  set state = 'rejected',
      decided_at = now(),
      decided_by = (select auth.uid()),
      rejection_reason = 'another claim was approved for this profile'
  where professional_id = v_claim.professional_id
    and id <> p_claim_id
    and state = 'pending';

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'professional_claim.approved',
    'professional',
    v_claim.professional_id,
    jsonb_build_object('claim_id', p_claim_id, 'claimant_user_id', v_claim.claimant_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. reject_professional_claim — platform only
--
-- Without this, a rejected claim strands the target: withdraw_professional_
-- claim() has a reset path but rejection had none, so claim_state would stay
-- 'claim_pending' forever and no future claimant could ever file, because
-- claim_professional_profile only accepts 'unclaimed' targets.
-- ---------------------------------------------------------------------------

create or replace function public.reject_professional_claim(
  p_claim_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'reject_professional_claim is platform-only';
  end if;

  update public.professional_profile_claims
  set state = 'rejected',
      decided_at = now(),
      decided_by = (select auth.uid()),
      rejection_reason = p_reason
  where id = p_claim_id and state = 'pending'
  returning professional_id into v_professional_id;

  if v_professional_id is null then
    raise exception 'claim not found or not pending';
  end if;

  -- Release the profile only when nobody else is still waiting on it.
  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals p
  set claim_state = 'unclaimed'
  where p.id = v_professional_id
    and p.user_id is null
    and not exists (
      select 1 from public.professional_profile_claims c
      where c.professional_id = v_professional_id and c.state = 'pending'
    );

  perform set_config('fadeup.professional_identity_authorized', 'off', true);

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'professional_claim.rejected',
    'professional',
    v_professional_id,
    jsonb_build_object('claim_id', p_claim_id, 'reason', p_reason)
  );
end;
$$;

comment on function public.reject_professional_claim(uuid, text) is
  'Platform-only. Rejects a pending claim and returns the profile to unclaimed when no other claim is still pending, so a rejection never strands an external profile in claim_pending forever.';

revoke execute on function public.reject_professional_claim(uuid, text) from public, anon;
grant execute on function public.reject_professional_claim(uuid, text) to authenticated;

comment on function public.approve_professional_claim(uuid) is
  'Platform-only. Transfers an UNCLAIMED external identity to its claimant. Refuses any already-owned target, so an approval can never take an identity away from an existing owner. Serialises concurrent approvals with SELECT FOR UPDATE, and fails closed when the claimant already has an identity, because merging two identities is deliberately not implemented in R1.';

revoke execute on function public.approve_professional_claim(uuid) from public, anon;
grant execute on function public.approve_professional_claim(uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260824100900_external_professional_claims.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260824101000_public_projections.sql
-- ============================================================================

-- FadeUp — R1: public projections
-- Migration: get_public_professional, list_public_professional_showcases,
--            get_public_customer_profile, get_my_follow_state
--
-- This is the ONLY anonymous surface R1 adds, and it follows the pattern
-- every existing public read in this codebase uses (get_public_barber,
-- search_public_professionals, get_shared_passport): narrowly-scoped
-- SECURITY DEFINER, set search_path = '', an EXPLICIT column list, every
-- eligibility rule re-derived server-side, revoke from public, grant to
-- anon + authenticated. No table in R1 has an anon RLS policy; there are
-- zero anon policies in this database and R1 keeps it that way.
--
-- WHY COUNTS ARE CAPPED
--
-- Follower count is the highest-QPS read a social product has, and an
-- unbounded COUNT over the follow edge is O(followers), not O(1) — at a
-- million followers that is a million index tuples per profile view. R1 also
-- mutates follow edges IN PLACE and `state` is the partial index's predicate
-- column, so every unfollow churns that index and defeats HOT updates,
-- meaning the "index-only" scan degrades under exactly the write load that
-- makes the count expensive.
--
-- Materialising a counter would add write-path contention and a drift-repair
-- obligation before there is any traffic to justify either. So R1 caps
-- instead: the subquery stops at 1001 rows, the cost is O(1001) at any scale,
-- there is no drift, and the UI renders "1000+" — which is what social
-- products display anyway. R6/R7 can introduce a real materialised counter
-- with real numbers; doing so is purely additive.
--
-- WHAT IS DELIBERATELY NOT RETURNED
--
-- prospect_id (a join key into the whole Worker sales estate, and a
-- disclosure that this tenant was scraped before signing up), user_id,
-- source, raw claim/verification internals, any appointment id, any date, any
-- customer UUID, any organization, any interaction count. The smallest
-- projection that supports "Already cutting X ✓".
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. get_public_professional
-- ---------------------------------------------------------------------------

create or replace function public.get_public_professional(p_professional_id uuid)
returns table (
  professional_id uuid,
  handle text,
  display_name text,
  headline text,
  bio text,
  avatar_url text,
  is_verified boolean,
  is_claimed boolean,
  follower_count integer,
  follower_count_capped boolean,
  verified_client_count integer,
  verified_client_count_capped boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    p.handle,
    p.display_name,
    p.headline,
    p.bio,
    p.avatar_url,
    p.verification_state = 'verified',
    -- "Claimed" is a real, checkable fact about who controls the identity.
    -- It says nothing about a subscription: an unclaimed profile is not a
    -- lapsed customer, and a claimed one is not a paying one.
    p.user_id is not null,
    fc.n,
    fc.n > 1000,
    vc.n,
    vc.n > 1000
  from public.professionals p
  cross join lateral (
    select count(*)::integer as n from (
      select 1 from public.professional_follows f
      where f.professional_id = p.id and f.state = 'following'
      limit 1001
    ) capped
  ) fc
  cross join lateral (
    select count(*)::integer as n from (
      -- Distinct customers across every shop this professional has worked at.
      -- The per-shop rows are the tenants' facts; this aggregate is the
      -- professional's.
      select distinct r.customer_user_id
      from public.customer_professional_relationships r
      where r.professional_id = p.id and r.completed_interaction_count >= 1
      limit 1001
    ) capped
  ) vc
  where p.id = p_professional_id
    and p.is_public;
$$;

comment on function public.get_public_professional(uuid) is
  'Anon-callable public projection of one professional. Zero rows if the professional is not public — never an error, so an unpublished profile is indistinguishable from a wrong id, matching get_public_barber. Counts are capped at 1001 with a *_capped flag so the caller can render "1000+". Never returns prospect_id, user_id or source.';

revoke execute on function public.get_public_professional(uuid) from public;
grant execute on function public.get_public_professional(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. list_public_professional_showcases
--
-- FOUR conditions gate every row, not three:
--
--   1. consent approved                — the customer said yes
--   2. the relationship is genuine     — enforced by the binding trigger and
--                                        re-checked here
--   3. the customer's profile is_public — a customer who is private by
--                                        default must not be rendered on a
--                                        public page merely because they once
--                                        approved a showcase
--   4. verification evaluated LIVE     — so a revoked badge disappears
--                                        immediately rather than persisting
--                                        in a cached boolean
-- ---------------------------------------------------------------------------

create or replace function public.list_public_professional_showcases(p_professional_id uuid)
returns table (
  display_name text,
  username text,
  avatar_url text,
  is_verified boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    cpp.display_name,
    cpp.username,
    cpp.avatar_url,
    cpp.verification_state = 'verified'
  from public.professional_client_showcases s
  join public.professionals p on p.id = s.professional_id
  join public.customer_public_profiles cpp on cpp.user_id = s.customer_user_id
  join public.customer_professional_relationships r on r.id = s.relationship_id
  where s.professional_id = p_professional_id
    and p.is_public
    and s.consent_state = 'approved'
    and cpp.is_public
    and r.completed_interaction_count >= 1
  order by cpp.display_name asc nulls last;
$$;

comment on function public.list_public_professional_showcases(uuid) is
  'Anon-callable. The public social-proof list for one professional ("Already cutting X"). Returns ONLY display name, username, avatar and a live verified flag — never an appointment id, a date, an interaction count, a customer UUID or an organization. Requires approved consent AND a public customer profile AND a genuine completed-service relationship.';

revoke execute on function public.list_public_professional_showcases(uuid) from public;
grant execute on function public.list_public_professional_showcases(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_public_customer_profile
--
-- Lookup by username, not by user id — a public profile is addressed by its
-- public handle, and the account UUID never appears in a public URL.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_customer_profile(p_username text)
returns table (
  username text,
  display_name text,
  avatar_url text,
  bio text,
  persona_category text,
  is_verified boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    cpp.username,
    cpp.display_name,
    cpp.avatar_url,
    cpp.bio,
    cpp.persona_category,
    cpp.verification_state = 'verified'
  from public.customer_public_profiles cpp
  where cpp.username is not null
    and lower(cpp.username) = lower(btrim(coalesce(p_username, '')))
    and cpp.is_public;
$$;

comment on function public.get_public_customer_profile(text) is
  'Anon-callable public projection of a customer identity, addressed by username. Returns zero rows unless the customer opted in with is_public. Never returns email, phone, user_id, booking or visit history, passport data, or anything from customer_profiles/customer_passports.';

revoke execute on function public.get_public_customer_profile(text) from public;
grant execute on function public.get_public_customer_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_my_follow_state — the customer's own view of one edge
-- ---------------------------------------------------------------------------

create or replace function public.get_my_follow_state(p_professional_id uuid)
returns table (
  is_following boolean,
  source text,
  has_explicit_unfollow boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    f.state = 'following',
    f.source,
    f.has_explicit_unfollow
  from public.professional_follows f
  where f.professional_id = p_professional_id
    and f.follower_user_id = (select auth.uid());
$$;

comment on function public.get_my_follow_state(uuid) is
  'Authenticated-only. The caller''s own follow edge for one professional. Zero rows means never followed — distinct from an explicit unfollow, which returns a row with has_explicit_unfollow true.';

revoke execute on function public.get_my_follow_state(uuid) from public, anon;
grant execute on function public.get_my_follow_state(uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260824101000_public_projections.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next step: run
--   supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
-- and confirm 0 FAIL rows. The PASS count depends on the database it ran
-- against: a fresh database skips the backfill section, a database that
-- actually had pre-R1 rows exercises it. What must always hold is FAIL = 0.
-- ============================================================================
