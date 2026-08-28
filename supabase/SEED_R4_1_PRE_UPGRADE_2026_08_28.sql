-- ============================================================================
-- FadeUp — SEED: a populated pre-R4.1 database, for the upgrade test
--
-- WHY THIS FILE EXISTS
--
-- R4.1 does not add a feature; it TIGHTENS a rule that has already been
-- applied to real data. Applying it to an empty schema proves the DDL parses
-- and proves nothing about the two things that can actually go wrong:
--
--   1. THE TIGHTENING DOES NOT REACH EXISTING DATA. A prospect that was
--      eligible under "two distinct source rows" and is NOT eligible under
--      "two distinct observers" must flip. If the migration only changed the
--      function for future rows — or if a cached ELIGIBLE verdict survived and
--      kept being offered to an operator — the bug stays open in exactly the
--      place it matters.
--
--   2. THE INSTALL DAMAGES THE PIPELINE. R4.1 adds a column to a table with
--      live observations, rewrites a CHECK constraint, and deletes from a
--      cache. Any of those can quietly take real data with it.
--
-- The fixtures below are built to make BOTH edges observable:
--
--   "R41 PRE Grouped"      osm + geoapify  -> was eligible, must now be refused
--   "R41 PRE Independent"  osm + google    -> was eligible, must STAY eligible
--   "R41 PRE Registry"     sirene          -> trust anchor, must STAY eligible
--
-- A seed of only-grouped prospects would pass a migration that refused
-- everything, which is the other way this lot fails.
--
-- HOW IT IS USED
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260828110000_planity_booking_status_and_source_independence.sql \
--     --seed   supabase/SEED_R4_1_PRE_UPGRADE_2026_08_28.sql \
--     --master supabase/MASTER_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql \
--     --verify supabase/VERIFY_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1. Prospects that existed before the rule changed
-- ---------------------------------------------------------------------------

insert into public.prospects (id, type, entity_kind, status, canonical_name, country,
                              first_discovered_at, created_at)
values
  ('44460000-0000-4000-8000-000000000001', 'barbershop', 'independent', 'qualified',
   'R41 PRE Grouped', 'FR', '2026-08-10 09:00:00+00', '2026-08-10 09:00:00+00'),
  ('44460000-0000-4000-8000-000000000002', 'barbershop', 'independent', 'qualified',
   'R41 PRE Independent', 'FR', '2026-08-10 09:00:00+00', '2026-08-10 09:00:00+00'),
  ('44460000-0000-4000-8000-000000000003', 'barbershop', 'independent', 'qualified',
   'R41 PRE Registry', 'FR', '2026-08-10 09:00:00+00', '2026-08-10 09:00:00+00')
on conflict (id) do nothing;

insert into public.prospect_locations (prospect_id, is_primary, country, city, postal_code)
select id, true, 'FR', 'Paris', '75011'
from public.prospects where canonical_name like 'R41 PRE%'
on conflict do nothing;

-- The pair R4.1 exists to catch: one observer (OpenStreetMap), two reports.
insert into public.prospect_source_records (id, source_id, prospect_id, external_id, external_type)
select ('44461000-0000-4000-8000-00000000000' || n)::uuid,
       (select id from public.prospect_sources where key = k),
       '44460000-0000-4000-8000-000000000001'::uuid,
       'seed-r41-grouped-' || k, 'node'
from (values (1, 'osm'), (2, 'geoapify')) as s(n, k)
on conflict (id) do nothing;

-- Genuinely independent, and must survive the tightening.
insert into public.prospect_source_records (id, source_id, prospect_id, external_id, external_type)
select ('44461000-0000-4000-8000-00000000001' || n)::uuid,
       (select id from public.prospect_sources where key = k),
       '44460000-0000-4000-8000-000000000002'::uuid,
       'seed-r41-independent-' || k, 'node'
from (values (1, 'osm'), (2, 'google_places')) as s(n, k)
on conflict (id) do nothing;

insert into public.prospect_source_records (id, source_id, prospect_id, external_id, external_type)
select '44461000-0000-4000-8000-000000000021'::uuid,
       (select id from public.prospect_sources where key = 'sirene'),
       '44460000-0000-4000-8000-000000000003'::uuid,
       'seed-r41-registry', 'siret'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. A live Planity observation, made the only way that was possible before
--    R4.1: from a link on the business's own website.
--
-- It must survive the column addition unchanged, and it must come out the
-- other side with booking_status = 'UNKNOWN' — because a link cannot know.
-- ---------------------------------------------------------------------------

insert into public.booking_provider_observations
  (id, prospect_id, provider_id, detection_method, evidence, evidence_url, confidence, is_current)
select '44462000-0000-4000-8000-000000000001'::uuid,
       '44460000-0000-4000-8000-000000000002'::uuid,
       bp.id, 'booking_url', 'https://www.planity.com/pre-upgrade-75011-paris',
       'https://preupgrade.example/', 0.97, true
