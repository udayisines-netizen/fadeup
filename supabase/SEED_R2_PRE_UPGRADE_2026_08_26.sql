-- ============================================================================
-- FadeUp — SEED: a real pre-R2 database, R1A and R1B already applied
--
-- Loaded into a DISPOSABLE container between the base migration replay and the
-- MASTER apply:
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260826110000 \
--     --seed   supabase/SEED_R2_PRE_UPGRADE_2026_08_26.sql \
--     --master supabase/MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql \
--     --verify supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--
-- NEVER run against a real database.
--
-- WHY THIS EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about the two parts of R2 that only do anything when data is present:
--
--   1. THE BACKFILL. Its whole job is to look at organizations that already
--      exist and assign each the cheapest plan that covers the shape it has,
--      without inventing a payment and without inventing a tier. An empty
--      database exercises none of that. So this seed contains one organization
--      of every shape the derivation branches on, including the awkward one
--      that exceeds every plan FadeUp sells.
--
--   2. NON-DESTRUCTION. R2 must not remove or alter a single row of R1A/R1B
--      data. The only way to test that is to have R1A/R1B data — appointments
--      with trustworthy completion, Passports with real content, follow edges,
--      relationship aggregates, a claimed identity and acquisition provenance —
--      and count it before and after.
--
-- WHAT EACH ORGANIZATION IS FOR
--
--   EMPTY   0 locations, 0 professionals  -> must backfill to `free`
--                                            (never finished onboarding; starts
--                                            where a new organization starts)
--   INDIE   1 location,  1 professional   -> must backfill to `solo`
--   SALON   1 location,  3 professionals  -> must backfill to `salon_essential`
--                                            (the CHEAPEST single-salon plan —
--                                            NOT salon_pro, however much of the
--                                            product it actually uses)
--   MULTI   4 locations, 2 professionals  -> must backfill to `multi_pro`
--   OVER   11 locations, 1 professional   -> must backfill to `multi_scale`
--                                            with the overage recorded, and
--                                            must lose NO location
--
-- This runs against the POST-R1B, PRE-R2 schema, so it must not reference
-- commercial_plans, organization_commercial_state or any other R2 object. It
-- may and does use professionals, professional_id, passport_number and the
-- follow graph, which are R1B's.
--
-- Fixed UUIDs (cccccccc-…) so the VERIFY suite can find these rows by id.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000010',
   'authenticated', 'authenticated', 'r2-owner-empty@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000011',
   'authenticated', 'authenticated', 'r2-owner-indie@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000012',
   'authenticated', 'authenticated', 'r2-owner-salon@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000013',
   'authenticated', 'authenticated', 'r2-owner-multi@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000014',
   'authenticated', 'authenticated', 'r2-owner-over@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- Two more barbers for the salon, so "team is included" has a team to include
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000015',
   'authenticated', 'authenticated', 'r2-salon-barber-2@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000016',
   'authenticated', 'authenticated', 'r2-salon-barber-3@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- A second barber for the multi-salon group
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000017',
   'authenticated', 'authenticated', 'r2-multi-barber-2@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- A customer with real Passport content and a real service history
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000018',
   'authenticated', 'authenticated', 'r2-customer@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- The person who claimed an acquisition-created identity
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000019',
   'authenticated', 'authenticated', 'r2-claimant@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- Platform staff, for the assignment-authorization tests
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-00000000001a',
   'authenticated', 'authenticated', 'r2-platform-admin@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- A complete outsider, for the cross-tenant tests
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-00000000001b',
   'authenticated', 'authenticated', 'r2-outsider@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- Platform SUPPORT, which deliberately does NOT satisfy is_platform_admin()
  -- (20260810130000 argues that at length). Seeded so R2 can prove that the
  -- assignment RPC refuses the tier of platform staff that has no financial
  -- authority, rather than treating "works at FadeUp" as sufficient.
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-00000000001c',
   'authenticated', 'authenticated', 'r2-platform-support@fadeup.test', 'x', '{}', '{}', now(), now());

-- public.platform_admins was replaced by public.platform_members in
-- 20260810130000_platform_roles.sql; private.is_platform_admin() reads the
-- latter and accepts platform_owner and platform_admin only.
insert into public.platform_members (user_id, role, note) values
  ('cccccccc-0000-4000-8000-00000000001a', 'platform_admin',
   'R2 seed: platform staff for assignment tests'),
  ('cccccccc-0000-4000-8000-00000000001c', 'platform_support',
   'R2 seed: platform support, which must NOT be able to change a plan');

