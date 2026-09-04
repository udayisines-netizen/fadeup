-- FadeUp — B1: the P1c mobile barber becomes legitimate.
--
-- P1c seeded "Sofian Cuts — Barbier à domicile, Grand Paris Sud" as an
-- organization whose only location is named "Zone de service — Grand Paris
-- Sud" and carries an EMPTY address, no postal code and no coordinates. That
-- row could not be published honestly: get_organization_readiness demanded a
-- postal address and would never have gone green, so P1c published it by
-- forcing marketplace_visible through the operator path. It was also invisible
-- to every geographic search, having no position at all.
--
-- Chantier 4 gave the schema a way to say what this row actually is. This
-- script says it.
--
-- THESE ARE DECLARED DEMONSTRATION VALUES, NOT DISCOVERED FACTS. The centre is
-- the geographic centre of Évry-Courcouronnes, the city the P1c seed already
-- names for this row, and the radius is 25 km — a figure chosen to describe a
-- Grand Paris Sud round trip and to sit above MASTER_SPEC §8's 10 km urban
-- default. Nothing here is scraped, measured or claimed about a real business:
-- this whole organization is part of the declared P1c demonstration set.
--
-- After this script the row is legitimate rather than forced: readiness
-- reports ready_to_publish = true with an empty missing_requirements, the
-- profile is reachable by a geographic search whose point its zone covers, and
-- no public RPC returns an address for it — locations_service_area_has_no_address
-- makes that structurally impossible.
--
-- IDEMPOTENT. Run with:
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < db/seeds/b1_demo_mobile_service_area.sql

set lock_timeout = '5s';

begin;

update public.locations
set kind                          = 'service_area',
    address_line1                 = null,
    address_line2                 = null,
    postal_code                   = null,
    latitude                      = null,
    longitude                     = null,
    service_area_center_latitude  = 48.6238,
    service_area_center_longitude = 2.4290,
    service_area_radius_km        = 25
where id = 'de300104-0000-4000-8000-000000000004'
  and kind = 'physical_address';

commit;
