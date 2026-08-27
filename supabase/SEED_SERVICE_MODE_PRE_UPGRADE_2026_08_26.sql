-- ============================================================================
-- FadeUp — SEED: a realistic R2-era database, for the Service Mode upgrade test
--
-- WHY THIS FILE EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about a backfill, nothing about whether the new enforcement quietly breaks a
-- shop that was working the day before, and nothing about whether R1A/R1B/R2
-- data survives.
--
-- So this builds the messy, populated database the upgrade actually has to cope
-- with, and then VERIFY asserts that every commitment in it is still there
-- afterwards.
--
-- HOW IT IS USED
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260826120000_service_mode_foundation.sql \
--     --seed   supabase/SEED_SERVICE_MODE_PRE_UPGRADE_2026_08_26.sql \
--     --master supabase/MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql \
--     --verify supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--
-- --skip-from stops the base replay just before this lot, so the seed lands on
-- a genuine post-R2 / pre-Service-Mode schema — the exact shape production is
-- in right now. MASTER then has to upgrade it on its own.
--
-- WHAT IS IN HERE
--
--   SOLO          one location, one barber, plan `solo`
--                 -> has walkIns + liveQueue + booking
--   SALON         one location, three barbers, plan `salon_essential`
--                 -> has walkIns and booking but NOT liveQueue. Deliberately:
--                    it is the fixture that proves the queue gate's
--                    walkIns-OR-liveQueue disjunction does not withdraw a
--                    channel this plan pays for.
--   MULTI         TWO locations, plan `multi_pro`
--                 -> the fixture that proves service mode is per ESTABLISHMENT.
--                    VERIFY changes one salon and asserts the other did not move.
--   DORMANT       zero locations, zero professionals, plan `free`
--                 -> the R2 backfill's own `free` case. Proves the new
--                    entitlement gate refuses it, and proves that refusing it
--                    breaks nothing, because it has no location to book at.
--
-- Plus, across them: completed appointment history with real completed_at,
-- future confirmed appointments, an active queue with waiting and in-service
-- entries, customers, claimed professionals, follows and Fade Passports.
--
-- EVERY VALUE HERE IS INVENTED. Fixed literal UUIDs so assertions can name
-- them, @seed.invalid addresses (a reserved TLD that can never route), and
-- names that belong to nobody. No production data is reproduced anywhere in
-- this file.
--
-- Idempotent: safe to re-run.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

set local client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'solo.owner@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'salon.owner@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000003', 'salon.barber.b@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000004', 'salon.barber.c@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000005', 'salon.reception@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000006', 'multi.owner@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000007', 'multi.barber.north@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000008', 'multi.barber.south@seed.invalid'),
  ('a0000000-0000-4000-8000-000000000009', 'dormant.owner@seed.invalid'),
  ('a0000000-0000-4000-8000-00000000000a', 'customer.one@seed.invalid'),
  ('a0000000-0000-4000-8000-00000000000b', 'customer.two@seed.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Organizations, locations, rosters
-- ---------------------------------------------------------------------------

insert into public.organizations (id, name, slug) values
  ('b0000000-0000-4000-8000-000000000001', 'Seed Solo',    'seed-solo'),
  ('b0000000-0000-4000-8000-000000000002', 'Seed Salon',   'seed-salon'),
  ('b0000000-0000-4000-8000-000000000003', 'Seed Multi',   'seed-multi'),
  ('b0000000-0000-4000-8000-000000000004', 'Seed Dormant', 'seed-dormant')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- R2 commercial state — assigned explicitly, and assigned BEFORE any location
-- exists.
--
-- The ordering is load-bearing rather than tidy. R2's establishment-capacity
-- trigger (20260826110400) fires on every location INSERT, and a brand-new
-- organization starts on `free`, which covers exactly one establishment. The
-- Salon fixture below has two addresses, so creating them first and raising the
-- plan afterwards is refused — correctly, by a commercial rule this lot does
-- not weaken.
--
-- The backfill derives a plan from an organization's shape; these fixtures need
-- SPECIFIC plans so the entitlement-composition assertions mean something. In
-- particular salon_essential is chosen for the Salon precisely because it holds
-- walkIns WITHOUT liveQueue, which is the case that would break if the queue
-- gate demanded liveQueue.
--
-- entitlement_source stays 'early_access' with a NULL provider: nothing here
-- claims money changed hands.
-- ---------------------------------------------------------------------------

select private.ensure_organization_commercial_state('b0000000-0000-4000-8000-000000000001');
select private.ensure_organization_commercial_state('b0000000-0000-4000-8000-000000000002');
select private.ensure_organization_commercial_state('b0000000-0000-4000-8000-000000000003');
select private.ensure_organization_commercial_state('b0000000-0000-4000-8000-000000000004');

update public.organization_commercial_state
   set plan_key = 'solo', status = 'active', entitlement_source = 'early_access'
 where organization_id = 'b0000000-0000-4000-8000-000000000001';

update public.organization_commercial_state
   set plan_key = 'salon_essential', status = 'active', entitlement_source = 'early_access'
 where organization_id = 'b0000000-0000-4000-8000-000000000002';

update public.organization_commercial_state
   set plan_key = 'multi_pro', status = 'active', entitlement_source = 'early_access'
 where organization_id = 'b0000000-0000-4000-8000-000000000003';

update public.organization_commercial_state
   set plan_key = 'free', status = 'active', entitlement_source = 'early_access'
 where organization_id = 'b0000000-0000-4000-8000-000000000004';

-- The Salon's second address is INACTIVE, which is why salon_essential (one
-- establishment) accommodates it: the capacity trigger counts only active
-- locations and returns early for an inactive one.
insert into public.locations (id, organization_id, name, city, country, timezone, is_active) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Solo Chair',   'Lyon',   'FR', 'Europe/Paris',    true),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Salon Centre', 'Paris',  'FR', 'Europe/Paris',    true),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'Multi North',  'Lille',  'FR', 'Europe/Paris',    true),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000003', 'Multi South',  'Nice',   'FR', 'Europe/Paris',    true),
  -- An INACTIVE location. It must still be backfilled, or reactivating it later
  -- would silently give it a different service mode than it had.
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'Salon Annexe', 'Paris',  'FR', 'Europe/Paris',    false)
on conflict (id) do nothing;

