-- FadeUp — B1 verification: public read integrity.
--
-- Covers all five chantiers plus a dedicated RLS suite.
--
-- LEAVES NOTHING BEHIND, because it never commits. Same reason as
-- verify_marketplace_supply_type: inserting an organization writes an
-- append-only commercial_plan_changes row that no role may delete, so a
-- COMMITTED fixture is permanent residue. The whole script is one transaction
-- ending in ROLLBACK.
--
-- Run with:
--   docker cp db/tests/verify_b1.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_b1.sql
--
-- Reports PASS/FAIL rows; it does not abort on a failure, so one broken
-- guarantee does not hide the state of the other twenty.

\set ON_ERROR_STOP off

begin;

create temporary table b1_results (
  seq serial primary key,
  chantier text not null,
  check_name text not null,
  verdict text not null,
  detail text
) on commit drop;

create or replace function pg_temp.record(p_chantier text, p_check text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into b1_results (chantier, check_name, verdict, detail)
  values (p_chantier, p_check, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- ===========================================================================
-- FIXTURES
-- ===========================================================================

insert into public.organizations (id, name, slug, business_type, currency, country_code, marketplace_visible)
values
  ('b1000001-0000-4000-8000-000000000001', 'B1 Shop',   'b1-verify-shop',   'barbershop',        'EUR', 'FR', true),
  ('b1000002-0000-4000-8000-000000000002', 'B1 Mobile', 'b1-verify-mobile', 'solo_professional', 'EUR', 'FR', true);

update public.organization_commercial_state
set plan_key = 'salon_pro'
where organization_id = 'b1000001-0000-4000-8000-000000000001';

update public.organization_commercial_state
set plan_key = 'solo'
where organization_id = 'b1000002-0000-4000-8000-000000000002';

-- A physical establishment in central Paris, and a service area centred on
-- Évry with a radius wide enough to reach it.
insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('b1000101-0000-4000-8000-000000000001', 'b1000001-0000-4000-8000-000000000001',
        'B1 Shop Châtelet', '1 rue de Rivoli', 'Paris', 'Île-de-France', '75001', 'FR', 'Europe/Paris',
        48.8584, 2.3470);

insert into public.locations (id, organization_id, name, city, region, country, timezone, kind,
                              service_area_center_latitude, service_area_center_longitude, service_area_radius_km)
values ('b1000102-0000-4000-8000-000000000002', 'b1000002-0000-4000-8000-000000000002',
        'B1 Zone Grand Paris Sud', 'Évry-Courcouronnes', 'Île-de-France', 'FR', 'Europe/Paris', 'service_area',
        48.6238, 2.4290, 40);

insert into public.staff_profiles (id, organization_id, location_id, display_name, is_active, is_public)
values ('b1000201-0000-4000-8000-000000000001', 'b1000001-0000-4000-8000-000000000001',
        'b1000101-0000-4000-8000-000000000001', 'B1 Staff Barber', true, true);

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('b1000401-0000-4000-8000-000000000001', 'b1000001-0000-4000-8000-000000000001',
        'b1000201-0000-4000-8000-000000000001', true);

insert into public.professionals (id, claim_state, display_name, handle, source, is_public)
values
  ('b1000301-0000-4000-8000-000000000001', 'unclaimed', 'B1 Anchored Pro',   'b1.anchored',   'acquisition', false),
  ('b1000302-0000-4000-8000-000000000002', 'unclaimed', 'B1 Unanchored Pro', 'b1.unanchored', 'acquisition', false);

-- The acquisition anchor, built the way the Worker builds it. Anything less
-- would not exercise the gate: prospect_professionals carries a BEFORE INSERT
-- trigger that consults publication_block_reason live, so the prospect needs
-- real corroboration — here one source record from `sirene`, which is the
-- schema's identity trust anchor, plus a located record.
insert into public.prospects (id, type, entity_kind, canonical_name, country, website_domain)
values ('b1000501-0000-4000-8000-000000000001', 'independent_barber', 'independent',
        'B1 Anchored Pro', 'FR', 'b1-anchored-pro.example');

insert into public.prospect_locations (prospect_id, is_primary, city, region, country, latitude, longitude)
values ('b1000501-0000-4000-8000-000000000001', true, 'Paris', 'Île-de-France', 'FR', 48.8584, 2.3470);

insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
select ps.id, 'b1000501-0000-4000-8000-000000000001', 'b1-verify-sirene', 'establishment'
from public.prospect_sources ps where ps.key = 'sirene';

insert into public.prospect_professionals (prospect_id, professional_id)
values ('b1000501-0000-4000-8000-000000000001', 'b1000301-0000-4000-8000-000000000001');

-- ===========================================================================
-- CHANTIER 1 — publication of an unclaimed identity
-- ===========================================================================

-- 1.1 An unclaimed identity WITHOUT an anchor is refused.
do $$
begin
  update public.professionals set is_public = true
  where id = 'b1000302-0000-4000-8000-000000000002';
  perform pg_temp.record('1', 'unanchored unclaimed profile refused publication', false,
                         'the UPDATE was accepted');
exception when sqlstate '42501' then
  perform pg_temp.record('1', 'unanchored unclaimed profile refused publication', true);
end $$;

-- 1.2 An unclaimed identity WITH an acquisition anchor publishes.
do $$
declare v_anchor text;
begin
  v_anchor := private.professional_publication_anchor('b1000301-0000-4000-8000-000000000001');
  perform pg_temp.record('1', 'acquisition anchor is detected', v_anchor = 'acquisition_source', coalesce(v_anchor, 'NULL'));

  update public.professionals set is_public = true
  where id = 'b1000301-0000-4000-8000-000000000001';
  perform pg_temp.record('1', 'anchored unclaimed profile publishes', true);
exception when others then
  perform pg_temp.record('1', 'anchored unclaimed profile publishes', false, sqlerrm);
end $$;

-- 1.3 A published unclaimed row exists and is valid in the table.
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.professionals
  where claim_state = 'unclaimed' and is_public and id = 'b1000301-0000-4000-8000-000000000001';
  perform pg_temp.record('1', 'unclaimed AND is_public is representable', v_n = 1, 'rows=' || v_n);
end $$;

-- 1.4 The public RPC returns it, WITH claim_state.
do $$
declare r record; v_n integer := 0;
begin
  for r in select * from public.get_public_professional_by_handle('b1.anchored') loop
    v_n := v_n + 1;
    perform pg_temp.record('1', 'public RPC exposes claim_state on an unclaimed profile',
                           r.claim_state = 'unclaimed' and r.is_claimed = false,
                           'claim_state=' || r.claim_state || ' is_claimed=' || r.is_claimed);
  end loop;
  perform pg_temp.record('1', 'get_public_professional_by_handle returns the unclaimed profile', v_n = 1, 'rows=' || v_n);
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.get_public_professional('b1000301-0000-4000-8000-000000000001');
  perform pg_temp.record('1', 'get_public_professional returns the unclaimed profile', v_n = 1, 'rows=' || v_n);
end $$;

-- 1.5 The dead RPC is gone.
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_public_external_professional';
  perform pg_temp.record('1', 'the structurally-empty RPC is removed', v_n = 0, 'definitions=' || v_n);
end $$;

-- 1.6 The surviving guarantee: a blank name still cannot be published.
do $$
begin
  insert into public.professionals (claim_state, display_name, source, is_public)
  values ('unclaimed', '   ', 'acquisition', false);
  perform pg_temp.record('1', 'blank display_name still refused', false, 'the INSERT was accepted');
exception when check_violation then
  perform pg_temp.record('1', 'blank display_name still refused', true);
end $$;

-- 1.7 An unclaimed identity cannot be born public.
do $$
begin
  insert into public.professionals (claim_state, display_name, source, is_public)
  values ('unclaimed', 'B1 Born Public', 'acquisition', true);
  perform pg_temp.record('1', 'unclaimed identity cannot be created already public', false, 'the INSERT was accepted');
exception when sqlstate '42501' then
  perform pg_temp.record('1', 'unclaimed identity cannot be created already public', true);
end $$;

-- ===========================================================================
-- CHANTIER 2 — the public read contains no write
-- ===========================================================================

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_public_service_state';
  perform pg_temp.record('2', 'get_public_service_state performs no INSERT',
                         v_def not like '%ensure_location_service_settings%');

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_service_mode_state';
  perform pg_temp.record('2', 'get_service_mode_state performs no INSERT',
                         v_def not like '%ensure_location_service_settings%');
end $$;

-- Every STABLE public read RPC must be free of writes: that is the class of
-- defect, not the single function.
do $$
declare r record; v_bad text := '';
begin
  for r in
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.provolatile in ('s','i')
      and (p.proname like 'get\_public\_%' or p.proname like 'list\_public\_%' or p.proname like 'search\_public\_%')
  loop
    if r.def ~* '\m(insert|update|delete)\M\s' then
      v_bad := v_bad || r.proname || ' ';
    end if;
  end loop;
  perform pg_temp.record('2', 'no STABLE public read RPC contains a write statement',
                         v_bad = '', case when v_bad = '' then null else 'suspects: ' || v_bad end);
end $$;

-- The read still answers, and still answers correctly when the settings row is
-- absent — the case the removed INSERT existed to cover.
do $$
declare r record;
begin
  select * into r from public.get_public_service_state('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001');
  perform pg_temp.record('2', 'get_public_service_state returns a row', r.location_id is not null);

  delete from public.location_service_settings where location_id = 'b1000101-0000-4000-8000-000000000001';
  select * into r from public.get_public_service_state('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001');
  perform pg_temp.record('2', 'missing settings row falls back to the compatibility default',
                         r.effective_service_mode = 'hybrid' and r.queue_open,
                         'mode=' || coalesce(r.effective_service_mode::text,'NULL') || ' queue_open=' || coalesce(r.queue_open::text,'NULL'));
end $$;

-- Put it back for the queue checks below.
insert into public.location_service_settings (location_id, organization_id)
values ('b1000101-0000-4000-8000-000000000001', 'b1000001-0000-4000-8000-000000000001')
on conflict (location_id) do nothing;

-- ===========================================================================
-- CHANTIER 3 — the marketplace default
-- ===========================================================================

do $$
declare v_barbers integer; v_rows integer;
begin
  select count(*) filter (where entity_type = 'barber'), count(*)
    into v_barbers, v_rows
  from public.search_public_professionals(p_query => 'B1 ');
  perform pg_temp.record('3', 'default returns no salaried barber', v_barbers = 0, 'barbers=' || v_barbers || ' rows=' || v_rows);

  select count(*) filter (where entity_type = 'barber') into v_barbers
  from public.search_public_professionals(p_query => 'B1 ', p_entity_type => null);
  perform pg_temp.record('3', 'explicit NULL returns no salaried barber', v_barbers = 0, 'barbers=' || v_barbers);

  select count(*) filter (where entity_type = 'barber') into v_barbers
  from public.search_public_professionals(p_query => 'B1 ', p_entity_type => 'nonsense');
  perform pg_temp.record('3', 'unrecognised value falls back to shops only', v_barbers = 0, 'barbers=' || v_barbers);

  select count(*) filter (where entity_type = 'barber') into v_barbers
  from public.search_public_professionals(p_query => 'B1 ', p_entity_type => 'barber');
  perform pg_temp.record('3', 'explicit ''barber'' still returns barbers', v_barbers = 1, 'barbers=' || v_barbers);

  select count(*) filter (where entity_type = 'barber'), count(*) into v_barbers, v_rows
  from public.search_public_professionals(p_query => 'B1 ', p_entity_type => 'all');
  perform pg_temp.record('3', '''all'' is the named opt-in for the union', v_barbers = 1 and v_rows = 3,
                         'barbers=' || v_barbers || ' rows=' || v_rows);
end $$;

-- ===========================================================================
-- CHANTIER 4 — service area
-- ===========================================================================

-- 4.1 A zone cannot carry an address, and cannot be half-defined.
do $$
begin
  update public.locations set address_line1 = '3 rue Inventée'
  where id = 'b1000102-0000-4000-8000-000000000002';
  perform pg_temp.record('4', 'a service area cannot carry a street address', false, 'the UPDATE was accepted');
exception when check_violation then
  perform pg_temp.record('4', 'a service area cannot carry a street address', true);
end $$;

do $$
begin
  update public.locations set latitude = 48.62, longitude = 2.42
  where id = 'b1000102-0000-4000-8000-000000000002';
  perform pg_temp.record('4', 'a service area cannot carry a physical position', false, 'the UPDATE was accepted');
exception when check_violation then
  perform pg_temp.record('4', 'a service area cannot carry a physical position', true);
end $$;

do $$
begin
  update public.locations set service_area_radius_km = null
  where id = 'b1000102-0000-4000-8000-000000000002';
  perform pg_temp.record('4', 'a half-defined zone is refused', false, 'the UPDATE was accepted');
exception when check_violation then
  perform pg_temp.record('4', 'a half-defined zone is refused', true);
end $$;

do $$
begin
  update public.locations set service_area_center_latitude = 48.62
  where id = 'b1000101-0000-4000-8000-000000000001';
  perform pg_temp.record('4', 'a physical address cannot carry zone columns', false, 'the UPDATE was accepted');
exception when check_violation then
  perform pg_temp.record('4', 'a physical address cannot carry zone columns', true);
end $$;

-- 4.2 Coverage: the zone centre is ~27 km from Châtelet, the customer searches
--     with a 10 km radius, and the professional's own 40 km zone reaches them.
do $$
declare r record; v_found boolean := false;
begin
  for r in
    select * from public.search_public_professionals(
      p_query => 'B1 ', p_latitude => 48.8584, p_longitude => 2.3470, p_radius_km => 10)
    where location_kind = 'service_area'
  loop
    v_found := true;
    perform pg_temp.record('4', 'a covering zone appears beyond the customer radius',
                           r.covers_search_point is true and r.distance_km > 10,
                           'distance=' || round(r.distance_km::numeric, 1) || 'km covers=' || r.covers_search_point);
    perform pg_temp.record('4', 'no fabricated address for a mobile professional',
                           r.address_line1 is null and r.postal_code is null
                           and r.latitude is null and r.longitude is null,
                           'address=' || coalesce(r.address_line1, 'NULL') || ' lat=' || coalesce(r.latitude::text, 'NULL'));
  end loop;
  perform pg_temp.record('4', 'the mobile professional is a search result at all', v_found);
end $$;

-- 4.3 A zone outside the search and outside its own radius stays out.
do $$
declare v_n integer;
begin
  update public.locations set service_area_radius_km = 5 where id = 'b1000102-0000-4000-8000-000000000002';
  select count(*) into v_n from public.search_public_professionals(
    p_query => 'B1 ', p_latitude => 48.8584, p_longitude => 2.3470, p_radius_km => 10)
  where location_kind = 'service_area';
  perform pg_temp.record('4', 'a zone that does not reach the customer is excluded', v_n = 0, 'rows=' || v_n);
  update public.locations set service_area_radius_km = 40 where id = 'b1000102-0000-4000-8000-000000000002';
end $$;

-- 4.4 list_public_locations describes the zone rather than an empty address.
do $$
declare r record;
begin
  select * into r from public.list_public_locations('b1-verify-mobile');
  perform pg_temp.record('4', 'list_public_locations returns the zone, not a blank address',
                         r.kind = 'service_area' and r.address_line1 is null
                         and r.service_area_radius_km is not null,
                         'kind=' || r.kind || ' radius=' || coalesce(r.service_area_radius_km::text, 'NULL'));
end $$;

-- 4.5 Readiness accepts a mobile. Read as a platform admin, because the
--     fixture organizations deliberately have no members.
do $$
declare r record; v_admin uuid;
begin
  select user_id into v_admin from public.platform_members limit 1;
  if v_admin is null then
    perform pg_temp.record('4', 'readiness accepts a service area', false, 'no platform member to read as');
    return;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select * into r from public.get_organization_readiness('b1000002-0000-4000-8000-000000000002');
  perform pg_temp.record('4', 'readiness reports has_service_area for a mobile',
                         r.has_service_area and not r.has_location_address,
                         'service_area=' || r.has_service_area || ' address=' || r.has_location_address);
  perform pg_temp.record('4', 'readiness no longer demands an address from a mobile',
                         not ('location_address_or_service_area' = any (r.missing_requirements))
                         and not ('location_address' = any (r.missing_requirements)),
                         'missing=' || array_to_string(r.missing_requirements, ','));

  select * into r from public.get_organization_readiness('b1000001-0000-4000-8000-000000000001');
  perform pg_temp.record('4', 'readiness still recognises a real address',
                         r.has_location_address and not r.has_service_area,
                         'address=' || r.has_location_address || ' service_area=' || r.has_service_area);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ===========================================================================
-- CHANTIER 5 — presence proof
-- ===========================================================================

do $$
declare
  v_token text;
  v_sqlstate text;
  v_detail text;
  v_id uuid;
begin
  select queue_check_in_token into v_token from public.locations
  where id = 'b1000101-0000-4000-8000-000000000001';

  perform pg_temp.record('5', 'every location carries a check-in token',
                         v_token ~ '^[0-9a-f]{32}$', coalesce(v_token, 'NULL'));

  -- no token
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Customer', null, null, null, null, 48.85841, 2.34701);
    perform pg_temp.record('5', 'refuses a missing QR token', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a missing QR token',
                           v_detail = 'fadeup_queue_refusal=invalid_check_in_token', v_detail);
  end;

  -- wrong token
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Customer', null, null, null, repeat('a', 32), 48.85841, 2.34701);
    perform pg_temp.record('5', 'refuses a foreign QR token', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a foreign QR token',
                           v_detail = 'fadeup_queue_refusal=invalid_check_in_token', v_detail);
  end;

  -- right token, no coordinates
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Customer', null, null, null, v_token, null, null);
    perform pg_temp.record('5', 'refuses a join with no position', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a join with no position',
                           v_detail = 'fadeup_queue_refusal=position_required', v_detail);
  end;

  -- right token, 8 km away
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Customer', null, null, null, v_token, 48.94, 2.36);
    perform pg_temp.record('5', 'refuses a join from outside the geofence', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a join from outside the geofence',
                           v_detail = 'fadeup_queue_refusal=too_far', v_detail);
  end;

  -- right token, ~30 m away: admitted
  begin
    select q.id into v_id from public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Customer', '+33600000001', null, null, v_token, 48.85865, 2.34701) q;
    perform pg_temp.record('5', 'admits a join with the token, inside the geofence', v_id is not null);
  exception when others then
    perform pg_temp.record('5', 'admits a join with the token, inside the geofence', false, sqlerrm);
  end;

  -- the same anonymous phone twice
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Customer', '+33600000001', null, null, v_token, 48.85865, 2.34701);
    perform pg_temp.record('5', 'refuses a second entry for the same person', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a second entry for the same person',
                           v_detail = 'fadeup_queue_refusal=already_in_queue', v_detail);
  end;

  -- capacity
  update public.location_service_settings set queue_capacity_per_barber = 1
  where location_id = 'b1000101-0000-4000-8000-000000000001';
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Other', '+33600000002', null, null, v_token, 48.85865, 2.34701);
    perform pg_temp.record('5', 'refuses a join when the queue is full', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a join when the queue is full',
                           v_detail = 'fadeup_queue_refusal=queue_full', v_detail);
  end;
  update public.location_service_settings set queue_capacity_per_barber = 20
  where location_id = 'b1000101-0000-4000-8000-000000000001';

  -- queue closed
  update public.location_service_settings set queue_open = false
  where location_id = 'b1000101-0000-4000-8000-000000000001';
  begin
    perform public.join_public_queue('b1-verify-shop', 'b1000101-0000-4000-8000-000000000001',
      'B1 Third', '+33600000003', null, null, v_token, 48.85865, 2.34701);
    perform pg_temp.record('5', 'refuses a join when the queue is closed', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a join when the queue is closed',
                           v_detail = 'fadeup_queue_refusal=queue_closed', v_detail);
  end;
  update public.location_service_settings set queue_open = true
  where location_id = 'b1000101-0000-4000-8000-000000000001';

  -- the mobile professional
  begin
    perform public.join_public_queue('b1-verify-mobile', 'b1000102-0000-4000-8000-000000000002',
      'B1 Customer', null, null, null, (select queue_check_in_token from public.locations where id='b1000102-0000-4000-8000-000000000002'),
      48.6238, 2.4290);
    perform pg_temp.record('5', 'refuses a queue at a service area', false, 'accepted');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.record('5', 'refuses a queue at a service area',
                           v_detail = 'fadeup_queue_refusal=service_area_has_no_queue', v_detail);
  end;
end $$;

-- The old six-argument door is gone: a caller cannot skip the presence check
-- by resolving to the previous signature.
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'join_public_queue' and p.pronargs = 6;
  perform pg_temp.record('5', 'the pre-B1 6-argument signature is removed', v_n = 0, 'definitions=' || v_n);
end $$;

-- The mobile professional's public service state says so, without anyone
-- having to special-case it.
do $$
declare r record;
begin
  select * into r from public.get_public_service_state('b1-verify-mobile', 'b1000102-0000-4000-8000-000000000002');
  perform pg_temp.record('5', 'a service area reports queue_accepting_new_entries = false',
                         r.queue_accepting_new_entries is false,
                         'accepting=' || coalesce(r.queue_accepting_new_entries::text, 'NULL'));
end $$;

-- Thresholds are per establishment and bounded.
do $$
begin
  update public.location_service_settings set queue_geofence_meters = 400
  where location_id = 'b1000101-0000-4000-8000-000000000001';
  perform pg_temp.record('5', 'the geofence is overridable per establishment', true);
exception when others then
  perform pg_temp.record('5', 'the geofence is overridable per establishment', false, sqlerrm);
end $$;

do $$
begin
  update public.location_service_settings set queue_geofence_meters = 100000
  where location_id = 'b1000101-0000-4000-8000-000000000001';
  perform pg_temp.record('5', 'an absurd geofence is refused', false, 'accepted');
exception when check_violation then
  perform pg_temp.record('5', 'an absurd geofence is refused', true);
end $$;

-- ===========================================================================
-- RLS SUITE — every table B1 touched, read by every role that is not meant to
-- ===========================================================================

do $$
declare r record; v_bad text := '';
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('professionals', 'locations', 'location_service_settings', 'queue_entries')
  loop
    if not r.relrowsecurity then v_bad := v_bad || r.relname || ' '; end if;
  end loop;
  perform pg_temp.record('RLS', 'RLS is enabled on every table B1 touched', v_bad = '',
                         case when v_bad = '' then null else 'without RLS: ' || v_bad end);
end $$;

-- anon holds no privilege at all on any of them: the public surface is RPC and
-- nothing else.
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('professionals', 'locations', 'location_service_settings', 'queue_entries')
    and grantee = 'anon';
  perform pg_temp.record('RLS', 'anon holds no table privilege on B1 tables', v_n = 0, 'grants=' || v_n);

  select count(*) into v_n
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name in ('professionals', 'locations', 'location_service_settings', 'queue_entries')
    and grantee = 'anon';
  perform pg_temp.record('RLS', 'anon holds no column privilege on B1 tables', v_n = 0, 'grants=' || v_n);
end $$;

-- The QR token is never granted to a client role at the column level, and is
-- never a column of a public RPC.
do $$
declare v_n integer; v_bad text := ''; r record;
begin
  -- anon must hold NOTHING on the token. `authenticated` unavoidably reaches
  -- it: locations_select is written for that role, a table-level grant covers
  -- every column including ones added later, and a column-level revoke has no
  -- effect against a table-level grant. That is not a hole — the policy is
  -- is_org_member(organization_id), so a signed-in user reaches the token of
  -- their OWN establishment and nobody else's, which is what
  -- get_location_queue_check_in exists to serve. The non-member case is proved
  -- separately below, by reading the table as a stranger.
  select count(*) into v_n
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'locations'
    and column_name = 'queue_check_in_token' and grantee = 'anon';
  perform pg_temp.record('RLS', 'the QR token is not granted to anon', v_n = 0, 'grants=' || v_n);

  for r in
    select p.proname, pg_get_function_result(p.oid) as res
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'get\_public\_%' or p.proname like 'list\_public\_%' or p.proname like 'search\_public\_%')
  loop
    if r.res like '%queue_check_in_token%' then v_bad := v_bad || r.proname || ' '; end if;
  end loop;
  perform pg_temp.record('RLS', 'no public RPC returns the QR token', v_bad = '',
                         case when v_bad = '' then null else 'leaking: ' || v_bad end);
end $$;

-- An authenticated NON-member sees nothing of another tenant.
-- The verdicts are collected while impersonating and recorded afterwards: the
-- `authenticated` role holds no privilege on the temp results table either, so
-- writing a row from inside the impersonation would fail and report the test
-- harness rather than the guarantee.
do $$
declare
  v_stranger uuid;
  v_n integer;
  v_locations text;
  v_queue text;
  v_settings text;
  v_professionals text;
  v_token text;
begin
  select id into v_stranger from auth.users
  where id not in (select user_id from public.platform_members)
    and id not in (select user_id from public.memberships)
  limit 1;

  if v_stranger is null then
    perform pg_temp.record('RLS', 'authenticated non-member is isolated', false,
                           'no non-member account available in this database');
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Two acceptable outcomes, and both are isolation: zero rows (RLS filtered
  -- them) or a refusal (the role holds no privilege on the table at all, which
  -- is stronger). Anything else is a leak.
  begin
    select count(*) into v_n from public.locations
    where organization_id = 'b1000001-0000-4000-8000-000000000001';
    v_locations := case when v_n = 0 then 'ok:0 rows' else 'LEAK:' || v_n || ' rows' end;
  exception when insufficient_privilege then v_locations := 'ok:no table privilege at all';
  end;

  begin
    select count(*) into v_n from public.queue_entries
    where organization_id = 'b1000001-0000-4000-8000-000000000001';
    v_queue := case when v_n = 0 then 'ok:0 rows' else 'LEAK:' || v_n || ' rows' end;
  exception when insufficient_privilege then v_queue := 'ok:no table privilege at all';
  end;

  begin
    select count(*) into v_n from public.location_service_settings
    where organization_id = 'b1000001-0000-4000-8000-000000000001';
    v_settings := case when v_n = 0 then 'ok:0 rows' else 'LEAK:' || v_n || ' rows' end;
  exception when insufficient_privilege then v_settings := 'ok:no table privilege at all';
  end;

  begin
    select count(*) into v_n from public.professionals
    where id = 'b1000301-0000-4000-8000-000000000001';
    v_professionals := case when v_n = 0 then 'ok:0 rows' else 'LEAK:' || v_n || ' rows' end;
  exception when insufficient_privilege then v_professionals := 'ok:no table privilege at all';
  end;

  -- The QR token, read straight off the table by a signed-in stranger. This is
  -- the check that matters for chantier 5: `authenticated` holds a column
  -- privilege it cannot be stripped of, and RLS is what makes it harmless.
  begin
    select count(*) into v_n from public.locations
    where id = 'b1000101-0000-4000-8000-000000000001'
      and queue_check_in_token is not null;
    v_token := case when v_n = 0 then 'ok:0 rows' else 'LEAK:' || v_n || ' rows' end;
  exception when insufficient_privilege then v_token := 'ok:no table privilege at all';
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('RLS', 'non-member reads no location of another tenant',        v_locations     like 'ok:%', v_locations);
  perform pg_temp.record('RLS', 'non-member reads no queue entry of another tenant',     v_queue         like 'ok:%', v_queue);
  perform pg_temp.record('RLS', 'non-member reads no service settings of another tenant', v_settings     like 'ok:%', v_settings);
  perform pg_temp.record('RLS', 'non-member reads no professional row directly',         v_professionals like 'ok:%', v_professionals);
  perform pg_temp.record('RLS', 'non-member reads no QR token off the table',            v_token         like 'ok:%', v_token);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('RLS', 'authenticated non-member is isolated', false, sqlerrm);
end $$;

-- A non-member cannot reach the QR token through its own RPC either.
do $$
declare v_stranger uuid;
begin
  select id into v_stranger from auth.users
  where id not in (select user_id from public.platform_members)
    and id not in (select user_id from public.memberships)
  limit 1;

  if v_stranger is null then
    perform pg_temp.record('RLS', 'non-member cannot read the QR token', false, 'no non-member account available');
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.get_location_queue_check_in('b1000101-0000-4000-8000-000000000001');
    perform pg_temp.record('RLS', 'non-member cannot read the QR token', false, 'accepted');
  exception when sqlstate '42501' then
    perform pg_temp.record('RLS', 'non-member cannot read the QR token', true);
  end;

  begin
    perform public.regenerate_location_queue_check_in_token('b1000101-0000-4000-8000-000000000001');
    perform pg_temp.record('RLS', 'non-member cannot regenerate the QR token', false, 'accepted');
  exception when sqlstate '42501' then
    perform pg_temp.record('RLS', 'non-member cannot regenerate the QR token', true);
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- An anonymous caller cannot withdraw or publish an identity.
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.withdraw_external_professional('b1000301-0000-4000-8000-000000000001');
    perform pg_temp.record('RLS', 'anon cannot withdraw a published identity', false, 'accepted');
  exception when sqlstate '42501' then
    perform pg_temp.record('RLS', 'anon cannot withdraw a published identity', true);
  end;
end $$;

-- ===========================================================================
-- RESULTS
-- ===========================================================================

select chantier, check_name, verdict, coalesce(detail, '') as detail
from b1_results order by seq;

select verdict, count(*) from b1_results group by verdict order by verdict;

rollback;
