-- FadeUp — LOT B: business profile + a professional onboarding that actually
--                  produces a bookable business
--
-- THE PROBLEM THIS SOLVES
--
--   Audited live state before this migration: 4 organizations, 0 services,
--   0 location_hours, 0 barber_working_hours, 0 appointments. Not a seeding
--   accident — the structural consequence of two things:
--
--     1. complete_organization_onboarding() collects four fields (name,
--        slug, location name, timezone) and stops. Everything a booking
--        actually needs — a service, a bookable professional, opening hours,
--        working hours — had to be assembled by hand afterwards across four
--        separate admin pages, with nothing telling the owner what was
--        still missing.
--     2. review_professional_application() creates the organization and the
--        owner membership but NO location, and discards the address the
--        applicant already typed into their application. An approved shop
--        therefore starts with zero locations, and the self-serve
--        onboarding form is never shown to them because they already hold a
--        membership.
--
--   Nothing here rebuilds services, availability, booking or memberships.
--   Those foundations were audited as sound. This migration adds the
--   business-identity columns they were missing, one authoritative readiness
--   evaluator over the state they already store, idempotent RPCs the wizard
--   drives, and a server-side publication gate.
--
-- WHAT "BOOKABLE" MEANS, EXACTLY
--
--   get_public_available_slots() returns rows only when ALL of these hold.
--   The readiness evaluator below is derived from that function's real
--   requirements rather than from a wish list, which is why it can honestly
--   promise that ready_to_book = true implies slots exist:
--
--     active location  ->  location_hours row for the day, not closed
--     active service   ->  offered at that location (service_locations)
--     bookable barber  ->  is_bookable + staff_profiles.is_active/is_public
--                          + staff_profiles.location_id = that location
--                          + barber_services link to that service
--                          + barber_working_hours row for the day, not off
--
-- NAMING
--
--   barbers / barber_id / barber_services / barber_working_hours keep their
--   names. They are internal identifiers for "a professional who takes
--   appointments", the audit found them to be a cosmetic rather than
--   structural constraint, and renaming them would touch every RLS policy
--   in the schema for zero product value. business_type below is what
--   actually carries the hair-salon / mixed-salon / multi-location domain.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Business identity columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'business_type') then
    create type public.business_type as enum (
      'solo_professional',
      'barbershop',
      'hair_salon',
      'mixed_salon',
      'multi_location'
    );
  end if;
end $$;

comment on type public.business_type is
  'What kind of business this organization runs. Distinct from public.professional_type, which describes an APPLICANT at application time and cannot be changed afterwards; this is the live, editable business configuration that drives onboarding and product behaviour.';