-- Opening hours, so the "until closing" duration has real data to resolve
-- against for the Salon and no data at all for the Solo — both cases matter.
insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', d, false, '09:00', '19:00'
from generate_series(1, 6) d
on conflict (location_id, day_of_week) do nothing;

insert into public.memberships (organization_id, user_id, role) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'owner'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'barber'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'barber'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', 'receptionist'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000006', 'owner'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000007', 'barber'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000008', 'barber'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000009', 'owner')
on conflict (organization_id, user_id) do update set role = excluded.role;

-- Organization creation may already have made a staff profile for the owner, so
-- these upsert on the (organization_id, user_id) key rather than assuming.
insert into public.staff_profiles (id, organization_id, user_id, location_id, display_name, is_public, is_active) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Sami Solo',    true, true),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Nadia Owner',  true, true),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 'Bilal Barber', true, true),
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 'Chloe Coupe',  true, true),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 'Remi Reception', true, true),
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000003', 'Mina Multi',   true, true),
  ('d0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000003', 'Noor North',   true, true),
  ('d0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000004', 'Sacha South',  true, true)
on conflict (organization_id, user_id) do update
  set id = excluded.id,
      location_id = excluded.location_id,
      display_name = excluded.display_name,
      is_public = excluded.is_public,
      is_active = excluded.is_active;

