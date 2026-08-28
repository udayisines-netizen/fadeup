-- ============================================================================
-- FadeUp — MASTER: R4.1, Planity booking status and source independence
-- Generated 2026-08-28. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r4-1.sh
-- Verify in sync:   scripts/generate-master-r4-1.sh --check
--
-- WHAT THIS IS
--
--   Two changes, and the second matters more than the first.
--
--   1. BOOKING STATUS. booking_provider_observations gains `booking_status`
--      (ACTIVE / LISTED_ONLY / UNKNOWN) and the detection-method enum gains
--      `provider_public_page`. Until now every provider detection came from
--      the BUSINESS's own website, where the only observable fact is "this
--      site links to Planity". Reading the provider's own public page makes a
--      second, different fact observable: whether the listing is actually
--      bookable. UNKNOWN is the default and every existing row keeps it,
--      because a link cannot know.
--
--   2. SOURCE INDEPENDENCE. public.publication_block_reason requires "two
--      independent sources, or one verified registry", and implemented that as
--      count(distinct source_id) — which assumes every source row is an
--      independent observer. That assumption has been false since the
--      acquisition schema shipped: Geoapify's places data is substantially
--      derived from OpenStreetMap, so a prospect seen by OSM and by Geoapify
--      has been seen ONCE and reported twice, and under the old rule that
--      cleared the evidence bar and minted a durable public identity.
--
--      prospect_sources gains `independence_group`. Sources sharing a group
--      count once. A source with no group is its own group, so every existing
--      source keeps its current meaning unless explicitly grouped.
--
--   THIS LOT REQUIRES R4. It replaces publication_block_reason, which R4
--   created, and every other branch of that function is carried forward
--   verbatim — diffing the two should show exactly one changed clause.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. THIS TIGHTENS THE PUBLICATION GATE, ON PURPOSE.
--      A prospect known only from OSM + Geoapify was eligible before this file
--      and is refused after it with `insufficient_source_evidence`. That was
--      the correct answer both times; the gate simply could not express it.
--      Expect the "Ready to publish" queue to shrink. A third, independent
--      source — Google Places, Sirene, the business's own website — restores
--      eligibility, because the rule counts observers rather than blacklisting
--      a provider.
--
--   B. STALE ELIGIBLE VERDICTS ARE DELETED, NOT RECOMPUTED.
--      Every cached ELIGIBLE verdict predating this file may now be wrong in
--      the dangerous direction. The live gate would still refuse the
--      publication, so nothing unsafe can happen — but an operator would be
--      looking at a candidate that cannot be published, which is exactly the
--      "the operator is lied to" failure R4 built the cache discipline around.
--      The rows are deleted; the Worker's publication_evaluation sweep prefers
--      never-evaluated prospects, so they are re-derived on the next pass and
--      the queue is briefly EMPTY instead of briefly WRONG.
--
--      This is the only DML against existing data in the file, and it touches
--      a cache, never a fact.
--
--   C. PLANITY IS REGISTERED AS A SOURCE BUT CANNOT PUBLISH ANYTHING.
--      It is not an identity trust anchor, it has its own independence group,
--      and the enrichment job writes no prospect_source_records at all — the
--      page is reached by following a link the business published about
--      itself, so it is the same evidence chain as `website`, one hop longer.
--      The source row exists so the quota guard and api_source_health work.
--
--   D. NOTHING IS BACKFILLED AND NOTHING IS FETCHED.
--      Applying this file makes no network request and evaluates no prospect.
--      Every existing observation keeps booking_status = 'UNKNOWN' until a
--      planity_enrichment job actually reads a page.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No discovery, no search, no URL enumeration, no bulk crawl. No new table.
--   No change to the R4 publication gate's other ten reasons, its trigger, its
--   grants or its privilege posture. No outreach. No scoring rule.
--
-- SAFETY
--   * Runs inside a single transaction.
--   * Creates no table, removes no table, removes no column, truncates nothing.
--   * The only DELETE targets prospect_publication_eligibility, a cache.
--   * Mints no professional identity and writes no prospect_professionals row.
--   * Adds no anon grant and no anon policy.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
--
--   Then run, and confirm zero FAIL rows in each:
--     supabase/VERIFY_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
--     supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--     supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260828110000_planity_booking_status_and_source_independence.sql
-- ============================================================================

