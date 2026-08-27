-- ============================================================================
-- FadeUp — SEED: a populated pre-R4 database, for the acquisition upgrade test
--
-- WHY THIS FILE EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about the three things that can actually go wrong when a publication gate is
-- installed over a LIVE acquisition pipeline:
--
--   1. THE GATE APPLIES RETROACTIVELY. R4 attaches a BEFORE INSERT trigger to
--      prospect_professionals and defines eleven ways to refuse. Nine of the
--      eleven would refuse a prospect that was legitimately published under the
--      old rules — most obviously insufficient_source_evidence, since nothing
--      previously required two sources. If the install validated existing rows,
--      or if a later write path re-checked them, real identities that people may
--      already have CLAIMED would become invalid. The gate must guard the door,
--      not audit the building.
--
--   2. THE INSTALL PUBLISHES SOMETHING. R4 creates the machinery for minting
--      external identities. A migration that also USED it — "let's evaluate and
--      publish everything already eligible" — would mint durable, claimable,
--      public-facing identities for real businesses as a side effect of a schema
--      upgrade, with no operator ever looking at one. This lot's whole premise
--      is that a human decides.
--
--   3. THE INSTALL REWRITES ACQUISITION DATA. R4 adds a column to
--      prospect_sources and rewrites a CHECK constraint on prospect_jobs. A
--      stray UPDATE, or a constraint rewritten to something narrower than what
--      the table already holds, would silently damage a pipeline that has been
--      running.
--
-- HOW (3) IS PROVEN RATHER THAN ASSERTED
--
-- Presence checks — "the prospect is still there", "there are still two source
-- records" — are close to worthless here. They pass just as happily against a
-- migration that rewrote every canonical_name, repointed a link, or reset
-- first_discovered_at to now().
--
-- So this file computes a FINGERPRINT of every row that matters, BEFORE MASTER
-- runs, and stores it. VERIFY recomputes the same fingerprints afterwards and
-- asserts byte equality.
--
-- The fingerprint function is defined HERE and called by BOTH sides. That is
-- deliberate: a VERIFY that re-implemented the projection could drift from this
-- one and produce a false pass — two different queries agreeing about nothing.
-- One implementation, called twice, is the only version of this test that means
-- anything. This is the discipline R3 established and it is copied on purpose.
--
-- WHERE IT LIVES, AND WHY NOT IN public
--
-- Schema `r4_upgrade_baseline`, not `public`. A test table in `public` would
-- enter VERIFY_R1A's public-table allow-list and its "every public table has RLS
-- forced" invariant, and the correct response to that is not to add a test table
-- to a product allow-list.
--
-- HOW IT IS USED
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260828100000_prospect_publication_eligibility.sql \
--     --seed   supabase/SEED_R4_PRE_UPGRADE_2026_08_28.sql \
--     --master supabase/MASTER_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql \
--     --verify supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--
-- --skip-from stops the base replay immediately before R4, so the seed lands on
-- a genuine post-R3 / pre-gate schema — the exact shape production is in right
-- now. MASTER then has to upgrade it on its own.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1. A pipeline that has been running
--
-- Fixed UUIDs so VERIFY can find these without guessing, and so a re-run is
-- idempotent.
--
-- The prospects are deliberately WEAK by R4's standards. Every one of them
-- would be refused if it arrived tomorrow:
--
--   "R4 PRE-UPGRADE Published Shop"  ONE source  -> insufficient_source_evidence
--   "R4 PRE-UPGRADE Orphan Shop"     ONE source  -> insufficient_source_evidence
--   "R4 PRE-UPGRADE 77"              junk name   -> name_not_publishable
--
-- and the first of them is ALREADY LINKED to a professional identity. That is
-- the whole point: it is the row that proves the gate does not reach backwards.
-- A seed of already-compliant prospects would have tested nothing.
-- ---------------------------------------------------------------------------

insert into public.prospects (id, type, entity_kind, status, canonical_name, country,
                              first_discovered_at, created_at)
values
  ('44450000-0000-4000-8000-000000000001', 'barbershop', 'independent', 'qualified',
   'R4 PRE-UPGRADE Published Shop', 'FR', '2026-08-01 09:00:00+00', '2026-08-01 09:00:00+00'),
  ('44450000-0000-4000-8000-000000000002', 'barbershop', 'independent', 'discovered',
   'R4 PRE-UPGRADE Orphan Shop', 'FR', '2026-08-02 09:00:00+00', '2026-08-02 09:00:00+00'),
  ('44450000-0000-4000-8000-000000000003', 'independent_barber', 'independent', 'discovered',
   'R4 PRE-UPGRADE 77', 'FR', '2026-08-03 09:00:00+00', '2026-08-03 09:00:00+00')