-- A receptionist deliberately has NO barbers row: they are staff, they are not
-- a chair, and the Pro read must not list them as one.
insert into public.barbers (id, organization_id, staff_profile_id, is_bookable) values
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', true),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', true),
  ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', true),
  ('e0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000004', true),
  ('e0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000006', true),
  ('e0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000007', true),
  ('e0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000008', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active) values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Coupe',       30, 2500, true),
  ('f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Coupe',       30, 3000, true),
  ('f0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'Coupe',       30, 3500, true)
on conflict (id) do nothing;

-- Both junction tables carry their OWN NOT NULL organization_id, cross-checked
-- against the service and the location by trigger.
insert into public.service_locations (organization_id, service_id, location_id) values
  ('b0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id) values
  ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000003')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

insert into public.customers (id, organization_id, name, phone, email, user_id) values
  ('11110000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'Customer One', '+33600000001', 'customer.one@seed.invalid', 'a0000000-0000-4000-8000-00000000000a'),
  ('11110000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Customer Two', '+33600000002', 'customer.two@seed.invalid', 'a0000000-0000-4000-8000-00000000000b'),
  ('11110000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'Customer One', '+33600000001', 'customer.one@seed.invalid', 'a0000000-0000-4000-8000-00000000000a')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- COMMITMENTS — the rows the whole upgrade test is about
--
-- Service mode governs NEW admissions. Every row below already exists before
-- MASTER runs, and VERIFY asserts that all of them are still present, still
-- carrying the same status and the same completed_at, after the upgrade AND
-- after every establishment has been switched to a mode that would refuse to
-- admit them today.
-- ---------------------------------------------------------------------------

-- COMPLETED history, with real completed_at (R1A's authoritative column).
insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id, customer_id,
   customer_name, customer_phone, starts_at, ends_at, status, completed_at)
values
  ('22220000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', '11110000-0000-4000-8000-000000000001',
   'Customer One', '+33600000001', now() - interval '30 days', now() - interval '30 days' + interval '30 minutes', 'completed', now() - interval '30 days' + interval '30 minutes'),
  ('22220000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', '11110000-0000-4000-8000-000000000002',
   'Customer Two', '+33600000002', now() - interval '14 days', now() - interval '14 days' + interval '30 minutes', 'completed', now() - interval '14 days' + interval '30 minutes'),
  ('22220000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', null,
   'Walk Past', '+33600000003', now() - interval '7 days', now() - interval '7 days' + interval '30 minutes', 'completed', now() - interval '7 days' + interval '30 minutes')
on conflict (id) do nothing;

-- FUTURE confirmed appointments. Eight at the Salon, so §29's "tomorrow has 8
-- appointments, switch to queue_only, they all survive" is literally testable.
insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id, customer_id,
   customer_name, customer_phone, starts_at, ends_at, status)
select
  ('22221000-0000-4000-8000-00000000000' || n)::uuid,
  'b0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000003',
  'f0000000-0000-4000-8000-000000000002',
  '11110000-0000-4000-8000-000000000001',
  'Customer One', '+33600000001',
  date_trunc('day', now()) + interval '1 day' + (n * interval '1 hour') + interval '9 hours',
  date_trunc('day', now()) + interval '1 day' + (n * interval '1 hour') + interval '9 hours 30 minutes',
  'confirmed'
from generate_series(1, 8) n
on conflict (id) do nothing;

-- Future appointments at BOTH multi-salon locations, so the per-establishment
-- assertions have something to lose if the model were organization-wide.
insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id,
   customer_name, customer_phone, starts_at, ends_at, status)
values
  ('22222000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000003',
   'North Customer', '+33600000010', now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', 'confirmed'),
  ('22222000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000003',
   'South Customer', '+33600000011', now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', 'confirmed')
on conflict (id) do nothing;

-- AN ACTIVE QUEUE: three waiting plus one in service at the Salon. §28's
-- "three customers in the queue, switch to reservation_only, they stay" is
-- exactly these rows.
insert into public.queue_entries
  (id, organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status)
values
  ('33330000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', '11110000-0000-4000-8000-000000000001', 'Queue One',   '+33600000021', 'waiting'),
  ('33330000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', null,                                   'f0000000-0000-4000-8000-000000000002', null,                                   'Queue Two',   '+33600000022', 'waiting'),
  ('33330000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', null,                                   null,                                   null,                                   'Queue Three', '+33600000023', 'waiting')
on conflict (id) do nothing;

-- created_at is set EXPLICITLY here rather than left to its default. R1A's
-- queue_entries_timestamps_monotonic constraint requires
-- created_at <= called_at <= service_started_at, and it is right to: a customer
-- cannot be called before they arrived. Defaulting created_at to now() while
-- backdating called_at produces exactly the causally impossible row R1A was
-- written to reject.
insert into public.queue_entries
  (id, organization_id, location_id, barber_id, service_id, customer_name, customer_phone, status, created_at, called_at, service_started_at)
values
  ('33330000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000002', 'Queue Four', '+33600000024', 'in_service', now() - interval '40 minutes', now() - interval '20 minutes', now() - interval '15 minutes')
on conflict (id) do nothing;

-- The Solo shop's own queue, so the solo plan's liveQueue entitlement is
-- exercised rather than merely assumed.
insert into public.queue_entries
  (id, organization_id, location_id, barber_id, customer_name, customer_phone, status)
values
  ('33331000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Solo Walkin', '+33600000031', 'waiting')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- R1B social state — durable identities, follows and Passports
--
-- Present so VERIFY can assert the Service Mode upgrade destroys none of it,
-- and so the "unclaimed external professional" safety rule has a real subject.
-- ---------------------------------------------------------------------------

-- The barbers above should already have professionals rows from R1B's linkage.
-- This tops up anything missing without inventing a claim.
-- Guarded by NOT EXISTS on user_id, not by ON CONFLICT. R1B's linkage may
-- already have minted a professional for this account, and public.professionals
-- carries a UNIQUE constraint on user_id — a durable identity belongs to
-- exactly one person. Forcing a second one in would be the very fabrication
-- R1B exists to prevent, so the seed defers to whatever is already there.
insert into public.professionals (id, claim_state, user_id, display_name, handle, is_public, source, claimed_at)
select '44440000-0000-4000-8000-000000000001', 'claimed', 'a0000000-0000-4000-8000-000000000003',
       'Bilal Barber', 'bilal_seed', true, 'fadeup', now() - interval '90 days'
where not exists (
  select 1 from public.professionals p where p.user_id = 'a0000000-0000-4000-8000-000000000003'
);

-- AN UNCLAIMED, WORKER-DISCOVERED PROFESSIONAL. No account, no barbers row, no
-- placement, no organization — a real person the acquisition worker found, who
-- has never heard of FadeUp.
--
-- is_public is FALSE, and not by choice: R1B's professionals_publication_eligibility
-- constraint makes it impossible for an unclaimed identity to be public at all.
-- That is a stronger guarantee than this lot needs and worth stating, because
-- it means §24 is protected twice over — such a professional cannot be
-- published, AND get_public_service_state could not answer for them even if
-- they were, since it is reachable only through a real barbers placement.
insert into public.professionals (id, claim_state, user_id, display_name, handle, is_public, source)
values
  ('44440000-0000-4000-8000-0000000000ff', 'unclaimed', null, 'Discovered Pro', 'discovered_seed', false, 'acquisition')
on conflict (id) do nothing;

-- Links the placement to whatever durable identity that ACCOUNT owns, rather
-- than to the literal id above — which may not be the one that exists, if R1B
-- minted it first.
update public.barbers b
   set professional_id = p.id
  from public.professionals p
 where b.id = 'e0000000-0000-4000-8000-000000000003'
   and p.user_id = 'a0000000-0000-4000-8000-000000000003'
   and b.professional_id is null;

-- followed_at is set explicitly: R1B's professional_follows_state_timestamps
-- constraint requires a `following` row to record WHEN it started, so that an
-- unfollow can be told from a follow that never happened.
insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at)
select 'a0000000-0000-4000-8000-00000000000a', b.professional_id, 'following', 'manual', now() - interval '60 days'
from public.barbers b
where b.id = 'e0000000-0000-4000-8000-000000000003' and b.professional_id is not null
on conflict do nothing;

insert into public.customer_passports (user_id, usual_haircut)
values
  ('a0000000-0000-4000-8000-00000000000a', 'Skin fade, scissors on top'),
  ('a0000000-0000-4000-8000-00000000000b', 'Buzz cut')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- A census, recorded BEFORE the upgrade so VERIFY can compare against it
-- rather than against a number hard-coded in a second file that could drift.
--
-- An ordinary table, not a temp one: it has to survive this session and be
-- readable by the VERIFY script's own connection.
-- ---------------------------------------------------------------------------

create table if not exists public.seed_service_mode_census (
  measure text primary key,
  value bigint not null
);

insert into public.seed_service_mode_census (measure, value)
select 'appointments_total',       count(*) from public.appointments
union all select 'appointments_completed', count(*) from public.appointments where status = 'completed'
union all select 'appointments_confirmed', count(*) from public.appointments where status = 'confirmed'
union all select 'queue_total',            count(*) from public.queue_entries
union all select 'queue_waiting',          count(*) from public.queue_entries where status = 'waiting'
union all select 'queue_in_service',       count(*) from public.queue_entries where status = 'in_service'
union all select 'customers_total',        count(*) from public.customers
union all select 'professionals_total',    count(*) from public.professionals
union all select 'follows_following',      count(*) from public.professional_follows where state = 'following'
union all select 'passports_total',        count(*) from public.customer_passports
union all select 'locations_total',        count(*) from public.locations
union all select 'barbers_total',          count(*) from public.barbers
on conflict (measure) do update set value = excluded.value;

comment on table public.seed_service_mode_census is
  'Row counts taken by SEED_SERVICE_MODE_PRE_UPGRADE immediately BEFORE the Service Mode upgrade, so VERIFY can prove nothing was destroyed by comparing against what was actually there rather than against a constant that could drift out of step with the fixtures. Test scaffolding — never created by a migration and never present in production.';

commit;

-- ============================================================================
-- Seeded. The database is now a realistic post-R2, pre-Service-Mode FadeUp:
-- four organizations on four different plans, five locations (one inactive),
-- seven barbers, 13 appointments (3 completed with completed_at, 10 future
-- confirmed), 5 queue entries (4 waiting, 1 in service), customers, follows,
-- Passports, a claimed professional and one unclaimed worker-discovered
-- professional with no operational reality at all.
-- ============================================================================