-- FadeUp — R4.1: booking status, and what "independent source" actually means
--
-- Two changes, and the second is the more important one.
--
-- 1. BOOKING STATUS
--
-- booking_provider_observations records WHICH provider was detected and HOW.
-- It has never recorded whether the business can actually be booked through
-- that provider, because until now every detection came from the business's
-- own website — where the only observable fact is "this site links to Planity".
--
-- Reading a provider's own public establishment page makes a second, different
-- fact observable: whether the listing is actually bookable. Those are not the
-- same claim, and collapsing them would be the familiar error:
--
--   listed on Planity, no bookable service  ->  they are a Planity customer
--                                               who cannot take bookings
--   listed on Planity, services bookable    ->  they are a Planity customer
--                                               actively taking bookings
--
-- The second is a migration target. The first is a different sales
-- conversation entirely, and possibly a lapsed account. A campaign that
-- confused them would be embarrassing in one direction and useless in the
-- other.
--
-- UNKNOWN is the default and is NOT a soft "probably not". It means the page
-- was not read, or was read and could not be classified — the same discipline
-- the competitor subsystem already applies to NO_BOOKING vs UNKNOWN.
--
-- 2. SOURCE INDEPENDENCE
--
-- public.publication_block_reason requires "two independent sources, or one
-- verified registry". It implements that as count(distinct source_id), which
-- assumes every source row is an independent observer. That assumption is
-- false and has been since the acquisition schema shipped:
--
--   * Geoapify's places data is substantially derived from OpenStreetMap. A
--     prospect seen by OSM and by Geoapify has been seen ONCE, by OSM, and
--     reported twice. Under the current rule that clears the evidence bar and
--     mints a durable public identity.
--
--   * The same shape appears the moment a provider page is read: a Planity
--     page found BY following a link on the business's own website is not
--     independent of that website. It is the same evidence chain, one hop
--     longer.
--
-- The fix is to make independence a property of the source rather than an
-- assumption about the table. `independence_group` names the underlying
-- observer; sources sharing a group count once. A source with no group is its
-- own group, so every existing source keeps its current meaning unless
-- explicitly grouped.
--
-- This TIGHTENS the gate. A prospect that was eligible on OSM+Geoapify alone
-- becomes blocked on insufficient_source_evidence, which is the correct
-- answer and was the correct answer before this file too — the gate was simply
-- unable to express it.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Booking status
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_availability_status') then
    create type public.booking_availability_status as enum ('ACTIVE', 'LISTED_ONLY', 'UNKNOWN');
  end if;
end $$;

comment on type public.booking_availability_status is
  'Whether a business can actually be booked through the detected provider. ACTIVE: the provider''s own public page offers at least one bookable service. LISTED_ONLY: the page exists and reliably indicates nothing is bookable online. UNKNOWN: not observed, or observed and not classifiable — never a soft "probably not".';

-- A detection method for "we read the provider's own public establishment
-- page". The existing values all describe evidence found on the BUSINESS's
-- site; reusing one of them would misdescribe where the evidence came from,
-- and provenance that lies is worse than provenance that is missing.
--
-- Deliberately NOT `provider_directory`, which the competitor documentation
-- reserves for a compliant provider API and records as "none enabled". Reading
-- one robots-allowed public page is a weaker and different thing.
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'booking_provider_detection_method' and e.enumlabel = 'provider_public_page'
  ) then
    alter type public.booking_provider_detection_method add value 'provider_public_page';
  end if;
end $$;

alter table public.booking_provider_observations
  add column if not exists booking_status public.booking_availability_status not null default 'UNKNOWN';

comment on column public.booking_provider_observations.booking_status is
  'Set only by an observation that actually read the provider''s public establishment page. A detection made from the business''s own website leaves this UNKNOWN, because a link to Planity is evidence of a relationship and says nothing about whether bookings are open.';

-- The segmentation query this exists to serve: "Planity businesses with online
-- booking active". Partial on is_current because nobody segments on retired
-- history, and that keeps the index small as observations accumulate.
create index if not exists booking_provider_observations_status_idx
  on public.booking_provider_observations (provider_id, booking_status)
  where is_current;

-- ---------------------------------------------------------------------------
-- 2. Source independence
--
-- Nullable and unset for every existing source EXCEPT the one pair that is
-- demonstrably not independent. Making this NOT NULL with a default of the
-- source key would be tidier and would also silently assert that somebody has
-- assessed every source, which nobody has.
-- ---------------------------------------------------------------------------

alter table public.prospect_sources
  add column if not exists independence_group text;

