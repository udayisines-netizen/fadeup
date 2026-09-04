-- FadeUp — B1, chantier 4 (second half): readiness stops demanding a street.
--
-- >>> APPLY AS supabase_admin ON THE LIVE DATABASE. <<<
--
-- get_organization_readiness is owned by supabase_admin on production — a
-- MASTER file was applied as that role at some point — and `postgres` is NOT a
-- member of it (pg_has_role('postgres','supabase_admin','MEMBER') = false).
--
-- Measured, not assumed, against a database restored from the live dump with
-- the ownership put back:
--
--   as postgres:  DROP FUNCTION ................ succeeds (postgres owns the
--                                                schema, and a schema owner may
--                                                drop objects inside it)
--   as postgres:  COMMENT ON FUNCTION .......... ERROR: must be owner of
--                                                function
--
-- So the file half-applies as postgres and then aborts, which is worse than
-- refusing outright. On a clean replay of db/migrations the function is
-- postgres-owned and either role works — which is exactly why this is a
-- separate file: a migration that only ever passes on a clean replay would
-- have failed on the one database that matters.
--
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < db/migrations/20260904160400_b1_service_area_readiness.sql
--
-- WHAT CHANGES
--
-- has_location_address keeps its exact meaning — a complete postal address
-- exists — because a column that quietly starts meaning something else is
-- worse than a new one. A sibling appears beside it:
--
--   has_service_area  boolean  at least one active location of kind
--                              'service_area' with a defined zone
--
-- and ready_to_publish now asks for (has_location_address OR has_service_area)
-- instead of has_location_address alone. This is where "a location is EITHER
-- an address OR a zone, never neither" is actually enforced: at the moment a
-- business asks to be visible, rather than at row creation, where onboarding
-- legitimately has neither yet.
--
-- missing_requirements gains a consequence: when a business has neither, the
-- entry is 'location_address_or_service_area' rather than 'location_address'.
-- That string is a contract change for whatever P3 screen renders the
-- checklist — it is listed as such in V2_DATA_CONTRACT. Telling a mobile
-- barber to enter a street address is precisely the dead end this chantier
-- exists to remove, so the old string could not be kept.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- DROP then CREATE, not CREATE OR REPLACE: the return type gains
-- has_service_area and Postgres refuses to replace a function whose OUT
-- columns change. The DROP is the second reason this file needs
-- supabase_admin, and it takes the grants with it — they are re-issued below,
-- identical to what pg_proc.proacl held before B1.
drop function if exists public.get_organization_readiness(uuid);

