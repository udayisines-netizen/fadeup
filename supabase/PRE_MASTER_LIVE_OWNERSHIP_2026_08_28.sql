-- ============================================================================
-- FadeUp — reproduce LIVE object ownership in a disposable database
--
-- WHY THIS FILE EXISTS
--
-- A clean replay of db/migrations creates every object as `postgres`. The live
-- database does not look like that: the competitor-intelligence lot's objects
-- are owned by `supabase_admin`, because that is the role the operator applied
-- them with.
--
-- That difference is invisible to every test in this repository, and it broke a
-- deployment. R4.1's first apply against live failed on:
--
--     ERROR: must be owner of type booking_provider_detection_method
--
-- The transaction rolled back cleanly and nothing was damaged, but the
-- migration had passed a fresh replay AND a seeded upgrade test, because both
-- ran against a database where `postgres` owned everything. The upgrade test
-- was answering a question production was not asking.
--
-- Applied through --pre-master, this makes a disposable database wrong in the
-- same way production is wrong, so a migration that needs ownership it does not
-- have fails in CI rather than at deploy time.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- It does not "fix" live. Reassigning ownership on a production database is a
-- separate operational decision with its own risk, and quietly folding it into
-- a migration would be exactly the kind of unrelated ALTER OWNER the brief
-- forbids. This file makes the TEST match production; it does not make
-- production match the test.
--
-- USAGE
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260828110000_planity_booking_status_and_source_independence.sql \
--     --pre-master supabase/PRE_MASTER_LIVE_OWNERSHIP_2026_08_28.sql \
--     --master-role supabase_admin \
--     --master supabase/MASTER_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql \
--     --verify supabase/VERIFY_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
--
-- Run as supabase_admin (the harness does this): reassigning ownership requires
-- being a member of the target role, and `postgres` is not a member of
-- `supabase_admin` on the live stack.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Ownership observed on the live database on 2026-08-28.
--
-- Guarded on existence so this file stays usable if it is ever run against a
-- base that predates the competitor-intelligence lot.
do $$
begin
  if exists (select 1 from pg_type where typname = 'booking_provider_detection_method') then
    execute 'alter type public.booking_provider_detection_method owner to supabase_admin';
  end if;

  if to_regclass('public.booking_provider_observations') is not null then
    execute 'alter table public.booking_provider_observations owner to supabase_admin';
  end if;

  if to_regclass('public.booking_providers') is not null then
    execute 'alter table public.booking_providers owner to supabase_admin';
  end if;
end $$;

-- Assert the reproduction actually took. A pre-master step that silently did
-- nothing would let the ownership test pass for the wrong reason — the exact
-- failure mode it exists to prevent.
do $$
declare
  v_type_owner text;
  v_table_owner text;
begin
  select pg_get_userbyid(typowner) into v_type_owner
  from pg_type where typname = 'booking_provider_detection_method';

  select pg_get_userbyid(relowner) into v_table_owner
  from pg_class where oid = 'public.booking_provider_observations'::regclass;

  if v_type_owner is distinct from 'supabase_admin' or v_table_owner is distinct from 'supabase_admin' then
    raise exception 'live-ownership reproduction failed: type owner=%, table owner=%',
      v_type_owner, v_table_owner;
  end if;

  raise notice 'live ownership reproduced: competitor-intelligence objects now owned by supabase_admin';
end $$;

commit;
