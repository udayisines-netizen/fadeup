-- ============================================================================
-- FadeUp — SEED: a real pre-R1B database, R1A already applied
--
-- Loaded into a DISPOSABLE container between the base migration replay and the
-- MASTER apply:
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260826100000 \
--     --seed   supabase/SEED_R1B_PRE_UPGRADE_2026_08_26.sql \
--     --master supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql \
--     --verify supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--
-- NEVER run against a real database.
--
-- WHY THIS EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about the parts of R1B that only do anything when data is present:
--
--   * the identity backfill, which must give ONE identity to a person working
--     at TWO shops, and must give an UNCLAIMED one to a roster row whose
--     account R1A's erasure path already detached;
--   * the Passport backfill, which must issue to customers who have none and
--     number Passports that already exist WITHOUT touching their content;
--   * reconciliation, which must reproduce the aggregate from historical
--     evidence and must EXCLUDE completed rows whose completion time R1A
--     deliberately left unknown;
--   * the claim path's reverse acquisition linkage, which needs a real
--     prospect that has not yet converted.
--
-- This runs against the POST-R1A, PRE-R1B schema, so it must not reference
-- professional_id, passport_number, or any professionals/follows/claims table.
-- It may and does use completed_at and booked_by_user_id, which are R1A's.
--
-- Fixed UUIDs (bbbbbbbb-…) so the VERIFY suite can find these rows by id.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  -- owner of shop A
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000010',
   'authenticated', 'authenticated', 'seed-owner-a@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- owner of shop B
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000011',
   'authenticated', 'authenticated', 'seed-owner-b@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- ONE human who cuts hair at BOTH shops — the case the whole lot exists for
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000012',
   'authenticated', 'authenticated', 'seed-barber-two-shops@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- a customer who already has Passport CONTENT saved
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000013',
   'authenticated', 'authenticated', 'seed-customer-with-passport@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- a customer who uses the app but never opened the Passport screen
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000014',
   'authenticated', 'authenticated', 'seed-customer-no-passport@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- an account with NO customer_profiles row: must NOT be issued a Passport
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000015',
   'authenticated', 'authenticated', 'seed-non-customer@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- the person who will claim the acquisition-created identity
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000016',
   'authenticated', 'authenticated', 'seed-claimant@fadeup.test', 'x', '{}', '{}', now(), now()),
  -- a stranger who will try to claim it too
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000017',
   'authenticated', 'authenticated', 'seed-rival-claimant@fadeup.test', 'x', '{}', '{}', now(), now());

-- ---------------------------------------------------------------------------
-- Two shops, both real and operational
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'Pre-R1B Shop A', 'r1b-seed-a', true);

  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ('bbbbbbbb-0000-4000-8000-000000000002', 'Pre-R1B Shop B', 'r1b-seed-b', true);

  -- The organization the claimant already owns. The claim path derives the
  -- conversion organization from exactly this membership rather than trusting
  -- anything a caller sends.
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ('bbbbbbbb-0000-4000-8000-000000000003', 'Claimant Shop', 'r1b-seed-claimant', true);
end $$;

insert into public.locations (id, organization_id, name, city, country, timezone, is_active)
values
  ('bbbbbbbb-0000-4000-8000-000000000020', 'bbbbbbbb-0000-4000-8000-000000000001', 'A Main', 'Lyon', 'FR', 'UTC', true),
  ('bbbbbbbb-0000-4000-8000-000000000021', 'bbbbbbbb-0000-4000-8000-000000000002', 'B Main', 'Paris', 'FR', 'UTC', true);

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values
  ('bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000001', 'Fade A', 30, 2500, true),
  ('bbbbbbbb-0000-4000-8000-000000000031', 'bbbbbbbb-0000-4000-8000-000000000002', 'Fade B', 30, 2700, true);

-- Memberships auto-create staff_profiles through on_membership_created.
insert into public.memberships (organization_id, user_id, role) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000010', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000011', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000016', 'owner'),
  -- the same human, on both rosters
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000012', 'barber'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000012', 'barber');

-- Give the two-shop barber a stable, recognisable name at BOTH shops, with the
-- shop-A profile deliberately OLDER. The backfill's deterministic tie-break is
-- (created_at, id), so the identity must take the shop-A name.
update public.staff_profiles
set display_name = 'Ash Two-Shops (A)',
    created_at = timestamptz '2026-01-10 09:00:00+00',
    location_id = 'bbbbbbbb-0000-4000-8000-000000000020'
