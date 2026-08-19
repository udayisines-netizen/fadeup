-- FadeUp — LOT E phase 1: make the business's currency reachable.
--
-- ============================================================================
-- THE BUG
-- ============================================================================
--
--   organizations.currency has existed since LOT B and was correct. It simply
--   never reached the browser: not one read path returned it. So the frontend
--   had five copies of
--
--       (cents / 100).toLocaleString(undefined, { style: 'currency',
--                                                 currency: 'USD' })
--
--   and every service price in FadeUp — booking flow, public profile,
--   marketplace card, service editor, customer's appointment list — rendered
--   in US dollars. A Paris salon charging 25 € showed its own customers
--   "$25.00".
--
--   This is a display bug with the shape of a trust bug: the number a customer
--   is quoted is the number they expect to pay.
--
-- ============================================================================
-- WHY THESE FOUR AND NOT THE SEARCH FUNCTIONS
-- ============================================================================
--
--   Adding a column to a `returns table` means DROP + CREATE. That is fine for
--   a ten-line function; it is a poor trade for search_public_organizations
--   and search_public_professionals, which are large, carry the marketplace's
--   geo/ranking logic, and would have to be reproduced in full here just to
--   append one column — the exact copy-paste that goes stale.
--
--   So the two search functions are left ALONE, and a small batch lookup is
--   added instead. A marketplace list resolves every visible shop's currency
--   in one extra round trip, and the ranking logic keeps exactly one
--   definition.
--
-- Additive: no column is added, no data is rewritten, no policy changes.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The public organization read
-- ---------------------------------------------------------------------------

drop function if exists public.get_public_organization(text);

create function public.get_public_organization(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  currency text,
  country_code text
)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, o.name, o.slug, coalesce(o.currency, 'EUR'), o.country_code
  from public.organizations o
  where o.slug = p_slug;
$$;

comment on function public.get_public_organization(text) is
  'Public shop header, by slug. Now carries the shop''s own currency so its prices are quoted in the money its customers will actually pay — a London salon in GBP even to a visitor browsing from Paris. FadeUp performs no conversion, so this is the ONLY currency a price may be shown in.';

revoke execute on function public.get_public_organization(text) from public;
grant execute on function public.get_public_organization(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Batch currency lookup, for lists that span shops
--
--    A marketplace page shows results from many organizations and cannot ask
--    for each one separately. Deliberately returns ONLY id and currency:
--    anything more would be a second, less-guarded copy of the public
--    organization read.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_currencies(p_organization_ids uuid[])
returns table (organization_id uuid, currency text)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, coalesce(o.currency, 'EUR')
  from public.organizations o
  where o.id = any(coalesce(p_organization_ids, array[]::uuid[]))
  -- Only shops that have chosen to be publicly listed. A private
  -- organization's existence must not be confirmable by probing this.
  and o.marketplace_visible;
$$;

comment on function public.get_public_currencies(uuid[]) is
  'Currencies for a set of publicly listed organizations, so a marketplace list can price every card correctly in one round trip. Returns nothing for an id that is not publicly visible, so it cannot be used to probe for private organizations.';

revoke execute on function public.get_public_currencies(uuid[]) from public;
grant execute on function public.get_public_currencies(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The customer's own appointments
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_appointments();

create function public.get_my_appointments()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  price_cents integer,
  currency text,
  location_timezone text,
  resolution public.appointment_resolution,
  resolution_note text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.organization_id, o.name, o.slug, a.location_id, l.name,
    a.barber_id, sp.display_name, a.service_id, s.name,
    a.starts_at, a.ends_at, a.status, s.price_cents,
    coalesce(o.currency, 'EUR'),
    -- The shop's timezone travels with the appointment: a customer abroad must
    -- still read the time the salon means, not the one their phone assumes.
    l.timezone,
    a.resolution, a.resolution_note, a.expires_at, a.created_at
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  )
  order by a.starts_at desc;
$$;

comment on function public.get_my_appointments() is
  'A signed-in customer''s own appointments across every shop they use. Now carries each shop''s currency AND its location timezone, because a customer''s list genuinely spans businesses in different countries and both were previously assumed from the device.';

revoke execute on function public.get_my_appointments() from public, anon;
grant execute on function public.get_my_appointments() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The professional calendar read
-- ---------------------------------------------------------------------------

drop function if exists public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid);

create function public.get_calendar_appointments(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_location_id uuid default null,
  p_barber_id uuid default null
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  resolution public.appointment_resolution,
  expires_at timestamptz,
  location_id uuid,
  location_name text,
  location_timezone text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  price_cents integer,
  currency text,
  customer_name text,
  customer_phone text,
  notes text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.starts_at, a.ends_at, a.status, a.resolution, a.expires_at,
    a.location_id, l.name, l.timezone,
    a.barber_id, sp.display_name,
    a.service_id, s.name, s.price_cents, coalesce(o.currency, 'EUR'),
    a.customer_name, a.customer_phone, a.notes, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  join public.organizations o on o.id = a.organization_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_barber_id is null or a.barber_id = p_barber_id)
    -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
    and ((select private.is_org_member(p_organization_id)) or (select private.is_platform_admin()))
  order by a.starts_at;
$$;

comment on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Range-bounded, pre-joined calendar read. Returns nothing — rather than raising — for a non-member, so it is safe to call from a shared layout. Carries the organization''s currency so a group operating in several countries prices each shop''s calendar correctly. Still deliberately omits customer_email and customer_id.';

revoke execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
