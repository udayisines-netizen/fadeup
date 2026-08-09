-- FadeUp LOT 2 — RLS / tenant isolation verification script.
-- Runs as postgres (bypasses RLS) to seed fixture data, then simulates real
-- authenticated/anon sessions via SET LOCAL ROLE + request.jwt.claims, per
-- Supabase's documented RLS testing approach, to prove isolation.
-- This script is a one-off verification tool, not a migration. Fixture data
-- (auth.users rows with @fadeup-test.local emails, their orgs/memberships/
-- locations, and audit_logs rows tagged {"seed":"lot2-verify"}) is created
-- and then deleted again at the end, in the same run.
--
-- Run it against the local Supabase stack (db/migrations/ must already be
-- applied) with:
--   docker cp db/tests/verify_rls.sql fadeup-supabase-db:/tmp/verify_rls.sql
--   docker exec fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_rls.sql
--
-- Read the output top to bottom: each numbered section states what it
-- expects (row counts / blocked writes) immediately above the query.
-- ON_ERROR_STOP is intentionally off — several sections' entire point is to
-- demonstrate that an operation is correctly rejected by RLS, which raises
-- a Postgres ERROR; the surrounding transaction is rolled back either way.

\set ON_ERROR_STOP off
\pset pager off

\echo '=========================================================='
\echo '0. SEED FIXTURE DATA (as postgres, bypasses RLS)'
\echo '=========================================================='

select gen_random_uuid() as alice_id \gset
select gen_random_uuid() as bob_id \gset
select gen_random_uuid() as carol_id \gset
select gen_random_uuid() as dave_id \gset
select gen_random_uuid() as eve_id \gset

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', :'alice_id', 'authenticated', 'authenticated', 'alice@fadeup-test.local', 'x', now(), '{}', '{"full_name":"Alice Owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', :'bob_id',   'authenticated', 'authenticated', 'bob@fadeup-test.local',   'x', now(), '{}', '{"full_name":"Bob Owner"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', :'carol_id', 'authenticated', 'authenticated', 'carol@fadeup-test.local', 'x', now(), '{}', '{"full_name":"Carol Manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', :'dave_id',  'authenticated', 'authenticated', 'dave@fadeup-test.local',  'x', now(), '{}', '{"full_name":"Dave Barber"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', :'eve_id',   'authenticated', 'authenticated', 'eve@fadeup-test.local',   'x', now(), '{}', '{"full_name":"Eve PlatformAdmin"}', now(), now());

\echo '-- profiles auto-created by handle_new_user() trigger:'
select id, full_name from public.profiles where id in (:'alice_id', :'bob_id', :'carol_id', :'dave_id', :'eve_id') order by full_name;

\echo '-- eve is a platform admin (operator-managed table, inserted directly, no client path exists):'
insert into public.platform_admins (user_id, note) values (:'eve_id', 'seeded for LOT2 RLS verification');

-- Alice creates Org A via the create_organization() RPC (see
-- 20260809101000_create_organization_rpc.sql — a bare
-- `insert ... returning` here would fail RLS for a brand-new org; this is a
-- real bug that was found and fixed during this verification pass, see
-- that migration's comment for the full explanation). The AFTER INSERT
-- trigger (handle_new_organization) makes her its owner automatically,
-- using her own session identity.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select id as org_a_id from public.create_organization('Alice''s Barbershop', 'alices-barbershop') \gset
commit;

-- Bob creates Org B, same pattern.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'bob_id', 'role', 'authenticated')::text, true);
select id as org_b_id from public.create_organization('Bob''s Barbershop', 'bobs-barbershop') \gset
commit;

\echo '-- organizations created:'
select id, name, slug from public.organizations where id in (:'org_a_id', :'org_b_id') order by name;

\echo '-- owner memberships auto-created by handle_new_organization() trigger:'
select organization_id, user_id, role from public.memberships order by organization_id;

-- Alice (owner of Org A) adds Carol as manager and Dave as barber.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
insert into public.memberships (organization_id, user_id, role) values (:'org_a_id', :'carol_id', 'manager');
insert into public.memberships (organization_id, user_id, role) values (:'org_a_id', :'dave_id', 'barber');
insert into public.locations (organization_id, name, city) values (:'org_a_id', 'Org A Downtown', 'Springfield');
commit;

-- Bob (owner of Org B) adds a location for his own org.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'bob_id', 'role', 'authenticated')::text, true);
insert into public.locations (organization_id, name, city) values (:'org_b_id', 'Org B Uptown', 'Shelbyville');
commit;

