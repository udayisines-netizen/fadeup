-- ============================================================================
-- FadeUp — MASTER: R1B, the Social-First identity and relationship foundation
-- Generated 2026-08-26. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r1b.sh
-- Verify in sync:   scripts/generate-master-r1b.sh --check
--
-- WHAT THIS IS
--
--   R1B is the durable data model the social product is built on. It is NOT
--   the social frontend: no feed, no messaging, no follower UI, no public
--   launch of Worker-discovered profiles. Those are R6/R7/R10 and are
--   deliberately absent.
--
--   It adds five tables, three columns, and a set of controlled write paths:
--
--     professionals                          a barber's identity, independent
--                                            of any shop they happen to work at
--     barbers.professional_id                the roster points at the identity
--     professional_follows                   the follow graph, with a durable
--                                            explicit-unfollow tombstone
--     customer_professional_relationships    services that actually happened
--     customer_passports.passport_number     the Passport becomes automatic
--     professional_claims                    taking control of an identity
--     prospect_professionals                 acquisition provenance, one-way
--
--   R1B REQUIRES R1A. The first migration asserts it — completed_at, the
--   appointment transition guard, booked_by_user_id and the non-cascading
--   barber FK must all be present — and refuses to install otherwise. That is
--   not ceremony: a durable identity built over deletable appointment history
--   and forgeable completion state would be theatre.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. EXPLICIT UNFOLLOW BEATS AUTOMATION, PERMANENTLY.
--      Auto-follow is ON CONFLICT DO NOTHING with no DO UPDATE branch
--      anywhere. It can only ever CREATE an edge, so no later booking can
--      reverse a customer's deliberate unfollow. Only the customer's own
--      manual follow can.
--
--   B. AUTO-FOLLOW USES booked_by_user_id AND NOTHING ELSE.
--      Not customers.user_id, which R1A demoted from evidence because it was
--      squattable and staff-settable. An anonymous booking, a kiosk walk-in
--      and a receptionist-typed appointment therefore produce NO follow. That
--      is lossy by design; the alternative is fabricating a relationship for
--      someone who never acted.
--
--   C. UNCLAIMED PROFILES CANNOT BE PUBLISHED, AND THE SCHEMA SAYS SO.
--      check (not is_public or claim_state = 'claimed'). R10 turns publication
--      on by removing that one clause, deliberately. Until then the unclaimed
--      public projection is correct and returns zero rows for every input.
--
--   D. AN UNCLAIMED PROFILE CANNOT IMPLY OPERATIONAL STATE, STRUCTURALLY.
--      All operational data — availability, services, hours, appointments,
--      queue entries — hangs off barbers/organizations and never off the
--      identity. An unclaimed professional has no barbers row, so there is no
--      column in which a fabricated wait time could be stored. The claimed and
--      unclaimed projections have DIFFERENT RETURNS TABLE shapes so a future
--      column cannot silently join the unclaimed contract.
--
--   E. EVERY REGISTERED CUSTOMER GETS A PASSPORT, AUTOMATICALLY.
--      Issued on customer_profiles insert and backfilled for everyone who
--      already exists. The number is 80 bits of CSPRNG, non-sequential, and
--      frozen — it is an IDENTIFIER, never an authenticator. The credential
--      remains the revocable hashed share token.
--
--   F. NEW TABLES SHIP WITH PRIVILEGES REVOKED, NOT MERELY WITH RLS.
--      Supabase default privileges grant anon and authenticated EVERYTHING on
--      any new table in public. Every R1B table revokes at creation, and
--      20260826101000 re-asserts the entire matrix and FAILS the migration if
--      any of it is wrong.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Creating a barbers row now also mints (or links) a professional
--      identity. No API changes; the trigger derives it.
--   2. barbers.professional_id is not writable by any client, and INSERT was
--      revoked at table level then re-granted per column. Anything writing
--      barbers must send only the columns it always sent.
--   3. Confirming an appointment for a signed-in booker now creates a follow
--      edge. Completing one now writes a relationship row.
--   4. Every customer_profiles insert now issues a Passport.
--   5. customer_passports gains two NOT NULL server-owned columns. The
--      existing PostgREST upsert is unaffected — user_id remains
--      UPDATE-grantable, which R1A recorded as load-bearing.
--   6. Deleting a professional identity that backs a roster row raises 23503.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Removes no table, removes no column, truncates nothing.
--   * Writes data in three places, all additive: the professional identity
--     backfill, the Passport backfill, and relationship rows created by new
--     triggers going forward. No existing row's meaning is rewritten.
--   * Does not touch the GiST exclusion constraints that decide booking races.
--   * Adds no anon RLS policy. The count stays at zero, and 20260826101000
--     asserts it.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--
--   R1A's verification must still pass unchanged:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260826100000_professional_identity.sql
-- ============================================================================

-- FadeUp — R1B: the durable professional identity
--
-- WHAT THIS FIXES
--
-- Today a barber IS a `barbers` row, keyed 1:1 to a `staff_profiles` row that
-- is UNIQUE (organization_id, user_id). One human working at two shops is two
-- unrelated UUIDs with nothing joining them, and leaving a shop erases the
-- only thing that said they were a professional. Employment is a relationship
-- a professional HAS; it is not what a professional IS.
--
-- `professionals` is that missing identity. It is deliberately platform-scoped
-- rather than tenant-scoped, and that exemption from the CLAUDE.md
-- organization_id rule is argued, not omitted:
--
--   * the entire point of the row is to OUTLIVE org membership;
--   * no tenant business data lives here — availability, services, working
--     hours, appointments and queue entries all hang off barbers/organizations
--     and never off this table;
--   * so a professional working at organizations A and B exposes nothing of A
--     to B, because there is nothing operational to expose.
--
-- That absence is also the safety property that makes external, unclaimed
-- profiles possible at all. An unclaimed professional has no `barbers` row, so
-- it is STRUCTURALLY IMPOSSIBLE for a Worker-discovered profile to imply a
-- bookable slot, a live queue, a wait time or a schedule. Constitution §5.5 is
-- satisfied by the absence of the modelling, not by a filter applied at render
-- time.
--
-- THREE STATES THAT ARE NOT THE SAME THING
--
--   1. the identity EXISTS                  — a row is present
--   2. the identity is ELIGIBLE to publish  — claimed, with a usable name
--   3. the identity IS publicly projected   — is_public = true
--
-- Existence is not visibility. Each step up is a separate, enforced predicate,
-- and R1B additionally pins (2) shut for unclaimed identities: publishing
-- Worker-discovered profiles is R10's decision, and until R10 makes it the
-- database refuses the state rather than trusting a caller to remember.
--
-- CLAIM STATE IS AN EXPLICIT COLUMN, NOT A NULLABLE FK
--
-- The obvious shortcut is `user_id IS NULL means unclaimed`. This schema
-- already carries one overloaded nullable identity FK — customers.user_id —
-- and R1A exists largely because that column became a predicate every query
-- had to remember. claim_state is explicit, indexable and constrained.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. R1A preconditions, asserted rather than assumed
--
-- R1B rests on R1A having LANDED, not merely on the filenames sorting the
-- right way. A professional identity built over deletable appointment history
-- and forgeable completion state would be theatre, so refuse to install rather
-- than build on a substrate that has not been hardened.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'completed_at'
  ) then
    raise exception 'R1B precondition failed: appointments.completed_at is missing — apply R1A first'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'appointments_enforce_transition' and not tgisinternal
  ) then
    raise exception 'R1B precondition failed: the R1A appointment transition guard is missing — apply R1A first'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'booked_by_user_id'
  ) then
    raise exception 'R1B precondition failed: appointments.booked_by_user_id is missing — apply R1A first'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_barber_id_fkey' and confdeltype = 'c'
  ) then
    raise exception 'R1B precondition failed: appointments.barber_id still CASCADEs — apply R1A first'
      using errcode = '55000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Closed sets, so an enum
--
-- Both of these are genuinely closed: a professional identity is controlled by
-- an account or it is not, and an identity was minted by FadeUp itself or by
-- acquisition. Sets expected to grow use text + CHECK elsewhere in this
-- schema; these are not those.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'professional_claim_state') then
    create type public.professional_claim_state as enum ('unclaimed', 'claimed');
  end if;
  if not exists (select 1 from pg_type where typname = 'professional_source') then
    create type public.professional_source as enum ('fadeup', 'acquisition');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------------

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),

  -- The discriminator. Everything else about ownership is a consequence.
  claim_state public.professional_claim_state not null default 'unclaimed',

  -- The controlling account. NULL is a CONSEQUENCE of being unclaimed, never
  -- the source of truth for it. ON DELETE SET NULL, not RESTRICT: erasing an
  -- account must not dead-end on a foreign key, and must not destroy the
  -- identity that historical appointments point at through barbers. The
  -- BEFORE UPDATE guard below turns that detach into a coherent unclaimed row.
  user_id uuid unique references auth.users (id) on delete set null,

  display_name text not null,

  -- The professional's own shop-independent public address. Nullable on
  -- purpose: uniqueness has to exist from day one, but forcing a backfilled
  -- handle onto every existing barber would churn public identity for no
  -- product reason. R6/R7 populates it.
  handle text,

  headline text,
  bio text,
  avatar_url text,

  -- How this identity came to exist. Withheld from client SELECT below: that
  -- an identity was minted from acquisition is FadeUp's internal fact, not a
  -- public one.
  source public.professional_source not null default 'fadeup',

  -- (3) currently publicly projected. Opt-in, never inherited from
  -- staff_profiles.is_public — a shop having made someone visible on its own
  -- roster is not that person's consent to a platform-wide public identity.
  is_public boolean not null default false,

  claimed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professionals_display_name_not_blank
    check (btrim(display_name) <> ''),

  constraint professionals_handle_shape
    check (handle is null or handle ~ '^[a-z0-9][a-z0-9_.]{1,29}$'),

  -- The state machine's core invariant, in the database rather than in every
  -- write path's memory.
  constraint professionals_claim_state_matches_user
    check ((claim_state = 'claimed') = (user_id is not null)),

  constraint professionals_claim_state_matches_timestamp
    check ((claim_state = 'claimed') = (claimed_at is not null)),

  -- (2) publication eligibility, enforced. An identity with no usable name
  -- cannot be published, and — for R1B — neither can an unclaimed one.
  -- R10 removes only the claim_state clause, deliberately and in writing.
  constraint professionals_publication_eligibility
    check (not is_public or (claim_state = 'claimed' and btrim(display_name) <> ''))
);

comment on table public.professionals is
  'The durable, shop-independent identity of a professional. Platform-scoped by design (see migration header): it exists to OUTLIVE membership of any organization, and carries no operational data — availability, services, appointments and queue entries hang off barbers/organizations only. That absence is what makes an unclaimed external profile structurally incapable of implying FadeUp operational truth.';

comment on column public.professionals.claim_state is
  'Who controls this identity. NEVER subscription state (Constitution §5.6): claimed does not mean paid. This is the discriminator; user_id being NULL is its consequence, not its source.';

comment on column public.professionals.user_id is
  'The controlling account. ON DELETE SET NULL: erasing an account DETACHES it and the professionals_guard_identity trigger reverts the row to unclaimed, rather than dead-ending erasure on a foreign key or cascading away an identity that appointment history depends on.';

comment on column public.professionals.is_public is
  'Whether this identity is CURRENTLY projected publicly. Distinct from existence and from eligibility. Never inherited from staff_profiles.is_public.';

comment on column public.professionals.source is
  'fadeup = minted from a real FadeUp roster record; acquisition = minted from a canonical prospect by create_external_professional. Withheld from client SELECT: internal provenance.';

comment on column public.professionals.handle is
  'Public shop-independent address. Nullable bridge — uniqueness exists from day one but no handle is backfilled, because inventing public usernames for existing barbers would churn identity nobody asked to change. Populated by R6/R7.';

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

create unique index if not exists professionals_handle_unique
  on public.professionals (lower(handle)) where handle is not null;

create index if not exists professionals_claim_state_idx
  on public.professionals (claim_state);

create index if not exists professionals_public_idx
  on public.professionals (id) where is_public;

drop trigger if exists professionals_set_updated_at on public.professionals;
create trigger professionals_set_updated_at
  before update on public.professionals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. The state guard
--
-- Two jobs, and they are different:
--
--   A. Translate the FK-driven detach (user_id -> NULL, issued by the
--      referential-integrity trigger when the auth.users row is erased) into a
--      coherent unclaimed row. Without this the CHECK constraints above make
--      account erasure impossible.
--
--   B. Refuse any other change to ownership/provenance columns unless the
--      transaction-local flag set by the claim RPCs is on. The column grants
--      below already stop `authenticated` writing these, but grants protect
--      only the roles they name; this holds for service_role and direct SQL
--      too, matching how R1A guards appointment transitions.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the erasure test below can read auth.users regardless of
-- which role the UPDATE arrives under — including the referential-integrity
-- action itself.
create or replace function public.guard_professional_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_privileged boolean := coalesce(current_setting('fadeup.professional_claim_write', true), '') = 'on';
begin
  -- (A) account erasure: the RI trigger has just nulled user_id.
  --
  -- "user_id went to NULL" is NOT sufficient evidence on its own — a
  -- privileged caller could write exactly that by hand and thereby unclaim an
  -- identity the guard is supposed to protect. The distinguishing fact is that
  -- the ACCOUNT IS GONE: ON DELETE SET NULL runs after the auth.users row has
  -- been removed, so it is invisible here, whereas a hand-written detach
  -- leaves it standing.
  if old.user_id is not null and new.user_id is null then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'professionals.user_id is set by the claim lifecycle, not by detaching a live account'
        using errcode = '42501';
    end if;
    new.claim_state := 'unclaimed';
    new.claimed_at  := null;
    new.is_public   := false;
    return new;
  end if;

  if v_privileged then
    return new;
  end if;

  if new.claim_state is distinct from old.claim_state then
    raise exception 'professionals.claim_state is set by the claim lifecycle, not directly'
      using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'professionals.user_id is set by the claim lifecycle, not directly'
      using errcode = '42501';
  end if;

  if new.claimed_at is distinct from old.claimed_at then
    raise exception 'professionals.claimed_at is server-owned'
      using errcode = '42501';
  end if;

  if new.source is distinct from old.source then
    raise exception 'professionals.source is provenance and is immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_professional_identity() is
  'BEFORE UPDATE invariant on professionals. Translates the ON DELETE SET NULL detach into a coherent unclaimed row so account erasure never dead-ends, and otherwise freezes claim_state/user_id/claimed_at/source against every caller including service_role. Only the claim RPCs, which set fadeup.professional_claim_write, may move them.';