comment on column public.prospect_sources.independence_group is
  'Names the UNDERLYING observer this source reports. Sources sharing a group are not independent of one another and count ONCE toward publication evidence. NULL means the source is its own independent observer — the default, and deliberately not auto-filled, because "nobody has assessed this" and "assessed as independent" must stay distinguishable.';

-- Geoapify's places corpus is substantially OpenStreetMap. Two reports, one
-- observer. Grouping them is not a judgement about Geoapify's quality; it is a
-- statement about what a second report from it does and does not prove.
update public.prospect_sources
set independence_group = 'openstreetmap'
where key in ('osm', 'geoapify')
  and independence_group is distinct from 'openstreetmap';

-- ---------------------------------------------------------------------------
-- 3. Planity as a source of its own
--
-- Registered so provenance for evidence read from a Planity page is
-- attributable to Planity rather than smuggled in under `website`. Seeded
-- ENABLED because, unlike competitor_directory, this performs no discovery: it
-- reads one public page for a prospect FadeUp already has, and only when a
-- Planity URL was already discovered by other means.
--
-- Its independence group is `planity`, so two Planity observations of the same
-- business — say a link found on their website and the page itself — count
-- once. That is requirement M: a hint and the page it points at are one
-- evidence chain, not two.
-- ---------------------------------------------------------------------------

insert into public.prospect_sources (key, display_name, is_enabled, config)
values ('planity', 'Planity (public establishment pages)', true,
        jsonb_build_object(
          'note', 'Reads only public establishment pages already discovered through a first-party link. Performs no enumeration, honours robots.txt, and degrades rather than evading on 403/429.'))
on conflict (key) do nothing;

update public.prospect_sources
set independence_group = 'planity'
where key = 'planity' and independence_group is distinct from 'planity';

-- Planity is NOT an identity trust anchor. It is a commercial platform listing,
-- not a business registry: a Planity page proves a business markets itself
-- there, not that it legally exists. Only Sirene carries that.
update public.prospect_sources
set is_identity_trust_anchor = false
where key = 'planity' and is_identity_trust_anchor;

-- A budget and a health row, without which the source is UNUSABLE.
--
-- private.is_prospect_source_paused INNER JOINS api_source_health, so a source
-- with no health row yields NULL, and the Worker's quota helper turns NULL into
-- `true` — paused. That is the correct fail-closed default and it is also why
-- registering a source in prospect_sources alone is not enough: the first
-- planity_enrichment run against live selected its candidate and then skipped
-- it with "source paused", having made no request at all.
--
-- 300/day is deliberately low. This job reads ONE page per prospect and only
-- for prospects that already link to Planity; there is no volume target to
-- trade against, and a low ceiling means a runaway loop stops on its own rather
-- than being noticed later. Raise it in /platform, not here.
insert into public.api_source_limits (source_id, max_requests_per_minute, max_requests_per_day, max_requests_per_month)
select id, 20, 300, 5000 from public.prospect_sources where key = 'planity'
on conflict (source_id) do nothing;

