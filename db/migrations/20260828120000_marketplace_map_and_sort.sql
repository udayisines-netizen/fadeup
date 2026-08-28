begin;

-- ============================================================================
-- FadeUp R5 — the marketplace read contract the map and the sort control need
--
-- R5 builds a list/map marketplace with explicit sort options. Two things stood
-- in the way, and both are read-projection gaps rather than model gaps:
--
--   1. NO COORDINATES. `search_public_professionals` ACCEPTS a latitude and a
--      longitude and computes `distance_km` from them, but returns neither, so
--      a result set cannot be plotted. A map fed by a second per-result lookup
--      would be N+1 requests to render one screen.
--
--   2. NO TIMEZONE. The projection carries `timezone` internally — the
--      open-now and queue-window subqueries both depend on it — and drops it
--      at the final SELECT. R5's availability label ("From 17:30") must format
--      in the SHOP's zone, and without it every card would need a separate
--      `list_public_locations` call before it could print a time.
--
-- WHY EXPOSING COORDINATES DISCLOSES NOTHING NEW
--
-- Every row this function returns already carries `address_line1`, `city`,
-- `postal_code` and `country` for an ACTIVE location of a `marketplace_visible`
-- organization. A shop that has opted into a public marketplace and published
-- its street address has published where it is; the latitude and longitude are
-- that same fact in a machine-readable form. No row becomes visible that was
-- not visible before, and the WHERE clauses are untouched.
--
-- WHY SORT IS A PARAMETER AND NOT A CLIENT-SIDE ORDERING
--
-- The function is paged (`p_limit`/`p_offset`). Sorting a page in the browser
-- sorts the wrong twenty-four rows: "cheapest first" over the first page of a
-- distance-ordered result is not the cheapest, it is the cheapest of the
-- nearest. Ordering has to happen where the whole set is.
--
-- WHAT `recommended` MEANS TODAY, SAID PLAINLY
--
-- `recommended` is the EXISTING ordering, unchanged: rows with a distance
-- first, then by distance, then alphabetically. It is not a score, there is no
-- model behind it, and R5 deliberately does not invent one — §12 assigns
-- ranking to a later backend lot. Shipping the parameter now means that lot
-- changes one CASE arm instead of changing every caller.
--
-- The sort options this migration does NOT provide are as deliberate:
--
--   available_soonest   availability is a function of (location, professional,
--                       SERVICE, date). This query has no service, so it
--                       cannot answer the question for a shop at all.
--   rating              there is no reviews table in this schema.
--
-- Neither is stubbed. An option that silently falls back to `recommended`
-- would let the UI offer a sort that does nothing, which is worse than not
-- offering it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

set lock_timeout = '5s';

-- The old 13-argument signature must go before the 14-argument one can be
-- created: Postgres would otherwise keep both, and a 13-argument call would
-- become ambiguous the moment the new one's trailing DEFAULT applies.
drop function if exists public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer
);

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
  -- Trailing, with a default, so every existing 13-argument call site keeps
  -- working and keeps its current ordering.
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
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with shop_base as (
    select
      'shop'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
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
      and (p_entity_type is null or p_entity_type = 'shop')
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
      and (p_entity_type is null or p_entity_type = 'barber')
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
        -- Two corrections over the original Wave 1 definition (see
        -- 20260813160000_claim_scope_fix.sql for the reasoning):
        --   1. Bounded to TODAY in the location's own timezone. Nothing in
        --      this schema ever expires a 'waiting' queue_entries row, so an
        --      unbounded count happily advertises a queue from last week as
        --      a live wait.
        --   2. A barber row counts only entries actually assigned to that
        --      barber. Counting unassigned (barber_id is null) entries
        --      towards every barber told each of them the shop-wide number
        --      as if it were their own line.
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
    count(*) over () as total_count
  from filtered f
  order by
    -- NEAREST. A row with no distance (no coordinates, or the customer gave
    -- no position) sorts last rather than first: `nulls last` on the value
    -- alone would still place unknown-distance rows ahead of a 40km one under
    -- a descending arm, and "nearest" must never lead with "unknown".
    case when p_sort = 'nearest' then (f.distance_km is null) end asc,
    case when p_sort = 'nearest' then f.distance_km end asc nulls last,

    -- PRICE, cheapest first. A shop with no published service has no starting
    -- price; it sorts after every priced one instead of reading as free.
    case when p_sort = 'price' then (f.starting_price_cents is null) end asc,
    case when p_sort = 'price' then f.starting_price_cents end asc nulls last,

    -- RECOMMENDED — and the fallback for any unrecognised value, so a stale
    -- client sending a sort this function has never heard of gets the default
    -- ordering rather than an error or an arbitrary one.
    (f.distance_km is not null) desc,
    f.distance_km asc nulls last,
    f.organization_name asc,
    coalesce(f.barber_display_name, '') asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$function$;

comment on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) is
  'Anon-callable marketplace search for shops and operational barber placements. barber_id remains the booking/roster identifier; professional_id is NULL for shops and for barbers without a currently claimed durable identity, and is the canonical key for Follow when present. R5 adds latitude/longitude/timezone to the projection — no new ROW becomes visible, these are the same publicly-listed locations whose street address the function already returned — and a p_sort parameter accepting recommended (default, the pre-R5 ordering), nearest and price. There is deliberately no available_soonest (availability needs a service, which this query has no notion of) and no rating (no reviews table exists); an unrecognised value falls back to recommended.';

revoke execute on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) from public;

grant execute on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) to anon, authenticated;

commit;