where user_id = 'bbbbbbbb-0000-4000-8000-000000000012'
  and organization_id = 'bbbbbbbb-0000-4000-8000-000000000001';

update public.staff_profiles
set display_name = 'Ash Two-Shops (B)',
    created_at = timestamptz '2026-04-02 09:00:00+00',
    location_id = 'bbbbbbbb-0000-4000-8000-000000000021'
where user_id = 'bbbbbbbb-0000-4000-8000-000000000012'
  and organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';

-- A DETACHED roster record: the professional's account was erased, which after
-- R1A leaves staff_profiles.user_id NULL and the service history standing.
-- R1B must give this row an UNCLAIMED identity — the person really worked
-- here, and nobody controls that identity any more.
insert into public.staff_profiles (id, organization_id, user_id, location_id, display_name, is_active, is_public, created_at)
values ('bbbbbbbb-0000-4000-8000-000000000040', 'bbbbbbbb-0000-4000-8000-000000000001',
        null, 'bbbbbbbb-0000-4000-8000-000000000020', 'Erased Former Barber', false, false,
        timestamptz '2025-11-01 09:00:00+00');

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'bbbbbbbb-0000-4000-8000-000000000050', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.user_id = 'bbbbbbbb-0000-4000-8000-000000000012'
  and sp.organization_id = 'bbbbbbbb-0000-4000-8000-000000000001';

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select 'bbbbbbbb-0000-4000-8000-000000000051', sp.organization_id, sp.id, true
from public.staff_profiles sp
where sp.user_id = 'bbbbbbbb-0000-4000-8000-000000000012'
  and sp.organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('bbbbbbbb-0000-4000-8000-000000000052', 'bbbbbbbb-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000040', false);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

insert into public.customer_profiles (user_id, display_name, created_at)
values
  ('bbbbbbbb-0000-4000-8000-000000000013', 'Passport Customer', timestamptz '2026-02-01 10:00:00+00'),
  ('bbbbbbbb-0000-4000-8000-000000000014', 'No-Passport Customer', timestamptz '2026-03-01 10:00:00+00');

-- A Passport that ALREADY exists with real content. The backfill must give it
-- a number and must not touch a single preference field.
insert into public.customer_passports (id, user_id, usual_haircut, fade_type, preferences_notes, created_at)
values ('bbbbbbbb-0000-4000-8000-000000000060', 'bbbbbbbb-0000-4000-8000-000000000013',
        'Mid fade, scissors on top', 'mid', 'No clippers above the crown please',
        timestamptz '2026-02-02 11:00:00+00');

-- Per-shop CRM rows. The squat is the important one: an attacker planted a
-- victim's contact details, so customers.user_id points at the ATTACKER for a
-- row a victim's booking might land on. R1B must never derive a follow or a
-- relationship from this column.
insert into public.customers (id, organization_id, user_id, name, phone, email)
values
  ('bbbbbbbb-0000-4000-8000-000000000070', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000013', 'Passport Customer', '+33600000013', 'seed-customer-with-passport@fadeup.test'),
  ('bbbbbbbb-0000-4000-8000-000000000071', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000017', 'Victim Name', '+33600000099', 'victim@example.test');

-- ---------------------------------------------------------------------------
-- Historical service evidence
--
-- Four appointments, each testing a different thing about what R1B may infer.
-- ---------------------------------------------------------------------------

-- (1) A genuinely completed, self-booked appointment. Inserted confirmed then
--     completed, so R1A's guard stamps a trustworthy completed_at. This is the
--     ONLY kind of row reconciliation may count.
insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                 customer_id, customer_name, starts_at, ends_at, status, booked_by_user_id)
values ('bbbbbbbb-0000-4000-8000-000000000080', 'bbbbbbbb-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000020', 'bbbbbbbb-0000-4000-8000-000000000050',
        'bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000070',
        'Passport Customer', timestamptz '2026-05-01 10:00:00+00', timestamptz '2026-05-01 10:30:00+00',
        'confirmed', 'bbbbbbbb-0000-4000-8000-000000000013');

update public.appointments set status = 'completed'
where id = 'bbbbbbbb-0000-4000-8000-000000000080';

-- (2) A second completed service with the same professional, at the same shop,
--     for the same customer. The aggregate must reach count = 2 with a first/
--     last window spanning both, not two rows and not one.
insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                 customer_id, customer_name, starts_at, ends_at, status, booked_by_user_id)
values ('bbbbbbbb-0000-4000-8000-000000000081', 'bbbbbbbb-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000020', 'bbbbbbbb-0000-4000-8000-000000000050',
        'bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000070',
        'Passport Customer', timestamptz '2026-06-01 10:00:00+00', timestamptz '2026-06-01 10:30:00+00',
        'confirmed', 'bbbbbbbb-0000-4000-8000-000000000013');

