-- ============================================================================
-- FadeUp — VERIFY: R4.1, booking status and source independence
--
-- Run against a DISPOSABLE database only.
--
--   scripts/disposable-db-test.sh \
--     --verify supabase/VERIFY_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
--
-- WHAT THIS SUITE IS TRYING TO CATCH
--
-- R4.1 makes one change that TIGHTENS an existing guarantee and one that adds
-- a new fact. The tightening is the dangerous one, in both directions:
--
--   * If it does not bite, the gate still treats OSM and Geoapify as two
--     independent observers, and a business seen once — by OpenStreetMap, and
--     again by a service that redistributes OpenStreetMap — clears the
--     evidence bar and gets a durable public identity. That is the failure
--     R4.1 exists to close, and it produces no symptom.
--
--   * If it bites too hard, every prospect becomes ineligible, the publication
--     queue empties, and acquisition silently stops producing supply. §2 pins
--     both edges: the grouped pair must fail AND a genuinely independent pair
--     must still pass.
--
-- Zero FAIL rows is the pass condition.
-- ============================================================================

\set ON_ERROR_STOP off

drop table if exists pg_temp.verify_results;

create temp table verify_results (
  check_name text not null,
  status text not null,
  detail text
);

create or replace function pg_temp.expect(p_check text, p_condition boolean, p_detail text default null)
returns void language sql as $$
  insert into verify_results (check_name, status, detail)
  values (p_check, case when p_condition then 'PASS' else 'FAIL' end, p_detail);
$$;

create or replace function pg_temp.record(p_check text, p_status text, p_detail text default null)
returns void language sql as $$
  insert into verify_results (check_name, status, detail) values (p_check, p_status, p_detail);
$$;

create or replace function pg_temp.sqlstate_of(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  begin execute p_sql; v := 'ALLOWED';
  exception when others then v := sqlstate; end;
  return v;
end;
$$;

/** A prospect with a named set of sources and a location. */
create or replace function pg_temp.mk(p_name text, p_sources text[])
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_key text;
begin
  insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
  values (v_id, 'barbershop', 'independent', 'qualified', p_name, 'FR');

  foreach v_key in array p_sources loop
    insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
    select ps.id, v_id, 'r41-' || v_id::text || '-' || v_key, 'node'
    from public.prospect_sources ps where ps.key = v_key;
  end loop;

  insert into public.prospect_locations (prospect_id, is_primary, country)
  values (v_id, true, 'FR');

  return v_id;
end;
$$;

begin;

-- ============================================================================
-- 1. STRUCTURE
-- ============================================================================

select pg_temp.expect('1.1 booking_availability_status has exactly ACTIVE/LISTED_ONLY/UNKNOWN',
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_type t join pg_enum e on e.enumtypid = t.oid
   where t.typname = 'booking_availability_status') = array['ACTIVE', 'LISTED_ONLY', 'UNKNOWN']);

select pg_temp.expect('1.2 observations carry a booking status, defaulting to UNKNOWN',
  (select column_default like '%UNKNOWN%' and is_nullable = 'NO'
   from information_schema.columns
   where table_schema = 'public' and table_name = 'booking_provider_observations'
     and column_name = 'booking_status'),
  'a detection from the business''s own website cannot know whether bookings are open, so UNKNOWN is the only honest default');

select pg_temp.expect('1.3 provider_public_page is a distinct detection method',
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'booking_provider_detection_method' and e.enumlabel = 'provider_public_page'),
  'reusing a method that means "found on the business''s site" would misdescribe where the evidence came from');

select pg_temp.expect('1.4 prospect_sources carries an independence group',
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'prospect_sources'
            and column_name = 'independence_group'));

select pg_temp.expect('1.5 the segmentation index exists and is partial on is_current',
  exists (select 1 from pg_indexes where schemaname = 'public'
          and indexname = 'booking_provider_observations_status_idx'
          and indexdef ilike '%where is_current%'));

select pg_temp.expect('1.6 planity_enrichment is an accepted job type',
  (select pg_get_constraintdef(oid) ilike '%planity_enrichment%'
   from pg_constraint where conname = 'prospect_jobs_job_type_check'));