create function public.get_organization_readiness(p_organization_id uuid)
returns table (
  organization_id uuid,
  business_type public.business_type,
  currency text,
  has_business_type boolean,
  has_currency boolean,
  has_location boolean,
  has_location_address boolean,
  has_service_area boolean,
  has_timezone boolean,
  has_professional boolean,
  has_service boolean,
  has_service_at_location boolean,
  has_service_for_professional boolean,
  has_location_hours boolean,
  has_professional_hours boolean,
  has_public_profile boolean,
  ready_to_book boolean,
  ready_to_publish boolean,
  is_published boolean,
  missing_requirements text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_missing text[] := array[]::text[];
  v_ready_to_book boolean;
  v_ready_to_publish boolean;
begin
  -- Same visibility rule as every other org-scoped read in this schema.
  -- SECURITY DEFINER bypasses RLS, so the check has to be explicit.
  if not (
    (select private.is_org_member(p_organization_id))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read readiness for this organization'
      using errcode = '42501';
  end if;

  select
    o.business_type,
    o.currency,
    o.business_type is not null as has_business_type,
    o.currency is not null as has_currency,
    o.marketplace_visible as is_published,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
    ) as has_location,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and l.kind = 'physical_address'
        and nullif(btrim(coalesce(l.address_line1, '')), '') is not null
        and nullif(btrim(coalesce(l.city, '')), '') is not null
        and nullif(btrim(coalesce(l.country, '')), '') is not null
    ) as has_location_address,

    -- The other legitimate answer to "where can a customer be served".
    -- locations_kind_shape already guarantees the three zone columns are
    -- present together on a service_area row, so is_active and the kind are
    -- the whole test.
    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and l.kind = 'service_area'
    ) as has_service_area,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and nullif(btrim(coalesce(l.timezone, '')), '') is not null
    ) as has_timezone,

    -- "Professional" here means what get_public_available_slots requires:
    -- bookable, active, publicly listed, AND attached to a location.
    exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.locations l on l.id = sp.location_id and l.is_active
      where b.organization_id = o.id
        and b.is_bookable and sp.is_active and sp.is_public
    ) as has_professional,

    exists (
      select 1 from public.services s
      where s.organization_id = o.id and s.is_active
    ) as has_service,

    exists (
      select 1
      from public.services s
      join public.service_locations sl on sl.service_id = s.id
      join public.locations l on l.id = sl.location_id and l.is_active
      where s.organization_id = o.id and s.is_active
    ) as has_service_at_location,

    exists (
      select 1
      from public.services s
      join public.barber_services bs on bs.service_id = s.id
      join public.barbers b on b.id = bs.barber_id and b.is_bookable
      join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
      where s.organization_id = o.id and s.is_active
    ) as has_service_for_professional,

    exists (
      select 1
      from public.location_hours lh
      join public.locations l on l.id = lh.location_id and l.is_active
      where l.organization_id = o.id and not lh.is_closed
    ) as has_location_hours,

    exists (
      select 1
      from public.barber_working_hours bwh
      join public.barbers b on b.id = bwh.barber_id and b.is_bookable
      join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
      where b.organization_id = o.id and not bwh.is_off
    ) as has_professional_hours,

    -- Minimum public profile: a real business name (guaranteed by the
    -- not-blank constraint), plus at least one publicly listed professional
    -- carrying a display name. Photos and bios are genuinely optional today
    -- — there is no photo storage for them yet — so requiring them here
    -- would block publication on a capability the product does not have.
    exists (
      select 1
      from public.staff_profiles sp
      where sp.organization_id = o.id and sp.is_public and sp.is_active
        and nullif(btrim(coalesce(sp.display_name, '')), '') is not null
    ) as has_public_profile

  into r
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'organization not found';
  end if;

  -- ready_to_book: every condition get_public_available_slots depends on.
  v_ready_to_book :=
    r.has_location and r.has_timezone and r.has_professional and r.has_service
    and r.has_service_at_location and r.has_service_for_professional
    and r.has_location_hours and r.has_professional_hours;

  -- ready_to_publish additionally needs the marketplace-facing facts: what
  -- kind of business this is, what currency its prices are in, WHERE A
  -- CUSTOMER CAN BE SERVED — an address to travel to or a zone the
  -- professional travels within, MASTER_SPEC §8 makes both legitimate and
  -- forbids faking the first to obtain the second — and a public profile.
  v_ready_to_publish :=
    v_ready_to_book and r.has_business_type and r.has_currency
    and (r.has_location_address or r.has_service_area) and r.has_public_profile;

  if not r.has_business_type then v_missing := array_append(v_missing, 'business_type'); end if;
  if not r.has_currency then v_missing := array_append(v_missing, 'currency'); end if;
  if not r.has_location then v_missing := array_append(v_missing, 'location'); end if;
  if not (r.has_location_address or r.has_service_area) then
    v_missing := array_append(v_missing, 'location_address_or_service_area');
  end if;
  if not r.has_timezone then v_missing := array_append(v_missing, 'timezone'); end if;
  if not r.has_professional then v_missing := array_append(v_missing, 'professional'); end if;
  if not r.has_service then v_missing := array_append(v_missing, 'service'); end if;
  if not r.has_service_at_location then v_missing := array_append(v_missing, 'service_at_location'); end if;
  if not r.has_service_for_professional then v_missing := array_append(v_missing, 'service_for_professional'); end if;
  if not r.has_location_hours then v_missing := array_append(v_missing, 'location_hours'); end if;
  if not r.has_professional_hours then v_missing := array_append(v_missing, 'professional_hours'); end if;
  if not r.has_public_profile then v_missing := array_append(v_missing, 'public_profile'); end if;

  return query select
    p_organization_id,
    r.business_type, r.currency,
    r.has_business_type, r.has_currency, r.has_location, r.has_location_address,
    r.has_service_area,
    r.has_timezone, r.has_professional, r.has_service, r.has_service_at_location,
    r.has_service_for_professional, r.has_location_hours, r.has_professional_hours,
    r.has_public_profile,
    v_ready_to_book, v_ready_to_publish, r.is_published, v_missing;
end;
$$;

comment on function public.get_organization_readiness(uuid) is
  'Org-member or platform-admin. The publication checklist. ready_to_publish requires a place a customer can be served, and B1 made that EITHER a complete postal address on a physical_address location OR an active service_area location — a mobile professional is no longer told to invent a street. has_location_address keeps its literal meaning; has_service_area is the sibling; missing_requirements reports ''location_address_or_service_area'' when neither is present.';

revoke all on function public.get_organization_readiness(uuid) from public, anon;
grant execute on function public.get_organization_readiness(uuid) to postgres, authenticated, service_role;

commit;
