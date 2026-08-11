-- FadeUp — Marketplace Discovery
-- Migration: opt-in public listing flag + geocoding columns + anon search RPC
--
-- Priority 1 of the FadeUp 2026 rebuild: a real, searchable public
-- marketplace at "/". Until now the ONLY public surface was a direct-link
-- booking page at /s/{known-slug} — no directory, no search, no concept of
-- "this org is publicly listed" (see organizations/locations RLS: both
-- tables grant `authenticated` only, zero anon policies, per
-- 20260809100300_organizations.sql and 20260809110000_locations.sql).
--
-- This migration deliberately does NOT open any anon SELECT policy on
-- organizations/locations/services/queue_entries — same "narrowly-scoped
-- SECURITY DEFINER RPC, not a broad anon policy" pattern already
-- established by 20260809150000_public_booking_reads.sql and
-- 20260809190000_public_barber_profile.sql. search_public_organizations
-- below is the ONLY new anon-readable surface; it returns curated columns
-- only, and only for organizations that opted in via marketplace_visible.
--
-- marketplace_visible is an explicit OPT-IN (default false) — per spec:
-- "Public marketplace eligibility must require an actual FadeUp
-- professional entity ... that is explicitly public/active." An org
-- existing is not enough; an owner (or platform staff) must turn this on.
-- This is intentionally separate from staff_profiles.is_public (which
-- already defaults true and gates one barber's page once you already know
-- the org slug) — marketplace_visible gates whether the ORG is even
-- discoverable via search at all.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'marketplace_visible'
  ) then
    alter table public.organizations add column marketplace_visible boolean not null default false;
  end if;
end $$;

comment on column public.organizations.marketplace_visible is
  'Explicit opt-in: this organization is discoverable via the public marketplace search (search_public_organizations). Default false — existing an org is not enough, an owner/platform staff must publish it. Distinct from staff_profiles.is_public, which gates one barber''s page once the org slug is already known.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'latitude'
  ) then
    alter table public.locations add column latitude double precision;
    alter table public.locations add column longitude double precision;
    alter table public.locations add constraint locations_latitude_range check (latitude is null or (latitude between -90 and 90));
    alter table public.locations add constraint locations_longitude_range check (longitude is null or (longitude between -180 and 180));
  end if;
end $$;

comment on column public.locations.latitude is
  'Nullable — a location only participates in distance-sorted/radius-filtered marketplace search once geocoded. No geocoding pipeline exists yet (out of scope for this migration); set manually or by a future onboarding step.';

-- Distance queries use earthdistance/cube (already-enabled extensions, no
-- PostGIS dependency needed) via ll_to_earth()/earth_distance() in the RPC
-- below. Index only rows that can actually appear in a geo search.
create index if not exists locations_marketplace_geo_idx
  on public.locations using gist (extensions.ll_to_earth(latitude, longitude))
  where latitude is not null and longitude is not null and is_active;

create index if not exists organizations_marketplace_visible_idx
  on public.organizations (marketplace_visible)
  where marketplace_visible;

-- search_public_organizations --------------------------------------------------
-- The one anon-callable marketplace search entry point. Every column
-- returned is real, currently-computable data:
--   - starting_price_cents: min(active service price) actually offered at
--     that location (via service_locations, same explicit-join philosophy
--     as list_public_services)
--   - is_open_now: today's location_hours row evaluated in the location's
--     own timezone
--   - queue_waiting_count: live count of queue_entries in 'waiting' status
--     at that location — the real-time differentiator from spec section 11.
--     Never a fabricated/estimated number.
--   - distance_km: only computed (and only used for radius filtering/sort)
--     when the caller supplies p_latitude/p_longitude AND the location has
--     been geocoded; both null otherwise, never a placeholder distance.
-- No "rating"/"review count" column — no reviews table exists in this
-- schema yet, so nothing is returned for it rather than fabricating a
-- number (see spec section 73: real data only).
--
-- Deterministic ordering only: nearest-first when coordinates are given,
-- else alphabetical by organization name — explainable, no hidden
-- pay-to-win ranking (spec section 10).
create or replace function public.search_public_organizations(
  p_country text default null,
  p_city text default null,
  p_query text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_km double precision default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
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

comment on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, int, int) is
  'Anon-callable marketplace search. Only marketplace_visible organizations with an active location ever appear. Every returned field is real/live data (starting price, open-now, live queue count) or null — nothing fabricated. Deterministic order: nearest-first when coordinates given, else alphabetical.';

revoke execute on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, int, int) from public;
grant execute on function public.search_public_organizations(text, text, text, double precision, double precision, double precision, int, int) to anon, authenticated;

-- set_organization_marketplace_visible -------------------------------------------
-- Owner/manager-only toggle — see spec section 06/46 (Public Profile
-- settings). Deliberately a validated RPC, not a raw UPDATE grant, so
-- publishing is an explicit, audited action rather than any authenticated
-- column write.
create or replace function public.set_organization_marketplace_visible(p_organization_id uuid, p_visible boolean)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.membership_role;
  v_org public.organizations;
begin
  select role into v_role
  from public.memberships
  where organization_id = p_organization_id and user_id = (select auth.uid());

  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager may change marketplace visibility';
  end if;

  update public.organizations set marketplace_visible = p_visible where id = p_organization_id returning * into v_org;
  return v_org;
end;
$$;

comment on function public.set_organization_marketplace_visible(uuid, boolean) is
  'Owner/manager only. Explicit opt-in/opt-out of public marketplace listing for this organization.';

revoke execute on function public.set_organization_marketplace_visible(uuid, boolean) from public, anon;
grant execute on function public.set_organization_marketplace_visible(uuid, boolean) to authenticated;
