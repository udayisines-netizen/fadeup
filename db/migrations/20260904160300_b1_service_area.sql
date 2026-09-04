-- FadeUp — B1, chantier 4: a professional without a fixed address.
--
-- THE DEFECT
--
-- MASTER_SPEC §8 makes the mobile barber a first-class case: "type Independent
-- avec zone de service, JAMAIS de fausse adresse physique." The schema had no
-- way to say that. locations carries address columns and a lat/lng pair and
-- nothing else, so a mobile professional has exactly two options, and both are
-- dishonest:
--
--   - invent an address, which is the one thing the spec forbids by name; or
--   - leave the address blank, which makes get_organization_readiness report
--     'location_address' missing forever and ready_to_publish false, so the
--     only way onto the marketplace is an operator forcing
--     set_organization_marketplace_visible.
--
-- P1c took the second road for "Sofian Cuts — Barbier à domicile": a location
-- named "Zone de service — Grand Paris Sud" with an empty address, no
-- coordinates, published by hand. It is invisible to every geographic search
-- and its readiness will never go green.
--
-- THE MODEL
--
-- locations.kind discriminates. A location is EITHER a physical address OR a
-- service area, and the columns of the other kind are forced NULL — so there
-- is no row shape in which a service area quietly carries half an address.
--
--   kind = 'physical_address'  the existing world, and the default. Every one
--                              of the 18 live rows backfills into it. Service
--                              area columns must be NULL.
--
--   kind = 'service_area'      a covered zone: centre point plus radius. The
--                              postal columns and the physical lat/lng must be
--                              NULL — this is the "never a fake address"
--                              guarantee, held by a CHECK rather than by
--                              everyone remembering. city, region and country
--                              stay allowed: a zone genuinely has an
--                              administrative area, search filters on it, and
--                              "Évry-Courcouronnes, Île-de-France, FR" is a
--                              true statement about a zone, not an address.
--
-- WHY CENTRE-PLUS-RADIUS, AND WHY NOT POSTGIS
--
-- PostGIS 3.3.7 is AVAILABLE in this image but NOT INSTALLED. cube and
-- earthdistance ARE installed and are what search_public_professionals and
-- search_public_organizations already use for every distance they compute.
-- Installing PostGIS to model a circle would add an extension to a production
-- database, introduce a second geometry vocabulary alongside the one already
-- in use, and buy nothing this feature needs: a covered zone is answered by
-- one distance comparison, which earthdistance does. A commune list or a
-- polygon can be layered on later — the discriminator column is where that
-- would attach — and neither is required by anything in MASTER_SPEC §8.
--
-- The coordinates are DELIBERATELY IN THEIR OWN COLUMNS rather than reusing
-- locations.latitude/longitude. Those two mean "where this establishment
-- physically is", and a consumer that finds them populated will drop a pin.
-- The centre of a zone is not a place a customer can go; a map must draw it as
-- a circle. Separate columns make that impossible to get wrong: for a service
-- area, latitude and longitude are NULL, and the only position available is
-- one that is named as a zone centre.
--
-- WHAT IS DELIBERATELY *NOT* CONSTRAINED
--
-- A physical_address row is NOT required to carry an address. Onboarding
-- creates the organization and its location before the professional has typed
-- one (create_organization, complete_organization_onboarding), and a NOT NULL
-- there would break the first screen of the product. "Never neither one nor
-- the other" is enforced where it means something — at PUBLICATION, in
-- get_organization_readiness (next migration), which is already the gate that
-- decides whether a business may appear at all.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. The discriminator
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'location_kind') then
    create type public.location_kind as enum ('physical_address', 'service_area');
  end if;
end $$;

comment on type public.location_kind is
  'What a locations row IS. physical_address: a place a customer travels to. service_area: a zone a professional travels within, with no address and no physical position. The two are exclusive and the CHECK constraints on locations make the other kind''s columns unrepresentable.';

alter table public.locations
  add column if not exists kind public.location_kind not null default 'physical_address',
  add column if not exists service_area_center_latitude double precision,
  add column if not exists service_area_center_longitude double precision,
  add column if not exists service_area_radius_km double precision;

