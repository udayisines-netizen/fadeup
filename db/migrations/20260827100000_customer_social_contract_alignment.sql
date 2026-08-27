-- FadeUp — Customer API Freeze: align public barber surfaces with R1B Follow
--
-- Product boundary:
--   shop         -> Favorite / bookmark
--   professional -> Follow
--
-- Existing customer_favorites rows with barber_id IS NOT NULL are historical
-- compatibility data. They are deliberately preserved, but no NEW barber
-- favorites may be created after this migration.
--
-- The durable social identifier is professionals.id. barbers.id remains the
-- operational roster/booking identifier. Public operational contracts expose
-- professional_id only for a linked CLAIMED identity.
--
-- Append-only after Service Mode.

set lock_timeout = '5s';

-- ============================================================================
-- 1. Public operational barber contracts gain nullable professional_id
-- ============================================================================

drop function if exists public.list_public_organization_barbers(text);

create function public.list_public_organization_barbers(p_organization_slug text)
returns table (
  barber_id uuid,
  professional_id uuid,
  display_name text,
  title text,
  avatar_url text,
  location_id uuid,
  location_name text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    b.id,
    case when p.claim_state = 'claimed' then p.id else null end,
    sp.display_name,
    sp.title,
    sp.avatar_url,
    l.id,
    l.name
  from public.barbers b
  left join public.professionals p on p.id = b.professional_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  left join public.locations l on l.id = sp.location_id and l.is_active
  where o.slug = p_organization_slug
    and b.is_bookable
    and sp.is_active
    and sp.is_public
  order by sp.display_name;
$$;

comment on function public.list_public_organization_barbers(text) is
  'Anon-callable: every public, bookable barber for an organization (its full team roster), by slug — powers the shop profile "browse team" screen. location_id/location_name are null if the barber has no active primary location set yet.';

revoke execute on function public.list_public_organization_barbers(text) from public;
grant execute on function public.list_public_organization_barbers(text) to anon, authenticated;

comment on function public.list_public_organization_barbers(text) is
  'Anon-callable public shop roster. professional_id is exposed only for a claimed durable Professional identity; it is NULL for an operational barber without a currently claimed identity. The id is a public relationship key, not operational state.';

drop function if exists public.get_public_barber(text, uuid);

create function public.get_public_barber(p_organization_slug text, p_barber_id uuid)
returns table (
  barber_id uuid,
  professional_id uuid,
  display_name text,
  title text,
  bio text,
  avatar_url text,
  location_id uuid
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    b.id,
    case when p.claim_state = 'claimed' then p.id else null end,
    sp.display_name,
    sp.title,
    sp.bio,
    sp.avatar_url,
    sp.location_id
  from public.barbers b
  left join public.professionals p on p.id = b.professional_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  where o.slug = p_organization_slug
    and b.id = p_barber_id
    and b.is_bookable
    and sp.is_active
    and sp.is_public;
$$;

comment on function public.get_public_barber(text, uuid) is
  'Anon-callable: one public, bookable barber''s profile by id, scoped to organization_slug, including their primary location_id so a booking link can preselect it. Zero rows if the barber is not public/bookable/active or belongs to a different org.';

revoke execute on function public.get_public_barber(text, uuid) from public;
grant execute on function public.get_public_barber(text, uuid) to anon, authenticated;

comment on function public.get_public_barber(text, uuid) is
  'Anon-callable operational barber profile scoped through organization_slug. professional_id is returned only when the linked durable Professional is claimed; NULL otherwise. No private follow state, customer data, claim workflow or acquisition provenance is exposed.';


-- ============================================================================
-- 2. Marketplace gains nullable professional_id
-- ============================================================================

drop function if exists public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer);

CREATE FUNCTION public.search_public_professionals(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_service_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision, p_min_price_cents integer DEFAULT NULL::integer, p_max_price_cents integer DEFAULT NULL::integer, p_open_now_only boolean DEFAULT false, p_entity_type text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(entity_type text, organization_id uuid, organization_name text, organization_slug text, barber_id uuid, professional_id uuid, barber_display_name text, barber_avatar_url text, barber_title text, location_id uuid, location_name text, address_line1 text, city text, region text, postal_code text, country text, distance_km double precision, starting_price_cents integer, is_open_now boolean, queue_waiting_count integer, total_count bigint)
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
  'Anon-callable marketplace search for shops and operational barber placements. barber_id remains the booking/roster identifier. professional_id is NULL for shops and for barbers without a currently claimed durable identity; it is the canonical key for Follow when present.';

revoke execute on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer) from public;
grant execute on function public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer) to anon, authenticated;

-- ============================================================================
-- 3. customer_favorites becomes SHOP-ONLY for new writes
--
-- NOT VALID is deliberate:
-- existing historical barber favorites survive untouched, but PostgreSQL
-- enforces the CHECK for every NEW/updated row.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_favorites'::regclass
      and conname = 'customer_favorites_new_rows_shop_only'
  ) then
    alter table public.customer_favorites
      add constraint customer_favorites_new_rows_shop_only
      check (barber_id is null)
      not valid;
  end if;
end
$$;

comment on constraint customer_favorites_new_rows_shop_only
  on public.customer_favorites is
  'V2 boundary: new favorites are shop bookmarks only. Historical barber favorites remain readable/removable for compatibility but cannot be recreated. Professionals use professional_follows.';

-- ============================================================================
-- 4. Stable customer-facing SHOP favorite write contracts
-- ============================================================================

create or replace function public.favorite_shop(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'favorite requires an authenticated session'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
  ) then
    raise exception 'organization not found'
      using errcode = '42704';
  end if;

  insert into public.customer_favorites (
    user_id,
    organization_id,
    barber_id
  )
  values (
    v_user_id,
    p_organization_id,
    null
  )
  on conflict (user_id, organization_id)
    where barber_id is null
    do nothing;
end;
$$;

comment on function public.favorite_shop(uuid) is
  'Authenticated customer bookmark contract for shops. Actor identity is always auth.uid(); callers cannot create barber favorites or write on behalf of another account.';

revoke execute on function public.favorite_shop(uuid) from public, anon;
grant execute on function public.favorite_shop(uuid) to authenticated;

create or replace function public.remove_favorite(p_favorite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'remove favorite requires an authenticated session'
      using errcode = '42501';
  end if;

  delete from public.customer_favorites f
  where f.id = p_favorite_id
    and f.user_id = v_user_id;
end;
$$;

comment on function public.remove_favorite(uuid) is
  'Authenticated removal contract for the caller own favorite. Also lets customers remove historical pre-V2 barber favorites without permitting new barber favorites. A foreign/nonexistent id is an indistinguishable no-op.';

revoke execute on function public.remove_favorite(uuid) from public, anon;
grant execute on function public.remove_favorite(uuid) to authenticated;

-- Browser clients no longer mutate the table directly.
revoke insert, update, delete
  on public.customer_favorites
  from anon, authenticated;
