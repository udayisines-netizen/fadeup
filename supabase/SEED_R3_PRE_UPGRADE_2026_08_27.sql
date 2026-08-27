-- ============================================================================
-- FadeUp — SEED: a populated pre-R3 database, for the analytics upgrade test
--
-- WHY THIS FILE EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about the three things that can actually go wrong when analytics is
-- installed over a LIVE product:
--
--   1. THE INSTALL MUTATES EXISTING DATA. R3 attaches thirteen AFTER triggers
--      to tables that already hold appointments, queue entries, follows,
--      favorites, relationships and claims. A stray UPDATE, a trigger that
--      fires during the migration, or a backfill that "normalises" a column
--      would silently rewrite a shop's history.
--
--   2. THE INSTALL INVENTS HISTORY. R3 deliberately backfills NOTHING. A shop
--      with completed appointments from before instrumentation must have ZERO
--      analytics events afterwards — there is no honest occurred_at for them,
--      no honest actor, and no honest commercial snapshot. Manufacturing those
--      would put fabricated evidence in the one table whose entire value is
--      that it is evidence.
--
--   3. THE TRIGGERS BREAK THE EXISTING PRODUCT. If any of the thirteen raises,
--      a shop that was taking bookings the day before stops taking them.
--
-- HOW (1) IS PROVEN RATHER THAN ASSERTED
--
-- Presence checks — "the follow is still there", "there are still two
-- completed appointments" — are close to worthless here. They pass just as
-- happily against a migration that rewrote every completed_at to now(), or
-- repointed a follow, or reset a passport number.
--
-- So this file computes a FINGERPRINT of every row that matters, BEFORE MASTER
-- runs, and stores it. VERIFY recomputes the same fingerprints afterwards and
-- asserts byte equality.
--
-- The fingerprint function is defined HERE and called by BOTH sides. That is
-- deliberate: a VERIFY that re-implemented the projection could drift from
-- this one and produce a false pass — two different queries agreeing about
-- nothing. One implementation, called twice, is the only version of this test
-- that means anything.
--
-- WHERE IT LIVES, AND WHY NOT IN public
--
-- Schema `r3_upgrade_baseline`, not `public`. A test table in `public` would
-- enter VERIFY_R1A's public-table allow-list and its "every public table has
-- RLS forced" invariant, and the correct response to that is not to add a test
-- table to a product allow-list.
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
-- EVERY VALUE HERE IS INVENTED. Fixed literal UUIDs and fixed literal
-- timestamps so assertions can name exact values rather than ranges,
-- @seed.invalid addresses (a reserved TLD that can never route), and names
-- that belong to nobody. No production data is reproduced anywhere in this
-- file.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 0. Accounts and one established, paying tenant
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

-- salon_pro deliberately, so the historical rows below were created under
-- terms DIFFERENT from whatever plan the fixture is later moved to. That is
-- what makes the commercial-snapshot claim falsifiable rather than trivially
-- true.
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

-- handle_new_membership already created the staff_profiles row; adopt it
-- rather than colliding with it. Adopting what the product made is also a more
-- faithful starting state than one this file invented.
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
-- 1. HISTORY THAT PREDATES INSTRUMENTATION
--
-- Fixed literal timestamps, not `now() - interval`, so VERIFY can assert exact
-- values rather than ranges. A range assertion would pass against a migration
-- that shifted every timestamp by an hour.
--
-- booked_by_user_id is set on purpose. It is the attribution R1B's auto-follow
-- and relationship recording both key on, so seeding it means the pre-R3
-- database already contains a professional_follows edge and a
-- customer_professional_relationships row — and VERIFY can then assert that
-- those pre-existing facts produced NO analytics events, which is a far
-- stronger no-backfill claim than an empty tenant would give.
-- ---------------------------------------------------------------------------

insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id,
   customer_name, booked_by_user_id, starts_at, ends_at, status, completed_at, created_at)
values
  ('44445000-0000-4000-8000-000000000001', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Past One',
   '44440000-0000-4000-8000-000000000003',
   timestamptz '2026-07-01 10:00:00+00', timestamptz '2026-07-01 10:30:00+00',
   'completed', timestamptz '2026-07-01 10:33:00+00', timestamptz '2026-06-28 09:00:00+00'),
  ('44445000-0000-4000-8000-000000000002', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Past Two',
   '44440000-0000-4000-8000-000000000003',
   timestamptz '2026-08-01 14:00:00+00', timestamptz '2026-08-01 14:30:00+00',
   'completed', timestamptz '2026-08-01 14:31:00+00', timestamptz '2026-07-25 11:00:00+00'),
  -- A LIVE COMMITMENT. Relative, because it must genuinely be in the future
  -- for the post-upgrade completion test to be realistic. Its exact value is
  -- never asserted; the fingerprint pins it, which is what matters.
  ('44445000-0000-4000-8000-000000000003', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Future',
   '44440000-0000-4000-8000-000000000003',
   now() + interval '5 days', now() + interval '5 days' + interval '30 minutes',
   'confirmed', null, now())
