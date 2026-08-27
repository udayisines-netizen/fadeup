-- ============================================================================
-- FadeUp — SEED: a populated pre-R3 database, for the analytics upgrade test
--
-- WHY THIS FILE EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about the two things that can actually go wrong when analytics is installed
-- over a LIVE product:
--
--   1. THE TRIGGERS BREAK THE EXISTING PRODUCT. R3 attaches thirteen AFTER
--      triggers to tables that already carry appointments, queue entries,
--      follows, favorites and claims. If any of them raises — a missing
--      taxonomy row, a NOT NULL, a type mismatch — a shop that was taking
--      bookings the day before stops taking them. This seed provides the rows
--      those triggers will fire on, and VERIFY then completes an appointment
--      and joins a queue on the SEEDED data, not on data it made itself.
--
--   2. THE INSTALL INVENTS HISTORY. R3 deliberately backfills NOTHING. A shop
--      with four hundred completed appointments from before instrumentation
--      must have ZERO analytics events after the upgrade — because there is no
--      honest occurred_at for them, no honest actor, and no honest commercial
--      snapshot. Manufacturing those would put fabricated evidence in the one
--      table whose entire value is that it is evidence. VERIFY asserts the
--      count is zero.
--
-- HOW IT IS USED
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260827120000_analytics_event_foundation.sql \
--     --seed   supabase/SEED_R3_PRE_UPGRADE_2026_08_27.sql \
--     --master supabase/MASTER_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql \
--     --verify supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--
-- --skip-from stops the base replay immediately before R3, so the seed lands
-- on a genuine post-Service-Mode / pre-analytics schema — the exact shape
-- production is in right now. MASTER then has to upgrade it on its own.
--
-- EVERY VALUE HERE IS INVENTED. Fixed literal UUIDs so assertions can name
-- them, @seed.invalid addresses (a reserved TLD that can never route), and
-- names that belong to nobody. No production data is reproduced anywhere in
-- this file.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Accounts and one established tenant
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('44440000-0000-4000-8000-000000000001', 'seed.r3.owner@seed.invalid'),
  ('44440000-0000-4000-8000-000000000002', 'seed.r3.barber@seed.invalid'),
  ('44440000-0000-4000-8000-000000000003', 'seed.r3.customer@seed.invalid')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug) values
  ('44441000-0000-4000-8000-000000000001', 'Seed R3 Salon', 'seed-r3-salon')
on conflict (id) do nothing;

select private.ensure_organization_commercial_state('44441000-0000-4000-8000-000000000001');

-- An established, paying shop. salon_pro deliberately, so that the historical
-- rows below were created under terms DIFFERENT from whatever plan the
-- fixture later moves to — which is what makes the §8 snapshot claim
-- falsifiable rather than trivially true.
update public.organization_commercial_state
   set plan_key = 'salon_pro', status = 'active'
 where organization_id = '44441000-0000-4000-8000-000000000001';

insert into public.memberships (organization_id, user_id, role) values
  ('44441000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-000000000001', 'owner'),
  ('44441000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-000000000002', 'barber')
on conflict do nothing;

insert into public.locations (id, organization_id, name, timezone, is_active) values
  ('44442000-0000-4000-8000-000000000001', '44441000-0000-4000-8000-000000000001',
   'Seed R3 Main', 'Europe/Paris', true)
on conflict (id) do nothing;

-- handle_new_membership already made the staff_profiles row; adopt it rather
-- than colliding with it.
update public.staff_profiles
   set location_id = '44442000-0000-4000-8000-000000000001',
       display_name = 'Seed R3 Barber', is_public = true, is_active = true
 where organization_id = '44441000-0000-4000-8000-000000000001'
   and user_id = '44440000-0000-4000-8000-000000000002';

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
select '44443000-0000-4000-8000-000000000001',
       '44441000-0000-4000-8000-000000000001',
       sp.id,
       true
from public.staff_profiles sp
where sp.organization_id = '44441000-0000-4000-8000-000000000001'
  and sp.user_id = '44440000-0000-4000-8000-000000000002'
on conflict (id) do nothing;

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active) values
  ('44444000-0000-4000-8000-000000000001', '44441000-0000-4000-8000-000000000001',
   'Seed Fade', 30, 3000, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- HISTORY THAT PREDATES INSTRUMENTATION
--
-- Completed appointments, a completed queue entry, an active follow and a
-- favorite — all created BEFORE any analytics trigger exists. After the
-- upgrade every one of these must still be exactly as it is now, and none of
-- them may have produced an event.
-- ---------------------------------------------------------------------------

insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id,
   customer_name, starts_at, ends_at, status, completed_at, created_at)
values
  ('44445000-0000-4000-8000-000000000001', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Past One',
   now() - interval '30 days', now() - interval '30 days' + interval '30 minutes',
   'completed', now() - interval '30 days' + interval '30 minutes', now() - interval '31 days'),
  ('44445000-0000-4000-8000-000000000002', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Past Two',
   now() - interval '10 days', now() - interval '10 days' + interval '30 minutes',
   'completed', now() - interval '10 days' + interval '30 minutes', now() - interval '11 days'),
  -- A live commitment. The upgrade must leave it confirmable and completable.
  ('44445000-0000-4000-8000-000000000003', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Future',
   now() + interval '5 days', now() + interval '5 days' + interval '30 minutes',
   'confirmed', null, now())
on conflict (id) do nothing;

insert into public.queue_entries
  (id, organization_id, location_id, barber_id, service_id, customer_name, status,
   called_at, service_started_at, completed_at, created_at)
values
  ('44446000-0000-4000-8000-000000000001', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Walkin Past', 'completed',
   now() - interval '20 days', now() - interval '20 days' + interval '5 minutes',
   now() - interval '20 days' + interval '35 minutes', now() - interval '20 days'),
  -- Someone actually standing in the shop while the upgrade runs.
  ('44446000-0000-4000-8000-000000000002', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Walkin Waiting', 'waiting',
   null, null, null, now())
on conflict (id) do nothing;

insert into public.organization_follows
  (follower_user_id, organization_id, is_following, followed_at, created_at)
values
  ('44440000-0000-4000-8000-000000000003', '44441000-0000-4000-8000-000000000001',
   true, now() - interval '25 days', now() - interval '25 days')
on conflict (follower_user_id, organization_id) do nothing;

insert into public.customer_favorites (id, user_id, organization_id, created_at)
values ('44447000-0000-4000-8000-000000000001',
        '44440000-0000-4000-8000-000000000003',
        '44441000-0000-4000-8000-000000000001',
        now() - interval '25 days')
on conflict (id) do nothing;

insert into public.customer_passports (id, user_id, created_at)
values ('44448000-0000-4000-8000-000000000001',
        '44440000-0000-4000-8000-000000000003',
        now() - interval '25 days')
on conflict (user_id) do nothing;

do $$
begin
  raise notice 'R3 pre-upgrade seed loaded: 1 tenant, 3 appointments (2 historically completed), 2 queue entries, 1 follow, 1 favorite, 1 passport — all created BEFORE any analytics trigger exists.';
end $$;

commit;