on conflict (id) do nothing;

-- One source each. Under R4's rules this is not enough evidence for an
-- identity; under the rules in force when these were discovered, nothing asked.
insert into public.prospect_source_records (id, source_id, prospect_id, external_id,
                                            external_type, fetched_at, created_at)
select ('44451000-0000-4000-8000-00000000000' || n)::uuid,
       (select id from public.prospect_sources where key = 'osm'),
       ('44450000-0000-4000-8000-00000000000' || n)::uuid,
       'seed-r4-pre-' || n, 'node',
       ('2026-08-0' || n || ' 09:00:00+00')::timestamptz,
       ('2026-08-0' || n || ' 09:00:00+00')::timestamptz
from generate_series(1, 3) as n
on conflict (id) do nothing;

-- The identity that was minted before any gate existed, and the link that
-- records where it came from. Inserted directly rather than through
-- create_external_professional because at this point in the replay that RPC has
-- no gate in front of it and behaves exactly like this insert — writing it out
-- makes the pre-upgrade state explicit instead of dependent on a function whose
-- behaviour R4 is about to change.
insert into public.professionals (id, claim_state, display_name, source, is_public, created_at)
values ('44452000-0000-4000-8000-000000000001', 'unclaimed',
        'R4 PRE-UPGRADE Published Shop', 'acquisition', false, '2026-08-01 10:00:00+00')
on conflict (id) do nothing;

insert into public.prospect_professionals (id, prospect_id, professional_id,
                                           match_confidence, matching_rule, created_at)
values ('44453000-0000-4000-8000-000000000001',
        '44450000-0000-4000-8000-000000000001',
        '44452000-0000-4000-8000-000000000001',
        0.910, 'seed_pre_upgrade', '2026-08-01 10:00:00+00')
on conflict (id) do nothing;

-- A job of every type the pre-R4 CHECK constraint allowed. R4 rewrites that
-- constraint in full, and a rewrite that dropped a value would fail to validate
-- against these rows — which is the loud failure we want, rather than a
-- constraint that silently permits less than it used to.
insert into public.prospect_jobs (id, job_type, status, payload, created_at)
select ('44454000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       t, 'completed'::public.prospect_job_status, '{}'::jsonb,
       '2026-08-04 09:00:00+00'::timestamptz
from unnest(array[
  'discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl',
  'instagram_enrich', 'search_plan', 'identity_resolution',
  'competitor_detection', 'website_enrichment', 'feature_computation',
  'fit_scoring', 'segmentation', 'locale_resolution', 'data_quality',
  'ml_prediction', 'outreach_preparation', 'whatsapp_send', 'outcome_processing'
]) with ordinality as u(t, n)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The fingerprint
--
-- md5 over an ordered projection of the columns that carry meaning. A rewritten
-- name, a repointed link, a changed timestamp, an added row and a removed row
-- are all a different digest — and row_count is stored beside it so a digest
-- that changed because the table was emptied is distinguishable from one that
-- changed because a value was edited.
--
-- updated_at is deliberately EXCLUDED. It is touched by set_updated_at on any
-- write, so including it would make any harmless re-save a failure and produce
-- a red result that means nothing. What must not change is the CONTENT.
-- ---------------------------------------------------------------------------

create schema if not exists r4_upgrade_baseline;

comment on schema r4_upgrade_baseline is
  'Upgrade-test scaffolding only. Never created by a migration and never present in production: it exists solely so SEED can record a pre-upgrade fingerprint that VERIFY can compare against. Deliberately outside `public` so it cannot enter VERIFY_R1A''s public-table allow-list or its RLS invariant.';

create or replace function r4_upgrade_baseline.digest(p_entity text)
returns table (row_count bigint, fingerprint text)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_entity = 'prospects' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', p.id, p.type, p.entity_kind, p.status, p.canonical_name,
                       p.country, p.website_domain, p.phone_e164, p.email,
                       p.do_not_contact, p.converted_organization_id,
                       p.first_discovered_at, p.last_enriched_at, p.created_at) as x
      from public.prospects p where p.canonical_name like 'R4 PRE-UPGRADE%'
    ) s;

  elsif p_entity = 'source_records' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', r.id, r.source_id, r.prospect_id, r.external_id,
                       r.external_type, r.fetched_at, r.created_at) as x
      from public.prospect_source_records r
      join public.prospects p on p.id = r.prospect_id
      where p.canonical_name like 'R4 PRE-UPGRADE%'
    ) s;

  elsif p_entity = 'linkage' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', l.id, l.prospect_id, l.professional_id,
                       l.match_confidence, l.matching_rule, l.created_at) as x
      from public.prospect_professionals l
      join public.prospects p on p.id = l.prospect_id
      where p.canonical_name like 'R4 PRE-UPGRADE%'
    ) s;

  elsif p_entity = 'identities' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', pr.id, pr.claim_state, pr.display_name, pr.source,
                       pr.is_public, pr.user_id, pr.claimed_at, pr.created_at) as x
      from public.professionals pr
      where pr.display_name like 'R4 PRE-UPGRADE%'
    ) s;

  elsif p_entity = 'sources' then
    -- The whole source registry, because R4 ADDs a column to it. A migration
    -- that rewrote a key, disabled a source, or dropped the competitor row
    -- while adding is_identity_trust_anchor would show up here.
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', ps.id, ps.key, ps.display_name, ps.is_enabled,
                       ps.config, ps.created_at) as x
      from public.prospect_sources ps
    ) s;

  elsif p_entity = 'jobs' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', j.id, j.job_type, j.status, j.payload, j.created_at) as x
      from public.prospect_jobs j
      where j.id::text like '44454000-%'
    ) s;

  else
    raise exception 'unknown baseline entity: %', p_entity;
  end if;