drop trigger if exists professionals_guard_identity on public.professionals;
create trigger professionals_guard_identity
  before update on public.professionals
  for each row execute function public.guard_professional_identity();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--
-- SELECT: the professional themself; members of an organization whose roster
--   this identity is on; platform staff. Anonymous and unrelated customers
--   read NOTHING here directly — they go through the curated projections in
--   20260826100900, which is the whole point of having a data contract.
--
-- INSERT: nobody. Identities are minted by the barbers assignment trigger, by
--   the backfill, or by create_external_professional — all SECURITY DEFINER.
--
-- UPDATE: the professional themself, presentational columns only (enforced by
--   the column grants below plus the guard trigger above). Platform staff via
--   RPC.
--
-- DELETE: nobody, ever. A professional identity is what appointment history is
--   anchored to; removing one is the same class of mistake R1A closed for
--   barbers.
-- ---------------------------------------------------------------------------

alter table public.professionals enable row level security;
alter table public.professionals force row level security;

-- Supabase default privileges grant anon/authenticated EVERYTHING on any new
-- table in public. Verified against pg_default_acl on the live image, not
-- assumed. Without this revoke, `authenticated` would ship holding INSERT,
-- UPDATE and DELETE on the identity table.
revoke all on public.professionals from anon, authenticated;

grant select (id, claim_state, display_name, handle, headline, bio, avatar_url,
              is_public, claimed_at, created_at, updated_at)
  on public.professionals to authenticated;

grant update (display_name, handle, headline, bio, avatar_url, is_public)
  on public.professionals to authenticated;