from public.booking_providers bp where bp.key = 'PLANITY'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Cached verdicts from BEFORE the rule changed
--
-- The grouped prospect's ELIGIBLE row is the dangerous one: after R4.1 the
-- live gate refuses it, but a surviving cache row would keep offering it to an
-- operator. R4.1 deletes eligible verdicts for exactly this reason, and §7 of
-- VERIFY asserts the deletion happened.
-- ---------------------------------------------------------------------------

insert into public.prospect_publication_eligibility
  (prospect_id, is_eligible, block_reason, distinct_source_count, has_trust_anchor, evaluated_at)
values
  ('44460000-0000-4000-8000-000000000001', true, null, 2, false, '2026-08-27 09:00:00+00'),
  ('44460000-0000-4000-8000-000000000002', true, null, 2, false, '2026-08-27 09:00:00+00'),
  ('44460000-0000-4000-8000-000000000003', true, null, 1, true,  '2026-08-27 09:00:00+00')
on conflict (prospect_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Fingerprint, so "unchanged" can be proven rather than asserted
-- ---------------------------------------------------------------------------

create schema if not exists r41_upgrade_baseline;

comment on schema r41_upgrade_baseline is
  'Upgrade-test scaffolding only. Never created by a migration and never present in production. Outside `public` so it cannot enter VERIFY_R1A''s public-table allow-list or its RLS invariant.';

create or replace function r41_upgrade_baseline.digest(p_entity text)
returns table (row_count bigint, fingerprint text)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_entity = 'prospects' then
    return query
    select count(*)::bigint, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', p.id, p.canonical_name, p.status, p.country,
                       p.do_not_contact, p.first_discovered_at, p.created_at) as x
      from public.prospects p where p.canonical_name like 'R41 PRE%'
    ) s;

  elsif p_entity = 'source_records' then
    return query
    select count(*)::bigint, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', r.id, r.source_id, r.prospect_id, r.external_id, r.external_type) as x
      from public.prospect_source_records r
      join public.prospects p on p.id = r.prospect_id
      where p.canonical_name like 'R41 PRE%'
    ) s;

  elsif p_entity = 'observations' then
    -- booking_status is deliberately EXCLUDED: the column does not exist when
    -- the seed runs. Everything that did exist must be byte-identical after.
    return query
    select count(*)::bigint, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', o.id, o.prospect_id, o.provider_id, o.detection_method,
                       o.evidence, o.evidence_url, o.confidence, o.is_current,
                       o.first_seen_at) as x
      from public.booking_provider_observations o
      where o.id = '44462000-0000-4000-8000-000000000001'
    ) s;

  elsif p_entity = 'providers' then
    return query
    select count(*)::bigint, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', bp.id, bp.key, bp.display_name, bp.is_active,
                       bp.is_sentinel, bp.signatures) as x
      from public.booking_providers bp
    ) s;

  else
    raise exception 'unknown baseline entity: %', p_entity;
  end if;
end;
$$;

create table if not exists r41_upgrade_baseline.snapshot (
  entity text primary key,
  row_count bigint not null,
  fingerprint text not null,
  captured_at timestamptz not null default now()
);

insert into r41_upgrade_baseline.snapshot (entity, row_count, fingerprint)
select e, d.row_count, d.fingerprint
from unnest(array['prospects', 'source_records', 'observations', 'providers']) as e
cross join lateral r41_upgrade_baseline.digest(e) d
on conflict (entity) do update
  set row_count = excluded.row_count, fingerprint = excluded.fingerprint, captured_at = now();

-- ---------------------------------------------------------------------------
-- 5. Assert the seed built what it claims, and that the fixtures are
--    genuinely at the boundary the upgrade test depends on.
-- ---------------------------------------------------------------------------

do $$
begin
  if (select row_count from r41_upgrade_baseline.snapshot where entity = 'prospects') <> 3 then
    raise exception 'SEED R4.1 expected exactly 3 pre-upgrade prospects';
  end if;

  -- The grouped prospect must be ELIGIBLE right now, under the OLD rule.
  -- If it were not, the upgrade test would "pass" while proving nothing:
  -- there would be no eligible-to-blocked transition to observe.
  if public.publication_block_reason('44460000-0000-4000-8000-000000000001') is not null then
    raise exception 'SEED R4.1: the grouped prospect is already blocked (%) — the tightening would be unobservable',
      public.publication_block_reason('44460000-0000-4000-8000-000000000001');
  end if;

  if public.publication_block_reason('44460000-0000-4000-8000-000000000002') is not null then
    raise exception 'SEED R4.1: the independent prospect is already blocked — it must survive the tightening';
  end if;

  raise notice 'SEED R4.1: 3 prospects, 5 source records, 1 live Planity observation, 3 cached verdicts; grouped prospect confirmed eligible under the OLD rule';
end $$;

commit;
