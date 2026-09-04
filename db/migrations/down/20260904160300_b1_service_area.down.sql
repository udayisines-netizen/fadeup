-- FadeUp — B1 chantier 4, rollback.
--
-- Removes the service-area model: locations.kind, the three zone columns,
-- their four CHECK constraints, the distance helper, and the coverage arm of
-- both search RPCs. list_public_locations, search_public_professionals and
-- search_public_organizations return to the shapes they had at the end of
-- chantier 3 (i.e. WITH the marketplace-supply default fix, which is a
-- different migration and is not undone here).
--
-- DATA CONSEQUENCE, STATED BEFORE IT HAPPENS. Any location that was declared a
-- service area is converted back to 'physical_address' and loses its centre
-- and radius. It keeps its name, city, region, country and timezone, and it
-- has no street address — which is exactly the state P1c's mobile barber was
-- in before B1, and exactly the reason B1 exists. Nothing is deleted; the zone
-- definition is what is lost, and re-applying the migration does not bring it
-- back. Write the centre and radius down before running this.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- 1. The RPCs first: they reference the columns dropped in step 3.
drop function if exists public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text);
drop function if exists public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer);
drop function if exists public.list_public_locations(text);

create function public.list_public_locations(p_organization_slug text)
returns table (
  id uuid,
  name text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $ldef$
  select l.id, l.name, l.address_line1, l.address_line2, l.city, l.region, l.postal_code, l.country, l.timezone
  from public.locations l
  join public.organizations o on o.id = l.organization_id
  where o.slug = p_organization_slug and l.is_active;
$ldef$;

revoke all on function public.list_public_locations(text) from public;
grant execute on function public.list_public_locations(text) to anon, authenticated, service_role;

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
  address_line1 text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
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
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
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
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
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
    where (p_radius_km is null or distance_km is null or distance_km <= p_radius_km)
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
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.latitude,
    f.longitude,
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
  p_latitude         float8  NULL   with p_longitude, populates distance_km; alone it does nothing
  p_longitude        float8  NULL   idem
  p_radius_km        float8  NULL   drops rows further than this; a row with unknown distance is KEPT, never invented
  p_min_price_cents  int     NULL   floor on the "from" price; a row with no published price passes
  p_max_price_cents  int     NULL   ceiling on the "from" price; same rule
  p_open_now_only    bool    false  keeps only rows whose location_hours say open right now, in the location timezone
  p_entity_type      text    NULL   ''shop'' | ''barber'' | ''all''; NULL, empty and unknown all mean ''shop''
  p_limit            int     20     page size, floored at 0
  p_offset           int     0      page offset, floored at 0
  p_sort             text    ''recommended''  ''recommended'' | ''nearest'' | ''price''; unknown values fall back to recommended

Returned per row: identity and slug of the organization, the barber columns on barber rows only, the location and its coordinates, distance_km when a position was given, starting_price_cents (the real minimum of active bookable services, NULL when there is none), is_open_now, queue_waiting_count bounded to today in the location timezone, the windowed exact total_count, and marketplace_supply_type (independent | barbershop | NULL).';

CREATE OR REPLACE FUNCTION public.search_public_organizations(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS TABLE(organization_id uuid, organization_name text, organization_slug text, location_id uuid, location_name text, address_line1 text, city text, region text, postal_code text, country text, distance_km double precision, starting_price_cents integer, is_open_now boolean, queue_waiting_count integer, total_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with base as (
    select
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      l.id as location_id,
      l.name as location_name,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
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
  filtered as (
    select * from base
    where p_radius_km is null or distance_km is null or distance_km <= p_radius_km
  )
  select
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.location_id,
    f.location_name,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
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
    ) as queue_waiting_count,
    count(*) over () as total_count
  from filtered f
  order by (f.distance_km is not null) desc, f.distance_km asc nulls last, f.organization_name asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer) from public;
grant execute on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer) to anon, authenticated, service_role;


revoke all on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text) from public;
grant execute on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text) to anon, authenticated, service_role;

-- 2. Zones become address-less physical locations again.
update public.locations
set kind = 'physical_address',
    service_area_center_latitude = null,
    service_area_center_longitude = null,
    service_area_radius_km = null
where kind = 'service_area';

-- 3. The columns, their constraints and the type.
alter table public.locations
  drop constraint if exists locations_service_area_has_no_address,
  drop constraint if exists locations_service_area_radius_range,
  drop constraint if exists locations_service_area_center_range,
  drop constraint if exists locations_kind_shape;

drop index if exists public.locations_service_area_idx;

alter table public.locations
  drop column if exists service_area_radius_km,
  drop column if exists service_area_center_longitude,
  drop column if exists service_area_center_latitude,
  drop column if exists kind;

drop type if exists public.location_kind;

drop function if exists private.point_distance_km(double precision, double precision, double precision, double precision);

commit;
