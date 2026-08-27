-- ============================================================================
-- FadeUp — MASTER: R4, the Worker core and acquisition engine
-- Generated 2026-08-28. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r4.sh
-- Verify in sync:   scripts/generate-master-r4.sh --check
--
-- WHAT THIS IS
--
--   Constitution §5.1 states the acquisition pipeline as:
--
--     SOURCE -> SOURCE OBSERVATION -> NORMALIZED CANDIDATE -> CANONICAL
--     PROSPECT -> PUBLIC ELIGIBILITY -> EXTERNAL UNCLAIMED PROFILE -> CLAIM
--     -> CLAIMED PROFESSIONAL / BUSINESS
--
--   Everything before PUBLIC ELIGIBILITY has shipped and is production quality:
--   the Worker's sources, normalizers, identity resolution, enrichment and
--   scoring. Everything after it shipped in R1B: create_external_professional
--   mints an unclaimed identity, professional_claims lets a real person take it
--   over.
--
--   PUBLIC ELIGIBILITY itself did not exist anywhere. Nothing decided WHICH
--   canonical prospects deserve a durable FadeUp identity, which meant the only
--   thing standing between a single scrape and a permanent public-facing name
--   was that no code had called the RPC yet. That is not a safe default; it is
--   an unexercised one.
--
--   This file adds one table, one column, one view, five functions, three
--   triggers and one rewritten CHECK constraint:
--
--     prospect_publication_eligibility   the CACHED verdict, for the operator
--                                        review queue
--     publication_block_reason           the LIVE gate: eleven reasons, first
--                                        hit wins, NULL means publishable
--     publish_external_professional      the operator's front door
--     prospect_publication_queue         a narrow read projection for /platform
--     prospect_sources.is_identity_trust_anchor
--
--   plus the two acquisition analytics contracts R3 documented and deliberately
--   left deferred, now wired.
--
--   THIS LOT REQUIRES R1B, R3 AND THE WORKER V2 ACQUISITION SCHEMA.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. THE GATE GUARDS THE DOOR; IT DOES NOT AUDIT THE BUILDING.
--      The trigger fires on INSERT. Identities that already exist are NOT
--      re-validated, and most of them would fail if they were — nothing
--      previously required two independent sources. That is deliberate: people
--      may already have claimed those identities, and retroactively
--      invalidating a claimed profile would be a far worse error than having
--      published it. The companion SEED proves this with a pre-existing
--      single-source identity that survives the upgrade untouched.
--
--   B. THIS FILE PUBLISHES NOTHING. It installs the machinery for minting
--      external identities and mints zero. Every publication is an explicit
--      platform-administrator decision through publish_external_professional,
--      written to platform_audit_log with the name as published. The generator
--      asserts that applying this file creates no linkage row.
--
--   C. THE WORKER EVALUATES; A HUMAN DECIDES. prospect_worker gets EXECUTE on
--      the gate and the sweep, and is explicitly REVOKED from
--      publish_external_professional — asserted inside the migration itself, so
--      a later lot that wants a bounded auto-publish lane has to remove an
--      assertion somebody wrote down on purpose.
--
--   D. THE CACHE IS NOT THE GUARANTEE. prospect_publication_eligibility is a
--      refreshed copy for listing; the BEFORE INSERT trigger consults the LIVE
--      function. A stale cache can mislead an operator about what is available
--      to review; it can never permit a publication the live gate would refuse.
--
--   E. THE ELEVEN REASONS ARE EVIDENCE-BASED, NOT SCORE-BASED. Not one of them
--      consults fadeup_fit_score or migration_potential. "Is this a real
--      business we can name correctly" and "is this a good sales lead" are
--      different questions, and publication asks only the first.
--
--   F. NOTHING IS BACKFILLED. No prospect is evaluated by this file; the cache
--      fills from the Worker's first sweep forward, exactly as R3's funnels
--      fill from application forward.
--
--   G. THE ACQUISITION FUNNEL GAINS ITS HEAD. prospect_discovered and
--      prospect_enriched move from `deferred` to `wired`. They are emitted by
--      AFTER triggers on tables the Worker already writes — NOT by granting the
--      Worker access to the analytics emitter, which R3 §11.3 refused on the
--      grounds that a scraping worker is the highest-risk credential in the
--      system. That refusal stands.
--
--   H. ONE CORRECTION TO A CLOSED LOT. R1B created a platform-staff SELECT
--      policy on prospect_professionals and revoked ALL from authenticated,
--      including SELECT. Postgres checks the grant before any policy, so that
--      policy has never been reachable. R4 grants SELECT on three columns
--      (prospect_id, professional_id, created_at) so the policy can run;
--      match_confidence and matching_rule stay ungranted.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No auto-publication of any kind. No fuzzy matching, no auto-merge, no
--   manual eligibility override. No change to the Worker's discovery,
--   enrichment, dedupe, scoring or outreach pipeline — that machinery is
--   untouched. No campaign entity. No new pricing, plan or capability. No SMS.
--   No cron and no scheduled job. No mobile application.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Mints no professional identity and writes no prospect_professionals row.
--   * Changes no existing row except prospect_sources.is_identity_trust_anchor
--     on the single `sirene` row, from the column's own default.
--   * Adds no anon RLS policy and no anon grant.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--
--   The earlier lots' verifications must still pass:
--     supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--     supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_ORGANIZATION_FOLLOWS_2026_08_27.sql
--     supabase/VERIFY_CUSTOMER_API_FREEZE_2026_08_27.sql
--     supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--     supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
--
--   NOTE: R4 required fixture corrections in three earlier suites — R1B's mint
--   fixtures now provision real provenance, R3's deferred-contract count became
--   an invariant, and R1A's public-table allow-list names the new table. Those
--   are corrections to tests, not relaxations of guarantees; each is commented
--   in place.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260828100000_prospect_publication_eligibility.sql
-- ============================================================================

