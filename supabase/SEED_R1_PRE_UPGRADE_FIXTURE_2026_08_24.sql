-- ============================================================================
-- FadeUp — SEED: realistic PRE-R1 data, for testing the R1 backfills
--
-- Loaded by scripts/disposable-db-test.sh --seed, in the window between the
-- pre-R1 migration replay and MASTER. Its whole purpose is to make the
-- backfill do real work: applying MASTER to an empty database proves the SQL
-- parses, not that it migrates anything correctly.
--
-- The fixture is chosen to cover the cases that can actually go wrong:
--
--   * a professional who is a barber at TWO organizations
--       -> must yield ONE professionals row, not two (mission §99)
--   * a staff profile with is_active = false and is_public = TRUE
--       -> must still get an identity, but that identity must NOT inherit
--          is_public, which defaults to true on staff_profiles and false on
--          professionals
--   * an owner who is not a barber
--       -> must get NO professional identity
--   * registered customers with no Fade Passport at all
--       -> must be issued one
--   * a LEGACY passport that predates passport_number
--       -> must be assigned a number without disturbing its other columns
--
-- Unlike VERIFY, this file COMMITS — the rows must survive into the MASTER
-- run. It is only ever loaded into a throwaway container.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

create table if not exists public.r1_backfill_baseline (
  k text primary key,
  v bigint not null
);

comment on table public.r1_backfill_baseline is
  'Test-harness scratch table written by SEED_R1_PRE_UPGRADE_FIXTURE. Never created by a migration and never present in a real database.';

-- RLS enabled and forced with no policy at all, so this scratch table obeys
-- the same rule as every other table in public and VERIFY's database-wide
-- "no table has lost RLS" assertion stays absolute rather than needing an
-- exception carved out for the harness. Reads still work from the harness,
-- which connects as postgres (rolbypassrls).
alter table public.r1_backfill_baseline enable row level security;
alter table public.r1_backfill_baseline force row level security;

create temporary table seed_ids (k text primary key, v uuid) on commit drop;

insert into seed_ids (k, v) values
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('mobile_pro', gen_random_uuid()),   -- barber at BOTH orgs
  ('quiet_pro', gen_random_uuid()),    -- barber, inactive staff profile
  ('cust_old', gen_random_uuid()),     -- registered customer, no passport
  ('cust_legacy', gen_random_uuid());  -- registered customer, passport without a number

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
       k || '+seed@fadeup.test', 'x', '{}'::jsonb,
       jsonb_build_object('full_name', initcap(replace(k, '_', ' '))), now(), now()
from seed_ids;

-- Organizations, via the documented stand-down flags.
do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);

  insert into public.organizations (id, name, slug, marketplace_visible)
  values
    ((select v from seed_ids where k = 'owner_a'), 'Seed Shop A', 'seed-shop-a', true),
    ((select v from seed_ids where k = 'owner_b'), 'Seed Shop B', 'seed-shop-b', true);
end $$;

insert into public.locations (organization_id, name, city, country, is_active)
values
  ((select v from seed_ids where k = 'owner_a'), 'Seed A Main', 'Lyon', 'FR', true),
  ((select v from seed_ids where k = 'owner_b'), 'Seed B Main', 'Lyon', 'FR', true);

-- Memberships auto-create staff_profiles through on_membership_created.
insert into public.memberships (organization_id, user_id, role) values
  ((select v from seed_ids where k = 'owner_a'), (select v from seed_ids where k = 'owner_a'), 'owner'),
  ((select v from seed_ids where k = 'owner_b'), (select v from seed_ids where k = 'owner_b'), 'owner'),
  ((select v from seed_ids where k = 'owner_a'), (select v from seed_ids where k = 'mobile_pro'), 'barber'),
  ((select v from seed_ids where k = 'owner_b'), (select v from seed_ids where k = 'mobile_pro'), 'barber'),
  ((select v from seed_ids where k = 'owner_b'), (select v from seed_ids where k = 'quiet_pro'), 'barber');

-- The inactive-but-public staff profile: is_public stays TRUE (its default),
-- which is exactly the value the backfill must NOT copy across.
update public.staff_profiles
set is_active = false, is_public = true
where user_id = (select v from seed_ids where k = 'quiet_pro');

-- Only the two barbers become bookable barbers. The owners do not.
insert into public.barbers (organization_id, staff_profile_id)
select sp.organization_id, sp.id
from public.staff_profiles sp
where sp.user_id in (
  (select v from seed_ids where k = 'mobile_pro'),
  (select v from seed_ids where k = 'quiet_pro')
);

-- Registered customers. Neither has a passport yet; one will get a legacy,
-- unnumbered passport row below.
insert into public.customer_profiles (user_id, display_name) values
  ((select v from seed_ids where k = 'cust_old'), 'Old Customer'),
  ((select v from seed_ids where k = 'cust_legacy'), 'Legacy Customer');

-- A passport created before passport_number existed. Written directly rather
-- than through any RPC, because that is what a real pre-R1 row looks like.
insert into public.customer_passports (user_id, usual_haircut, fade_type)
values ((select v from seed_ids where k = 'cust_legacy'), 'Skin fade', 'low');

-- ---------------------------------------------------------------------------
-- Baseline counts, recorded BEFORE the upgrade so the assertions after MASTER
-- can compare against measured reality rather than an assumed number
-- (mission §71 — measure source counts, measure target counts, explain any
-- difference).
-- ---------------------------------------------------------------------------

insert into public.r1_backfill_baseline (k, v) values
  ('barbers', (select count(*) from public.barbers)),
  ('distinct_barber_users', (select count(distinct sp.user_id)
                             from public.barbers b
                             join public.staff_profiles sp on sp.id = b.staff_profile_id)),
  ('staff_profiles', (select count(*) from public.staff_profiles)),
  ('customer_profiles', (select count(*) from public.customer_profiles)),
  ('customer_passports', (select count(*) from public.customer_passports)),
  ('organizations', (select count(*) from public.organizations)),
  ('memberships', (select count(*) from public.memberships)),
  ('auth_users', (select count(*) from auth.users))
on conflict (k) do update set v = excluded.v;

commit;

\echo 'SEED: pre-R1 fixture committed'
select k, v from public.r1_backfill_baseline order by k;