-- ---------------------------------------------------------------------------
-- Five organizations, one per backfill branch
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('cccccccc-0000-4000-8000-000000000001'::uuid, 'R2 Empty Shop',   'r2-seed-empty'),
      ('cccccccc-0000-4000-8000-000000000002'::uuid, 'R2 Indie Barber', 'r2-seed-indie'),
      ('cccccccc-0000-4000-8000-000000000003'::uuid, 'R2 Salon',        'r2-seed-salon'),
      ('cccccccc-0000-4000-8000-000000000004'::uuid, 'R2 Multi Group',  'r2-seed-multi'),
      ('cccccccc-0000-4000-8000-000000000005'::uuid, 'R2 Over Capacity','r2-seed-over')
    ) as o(id, name, slug)
  loop
    -- Same convention the R1A/R1B seeds use: the creation guard and the owner
    -- membership auto-provision are both bypassed so the fixture can name its
    -- own ids and its own memberships.
    perform set_config('fadeup.org_creation_authorized', 'on', true);
    perform set_config('fadeup.skip_org_owner_membership', 'on', true);
    insert into public.organizations (id, name, slug, marketplace_visible)
    values (r.id, r.name, r.slug, true);
  end loop;
end $$;

insert into public.memberships (organization_id, user_id, role) values
  ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000010', 'owner'),
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000011', 'owner'),
  ('cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000012', 'owner'),
  ('cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000015', 'barber'),
  ('cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000016', 'barber'),
  ('cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000013', 'owner'),
  ('cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000017', 'barber'),
  ('cccccccc-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000014', 'owner');

-- ---------------------------------------------------------------------------
-- Locations
--
-- EMPTY gets none. OVER gets eleven, which no plan FadeUp sells covers — the
-- backfill must record that rather than resolve it, and every one of the eleven
-- must still be there afterwards.
-- ---------------------------------------------------------------------------

insert into public.locations (id, organization_id, name, city, country, timezone, is_active)
values
  ('cccccccc-0000-4000-8000-000000000020', 'cccccccc-0000-4000-8000-000000000002', 'Indie Chair', 'Lyon',  'FR', 'UTC', true),
  ('cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000003', 'Salon Main',  'Paris', 'FR', 'UTC', true);

-- MULTI: four active establishments.
insert into public.locations (id, organization_id, name, city, country, timezone, is_active)
select
  ('cccccccc-0000-4000-8000-0000000000' || lpad((48 + n)::text, 2, '0'))::uuid,
  'cccccccc-0000-4000-8000-000000000004',
  'Multi Site ' || n, 'Marseille', 'FR', 'UTC', true
from generate_series(1, 4) as n;

-- OVER: eleven active establishments.
insert into public.locations (id, organization_id, name, city, country, timezone, is_active)
select
  ('cccccccc-0000-4000-8000-0000000000' || lpad((60 + n)::text, 2, '0'))::uuid,
  'cccccccc-0000-4000-8000-000000000005',
  'Over Site ' || n, 'Lille', 'FR', 'UTC', true
from generate_series(1, 11) as n;

-- One INACTIVE location on the salon. It must NOT count towards capacity —
-- that is the whole reason the counts read is_active rather than counting rows.
insert into public.locations (id, organization_id, name, city, country, timezone, is_active)
values ('cccccccc-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000003',
        'Salon Closed Annex', 'Paris', 'FR', 'UTC', false);

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values
  ('cccccccc-0000-4000-8000-000000000030', 'cccccccc-0000-4000-8000-000000000002', 'Indie Fade', 30, 2500, true),
  ('cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000003', 'Salon Fade', 30, 3000, true);

-- ---------------------------------------------------------------------------
-- Rosters
--
-- Memberships auto-create staff_profiles; barbers rows are explicit. R1B's
-- barbers_assign_professional trigger mints the durable identity for each one,
-- which is exactly what R2 must leave alone.
-- ---------------------------------------------------------------------------

update public.staff_profiles set location_id = 'cccccccc-0000-4000-8000-000000000020'
where organization_id = 'cccccccc-0000-4000-8000-000000000002';

update public.staff_profiles set location_id = 'cccccccc-0000-4000-8000-000000000021'
where organization_id = 'cccccccc-0000-4000-8000-000000000003';

-- INDIE: exactly one professional.
insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000040', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000002'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000011';

-- SALON: three professionals. Adding the second and the third must not change
-- what the salon pays, and after R2 it must still not.
insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000041', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000003'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000012';

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000042', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000003'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000015';

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000043', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000003'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000016';

-- MULTI: two professionals across four sites.
insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000044', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000004'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000013';

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000045', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000004'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000017';

-- OVER: one professional, eleven sites. A real shape — a franchise whose
-- rosters have not been entered yet — and the one that proves the two caps are
-- independent of one another.
insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'cccccccc-0000-4000-8000-000000000046', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.organization_id = 'cccccccc-0000-4000-8000-000000000005'
  and sp.user_id = 'cccccccc-0000-4000-8000-000000000014';