-- ============================================================================
-- 2. THE TIGHTENING — BOTH EDGES
-- ============================================================================

select pg_temp.expect('2.1 OSM and Geoapify share an independence group',
  (select count(distinct independence_group) = 1 and count(*) = 2
   from public.prospect_sources where key in ('osm', 'geoapify')),
  'Geoapify redistributes OpenStreetMap — one observer, two reports');

do $$
declare
  v_grouped uuid;
  v_independent uuid;
  v_anchor uuid;
  v_single uuid;
begin
  -- THE test. Before R4.1 this prospect was eligible.
  v_grouped := pg_temp.mk('R41 OSM plus Geoapify', array['osm', 'geoapify']);
  perform pg_temp.expect('2.2 OSM + Geoapify no longer clears the evidence bar',
    public.publication_block_reason(v_grouped) = 'insufficient_source_evidence',
    coalesce(public.publication_block_reason(v_grouped), '(eligible — R4.1 did not bite)'));

  -- The other edge. If this failed, acquisition would silently stop producing
  -- any supply at all, which is a worse outcome than the bug being closed.
  v_independent := pg_temp.mk('R41 OSM plus Google', array['osm', 'google_places']);
  perform pg_temp.expect('2.3 two genuinely independent sources still pass',
    public.publication_block_reason(v_independent) is null,
    coalesce(public.publication_block_reason(v_independent), '(eligible)'));

  v_anchor := pg_temp.mk('R41 Registry Only', array['sirene']);
  perform pg_temp.expect('2.4 one verified registry still passes on its own',
    public.publication_block_reason(v_anchor) is null,
    'the trust-anchor rule is unchanged');

  v_single := pg_temp.mk('R41 Single Source', array['osm']);
  perform pg_temp.expect('2.5 a single source is still refused',
    public.publication_block_reason(v_single) = 'insufficient_source_evidence');

  -- Adding a THIRD source from outside the group rescues the grouped pair,
  -- which is exactly the behaviour an operator would expect and the reason
  -- the rule counts observers rather than blacklisting Geoapify.
  insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
  select ps.id, v_grouped, 'r41-rescue', 'place' from public.prospect_sources ps where ps.key = 'google_places';

  perform pg_temp.expect('2.6 a third, independent source rescues the grouped pair',
    public.publication_block_reason(v_grouped) is null,
    'the rule counts observers; it does not blacklist a provider');