comment on column public.locations.kind is
  'physical_address (default, and what every row created before B1 is) or service_area. Backfilled by the column default: an existing row describes a place, which is exactly what physical_address means.';

comment on column public.locations.service_area_center_latitude is
  'Centre of the covered zone. NOT an address and NOT where the professional is — locations.latitude stays NULL for a service area precisely so no consumer can mistake one for the other.';

comment on column public.locations.service_area_center_longitude is
  'See service_area_center_latitude.';

comment on column public.locations.service_area_radius_km is
  'How far from the centre the professional will travel. A search point within this radius is COVERED, and the row must be returned even when the centre is further away than the customer''s own search radius (MASTER_SPEC §8).';

-- ---------------------------------------------------------------------------
-- 2. The shape rules
-- ---------------------------------------------------------------------------

alter table public.locations
  drop constraint if exists locations_kind_shape;

alter table public.locations
  add constraint locations_kind_shape check (
    (kind = 'physical_address'
      and service_area_center_latitude is null
      and service_area_center_longitude is null
      and service_area_radius_km is null)
    or
    (kind = 'service_area'
      and service_area_center_latitude is not null
      and service_area_center_longitude is not null
      and service_area_radius_km is not null)
  );

comment on constraint locations_kind_shape on public.locations is
  'A service area is fully defined or it does not exist: centre and radius together, never one without the other. A physical address carries none of them.';

alter table public.locations
  drop constraint if exists locations_service_area_center_range;

alter table public.locations
  add constraint locations_service_area_center_range check (
    (service_area_center_latitude is null
      or (service_area_center_latitude >= -90 and service_area_center_latitude <= 90))
    and
    (service_area_center_longitude is null
      or (service_area_center_longitude >= -180 and service_area_center_longitude <= 180))
  );

alter table public.locations
  drop constraint if exists locations_service_area_radius_range;

alter table public.locations
  add constraint locations_service_area_radius_range check (
    service_area_radius_km is null
    or (service_area_radius_km > 0 and service_area_radius_km <= 100)
  );

comment on constraint locations_service_area_radius_range on public.locations is
  'A zone with a zero radius is not a zone, and one wider than 100 km is not a service area a barber travels — it is a way of appearing in every search in the country. The upper bound is a product judgement, not a physical one, and MASTER_SPEC §8''s 10 km urban default sits comfortably inside it.';

-- THE "NEVER A FAKE ADDRESS" GUARANTEE.
alter table public.locations
  drop constraint if exists locations_service_area_has_no_address;

alter table public.locations
  add constraint locations_service_area_has_no_address check (
    kind <> 'service_area'
    or (
      nullif(btrim(coalesce(address_line1, '')), '') is null
      and nullif(btrim(coalesce(address_line2, '')), '') is null
      and nullif(btrim(coalesce(postal_code, '')), '') is null
      and latitude is null
      and longitude is null
    )
  );

comment on constraint locations_service_area_has_no_address on public.locations is
  'MASTER_SPEC §8, in the schema: a mobile professional never has a fake physical address. Street lines, postal code and the physical coordinate pair are unrepresentable on a service area, so no RPC can return one and no operator can type one in. city / region / country remain allowed — an administrative area is a true fact about a zone and search filters on it.';

create index if not exists locations_service_area_idx
  on public.locations (id) where kind = 'service_area';

-- ---------------------------------------------------------------------------
-- 2b. One distance function instead of the same CASE expression four times
--
-- The two search RPCs each carried an inline earth_distance CASE, twice over.
-- A service area needs the identical arithmetic against a different pair of
-- columns, which would have made it eight copies. One function, and the
-- callers choose which point to measure to.
--
-- STABLE rather than IMMUTABLE: earth_distance and ll_to_earth are immutable,
-- but nothing here needs constant folding and overclaiming volatility is how
-- an index gets built on a promise the function does not keep.
-- ---------------------------------------------------------------------------

create or replace function private.point_distance_km(
  p_from_latitude double precision,
  p_from_longitude double precision,
  p_to_latitude double precision,
  p_to_longitude double precision
)
returns double precision
language sql
stable
set search_path = ''
as $$
  select case
    when p_from_latitude is null or p_from_longitude is null
      or p_to_latitude is null or p_to_longitude is null
      then null
    else extensions.earth_distance(
           extensions.ll_to_earth(p_from_latitude, p_from_longitude),
           extensions.ll_to_earth(p_to_latitude, p_to_longitude)
         ) / 1000.0
  end;
