begin;

-- ============================================================================
-- FadeUp R5R.1A — the marketplace supply contract
--
-- WHAT IS MISSING, AND WHY IT BLOCKS THE CUSTOMER PRODUCT
--
-- FadeUp's customer marketplace has exactly two kinds of supply: INDEPENDENT (a
-- professional who is their own business) and BARBERSHOP (a bookable shop
-- location). The authoritative fact behind that distinction already exists and
-- is already correct — `organizations.business_type` — and it is the one thing
-- the public read contract does not return.
--
-- So the customer frontend cannot tell the two apart. It was verified, before
-- this migration, that there is no other route to it:
--
--   * `search_public_professionals` does not return it;
--   * `get_public_organization` returns (id, name, slug, currency, country_code);
--   * `search_public_organizations` has no type column;
--   * RLS on `organizations` restricts SELECT to org members and platform
--     admins, so an `anon` caller reads ZERO rows;
--   * the only functions referencing `business_type` are
--     `get_organization_readiness`, `review_professional_application` and
--     `save_business_profile`, none executable by `anon`.
--
-- The alternatives available to a frontend were all forms of guessing — infer
-- from barber count, infer from the organization name — and each is wrong for
-- an ordinary case (a one-chair barbershop is not an independent). This
-- migration removes the need to guess.
--
-- WHY EXPOSING IT DISCLOSES NOTHING NEW
--
-- Every row this function returns is already an ACTIVE location of a
-- `marketplace_visible` organization, and already carries that organization's
-- name, slug, street address, city, postal code, country and coordinates. A
-- coarse business category of a business that has opted into a public
-- marketplace and published its street address is strictly less revealing than
-- what the same row already prints.
--
-- Critically, NO WHERE CLAUSE CHANGES. Not one row becomes visible that was not
-- visible before; a hidden or non-marketplace organization cannot be
-- discovered through this change, and `organizations` remains unreadable to
-- `anon`. This is the same reasoning 20260828120000 used to add coordinates.
--
-- And what is exposed is LESS than the column behind it: five internal values
-- collapse to two customer-facing ones, so a caller cannot even tell a
-- `hair_salon` from a `mixed_salon`, or a branch of a chain from a standalone
-- shop.
--
-- WHY A DERIVED LABEL AND NOT THE RAW ENUM
--
-- An earlier draft of this migration returned `organizations.business_type`
-- verbatim and left the mapping to the frontend, on the reasoning that one
-- product rule should live in one place. That was the wrong trade for a PUBLIC
-- contract, and it was corrected before this migration was ever committed.
--
-- Returning the raw enum publishes FadeUp's internal organization modelling to
-- every anonymous client: `hair_salon` and `mixed_salon` are distinctions the
-- customer marketplace does not make, and `multi_location` is a Pro concept
-- that describes an organization's topology rather than anything a customer
-- books. A public contract that leaks it invites clients to couple to it, and
-- then the enum can never change without breaking them.
--
-- So the contract exposes only what the customer product actually means:
-- `independent` or `barbershop`. The internal enum stays internal, free to gain
-- values without touching a single consumer.
--
-- The mapping is enumerated value by value rather than with a catch-all `else
-- barbershop`, so an unhandled business type resolves to NULL and renders no
-- label. Guessing would be worse than silence: a listing that calls itself a
-- Barbershop because nothing told it otherwise is a fabricated classification.
--
-- `multi_location` STAYS `multi_location` IN THE DATABASE. It is a real
-- organizational type and is not renamed, flattened or merged. It is the
-- CUSTOMER presentation that flattens: each eligible location of such an
-- organization is already returned as its own row by `shop_base`, and the
-- frontend renders every one of them as an ordinary Barbershop. The hierarchy
-- Organization -> Location -> Professional is untouched.
--
-- WHY DROP AND CREATE RATHER THAN CREATE OR REPLACE
--
-- PostgreSQL cannot change a function''s return type with CREATE OR REPLACE —
-- "cannot change return type of existing function" — and appending a column to
-- a RETURNS TABLE is a return-type change. The drop is therefore unavoidable.
-- It is done with the EXACT 14-argument signature, inside this transaction,
-- and WITHOUT CASCADE: there are no dependent views, rules or constraints on
-- this function (verified), so a cascade could only ever hide damage rather
-- than prevent it. Grants are restored explicitly below.
--
-- WHAT IS PRESERVED, EXACTLY
--
--   * all 14 parameters — names, types, order and defaults;
--   * every existing result column, in its existing position, with its
--     existing type and meaning: total_count, distance_km, is_open_now,
--     queue_waiting_count, starting_price_cents included;
--   * every WHERE clause, filter, join and sort arm;
--   * SECURITY DEFINER, STABLE, and `set search_path = ''`;
--   * the grants: anon and authenticated, with EXECUTE revoked from public.
--
-- The only change is one appended column, `marketplace_supply_type`.
--
-- Idempotent: safe to re-run.
-- ============================================================================

set lock_timeout = '5s';

-- Exact current signature. No CASCADE — nothing depends on this function, and
-- if something did, this migration should fail loudly rather than drop it.
drop function if exists public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
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
  total_count bigint,
  -- APPENDED. Every column above keeps its position and its type.
  marketplace_supply_type text
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
    count(*) over () as total_count,
    f.marketplace_supply_type
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
  'Anon-callable marketplace search for shops and operational barber placements. barber_id remains the booking/roster identifier; professional_id is NULL for shops and for barbers without a currently claimed durable identity, and is the canonical key for Follow when present. Returns latitude/longitude/timezone for map and local-time rendering, and a p_sort parameter accepting recommended (default), nearest and price; an unrecognised value falls back to recommended. R5R.1A appends marketplace_supply_type, the CUSTOMER-FACING classification of the row''s organization: independent (organizations.business_type = solo_professional) or barbershop (barbershop, hair_salon, mixed_salon and multi_location alike), and NULL for any business type this function does not yet classify. The raw enum is deliberately not exposed — hair_salon/mixed_salon are distinctions the customer marketplace does not make, and multi_location describes internal topology; a location of a multi-location organization is an ordinary barbershop to a customer. No row becomes visible that was not visible before: the value describes an organization that is already marketplace_visible and whose street address this function already returns, and organizations itself remains unreadable to anon.';

revoke execute on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) from public;

grant execute on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) to anon, authenticated;

commit;