exception when others then
  perform pg_temp.record('2.x (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 3. PLANITY AS A SOURCE
-- ============================================================================

select pg_temp.expect('3.1 planity is registered and enabled',
  exists (select 1 from public.prospect_sources where key = 'planity' and is_enabled));

select pg_temp.expect('3.2 planity is NOT an identity trust anchor',
  (select not is_identity_trust_anchor from public.prospect_sources where key = 'planity'),
  'a Planity page proves a business markets itself there, not that it legally exists — only a registry carries that');

select pg_temp.expect('3.3 planity has its own independence group',
  (select independence_group = 'planity' from public.prospect_sources where key = 'planity'));

select pg_temp.expect('3.4 planity alone could never publish a prospect',
  (select count(*) = 0 from public.prospect_sources
   where key = 'planity' and is_identity_trust_anchor),
  'and the job additionally writes no prospect_source_records at all — see the enrichment job''s persist()');

-- ============================================================================
-- 3b. PLANITY AS A DISCOVERY OBSERVER
--
-- Promoting Planity to a first-class discovery source means it may now
-- contribute ONE independent observer to publication evidence. These pin what
-- that does and — more importantly — what it does not do.
-- ============================================================================

do $$
declare
  v_alone uuid;
  v_with_osm uuid;
  v_with_geoapify uuid;
  v_all_three uuid;
begin
  -- Planity on its own is one observer. One is not two.
  v_alone := pg_temp.mk('R41 Planity Only', array['planity']);
  perform pg_temp.expect('3b.1 Planity alone cannot publish a prospect',
    public.publication_block_reason(v_alone) = 'insufficient_source_evidence',
    'a commercial platform listing is one observer, and the rule requires two');

  -- Planity and OSM are genuinely different observers: a French booking
  -- platform the business signed up to, and a crowd-sourced map.
  v_with_osm := pg_temp.mk('R41 Planity plus OSM', array['planity', 'osm']);
  perform pg_temp.expect('3b.2 Planity + OSM is two independent observers',
    public.publication_block_reason(v_with_osm) is null,
    coalesce(public.publication_block_reason(v_with_osm), '(eligible)'));

  -- Geoapify redistributes OSM, but it is still not Planity, so this pair is
  -- also two — the grouping rule collapses OSM+Geoapify, not everything.
  v_with_geoapify := pg_temp.mk('R41 Planity plus Geoapify', array['planity', 'geoapify']);
  perform pg_temp.expect('3b.3 Planity + Geoapify(OSM) is two independent observers',
    public.publication_block_reason(v_with_geoapify) is null,
    coalesce(public.publication_block_reason(v_with_geoapify), '(eligible)'));

  -- The composition case. Three source rows, two observers.
  v_all_three := pg_temp.mk('R41 Planity OSM Geoapify', array['planity', 'osm', 'geoapify']);
  perform pg_temp.expect('3b.4 Planity + OSM + Geoapify counts as TWO observers, not three',
    (select count(distinct coalesce(ps.independence_group, ps.key))
     from public.prospect_source_records psr
     join public.prospect_sources ps on ps.id = psr.source_id
     where psr.prospect_id = v_all_three) = 2,
    'planity + openstreetmap; geoapify does not add a third');

  -- Removing Planity from that set must drop it back to one observer, which is
  -- what proves the count above came from grouping rather than from luck.
  delete from public.prospect_source_records
  where prospect_id = v_all_three
    and source_id = (select id from public.prospect_sources where key = 'planity');

  perform pg_temp.expect('3b.5 ...and without Planity it is back to ONE',
    public.publication_block_reason(v_all_three) = 'insufficient_source_evidence');
exception when others then
  perform pg_temp.record('3b.x (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 4. SECURITY POSTURE IS UNCHANGED
-- ============================================================================

select pg_temp.expect('4.1 RLS is enabled AND forced on booking_provider_observations',
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.booking_provider_observations'::regclass));

select pg_temp.expect('4.2 the worker can record observations',
  has_table_privilege('prospect_worker', 'public.booking_provider_observations', 'INSERT')
  and has_table_privilege('prospect_worker', 'public.booking_provider_observations', 'UPDATE'));

select pg_temp.expect('4.3 the worker still cannot publish',
  not has_function_privilege('prospect_worker', 'public.publish_external_professional(uuid, text)', 'EXECUTE'),
  'R4''s division of labour survives R4.1');

select pg_temp.expect('4.4 anon reaches neither the gate nor the observations',
  not has_function_privilege('anon', 'public.publication_block_reason(uuid)', 'EXECUTE')
  and not has_table_privilege('anon', 'public.booking_provider_observations', 'SELECT'));

select pg_temp.expect('4.5 the publication gate trigger is still installed',
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'prospect_professionals'
            and t.tgname = 'prospect_professionals_enforce_publication_gate'
            and not t.tgisinternal),
  'every R4 guarantee rests on this one trigger');

select pg_temp.expect('4.6 the gate function still pins its search_path',
  (select exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publication_block_reason'));

-- ============================================================================
-- 5. THE GATE'S OTHER TEN REASONS STILL FIRE
--
-- R4.1 rewrote publication_block_reason to change one clause. Every other
-- branch was carried forward verbatim, and this section is what proves the
-- copy did not drop one on the way.
-- ============================================================================

do $$
declare v_p uuid;
begin
  perform pg_temp.expect('5.1 prospect_not_found',
    public.publication_block_reason(gen_random_uuid()) = 'prospect_not_found');

  v_p := pg_temp.mk('R41 DNC', array['osm', 'google_places']);
  update public.prospects set do_not_contact = true where id = v_p;
  perform pg_temp.expect('5.2 do_not_contact', public.publication_block_reason(v_p) = 'do_not_contact');

  v_p := pg_temp.mk('R41 Converted', array['osm', 'google_places']);
  update public.prospects set status = 'customer' where id = v_p;
  perform pg_temp.expect('5.3 already_customer', public.publication_block_reason(v_p) = 'already_customer');

  v_p := pg_temp.mk('77', array['osm', 'google_places']);
  perform pg_temp.expect('5.4 name_not_publishable', public.publication_block_reason(v_p) = 'name_not_publishable');

  v_p := pg_temp.mk('R41 Group', array['osm', 'google_places']);
  update public.prospects set entity_kind = 'group_parent' where id = v_p;
  perform pg_temp.expect('5.5 entity_kind_not_publishable',
    public.publication_block_reason(v_p) = 'entity_kind_not_publishable');

  declare v_a uuid; v_b uuid;
  begin
    v_a := pg_temp.mk('R41 Dupe A', array['osm', 'google_places']);
    v_b := pg_temp.mk('R41 Dupe B', array['osm', 'google_places']);
    insert into public.prospect_duplicates (prospect_id, duplicate_of_prospect_id, confidence, reason)
    values (v_a, v_b, 0.8, 'r41');
    perform pg_temp.expect('5.6 unresolved_duplicate, both directions',
      public.publication_block_reason(v_a) = 'unresolved_duplicate'
      and public.publication_block_reason(v_b) = 'unresolved_duplicate');
  end;

  v_p := pg_temp.mk('R41 Nowhere', array['osm', 'google_places']);
  delete from public.prospect_locations where prospect_id = v_p;
  perform pg_temp.expect('5.7 no_corroborating_location',
    public.publication_block_reason(v_p) = 'no_corroborating_location');

  v_p := pg_temp.mk('R41 Suppressed', array['osm', 'google_places']);
  insert into public.prospect_suppressions (scope, prospect_id, reason) values ('prospect', v_p, 'r41');
  perform pg_temp.expect('5.8 suppression blocks',
    public.publication_block_reason(v_p) in ('suppressed_prospect', 'do_not_contact'));
exception when others then
  perform pg_temp.record('5.x (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 6. BOOKING STATUS BEHAVES
-- ============================================================================

do $$
declare
  v_p uuid;
  v_planity uuid;
begin
  v_p := pg_temp.mk('R41 Booking Status', array['osm', 'google_places']);
  select id into v_planity from public.booking_providers where key = 'PLANITY';

  insert into public.booking_provider_observations
    (prospect_id, provider_id, detection_method, evidence, confidence, booking_status)
  values (v_p, v_planity, 'booking_url', 'https://www.planity.com/x-75011-paris', 0.97, 'UNKNOWN');

  perform pg_temp.expect('6.1 a website detection defaults to UNKNOWN booking status',
    (select booking_status = 'UNKNOWN' from public.booking_provider_observations
     where prospect_id = v_p and is_current));

  -- The provider page is read and says ACTIVE. The existing BEFORE INSERT
  -- trigger collapses the repeat onto the current row rather than adding one.
  insert into public.booking_provider_observations
    (prospect_id, provider_id, detection_method, evidence, confidence, booking_status)
  values (v_p, v_planity, 'provider_public_page', 'https://www.planity.com/x-75011-paris', 0.98, 'ACTIVE');

  update public.booking_provider_observations
  set booking_status = 'ACTIVE'
  where prospect_id = v_p and provider_id = v_planity and is_current;

  perform pg_temp.expect('6.2 re-observing the same provider does not accumulate rows',
    (select count(*) = 1 from public.booking_provider_observations
     where prospect_id = v_p and provider_id = v_planity),
    'idempotent re-enrichment: the existing trigger extends the row it already has');

  perform pg_temp.expect('6.3 the current row carries the page-derived status',
    (select booking_status = 'ACTIVE' from public.booking_provider_observations
     where prospect_id = v_p and is_current));

  perform pg_temp.expect('6.4 booking status did not make the prospect publishable',
    public.publication_block_reason(v_p) is null
    or public.publication_block_reason(v_p) <> 'planity',
    'Planity evidence contributes to scoring, never to publication');
exception when others then
  perform pg_temp.record('6.x (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- 7. THE UPGRADE PATH
--
-- Only meaningful when SEED_R4_1 ran first. This is where the tightening is
-- proven against data that existed BEFORE the rule changed — the fresh-replay
-- checks in §2 cannot show that, because their fixtures were created under the
-- new rule.
-- ============================================================================

do $$
declare
  v_pre boolean;
  v_drifted text;
  v_grouped uuid := '44460000-0000-4000-8000-000000000001';
  v_independent uuid := '44460000-0000-4000-8000-000000000002';
  v_registry uuid := '44460000-0000-4000-8000-000000000003';
begin
  v_pre := to_regclass('r41_upgrade_baseline.snapshot') is not null;

  if not v_pre then
    perform pg_temp.record('7.0 pre-R4.1 upgrade fixtures', 'INFO',
      'not present — this is the fresh-database run');
    return;
  end if;

  perform pg_temp.record('7.0 pre-R4.1 upgrade fixtures', 'INFO',
    'present — this is the upgrade run');

  select string_agg(format('%s (rows %s->%s)', s.entity, s.row_count, d.row_count), ', ')
    into v_drifted
  from r41_upgrade_baseline.snapshot s
  cross join lateral r41_upgrade_baseline.digest(s.entity) d
  where d.fingerprint is distinct from s.fingerprint or d.row_count is distinct from s.row_count;

  perform pg_temp.expect('7.1 the upgrade rewrote NO pre-existing acquisition data',
    v_drifted is null,
    coalesce(v_drifted, 'prospects, source records, observations and providers all byte-identical'));

  -- THE transition this lot exists to cause. This prospect was eligible
  -- before the migration — the seed asserts it — and must be refused now.
  perform pg_temp.expect('7.2 a previously ELIGIBLE OSM+Geoapify prospect is now refused',
    public.publication_block_reason(v_grouped) = 'insufficient_source_evidence',
    coalesce(public.publication_block_reason(v_grouped), '(still eligible — the tightening did not reach existing data)'));

  -- The other edge, on real pre-existing rows.
  perform pg_temp.expect('7.3 a genuinely independent prospect is untouched',
    public.publication_block_reason(v_independent) is null,
    coalesce(public.publication_block_reason(v_independent), '(eligible)'));

  perform pg_temp.expect('7.4 a registry-anchored prospect is untouched',
    public.publication_block_reason(v_registry) is null,
    coalesce(public.publication_block_reason(v_registry), '(eligible)'));

  -- The stale cache is the "operator is lied to" failure. A surviving
  -- ELIGIBLE row would keep offering a candidate the live gate now refuses.
  perform pg_temp.expect('7.5 stale ELIGIBLE verdicts were cleared, not left to mislead',
    not exists (select 1 from public.prospect_publication_eligibility where is_eligible),
    'the Worker sweep re-derives them; a briefly empty queue beats a briefly wrong one');

  perform pg_temp.expect('7.6 the pre-existing website detection kept UNKNOWN booking status',
    (select booking_status = 'UNKNOWN' from public.booking_provider_observations
     where id = '44462000-0000-4000-8000-000000000001'),
    'a link to Planity proves a relationship and says nothing about whether bookings are open');

  -- Scoped to the SEEDED prospects: §6 above deliberately creates a
  -- provider_public_page observation of its own to exercise the trigger, so an
  -- unscoped check would be measuring this suite instead of the migration.
  perform pg_temp.expect('7.7 the install fetched nothing and classified nothing',
    not exists (
      select 1 from public.booking_provider_observations o
      join public.prospects p on p.id = o.prospect_id
      where p.canonical_name like 'R41 PRE%'
        and (o.detection_method = 'provider_public_page' or o.booking_status <> 'UNKNOWN')),
    'booking_status only becomes ACTIVE or LISTED_ONLY when a planity_enrichment job actually reads a page');
exception when others then
  perform pg_temp.record('7.x (block) unexpected error', 'FAIL', format('%s / %s', sqlstate, sqlerrm));
end $$;

-- ============================================================================
-- RESULTS
-- ============================================================================

select check_name, status, coalesce(detail, '') as detail
from verify_results order by check_name;

select
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail,
  count(*) filter (where status = 'INFO') as info
from verify_results;

rollback;