-- FadeUp — R4: PUBLIC ELIGIBILITY, the arrow nothing implemented
--
-- Constitution §5.1 states the acquisition pipeline as:
--
--   SOURCE -> SOURCE OBSERVATION -> NORMALIZED CANDIDATE -> CANONICAL PROSPECT
--          -> PUBLIC ELIGIBILITY -> EXTERNAL UNCLAIMED PROFILE -> CLAIM
--          -> CLAIMED PROFESSIONAL / BUSINESS
--
-- Every arrow before PUBLIC ELIGIBILITY has shipped and is production quality:
-- the Worker's sources, normalizers, identity resolution and scoring. The two
-- arrows after it shipped in R1B: create_external_professional mints an
-- unclaimed identity, and professional_claims lets a real person take it over.
--
-- PUBLIC ELIGIBILITY itself did not exist anywhere. Nothing decided WHICH
-- canonical prospects deserve a durable FadeUp identity, which meant the only
-- thing standing between a single scrape and a permanent public-facing name
-- was that no code had called the RPC yet. That is not a safe default; it is
-- an unexercised one.
--
-- WHY PUBLICATION IS A HIGHER BAR THAN OUTREACH
--
-- outreach_block_reason already answers "may we CONTACT this business?". This
-- file answers a louder question: "may we MINT A DURABLE IDENTITY for this
-- business inside FadeUp?" A message is transient and a person can reply to
-- it. An identity persists, is claimable, and is the thing R10 will eventually
-- make publicly visible. So the gate is strictly more conservative, and every
-- reason it can give is grounded in evidence the pipeline actually collected.
--
-- THE CACHE IS NOT THE GUARANTEE
--
-- This file ships two things that must not be confused:
--
--   public.publication_block_reason(uuid)        -- LIVE. The authority.
--   public.prospect_publication_eligibility      -- CACHE. For listing only.
--
-- The cache exists because the operator review queue has to page through
-- candidates without running an eleven-branch plpgsql function per row over
-- the whole prospects table. It can go stale between Worker evaluations, and
-- that is tolerable precisely because 20260828100100's BEFORE INSERT trigger
-- consults the LIVE function and never the cache. A stale cache can therefore
-- show an operator a candidate that turns out to be blocked; it can never let
-- a blocked prospect be published.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT BUILD
--
--   No auto-publication. The Worker evaluates; a human publishes. Constitution
--   §5.3 prefers an unresolved candidate to a destructive resolution, and at
--   this stage of the funnel the destructive act is minting a public identity
--   for a business that is really two businesses, or really one already in the
--   table twice. R10 owns discovery at scale and may add a bounded auto-publish
--   lane on top of this gate; it must not replace it.
--
--   No manual eligibility override. There is no column an operator can set to
--   force a prospect eligible, because the gate's whole value is that its
--   answer is derived from evidence. An operator who disagrees with the gate
--   should fix the evidence — resolve the duplicate, add the second source —
--   not overrule it.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Trust anchors are data, not a hardcoded source key
--
-- The evidence rule below accepts EITHER two independent sources OR one source
-- that is a verified registry. "Which sources are registries" is an operator
-- fact that changes as sources are added (INSEE Sirene today; Companies House,
-- the Handelsregister, a national trade registry tomorrow), so it lives on the
-- source row rather than inside the function. Adding a registry is then a data
-- change somebody can see in an audit log, not a migration nobody re-reads.
--
-- Default false: a new source is NOT a trust anchor until someone says so.
-- ---------------------------------------------------------------------------

alter table public.prospect_sources
  add column if not exists is_identity_trust_anchor boolean not null default false;

comment on column public.prospect_sources.is_identity_trust_anchor is
  'True when an observation from this source is, on its own, sufficient identity evidence to mint an external professional identity — i.e. the source is a verified business registry rather than a places directory. Read by public.publication_block_reason. Defaults false: a newly added source earns this deliberately, never by arriving.';

-- INSEE Sirene is a French government business registry: a SIRET is a verified
-- legal identity, not a crowd-sourced or advertising-funded listing. OSM,
-- Geoapify, Google Places, the website crawler and Instagram are all
-- observations of a presence, which is a different and weaker claim.
update public.prospect_sources
set is_identity_trust_anchor = true
where key = 'sirene' and not is_identity_trust_anchor;

-- ---------------------------------------------------------------------------
-- 2. The live gate
--
-- Mirrors public.outreach_block_reason deliberately, down to returning the
-- FIRST blocking reason as text rather than an array: the operator UI shows one
-- reason and one remedy, and a list invites arguing with the least important
-- entry. STABLE, so a caller may use it in a query over many rows.
--
-- Ordered from "never publishable" to "not yet publishable", because the first
-- reason returned is the one an operator reads.
-- ---------------------------------------------------------------------------