alter table public.organizations
  add column if not exists business_type public.business_type,
  -- ISO 4217. Nullable rather than defaulted: "no currency chosen yet" is a
  -- real onboarding state that readiness must be able to see, and silently
  -- defaulting would reintroduce exactly the hardcoded-USD problem the audit
  -- found in six frontend formatters.
  add column if not exists currency text,
  -- ISO 3166-1 alpha-2. Drives currency/timezone SUGGESTIONS only.
  add column if not exists country_code text,
  add column if not exists onboarding_completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_currency_format') then
    alter table public.organizations
      add constraint organizations_currency_format
      check (currency is null or currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_country_code_format') then
    alter table public.organizations
      add constraint organizations_country_code_format
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

comment on column public.organizations.business_type is
  'solo_professional | barbershop | hair_salon | mixed_salon | multi_location. Set during onboarding, editable afterwards. Drives which onboarding steps apply and which starter-service template is offered.';
comment on column public.organizations.currency is
  'ISO 4217 code for every price this organization quotes. NULL means not chosen yet — readiness treats that as incomplete rather than assuming a currency.';
comment on column public.organizations.country_code is
  'ISO 3166-1 alpha-2. Used only to SUGGEST a currency and timezone; an explicit choice always wins.';
comment on column public.organizations.onboarding_completed_at is
  'When the owner finished the onboarding wizard. Advisory/analytics only — routing and publication both use get_organization_readiness(), which reads real persisted state, so a stamped-but-incomplete organization still cannot publish.';

-- ---------------------------------------------------------------------------
-- 2. Country -> currency / timezone suggestions
--
--    Deliberately narrow. Only unambiguous single-timezone countries get a
--    timezone, and unlisted countries return NULL rather than a guess — the
--    wizard then asks instead of silently configuring a shop into the wrong
--    timezone, which would corrupt every slot it ever computes.
-- ---------------------------------------------------------------------------

create or replace function public.suggested_currency_for_country(p_country_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(coalesce(p_country_code, '')))
    when 'FR' then 'EUR' when 'BE' then 'EUR' when 'DE' then 'EUR' when 'ES' then 'EUR'
    when 'IT' then 'EUR' when 'NL' then 'EUR' when 'PT' then 'EUR' when 'LU' then 'EUR'
    when 'IE' then 'EUR' when 'AT' then 'EUR' when 'FI' then 'EUR' when 'GR' then 'EUR'
    when 'MC' then 'EUR'
    when 'GB' then 'GBP'
    when 'CH' then 'CHF'
    when 'US' then 'USD'
    when 'CA' then 'CAD'
    when 'MA' then 'MAD'
    when 'AE' then 'AED'
    else null
  end;
$$;

comment on function public.suggested_currency_for_country(text) is
  'Suggested ISO 4217 currency for a country, or NULL when there is no confident single answer. A SUGGESTION only — an explicit choice made in onboarding always overrides it. France resolves to EUR; nothing here ever falls back to USD.';

create or replace function public.suggested_timezone_for_country(p_country_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(coalesce(p_country_code, '')))
    when 'FR' then 'Europe/Paris'   when 'BE' then 'Europe/Brussels'
    when 'DE' then 'Europe/Berlin'  when 'ES' then 'Europe/Madrid'
    when 'IT' then 'Europe/Rome'    when 'NL' then 'Europe/Amsterdam'
    when 'PT' then 'Europe/Lisbon'  when 'LU' then 'Europe/Luxembourg'
    when 'IE' then 'Europe/Dublin'  when 'AT' then 'Europe/Vienna'
    when 'CH' then 'Europe/Zurich'  when 'GB' then 'Europe/London'
    when 'MC' then 'Europe/Monaco'  when 'MA' then 'Africa/Casablanca'
    when 'AE' then 'Asia/Dubai'
    -- US and CA span several zones; guessing one would silently mis-schedule
    -- every appointment, so they deliberately return NULL and are asked.
    else null
  end;
$$;

comment on function public.suggested_timezone_for_country(text) is
  'Suggested IANA timezone for single-timezone countries, NULL otherwise (US/CA deliberately return NULL rather than a guess — a wrong timezone corrupts every computed slot).';

grant execute on function public.suggested_currency_for_country(text) to authenticated;
grant execute on function public.suggested_timezone_for_country(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_organization_readiness — THE authoritative evaluator
--
--    One implementation, used by: the onboarding wizard's progress and
--    review step, the professional routing decision (onboarding vs
--    workspace), and the publication gate below. Evaluating persisted state
--    rather than wizard progress is the whole point — a half-finished wizard
--    whose data did persist is ready, and a completed wizard whose data did
--    not is not.
-- ---------------------------------------------------------------------------

-- Return shape includes business_type/currency, so this is DROP + CREATE
-- rather than CREATE OR REPLACE — Postgres refuses to replace a function
-- whose OUT parameters changed. Same precedent as get_public_barber
-- (20260813110000) and get_my_appointments (20260813160000).
drop function if exists public.get_organization_readiness(uuid);

create function public.get_organization_readiness(p_organization_id uuid)
returns table (
  organization_id uuid,
  -- Returned as well as flagged: the onboarding wizard needs to know WHICH
  -- type in order to pick a starter-service template, and making it fetch
  -- the organization separately would mean two sources for one answer.
  business_type public.business_type,
  currency text,
  has_business_type boolean,
  has_currency boolean,
  has_location boolean,
  has_location_address boolean,
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
security definer
stable
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

comment on function public.get_organization_readiness(uuid) is
  'THE authoritative onboarding-readiness evaluator. Reads persisted state only — never wizard progress — so a resumed onboarding always reflects the truth. ready_to_book mirrors exactly what get_public_available_slots requires, so a true value means real slots are computable. ready_to_publish additionally requires business_type, currency, a full address and a public profile. Callable by org members and platform admins only.';

revoke execute on function public.get_organization_readiness(uuid) from public, anon;
grant execute on function public.get_organization_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Publication gate
--
--    The audit found the frontend flipping organizations.marketplace_visible
--    with a plain PATCH (lib/queries/organization-marketplace.ts), bypassing
--    the validated set_organization_marketplace_visible() RPC entirely. Both
--    paths are now gated by the same trigger, because a trigger fires on
--    every write — the RPC's, the PATCH's, and any future one — whereas a
--    check placed only inside the RPC is exactly the mistake SEC-01 was.
--
--    Turning visibility OFF is never blocked: an incomplete shop must always
--    be able to withdraw itself.
-- ---------------------------------------------------------------------------

create or replace function public.guard_marketplace_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready boolean;
  v_missing text[];
begin
  if new.marketplace_visible is not true or old.marketplace_visible is true then
    return new;
  end if;

  -- No JWT identity: operator SQL or a restore. Same documented escape hatch
  -- as guard_professional_application_update() and the organization-creation
  -- guard — never a client request.
  if (select auth.uid()) is null then
    return new;
  end if;

  select r.ready_to_publish, r.missing_requirements
    into v_ready, v_missing
    from public.get_organization_readiness(new.id) r;

  if not coalesce(v_ready, false) then
    raise exception 'this business is not ready to publish yet: missing %', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_marketplace_publication() is
  'BEFORE UPDATE gate on organizations.marketplace_visible. Publishing requires get_organization_readiness().ready_to_publish; unpublishing is always allowed. Sits on the TABLE, so it covers the validated RPC and any direct client PATCH identically.';

drop trigger if exists organizations_guard_marketplace_publication on public.organizations;
create trigger organizations_guard_marketplace_publication
  before update on public.organizations
  for each row execute function public.guard_marketplace_publication();

-- ---------------------------------------------------------------------------
-- 5. Onboarding RPCs — every one idempotent, because onboarding is resumable
-- ---------------------------------------------------------------------------

create or replace function public.save_business_profile(
  p_organization_id uuid,
  p_business_type public.business_type default null,
  p_currency text default null,
  p_country_code text default null,
  p_name text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may change the business profile'
      using errcode = '42501';
  end if;

  -- coalesce on every column: this is a step in a wizard, so a call that
  -- saves only the business type must not blank out the currency saved by a
  -- later step the user then went back from.
  update public.organizations o set
    business_type = coalesce(p_business_type, o.business_type),
    currency = coalesce(nullif(btrim(upper(coalesce(p_currency, ''))), ''), o.currency),
    country_code = coalesce(nullif(btrim(upper(coalesce(p_country_code, ''))), ''), o.country_code),
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), o.name)
  where o.id = p_organization_id
  returning * into v_org;

  return v_org;
end;
$$;

comment on function public.save_business_profile(uuid, public.business_type, text, text, text) is
  'Owner/manager-only partial update of the business identity fields. Every argument is optional and NULL means "leave unchanged", so a resumable wizard can save one step without clearing another.';

revoke execute on function public.save_business_profile(uuid, public.business_type, text, text, text) from public, anon;
grant execute on function public.save_business_profile(uuid, public.business_type, text, text, text) to authenticated;

-- ensure_owner_professional ---------------------------------------------------
-- A solo professional IS the business, and a shop owner very often takes
-- clients too. handle_new_membership already created their staff_profiles
-- row, but with location_id null and no `barbers` row — so they are not
-- bookable and do not satisfy readiness. This makes that one call,
-- idempotently, without inventing a second way to create staff.
create or replace function public.ensure_owner_professional(
  p_organization_id uuid,
  p_location_id uuid,
  p_display_name text default null,
  p_title text default null,
  p_bio text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_staff_profile_id uuid;
  v_barber_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set themselves up as a professional'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, title, bio)
  values (
    p_organization_id, v_user_id, p_location_id,
    coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), 'Professional'),
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_bio, '')), '')
  )
  on conflict (organization_id, user_id) do update set
    location_id = coalesce(excluded.location_id, public.staff_profiles.location_id),
    display_name = coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), public.staff_profiles.display_name),
    title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), public.staff_profiles.title),
    bio = coalesce(nullif(btrim(coalesce(p_bio, '')), ''), public.staff_profiles.bio),
    is_active = true,
    is_public = true
  returning id into v_staff_profile_id;

  select b.id into v_barber_id
    from public.barbers b where b.staff_profile_id = v_staff_profile_id;

  if v_barber_id is null then
    insert into public.barbers (organization_id, staff_profile_id, is_bookable)
    values (p_organization_id, v_staff_profile_id, true)
    returning id into v_barber_id;
  else
    update public.barbers set is_bookable = true where id = v_barber_id;
  end if;

  return v_barber_id;