on conflict (id) do nothing;

insert into public.queue_entries
  (id, organization_id, location_id, barber_id, service_id, customer_name,
   booked_by_user_id, status, called_at, service_started_at, completed_at, created_at)
values
  ('44446000-0000-4000-8000-000000000001', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Walkin Past',
   '44440000-0000-4000-8000-000000000003', 'completed',
   timestamptz '2026-07-15 09:10:00+00', timestamptz '2026-07-15 09:15:00+00',
   timestamptz '2026-07-15 09:45:00+00', timestamptz '2026-07-15 09:00:00+00'),
  -- Someone actually standing in the shop while the upgrade runs.
  ('44446000-0000-4000-8000-000000000002', '44441000-0000-4000-8000-000000000001',
   '44442000-0000-4000-8000-000000000001', '44443000-0000-4000-8000-000000000001',
   '44444000-0000-4000-8000-000000000001', 'Seed Walkin Waiting',
   '44440000-0000-4000-8000-000000000003', 'waiting',
   null, null, null, now())
on conflict (id) do nothing;

insert into public.organization_follows
  (follower_user_id, organization_id, is_following, followed_at, created_at, updated_at)
values
  ('44440000-0000-4000-8000-000000000003', '44441000-0000-4000-8000-000000000001',
   true, timestamptz '2026-07-05 08:00:00+00',
   timestamptz '2026-07-05 08:00:00+00', timestamptz '2026-07-05 08:00:00+00')
on conflict (follower_user_id, organization_id) do nothing;

insert into public.customer_favorites (id, user_id, organization_id, created_at)
values ('44447000-0000-4000-8000-000000000001',
        '44440000-0000-4000-8000-000000000003',
        '44441000-0000-4000-8000-000000000001',
        timestamptz '2026-07-05 08:01:00+00')
on conflict (id) do nothing;

insert into public.customer_passports (id, user_id, created_at)
values ('44448000-0000-4000-8000-000000000001',
        '44440000-0000-4000-8000-000000000003',
        timestamptz '2026-07-05 08:02:00+00')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. THE BASELINE FINGERPRINT
--
-- One function, called by this file to RECORD and by VERIFY to RECOMPUTE.
--
-- Each projection is an ordered, fully-qualified list of the columns whose
-- change would constitute the upgrade having rewritten history. md5 over the
-- ordered aggregate, so a changed value, a changed row, an added row and a
-- removed row are all a different digest — and the row_count is stored beside
-- it so a mismatch says which kind of change it was rather than only that
-- there was one.
--
-- Deliberately NOT `select *`: a new column added by a LATER lot would then
-- change the digest and produce a failure that means nothing. The columns
-- named here are the ones whose values are the shop's history.
-- ---------------------------------------------------------------------------

create schema if not exists r3_upgrade_baseline;

comment on schema r3_upgrade_baseline is
  'Upgrade-test scaffolding only. Never created by a migration and never present in production: it exists solely so SEED can record a pre-upgrade fingerprint that VERIFY can compare against. Deliberately outside `public` so it cannot enter VERIFY_R1A''s public-table allow-list or its RLS invariant.';

create or replace function r3_upgrade_baseline.digest(p_entity text)
returns table (row_count bigint, fingerprint text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org uuid := '44441000-0000-4000-8000-000000000001';
  v_user uuid := '44440000-0000-4000-8000-000000000003';
begin
  if p_entity = 'appointments' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', a.id, a.status, a.starts_at, a.ends_at, a.completed_at,
                       a.customer_name, a.barber_id, a.service_id, a.location_id,
                       a.booked_by_user_id, a.created_at) as x
      from public.appointments a where a.organization_id = v_org
    ) s;

  elsif p_entity = 'queue_entries' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', q.id, q.status, q.called_at, q.service_started_at,
                       q.completed_at, q.customer_name, q.barber_id, q.service_id,
                       q.booked_by_user_id, q.created_at) as x
      from public.queue_entries q where q.organization_id = v_org
    ) s;

  elsif p_entity = 'organization_follows' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', f.follower_user_id, f.organization_id, f.is_following,
                       f.followed_at, f.unfollowed_at, f.created_at) as x
      from public.organization_follows f where f.organization_id = v_org
    ) s;

  elsif p_entity = 'professional_follows' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', pf.follower_user_id, pf.professional_id, pf.state,
                       pf.source, pf.followed_at, pf.unfollowed_at) as x
      from public.professional_follows pf
      where pf.follower_user_id = v_user
    ) s;

  elsif p_entity = 'customer_favorites' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', cf.id, cf.user_id, cf.organization_id, cf.barber_id,
                       cf.created_at) as x
      from public.customer_favorites cf where cf.organization_id = v_org
    ) s;

  elsif p_entity = 'customer_passports' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', cp.id, cp.user_id, cp.passport_number, cp.created_at) as x
      from public.customer_passports cp where cp.user_id = v_user
    ) s;

  elsif p_entity = 'relationships' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', r.customer_user_id, r.professional_id, r.organization_id,
                       r.completed_interaction_count, r.first_completed_at,
                       r.last_completed_at) as x
      from public.customer_professional_relationships r
      where r.organization_id = v_org
    ) s;

  elsif p_entity = 'commercial_state' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', s2.organization_id, s2.plan_key, s2.status) as x
      from public.organization_commercial_state s2 where s2.organization_id = v_org
    ) s;

  elsif p_entity = 'professionals' then
    return query
    select count(*)::bigint,
           md5(coalesce(string_agg(x, '|' order by x), ''))
    from (
      select concat_ws(':', p.id, p.display_name, p.claim_state, p.source,
                       p.is_public, p.user_id) as x
      from public.professionals p
      join public.barbers b on b.professional_id = p.id
      where b.organization_id = v_org
    ) s;

  else
    raise exception 'unknown baseline entity: %', p_entity;
  end if;
