-- FadeUp — LOT 12: Barber Passport
-- Migration: public barber profile RPCs
--
-- A shareable public profile page for one barber (`/s/:slug/barbers/:id`),
-- built on `staff_profiles` fields that already existed but had no public
-- surface: `avatar_url`, `is_public`. Same anon-facing pattern as LOT 9/11
-- (narrowly-scoped SECURITY DEFINER RPCs, not a broad anon SELECT policy;
-- every id re-derived from the organization slug and re-validated against
-- it). A barber with `is_public = false` (profiles default to `true` — a
-- shop opts a barber OUT, not in) returns zero rows — same "no rows for an
-- unknown/ineligible id" shape as every other public lookup in this
-- codebase, not an error, so an unpublished profile link looks identical
-- to a wrong one rather than leaking which case it is.
--
-- Idempotent: safe to re-run.

-- get_public_barber -----------------------------------------------------------
create or replace function public.get_public_barber(p_organization_slug text, p_barber_id uuid)
returns table (
  barber_id uuid,
  display_name text,
  title text,
  bio text,
  avatar_url text
)
language sql
security definer
stable
set search_path = ''
as $$
  select b.id, sp.display_name, sp.title, sp.bio, sp.avatar_url
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
  'Anon-callable: one public, bookable barber''s profile by id, scoped to organization_slug. Zero rows if the barber is not public/bookable/active or belongs to a different org — never an error, so a private profile link is indistinguishable from a wrong one.';

revoke execute on function public.get_public_barber(text, uuid) from public;
grant execute on function public.get_public_barber(text, uuid) to anon, authenticated;

-- list_public_barber_services ---------------------------------------------------
-- What this barber actually performs — real data, never a fabricated
-- "specialties" list. Deliberately does not require a location_id (unlike
-- list_public_services/list_public_barbers): a Barber Passport is a single
-- shareable page for the barber, not scoped to a booking flow already in
-- progress at one location.
create or replace function public.list_public_barber_services(p_organization_slug text, p_barber_id uuid)
returns table (
  id uuid,
  name text,
  duration_minutes integer,
  price_cents integer
)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.name, s.duration_minutes, s.price_cents
  from public.services s
  join public.barber_services bs on bs.service_id = s.id
  join public.barbers b on b.id = bs.barber_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  where o.slug = p_organization_slug
    and b.id = p_barber_id
    and b.is_bookable
    and sp.is_active
    and sp.is_public
    and s.is_active
  order by s.name;
$$;

comment on function public.list_public_barber_services(text, uuid) is
  'Anon-callable: active services a public, bookable barber performs, by organization_slug. Same eligibility gating as get_public_barber — zero rows if the barber is not public.';

revoke execute on function public.list_public_barber_services(text, uuid) from public;
grant execute on function public.list_public_barber_services(text, uuid) to anon, authenticated;
