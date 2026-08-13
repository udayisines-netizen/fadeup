-- FadeUp — Wave 1: marketplace professionals (barbers as first-class results)
-- Migration: search_public_professionals RPC
--
-- Extends the marketplace search added in 20260811160000_marketplace_discovery.sql.
-- That RPC (search_public_organizations, kept as-is for backward compat) only
-- ever returns shop/location rows — a customer can pick a shop but never an
-- individual barber. Per Wave 1 spec: "Individual barbers are FIRST-CLASS
-- marketplace entities... a customer must be able to choose a barber, not
-- merely a salon."
--
-- search_public_professionals unions two result shapes (entity_type =
-- 'shop' | 'barber') under one deterministic ranking so the frontend can
-- render a single mixed result list. Same anon-facing philosophy as every
-- other public RPC in this codebase: narrowly-scoped SECURITY DEFINER,
-- curated columns only, every eligibility check re-derived server-side.
--
-- Eligibility for a 'shop' row: unchanged from search_public_organizations
-- (org.marketplace_visible, location.is_active).
-- Eligibility for a 'barber' row: org.marketplace_visible (a barber's shop
-- must itself be published — an independent barber's own one-person
-- organization opts in the same way any shop does; there is no separate
-- "independent" flag because none is needed), barbers.is_bookable,
-- staff_profiles.is_active + is_public, and the barber's primary location
-- (staff_profiles.location_id) must be active. This reuses the exact same
-- "single primary location" simplification list_public_barbers already
-- documents (20260809150000_public_booking_reads.sql) rather than inventing
-- new multi-location-per-barber modeling for this migration.
--
-- Documented scope cut: this schema has no concept of a mobile/no-fixed-
-- location barber or a privacy-safe "service area" (city/district/radius
-- instead of an address) — staff_profiles.location_id is required (not
-- null) for a barber to appear here. Building that modeling from scratch
-- was judged out of scope for Wave 1 (spec: "do not blindly implement...
-- if the repository has a better existing model" — here the repository has
-- no model at all yet, and inventing one un-requested by any other part of
-- the schema would be exactly the kind of premature abstraction CLAUDE.md
-- warns against). Flagged for Wave 2 if mobile barbers become a real need.
--
-- Idempotent: safe to re-run.

create or replace function public.search_public_professionals(
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
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  entity_type text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  barber_id uuid,
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
  distance_km double precision,
  starting_price_cents integer,
  is_open_now boolean,
  queue_waiting_count integer,
  total_count bigint
)
language sql
security definer
stable
set search_path = ''
as $$
  with shop_base as (
    select
      'shop'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      null::uuid as barber_id,
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
      and (p_city is null or l.city ilike p_city)
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
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
    from public.barbers b
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
      and (p_city is null or l.city ilike p_city)
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
        select count(*)::integer
        from public.queue_entries qe
        where qe.location_id = c.location_id and qe.status = 'waiting'
          and (c.entity_type = 'shop' or qe.barber_id = c.barber_id or qe.barber_id is null)
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
    f.distance_km,
    f.starting_price_cents,
    f.is_open_now,
    f.queue_waiting_count,
    count(*) over () as total_count
  from filtered f
  order by (f.distance_km is not null) desc, f.distance_km asc nulls last, f.organization_name asc, coalesce(f.barber_display_name, '') asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

comment on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, int, int) is
  'Anon-callable marketplace search returning BOTH shops and individual bookable barbers (entity_type). Only marketplace_visible organizations ever appear; a barber row additionally requires is_bookable/is_active/is_public and an active primary location. Every field is real/live or null — nothing fabricated. Server-side filters: text query, service name, city/country, radius, price range, open-now.';

revoke execute on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, int, int) from public;
grant execute on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, int, int) to anon, authenticated;

-- Helpful for the barber-eligibility branch above (WHERE b.is_bookable / sp.is_public+is_active are now hit on every marketplace search, not just per-org profile lookups).
create index if not exists barbers_is_bookable_idx on public.barbers (is_bookable) where is_bookable;
create index if not exists staff_profiles_public_active_idx on public.staff_profiles (is_public, is_active) where is_public and is_active;