update public.appointments set status = 'completed'
where id = 'bbbbbbbb-0000-4000-8000-000000000081';

-- (3) A completed appointment from BEFORE R1A: status says completed, but the
--     completion time is genuinely unknown and R1A refused to invent one.
--     Inserted directly as completed, which is exactly how such a row got
--     there — a raw PATCH, before the transition guard existed.
--     Reconciliation must EXCLUDE it rather than backdate it.
insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                 customer_name, starts_at, ends_at, status, booked_by_user_id, completed_at)
values ('bbbbbbbb-0000-4000-8000-000000000082', 'bbbbbbbb-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000020', 'bbbbbbbb-0000-4000-8000-000000000050',
        'bbbbbbbb-0000-4000-8000-000000000030',
        'Passport Customer', timestamptz '2026-01-15 10:00:00+00', timestamptz '2026-01-15 10:30:00+00',
        'completed', 'bbbbbbbb-0000-4000-8000-000000000013', null);

-- (4) The squat. An ANONYMOUS booking that landed on the customers row the
--     attacker owns. booked_by_user_id is NULL because nobody was signed in.
--     R1B must produce NO follow and NO relationship for the attacker — this
--     is the R1A D-1 vector, re-run against the social layer.
insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                 customer_id, customer_name, starts_at, ends_at, status, booked_by_user_id)
values ('bbbbbbbb-0000-4000-8000-000000000083', 'bbbbbbbb-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000020', 'bbbbbbbb-0000-4000-8000-000000000050',
        'bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000071',
        'Victim Name', timestamptz '2026-07-01 10:00:00+00', timestamptz '2026-07-01 10:30:00+00',
        'confirmed', null);

update public.appointments set status = 'completed'
where id = 'bbbbbbbb-0000-4000-8000-000000000083';

-- A served walk-in, self-checked-in. Real evidence of a completed service, so
-- reconciliation must count it alongside the appointment history.
insert into public.queue_entries (id, organization_id, location_id, barber_id, service_id,
                                  customer_name, status, booked_by_user_id)
values ('bbbbbbbb-0000-4000-8000-000000000090', 'bbbbbbbb-0000-4000-8000-000000000002',
        'bbbbbbbb-0000-4000-8000-000000000021', 'bbbbbbbb-0000-4000-8000-000000000051',
        'bbbbbbbb-0000-4000-8000-000000000031', 'No-Passport Customer', 'waiting',
        'bbbbbbbb-0000-4000-8000-000000000014');

update public.queue_entries set status = 'called' where id = 'bbbbbbbb-0000-4000-8000-000000000090';
update public.queue_entries set status = 'in_service' where id = 'bbbbbbbb-0000-4000-8000-000000000090';
update public.queue_entries set status = 'completed' where id = 'bbbbbbbb-0000-4000-8000-000000000090';

-- ---------------------------------------------------------------------------
-- Acquisition
--
-- A canonical prospect Worker discovered and has not converted. The claim path
-- must set converted_organization_id on exactly this row, and only once.
-- ---------------------------------------------------------------------------

insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
values ('bbbbbbbb-0000-4000-8000-0000000000a0', 'barbershop', 'independent', 'qualified',
        'Discovered Barbershop', 'FR');

-- A second prospect that has ALREADY converted. The conversion writer must
-- never overwrite this: a prospect converts once, and sales has acted on it.
insert into public.prospects (id, type, entity_kind, status, canonical_name, country, converted_organization_id)
values ('bbbbbbbb-0000-4000-8000-0000000000a1', 'independent_barber', 'independent', 'customer',
        'Already Converted Shop', 'FR', 'bbbbbbbb-0000-4000-8000-000000000002');

commit;