$$;

comment on function private.point_distance_km(double precision, double precision, double precision, double precision) is
  'Great-circle distance in kilometres via the earthdistance extension, NULL when either point is unknown. PostGIS is available in this image but not installed; cube + earthdistance are what every existing FadeUp distance already uses, and a covered zone needs one comparison, not a geometry type.';

revoke all on function private.point_distance_km(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. list_public_locations — return the zone, never a blank address
--
-- A profile screen given only NULL address columns has to guess whether the
-- data is missing or the professional is mobile, and either guess produces a
-- wrong screen. It now gets the answer.
-- ---------------------------------------------------------------------------

drop function if exists public.list_public_locations(text);

create function public.list_public_locations(p_organization_slug text)
returns table (
  id uuid,
  name text,
  kind public.location_kind,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  timezone text,
  service_area_center_latitude double precision,
  service_area_center_longitude double precision,
  service_area_radius_km double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.kind,
         l.address_line1, l.address_line2, l.city, l.region, l.postal_code, l.country,
         l.timezone,
         l.service_area_center_latitude, l.service_area_center_longitude, l.service_area_radius_km
  from public.locations l
  join public.organizations o on o.id = l.organization_id
  where o.slug = p_organization_slug and l.is_active;
$$;

comment on function public.list_public_locations(text) is
  'Anon-callable. The public establishments of an organization. kind says which of the two shapes the row is: a physical_address carries street lines, a service_area carries a centre and a radius and NEVER an address (locations_service_area_has_no_address makes that structural). A consumer renders an address for the first and a covered zone for the second; there is no third case to guess at.';

revoke all on function public.list_public_locations(text) from public;
grant execute on function public.list_public_locations(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Geographic relevance for a zone
--
-- The rule from MASTER_SPEC §8: "Un mobile dont la zone couvre le point de
-- recherche doit apparaître, même si son centre est plus loin." So the radius
-- filter gains a second, independent way to pass:
--
--   physical address   kept when distance(point, address) <= p_radius_km
--   service area       kept when distance(point, centre)  <= p_radius_km
--                          OR distance(point, centre) <= service_area_radius_km
--
-- The second arm is the coverage test and it is the professional's promise,
-- not the customer's filter: a barber whose zone reaches the customer is
-- relevant however far their own centre happens to be.
--
-- distance_km on a service_area row is the distance to the ZONE CENTRE. It is
-- returned because sorting by proximity needs a number, and it is accompanied
-- by covers_search_point so no interface has to present a centre distance as
-- "how far away this barber is".
-- ---------------------------------------------------------------------------

drop function if exists public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text);

create function public.search_public_professionals(
  p_country text default null,
  p_city text default null,
  p_query text default null,
  p_service_query text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_km double precision default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_open_now_only boolean default false,
  p_entity_type text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'recommended'
)
returns table (
  entity_type text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  barber_id uuid,
  professional_id uuid,
  barber_display_name text,
  barber_avatar_url text,
  barber_title text,
  location_id uuid,
  location_name text,
  location_kind public.location_kind,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  service_area_center_latitude double precision,
  service_area_center_longitude double precision,
  service_area_radius_km double precision,
  covers_search_point boolean,
  timezone text,
  distance_km double precision,
  starting_price_cents integer,
  is_open_now boolean,
  queue_waiting_count integer,
  total_count bigint,
  marketplace_supply_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  with shop_base as (
    select
      'shop'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      -- THE MAPPING, AUTHORITATIVE AND HERE. Enumerated value by value rather
      -- than `else 'barbershop'`: a business type added later must resolve to
      -- NULL and render no label, not silently inherit the commoner meaning.
      case o.business_type
        when 'solo_professional' then 'independent'
        when 'barbershop'        then 'barbershop'
        when 'hair_salon'        then 'barbershop'
        when 'mixed_salon'       then 'barbershop'
        when 'multi_location'    then 'barbershop'
        else null
      end::text as marketplace_supply_type,
      null::uuid as barber_id,
      null::uuid as professional_id,
      null::text as barber_display_name,
      null::text as barber_avatar_url,
      null::text as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.kind as location_kind,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.service_area_center_latitude,
      l.service_area_center_longitude,
      l.service_area_radius_km,
      l.timezone,
      private.point_distance_km(
        p_latitude, p_longitude,
        -- Exactly one of the two pairs is populated: locations_kind_shape
        -- and locations_service_area_has_no_address between them make any
        -- other combination unrepresentable, so the coalesce cannot pick
        -- the wrong point.
        coalesce(l.latitude, l.service_area_center_latitude),
        coalesce(l.longitude, l.service_area_center_longitude)
      ) as distance_km
    from public.organizations o
    join public.locations l on l.organization_id = o.id
    where o.marketplace_visible
      and l.is_active
      and private.normalize_marketplace_entity_type(p_entity_type) in ('shop', 'all')
      and (p_country is null or l.country = p_country)
      and (
        p_city is null or p_city = '' or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city) or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city || '%')
      )
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.service_locations sl on sl.service_id = s.id and sl.location_id = l.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  barber_base as (
    select
      'barber'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      case o.business_type
        when 'solo_professional' then 'independent'
        when 'barbershop'        then 'barbershop'
        when 'hair_salon'        then 'barbershop'
        when 'mixed_salon'       then 'barbershop'
        when 'multi_location'    then 'barbershop'
        else null
      end::text as marketplace_supply_type,
      b.id as barber_id,
      case when p.claim_state = 'claimed' then p.id else null end as professional_id,
      sp.display_name as barber_display_name,
      sp.avatar_url as barber_avatar_url,
      sp.title as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.kind as location_kind,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.service_area_center_latitude,
      l.service_area_center_longitude,
      l.service_area_radius_km,
      l.timezone,
      private.point_distance_km(
        p_latitude, p_longitude,
        -- Exactly one of the two pairs is populated: locations_kind_shape
        -- and locations_service_area_has_no_address between them make any
        -- other combination unrepresentable, so the coalesce cannot pick
        -- the wrong point.
        coalesce(l.latitude, l.service_area_center_latitude),
        coalesce(l.longitude, l.service_area_center_longitude)
      ) as distance_km
    from public.barbers b
    left join public.professionals p on p.id = b.professional_id
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.organizations o on o.id = b.organization_id
    join public.locations l on l.id = sp.location_id
    where o.marketplace_visible
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and l.is_active
      and private.normalize_marketplace_entity_type(p_entity_type) in ('barber', 'all')
      and (p_country is null or l.country = p_country)
      and (
        p_city is null or p_city = '' or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city) or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city || '%')
      )
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(sp.display_name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.barber_services bs on bs.service_id = s.id and bs.barber_id = b.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  combined as (
    select * from shop_base
    union all
    select * from barber_base
  ),
  priced as (
    select
      c.*,
      -- Does the professional's own zone reach the point the customer is
      -- searching from? NULL when there is no zone or no search point: absent,
      -- not false, because "this is not a zone" and "this zone does not reach
      -- you" are different answers and only one of them is about coverage.
      case
        when c.location_kind = 'service_area'
             and c.distance_km is not null
             and c.service_area_radius_km is not null
          then c.distance_km <= c.service_area_radius_km
        else null
      end as covers_search_point,
      (
        select min(s.price_cents)
        from public.services s
        where s.organization_id = c.organization_id and s.is_active
          and (
            (c.entity_type = 'shop' and exists (
              select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = c.location_id
            ))
            or
            (c.entity_type = 'barber' and exists (
              select 1 from public.barber_services bs where bs.service_id = s.id and bs.barber_id = c.barber_id
            ))
          )
      ) as starting_price_cents,
      (
        select not lh.is_closed
          and (now() at time zone c.timezone)::time between lh.open_time and lh.close_time
        from public.location_hours lh
        where lh.location_id = c.location_id
          and lh.day_of_week = extract(dow from (now() at time zone c.timezone))::smallint
      ) as is_open_now,
      (
        -- Bounded to TODAY in the location's own timezone: nothing in this
        -- schema ever expires a 'waiting' row, so an unbounded count would
        -- advertise last week's queue as a live wait. A barber row counts only
        -- entries assigned to that barber.
        select count(*)::integer
        from public.queue_entries qe
        where qe.location_id = c.location_id and qe.status = 'waiting'
          and qe.created_at >= (date_trunc('day', now() at time zone c.timezone) at time zone c.timezone)
          and (c.entity_type = 'shop' or qe.barber_id = c.barber_id)
      ) as queue_waiting_count
    from combined c
  ),
  filtered as (
    select *
    from priced
    where (
        p_radius_km is null
        or distance_km is null
        or distance_km <= p_radius_km
        -- COVERAGE. The mobile professional whose zone reaches the customer
        -- belongs in the results even when their centre sits outside the
        -- customer's own radius. Without this arm a barber who explicitly
        -- promises to travel to you is filtered out for living too far away.
        or covers_search_point is true
      )
      and (p_min_price_cents is null or starting_price_cents is null or starting_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or starting_price_cents is null or starting_price_cents <= p_max_price_cents)
      and (not p_open_now_only or is_open_now is true)
  )
  select
    f.entity_type,
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.barber_id,
    f.professional_id,
    f.barber_display_name,
    f.barber_avatar_url,
    f.barber_title,
    f.location_id,
    f.location_name,
    f.location_kind,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.latitude,
    f.longitude,
    f.service_area_center_latitude,
    f.service_area_center_longitude,
    f.service_area_radius_km,
    f.covers_search_point,
    f.timezone,
    f.distance_km,
    f.starting_price_cents,
    f.is_open_now,
    f.queue_waiting_count,
    count(*) over () as total_count,
    f.marketplace_supply_type
  from filtered f
  order by
    -- NEAREST. A row with no distance sorts last rather than first: "nearest"
    -- must never lead with "unknown".
    case when p_sort = 'nearest' then (f.distance_km is null) end asc,
    case when p_sort = 'nearest' then f.distance_km end asc nulls last,

    -- PRICE, cheapest first. A shop with no published service sorts after
    -- every priced one instead of reading as free.
    case when p_sort = 'price' then (f.starting_price_cents is null) end asc,
    case when p_sort = 'price' then f.starting_price_cents end asc nulls last,

    -- RECOMMENDED — and the fallback for any unrecognised value.
    (f.distance_km is not null) desc,
    f.distance_km asc nulls last,
    f.organization_name asc,
    coalesce(f.barber_display_name, '') asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

comment on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text) is
'Anon-callable. THE marketplace search. Returns the FadeUp offer — Independent and Barbershop establishments — by default, at NULL, and for any unrecognised p_entity_type. A salaried barber is a public, followable, bookable-through-their-shop identity and is never an autonomous search result (MASTER_SPEC §2); pass p_entity_type = ''barber'' or ''all'' to ask for them by name.

Parameters, all optional:
  p_country          text    NULL   exact match on locations.country
  p_city             text    NULL   unaccented ILIKE, exact or prefix
  p_query            text    NULL   unaccented substring over organization name, city, and barber display name on barber rows
  p_service_query    text    NULL   unaccented substring over the names of ACTIVE services offered at that location (shop rows) or by that barber (barber rows)
  p_latitude         float8  NULL   with p_longitude, populates distance_km and covers_search_point; alone it does nothing
  p_longitude        float8  NULL   idem
  p_radius_km        float8  NULL   drops rows further than this, EXCEPT a service area whose own radius reaches the search point (MASTER_SPEC §8). A row with unknown distance is kept, never invented
  p_min_price_cents  int     NULL   floor on the "from" price; a row with no published price passes
  p_max_price_cents  int     NULL   ceiling on the "from" price; same rule
  p_open_now_only    bool    false  keeps only rows whose location_hours say open right now, in the location timezone
  p_entity_type      text    NULL   ''shop'' | ''barber'' | ''all''; NULL, empty and unknown all mean ''shop''
  p_limit            int     20     page size, floored at 0
  p_offset           int     0      page offset, floored at 0
  p_sort             text    ''recommended''  ''recommended'' | ''nearest'' | ''price''; unknown values fall back to recommended

Geography. location_kind is ''physical_address'' or ''service_area''. On a physical address, latitude/longitude are the establishment and the service_area_* columns are NULL. On a service area it is the reverse: latitude/longitude are NULL — there is no address and none is invented — and the zone is described by service_area_center_latitude/longitude plus service_area_radius_km. distance_km is the distance to the address or to the ZONE CENTRE respectively, and covers_search_point tells a service-area row apart from a nearby one: true when the professional''s own zone reaches the customer, NULL when there is no zone or no search point.';

revoke all on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text) from public;
grant execute on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. search_public_organizations — the same coverage rule
--
-- V2_DATA_CONTRACT §7 calls this function redundant with
-- search_public_professionals(p_entity_type => 'shop') and says it should be
-- consumed or deprecated. Until that decision is taken it is anon-callable and
-- would silently filter out every mobile professional whose centre falls
-- outside the customer's radius. Leaving a known-wrong sibling behind is
-- exactly the failure chantier 2 was about.
-- ---------------------------------------------------------------------------