end;
$$;

comment on function r3_upgrade_baseline.digest(text) is
  'The ONE fingerprint implementation, called by SEED to record and by VERIFY to recompute. Sharing it is the point: a VERIFY that re-implemented these projections could drift from the seed and produce two different queries agreeing about nothing, which would look exactly like a passing test.';

create table if not exists r3_upgrade_baseline.snapshot (
  entity text primary key,
  row_count bigint not null,
  fingerprint text not null,
  captured_at timestamptz not null default now()
);

comment on table r3_upgrade_baseline.snapshot is
  'The state of the seeded tenant''s history immediately BEFORE MASTER runs. VERIFY recomputes and compares; any difference means the analytics install rewrote data it had no business touching.';

insert into r3_upgrade_baseline.snapshot (entity, row_count, fingerprint)
select e, d.row_count, d.fingerprint
from unnest(array[
  'appointments', 'queue_entries', 'organization_follows', 'professional_follows',
  'customer_favorites', 'customer_passports', 'relationships',
  'commercial_state', 'professionals'
]) as e
cross join lateral r3_upgrade_baseline.digest(e) d
on conflict (entity) do update
  set row_count = excluded.row_count,
      fingerprint = excluded.fingerprint,
      captured_at = now();

-- ---------------------------------------------------------------------------
-- 3. Assert the seed built what it claims to have built
--
-- A seed that silently produced an empty tenant would make every §15
-- assertion in VERIFY pass vacuously — the upgrade test would report success
-- while having tested nothing at all. This is the one guard against that, and
-- it runs here rather than in VERIFY because a broken seed should stop the
-- run, not be reported as a passing check.
-- ---------------------------------------------------------------------------

do $$
declare
  v_appts integer;
  v_queue integer;
  v_rels integer;
  v_profollows integer;
begin
  select count(*) into v_appts from public.appointments
   where organization_id = '44441000-0000-4000-8000-000000000001';
  select count(*) into v_queue from public.queue_entries
   where organization_id = '44441000-0000-4000-8000-000000000001';
  select count(*) into v_rels from public.customer_professional_relationships
   where organization_id = '44441000-0000-4000-8000-000000000001';
  select count(*) into v_profollows from public.professional_follows
   where follower_user_id = '44440000-0000-4000-8000-000000000003';

  if v_appts <> 3 then
    raise exception 'R3 seed: expected 3 appointments, built %', v_appts;
  end if;
  if v_queue <> 2 then
    raise exception 'R3 seed: expected 2 queue entries, built %', v_queue;
  end if;

  -- These two are produced by R1B's own triggers reacting to the seeded rows,
  -- not written directly. If they are absent the seed is not exercising the
  -- cross-lot chain it was written to exercise, and VERIFY's strongest
  -- no-backfill assertion would be testing an empty set.
  if v_rels < 1 then
    raise exception 'R3 seed: no customer_professional_relationships were produced; the pre-R3 cross-lot chain is not seeded';
  end if;

  raise notice 'R3 pre-upgrade seed loaded: 3 appointments (2 historically completed), 2 queue entries (1 completed, 1 waiting), 1 org follow, % professional follow(s), 1 favorite, 1 passport, % relationship(s) — all created BEFORE any analytics trigger exists.',
    v_profollows, v_rels;
  raise notice 'R3 baseline fingerprint recorded for % entities.',
    (select count(*) from r3_upgrade_baseline.snapshot);
end $$;

commit;
