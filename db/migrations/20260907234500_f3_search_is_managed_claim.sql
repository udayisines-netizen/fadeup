-- ============================================================================
-- F3 v2 — is_managed : la revendication rattachée compte comme gestion
-- ============================================================================
--
-- À APPLIQUER EN postgres (propriétaire de la fonction, inchangé).
--
-- La revue indépendante F3 a mesuré une contradiction : demo-maison-kais
-- portait « Pas encore géré sur FadeUp » en résultat de recherche pendant
-- que /pro/demo.kais.bellamine (identité revendiquée, rattachée à ce salon)
-- affichait « Revendiqué ». La sémantique v1 (memberships seulement)
-- ignorait la seule notion de revendication qui existe en base — celle des
-- identités professionnelles (B1). v2 : un établissement est géré s'il a un
-- membre OU une identité revendiquée rattachée. Mesure après application :
-- side-agency, demo-maison-kais et demo-atelier-fadel gérés ; les six
-- établissements purement scrapés/démo restent non gérés — le cas de
-- lancement que le badge neutre doit dire.
--
-- Le type de retour ne change pas : CREATE OR REPLACE (l'ACL et le
-- propriétaire sont préservés — DB_OWNERSHIP §2.3) ; l'ACL est re-vérifiée
-- par la sonde après application.
-- ============================================================================

begin;

create or replace function public.search_public_professionals(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_service_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision, p_min_price_cents integer DEFAULT NULL::integer, p_max_price_cents integer DEFAULT NULL::integer, p_open_now_only boolean DEFAULT false, p_entity_type text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_sort text DEFAULT 'recommended'::text)
 RETURNS TABLE(entity_type text, organization_id uuid, organization_name text, organization_slug text, barber_id uuid, professional_id uuid, barber_display_name text, barber_avatar_url text, barber_title text, location_id uuid, location_name text, location_kind location_kind, address_line1 text, city text, region text, postal_code text, country text, latitude double precision, longitude double precision, service_area_center_latitude double precision, service_area_center_longitude double precision, service_area_radius_km double precision, covers_search_point boolean, timezone text, distance_km double precision, starting_price_cents integer, is_open_now boolean, queue_waiting_count integer, total_count bigint, marketplace_supply_type text, is_managed boolean)
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
      ,
      -- F3 v2 (après revue indépendante). "Managed on FadeUp" pour un
      -- établissement : un MEMBRE réel (memberships — tout chemin produit de
      -- création d'organisation en pose un), OU une identité professionnelle
      -- REVENDIQUÉE rattachée (la frontière B1 exacte — celle que /pro
      -- affiche « Revendiqué »). Sans ce second bras, la recherche disait
      -- « Pas encore géré sur FadeUp » sous un établissement dont le barber
      -- revendiqué affichait « Revendiqué » sur son propre profil —
      -- contradiction mesurée par la revue F3 sur demo-maison-kais.
      (
        exists (
          select 1 from public.memberships m where m.organization_id = o.id
        )
        or exists (
          select 1
          from public.barbers b2
          join public.professionals p2 on p2.id = b2.professional_id
          where b2.organization_id = o.id and p2.claim_state = 'claimed'
        )
      ) as is_managed
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
      ,
      -- F3. A barber row is "managed" when its durable identity is claimed —
      -- the same boundary get_public_barber draws for professional_id. The
      -- coalesce is the X3 invariant: a barber with NO linked identity is
      -- not-managed (false), never unknown (NULL).
      coalesce(p.claim_state = 'claimed', false) as is_managed
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
    f.marketplace_supply_type,
    f.is_managed
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
$function$;

commit;
