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
