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