insert into public.api_source_health (source_id)
select id from public.prospect_sources where key = 'planity'
on conflict (source_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The gate learns to count observers instead of rows
--
-- The ONLY change to publication_block_reason is the evidence count. Every
-- other branch, and their order, is carried forward verbatim from
-- 20260828100000 — this is a correction to one clause, not a redesign, and
-- diffing the two should show exactly that.
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

  if v_prospect.converted_organization_id is not null then
    return 'already_converted';
  end if;

  if v_prospect.status in ('customer', 'trial') then
    return 'already_customer';
  end if;

  if v_prospect.entity_kind = 'group_parent' then
    return 'entity_kind_not_publishable';
  end if;

  if exists (
    select 1 from public.prospect_professionals where prospect_id = p_prospect_id
  ) then
    return 'already_published';
  end if;

  if char_length(btrim(v_prospect.canonical_name)) < 2
     or btrim(v_prospect.canonical_name) !~ '[[:alpha:]]{2}' then
    return 'name_not_publishable';
  end if;

  if exists (
    select 1 from public.prospect_duplicates
    where status = 'pending'
      and (prospect_id = p_prospect_id or duplicate_of_prospect_id = p_prospect_id)
  ) then
    return 'unresolved_duplicate';
  end if;

  -- THE ONE CHANGED CLAUSE.
  --
  -- Counts distinct INDEPENDENCE GROUPS, not distinct source rows. A source
  -- with no group is its own group, so this is identical to the previous
  -- behaviour for every ungrouped source and strictly stricter for grouped
  -- ones. coalesce on the key rather than the id because the key is stable and
  -- readable in an EXPLAIN.
  select count(distinct coalesce(ps.independence_group, ps.key)),
         bool_or(ps.is_identity_trust_anchor)
    into v_distinct_sources, v_trust_anchor
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = p_prospect_id;

  if coalesce(v_distinct_sources, 0) < 2 and not coalesce(v_trust_anchor, false) then
    return 'insufficient_source_evidence';
  end if;

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
  'The LIVE authority on whether a canonical prospect may be minted into an external professional identity. Returns the first blocking reason, or NULL when publishable. Strictly more conservative than outreach_block_reason because an identity is durable and claimable where a message is transient. R4.1 corrected its evidence clause to count distinct INDEPENDENCE GROUPS rather than distinct source rows: Geoapify redistributes OpenStreetMap, so OSM+Geoapify is one observer reporting twice, and a provider page reached by following a first-party link is the same evidence chain one hop longer. Enforced by a BEFORE INSERT trigger on prospect_professionals, so no caller can route around it.';

revoke execute on function public.publication_block_reason(uuid) from public, anon;
grant execute on function public.publication_block_reason(uuid) to authenticated, prospect_worker;

-- ---------------------------------------------------------------------------
-- 5. The cached verdict must be recomputed
--
-- The gate just got stricter, so every stored verdict predating this file may
-- now be wrong in the dangerous direction: a prospect cached as ELIGIBLE on
-- OSM+Geoapify would still be offered to an operator. The live gate would
-- refuse the publication, so nothing unsafe can happen — but the operator
-- would be looking at a candidate that cannot be published, which is exactly
-- the "the operator is lied to" failure R4 built the cache discipline around.
--
-- Rather than evaluate anything here (R4's MASTER asserts this file evaluates
-- nothing), the stale verdicts are DELETED. The Worker's publication_evaluation
-- sweep prefers never-evaluated prospects first, so they are re-derived on the
-- next pass and the queue is briefly empty instead of briefly wrong.
-- ---------------------------------------------------------------------------

delete from public.prospect_publication_eligibility
where is_eligible;

-- ---------------------------------------------------------------------------
-- 6. The Worker's job type
--
-- Rewritten in full because a CHECK cannot be extended in place. Every
-- pre-existing value is carried forward verbatim; the only difference is the
-- last entry.
-- ---------------------------------------------------------------------------

alter table public.prospect_jobs drop constraint if exists prospect_jobs_job_type_check;
alter table public.prospect_jobs add constraint prospect_jobs_job_type_check
  check (job_type = any (array[
    'discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl',
    'instagram_enrich', 'search_plan', 'identity_resolution',
    'competitor_detection', 'website_enrichment', 'feature_computation',
    'fit_scoring', 'segmentation', 'locale_resolution', 'data_quality',
    'ml_prediction', 'outreach_preparation', 'whatsapp_send',
    'outcome_processing', 'publication_evaluation',
    'planity_enrichment'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if (select count(*) from public.prospect_sources
      where key in ('osm', 'geoapify') and independence_group = 'openstreetmap') <> 2 then
    raise exception 'R4.1: the OSM/Geoapify independence group was not applied';
  end if;

  if not exists (
    select 1 from public.prospect_sources
    where key = 'planity' and independence_group = 'planity' and not is_identity_trust_anchor
  ) then
    raise exception 'R4.1: the planity source is missing, ungrouped, or wrongly marked a trust anchor';
  end if;

  -- Registering a source without a health row leaves it permanently paused,
  -- and the symptom is a job that selects candidates and quietly skips every
  -- one of them. Asserted because that is exactly what happened on the first
  -- live run.
  if private.is_prospect_source_paused('planity') is distinct from false then
    raise exception 'R4.1: the planity source is paused or has no health row — it would skip every candidate';
  end if;

  -- A grouped pair must now count as ONE. Asserted directly rather than
  -- trusted, because this is the entire point of the file.
  if (select count(distinct coalesce(ps.independence_group, ps.key))
      from public.prospect_sources ps
      where ps.key in ('osm', 'geoapify')) <> 1 then
    raise exception 'R4.1: OSM and Geoapify still count as two independent observers';
  end if;

  raise notice 'R4.1: booking status installed; OSM/Geoapify grouped; planity source registered';
end $$;


-- ============================================================================
-- END db/migrations/20260828110000_planity_booking_status_and_source_independence.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. The publication queue will be briefly empty: stale ELIGIBLE verdicts
-- were deleted and the Worker's publication_evaluation sweep re-derives them.
-- ============================================================================
