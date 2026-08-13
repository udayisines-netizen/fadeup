-- FadeUp — Wave 1 Phase 2: public shop profile (team roster)
-- Migration: list_public_organization_barbers, get_public_barber location_id
--
-- Closes a real gap: get_public_barber/list_public_barber_services (LOT 12)
-- only ever look up ONE already-known barber_id, and list_public_barbers
-- (LOT 9) only lists barbers eligible for an already-chosen location+
-- service inside the booking wizard. Neither lets a customer "open shop ->
-- browse team -> open a barber" (Wave 1 shop-profile requirement) — there
-- was no way to list every public barber an organization has, full stop.
--
-- Same anon-facing philosophy as every other public RPC here: narrowly-
-- scoped SECURITY DEFINER, curated columns, eligibility re-derived from
-- is_bookable/is_active/is_public (never trust a client-supplied id).
--
-- Idempotent: safe to re-run.

create or replace function public.list_public_organization_barbers(p_organization_slug text)
returns table (
  barber_id uuid,
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
  select b.id, sp.display_name, sp.title, sp.avatar_url, l.id, l.name
  from public.barbers b
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

-- get_public_barber gains location_id so a Barber Passport ("Book with
-- <name>") link can pass it through to the booking wizard and skip the
-- location step, same as list_public_organization_barbers above. Changing
-- a `returns table` shape requires DROP + CREATE, not CREATE OR REPLACE.
drop function if exists public.get_public_barber(text, uuid);

create function public.get_public_barber(p_organization_slug text, p_barber_id uuid)
returns table (
  barber_id uuid,
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
  select b.id, sp.display_name, sp.title, sp.bio, sp.avatar_url, sp.location_id
  from public.barbers b
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
