-- FadeUp — B1 chantier 4 (readiness), rollback.
--
-- >>> APPLY AS supabase_admin ON THE LIVE DATABASE. <<<
-- Same ownership reason as the migration it undoes.
--
-- Restores get_organization_readiness without has_service_area: publication
-- once again demands a complete postal address, and a mobile professional is
-- once again told to invent a street or be published by hand. No data is
-- touched.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

drop function if exists public.get_organization_readiness(uuid);

CREATE FUNCTION public.get_organization_readiness(p_organization_id uuid) RETURNS TABLE(organization_id uuid, business_type public.business_type, currency text, has_business_type boolean, has_currency boolean, has_location boolean, has_location_address boolean, has_timezone boolean, has_professional boolean, has_service boolean, has_service_at_location boolean, has_service_for_professional boolean, has_location_hours boolean, has_professional_hours boolean, has_public_profile boolean, ready_to_book boolean, ready_to_publish boolean, is_published boolean, missing_requirements text[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
        and nullif(btrim(coalesce(l.address_line1, '')), '') is not null
        and nullif(btrim(coalesce(l.city, '')), '') is not null
        and nullif(btrim(coalesce(l.country, '')), '') is not null
    ) as has_location_address,

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
  -- kind of business this is, what currency its prices are in, where it
  -- physically is (search filters on city/country), and a public profile.
  v_ready_to_publish :=
    v_ready_to_book and r.has_business_type and r.has_currency
    and r.has_location_address and r.has_public_profile;

  if not r.has_business_type then v_missing := array_append(v_missing, 'business_type'); end if;
  if not r.has_currency then v_missing := array_append(v_missing, 'currency'); end if;
  if not r.has_location then v_missing := array_append(v_missing, 'location'); end if;
  if not r.has_location_address then v_missing := array_append(v_missing, 'location_address'); end if;
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
    r.has_timezone, r.has_professional, r.has_service, r.has_service_at_location,
    r.has_service_for_professional, r.has_location_hours, r.has_professional_hours,
    r.has_public_profile,
    v_ready_to_book, v_ready_to_publish, r.is_published, v_missing;
end;
$$;

comment on function public.get_organization_readiness(uuid) is null;

revoke all on function public.get_organization_readiness(uuid) from public, anon;
grant execute on function public.get_organization_readiness(uuid) to postgres, authenticated, service_role;

commit;