\echo '-- final membership roster (seeded as postgres, for reference):'
select o.name as org, m.role, p.full_name
from public.memberships m
join public.organizations o on o.id = m.organization_id
join public.profiles p on p.id = m.user_id
order by o.name, m.role;

-- Seed one audit_log row per org directly (no client insert path exists by
-- design; audit_logs is system-written only).
insert into public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
values
  (:'org_a_id', :'alice_id', 'organization.created', 'organization', :'org_a_id', '{"seed":"lot2-verify"}'),
  (:'org_b_id', :'bob_id',   'organization.created', 'organization', :'org_b_id', '{"seed":"lot2-verify"}');

\echo ''
\echo '=========================================================='
\echo '1. ALICE (owner, Org A) reads her own org — expect 1 row, Org A'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select id, name from public.organizations where id = :'org_a_id';
commit;

\echo ''
\echo '=========================================================='
\echo '2. ALICE reads Org B by id directly — expect 0 rows (CROSS-TENANT READ BLOCKED)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select id, name from public.organizations where id = :'org_b_id';
commit;

\echo ''
\echo '=========================================================='
\echo '3. ALICE selects * from organizations (no filter) — expect ONLY Org A visible'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select id, name from public.organizations order by name;
commit;

\echo ''
\echo '=========================================================='
\echo '4. ALICE reads Org A memberships — expect 3 rows (alice/carol/dave)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select organization_id, role from public.memberships where organization_id = :'org_a_id';
commit;

\echo ''
\echo '=========================================================='
\echo '5. ALICE reads Org B memberships (bob''s org) — expect 0 rows (CROSS-TENANT READ BLOCKED)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select organization_id, role from public.memberships where organization_id = :'org_b_id';
commit;

\echo ''
\echo '=========================================================='
\echo '6. ALICE reads locations — expect only Org A''s location, never Org B''s'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select organization_id, name, city from public.locations order by name;
commit;

\echo ''
\echo '=========================================================='
\echo '7. ALICE attempts to INSERT a location into Org B — expect RLS policy violation (blocked write)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
insert into public.locations (organization_id, name) values (:'org_b_id', 'Alice trying to plant a location in Org B');
rollback;

\echo ''
\echo '=========================================================='
\echo '8. BOB (owner, Org B) reads Org B — expect 1 row; reads Org A by id — expect 0 rows'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'bob_id', 'role', 'authenticated')::text, true);
select id, name from public.organizations where id = :'org_b_id';
select id, name from public.organizations where id = :'org_a_id';
select organization_id, role from public.memberships where organization_id = :'org_a_id';
commit;

\echo ''
\echo '=========================================================='
\echo '9. BOB attempts to INSERT a membership row into Org A (self-promote into a foreign org) — expect blocked'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'bob_id', 'role', 'authenticated')::text, true);
insert into public.memberships (organization_id, user_id, role) values (:'org_a_id', :'bob_id', 'owner');
rollback;

\echo ''
\echo '=========================================================='
\echo '10. CAROL (manager, Org A) attempts to self-promote to owner — expect blocked by with-check guard'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'carol_id', 'role', 'authenticated')::text, true);
update public.memberships set role = 'owner' where organization_id = :'org_a_id' and user_id = :'carol_id';
rollback;

\echo ''
\echo '=========================================================='
\echo '11. PROFILES: ALICE reads her own profile (1 row) then tries BOB''s profile by id (0 rows) — no cross-user PII leak'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select id, full_name from public.profiles where id = :'alice_id';
select id, full_name from public.profiles where id = :'bob_id';
select count(*) as total_profiles_visible_to_alice from public.profiles;
commit;