drop function if exists public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer);

create function public.search_public_organizations(
  p_country text default null,
  p_city text default null,
  p_query text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_km double precision default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  location_kind public.location_kind,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  country text,
  service_area_radius_km double precision,
  covers_search_point boolean,
  distance_km double precision,
  starting_price_cents integer,
  is_open_now boolean,
  queue_waiting_count integer,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      l.id as location_id,
      l.name as location_name,
      l.kind as location_kind,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.service_area_radius_km,
      l.timezone,
      private.point_distance_km(
        p_latitude, p_longitude,
        -- Exactly one of the two pairs is populated: locations_kind_shape
        -- and locations_service_area_has_no_address between them make any
        -- other combination unrepresentable, so the coalesce cannot pick
        -- the wrong point.
        coalesce(l.latitude, l.service_area_center_latitude),
        coalesce(l.longitude, l.service_area_center_longitude)
      ) as distance_km
    from public.organizations o
    join public.locations l on l.organization_id = o.id
    where o.marketplace_visible
      and l.is_active
      and (p_country is null or l.country = p_country)
      and (p_city is null or l.city ilike p_city)
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
  ),
  covered as (
    select
      b.*,
      case
        when b.location_kind = 'service_area'
             and b.distance_km is not null
             and b.service_area_radius_km is not null
          then b.distance_km <= b.service_area_radius_km
        else null
      end as covers_search_point
    from base b
  ),
  filtered as (
    select * from covered
    where p_radius_km is null
       or distance_km is null
       or distance_km <= p_radius_km
       or covers_search_point is true
  )
  select
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.location_id,
    f.location_name,
    f.location_kind,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.service_area_radius_km,
    f.covers_search_point,
    f.distance_km,
    (
      select min(s.price_cents)
      from public.services s
      join public.service_locations sl on sl.service_id = s.id and sl.location_id = f.location_id
      where s.organization_id = f.organization_id and s.is_active
    ) as starting_price_cents,
    (
      select not lh.is_closed
        and (now() at time zone f.timezone)::time between lh.open_time and lh.close_time
      from public.location_hours lh
      where lh.location_id = f.location_id
        and lh.day_of_week = extract(dow from (now() at time zone f.timezone))::smallint
    ) as is_open_now,
    (
      select count(*)::integer
      from public.queue_entries qe
      where qe.location_id = f.location_id and qe.status = 'waiting'
        and qe.created_at >= (date_trunc('day', now() at time zone f.timezone) at time zone f.timezone)
    ) as queue_waiting_count,
    count(*) over () as total_count
  from filtered f
  order by
    (f.distance_km is not null) desc,
    f.distance_km asc nulls last,
    f.organization_name asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

comment on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer) is
  'Anon-callable establishment search. Largely redundant with search_public_professionals(p_entity_type => ''shop'') — V2_DATA_CONTRACT §7 has it down to be consumed or deprecated — and kept correct in the meantime: it applies B1''s service-area coverage rule so a mobile professional whose zone reaches the customer is not filtered out for living too far away, and it returns location_kind so no consumer reads a NULL address as missing data.';

revoke all on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer) from public;
grant execute on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer) to anon, authenticated, service_role;

commit;