-- An OFFBOARDED professional at the salon: R1A's offboarding deactivates and
-- never deletes, so this roster row exists and must NOT consume capacity. If
-- R2 ever counts barbers rows instead of active ones, this fixture catches it.
insert into public.staff_profiles (id, organization_id, user_id, location_id, display_name, is_active, is_public, created_at)
values ('cccccccc-0000-4000-8000-000000000047', 'cccccccc-0000-4000-8000-000000000003',
        null, 'cccccccc-0000-4000-8000-000000000021', 'R2 Former Barber', false, false,
        timestamptz '2025-10-01 09:00:00+00');

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('cccccccc-0000-4000-8000-000000000048', 'cccccccc-0000-4000-8000-000000000003',
        'cccccccc-0000-4000-8000-000000000047', false);

-- ---------------------------------------------------------------------------
-- A customer, a Passport, and real service history
--
-- The Passport is issued automatically by R1B's trigger on customer_profiles
-- insert; the content below is what must survive R2 byte for byte.
-- ---------------------------------------------------------------------------

insert into public.customer_profiles (user_id, display_name, created_at)
values ('cccccccc-0000-4000-8000-000000000018', 'R2 Customer', timestamptz '2026-02-01 10:00:00+00');

update public.customer_passports
set usual_haircut = 'Low fade, textured top',
    fade_type = 'low',
    preferences_notes = 'Leave the beard line square'
where user_id = 'cccccccc-0000-4000-8000-000000000018';

insert into public.customers (id, organization_id, user_id, name, phone, email)
values ('cccccccc-0000-4000-8000-000000000050', 'cccccccc-0000-4000-8000-000000000003',
        'cccccccc-0000-4000-8000-000000000018', 'R2 Customer', '+33600000018', 'r2-customer@fadeup.test');

-- Two genuinely completed, self-booked appointments. Inserted confirmed and
-- then completed, so R1A's transition guard stamps a trustworthy completed_at,
-- R1B's auto-follow creates a follow edge, and R1B's relationship writer builds
-- an aggregate. All three must survive R2 untouched.
insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                 customer_id, customer_name, starts_at, ends_at, status, booked_by_user_id)
values
  ('cccccccc-0000-4000-8000-000000000060', 'cccccccc-0000-4000-8000-000000000003',
   'cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000041',
   'cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000050',
   'R2 Customer', timestamptz '2026-05-01 10:00:00+00', timestamptz '2026-05-01 10:30:00+00',
   'confirmed', 'cccccccc-0000-4000-8000-000000000018'),
  ('cccccccc-0000-4000-8000-000000000061', 'cccccccc-0000-4000-8000-000000000003',
   'cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000041',
   'cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000050',
   'R2 Customer', timestamptz '2026-06-01 10:00:00+00', timestamptz '2026-06-01 10:30:00+00',
   'confirmed', 'cccccccc-0000-4000-8000-000000000018');

update public.appointments set status = 'completed'
where id in ('cccccccc-0000-4000-8000-000000000060', 'cccccccc-0000-4000-8000-000000000061');

-- A served walk-in, so the queue side of the relationship evidence is present
-- too and R2 can be shown not to have touched it.
insert into public.queue_entries (id, organization_id, location_id, barber_id, service_id,
                                  customer_name, status, booked_by_user_id)
values ('cccccccc-0000-4000-8000-000000000070', 'cccccccc-0000-4000-8000-000000000003',
        'cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000042',
        'cccccccc-0000-4000-8000-000000000031', 'R2 Customer', 'waiting',
        'cccccccc-0000-4000-8000-000000000018');

update public.queue_entries set status = 'called'     where id = 'cccccccc-0000-4000-8000-000000000070';
update public.queue_entries set status = 'in_service' where id = 'cccccccc-0000-4000-8000-000000000070';
update public.queue_entries set status = 'completed'  where id = 'cccccccc-0000-4000-8000-000000000070';

-- ---------------------------------------------------------------------------
-- Acquisition provenance and a claimed identity
--
-- The claimed identity is the sharpest non-destruction test in the file:
-- Constitution 5.6 says claim state is not subscription state, so a commercial
-- backfill running over this row must change nothing about it at all.
-- ---------------------------------------------------------------------------

insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
values ('cccccccc-0000-4000-8000-000000000080', 'independent_barber', 'independent', 'qualified',
        'R2 Discovered Barber', 'FR');

insert into public.professionals (id, claim_state, user_id, display_name, source, claimed_at, is_public)
values ('cccccccc-0000-4000-8000-000000000090', 'claimed',
        'cccccccc-0000-4000-8000-000000000019', 'R2 Claimed Identity', 'acquisition',
        timestamptz '2026-04-01 12:00:00+00', false);

insert into public.prospect_professionals (prospect_id, professional_id, match_confidence, matching_rule)
values ('cccccccc-0000-4000-8000-000000000080', 'cccccccc-0000-4000-8000-000000000090',
        0.940, 'r2-seed');

commit;
