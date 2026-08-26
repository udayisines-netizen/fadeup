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