-- The roster-visibility arm of this policy needs barbers.professional_id,
-- which does not exist until the next migration. The narrow policy is
-- installed here so the table is never readable-by-default for a single
-- statement; 20260826100100 widens it once the column exists.
drop policy if exists professionals_select on public.professionals;
create policy professionals_select
  on public.professionals
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- "Is this identity mine?" as a definer helper, following the convention
-- private.is_org_member/is_platform_admin already set.
--
-- It has to be a function rather than an inline subquery, because
-- professionals.user_id is deliberately NOT SELECT-grantable to clients — a
-- client that could read it could map every public professional to an account.
-- A policy on ANOTHER table that subqueries this one is evaluated with the
-- CALLER's privileges, so an inline `select ... from professionals where
-- user_id = auth.uid()` fails with 42501 rather than returning false. That is
-- a genuinely confusing failure mode, and this is the fix.
create or replace function private.is_own_professional(p_professional_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.professionals p
    where p.id = p_professional_id and p.user_id = (select auth.uid())
  );
$$;

comment on function private.is_own_professional(uuid) is
  'True when the calling account controls this professional identity. Exists because professionals.user_id is withheld from client SELECT, so a policy on another table cannot test it inline without tripping 42501.';

revoke execute on function private.is_own_professional(uuid) from public, anon;
grant execute on function private.is_own_professional(uuid) to authenticated;

drop policy if exists professionals_update_self on public.professionals;
create policy professionals_update_self
  on public.professionals
  for update
  to authenticated
  using (user_id = (select auth.uid()) and claim_state = 'claimed')
  with check (user_id = (select auth.uid()) and claim_state = 'claimed');

-- No INSERT policy and no DELETE policy: deliberate. Writes arrive through
-- SECURITY DEFINER functions owned by postgres, mirroring the convention
-- appointment_claim_tokens already established.


-- ============================================================================
-- END db/migrations/20260826100000_professional_identity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100100_barber_professional_linkage.sql
-- ============================================================================

-- FadeUp — R1B: the roster points at the identity
--
-- `barbers` and `professionals` answer different questions and must not be
-- collapsed:
--
--   barbers        "is this person bookable, at this shop, right now"
--   professionals  "who is this person, independent of any shop"
--
-- barbers.professional_id is the join. It is NULLABLE for exactly one lot:
-- a column cannot be NOT NULL in the migration that adds it, and the backfill
-- is deliberately a separate file (20260826100200). R2 tightens it —
-- CHECK ... NOT VALID -> VALIDATE -> SET NOT NULL -> drop the check.
--
-- FOREIGN KEY DELETION SEMANTICS, CHOSEN NOT INHERITED
--
--   ON DELETE RESTRICT. Deleting a professional identity that still backs a
--   roster row must fail loudly. This is the same reasoning R1A applied to
--   appointments.barber_id: an identity is what history hangs off, and the
--   only thing worse than an orphaned row is a silently destroyed one. There
--   is no client DELETE path to professionals at all (no policy, no grant), so
--   RESTRICT is defence in depth rather than the primary control.
--
--   Offboarding is NOT deletion, and R1A already made that explicit with
--   offboard_barber(). Removing someone from a roster must never touch their
--   durable identity: they are still a professional, they just no longer work
--   here. That separation is the whole point of this lot.
--
-- UNIQUENESS
--
--   Globally unique would be WRONG — one human working at two shops is
--   precisely the case this lot exists to represent, and that is two barbers
--   rows sharing one professional_id.
--
--   Unique per ORGANIZATION is right, and is a real invariant: a person cannot
--   hold two roster seats at the same shop. It already follows from
--   staff_profiles_org_user_unique plus barbers_staff_profile_unique for
--   account-backed rows, but it must hold for detached and acquisition-minted
--   identities too, where that chain does not apply.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'barbers' and column_name = 'professional_id'
  ) then
    alter table public.barbers
      add column professional_id uuid references public.professionals (id) on delete restrict;
  end if;
end $$;

comment on column public.barbers.professional_id is
  'The durable identity behind this roster seat. Nullable ONLY as an R1B->R2 bridge: the backfill in 20260826100200 fills every row and asserts completeness, and R2 sets NOT NULL. ON DELETE RESTRICT — an identity that still backs a roster row cannot be removed. Not writable by any client (see the column grants below): a shop must not be able to point a roster seat at a professional identity it does not own.';

create index if not exists barbers_professional_id_idx
  on public.barbers (professional_id) where professional_id is not null;

-- Mandatory, not merely nice: without a professional_id index every identity
-- delete attempt seq-scans barbers to evaluate the RESTRICT. This one also
-- carries the per-organization uniqueness invariant.
create unique index if not exists barbers_org_professional_unique
  on public.barbers (organization_id, professional_id) where professional_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Assignment for NEW roster rows
--
-- Every path that creates a barbers row today — the roster UI, invitations,
-- ensure_owner_professional — must keep working unchanged, and must produce a
-- linked row. A BEFORE INSERT trigger derives the identity from the account
-- behind the staff profile, minting one on first sight.
--
-- SECURITY DEFINER because `professionals` has no INSERT policy and no INSERT
-- grant: minting an identity is a server act, never a client one. It sets the
-- claim-write flag around its own INSERT only, and clears it immediately, so
-- the guard trigger's freeze is relaxed for exactly one statement.
--
-- A staff profile with a NULL user_id (an R1A account-erasure tombstone) gets
-- NO identity here: there is no account to claim it, and inventing a claimed
-- identity for a deleted account would be fabrication. The backfill handles
-- the historical case explicitly and honestly; a NEW roster row for a detached
-- staff profile is not a real scenario, and leaving professional_id NULL keeps
-- it visible rather than papered over.
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
  v_avatar_url text;
  v_professional_id uuid;
begin
  -- A client-supplied professional_id is never trusted. INSERT on this column
  -- is revoked below, so `authenticated` cannot send one at all; this makes
  -- the same guarantee hold for service_role and direct SQL.
  new.professional_id := null;

  select sp.user_id, sp.display_name, sp.avatar_url
    into v_user_id, v_display_name, v_avatar_url
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if v_user_id is null then
    return new;
  end if;

  select p.id into v_professional_id
  from public.professionals p
  where p.user_id = v_user_id;

  if v_professional_id is null then
    perform set_config('fadeup.professional_claim_write', 'on', true);
    -- ON CONFLICT, not select-then-insert: two roster seats created
    -- concurrently for the same account must yield exactly one identity, and
    -- the unique index on user_id is the only thing that can promise that.
    insert into public.professionals (user_id, claim_state, claimed_at, display_name, avatar_url, source)
    values (
      v_user_id, 'claimed', now(),
      coalesce(nullif(btrim(coalesce(v_display_name, '')), ''), 'Professional'),
      v_avatar_url, 'fadeup'
    )
    on conflict (user_id) do nothing;
    perform set_config('fadeup.professional_claim_write', 'off', true);

    select p.id into v_professional_id
    from public.professionals p
    where p.user_id = v_user_id;
  end if;

  new.professional_id := v_professional_id;
  return new;
end;
$$;

comment on function public.assign_barber_professional() is
  'BEFORE INSERT on barbers. Derives professional_id from the account behind the staff profile, minting the durable identity on first sight via ON CONFLICT (user_id) so concurrent roster creation cannot produce two identities for one person. Always overwrites any caller-supplied professional_id: a shop must never be able to name an identity it does not own.';

drop trigger if exists barbers_assign_professional on public.barbers;
create trigger barbers_assign_professional
  before insert on public.barbers
  for each row execute function public.assign_barber_professional();

-- ---------------------------------------------------------------------------
-- 3. professional_id is server-owned
--
-- A column-level REVOKE cannot subtract from a table-level grant — it is a
-- silent no-op. So the privilege goes at TABLE level and every other column is
-- re-granted explicitly, the same mechanism R1A used for appointments and
-- queue_entries.
--
-- Both INSERT and UPDATE, for the same reason R1A revoked both on
-- booked_by_user_id: revoking UPDATE alone leaves the value forgeable in a
-- single INSERT.
-- ---------------------------------------------------------------------------

revoke insert, update on public.barbers from authenticated, anon;

grant insert (id, organization_id, staff_profile_id, is_bookable, created_at, updated_at)
  on public.barbers to authenticated;
grant update (organization_id, staff_profile_id, is_bookable, created_at, updated_at)
  on public.barbers to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Widen the identity SELECT policy now that the join column exists
--
-- A shop needs to read the identity behind its own roster — the Pro workspace
-- and the roster UI both resolve a name through it. This arm could not be
-- written in 20260826100000 because the column did not exist yet.
-- ---------------------------------------------------------------------------

drop policy if exists professionals_select on public.professionals;
create policy professionals_select
  on public.professionals
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
    or exists (
      select 1
      from public.barbers b
      where b.professional_id = public.professionals.id
        and (select private.is_org_member(b.organization_id))
    )
  );


-- ============================================================================
-- END db/migrations/20260826100100_barber_professional_linkage.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100200_professional_identity_backfill.sql
-- ============================================================================

-- FadeUp — R1B: every existing barber gets their durable identity
--
-- Separate from the schema migration on purpose (MIGRATION_STRATEGY §1): a
-- backfill is data, it can be long, and it must be restartable independently
-- of the DDL that made it possible.
--
-- THREE POPULATIONS, AND THEY ARE NOT THE SAME
--
--   A. Account-backed roster rows — staff_profiles.user_id is not null.
--      One CLAIMED identity per DISTINCT account, not per barbers row. That is
--      the entire point: one human at two shops must end with ONE identity.
--
--   B. Detached roster rows — staff_profiles.user_id is null, which R1A made
--      reachable when it changed that FK to ON DELETE SET NULL so account
--      erasure would stop cascading away a shop's service history.
--
--      These are real professionals whose account no longer exists. They get
--      an UNCLAIMED identity, one per staff profile. That is honest: the
--      person worked here (the roster row and their appointments prove it),
--      and nobody controls the identity now. Minting a CLAIMED identity would
--      assert an account that was deliberately erased.
--
--   C. Nothing else. If a barbers row survives with no identity the migration
--      RAISES rather than shipping a silently incomplete link, because R2 is
--      going to set this column NOT NULL and a NULL discovered then is a much
--      more expensive problem.
--
-- WHAT IS NOT INHERITED, DELIBERATELY
--
--   is_public. A shop having made someone visible on its own roster is not
--   that person's consent to a platform-wide public identity, and R1B keeps
--   every backfilled identity unpublished. Constitution §2.1's "opting in must
--   be a deliberate act" is about customers, but the same reasoning holds here
--   and the cost of getting it wrong is identical.
--
--   handle. No public username is invented for anyone (see 20260826100000).
--
-- claimed_at is set to the EARLIEST staff_profiles.created_at for that
-- account, not to now(). The account has controlled this professional identity
-- since it first became a barber; stamping now() would assert that a
-- ten-year-old shop's staff were all claimed the day this migration ran.
-- The roster row is real evidence of when that began.
--
-- Deterministic: the display name comes from the account's earliest staff
-- profile under a total ordering (created_at, id), so a re-run on the same
-- data produces the same result.
--
-- Idempotent: every step is guarded on professional_id being null or the
-- identity being absent. A second run does nothing.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- A. One claimed identity per distinct barber-holding account
-- ---------------------------------------------------------------------------

do $$
declare
  v_minted integer;
begin
  perform set_config('fadeup.professional_claim_write', 'on', true);

  insert into public.professionals (user_id, claim_state, claimed_at, display_name, avatar_url, source)
  select distinct on (sp.user_id)
         sp.user_id,
         'claimed'::public.professional_claim_state,
         sp.created_at,
         coalesce(nullif(btrim(sp.display_name), ''), 'Professional'),
         sp.avatar_url,
         'fadeup'::public.professional_source
  from public.staff_profiles sp
  join public.barbers b on b.staff_profile_id = sp.id
  where sp.user_id is not null
  order by sp.user_id, sp.created_at, sp.id
  on conflict (user_id) do nothing;

  get diagnostics v_minted = row_count;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  raise notice 'R1B identity backfill: % claimed identities minted for existing barber accounts', v_minted;
end $$;

-- ---------------------------------------------------------------------------
-- A2. Link the account-backed roster rows
-- ---------------------------------------------------------------------------

update public.barbers b
set professional_id = p.id
from public.staff_profiles sp
join public.professionals p on p.user_id = sp.user_id
where b.staff_profile_id = sp.id
  and b.professional_id is null
  and sp.user_id is not null;

-- ---------------------------------------------------------------------------
-- B. Detached roster rows get an unclaimed identity, one per staff profile
--
-- A loop rather than a data-modifying CTE: each row needs its own generated
-- identity correlated back to its own barbers row, and a loop over a small,
-- deterministic ordering says that plainly. This population is tiny by
-- construction — it only exists where an account was erased.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_professional_id uuid;
  v_minted integer := 0;
begin
  for r in
    select b.id as barber_id, sp.display_name, sp.avatar_url
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.professional_id is null
    order by b.id
  loop
    insert into public.professionals (claim_state, display_name, avatar_url, source)
    values (
      'unclaimed',
      coalesce(nullif(btrim(coalesce(r.display_name, '')), ''), 'Former professional'),
      r.avatar_url,
      'fadeup'
    )
    returning id into v_professional_id;

    update public.barbers set professional_id = v_professional_id where id = r.barber_id;
    v_minted := v_minted + 1;
  end loop;

  if v_minted > 0 then
    raise notice 'R1B identity backfill: % unclaimed identities minted for roster rows whose account was erased', v_minted;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. Completeness, asserted
--
-- An empty backfill reports success vacuously, so the assertion is on the
-- POST-condition rather than on how many rows moved.
-- ---------------------------------------------------------------------------

do $$
declare
  v_unlinked integer;
  v_dupes integer;
  v_total integer;
begin
  select count(*) into v_unlinked from public.barbers where professional_id is null;
  if v_unlinked > 0 then
    raise exception 'R1B identity backfill incomplete: % barbers rows still have no professional identity', v_unlinked
      using errcode = 'P0001';
  end if;

  -- One human at two shops must be ONE identity. If two distinct identities
  -- ended up carrying the same account something is badly wrong; the unique
  -- index on user_id should already make this impossible, so this asserts the
  -- index rather than the query.
  select count(*) into v_dupes
  from (
    select user_id from public.professionals
    where user_id is not null
    group by user_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'R1B identity backfill produced % duplicated account identities', v_dupes
      using errcode = 'P0001';
  end if;

  select count(*) into v_total from public.professionals;
  raise notice 'R1B identity backfill complete: % professional identities, 0 unlinked barbers', v_total;
end $$;


-- ============================================================================
-- END db/migrations/20260826100200_professional_identity_backfill.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100300_social_graph_follows.sql
-- ============================================================================

-- FadeUp — R1B: the follow graph
--
-- ONE ROW PER (follower, professional), MUTATED IN PLACE
--
-- Not an append-only log, not two tables, and not a derived count. The
-- relationship itself is canonical; counts are computed from it.
--
--   state          following | unfollowed    the current edge
--   source         manual | auto            how the CURRENT state arose
--   followed_at    when following began, NULL if it never did
--   unfollowed_at  set on unfollow — this IS the intent
--
-- WHY THERE IS NO STICKY has_explicit_unfollow FLAG
--
-- Because state='unfollowed' ALREADY IS explicit unfollow. Auto-follow can
-- only ever CREATE an edge — the trigger below is ON CONFLICT DO NOTHING, with
-- no DO UPDATE branch anywhere — so no automatic event can ever move a row out
-- of 'unfollowed'. A separate flag would carry exactly the same information and
-- add a second thing every write path has to remember.
--
-- That single ON CONFLICT DO NOTHING is the whole of Constitution §3.4:
--
--   customer explicitly unfollows
--          v
--   later genuine booking fires auto-follow
--          v
--   conflict on (follower_user_id, professional_id) -> DO NOTHING
--          v
--   the customer's decision stands
--
-- It is race-safe for the same reason: the unique index, not application
-- ordering, decides. An auto-follow racing a manual unfollow either loses the
-- insert (row already exists, nothing happens) or wins it and is then
-- overwritten by the unfollow's UPDATE. Neither interleaving can leave a
-- customer following someone they just unfollowed.
--
-- followed_at IS NULLABLE, and that matters
--
-- Unfollowing something you never followed creates a pure tombstone. Stamping
-- followed_at = now() on that row would record a follow that never happened,
-- in a column ANALYTICS_DRAFT §5 is going to read. NULL says "never followed".
--
-- WHY UNCLAIMED PROFESSIONALS CANNOT BE FOLLOWED
--
-- An unclaimed identity is a Worker-discovered external profile, or a roster
-- record whose account was erased. Letting either accrue followers would
-- manufacture social proof about a FadeUp presence that does not exist
-- (Constitution §5.5). Both write paths require claim_state='claimed', so an
-- unclaimed profile's follower count is structurally zero rather than
-- filtered-to-zero at render time.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'follow_state') then
    create type public.follow_state as enum ('following', 'unfollowed');
  end if;
  if not exists (select 1 from pg_type where typname = 'follow_source') then
    create type public.follow_source as enum ('manual', 'auto');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The edge
-- ---------------------------------------------------------------------------

create table if not exists public.professional_follows (
  id uuid primary key default gen_random_uuid(),

  -- The ACCOUNT, not a customers row. customers.user_id is a per-shop CRM
  -- bridge that R1A demoted from evidence precisely because it was squattable;
  -- a social edge must never rest on it.
  --
  -- ON DELETE CASCADE: a follow is the follower's own personal data, and it
  -- means nothing without them. Erasure removes it. This is the one place in
  -- R1B where cascade is right, because there is no business record here — the
  -- service history that must survive erasure lives on appointments.
  follower_user_id uuid not null references auth.users (id) on delete cascade,

  -- ON DELETE CASCADE: an edge pointing at an identity that no longer exists
  -- is not evidence of anything. In practice unreachable — professionals has
  -- no DELETE policy and no DELETE grant — but a default deletion behaviour is
  -- never accepted by accident here.
  professional_id uuid not null references public.professionals (id) on delete cascade,

  state public.follow_state not null default 'following',
  source public.follow_source not null default 'manual',

  followed_at timestamptz,
  unfollowed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Idempotency and race-safety in one line. Follow never has to
  -- select-then-insert.
  constraint professional_follows_unique unique (follower_user_id, professional_id),

  -- The timestamps cannot disagree with the state.
  constraint professional_follows_state_timestamps check (
    (state = 'following' and followed_at is not null and unfollowed_at is null)
    or (state = 'unfollowed' and unfollowed_at is not null)
  )
);

comment on table public.professional_follows is
  'Customer -> professional follow edge, one row per pair, mutated in place. state=''unfollowed'' IS explicit unfollow: auto-follow can only ever CREATE a row (ON CONFLICT DO NOTHING), never transition one, so no automatic event can reverse a customer''s deliberate decision. A follow is an expression of INTENT and is never evidence that a service happened — see customer_professional_relationships for that, and Constitution §3.2.';

comment on column public.professional_follows.followed_at is
  'When following began. NULL means it never did — the row is a pure unfollow tombstone. Never stamped speculatively.';

comment on column public.professional_follows.unfollowed_at is
  'The customer''s explicit decision to stop, and the timestamp of it. Preserved across repeat unfollows: the first refusal is the truthful one.';

comment on column public.professional_follows.source is
  'How the CURRENT state arose. A manual follow always overwrites this to ''manual'', because the customer''s own action is what the row now records.';

-- Follower count. Leading column is the count predicate.
create index if not exists professional_follows_professional_idx
  on public.professional_follows (professional_id) where state = 'following';

-- "who I follow", paginated. Leading column is the RLS predicate, so the
-- index and the policy agree. A bare (follower_user_id) index is deliberately
-- NOT added — it is a strict prefix of the unique constraint.
create index if not exists professional_follows_follower_idx
  on public.professional_follows (follower_user_id, followed_at desc) where state = 'following';

drop trigger if exists professional_follows_set_updated_at on public.professional_follows;
create trigger professional_follows_set_updated_at
  before update on public.professional_follows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS
--
-- SELECT: own edges, and platform. NOT the professional — who follows you is
--   the follower's private state, and R1B exposes only a count through the
--   curated projection. A professional learning the identity of every follower
--   is a product decision R6/R7 gets to make deliberately, not a side effect of
--   a policy written here.
--
-- INSERT / UPDATE / DELETE: NO POLICY AT ALL, mirroring
--   appointment_claim_tokens. Every write arrives through a SECURITY DEFINER
--   function owned by postgres. A client that could INSERT directly could
--   forge another customer's edge, choose its own timestamps, or resurrect a
--   row it had unfollowed.
-- ---------------------------------------------------------------------------

alter table public.professional_follows enable row level security;
alter table public.professional_follows force row level security;

-- Supabase default privileges hand anon/authenticated everything on any new
-- public table. Without this the follow graph would ship world-writable.
revoke all on public.professional_follows from anon, authenticated;
grant select (id, professional_id, state, source, followed_at, unfollowed_at, created_at, updated_at)
  on public.professional_follows to authenticated;

drop policy if exists professional_follows_select on public.professional_follows;
create policy professional_follows_select
  on public.professional_follows
  for select
  to authenticated
  using (
    follower_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- 3. follow_professional — deliberate, and the only thing that can reverse an
--    explicit unfollow
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
    raise exception 'follow requires an authenticated session' using errcode = '42501';
  end if;

  -- Unclaimed identities cannot be followed: see the migration header.
  if not exists (
    select 1 from public.professionals p
    where p.id = p_professional_id and p.claim_state = 'claimed'
  ) then
    raise exception 'professional not found or not claimable' using errcode = '42704';
  end if;

  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at, unfollowed_at)
  values (v_user_id, p_professional_id, 'following', 'manual', now(), null)
  on conflict (follower_user_id, professional_id) do update
    set state = 'following',
        source = 'manual',
        -- Re-following something already followed must not restate WHEN it
        -- began. Only a genuine transition moves the timestamp.
        followed_at = case
          when public.professional_follows.state = 'following'
          then public.professional_follows.followed_at
          else now()
        end,
        unfollowed_at = null;
end;
$$;

comment on function public.follow_professional(uuid) is
  'Authenticated-only. Idempotent: following twice is a no-op that preserves the original followed_at. This is the ONLY path that can reverse an explicit unfollow, and it requires the customer''s own deliberate action — Constitution §3.4. The follower is auth.uid(); a caller cannot name someone else.';

revoke execute on function public.follow_professional(uuid) from public, anon;
grant execute on function public.follow_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. unfollow_professional — durable, and it sticks
-- ---------------------------------------------------------------------------

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
    raise exception 'unfollow requires an authenticated session' using errcode = '42501';
  end if;

  if not exists (select 1 from public.professionals p where p.id = p_professional_id) then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- The INSERT branch is what makes an unfollow durable even when no edge
  -- exists yet: it lays the tombstone that a later auto-follow will collide
  -- with. followed_at stays NULL — nothing was ever followed.
  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at, unfollowed_at)
  values (v_user_id, p_professional_id, 'unfollowed', 'manual', null, now())
  on conflict (follower_user_id, professional_id) do update
    set state = 'unfollowed',
        source = 'manual',
        -- Repeat unfollow keeps the FIRST refusal. That is when the customer
        -- actually decided.
        unfollowed_at = coalesce(public.professional_follows.unfollowed_at, now());
end;
$$;

comment on function public.unfollow_professional(uuid) is
  'Authenticated-only. Idempotent, and durable even with no prior edge — it writes a tombstone that later auto-follow attempts collide with. Repeat calls preserve the original unfollowed_at.';

revoke execute on function public.unfollow_professional(uuid) from public, anon;
grant execute on function public.unfollow_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Automatic follow, from evidence FadeUp actually holds
--
-- The provenance question is the whole design. "Which account did this?" has
-- exactly one trustworthy answer in this schema and it is
-- booked_by_user_id, stamped from auth.uid() inside book_public_appointment /
-- join_public_queue and revoked at table level for INSERT AND UPDATE by R1A.
--
-- Explicitly NOT used, and why:
--
--   customers.user_id   squattable (R1A D-1) and staff-settable (D-8). An
--                       attacker who plants a victim's phone number must gain
--                       nothing, and with this column as the predicate they
--                       would gain a follow edge in the victim's name.
--   created_by          both self-service RPCs insert NULL there.
--   contact match       a phone number is not an account.
--
-- So an anonymous booking, a kiosk walk-in and a receptionist-typed
-- appointment produce NO follow. That is lossy, and it is correct: the
-- alternative is fabricating a relationship on behalf of someone who never
-- acted. R3 owns event architecture if this ever needs at-least-once delivery.
--
-- The two qualifying events:
--
--   appointment reaches 'confirmed' — Constitution §3.3 permits a confirmed
--     booking to establish a follow, while forbidding it as evidence of a
--     delivered service. Following is intent; the service record is elsewhere.
--
--   queue entry reaches 'completed' with a named barber — a served walk-in
--     is a real interaction with a specific professional. Earlier queue states
--     are not used: 'waiting' only says someone joined a line.
-- ---------------------------------------------------------------------------

create or replace function private.auto_follow_professional(
  p_follower_user_id uuid,
  p_barber_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if p_follower_user_id is null or p_barber_id is null then
    return;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b
  join public.professionals p on p.id = b.professional_id
  where b.id = p_barber_id
    and p.claim_state = 'claimed';

  if v_professional_id is null then
    return;
  end if;

  -- DO NOTHING, and there is deliberately no DO UPDATE branch. This is the
  -- single clause that makes an explicit unfollow permanent, and it is also
  -- what makes a duplicated or retried event harmless.
  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at)
  values (p_follower_user_id, v_professional_id, 'following', 'auto', now())
  on conflict (follower_user_id, professional_id) do nothing;
end;
$$;

comment on function private.auto_follow_professional(uuid, uuid) is
  'Creates a follow edge from a genuine interaction. ON CONFLICT DO NOTHING with no DO UPDATE branch: it can only ever CREATE an edge, so it can never reverse an explicit unfollow and can never double-count a retried event. Silent no-op when attribution is absent — a booking nobody signed in for attributes to nobody.';

revoke execute on function private.auto_follow_professional(uuid, uuid) from public, anon, authenticated;

create or replace function public.appointments_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'confirmed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return null;
  end if;

  perform private.auto_follow_professional(new.booked_by_user_id, new.barber_id);
  return null;
end;
$$;

comment on function public.appointments_auto_follow() is
  'AFTER INSERT OR UPDATE on appointments. Fires once, on entry to confirmed, and only for a booking the account made ITSELF (booked_by_user_id, the only forgery-resistant attribution in this schema). Constitution §3.3: a confirmed booking may establish a follow; it is never evidence a service was delivered.';

drop trigger if exists appointments_auto_follow on public.appointments;
create trigger appointments_auto_follow
  after insert or update of status on public.appointments
  for each row execute function public.appointments_auto_follow();

create or replace function public.queue_entries_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.auto_follow_professional(new.booked_by_user_id, new.barber_id);
  return null;
end;
$$;

comment on function public.queue_entries_auto_follow() is
  'AFTER INSERT OR UPDATE on queue_entries. A SERVED walk-in with a named barber is a real interaction; earlier queue states are not used, because joining a line says nothing about who served you. Same attribution rule as appointments.';

drop trigger if exists queue_entries_auto_follow on public.queue_entries;
create trigger queue_entries_auto_follow
  after insert or update of status on public.queue_entries
  for each row execute function public.queue_entries_auto_follow();


-- ============================================================================
-- END db/migrations/20260826100300_social_graph_follows.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100400_customer_professional_relationships.sql
-- ============================================================================

-- FadeUp — R1B: the relationship aggregate
--
-- FOLLOWER IS NOT VERIFIED CLIENT. Constitution §3.2 makes that a hard
-- invariant, and the way to keep an invariant is to give the two facts
-- different sources of truth rather than different filters over one.
--
--   professional_follows                 intent. "I want to see this person."
--   customer_professional_relationships  fact.   "This person served me."
--
-- Neither derives from the other, and nothing in this file reads the follow
-- graph.
--
-- WHY THIS ONE IS MATERIALIZED WHEN FOLLOWER COUNTS ARE NOT
--
-- A follower count is one indexed count over one table; computing it is
-- cheaper than keeping it correct. "Every customer this professional has
-- served, at this shop, with first and last service time" is a grouped join
-- across two evidence tables, read on profile and CRM surfaces. So it is
-- materialized — and because it is, it must be rebuildable, which is what
-- reconcile_customer_professional_relationships() below is for.
--
-- WHY DUPLICATE DELIVERY CANNOT INFLATE THE COUNTER
--
-- Not because the writer is careful. Because R1A made 'completed' TERMINAL for
-- every caller including service_role — enforce_appointment_transition() raises
-- 22023 on any move out of it. A row can therefore ENTER 'completed' exactly
-- once in its lifetime, and the trigger below fires only on that entry. A
-- retried statement re-raises on the transition guard before it ever reaches
-- this trigger.
--
-- Concurrency is handled by ON CONFLICT DO UPDATE, which takes a row lock: two
-- appointments for the same (customer, professional, org) completing at the
-- same instant serialize on the unique index, and both increments land. There
-- is no read-modify-write anywhere.
--
-- WHY THIS TABLE IS TENANT-SCOPED WHEN THE OTHERS ARE NOT
--
-- professionals and the follow edge are deliberately platform-scoped (argued
-- in 20260826100000). This one is different: "customer X was served by
-- professional Y AT SHOP Z" is a statement about a shop's business, so
-- organization_id is NOT NULL, sits in the unique key, is immutable, and is the
-- RLS anchor. A professional working at two shops produces two rows, and shop A
-- cannot read shop B's.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   No verified-client column. Verified-client is a PREDICATE over this table,
--   never stored — storing it would let the two drift.
--   No public count. TARGET_DOMAIN_MODEL §6.2 withdrew it: restricted to
--   self-booked evidence it measures customer signup behaviour, not craft.
--   No publication consent. Truth is not permission (Constitution §4.1), and
--   the showcase that carries permission is R6/R7's, scoped per organization
--   so it cannot travel with a professional to a new shop.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The aggregate
-- ---------------------------------------------------------------------------

create table if not exists public.customer_professional_relationships (
  id uuid primary key default gen_random_uuid(),

  -- The ACCOUNT. Same rule as the follow edge: never customers.user_id, which
  -- R1A demoted from evidence to bridge.
  -- ON DELETE CASCADE — this is a derived view of a person's activity, and it
  -- is rebuildable from appointments/queue_entries, which survive erasure.
  customer_user_id uuid not null references auth.users (id) on delete cascade,

  -- ON DELETE CASCADE, chosen not inherited: the row is fully rebuildable by
  -- reconciliation, so RESTRICT here would add a second deletion dead-end
  -- (barbers.professional_id already RESTRICTs) to protect data that is not
  -- itself evidence. The evidence is on appointments and queue_entries.
  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- The tenant anchor. CASCADE matches every other tenant-scoped table: when a
  -- shop is deleted its business records go with it.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  completed_interaction_count integer not null default 0
    check (completed_interaction_count >= 0),

  first_completed_at timestamptz not null,
  last_completed_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_professional_relationships_unique
    unique (customer_user_id, professional_id, organization_id),

  constraint customer_professional_relationships_ordered
    check (first_completed_at <= last_completed_at)
);

comment on table public.customer_professional_relationships is
  'Materialized truth about services that ACTUALLY HAPPENED: one row per (customer account, professional, organization). Never derived from and never feeding the follow graph — Constitution §3.2. Rebuildable in full by reconcile_customer_professional_relationships(), which is what makes materialization safe. Verified-client is a predicate over this table and is deliberately not a column.';

comment on column public.customer_professional_relationships.customer_user_id is
  'The account that itself booked or checked in, taken from booked_by_user_id. Never customers.user_id: that column is a per-shop CRM bridge that was squattable before R1A and remains staff-adjacent, so it can never establish a fact about a customer.';

comment on column public.customer_professional_relationships.completed_interaction_count is
  'Completed services with a TRUSTWORTHY completion time. Pre-R1A rows whose completed_at is NULL are excluded rather than counted with an invented timestamp — R1A recorded unknown as unknown and this table does not undo that.';

-- Verified-client count for one professional (private to them and platform).
create index if not exists customer_professional_relationships_professional_idx
  on public.customer_professional_relationships (professional_id);

-- The org read path: "our clients, most recent first".
create index if not exists customer_professional_relationships_org_recent_idx
  on public.customer_professional_relationships (organization_id, last_completed_at desc);

-- The customer's own read path.
create index if not exists customer_professional_relationships_customer_idx
  on public.customer_professional_relationships (customer_user_id);

drop trigger if exists customer_professional_relationships_set_updated_at
  on public.customer_professional_relationships;
create trigger customer_professional_relationships_set_updated_at
  before update on public.customer_professional_relationships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The identity of a relationship is immutable
--
-- There is no client write path at all, so this guards service_role and direct
-- SQL — the same reasoning R1A used for the appointment transition guard. A
-- relationship that could be repointed at a different customer or a different
-- shop would be a forgery primitive for exactly the "already cutting X" claim
-- this table will eventually support.
-- ---------------------------------------------------------------------------

create or replace function public.guard_customer_professional_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id is distinct from old.professional_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'the identity of a relationship is immutable; reconcile instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_customer_professional_relationship() is
  'BEFORE UPDATE invariant: a relationship row can never be repointed at a different customer, professional or organization. No role is exempt. Corrections happen by reconciliation, which recomputes from evidence rather than editing conclusions.';

drop trigger if exists customer_professional_relationships_guard
  on public.customer_professional_relationships;
create trigger customer_professional_relationships_guard
  before update on public.customer_professional_relationships
  for each row execute function public.guard_customer_professional_relationship();

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- SELECT: the customer (their own history), the professional (their own book
--   of clients), members of THAT organization (their own CRM), platform.
--   Note the organization arm is anchored on this row's organization_id, so a
--   professional's shop A cannot see the row they earned at shop B.
--
-- INSERT / UPDATE / DELETE: no policy. Trigger-maintained, exactly like the
--   follow edge.
-- ---------------------------------------------------------------------------

alter table public.customer_professional_relationships enable row level security;
alter table public.customer_professional_relationships force row level security;

revoke all on public.customer_professional_relationships from anon, authenticated;
grant select on public.customer_professional_relationships to authenticated;

drop policy if exists customer_professional_relationships_select
  on public.customer_professional_relationships;
create policy customer_professional_relationships_select
  on public.customer_professional_relationships
  for select
  to authenticated
  using (
    customer_user_id = (select auth.uid())
    or (select private.is_platform_admin())
    -- Through the definer helper, not an inline subquery: professionals.user_id
    -- is withheld from client SELECT, and a policy that reads another table
    -- does so with the CALLER's privileges — so the inline form raises 42501
    -- instead of returning false.
    or (select private.is_own_professional(public.customer_professional_relationships.professional_id))
    or (select private.is_org_member(public.customer_professional_relationships.organization_id))
  );

-- ---------------------------------------------------------------------------
-- 4. Maintenance
-- ---------------------------------------------------------------------------

create or replace function private.record_completed_interaction(
  p_customer_user_id uuid,
  p_barber_id uuid,
  p_organization_id uuid,
  p_completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  -- Every one of these is a refusal to invent evidence, not a defensive
  -- shrug: no account attribution, no professional, or no trustworthy
  -- completion time each mean the fact cannot be stated honestly.
  if p_customer_user_id is null or p_barber_id is null or p_completed_at is null then
    return;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b
  where b.id = p_barber_id;

  if v_professional_id is null then
    return;
  end if;

  insert into public.customer_professional_relationships (
    customer_user_id, professional_id, organization_id,
    completed_interaction_count, first_completed_at, last_completed_at
  )
  values (p_customer_user_id, v_professional_id, p_organization_id, 1, p_completed_at, p_completed_at)
  on conflict (customer_user_id, professional_id, organization_id) do update
    set completed_interaction_count =
          public.customer_professional_relationships.completed_interaction_count + 1,
        first_completed_at =
          least(public.customer_professional_relationships.first_completed_at, excluded.first_completed_at),
        last_completed_at =
          greatest(public.customer_professional_relationships.last_completed_at, excluded.last_completed_at);
end;
$$;

comment on function private.record_completed_interaction(uuid, uuid, uuid, timestamptz) is
  'Concurrency-safe increment via ON CONFLICT DO UPDATE — a row lock, never a read-modify-write. least()/greatest() mean out-of-order arrival cannot corrupt the window. Silently declines to record when attribution, professional or completion time is missing, because the alternative is asserting a service happened on evidence that does not say so.';

revoke execute on function private.record_completed_interaction(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.appointments_record_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Entry into 'completed' only, and R1A makes that state terminal, so this
  -- fires at most once in a row's lifetime.
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.record_completed_interaction(
    new.booked_by_user_id, new.barber_id, new.organization_id, new.completed_at
  );
  return null;
end;
$$;

comment on function public.appointments_record_relationship() is
  'AFTER INSERT OR UPDATE on appointments. Records a completed service exactly once, using completed_at — which R1A made server-stamped and unforgeable — and booked_by_user_id, the only account attribution a shop cannot fabricate.';

drop trigger if exists appointments_record_relationship on public.appointments;
create trigger appointments_record_relationship
  after insert or update of status on public.appointments
  for each row execute function public.appointments_record_relationship();

create or replace function public.queue_entries_record_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.record_completed_interaction(
    new.booked_by_user_id, new.barber_id, new.organization_id, new.completed_at
  );
  return null;
end;
$$;

comment on function public.queue_entries_record_relationship() is
  'AFTER INSERT OR UPDATE on queue_entries. A served walk-in is a completed service (Constitution §3.3). queue_entries.completed_at is server-stamped by the R1A queue guard, so the browser can no longer choose it.';

drop trigger if exists queue_entries_record_relationship on public.queue_entries;
create trigger queue_entries_record_relationship
  after insert or update of status on public.queue_entries
  for each row execute function public.queue_entries_record_relationship();

-- ---------------------------------------------------------------------------
-- 5. Reconciliation
--
-- The counters are materialized, so there must be a way to prove them right
-- and to repair them. This recomputes from the evidence tables and replaces
-- the aggregate — recomputation rather than restore, which is why
-- MIGRATION_STRATEGY §9 can say R1B contains no irreversible transformation.
--
-- One statement, three data-modifying CTEs. They share a snapshot and their
-- targets are disjoint by construction: `removed` only touches rows the
-- evidence does NOT support, `written` only touches rows it does. Scope is
-- applied identically to both, so a per-professional run cannot reach anyone
-- else's aggregate.
--
-- Platform staff only: this is administrative repair, not a product feature.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_customer_professional_relationships(
  p_professional_id uuid default null
)
returns table (rows_written bigint, rows_removed bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can reconcile relationships'
      using errcode = '42501';
  end if;

  return query
  with evidence as (
    select a.booked_by_user_id as customer_user_id, b.professional_id,
           a.organization_id, a.completed_at
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id is not null
      and a.completed_at is not null
      and b.professional_id is not null

    union all

    select q.booked_by_user_id, b.professional_id, q.organization_id, q.completed_at
    from public.queue_entries q
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id is not null
      and q.completed_at is not null
      and b.professional_id is not null
  ),
  truth as (
    select e.customer_user_id, e.professional_id, e.organization_id,
           count(*)::integer as completed_interaction_count,
           min(e.completed_at) as first_completed_at,
           max(e.completed_at) as last_completed_at
    from evidence e
    where p_professional_id is null or e.professional_id = p_professional_id
    group by e.customer_user_id, e.professional_id, e.organization_id
  ),
  removed as (
    -- The WHERE stays on this line deliberately: the MASTER generator refuses
    -- any `delete from` whose line carries no WHERE, and that guard is worth
    -- more than the formatting.
    delete from public.customer_professional_relationships r where true
      and (p_professional_id is null or r.professional_id = p_professional_id)
      and not exists (
        select 1 from truth t
        where t.customer_user_id = r.customer_user_id
          and t.professional_id = r.professional_id
          and t.organization_id = r.organization_id
      )
    returning 1
  ),
  written as (
    insert into public.customer_professional_relationships (
      customer_user_id, professional_id, organization_id,
      completed_interaction_count, first_completed_at, last_completed_at
    )
    select t.customer_user_id, t.professional_id, t.organization_id,
           t.completed_interaction_count, t.first_completed_at, t.last_completed_at
    from truth t
    on conflict (customer_user_id, professional_id, organization_id) do update
      set completed_interaction_count = excluded.completed_interaction_count,
          first_completed_at = excluded.first_completed_at,
          last_completed_at = excluded.last_completed_at
    returning 1
  )
  select (select count(*) from written), (select count(*) from removed);
end;
$$;

comment on function public.reconcile_customer_professional_relationships(uuid) is
  'Platform-only. Recomputes the relationship aggregate from appointments and queue_entries and replaces it, so a materialized counter can always be proven against its evidence. Excludes completed rows with NULL completed_at: R1A left those genuinely unknown and reconciliation does not invent them.';

revoke execute on function public.reconcile_customer_professional_relationships(uuid) from public, anon;
grant execute on function public.reconcile_customer_professional_relationships(uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260826100400_customer_professional_relationships.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100500_fade_passport_identity.sql
-- ============================================================================

-- FadeUp — R1B: the Fade Passport becomes automatic and durable
--
-- Constitution §2.2 is unambiguous:
--
--   "Every registered customer owns exactly one Fade Passport, and it exists
--    automatically. It is not something a customer creates, opts into, or can
--    be missing."
--
-- Today it is exactly the opposite: a passport row appears only when the
-- customer fills in the Passport screen, which makes it a feature with a
-- "Get Passport" call to action rather than part of who they are.
--
-- WHAT IS ALREADY RIGHT AND MUST NOT BE REBUILT
--
-- customer_passports.user_id is already UNIQUE with an FK to auth.users, so
-- one-per-account is ALREADY a database guarantee. Photos and revocable hashed
-- share links already hang off it, with a working UI. Creating a new
-- fade_passports table would duplicate a live entity and orphan all of that.
-- Two columns and an issuance path are the entire gap.
--
-- WHO COUNTS AS A "REGISTERED CUSTOMER"
--
-- customer_profiles, not auth.users — this codebase's own definition. An
-- account that never touched the customer app deliberately has no
-- customer_profiles row (see that table's comment), and a professional's or
-- platform admin's login is not a customer. Issuing them a Passport would make
-- the number meaningless.
--
-- THE NUMBER IS AN IDENTIFIER, NOT AN AUTHENTICATOR
--
-- 80 bits from gen_random_bytes, non-sequential, so it leaks no ordering and
-- cannot be enumerated. It is NOT a credential: the credential is the
-- revocable, expiring, sha256-at-rest token in customer_passport_shares, and
-- lookup-by-number must never become an alternative to it. Nothing in this
-- migration adds a lookup-by-number path, and nothing later should without
-- revisiting that sentence.
--
-- IDEMPOTENCY IS STRUCTURAL, NOT PROCEDURAL
--
-- Issuance is `insert ... on conflict (user_id) do nothing` — never
-- select-then-insert. Concurrency and retry then yield exactly one row by
-- construction rather than by luck. The number is generated inside a BEFORE
-- INSERT trigger with a bounded retry on the unique index, so a collision (at
-- 80 bits, effectively never) is handled rather than raised.
--
-- R1A GUARANTEES PRESERVED
--
-- R1A removed the DELETE policy and revoked DELETE on this table. Nothing here
-- restores either. R1A also established that customer_passports.user_id must
-- remain UPDATE-grantable, because apps/web/src/lib/queries/passport.ts saves
-- with .upsert({ user_id, ... }, { onConflict: 'user_id' }) and
-- ON CONFLICT DO UPDATE needs UPDATE on every column in its SET list. The
-- grants below withhold the two NEW columns and leave user_id alone.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The columns
--
-- NOT NULL is deliberately deferred to the backfill migration
-- (20260826100600): a column cannot be NOT NULL in the statement that adds it
-- to a table with rows.
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

comment on column public.customer_passports.passport_number is
  'The Passport''s durable public identifier: 80 bits of gen_random_bytes, non-sequential, unique, server-generated. An IDENTIFIER, never an authenticator — the credential is the revocable hashed token in customer_passport_shares, and lookup-by-number must never become an alternative to it. Never client-supplied and never reassignable: the stamping trigger overwrites any caller value and the freeze guard rejects any later change.';

comment on column public.customer_passports.issued_at is
  'When this Passport was issued. Server-stamped once and frozen. Distinct from created_at only for rows that predate R1B, where it records the backfill rather than pretending to know when the customer first had a Passport.';

-- Uniqueness is enforced by the database, not by the generator being careful.
create unique index if not exists customer_passports_passport_number_unique
  on public.customer_passports (passport_number) where passport_number is not null;

-- ---------------------------------------------------------------------------
-- 2. Number generation
--
-- Grouped hex, because a human reads this aloud to a barber. 20 hex digits =
-- 80 bits. The FP- prefix makes a Passport number recognisable in a support
-- ticket without being confusable with any other identifier in this schema.
-- ---------------------------------------------------------------------------

create or replace function private.generate_passport_number()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_hex text;
begin
  v_hex := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  return 'FP-' || substr(v_hex, 1, 4) || '-' || substr(v_hex, 5, 4) || '-'
              || substr(v_hex, 9, 4) || '-' || substr(v_hex, 13, 4) || '-'
              || substr(v_hex, 17, 4);
end;
$$;

comment on function private.generate_passport_number() is
  '80 bits of CSPRNG, formatted FP-XXXX-XXXX-XXXX-XXXX-XXXX. Non-sequential on purpose: a sequential number would let anyone estimate how many customers FadeUp has and would make neighbouring Passports guessable.';

revoke execute on function private.generate_passport_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The number is server-owned
--
-- BEFORE INSERT: overwrite whatever the caller sent. The column grants below
-- already stop `authenticated` sending one, but this makes the guarantee hold
-- for service_role and direct SQL as well — the same defence-in-depth pattern
-- R1A used for completed_at.
--
-- The retry loop exists for the unique index, not for the entropy. At 80 bits
-- a collision is not a real event; handling it here is what stops a
-- theoretical one from surfacing as a failed customer signup.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, and both halves of that matter. As the invoker this
-- trigger could not execute private.generate_passport_number (revoked from
-- authenticated), so an ordinary client INSERT would fail with 42501; and its
-- collision check would run under RLS, seeing only the caller's own row and
-- therefore checking nothing. Owned by postgres it can do both properly.
create or replace function public.stamp_passport_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate text;
  v_attempt integer := 0;
begin
  new.issued_at := coalesce(new.issued_at, now());

  loop
    v_attempt := v_attempt + 1;
    v_candidate := private.generate_passport_number();
    exit when not exists (
      select 1 from public.customer_passports where passport_number = v_candidate
    );
    if v_attempt >= 5 then
      raise exception 'could not allocate a unique Passport number after % attempts', v_attempt
        using errcode = 'P0001';
    end if;
  end loop;

  new.passport_number := v_candidate;
  return new;
end;
$$;

comment on function public.stamp_passport_identity() is
  'BEFORE INSERT on customer_passports. Always overwrites passport_number and issued_at with server-generated values, so no caller — client, service_role or direct SQL — can choose their own Passport number. The unique index remains the actual authority; this loop only stops a collision surfacing as a failed signup.';

drop trigger if exists customer_passports_stamp_identity on public.customer_passports;
create trigger customer_passports_stamp_identity
  before insert on public.customer_passports
  for each row execute function public.stamp_passport_identity();

-- ---------------------------------------------------------------------------
-- 4. And it is frozen
--
-- A reassignable Passport number is not an identity. The freeze must survive
-- the PostgREST upsert path, which issues ON CONFLICT DO UPDATE and therefore
-- an UPDATE on every column in its SET list — so "is distinct from" is the
-- right test, not "was mentioned".
-- ---------------------------------------------------------------------------

create or replace function public.guard_passport_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The guard is on CHANGING a number, not on first issuing one. A row that
  -- predates R1B has passport_number NULL until the backfill in
  -- 20260826100600 fills it, and that NULL -> value write must be allowed or
  -- the migration deadlocks against its own invariant.
  --
  -- The allowance closes itself: the same MASTER transaction ends with
  -- passport_number NOT NULL, so from that moment `old.passport_number is
  -- null` is unreachable and this is an unconditional freeze. It is not a
  -- standing exemption, and it needs no GUC bypass to carve out.
  if old.passport_number is not null
     and new.passport_number is distinct from old.passport_number then
    raise exception 'a Fade Passport number is permanent and cannot be reassigned'
      using errcode = '42501';
  end if;
  if old.issued_at is not null and new.issued_at is distinct from old.issued_at then
    raise exception 'customer_passports.issued_at is server-owned'
      using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'a Fade Passport cannot be moved to another account'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_passport_identity() is
  'BEFORE UPDATE invariant on customer_passports. Freezes passport_number, issued_at and user_id against every caller. user_id is included because R1A had to leave it UPDATE-grantable for the PostgREST upsert''s ON CONFLICT SET list — the grant cannot distinguish "same value, resent by upsert" from "repointed at someone else", and this trigger can.';

drop trigger if exists customer_passports_guard_identity on public.customer_passports;
create trigger customer_passports_guard_identity
  before update on public.customer_passports
  for each row execute function public.guard_passport_identity();

-- ---------------------------------------------------------------------------
-- 5. Column privileges
--
-- Table-level revoke then selective re-grant — the only mechanism that
-- actually restricts a column, as R1A established. SELECT keeps every column:
-- the number is the customer's own identity and they must be able to read it.
--
-- user_id STAYS UPDATE-grantable. This is not an oversight; it is a documented
-- R1A finding. Removing it silently breaks the Passport save in the live app.
-- ---------------------------------------------------------------------------

revoke insert, update on public.customer_passports from authenticated, anon;

grant insert (id, user_id, usual_haircut, fade_type, side_length, top_length,
              beard_preferences, preferences_notes, created_at, updated_at)
  on public.customer_passports to authenticated;

grant update (user_id, usual_haircut, fade_type, side_length, top_length,
              beard_preferences, preferences_notes, created_at, updated_at)
  on public.customer_passports to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Automatic issuance
--
-- ensure_customer_passport is the single issuance path: idempotent by
-- construction, safe to call from a trigger, from the backfill, and from a
-- retry after a caller-side failure.
-- ---------------------------------------------------------------------------

create or replace function private.ensure_customer_passport(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  -- ON CONFLICT, never select-then-insert. Two concurrent callers both
  -- succeed and exactly one row exists afterwards; the unique index decides,
  -- not the ordering.
  insert into public.customer_passports (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

comment on function private.ensure_customer_passport(uuid) is
  'The one issuance path. Idempotent and race-safe by construction: ON CONFLICT (user_id) DO NOTHING against the unique index that has protected one-passport-per-account since the Passport shipped. Retrying after any partial failure is always safe.';

revoke execute on function private.ensure_customer_passport(uuid) from public, anon, authenticated;

create or replace function public.customer_profiles_issue_passport()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_customer_passport(new.user_id);
  return null;
end;
$$;

comment on function public.customer_profiles_issue_passport() is
  'AFTER INSERT on customer_profiles. Becoming a FadeUp customer IS having a Fade Passport (Constitution §2.2) — there is no "Get Passport" action to take, and no state in which a registered customer is missing one.';

drop trigger if exists customer_profiles_issue_passport on public.customer_profiles;
create trigger customer_profiles_issue_passport
  after insert on public.customer_profiles
  for each row execute function public.customer_profiles_issue_passport();


-- ============================================================================
-- END db/migrations/20260826100500_fade_passport_identity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100600_fade_passport_backfill.sql
-- ============================================================================

-- FadeUp — R1B: every existing customer already has a Passport
--
-- Constitution §2.2 says a Passport cannot be missing. Before this migration
-- most are, because a passport row only ever appeared when a customer opened
-- the Passport screen and saved something.
--
-- Two populations, in order:
--
--   1. customers with a customer_profiles row and NO passport   -> issue one
--   2. passports that exist but predate passport_number         -> number them
--
-- Both are set-based and idempotent. Re-running does nothing, because both are
-- predicated on the absence they fix.
--
-- issued_at for a backfilled passport is now(), NOT created_at. That is the
-- honest value: the NUMBER was issued today. Backdating it to when the
-- customer first saved a haircut preference would claim FadeUp had issued an
-- identifier it had not yet invented. created_at still records when the
-- passport content first existed, so nothing is lost.
--
-- After both steps the columns become NOT NULL. That is safe because the
-- BEFORE INSERT trigger from 20260826100500 stamps both on every future row,
-- and it converts "a passport without a number" from a state that must be
-- checked for into one the database refuses to represent.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Issue the missing Passports
--
-- Anchored on customer_profiles, this codebase's own definition of a
-- registered customer. Accounts that never touched the customer app — including
-- every professional and platform admin login — deliberately get nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_issued integer;
begin
  insert into public.customer_passports (user_id)
  select cp.user_id
  from public.customer_profiles cp
  where not exists (
    select 1 from public.customer_passports p where p.user_id = cp.user_id
  )
  on conflict (user_id) do nothing;

  get diagnostics v_issued = row_count;
  raise notice 'R1B Passport backfill: % Passports issued to existing customers', v_issued;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Number the Passports that already existed
--
-- The BEFORE INSERT trigger cannot help these — they were inserted before it
-- existed. A loop, because each row needs its own draw from the CSPRNG and its
-- own uniqueness check; a set-based update would need a correlated random per
-- row anyway. Deterministic ordering so a partial run resumes predictably.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_candidate text;
  v_attempt integer;
  v_numbered integer := 0;
begin
  for r in
    select id from public.customer_passports
    where passport_number is null
    order by created_at, id
  loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_candidate := private.generate_passport_number();
      exit when not exists (
        select 1 from public.customer_passports where passport_number = v_candidate
      );
      if v_attempt >= 5 then
        raise exception 'could not allocate a unique Passport number after % attempts', v_attempt
          using errcode = 'P0001';
      end if;
    end loop;

    -- guard_passport_identity permits exactly this write and no other: it
    -- fires only when old.passport_number IS NOT NULL, so first issuance is
    -- allowed and every later change is refused. Step 3 below then makes the
    -- column NOT NULL, which closes the allowance permanently — from that
    -- point the guard is unconditional.
    update public.customer_passports
    set passport_number = v_candidate,
        issued_at = coalesce(issued_at, now())
    where id = r.id;

    v_numbered := v_numbered + 1;
  end loop;

  raise notice 'R1B Passport backfill: % pre-existing Passports given a durable number', v_numbered;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Assert, then tighten
--
-- The assertions come first so a failure names the actual problem rather than
-- surfacing as an opaque NOT NULL violation.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing integer;
  v_unnumbered integer;
  v_dupes integer;
begin
  select count(*) into v_missing
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);
  if v_missing > 0 then
    raise exception 'R1B Passport backfill incomplete: % registered customers still have no Passport', v_missing
      using errcode = 'P0001';
  end if;

  select count(*) into v_unnumbered from public.customer_passports where passport_number is null;
  if v_unnumbered > 0 then
    raise exception 'R1B Passport backfill incomplete: % Passports still have no number', v_unnumbered
      using errcode = 'P0001';
  end if;

  select count(*) into v_dupes from (
    select passport_number from public.customer_passports
    group by passport_number having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'R1B Passport backfill produced % duplicate numbers', v_dupes
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports'
      and column_name = 'passport_number' and is_nullable = 'YES'
  ) then
    alter table public.customer_passports alter column passport_number set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports'
      and column_name = 'issued_at' and is_nullable = 'YES'
  ) then
    alter table public.customer_passports alter column issued_at set not null;
  end if;
end $$;

-- With the column NOT NULL the partial predicate on the unique index is dead
-- weight, but replacing an index is a lock this migration has no reason to
-- take. It stays as-is and still enforces uniqueness over every row.


-- ============================================================================
-- END db/migrations/20260826100600_fade_passport_backfill.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100700_acquisition_professional_linkage.sql
-- ============================================================================

-- FadeUp — R1B: acquisition can mint an external identity, one way only
--
-- THE LINK POINTS FROM ACQUISITION TO IDENTITY, NEVER THE REVERSE
--
-- The obvious design is professionals.prospect_id. It is wrong, and the reason
-- is a privilege argument rather than an aesthetic one:
--
--   * professionals is TENANT-READABLE. Shops read it to resolve their own
--     roster, and the public projections read it for anonymous visitors.
--   * prospects is FadeUp's own sales data — 51 structurally disjoint tables
--     with no organization_id, gated to platform staff and prospect_worker.
--
-- A FK from the platform-only side into the tenant-readable side leaks
-- nothing. The reverse leaks the moment a column grant is forgotten, and it
-- would put "FadeUp scraped this shop and scored it as a lead" one join away
-- from a barber's own profile page. So the FK lives here.
--
-- ONE IDENTITY PER CANONICAL PROSPECT, NOT PER OBSERVATION
--
-- Constitution §5.1: never one scraper result = one professional. The Worker
-- pipeline already converges observations onto a canonical prospect through
-- prospect_source_records and prospect_identity_matches, and R1B adds nothing
-- to that machinery. The new rule is only at the PUBLICATION boundary:
-- unique (prospect_id) means a re-run of a publication job cannot mint a
-- second identity for the same real shop.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT BUILD
--
--   No fuzzy matching, no auto-merge, no scoring. Constitution §5.3: a false
--   merge of two real shops is worse than a temporarily unresolved duplicate.
--   If two prospects turn out to be one person, that is R17's merge path, and
--   until it exists the correct outcome is two candidate identities.
--
--   No write path from prospect data onto a CLAIMED identity. Constitution
--   §5.4 says claimed data outranks scraped data; the way to guarantee that is
--   for the conflict to be impossible, so there is no trigger, no sync job and
--   no ON CONFLICT DO UPDATE that could ever overwrite a professional's own
--   fields with a scrape.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The link
-- ---------------------------------------------------------------------------

create table if not exists public.prospect_professionals (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: the link is a statement ABOUT a prospect. Deleting the
  -- prospect removes the statement, not the identity — that is the asymmetry
  -- the next FK encodes.
  prospect_id uuid not null references public.prospects (id) on delete cascade,

  -- ON DELETE RESTRICT: provenance is evidence. An identity that acquisition
  -- created, and that may since have been claimed by a real person, must not
  -- be removable while the record of where it came from still stands.
  professional_id uuid not null references public.professionals (id) on delete restrict,

  match_confidence numeric(4, 3) check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),
  matching_rule text,

  created_at timestamptz not null default now(),

  -- Idempotent minting: one external identity per canonical prospect.
  constraint prospect_professionals_prospect_unique unique (prospect_id),
  -- And an identity traces back to at most one prospect, so provenance stays
  -- reconcilable in both directions.
  constraint prospect_professionals_professional_unique unique (professional_id)
);

comment on table public.prospect_professionals is
  'Acquisition-side link from a canonical prospect to the durable professional identity minted for it. The FK deliberately lives HERE and not on professionals: that table is tenant-readable and publicly projected, and a reverse FK would put acquisition metadata one join from a barber''s own profile. Unique on both sides, so publication is idempotent per prospect and provenance stays reconcilable.';

comment on column public.prospect_professionals.match_confidence is
  'Evidence quality from the Worker pipeline, recorded not acted upon. R1B performs no automatic merging on this value — Constitution §5.3 prefers an unresolved duplicate to a false merge of two real businesses.';

create index if not exists prospect_professionals_professional_idx
  on public.prospect_professionals (professional_id);

-- ---------------------------------------------------------------------------
-- 2. RLS — platform and worker only
--
-- `authenticated` gets NOTHING here, not even SELECT. This is the table that
-- would answer "was I scraped, and how confident was FadeUp", and no ordinary
-- account has any business asking. R1A's worker least-privilege guarantees are
-- extended, not relaxed: prospect_worker gets SELECT so it can tell whether a
-- prospect has already been published, and nothing else — minting goes through
-- the definer RPC below.
-- ---------------------------------------------------------------------------

alter table public.prospect_professionals enable row level security;
alter table public.prospect_professionals force row level security;

revoke all on public.prospect_professionals from anon, authenticated;
grant select on public.prospect_professionals to prospect_worker;

drop policy if exists prospect_professionals_select_platform on public.prospect_professionals;
create policy prospect_professionals_select_platform
  on public.prospect_professionals
  for select
  to authenticated
  using ((select private.has_platform_role(
    array['platform_owner', 'platform_admin', 'platform_support']::public.platform_role[]
  )));

drop policy if exists prospect_professionals_select_worker on public.prospect_professionals;
create policy prospect_professionals_select_worker
  on public.prospect_professionals
  for select
  to prospect_worker
  using (true);

-- No INSERT, UPDATE or DELETE policy for anyone. create_external_professional
-- is the only writer.

-- ---------------------------------------------------------------------------
-- 3. Minting an external identity
--
-- SAFE DEFAULTS ARE STRUCTURAL HERE, NOT CONFIGURED
--
--   claim_state = 'unclaimed'  -> the publication CHECK on professionals makes
--                                 is_public true IMPOSSIBLE for this row until
--                                 R10 removes that clause deliberately.
--   no barbers row             -> and therefore no location, no working hours,
--                                 no services, no availability, no queue, no
--                                 appointments. Constitution §5.5 is satisfied
--                                 by the absence of the modelling.
--   display_name from the      -> the caller does not get to supply a name.
--   prospect, server-side         The identity says exactly what acquisition
--                                 actually observed, nothing more.
--
-- The caller passes a prospect id and nothing else. There is no parameter that
-- could carry an invented availability, wait time, rating or client count,
-- because there is no column for one.
-- ---------------------------------------------------------------------------

create or replace function public.create_external_professional(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_name text;
  v_professional_id uuid;
begin
  -- TWO conditions for the worker arm, and both are load-bearing.
  --
  -- session_user, NOT current_user: inside a SECURITY DEFINER function
  -- current_user is the function OWNER (postgres), so testing it would let
  -- every caller through. session_user is the role that actually connected —
  -- 'prospect_worker' for the worker's own connection, 'authenticator' for
  -- anything arriving through PostgREST, which R1A confirmed is not a member
  -- of prospect_worker so no JWT can reach it.
  --
  -- auth.uid() IS NULL because the worker holds no JWT. Without this clause a
  -- superuser session that has merely SET ROLE to authenticated would satisfy
  -- pg_has_role(session_user, 'prospect_worker', ...) — superusers are
  -- implicitly members of every role — and an equality test alone would leave
  -- the check unverifiable from any test harness. Requiring the absence of a
  -- session as well makes it both stricter and testable.
  if not (
    (select private.is_platform_admin())
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform staff or the acquisition worker can create external profiles'
      using errcode = '42501';
  end if;

  -- Idempotent per prospect. Checked first AND enforced by the unique
  -- constraint below, because a concurrent second job must lose on the index
  -- rather than on this read.
  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    return v_existing;
  end if;

  select p.canonical_name into v_name
  from public.prospects p
  where p.id = p_prospect_id;

  if v_name is null then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  insert into public.professionals (claim_state, display_name, source, is_public)
  values ('unclaimed', v_name, 'acquisition', false)
  returning id into v_professional_id;

  begin
    insert into public.prospect_professionals (prospect_id, professional_id)
    values (p_prospect_id, v_professional_id);
  exception when unique_violation then
    -- A concurrent job won. Fail the whole statement rather than return a
    -- second identity for the same real business: the caller retries into the
    -- idempotent branch above and receives the winner's identity.
    raise exception 'external profile for this prospect is already being created; retry'
      using errcode = '40001';
  end;

  return v_professional_id;
end;
$$;

comment on function public.create_external_professional(uuid) is
  'Platform-staff or acquisition-worker only. Mints ONE unclaimed professional identity per canonical prospect, idempotently, with structurally safe defaults: unclaimed (so the publication CHECK forbids is_public), no barbers row (so no availability, queue, schedule or appointment can be implied), and a display name copied from the prospect rather than supplied by the caller. Serialises against a concurrent second job on the unique index, returning 40001 so the caller retries into the idempotent branch.';

revoke execute on function public.create_external_professional(uuid) from public, anon;
grant execute on function public.create_external_professional(uuid) to authenticated, prospect_worker;

-- ---------------------------------------------------------------------------
-- 4. The reverse conversion link
--
-- prospects.converted_organization_id has existed since the acquisition schema
-- shipped, and private.cancel_outreach_on_conversion already reads it to stop
-- prospecting a business that has become a customer. Nothing has ever WRITTEN
-- it. This is the first writer.
--
-- It stays on the acquisition side, so there is exactly one acquisition truth
-- rather than a second disconnected one, and platform staff can reconcile
-- professional -> prospect -> organization in either direction.
--
-- Never overwrites a non-null value: a prospect converts once, and a second
-- claim must not silently repoint a conversion that sales has already acted
-- on.
-- ---------------------------------------------------------------------------

create or replace function private.record_prospect_conversion(
  p_professional_id uuid,
  p_organization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id uuid;
begin
  if p_professional_id is null or p_organization_id is null then
    return false;
  end if;

  select pp.prospect_id into v_prospect_id
  from public.prospect_professionals pp
  where pp.professional_id = p_professional_id;

  if v_prospect_id is null then
    return false;
  end if;

  update public.prospects
  set converted_organization_id = p_organization_id
  where id = v_prospect_id
    and converted_organization_id is null;

  return found;
end;
$$;

comment on function private.record_prospect_conversion(uuid, uuid) is
  'Closes the acquisition loop when a professional claims an identity that acquisition created: sets prospects.converted_organization_id, which private.cancel_outreach_on_conversion already watches to stop prospecting a business that has become a customer. Never overwrites an existing conversion — a prospect converts once. Returns false, not an error, when the identity has no acquisition provenance; most claims will not.';

revoke execute on function private.record_prospect_conversion(uuid, uuid) from public, anon, authenticated;


-- ============================================================================
-- END db/migrations/20260826100700_acquisition_professional_linkage.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100800_professional_claims.sql
-- ============================================================================

-- FadeUp — R1B: the claim lifecycle
--
-- Nothing in this codebase adopts an existing professional IDENTITY today.
-- professional_applications creates a brand-new empty tenant; invitations join
-- an existing organization. Neither says "that profile out there is me".
--
-- THE STATE MACHINE, COMPLETE
--
--                   submit_professional_claim
--                            |
--                            v
--                        [ pending ] --- withdraw ---> [ withdrawn ]
--                        /        \
--                 approve          reject
--                      /              \
--                     v                v
--              [ approved ]        [ rejected ]
--
-- All three leaves are TERMINAL. There is no edge out of them, enforced by a
-- BEFORE UPDATE trigger with no role exemption, so a rejected claim can never
-- be quietly revived into an approval.
--
-- The corresponding identity transition is the only one in the system:
--
--   professionals: unclaimed --(approved claim)--> claimed
--
-- and the reverse edge exists only for account erasure (20260826100000 §4),
-- which detaches rather than transfers. There is NO path that moves a claimed
-- identity from one account to another. Taking over a claimed profile is not
-- a slow operation in this design; it is an unrepresentable one.
--
-- CONTRADICTORY STATES ARE UNREPRESENTABLE, NOT MERELY UNLIKELY
--
--   professionals   check ((claim_state='claimed') = (user_id is not null))
--                   check ((claim_state='claimed') = (claimed_at is not null))
--   claims          check ((state='pending')       = (decided_at is null))
--                   check (state<>'approved' or decided_by is not null)
--
-- So claimed_at != null while claim_state='unclaimed' cannot be stored, and an
-- approved claim always names the human who approved it.
--
-- CONCURRENCY: EXACTLY ONE WINNER
--
-- Two reviewers approving two different claims for the same identity at the
-- same instant is the dangerous race, and it is closed twice over:
--
--   1. the professional row is taken FOR UPDATE before anything is decided, so
--      the second transaction blocks and then re-reads a row that is already
--      claimed and refuses;
--   2. professional_claims_one_approval, a UNIQUE index on (professional_id)
--      WHERE state='approved', so even if (1) were somehow bypassed the second
--      write fails on 23505.
--
-- Locks, not application ordering. The index, not the lock, is the guarantee.
--
-- WHAT IS DELIBERATELY NOT BUILT
--
-- No verification engine. R17 owns outreach and proof-of-possession. A claim
-- therefore RESTS in `pending` until a human decides, which is honest: the
-- alternative is shipping weak self-service verification that would let
-- someone assert they are a professional whose profile they merely found.
--
-- No internal reviewer note. R1A had to close exactly that hole on
-- professional_applications.internal_note, where a row-level policy plus a
-- table-wide SELECT grant handed the applicant the reviewer's private
-- assessment. The way to not have that bug is to not have the column:
-- decision_note is written FOR the claimant and is meant to be read by them.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'professional_claim_status') then
    create type public.professional_claim_status as enum
      ('pending', 'approved', 'rejected', 'withdrawn');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The claim
-- ---------------------------------------------------------------------------

create table if not exists public.professional_claims (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: a claim on an identity that no longer exists is not a
  -- record of anything. Unreachable in practice — professionals has no DELETE
  -- policy and no DELETE grant, and prospect_professionals RESTRICTs on top.
  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- ON DELETE CASCADE: the claim is the claimant's own submission and their
  -- personal data. Erasing the account withdraws it, which is also what makes
  -- the identity re-claimable afterwards — consistent with the detach in
  -- 20260826100000, where erasure returns the identity to unclaimed.
  claimant_user_id uuid not null references auth.users (id) on delete cascade,

  state public.professional_claim_status not null default 'pending',

  -- The claimant's own account of why this identity is theirs. Free text on
  -- purpose: R1B builds the lifecycle, not the verification engine.
  evidence text,

  submitted_at timestamptz not null default now(),
  decided_at timestamptz,

  -- ON DELETE SET NULL: erasing a reviewer's account must not erase the fact
  -- that a decision was taken. Constitution §4.4 — verification is auditable.
  decided_by uuid references auth.users (id) on delete set null,

  -- Written FOR the claimant. There is deliberately no second, hidden note.
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_claims_pending_undecided
    check ((state = 'pending') = (decided_at is null)),

  constraint professional_claims_approval_has_reviewer
    check (state <> 'approved' or decided_by is not null),

  constraint professional_claims_evidence_length
    check (evidence is null or char_length(evidence) <= 2000),

  constraint professional_claims_note_length
    check (decision_note is null or char_length(decision_note) <= 2000)
);

comment on table public.professional_claims is
  'The lifecycle by which a real person takes control of an existing professional identity — typically one acquisition created before they joined. pending -> approved | rejected | withdrawn, all terminal. Claim state is NEVER subscription state (Constitution §5.6): approving a claim grants control, not capabilities and not a plan.';

comment on column public.professional_claims.evidence is
  'The claimant''s own account of why this identity is theirs. R1B stores it and stops there — verifying it is R17''s outreach work, and shipping weak self-service verification would be worse than an honest pending queue.';

comment on column public.professional_claims.decision_note is
  'Written for the CLAIMANT to read. There is no separate internal note by design: R1A had to close exactly that leak on professional_applications.internal_note, and a column that does not exist cannot be over-granted.';

-- One owner, ever. This is the constraint the whole race analysis rests on.
create unique index if not exists professional_claims_one_approval
  on public.professional_claims (professional_id) where state = 'approved';

-- No spam: one live claim per (identity, claimant). A second submission
-- returns the first rather than queueing another.
create unique index if not exists professional_claims_one_pending
  on public.professional_claims (professional_id, claimant_user_id) where state = 'pending';

-- The review queue, oldest first.
create index if not exists professional_claims_queue
  on public.professional_claims (submitted_at) where state = 'pending';

create index if not exists professional_claims_claimant_idx
  on public.professional_claims (claimant_user_id);

drop trigger if exists professional_claims_set_updated_at on public.professional_claims;
create trigger professional_claims_set_updated_at
  before update on public.professional_claims
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Transitions are enforced, for everyone
-- ---------------------------------------------------------------------------

create or replace function public.enforce_professional_claim_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.professional_id is distinct from old.professional_id
     or new.claimant_user_id is distinct from old.claimant_user_id then
    raise exception 'a claim cannot be repointed at a different identity or claimant'
      using errcode = '42501';
  end if;

  if new.state is not distinct from old.state then
    return new;
  end if;

  if old.state <> 'pending' then
    raise exception 'claim is already % and cannot change state', old.state
      using errcode = '22023';
  end if;

  if new.state not in ('approved', 'rejected', 'withdrawn') then
    raise exception 'illegal claim transition % -> %', old.state, new.state
      using errcode = '22023';
  end if;

  -- Decision time is server-owned, so a caller cannot backdate a review.
  new.decided_at := coalesce(new.decided_at, now());
  return new;
end;
$$;

comment on function public.enforce_professional_claim_transition() is
  'BEFORE UPDATE invariant on professional_claims. pending is the only state with outgoing edges, and no role is exempt — including service_role, matching how R1A guards appointment transitions. Also freezes the claim''s identity and stamps decided_at server-side.';

drop trigger if exists professional_claims_enforce_transition on public.professional_claims;
create trigger professional_claims_enforce_transition
  before update on public.professional_claims
  for each row execute function public.enforce_professional_claim_transition();

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- SELECT: own claims, and platform staff. A claimant must not be able to
--   enumerate who else is claiming the same identity — that is both a privacy
--   leak and a social-engineering aid.
--
-- INSERT / UPDATE / DELETE: no policy. The three RPCs below are the only
--   writers. A direct INSERT would let a caller choose their own state.
-- ---------------------------------------------------------------------------

alter table public.professional_claims enable row level security;
alter table public.professional_claims force row level security;

revoke all on public.professional_claims from anon, authenticated;
grant select (id, professional_id, claimant_user_id, state, evidence,
              submitted_at, decided_at, decision_note, created_at, updated_at)
  on public.professional_claims to authenticated;

drop policy if exists professional_claims_select on public.professional_claims;
create policy professional_claims_select
  on public.professional_claims
  for select
  to authenticated
  using (
    claimant_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- 4. submit — filing a claim grants nothing
-- ---------------------------------------------------------------------------

create or replace function public.submit_professional_claim(
  p_professional_id uuid,
  p_evidence text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_claim_state public.professional_claim_state;
  v_claim_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'claiming a professional identity requires an authenticated session'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id;

  if v_claim_state is null then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- An already-claimed identity is not available. Refused here AND again
  -- under a row lock at review time, because the state can change between the
  -- two.
  if v_claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed'
      using errcode = '42501';
  end if;

  -- The claimant must not already hold an identity. Approving this would
  -- require MERGING two professional identities, and a merge that silently
  -- picked a winner would destroy one person's history. R17 owns merge; until
  -- it exists this fails closed rather than guessing.
  if exists (select 1 from public.professionals p where p.user_id = v_user_id) then
    raise exception 'this account already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  -- Idempotent: a double-submitted form returns the existing claim rather
  -- than a 23505 the caller has to interpret, and the partial unique index
  -- remains the actual guarantee against a concurrent second insert.
  select c.id into v_claim_id
  from public.professional_claims c
  where c.professional_id = p_professional_id
    and c.claimant_user_id = v_user_id
    and c.state = 'pending';

  if v_claim_id is not null then
    return v_claim_id;
  end if;

  insert into public.professional_claims (professional_id, claimant_user_id, evidence)
  values (p_professional_id, v_user_id, nullif(btrim(coalesce(p_evidence, '')), ''))
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

comment on function public.submit_professional_claim(uuid, text) is
  'Authenticated-only. Files a claim and grants NOTHING — the identity stays unclaimed until platform staff approve. Idempotent per (identity, claimant). Refuses an already-claimed identity, and refuses a claimant who already holds an identity, because approving that would need a merge and a silent merge would destroy one person''s history (R17 owns merge).';

revoke execute on function public.submit_professional_claim(uuid, text) from public, anon;
grant execute on function public.submit_professional_claim(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. withdraw — the claimant's own, and only while pending
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_professional_claim(p_claim_id uuid)
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
    raise exception 'withdrawing a claim requires an authenticated session'
      using errcode = '42501';
  end if;

  update public.professional_claims
  set state = 'withdrawn', decided_at = now()
  where id = p_claim_id
    and claimant_user_id = v_user_id
    and state = 'pending';

  if not found then
    raise exception 'claim not found, not yours, or already decided'
      using errcode = '42704';
  end if;
end;
$$;

comment on function public.withdraw_professional_claim(uuid) is
  'Authenticated-only. Withdraws the caller''s own pending claim. Never a silent no-op: a claim that is missing, someone else''s, or already decided raises rather than pretending to succeed.';

revoke execute on function public.withdraw_professional_claim(uuid) from public, anon;
grant execute on function public.withdraw_professional_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. review — platform only, and the only thing that can claim an identity
-- ---------------------------------------------------------------------------

create or replace function public.review_professional_claim(
  p_claim_id uuid,
  p_decision text,
  p_note text default null
)
returns public.professional_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer uuid;
  v_claim public.professional_claims;
  v_professional public.professionals;
  v_org_id uuid;
  v_org_count integer;
  v_converted boolean := false;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional claims'
      using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;

  -- The row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a state that is no longer pending and returns without
  -- repeating a single side effect.
  select * into v_claim from public.professional_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = '42704';
  end if;

  if v_claim.state <> 'pending' then
    return v_claim;
  end if;

  if p_decision = 'reject' then
    update public.professional_claims
    set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
        decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = v_claim.id
    returning * into v_claim;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (v_reviewer, 'professional_claim_rejected', 'professional_claims', v_claim.id,
            jsonb_build_object('professional_id', v_claim.professional_id,
                               'claimant_user_id', v_claim.claimant_user_id));
    return v_claim;
  end if;

  -- ---- approve ----------------------------------------------------------
  -- Lock the IDENTITY, not just the claim. Two reviewers approving two
  -- different claims for the same professional serialise here; the loser
  -- re-reads a row that is already claimed and refuses below.
  select * into v_professional from public.professionals
  where id = v_claim.professional_id for update;

  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed and cannot be transferred'
      using errcode = '42501';
  end if;

  -- Re-checked under the lock: the claimant may have acquired an identity
  -- between submitting and being reviewed.
  if exists (select 1 from public.professionals p where p.user_id = v_claim.claimant_user_id) then
    raise exception 'the claimant already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  perform set_config('fadeup.professional_claim_write', 'on', true);
  update public.professionals
  set claim_state = 'claimed', user_id = v_claim.claimant_user_id, claimed_at = now()
  where id = v_professional.id;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  update public.professional_claims
  set state = 'approved', decided_at = now(), decided_by = v_reviewer,
      decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = v_claim.id
  returning * into v_claim;

  -- Every other live claim on this identity is now moot. Closing them is not
  -- housekeeping: leaving them pending would let a later reviewer approve a
  -- second one and hit 23505 on the one-approval index, which is a confusing
  -- way to discover the profile was already taken.
  update public.professional_claims
  set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
      decision_note = 'another claim for this professional identity was approved'
  where professional_id = v_professional.id
    and state = 'pending'
    and id <> v_claim.id;

  -- Close the acquisition loop. The organization is DERIVED, never supplied:
  -- a caller-provided organization_id would let a reviewer attribute someone
  -- else's conversion. Exactly one owner membership is unambiguous; zero or
  -- several is not, and this declines to guess rather than picking one.
  select count(*) into v_org_count
  from public.memberships m
  where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

  if v_org_count = 1 then
    select m.organization_id into v_org_id
    from public.memberships m
    where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

    v_converted := private.record_prospect_conversion(v_professional.id, v_org_id);
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_reviewer, 'professional_claim_approved', 'professional_claims', v_claim.id,
          jsonb_build_object('professional_id', v_professional.id,
                             'claimant_user_id', v_claim.claimant_user_id,
                             'owner_organization_count', v_org_count,
                             'prospect_conversion_recorded', v_converted));

  return v_claim;
end;
$$;

comment on function public.review_professional_claim(uuid, text, text) is
  'Platform-staff only, and the ONLY path that can move a professional identity to claimed. Locks the claim and then the identity, so simultaneous approvals produce exactly one winner — with a UNIQUE index on (professional_id) WHERE state=''approved'' as the second, independent guarantee. Refuses to transfer an already-claimed identity, refuses a claimant who already holds one (merge is R17''s), closes sibling claims, writes platform_audit_log, and derives the conversion organization from the claimant''s own single owner membership rather than trusting a caller-supplied id.';

revoke execute on function public.review_professional_claim(uuid, text, text) from public, anon;
grant execute on function public.review_professional_claim(uuid, text, text) to authenticated;


-- ============================================================================
-- END db/migrations/20260826100800_professional_claims.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826100900_public_projections.sql
-- ============================================================================

-- FadeUp — R1B: the public data contract
--
-- There are ZERO anon RLS policies in this database and R1B adds none. Every
-- anonymous read goes through a curated SECURITY DEFINER projection that names
-- its columns explicitly, which is the difference between a data contract and
-- a table that happens to be readable.
--
-- TWO PROJECTIONS, NOT ONE WITH A FLAG
--
-- The tempting design is one function returning a claimed/unclaimed boolean
-- and NULLing the operational columns for unclaimed rows. It is rejected, and
-- the reason is failure mode rather than taste: with one shape, adding a
-- column later — a wait time, an "available today", a client count — silently
-- adds it to the UNCLAIMED contract too, and the only thing standing between a
-- Worker-discovered barbershop and a fabricated wait time is whoever writes
-- that migration remembering to special-case it.
--
-- With two shapes the unclaimed projection PHYSICALLY CANNOT carry
-- bookability, queue state or counts, because those columns are not in its
-- RETURNS TABLE. Constitution §5.5 asks for this to be "structurally difficult
-- to violate, not merely discouraged".
--
-- WHAT NEITHER PROJECTION EXPOSES, FOR ANYONE
--
--   who has a future appointment        Constitution §4.3
--   who is currently in the queue       §4.3
--   live customer presence              §4.3
--   private visit timestamps            §4.3
--   any customer's contact details      §4.3
--   verified-client counts              TARGET_DOMAIN_MODEL §6.2 — withdrawn
--   acquisition provenance              professionals.source is not granted to
--                                       any client and is not selected here
--   claim workflow state                a claim queue is an abuse surface
--
-- A follow is not permission to name someone publicly as a client. The follow
-- COUNT below is an aggregate over the professional; no follower is ever
-- identified, and the relationship aggregate is not read by this file at all.
--
-- UNCLAIMED PUBLICATION IS OFF, AND IT IS OFF IN THE SCHEMA
--
-- professionals carries
--   check (not is_public or (claim_state = 'claimed' and ...))
-- so an unclaimed identity cannot be is_public at all. The unclaimed
-- projection below is therefore correct AND currently returns zero rows for
-- every input. That is deliberate: R10 turns publication on by removing that
-- one clause, having already had this contract reviewed, rather than by
-- writing a projection under launch pressure.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Follower count — computed, capped, never materialized
--
-- TARGET_DOMAIN_MODEL §1 classifies counts as derived rather than stored, and
-- for a single indexed count that is the cheaper AND the more correct choice:
-- nothing can drift from the canonical edges because nothing is duplicating
-- them.
--
-- Capped by a LIMIT inside the subquery, so the cost is bounded no matter how
-- popular a professional becomes. A profile showing "10000+" is the intended
-- product behaviour, not a rounding artefact.
-- ---------------------------------------------------------------------------

create or replace function private.professional_follower_count(p_professional_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from (
    select 1
    from public.professional_follows f
    where f.professional_id = p_professional_id
      and f.state = 'following'
    limit 10000
  ) capped;
$$;

comment on function private.professional_follower_count(uuid) is
  'Follower count computed from the canonical edges, never materialized — so it cannot drift from them. Capped at 10000 by a LIMIT inside the subquery so a very popular profile costs the same as any other. Counts only state=''following'', so an explicit unfollow removes the follower immediately.';

revoke execute on function private.professional_follower_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The CLAIMED projection
--
-- A real professional who controls their own identity and has chosen to be
-- public. Still curated: this returns presentational identity plus one
-- aggregate, and nothing operational. Bookability continues to live where it
-- always has — get_public_barber, list_public_barbers,
-- get_public_available_slots — which are anchored on a barbers row and an
-- organization, and which R1B does not touch.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.id = p_professional_id
    and p.claim_state = 'claimed'
    and p.is_public;
$$;

comment on function public.get_public_professional(uuid) is
  'Anon-callable. The public contract for a CLAIMED professional who has opted in. Returns presentational identity and a capped follower count — no availability, no queue, no wait time, no schedule, no appointment or client data, no acquisition provenance, no claim state. Returns zero rows (never an error) for an identity that is unclaimed, not public, or absent: a non-public professional must be indistinguishable from one that does not exist.';

revoke execute on function public.get_public_professional(uuid) from public;
grant execute on function public.get_public_professional(uuid) to anon, authenticated;

create or replace function public.get_public_professional_by_handle(p_handle text)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.handle is not null
    and lower(p.handle) = lower(btrim(coalesce(p_handle, '')))
    and p.claim_state = 'claimed'
    and p.is_public;
$$;

comment on function public.get_public_professional_by_handle(text) is
  'Anon-callable handle lookup, same contract and same shape as get_public_professional. The shop-independent public address the marketplace has never had — /s/:slug/barbers/:barberId keeps working unchanged and R6/R7 adds the handle route alongside it.';

revoke execute on function public.get_public_professional_by_handle(text) from public;
grant execute on function public.get_public_professional_by_handle(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The UNCLAIMED projection
--
-- A DIFFERENT SHAPE, and that is the entire safety mechanism.
--
--   no follower_count      an external profile has no FadeUp followers, and
--                          showing a zero would still imply a FadeUp presence
--   no location            no bookability, so no "where can I book"
--   no operational field   there is no column to leak
--   is_claimed literal     always false, so a consumer cannot render this as a
--                          claimed profile by forgetting to check
--
-- Returns zero rows today for every input, because the publication CHECK makes
-- is_public impossible while unclaimed. Shipping the contract now and the
-- launch later is the point.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_external_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  is_claimed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         false
  from public.professionals p
  where p.id = p_professional_id
    and p.claim_state = 'unclaimed'
    and p.is_public;
$$;

comment on function public.get_public_external_professional(uuid) is
  'Anon-callable. The public contract for an UNCLAIMED, externally discovered professional. A DELIBERATELY DIFFERENT SHAPE from get_public_professional: it has no follower_count, no location and no operational column, so it cannot leak or fabricate FadeUp state even by accident. is_claimed is a literal false so no consumer can mistake it for a claimed profile. Returns zero rows for every input in R1B — the publication CHECK on professionals forbids is_public while unclaimed, and R10 removes that clause deliberately.';

revoke execute on function public.get_public_external_professional(uuid) from public;
grant execute on function public.get_public_external_professional(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The customer's own follow list
--
-- Without this the follow graph is write-only for the person who owns it: RLS
-- lets a customer read their own EDGES, but professionals_select does not let
-- them read a professional they merely follow, so they would get a list of
-- UUIDs. This resolves each edge through the same curated claimed shape.
--
-- Authenticated-only and scoped to auth.uid() inside the function — a caller
-- cannot pass someone else's id, because there is no parameter to pass.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_followed_professionals()
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  avatar_url text,
  followed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.avatar_url, f.followed_at
  from public.professional_follows f
  join public.professionals p on p.id = f.professional_id
  where f.follower_user_id = (select auth.uid())
    and f.state = 'following'
  order by f.followed_at desc;
$$;

comment on function public.list_my_followed_professionals() is
  'Authenticated-only. The caller''s own follow list, resolved to identities. Takes NO parameter, so there is nothing to forge — the follower is always auth.uid(). Deliberately does not filter on is_public: a customer who followed a professional keeps seeing them if the professional later goes private, which is their own relationship rather than a public listing.';

revoke execute on function public.list_my_followed_professionals() from public, anon;
grant execute on function public.list_my_followed_professionals() to authenticated;


-- ============================================================================
-- END db/migrations/20260826100900_public_projections.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826101000_r1b_privilege_hardening.sql
-- ============================================================================

-- FadeUp — R1B: the privilege sweep, and its self-assertion
--
-- WHY THIS FILE EXISTS AT ALL
--
-- Supabase installs DEFAULT PRIVILEGES that grant anon, authenticated and
-- service_role EVERYTHING on every new table in `public`:
--
--   pg_default_acl -> postgres/public/r ->
--     anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
--
-- Confirmed by probing the running image, not assumed. The consequence is that
-- a `create table` with perfect RLS still ships with `authenticated` holding
-- INSERT, UPDATE, DELETE and TRUNCATE, and RLS is the only thing standing
-- between a caller and the data. On a table with no INSERT policy that is
-- survivable; on one with a permissive SELECT policy it is not, and relying on
-- policy coverage to compensate for a privilege you did not intend to grant is
-- how a single forgotten policy becomes a breach.
--
-- Every R1B migration revokes at creation. This file re-asserts the whole
-- matrix in one place and then FAILS THE MIGRATION if any of it is wrong — so
-- the guarantee is tested at deploy time rather than trusted.
--
-- It also re-runs the R1A-established rule about column privileges: a
-- column-level REVOKE cannot subtract from a table-level grant. Every
-- restriction below is therefore a table-level revoke followed by an explicit
-- re-grant of the columns that stay.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Re-assert the revokes
--
-- Deliberately repeated rather than trusted: if a future migration re-runs a
-- CREATE TABLE path or someone restores from a dump taken before the revoke,
-- this is where it is caught.
-- ---------------------------------------------------------------------------

revoke all on public.professionals from anon, authenticated;
grant select (id, claim_state, display_name, handle, headline, bio, avatar_url,
              is_public, claimed_at, created_at, updated_at)
  on public.professionals to authenticated;
grant update (display_name, handle, headline, bio, avatar_url, is_public)
  on public.professionals to authenticated;

revoke all on public.professional_follows from anon, authenticated;
grant select (id, professional_id, state, source, followed_at, unfollowed_at, created_at, updated_at)
  on public.professional_follows to authenticated;

revoke all on public.customer_professional_relationships from anon, authenticated;
grant select on public.customer_professional_relationships to authenticated;

revoke all on public.professional_claims from anon, authenticated;
grant select (id, professional_id, claimant_user_id, state, evidence,
              submitted_at, decided_at, decision_note, created_at, updated_at)
  on public.professional_claims to authenticated;

revoke all on public.prospect_professionals from anon, authenticated;
grant select on public.prospect_professionals to prospect_worker;

-- The acquisition worker gets nothing on the social side. R1A tightened its
-- privileges precisely because its job is parsing third-party scraped content,
-- which is a materially higher-risk surface than the customer API; R1B must
-- not hand that surface the follow graph or the relationship aggregate.
revoke all on public.professionals from prospect_worker;
revoke all on public.professional_follows from prospect_worker;
revoke all on public.customer_professional_relationships from prospect_worker;
revoke all on public.professional_claims from prospect_worker;
revoke all on public.customer_passports from prospect_worker;

-- ---------------------------------------------------------------------------
-- 2. Assert the result, table by table
--
-- The migration fails rather than logging a warning. A privilege matrix that
-- is "probably right" is the thing this file exists to eliminate.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2a. No mutation privileges for anon or authenticated on any R1B table,
  --     and no privilege of any kind for anon.
  for r in
    select t.table_name, g.grantee, g.privilege_type
    from (values
      ('professionals'), ('professional_follows'),
      ('customer_professional_relationships'), ('professional_claims'),
      ('prospect_professionals')
    ) as t(table_name)
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = t.table_name
    where g.grantee in ('anon', 'authenticated', 'PUBLIC')
      and (g.grantee <> 'authenticated' or g.privilege_type <> 'SELECT')
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.table_name, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception 'R1B privilege check failed — unexpected grants:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2b. RLS enabled AND forced. Enabled alone exempts the table owner, and
  --     several definer functions run as postgres.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('professionals', 'professional_follows',
                        'customer_professional_relationships',
                        'professional_claims', 'prospect_professionals')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  loop
    v_bad := v_bad || ' ' || r.relname;
  end loop;

  if v_bad <> '' then
    raise exception 'R1B RLS check failed — not enabled+forced on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2c. EVERY R1B function pins search_path — deliberately not filtered to
  --     SECURITY DEFINER. An unqualified name resolves through the CALLER's
  --     search_path in either case, which is a privilege-escalation primitive:
  --     a caller creates their own `professionals` in a schema they control
  --     and the function reads or writes there instead. Definer functions make
  --     it worse, not different.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'assign_barber_professional', 'guard_professional_identity', 'is_own_professional',
        'auto_follow_professional', 'follow_professional', 'unfollow_professional',
        'appointments_auto_follow', 'queue_entries_auto_follow',
        'record_completed_interaction', 'appointments_record_relationship',
        'queue_entries_record_relationship', 'guard_customer_professional_relationship',
        'reconcile_customer_professional_relationships',
        'generate_passport_number', 'stamp_passport_identity', 'guard_passport_identity',
        'ensure_customer_passport', 'customer_profiles_issue_passport',
        'create_external_professional', 'record_prospect_conversion',
        'submit_professional_claim', 'withdraw_professional_claim',
        'review_professional_claim', 'enforce_professional_claim_transition',
        'professional_follower_count', 'get_public_professional',
        'get_public_professional_by_handle', 'get_public_external_professional',
        'list_my_followed_professionals'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R1B search_path check failed — not pinned on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2d. anon may execute exactly the three anon-facing projections and nothing
  --     else R1B added. A mutation RPC reachable without a session would make
  --     every ownership check in this lot decorative.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'follow_professional', 'unfollow_professional',
        'submit_professional_claim', 'withdraw_professional_claim',
        'review_professional_claim', 'create_external_professional',
        'reconcile_customer_professional_relationships',
        'list_my_followed_professionals',
        'auto_follow_professional', 'record_completed_interaction',
        'ensure_customer_passport', 'generate_passport_number',
        'record_prospect_conversion', 'professional_follower_count'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R1B EXECUTE check failed — anon can execute:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_anon_policies integer;
begin
  -- 2e. The database has had ZERO anon RLS policies since it shipped. R1B
  --     adds none, and every anonymous read goes through a curated projection
  --     instead. This asserts the invariant globally, not just for R1B tables,
  --     because the number that matters is the total.
  select count(*) into v_anon_policies
  from pg_policies
  where schemaname = 'public' and 'anon' = any(roles);

  if v_anon_policies > 0 then
    raise exception 'R1B anon-policy check failed — % anon policies exist; R1B must add none', v_anon_policies
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The R1A column protections, re-asserted
--
-- These are R1A's guarantees, not R1B's, but R1B revoked and re-granted on
-- both appointments-adjacent tables and on customer_passports and barbers.
-- A re-grant that accidentally widened one of them would be invisible without
-- this check, and it is exactly the class of mistake the mechanism invites.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
begin
  if has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'UPDATE') then
    v_bad := v_bad || ' appointments.booked_by_user_id';
  end if;

  if has_column_privilege('authenticated', 'public.appointments', 'completed_at', 'UPDATE') then
    v_bad := v_bad || ' appointments.completed_at';
  end if;

  if has_column_privilege('authenticated', 'public.queue_entries', 'booked_by_user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.queue_entries', 'booked_by_user_id', 'UPDATE') then
    v_bad := v_bad || ' queue_entries.booked_by_user_id';
  end if;

  if has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'UPDATE') then
    v_bad := v_bad || ' barbers.professional_id';
  end if;

  if has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'INSERT')
     or has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.passport_number';
  end if;

  if has_column_privilege('authenticated', 'public.customer_passports', 'issued_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.customer_passports', 'issued_at', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.issued_at';
  end if;

  -- The other direction, and it is not symmetry for its own sake: R1A recorded
  -- that customer_passports.user_id MUST stay UPDATE-grantable, because
  -- apps/web/src/lib/queries/passport.ts upserts with
  -- onConflict: 'user_id' and ON CONFLICT DO UPDATE requires UPDATE on every
  -- column in its SET list. Withholding it breaks the live Passport save.
  if not has_column_privilege('authenticated', 'public.customer_passports', 'user_id', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.user_id-MISSING-UPDATE';
  end if;

  -- Passport DELETE stays revoked. R1A removed the delete policy; a Passport
  -- is identity, not a record its owner can drop.
  if has_table_privilege('authenticated', 'public.customer_passports', 'DELETE') then
    v_bad := v_bad || ' customer_passports-DELETE-REGRESSED';
  end if;

  if v_bad <> '' then
    raise exception 'R1B column-privilege check failed —%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R1B privilege hardening: all checks passed';
end $$;


-- ============================================================================
-- END db/migrations/20260826101000_r1b_privilege_hardening.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next steps: run
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in both.
-- ============================================================================
