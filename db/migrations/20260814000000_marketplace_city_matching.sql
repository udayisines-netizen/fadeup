-- Marketplace city matching + removal of seeded demo shops.
--
-- Two separate problems, both making public search untrustworthy.
--
-- 1. The city filter was an exact `ilike`, so a customer typing "combs" found
--    nothing when the stored city is "Combs-la-Ville". City names in France
--    routinely carry a hyphenated suffix that nobody types, so an exact match
--    is the wrong test. Now: exact OR prefix, both accent-insensitive, which
--    keeps "paris" from dragging in unrelated towns while making the common
--    truncation work. The free-text `p_query` path already used a contains
--    match and is unchanged.
--
-- 2. db/seeds/marketplace_demo.sql had been applied to this database, so the
--    only rows public search could return were five invented barbershops.
--    They are development fixtures and must never be a customer's search
--    result. Removed here by their `demo-` slug prefix, which the seed itself
--    assigns; the seed file stays for local development.
--
-- Nothing about the publication boundary changes: `marketplace_visible`
-- remains an explicit opt-in, enforced in the query rather than in React.

CREATE OR REPLACE FUNCTION public.search_public_professionals(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_service_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision, p_min_price_cents integer DEFAULT NULL::integer, p_max_price_cents integer DEFAULT NULL::integer, p_open_now_only boolean DEFAULT false, p_entity_type text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(entity_type text, organization_id uuid, organization_name text, organization_slug text, barber_id uuid, barber_display_name text, barber_avatar_url text, barber_title text, location_id uuid, location_name text, address_line1 text, city text, region text, postal_code text, country text, distance_km double precision, starting_price_cents integer, is_open_now boolean, queue_waiting_count integer, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

comment on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer) is
  'Anon-callable marketplace search returning BOTH shops and individual bookable barbers (entity_type). Only marketplace_visible organizations ever appear; a barber row additionally requires is_bookable/is_active/is_public and an active primary location. Every field is real/live or null — nothing fabricated. City matches exactly or by accent-insensitive prefix so "combs" finds "Combs-la-Ville".';

-- Remove development seed shops from this database. Idempotent, and scoped to
-- the seed's own slug prefix so a real shop can never be caught by it.
do $$
declare
  v_demo_ids uuid[];
begin
  select array_agg(id) into v_demo_ids from public.organizations where slug like 'demo-%';
  if v_demo_ids is null then
    return;
  end if;

  delete from public.organizations where id = any(v_demo_ids);
  raise notice 'removed % seeded demo organization(s) from public search', array_length(v_demo_ids, 1);
end;
$$;