end;
$$;

comment on function public.ensure_owner_professional(uuid, uuid, text, text, text) is
  'Idempotently makes the calling owner/manager a bookable professional at a location: upserts their staff_profiles row (never blanking a field the caller omitted) and ensures a bookable barbers row. Returns the barber id. Running it twice produces one professional, not two.';

revoke execute on function public.ensure_owner_professional(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.ensure_owner_professional(uuid, uuid, text, text, text) to authenticated;

-- apply_starter_services -------------------------------------------------------
-- Templates are INITIALIZERS, never a locked catalog. Matching on
-- lower(btrim(name)) per organization is what makes a resumed or re-run
-- onboarding produce one "Haircut" rather than three — the audit's explicit
-- requirement. A service the owner renamed afterwards simply stops matching
-- and is left alone, which is the correct behaviour: their edit wins.
create or replace function public.apply_starter_services(
  p_organization_id uuid,
  p_location_id uuid,
  p_services jsonb,
  p_barber_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_name text;
  v_duration integer;
  v_price integer;
  v_service_id uuid;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may create services'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b
    where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  if jsonb_typeof(p_services) <> 'array' then
    raise exception 'p_services must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_services)
  loop
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_duration := nullif(v_item ->> 'duration_minutes', '')::integer;
    v_price := nullif(v_item ->> 'price_cents', '')::integer;

    if v_name is null then
      raise exception 'every starter service needs a name';
    end if;
    if v_duration is null or v_duration <= 0 then
      raise exception 'service "%" needs a positive duration', v_name;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'service "%" needs a price of zero or more', v_name;
    end if;

    select s.id into v_service_id
      from public.services s
      where s.organization_id = p_organization_id
        and lower(btrim(s.name)) = lower(v_name)
      limit 1;

    if v_service_id is null then
      insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
      values (p_organization_id, v_name, v_duration, v_price, true)
      returning id into v_service_id;
    else
      update public.services
        set duration_minutes = v_duration, price_cents = v_price, is_active = true
        where id = v_service_id;
    end if;

    insert into public.service_locations (organization_id, service_id, location_id)
    values (p_organization_id, v_service_id, p_location_id)
    on conflict do nothing;

    if p_barber_id is not null then
      insert into public.barber_services (organization_id, barber_id, service_id)
      values (p_organization_id, p_barber_id, v_service_id)
      on conflict do nothing;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.apply_starter_services(uuid, uuid, jsonb, uuid) is
  'Idempotently creates or updates a set of services from the onboarding template and links them to a location (and optionally a professional). Matches existing services on lower(trimmed name) per organization, so resuming or re-running onboarding never duplicates a service. Templates are initializers — everything stays editable through the normal services screen afterwards.';

revoke execute on function public.apply_starter_services(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.apply_starter_services(uuid, uuid, jsonb, uuid) to authenticated;

-- apply_weekly_hours -----------------------------------------------------------
-- One call sets a whole week for a location and/or a professional, upserting
-- on the existing (location_id, day_of_week) / (barber_id, day_of_week)
-- unique constraints so a resumed step overwrites rather than conflicts.
create or replace function public.apply_weekly_hours(
  p_organization_id uuid,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_days jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_dow smallint;
  v_closed boolean;
  v_open time;
  v_close time;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set hours'
      using errcode = '42501';
  end if;

  if p_location_id is null and p_barber_id is null then
    raise exception 'pass a location, a professional, or both';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.locations l where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    v_dow := (v_item ->> 'day_of_week')::smallint;
    v_closed := coalesce((v_item ->> 'is_closed')::boolean, (v_item ->> 'is_off')::boolean, false);
    v_open := nullif(v_item ->> 'open_time', '')::time;
    v_close := nullif(v_item ->> 'close_time', '')::time;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'day_of_week must be 0 (Sunday) through 6 (Saturday)';
    end if;
    if not v_closed and (v_open is null or v_close is null or v_open >= v_close) then
      raise exception 'an open day needs open_time earlier than close_time';
    end if;

    if p_location_id is not null then
      insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
      values (p_organization_id, p_location_id, v_dow, v_closed,
              case when v_closed then null else v_open end,
              case when v_closed then null else v_close end)
      on conflict (location_id, day_of_week) do update set
        is_closed = excluded.is_closed,
        open_time = excluded.open_time,
        close_time = excluded.close_time;
    end if;

    if p_barber_id is not null then
      insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
      values (p_organization_id, p_barber_id, v_dow, v_closed,
              case when v_closed then null else v_open end,
              case when v_closed then null else v_close end)
      on conflict (barber_id, day_of_week) do update set
        is_off = excluded.is_off,
        start_time = excluded.start_time,
        end_time = excluded.end_time;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) is
  'Upserts a whole week of opening hours for a location and/or working hours for a professional in one call. Idempotent via the existing (location_id, day_of_week) / (barber_id, day_of_week) unique constraints. Still one window per day — split shifts and lunch closures are a separate, deliberate schema change, not something to fake here.';

revoke execute on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) to authenticated;

-- complete_onboarding ----------------------------------------------------------
create or replace function public.complete_onboarding(p_organization_id uuid, p_publish boolean default false)
returns table (
  ready_to_book boolean,
  ready_to_publish boolean,
  is_published boolean,
  missing_requirements text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may complete onboarding'
      using errcode = '42501';
  end if;

  select * into r from public.get_organization_readiness(p_organization_id);

  if r.ready_to_book then
    update public.organizations
      set onboarding_completed_at = coalesce(onboarding_completed_at, now())
      where id = p_organization_id;
  end if;

  -- Publishing goes through the same column the gate trigger watches, so an
  -- unready organization raises here exactly as it would from anywhere else.
  if p_publish and r.ready_to_publish then
    update public.organizations set marketplace_visible = true where id = p_organization_id;
  end if;

  select * into r from public.get_organization_readiness(p_organization_id);
  return query select r.ready_to_book, r.ready_to_publish, r.is_published, r.missing_requirements;
end;
$$;

comment on function public.complete_onboarding(uuid, boolean) is
  'Stamps onboarding_completed_at once the organization is genuinely bookable, and optionally publishes it when it is genuinely publishable. Never forces either: an incomplete organization gets its honest readiness report back instead of a stamp it has not earned.';

revoke execute on function public.complete_onboarding(uuid, boolean) from public, anon;
grant execute on function public.complete_onboarding(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. review_professional_application — stop discarding the applicant's address
--
--    Redefined here rather than patched in place. Everything that made the
--    original correct is preserved VERBATIM: the `for update` row lock that
--    makes a double-clicked Approve a harmless no-op, the idempotent
--    already-decided return, the slug-collision loop, the
--    fadeup.skip_org_owner_membership suppression that makes the APPLICANT
--    the owner rather than the reviewing platform admin, the in-transaction
--    email_outbox enqueue, and the platform_audit_log entry.
--
--    Three things are added:
--      * fadeup.org_creation_authorized for the LOT A guard trigger;
--      * a first location built from the address already on the application,
--        with a timezone suggested from its country (falling back to the
--        pre-existing 'UTC' default rather than guessing);
--      * business_type/country_code/currency seeded from the application's
--        professional_type and country, so onboarding starts pre-filled
--        instead of blank. Every one of these stays editable afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.review_professional_application(
  p_application_id uuid,
  p_decision text,
  p_rejection_reason text default null,
  p_internal_note text default null
)
returns public.professional_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer uuid;
  v_application public.professional_applications;
  v_org public.organizations;
  v_slug text;
  v_slug_base text;
  v_suffix integer := 0;
  v_country text;
  v_timezone text;
  v_business_type public.business_type;
  v_location_id uuid;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional applications';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;

  -- Row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a status that is no longer pending and returns without
  -- repeating any side effect.
  select * into v_application
    from public.professional_applications a
    where a.id = p_application_id
    for update;

  if not found then
    raise exception 'application not found';
  end if;

  if v_application.status <> 'pending_review' then
    return v_application;
  end if;

  if p_decision = 'reject' then
    update public.professional_applications a
      set status = 'rejected',
          reviewed_at = now(),
          reviewed_by = v_reviewer,
          rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
          internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
      where a.id = v_application.id
      returning * into v_application;

    insert into public.email_outbox (to_email, template, payload)
    values (
      v_application.email,
      'professional_application_rejected',
      jsonb_build_object(
        'business_name', v_application.business_name,
        'first_name', v_application.first_name,
        'rejection_reason', v_application.rejection_reason
      )
    );

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (
      v_reviewer, 'professional_application_rejected', 'professional_applications', v_application.id,
      jsonb_build_object('business_name', v_application.business_name, 'has_reason', v_application.rejection_reason is not null)
    );

    return v_application;
  end if;

  -- ---- approve ----------------------------------------------------------
  v_slug_base := regexp_replace(lower(btrim(v_application.business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(regexp_replace(v_slug_base, '(^-+)|(-+$)', '', 'g'), '-');
  if v_slug_base = '' then
    v_slug_base := 'shop';
  end if;
  v_slug_base := left(v_slug_base, 40);
  v_slug := v_slug_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix::text;
  end loop;

  v_country := nullif(btrim(upper(coalesce(v_application.country, ''))), '');
  if v_country is not null and char_length(v_country) <> 2 then
    -- The application form accepts free text; only a clean alpha-2 code is
    -- trustworthy enough to drive a timezone. Anything else is left for
    -- onboarding to ask about rather than guessed at.
    v_country := null;
  end if;

  -- professional_type is the applicant's own description of their business
  -- and maps cleanly onto the two solo shapes; barbershop maps to barbershop.
  -- Anything a salon-shaped applicant needs is chosen in onboarding step 1,
  -- which is why an unmapped type is left NULL rather than defaulted.
  v_business_type := case v_application.professional_type
    when 'barbershop' then 'barbershop'::public.business_type
    when 'independent_barber' then 'solo_professional'::public.business_type
    when 'private_studio' then 'solo_professional'::public.business_type
    when 'mobile_barber' then 'solo_professional'::public.business_type
    else null
  end;

  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug, business_type, country_code, currency)
  values (
    v_application.business_name,
    v_slug,
    v_business_type,
    v_country,
    public.suggested_currency_for_country(v_country)
  )
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);
  perform set_config('fadeup.skip_org_owner_membership', 'off', true);

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, v_application.user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- First location, from data the applicant already gave us. Creating it
  -- here is what stops an approved shop from starting with zero locations
  -- and the owner retyping an address FadeUp already holds.
  v_timezone := coalesce(public.suggested_timezone_for_country(v_country), 'UTC');
  insert into public.locations (
    organization_id, name, address_line1, city, postal_code, country, timezone
  )
  values (
    v_org.id,
    v_application.business_name,
    nullif(btrim(coalesce(v_application.address_line1, '')), ''),
    nullif(btrim(coalesce(v_application.city, '')), ''),
    nullif(btrim(coalesce(v_application.postal_code, '')), ''),
    v_country,
    v_timezone
  )
  returning id into v_location_id;

  update public.professional_applications a
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_reviewer,
        organization_id = v_org.id,
        internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
    where a.id = v_application.id
    returning * into v_application;

  insert into public.email_outbox (to_email, template, payload)
  values (
    v_application.email,
    'professional_application_approved',
    jsonb_build_object(
      'business_name', v_application.business_name,
      'first_name', v_application.first_name
    )
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_reviewer, 'professional_application_approved', 'professional_applications', v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'organization_id', v_org.id,
      'organization_slug', v_org.slug,
      'location_id', v_location_id
    )
  );

  return v_application;
end;
$$;

comment on function public.review_professional_application(uuid, text, text, text) is
  'Platform-admin-only approve/reject. Approving creates the organization, makes the APPLICANT its owner (never the reviewer), creates the first location from the address already on the application, seeds business_type/country/currency, records the audit event and queues the applicant email — all in one transaction. Idempotent: reviewing an already-decided application returns it unchanged with no repeated side effects. Never grants any platform role.';

revoke execute on function public.review_professional_application(uuid, text, text, text) from public, anon;
grant execute on function public.review_professional_application(uuid, text, text, text) to authenticated;