create or replace function public.publication_block_reason(p_prospect_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prospect public.prospects;
  v_distinct_sources integer;
  v_trust_anchor boolean;
begin
  select * into v_prospect from public.prospects where id = p_prospect_id;
  if not found then
    return 'prospect_not_found';
  end if;

  -- ---- never publishable ------------------------------------------------
  --
  -- A business that has asked FadeUp not to contact it has not consented to
  -- being catalogued either. Outreach suppression is reused as publication
  -- suppression on purpose: a shop that opted out and then found its own name
  -- minted as a FadeUp identity would be right to consider the opt-out a lie.

  if v_prospect.do_not_contact then
    return 'do_not_contact';
  end if;

  if exists (
    select 1 from public.prospect_suppressions
    where scope = 'prospect' and prospect_id = p_prospect_id
  ) then
    return 'suppressed_prospect';
  end if;

  if v_prospect.phone_e164 is not null
     and private.is_prospect_value_suppressed('phone', v_prospect.phone_e164) then
    return 'suppressed_phone';
  end if;

  if v_prospect.email is not null
     and private.is_prospect_value_suppressed('email', v_prospect.email) then
    return 'suppressed_email';
  end if;

  if v_prospect.website_domain is not null
     and private.is_prospect_value_suppressed('domain', v_prospect.website_domain) then
    return 'suppressed_domain';
  end if;

  -- Already ours. A converted business gets its identity from its own account,
  -- through the ordinary product path — never from a scrape of its old public
  -- listing. Minting here would produce a second, unclaimed identity competing
  -- with the real one.
  if v_prospect.converted_organization_id is not null then
    return 'already_converted';
  end if;

  if v_prospect.status in ('customer', 'trial') then
    return 'already_customer';
  end if;

  -- A group parent is an umbrella record for a chain, not a person or a shop
  -- anyone can claim. Its locations are the publishable entities.
  if v_prospect.entity_kind = 'group_parent' then
    return 'entity_kind_not_publishable';
  end if;

  -- ---- already done -----------------------------------------------------
  --
  -- Checked before the evidence rules so a re-run of a publication reports the
  -- honest reason rather than re-litigating evidence that was already accepted.
  if exists (
    select 1 from public.prospect_professionals where prospect_id = p_prospect_id
  ) then
    return 'already_published';
  end if;

  -- ---- not yet publishable ----------------------------------------------
  --
  -- create_external_professional copies canonical_name straight onto the
  -- identity's display_name, so a scraped fragment becomes a durable public
  -- name. Two characters of actual letters is a low bar and it still rejects
  -- the realistic junk: "—", "42", "?", a lone punctuation run.
  if char_length(btrim(v_prospect.canonical_name)) < 2
     or btrim(v_prospect.canonical_name) !~ '[[:alpha:]]{2}' then
    return 'name_not_publishable';
  end if;

  -- Constitution §5.3: a false merge of two real shops is worse than a
  -- temporarily unresolved duplicate. Minting an identity for a prospect that
  -- may BE another prospect is the same error one step later, and it is worse
  -- there because the identity is claimable — two people could each claim half
  -- of one real business. Unresolved means unpublishable, in both directions
  -- of the candidate pair.
  if exists (
    select 1 from public.prospect_duplicates
    where status = 'pending'
      and (prospect_id = p_prospect_id or duplicate_of_prospect_id = p_prospect_id)
  ) then
    return 'unresolved_duplicate';
  end if;

  -- Constitution §5.1: never one scraper result = one professional. The
  -- pipeline's convergence machinery makes multi-source agreement MEASURABLE;
  -- this is the line that makes it REQUIRED. Either two independent sources
  -- saw the same business, or one verified registry did.
  select count(distinct psr.source_id),
         bool_or(ps.is_identity_trust_anchor)
    into v_distinct_sources, v_trust_anchor
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = p_prospect_id;

  if coalesce(v_distinct_sources, 0) < 2 and not coalesce(v_trust_anchor, false) then
    return 'insufficient_source_evidence';
  end if;

  -- An identity with no geography and no domain is not marketplace supply and
  -- is not claimable in practice: nobody can recognise it as themselves, and no
  -- customer could ever be looking for it. prospects.country is NOT NULL and is
  -- therefore not evidence of anything.
  if v_prospect.website_domain is null
     and not exists (
       select 1 from public.prospect_locations where prospect_id = p_prospect_id
     ) then
    return 'no_corroborating_location';
  end if;

  return null;
end;
$$;

comment on function public.publication_block_reason(uuid) is
  'The LIVE authority on whether a canonical prospect may be minted into an external professional identity. Returns the first blocking reason, or NULL when publishable. Strictly more conservative than outreach_block_reason because an identity is durable and claimable where a message is transient: it additionally refuses group parents, unresolved duplicate candidates, unpublishable names, single-source evidence without a registry anchor, and prospects with neither a location nor a domain. Enforced by a BEFORE INSERT trigger on prospect_professionals, so no caller — not the Worker, not platform staff, not a direct psql session — can route around it.';

revoke execute on function public.publication_block_reason(uuid) from public, anon;
grant execute on function public.publication_block_reason(uuid) to authenticated, prospect_worker;

-- ---------------------------------------------------------------------------
-- 3. The cache
--
-- prospect_id is the primary key rather than a surrogate id with a unique
-- constraint: the row IS the current verdict for one prospect, there is never a
-- second one, and the PK is then also the index the review queue joins on.
-- ---------------------------------------------------------------------------

create table if not exists public.prospect_publication_eligibility (
  prospect_id uuid primary key references public.prospects (id) on delete cascade,

  -- Fail closed. A row that somehow arrives without an evaluation says "no".
  is_eligible boolean not null default false,
  block_reason text,

  -- The two evidence counters the gate actually decided on, denormalized so
  -- the review queue can explain a verdict without re-deriving it.
  distinct_source_count integer not null default 0,
  has_trust_anchor boolean not null default false,

  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Contradictory states are unrepresentable, not merely unlikely — the same
  -- discipline R1B applied to professionals and professional_claims. "Eligible
  -- with a reason" and "blocked with no reason" are both storage errors.
  constraint prospect_publication_eligibility_reason_matches_verdict
    check (is_eligible = (block_reason is null)),

  constraint prospect_publication_eligibility_source_count_sane
    check (distinct_source_count >= 0)
);

comment on table public.prospect_publication_eligibility is
  'A CACHE of public.publication_block_reason, refreshed by the Worker''s publication_evaluation job, so the operator review queue can page candidates without running the gate per row. It is deliberately NOT the guarantee: the BEFORE INSERT trigger on prospect_professionals consults the live function. A stale row can therefore mislead an operator about what is available to review; it can never permit a publication the live gate would refuse.';

comment on column public.prospect_publication_eligibility.block_reason is
  'NULL exactly when eligible, enforced by check constraint. Values are the reason vocabulary of publication_block_reason, not free text.';

-- The review queue: eligible candidates, oldest evaluation first. Partial,
-- because the queue never asks for blocked rows and blocked rows are expected
-- to be the large majority of the table.
create index if not exists prospect_publication_eligibility_queue_idx
  on public.prospect_publication_eligibility (evaluated_at)
  where is_eligible;

-- The Worker's re-evaluation sweep: least recently evaluated first, across all
-- verdicts. Separate from the queue index because it deliberately does include
-- blocked rows — a blocked prospect becomes eligible when its duplicate is
-- resolved or a second source lands, and nothing else would notice.
create index if not exists prospect_publication_eligibility_staleness_idx
  on public.prospect_publication_eligibility (evaluated_at);

drop trigger if exists prospect_publication_eligibility_set_updated_at
  on public.prospect_publication_eligibility;
create trigger prospect_publication_eligibility_set_updated_at
  before update on public.prospect_publication_eligibility
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- SELECT: any platform role, matching every other acquisition table.
--
-- INSERT / UPDATE / DELETE: NO policy, for ANY role — including
--   prospect_worker, which writes every other acquisition table directly. The
--   refresh RPC below is the only writer. The reason is specific rather than
--   ceremonial: this table's rows are DERIVED, and a role that could write them
--   directly could write `is_eligible = true` for a prospect the gate refuses.
--   That would not actually permit a publication (the trigger re-checks live),
--   but it would put a lie in front of the operator who approves one, and the
--   operator's judgement is the control this lot rests on.
--
-- authenticated gets no write path either, for the same reason: there is
-- deliberately no manual override.
-- ---------------------------------------------------------------------------

alter table public.prospect_publication_eligibility enable row level security;
alter table public.prospect_publication_eligibility force row level security;

revoke all on public.prospect_publication_eligibility from anon, authenticated;
-- SELECT only, and the policy below is what narrows it to platform staff. A
-- policy without a grant is unreachable code, not extra safety: Postgres checks
-- the grant first and returns "permission denied" before any policy is
-- consulted. This mirrors prospect_outreach_eligibility, the table's closest
-- sibling, which is granted and policy-filtered the same way.
grant select on public.prospect_publication_eligibility to authenticated;
grant select on public.prospect_publication_eligibility to prospect_worker;

drop policy if exists prospect_publication_eligibility_select_platform
  on public.prospect_publication_eligibility;
create policy prospect_publication_eligibility_select_platform
  on public.prospect_publication_eligibility
  for select
  to authenticated
  using ((select private.has_platform_role(
    array['platform_owner', 'platform_admin', 'platform_support']::public.platform_role[]
  )));

drop policy if exists prospect_publication_eligibility_select_worker
  on public.prospect_publication_eligibility;
create policy prospect_publication_eligibility_select_worker
  on public.prospect_publication_eligibility
  for select
  to prospect_worker
  using (true);

-- ---------------------------------------------------------------------------
-- 5. Refreshing the cache
--
-- Callable by the Worker and by platform staff. Both arms are checked in-body
-- rather than relying on the grant alone, matching every acquisition RPC in
-- this schema — and matching create_external_professional's session_user test,
-- for the reason R1B documented there: inside a SECURITY DEFINER function
-- current_user is the owner, so only session_user identifies who connected.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_prospect_publication_eligibility(p_prospect_id uuid)
returns public.prospect_publication_eligibility
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_distinct_sources integer;
  v_trust_anchor boolean;
  v_row public.prospect_publication_eligibility;
begin
  if not (
    (select private.has_platform_role(
       array['platform_owner', 'platform_admin']::public.platform_role[]))
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform administrators or the acquisition worker can evaluate publication eligibility'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.prospects where id = p_prospect_id) then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  v_reason := public.publication_block_reason(p_prospect_id);

  select count(distinct psr.source_id),
         coalesce(bool_or(ps.is_identity_trust_anchor), false)
    into v_distinct_sources, v_trust_anchor
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = p_prospect_id;

  insert into public.prospect_publication_eligibility as e (
    prospect_id, is_eligible, block_reason,
    distinct_source_count, has_trust_anchor, evaluated_at
  )
  values (
    p_prospect_id, v_reason is null, v_reason,
    coalesce(v_distinct_sources, 0), v_trust_anchor, now()
  )
  on conflict (prospect_id) do update
  set is_eligible           = excluded.is_eligible,
      block_reason          = excluded.block_reason,
      distinct_source_count = excluded.distinct_source_count,
      has_trust_anchor      = excluded.has_trust_anchor,
      evaluated_at          = excluded.evaluated_at
  returning e.* into v_row;

  return v_row;
end;
$$;

comment on function public.refresh_prospect_publication_eligibility(uuid) is
  'Recomputes one prospect''s cached publication verdict from the live gate. The ONLY writer of prospect_publication_eligibility — the table has no INSERT/UPDATE/DELETE policy for any role, so a stale or forged verdict cannot be planted in front of the operator who approves publications. Callable by platform_owner/platform_admin and by the acquisition worker''s own connection.';

revoke execute on function public.refresh_prospect_publication_eligibility(uuid) from public, anon;
grant execute on function public.refresh_prospect_publication_eligibility(uuid) to authenticated, prospect_worker;

-- ---------------------------------------------------------------------------
-- 6. The Worker's sweep
--
-- Returns the ids it re-evaluated so the job can report a real count rather
-- than assuming its batch size was met. Bounded by the caller; there is no
-- unbounded "evaluate everything" entry point.
--
-- Ordering: prospects with no verdict yet first (nulls first on evaluated_at),
-- then least recently evaluated. A newly discovered prospect therefore gets an
-- answer before an old one gets a second opinion.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_prospect_publication_eligibility(p_limit integer default 100)
returns table (prospect_id uuid, is_eligible boolean, block_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.prospect_publication_eligibility;
begin
  if not (
    (select private.has_platform_role(
       array['platform_owner', 'platform_admin']::public.platform_role[]))
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform administrators or the acquisition worker can evaluate publication eligibility'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'limit must be between 1 and 1000' using errcode = '22023';
  end if;

  for v_id in
    select p.id
    from public.prospects p
    left join public.prospect_publication_eligibility e on e.prospect_id = p.id
    order by e.evaluated_at asc nulls first, p.first_discovered_at asc
    limit p_limit
  loop
    v_row := public.refresh_prospect_publication_eligibility(v_id);
    prospect_id := v_row.prospect_id;
    is_eligible := v_row.is_eligible;
    block_reason := v_row.block_reason;
    return next;
  end loop;
end;
$$;

comment on function public.sweep_prospect_publication_eligibility(integer) is
  'Re-evaluates a bounded batch of prospects, least recently evaluated first and never-evaluated first of all. Deliberately re-checks BLOCKED prospects too: a prospect blocked on unresolved_duplicate or insufficient_source_evidence becomes eligible when the duplicate is reviewed or a second source lands, and nothing else in the system would notice. Hard-capped at 1000 per call so a bad argument cannot turn into a table scan of function calls.';

revoke execute on function public.sweep_prospect_publication_eligibility(integer) from public, anon;
grant execute on function public.sweep_prospect_publication_eligibility(integer) to authenticated, prospect_worker;


-- ============================================================================
-- END db/migrations/20260828100000_prospect_publication_eligibility.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260828100100_external_profile_publication.sql
-- ============================================================================

-- FadeUp — R4: publication is an operator's decision, enforced structurally
--
-- R1B shipped create_external_professional and wrote, in its own report, that
-- the Worker call site belonged to R4. What it could not ship was the thing
-- that decides WHETHER to call it, so the RPC's only protection was that no
-- code had reached it yet.
--
-- This file closes that with two mechanisms that do different jobs:
--
--   1. A BEFORE INSERT TRIGGER on prospect_professionals that consults the LIVE
--      gate. This is the guarantee. It does not care who is inserting, through
--      which function, holding which role. create_external_professional, a
--      future R10 auto-publish lane, a platform administrator with a psql
--      session and a good reason — all three hit the same wall.
--
--   2. publish_external_professional(), the operator's front door. It re-checks
--      the gate first so the caller gets a NAMED reason instead of a trigger
--      exception, takes the decision under a lock, writes the audit trail and
--      refreshes the cache.
--
-- (2) without (1) is a suggestion. (1) without (2) is a wall with no door.
--
-- CONSTITUTION §5.5 — "This must be structurally difficult to violate, not
-- merely discouraged." R1B satisfied §5.5 for OPERATIONAL truth by not
-- modelling it: an external identity has no barbers row, so it has no
-- availability, no queue, no schedule. This file satisfies the other half —
-- that an identity is not minted at all until the evidence supports one —
-- and it does so with a trigger rather than a convention for the same reason.
--
-- WHY THE TRIGGER READS THE LIVE FUNCTION AND NOT THE CACHE
--
-- prospect_publication_eligibility is refreshed by a Worker sweep, so it is
-- always somewhat behind. A trigger that trusted it would mean "this prospect
-- was publishable at some point in the recent past", and the gap is exactly
-- where the dangerous cases live: a duplicate flagged five minutes ago, a
-- suppression added this morning. The cache serves the review list; the live
-- function serves the decision.
--
-- A NOTE ON THE COST THIS IMPOSES ON R1B'S VERIFY
--
-- VERIFY_R1B §7, §9 and §14 mint external identities from fixture prospects
-- that carry no source records, matching a world in which nothing gated
-- minting. Those fixtures now fail on insufficient_source_evidence, correctly.
-- R4 upgrades them to provision real provenance rather than exempting the
-- fixtures from the gate — the same move the Service Mode lot made when its
-- admission rules invalidated R1A's unentitled fixture. A test that has to
-- route around a guarantee is testing the wrong thing.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The wall
--
-- SECURITY DEFINER because the gate reads the whole acquisition schema —
-- suppressions, duplicates, source records, locations — and the trigger must
-- reach an identical verdict no matter which role's INSERT fired it. A verdict
-- that varied by caller would not be a guarantee.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_prospect_publication_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    -- Provenance is evidence (R1B's own words on the RESTRICT further down
    -- this table). Repointing a link would silently reattribute an identity to
    -- a business it was never discovered from, and would do it without ever
    -- passing the gate, since the gate only guards INSERT.
    if new.prospect_id is distinct from old.prospect_id
       or new.professional_id is distinct from old.professional_id then
      raise exception 'a prospect-to-identity link cannot be repointed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_reason := public.publication_block_reason(new.prospect_id);

  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501',
            hint = 'Resolve the blocking condition rather than bypassing the gate; see public.publication_block_reason.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_prospect_publication_gate() is
  'BEFORE INSERT OR UPDATE invariant on prospect_professionals, and the structural half of Constitution §5.5. Every path that could mint an external professional identity passes through this INSERT, so the gate cannot be bypassed by choosing a different function, a different role or a direct session — there is no role exemption, including for platform administrators and service_role. On UPDATE it freezes the link''s two endpoints, so provenance cannot be reattributed after the fact.';

drop trigger if exists prospect_professionals_enforce_publication_gate
  on public.prospect_professionals;
create trigger prospect_professionals_enforce_publication_gate
  before insert or update on public.prospect_professionals
  for each row execute function public.enforce_prospect_publication_gate();

-- ---------------------------------------------------------------------------
-- 2. The door
--
-- Platform administrators only. Deliberately NOT callable by the Worker:
-- R4's division of labour is that the machine evaluates evidence and a human
-- decides. The Worker has EXECUTE on create_external_professional from R1B
-- and keeps it — that grant is now harmless, because the gate stands behind
-- it either way — but nothing in the Worker calls it, and the operator UI is
-- the only publication path that exists.
-- ---------------------------------------------------------------------------

create or replace function public.publish_external_professional(
  p_prospect_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  -- Lock the PROSPECT, not the linkage row, because the linkage row is what we
  -- are about to create and therefore cannot be locked. Two administrators
  -- double-clicking Publish on the same candidate serialise here; the loser
  -- re-reads a gate that now says already_published and returns the winner's
  -- identity instead of a 23505 they would have to interpret.
  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    return v_existing;
  end if;

  -- Checked here so the operator gets the reason by name. The trigger would
  -- refuse the insert regardless; this is ergonomics on top of the guarantee,
  -- never in place of it.
  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  -- Constitution §4.4's discipline, applied to acquisition: a decision that
  -- creates a durable public-facing identity records who took it and when.
  -- The prospect's name is captured AS PUBLISHED, so a later rename of the
  -- prospect does not rewrite the history of what was approved.
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  -- Fold the verdict forward immediately so the review queue stops offering a
  -- candidate that has just been published, without waiting for the next
  -- Worker sweep.
  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  return v_professional_id;
end;
$$;

comment on function public.publish_external_professional(uuid, text) is
  'The operator''s front door for minting an external unclaimed professional identity, and the only publication path R4 ships. Platform administrators only, and deliberately NOT the Worker: the machine evaluates evidence, a human decides. Idempotent per prospect, serialised on the prospect row so a double-click cannot produce a second identity, audited to platform_audit_log with the name as published, and it refreshes the eligibility cache so the queue reflects the decision at once.';

revoke execute on function public.publish_external_professional(uuid, text) from public, anon;
grant execute on function public.publish_external_professional(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The review queue read contract
--
-- A view rather than "let the UI join four tables": the operator screen must
-- not be able to widen its own projection. prospects carries commercial
-- scoring, contact details and internal sales state, none of which belongs on
-- a screen whose only question is "is this a real business worth an identity".
--
-- security_invoker so the caller's platform-role policies still apply — the
-- view is a narrower projection, never an escalation.
-- ---------------------------------------------------------------------------

-- ---- A defect in R1B this view exposes, and the minimal correction ---------
--
-- R1B created a platform-staff SELECT policy on prospect_professionals and then
-- revoked ALL from authenticated, including SELECT. Postgres checks the grant
-- before it consults any policy, so that policy has never been reachable: every
-- platform administrator reading the table gets "permission denied" and the
-- policy never matches a single row. It is unreachable code, not extra safety.
--
-- R1B's stated intent is unambiguous — it wrote the policy, naming
-- platform_owner, platform_admin and platform_support — and its comment's
-- concern was that ORDINARY accounts must not be able to ask "was I scraped,
-- and how confident was FadeUp". That concern is served by the policy, which is
-- unchanged here. What R4 adds is the grant that lets the policy run at all,
-- narrowed to the three columns the operator queue needs: no match_confidence,
-- no matching_rule, so the acquisition pipeline's assessment of a business
-- stays out of reach even for staff reading through this path.
--
-- Recorded as a correction to a closed lot rather than done quietly, because
-- that is what it is.
grant select (prospect_id, professional_id, created_at)
  on public.prospect_professionals to authenticated;

create or replace view public.prospect_publication_queue
with (security_invoker = true) as
select
  p.id                        as prospect_id,
  p.canonical_name,
  p.country,
  p.entity_kind,
  p.type                      as prospect_type,
  p.website_domain,
  p.first_discovered_at,
  e.is_eligible,
  e.block_reason,
  e.distinct_source_count,
  e.has_trust_anchor,
  e.evaluated_at,
  pp.professional_id,
  (pp.professional_id is not null) as is_published
from public.prospects p
join public.prospect_publication_eligibility e on e.prospect_id = p.id
left join public.prospect_professionals pp on pp.prospect_id = p.id;

comment on view public.prospect_publication_queue is
  'The operator review queue for external-profile publication. A deliberately NARROW projection of prospects: name, country, kind, domain and the gate''s own evidence — and none of the commercial score, contact details or sales pipeline state that live on the same row, because the publication decision is about whether a business is real, not whether it is a good lead. security_invoker, so platform-role RLS on the underlying tables still decides who sees anything.';

revoke all on public.prospect_publication_queue from anon, authenticated;
grant select on public.prospect_publication_queue to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Worker's new job type
--
-- publication_evaluation refreshes the cache for a bounded batch. It is the
-- Worker's entire involvement in publication: it decides nothing, it only keeps
-- the operator's queue current — including for prospects that are currently
-- BLOCKED, because a duplicate being resolved or a second source landing is
-- exactly what turns a blocked prospect into a candidate, and nothing else in
-- the system would notice.
--
-- The constraint is rewritten in full rather than patched, because a CHECK
-- cannot be extended in place. Every pre-existing value is carried forward
-- verbatim; the only difference is the last entry.
-- ---------------------------------------------------------------------------

alter table public.prospect_jobs drop constraint if exists prospect_jobs_job_type_check;
alter table public.prospect_jobs add constraint prospect_jobs_job_type_check
  check (job_type = any (array[
    'discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl',
    'instagram_enrich', 'search_plan', 'identity_resolution',
    'competitor_detection', 'website_enrichment', 'feature_computation',
    'fit_scoring', 'segmentation', 'locale_resolution', 'data_quality',
    'ml_prediction', 'outreach_preparation', 'whatsapp_send',
    'outcome_processing',
    'publication_evaluation'
  ]::text[]));


-- ============================================================================
-- END db/migrations/20260828100100_external_profile_publication.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260828100200_acquisition_analytics_events.sql
-- ============================================================================

-- FadeUp — R4: the head of the acquisition funnel becomes measurable
--
-- R3 wrote two event contracts and deliberately refused to wire them:
--
--   prospect_discovered | "Worker V2 is R4/R10; the brief forbids starting it"
--   prospect_enriched   | idem
--
-- A `deferred` definition cannot produce a single row — private.emit_analytics_
-- event refuses any name that is absent from the registry or marked deferred —
-- so until this file the funnel R3 documented in its §9 started three stages in,
-- at external_profile_created. It could report how many identities FadeUp
-- published; it could not report how many businesses had to be found to publish
-- them, which is the only number that says whether discovery is working.
--
-- WHY THE WORKER STILL GETS NO ANALYTICS GRANT
--
-- The obvious implementation is to let the Worker call the emitter. R3 §11.3
-- explicitly declined to grant it: "a scraping worker is the highest-risk
-- credential in the system", and R1A had already removed a broader grant from
-- that role for the same reason. That reasoning has not changed, so R4 does not
-- change the grant.
--
-- Instead both events are emitted by AFTER triggers on tables the Worker
-- already writes. The Worker gets its events by doing its job, not by holding a
-- capability. This is also the pattern R3 chose for all thirteen of its own
-- instrumentation triggers, and for the same second reason: there are several
-- code paths that create a prospect, and instrumenting the handlers would have
-- left the others silent.
--
-- WHERE EACH TRIGGER HANGS, AND WHY IT IS NOT THE OBVIOUS TABLE
--
--   prospect_discovered hangs on prospect_source_records, NOT on prospects.
--
--   A prospect row is inserted BEFORE its provenance row: the Worker resolves
--   identity, inserts or links the canonical prospect, and only then records
--   which source saw it. A trigger on prospects would therefore fire at the one
--   moment when the answer to "which channel found this business" does not
--   exist yet, and would attribute every discovery to NULL. Hanging on the
--   provenance row instead, keyed idempotently on the prospect, means the event
--   is written the instant the attribution is knowable — and multi-source
--   discovery still yields exactly one event, because the dedupe key is the
--   prospect.
--
--   This is the same decision R3 made for external_profile_created, which hangs
--   on prospect_professionals rather than professionals, for the same reason.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The vocabulary moves from documented to wired
--
-- Updated rather than inserted: R3 already wrote both contracts, including
-- their idempotency discipline, and rewriting the description here would
-- discard the reasoning it recorded. Only `status` changes, and only forward.
--
-- The description is appended to rather than replaced, so the row keeps saying
-- why it was deferred as well as when it stopped being.
-- ---------------------------------------------------------------------------

update public.analytics_event_definitions
set status = 'wired',
    description = 'A canonical prospect was observed for the first time by any source. Idempotent per prospect: multi-source discovery yields one event, attributed FIRST-touch. Emitted from prospect_source_records, not prospects, because provenance is written after the prospect row and a trigger on prospects would attribute every discovery to NULL. Wired by R4.'
where event_name = 'prospect_discovered'
  and status = 'deferred';

update public.analytics_event_definitions
set status = 'wired',
    description = 'An enrichment pass completed against an existing prospect. Deliberately NOT idempotent: a prospect is legitimately re-enriched as sources are re-crawled, and each pass is a real event. Keyed on the enrichment timestamp so a single pass cannot be double-counted while genuine re-enrichment still counts. Wired by R4.'
where event_name = 'prospect_enriched'
  and status = 'deferred';

-- ---------------------------------------------------------------------------
-- 2. prospect_discovered
--
-- actor_type 'worker' and origin 'worker': there is no human in this
-- transaction and no session. R3's actor-coherence CHECK permits a null
-- actor_user_id for exactly the worker and system actor types.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_prospect_discovered_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect public.prospects;
  v_source text;
  v_first_record_id uuid;
  v_first_source text;
begin
  -- A provenance row without a prospect is a raw observation that identity
  -- resolution has not yet attached to anything. It has discovered no business
  -- and must not count as a discovery.
  if new.prospect_id is null then
    return null;
  end if;

  select * into v_prospect from public.prospects where id = new.prospect_id;
  if not found then
    return null;
  end if;

  select ps.key into v_source
  from public.prospect_sources ps
  where ps.id = new.source_id;

  -- FIRST-touch attribution, matching R3 §9. The question acquisition asks is
  -- which channel found a business nobody had; a later re-observation by a
  -- second source found nothing. In the overwhelmingly common case this IS the
  -- row that just fired the trigger, but ordering by created_at rather than
  -- assuming that keeps the answer correct when a backfill or a concurrent
  -- second source lands first.
  select psr.id, ps.key
    into v_first_record_id, v_first_source
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.prospect_id
  order by psr.created_at, psr.id
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'prospect_discovered',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_prospect_id                  => new.prospect_id,
    p_acquisition_source           => coalesce(v_first_source, v_source),
    p_acquisition_source_record_id => coalesce(v_first_record_id, new.id),
    p_properties                   => jsonb_build_object(
                                        'country', v_prospect.country,
                                        'entity_kind', v_prospect.entity_kind,
                                        'prospect_type', v_prospect.type,
                                        'observing_source', v_source),
    -- The prospect's own discovery time, not the provenance row's. A source
    -- record written by a later backfill describes a business that was found
    -- when it was found.
    p_occurred_at                  => v_prospect.first_discovered_at,
    p_dedupe_key                   => 'prospect:' || new.prospect_id::text || ':discovered'
  );

  return null;
end;
$$;

comment on function public.analytics_prospect_discovered_event() is
  'Emits prospect_discovered once per canonical prospect, from prospect_source_records rather than prospects — the prospect row is inserted before its provenance, so a trigger on prospects would attribute every discovery to NULL. The dedupe key is the prospect, so a business found by four sources produces four provenance rows and exactly one discovery. Attribution is first-touch. A provenance row not yet attached to a prospect is a raw observation and deliberately counts as nothing.';

drop trigger if exists prospect_source_records_analytics on public.prospect_source_records;
create trigger prospect_source_records_analytics
  after insert on public.prospect_source_records
  for each row execute function public.analytics_prospect_discovered_event();

-- ---------------------------------------------------------------------------
-- 3. prospect_enriched
--
-- Hung on the UPDATE OF last_enriched_at, which is the Worker's own record
-- that an enrichment pass completed — the column already exists and the
-- website-enrichment handler already writes it. Nothing new has to be trusted.
--
-- NOT idempotent, per R3's contract: re-enrichment is legitimate and each pass
-- is a real event. The key is therefore transition-scoped rather than permanent
-- — it collapses a double-fire on one timestamp, and lets tomorrow's pass count.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_prospect_enriched_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_record_id uuid;
begin
  -- Only a real advance counts. An UPDATE that rewrites the same timestamp, or
  -- clears it, is not an enrichment pass.
  if new.last_enriched_at is null
     or new.last_enriched_at is not distinct from old.last_enriched_at then
    return null;
  end if;

  select ps.key, psr.id
    into v_source, v_record_id
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.id
  order by psr.created_at, psr.id
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'prospect_enriched',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_prospect_id                  => new.id,
    p_acquisition_source           => v_source,
    p_acquisition_source_record_id => v_record_id,
    -- What the pass actually established, as booleans about presence. No
    -- values: R3 §10.1 refuses payload keys containing email, phone, address
    -- and the rest, and it is right to — an enrichment event does not need the
    -- number to record that a number was found.
    p_properties                   => jsonb_build_object(
                                        'gained_website', (old.website_domain is null and new.website_domain is not null),
                                        'gained_contact', ((old.email is null and new.email is not null)
                                                        or (old.phone_e164 is null and new.phone_e164 is not null)),
                                        'first_enrichment', (old.last_enriched_at is null)),
    p_occurred_at                  => new.last_enriched_at,
    p_dedupe_key                   => 'prospect:' || new.id::text || ':enriched:'
                                      || extract(epoch from new.last_enriched_at)::text
  );

  return null;
end;
$$;

comment on function public.analytics_prospect_enriched_event() is
  'Emits prospect_enriched when an enrichment pass advances prospects.last_enriched_at — the column the Worker''s website-enrichment handler already writes, so nothing new has to be trusted. Deliberately not idempotent per R3''s contract: re-enrichment is legitimate, so the key is scoped to the enrichment timestamp rather than to the prospect. Properties are booleans about what the pass established, never the values it found, because R3 §10.1 refuses contact data in payloads and an enrichment count does not need the phone number to record that one was found.';

drop trigger if exists prospects_enrichment_analytics on public.prospects;
create trigger prospects_enrichment_analytics
  after update of last_enriched_at on public.prospects
  for each row execute function public.analytics_prospect_enriched_event();

-- ---------------------------------------------------------------------------
-- 4. The funnel gains its head
--
-- DROP then CREATE, not CREATE OR REPLACE: adding columns changes the return
-- type, which Postgres refuses to replace in place. The body is otherwise
-- R3's, unchanged — including the count(distinct professional_id) that makes
-- §9 hold at read time, which is deliberately copied forward rather than
-- rewritten.
--
-- prospects_discovered counts DISTINCT prospect_id for the same reason
-- converted_professionals counts distinct identities: the emitter's guarantee
-- is restated at read time so a future change to either one cannot silently
-- inflate the funnel from the other end.
-- ---------------------------------------------------------------------------

drop function if exists public.get_platform_analytics_funnel(timestamptz, timestamptz);

create function public.get_platform_analytics_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,

  prospects_discovered bigint,
  prospects_enriched bigint,
  external_profiles_created bigint,
  claims_submitted bigint,
  claims_approved bigint,
  claims_rejected bigint,
  converted_professionals bigint,

  organizations_with_activity bigint,
  appointments_created bigint,
  appointments_completed bigint,
  queue_joins bigint,
  queue_completions bigint,
  passports_issued bigint,
  plans_assigned bigint,
  plans_changed bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'platform analytics are restricted to FadeUp platform staff'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
  )
  select
    v_from,
    v_to,

    -- DISTINCT prospects, never a count of discovery events. The emitter's
    -- dedupe key already guarantees one per prospect; restating it here means
    -- neither end can inflate the funnel alone.
    count(distinct s.prospect_id) filter (
      where s.event_name = 'prospect_discovered' and s.prospect_id is not null),
    -- Enrichment PASSES, not distinct prospects: re-enrichment is the point of
    -- the metric, and collapsing it would report a re-crawled table as idle.
    count(*) filter (where s.event_name = 'prospect_enriched'),

    count(*) filter (where s.event_name = 'external_profile_created'),
    count(*) filter (where s.event_name = 'claim_submitted'),
    count(*) filter (where s.event_name = 'claim_approved'),
    count(*) filter (where s.event_name = 'claim_rejected'),
    -- DISTINCT identities, never a count of approval events. §9.
    count(distinct s.professional_id) filter (
      where s.event_name = 'claim_approved' and s.professional_id is not null),

    count(distinct s.organization_id) filter (where s.organization_id is not null),
    count(*) filter (where s.event_name = 'appointment_created'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'queue_joined'),
    count(*) filter (where s.event_name = 'queue_completed'),
    count(*) filter (where s.event_name = 'passport_issued'),
    count(*) filter (where s.event_name = 'plan_assigned'),
    count(*) filter (where s.event_name = 'plan_changed')
  from scoped s;
end;
$$;

comment on function public.get_platform_analytics_funnel(timestamptz, timestamptz) is
  'FadeUp''s own acquisition/claim funnel and platform product totals, over a bounded window. Platform admin only, and the only read contract that crosses tenants. R4 added the two head-of-funnel stages R3 had to leave deferred, so the funnel now runs discovery -> enrichment -> external profile -> claim -> approval -> conversion end to end. prospects_discovered and converted_professionals count DISTINCT subjects rather than events, so neither the emitter nor the reader can inflate the funnel alone; prospects_enriched deliberately counts passes, because re-enrichment is what the metric is for.';

revoke execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  to authenticated;


-- ============================================================================
-- END db/migrations/20260828100200_acquisition_analytics_events.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260828100300_r4_privilege_hardening.sql
-- ============================================================================

-- FadeUp — R4: privilege hardening, and the assertions that keep it true
--
-- THE DEFAULT THIS FILE EXISTS TO UNDO
--
-- Postgres grants EXECUTE to PUBLIC on every newly created function, and anon
-- and authenticated inherit from PUBLIC. Every function the three preceding R4
-- migrations created is therefore a callable endpoint until revoked — including
-- two trigger functions and the gate itself.
--
-- R3's own hardening sweeps functions named `analytics\_%` in `public`, which
-- would have caught R4's two new instrumentation triggers — except that
-- migrations replay in filename order, so R3's sweep runs before R4's functions
-- exist. A later lot inheriting an earlier lot's sweep is not a mechanism; each
-- lot hardens what it creates.
--
-- A SECOND, R4-SPECIFIC REASON THIS MATTERS
--
-- publication_block_reason is STABLE, SECURITY DEFINER, takes a prospect id and
-- returns a short string. Left callable by anon it is an oracle: a stranger
-- could enumerate prospect ids and learn from the reply whether FadeUp holds a
-- record of a given business, whether that business is suppressed, and whether
-- it has already converted to a paying customer. The function is genuinely
-- needed by platform staff and by the Worker, so the fix is the grant list, not
-- the function.
--
-- WHAT IS DELIBERATELY LEFT CALLABLE
--
--   publication_block_reason                   authenticated + prospect_worker
--   refresh_prospect_publication_eligibility   authenticated + prospect_worker
--   sweep_prospect_publication_eligibility     authenticated + prospect_worker
--   publish_external_professional              authenticated
--
-- Each authorizes its own caller in its body — platform-role checks for the
-- staff arm, the session_user + null-auth.uid() pair R1B established for the
-- worker arm. The grant admits a role to the function; the function decides
-- what that role may actually do. Nothing here is callable by anon.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Revoke PUBLIC execute on everything R4 created in `public`
--
-- Driven off the catalogue rather than a hand-maintained list, so a function
-- added by a later R4 fix cannot be forgotten here.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
  v_revoked integer := 0;
begin
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'publication_block_reason',
        'refresh_prospect_publication_eligibility',
        'sweep_prospect_publication_eligibility',
        'enforce_prospect_publication_gate',
        'publish_external_professional',
        'analytics_prospect_discovered_event',
        'analytics_prospect_enriched_event'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.signature);
    v_revoked := v_revoked + 1;
  end loop;

  raise notice 'R4 hardening: execute revoked from PUBLIC on % functions', v_revoked;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-grant exactly the four that are genuinely contracts
--
-- By name and by full signature, so adding a fifth is a decision somebody has
-- to write down rather than a pattern that silently widens.
-- ---------------------------------------------------------------------------

grant execute on function public.publication_block_reason(uuid)
  to authenticated, prospect_worker;
grant execute on function public.refresh_prospect_publication_eligibility(uuid)
  to authenticated, prospect_worker;
grant execute on function public.sweep_prospect_publication_eligibility(integer)
  to authenticated, prospect_worker;
grant execute on function public.publish_external_professional(uuid, text)
  to authenticated;

-- The two instrumentation triggers are re-granted to NOBODY. They are reached
-- by the trigger machinery, which does not consult EXECUTE privilege at all.

-- ---------------------------------------------------------------------------
-- 3. Re-assert the table posture
--
-- Stated here as well as in 20260828100000 so this file alone is enough to
-- restore the posture, and so a stray grant issued between the two is
-- corrected on every replay.
--
-- prospect_worker keeps SELECT and nothing else: it needs to know a verdict in
-- order to decide what to re-evaluate, and it writes exclusively through the
-- refresh RPC.
-- ---------------------------------------------------------------------------

revoke all on table public.prospect_publication_eligibility from public, anon, authenticated;
-- SELECT is re-granted to authenticated because the platform-staff policy needs
-- a grant to be reachable at all; 4.4 below asserts no WRITE came back with it,
-- and the policy is what restricts the rows to platform roles.
grant select on table public.prospect_publication_eligibility to authenticated;
grant select on table public.prospect_publication_eligibility to prospect_worker;

-- The Worker is deliberately not admitted to the publication decision. It has
-- SELECT on the queue's inputs through its existing grants; it has no path to
-- the operator's front door.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    execute 'revoke all on function public.publish_external_professional(uuid, text) from prospect_worker';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE ASSERTIONS
--
-- Everything above can be undone by one careless grant in a later migration.
-- These run inside this transaction and refuse to commit if the posture is
-- wrong, so the failure surfaces at deploy time rather than in an audit.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text;
begin
  -- 4.1 anon reaches nothing R4 created. The oracle argument above is the
  -- specific reason, and it applies to every one of these signatures.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'publication_block_reason',
      'refresh_prospect_publication_eligibility',
      'sweep_prospect_publication_eligibility',
      'enforce_prospect_publication_gate',
      'publish_external_professional',
      'analytics_prospect_discovered_event',
      'analytics_prospect_enriched_event'
    )
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'R4 hardening: anon can execute %', v_bad;
  end if;

  -- 4.2 The two trigger functions are callable by no client role at all.
  -- Calling one directly fails with "trigger functions can only be called as
  -- triggers", but "it happens to fail for an unrelated reason" is not an
  -- access control.
  select string_agg(format('%s to %s', p.oid::regprocedure, r), ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon', 'authenticated']) as r
  where n.nspname = 'public'
    and p.proname in (
      'enforce_prospect_publication_gate',
      'analytics_prospect_discovered_event',
      'analytics_prospect_enriched_event'
    )
    and has_function_privilege(r, p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'R4 hardening: a trigger function is client-callable: %', v_bad;
  end if;

  -- 4.3 The Worker cannot publish. This is R4's division of labour expressed
  -- as a privilege rather than as a convention: the machine evaluates, a human
  -- decides. If a later lot wants an auto-publish lane it has to remove this
  -- assertion, which is exactly the amount of friction that decision deserves.
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    if has_function_privilege('prospect_worker',
         'public.publish_external_professional(uuid, text)', 'EXECUTE') then
      raise exception 'R4 hardening: prospect_worker can execute publish_external_professional';
    end if;
  end if;

  -- 4.4 No client role holds a direct write on the eligibility cache. A forged
  -- `is_eligible = true` would not permit a publication — the gate re-checks
  -- live — but it would put a lie in front of the administrator who approves
  -- one, and their judgement is the control this lot rests on.
  select string_agg(format('%s:%s', r, pr), ', ')
    into v_bad
  from unnest(array['anon', 'authenticated']) as r
  cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as pr
  where has_table_privilege(r, 'public.prospect_publication_eligibility', pr);

  if v_bad is not null then
    raise exception 'R4 hardening: a client role can write prospect_publication_eligibility (%)', v_bad;
  end if;

  -- anon must not even READ it. authenticated may, because a policy without a
  -- grant is unreachable — the row filtering is the policy's job, and 4.4 above
  -- has just proven the grant carries no write.
  if has_table_privilege('anon', 'public.prospect_publication_eligibility', 'SELECT') then
    raise exception 'R4 hardening: anon can read prospect_publication_eligibility';
  end if;

  if not has_table_privilege('authenticated', 'public.prospect_publication_eligibility', 'SELECT') then
    raise exception 'R4 hardening: the platform-staff SELECT policy is unreachable without a grant';
  end if;

  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    select string_agg(pr, ', ')
      into v_bad
    from unnest(array['INSERT', 'UPDATE', 'DELETE']) as pr
    where has_table_privilege('prospect_worker', 'public.prospect_publication_eligibility', pr);

    if v_bad is not null then
      raise exception 'R4 hardening: prospect_worker can write prospect_publication_eligibility directly (%)', v_bad;
    end if;
  end if;

  -- 4.5 RLS is enabled AND forced on the cache. Enabled-but-not-forced would
  -- exempt the table owner, and the refresh function runs as the owner.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'prospect_publication_eligibility'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'R4 hardening: RLS is not enabled and forced on prospect_publication_eligibility';
  end if;

  -- 4.6 Every R4 function pins its search_path — deliberately NOT filtered to
  -- SECURITY DEFINER, matching R1B's and R3's recorded reasoning: an
  -- unqualified name resolves through the CALLER's search_path either way, so
  -- a caller could create their own `prospects` in a schema they control and
  -- have the gate read there instead.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'publication_block_reason',
      'refresh_prospect_publication_eligibility',
      'sweep_prospect_publication_eligibility',
      'enforce_prospect_publication_gate',
      'publish_external_professional',
      'analytics_prospect_discovered_event',
      'analytics_prospect_enriched_event'
    )
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg like 'search_path=%'
    );

  if v_bad is not null then
    raise exception 'R4 hardening: function without a pinned search_path: %', v_bad;
  end if;

  -- 4.7 The gate is actually installed. Every guarantee in this lot rests on
  -- one trigger existing; a migration that dropped and recreated
  -- prospect_professionals without it would silently reopen the whole surface.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'prospect_professionals'
      and t.tgname = 'prospect_professionals_enforce_publication_gate'
      and not t.tgisinternal
  ) then
    raise exception 'R4 hardening: the publication gate trigger is missing from prospect_professionals';
  end if;

  -- 4.8 Both acquisition event contracts are wired. A `deferred` row cannot
  -- emit, so a taxonomy that silently reverted would leave the funnel's head
  -- empty and reporting zero rather than failing.
  if exists (
    select 1 from public.analytics_event_definitions
    where event_name in ('prospect_discovered', 'prospect_enriched')
      and status <> 'wired'
  ) then
    raise exception 'R4 hardening: an acquisition event contract is not wired';
  end if;

  raise notice 'R4 hardening: all assertions passed';
end $$;


-- ============================================================================
-- END db/migrations/20260828100300_r4_privilege_hardening.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next steps: run
--   supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--   supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--   supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--   supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- and confirm 0 FAIL rows in all seven.
-- ============================================================================