end;
$$;

comment on function r4_upgrade_baseline.digest(text) is
  'The ONE fingerprint implementation, called by SEED to record and by VERIFY to recompute. Sharing it is the point: a VERIFY that re-implemented these projections could drift from the seed and produce two different queries agreeing about nothing, which would look exactly like a passing test.';

create table if not exists r4_upgrade_baseline.snapshot (
  entity text primary key,
  row_count bigint not null,
  fingerprint text not null,
  captured_at timestamptz not null default now()
);

comment on table r4_upgrade_baseline.snapshot is
  'The state of the seeded acquisition pipeline immediately BEFORE MASTER runs. VERIFY recomputes and compares; any difference means the publication gate rewrote data it had no business touching.';

insert into r4_upgrade_baseline.snapshot (entity, row_count, fingerprint)
select e, d.row_count, d.fingerprint
from unnest(array[
  'prospects', 'source_records', 'linkage', 'identities', 'sources', 'jobs'
]) as e
cross join lateral r4_upgrade_baseline.digest(e) d
on conflict (entity) do update
  set row_count = excluded.row_count,
      fingerprint = excluded.fingerprint,
      captured_at = now();


-- ---------------------------------------------------------------------------
-- 3. Assert the seed built what it claims to have built
--
-- A seed that silently produced nothing would make every upgrade assertion in
-- VERIFY pass vacuously — the test would report success while proving that zero
-- rows were left unchanged. These raise instead.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(entity, ', ')
    into v_missing
  from r4_upgrade_baseline.snapshot
  where row_count = 0;

  if v_missing is not null then
    raise exception 'SEED R4 built no rows for: % — the upgrade test would pass vacuously', v_missing;
  end if;

  if (select row_count from r4_upgrade_baseline.snapshot where entity = 'prospects') <> 3 then
    raise exception 'SEED R4 expected exactly 3 pre-upgrade prospects';
  end if;

  if (select row_count from r4_upgrade_baseline.snapshot where entity = 'linkage') <> 1 then
    raise exception 'SEED R4 expected exactly 1 pre-existing prospect-to-identity link';
  end if;

  -- The seeded prospects must be genuinely INELIGIBLE under the rules R4 is
  -- about to install. If a later change to the seed accidentally made them
  -- compliant, the retroactivity test would still pass — and would be proving
  -- nothing at all, because there would be no rule for the gate to fail to
  -- apply backwards.
  if (select count(distinct r.source_id)
      from public.prospect_source_records r
      where r.prospect_id = '44450000-0000-4000-8000-000000000001') >= 2 then
    raise exception 'SEED R4 published prospect has 2+ sources — it would satisfy the new gate, so the retroactivity test would prove nothing';
  end if;

  raise notice 'SEED R4: 3 prospects, 3 source records, 1 pre-existing identity link, 19 jobs, fingerprints captured';
end $$;

commit;