\echo ''
\echo '=========================================================='
\echo '12. AUDIT LOGS: ALICE (owner Org A) sees Org A logs; DAVE (barber Org A) sees NONE (role-gated); BOB sees only Org B logs'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
\echo '-- alice (owner):'
select organization_id, action from public.audit_logs where organization_id = :'org_a_id';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'dave_id', 'role', 'authenticated')::text, true);
\echo '-- dave (barber, same org, expect 0 rows):'
select organization_id, action from public.audit_logs where organization_id = :'org_a_id';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'bob_id', 'role', 'authenticated')::text, true);
\echo '-- bob (owner, Org B) reading Org A logs, expect 0 rows:'
select organization_id, action from public.audit_logs where organization_id = :'org_a_id';
\echo '-- bob reading his own Org B logs, expect 1 row:'
select organization_id, action from public.audit_logs where organization_id = :'org_b_id';
commit;

\echo ''
\echo '=========================================================='
\echo '13. PLATFORM_ADMINS: EVE sees her own row; ALICE (not an admin) sees 0 rows'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'eve_id', 'role', 'authenticated')::text, true);
select user_id, note from public.platform_admins;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
select user_id, note from public.platform_admins;
commit;

\echo ''
\echo '=========================================================='
\echo '14. PLATFORM ADMIN READ-ONLY OVERRIDE: EVE (platform admin, not a member of either org) can SELECT both orgs, memberships, locations'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'eve_id', 'role', 'authenticated')::text, true);
select name from public.organizations order by name;
select o.name as org, count(*) as members from public.memberships m join public.organizations o on o.id = m.organization_id group by o.name order by o.name;
commit;

\echo ''
\echo '=========================================================='
\echo '15. ANON: zero access to every tenant table'
\echo '=========================================================='
begin;
set local role anon;
select count(*) as organizations_visible_to_anon from public.organizations;
select count(*) as memberships_visible_to_anon from public.memberships;
select count(*) as locations_visible_to_anon from public.locations;
select count(*) as profiles_visible_to_anon from public.profiles;
select count(*) as audit_logs_visible_to_anon from public.audit_logs;
select count(*) as platform_admins_visible_to_anon from public.platform_admins;
commit;

\echo ''
\echo '=========================================================='
\echo '16. Documented RLS/RETURNING gotcha this lot found+fixed: a bare INSERT...RETURNING for'
\echo '    a brand-new org fails (organizations SELECT policy not yet satisfiable when'
\echo '    RETURNING is checked, before the owner-membership trigger effect is visible).'
\echo '    A plain INSERT with no RETURNING still succeeds and still grants ownership.'
\echo '    This is why public.create_organization() RPC exists for client use.'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
\echo '-- bare INSERT ... RETURNING (expect ERROR):'
insert into public.organizations (name, slug) values ('Should Fail', 'should-fail-returning') returning id;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'alice_id', 'role', 'authenticated')::text, true);
\echo '-- bare INSERT with no RETURNING (expect success), then a separate follow-up SELECT sees it:'
insert into public.organizations (name, slug) values ('Should Succeed', 'should-succeed-no-returning');
select name, slug from public.organizations where slug = 'should-succeed-no-returning';
rollback;

\echo ''
\echo '=========================================================='
\echo 'CLEANUP: remove fixture data (as postgres, bypasses RLS)'
\echo '=========================================================='
reset role;
delete from auth.users where id in (:'alice_id', :'bob_id', :'carol_id', :'dave_id', :'eve_id');
\echo '-- cascade check: profiles/memberships/locations actor refs for fixture users are gone; orgs (owned, not user-keyed) removed explicitly next:'
delete from public.organizations where id in (:'org_a_id', :'org_b_id');
-- audit_logs intentionally uses ON DELETE SET NULL (not CASCADE) on both
-- organization_id and actor_user_id, by design (see audit_logs migration:
-- deleting an org/user must not destroy its audit trail). That means the
-- fixture audit_log rows seeded above are NOT removed by the deletes above
-- and must be cleaned up explicitly here, tagged by the seed marker used
-- when they were inserted.
delete from public.audit_logs where metadata @> '{"seed":"lot2-verify"}';
select count(*) as remaining_fixture_profiles from public.profiles where id in (:'alice_id', :'bob_id', :'carol_id', :'dave_id', :'eve_id');
select count(*) as remaining_fixture_orgs from public.organizations where id in (:'org_a_id', :'org_b_id');
select count(*) as remaining_fixture_audit_logs from public.audit_logs where metadata @> '{"seed":"lot2-verify"}';
\echo 'DONE.'
