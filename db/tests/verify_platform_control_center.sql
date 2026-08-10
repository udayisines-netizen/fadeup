-- FadeUp — verification: platform team roster visibility + support-view sessions
-- (db/migrations/20260810140000_platform_control_center.sql)
--
-- Proves: platform_owner sees the full platform_members/platform_invitations
-- roster (not just their own row); platform_support does NOT (only self,
-- via the pre-existing self-select policy) — matches the migration's
-- documented scope boundary; platform_support cannot start a support-view
-- session; platform_owner can; starting a second session auto-closes the
-- first (one open per actor); an actor cannot end someone else's session;
-- ending your own session succeeds; session start/end are audited.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- Run with:
--   docker cp db/tests/verify_platform_control_center.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_platform_control_center.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('fafafafa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'owner+pcc@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Owner"}', 'authenticated', 'authenticated'),
  ('fafafafa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'support+pcc@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Support"}', 'authenticated', 'authenticated'),
  ('fafafafa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'shopowner+pcc@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Shop Owner"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: a platform_owner, a platform_support member, and a barbershop org'
\echo '=========================================================='
begin;
reset role;
insert into public.platform_members (user_id, role) values
  ('fafafafa-0000-0000-0000-000000000001', 'platform_owner'),
  ('fafafafa-0000-0000-0000-000000000002', 'platform_support');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('PCC Test Shop', 'pcc-test-shop', 'Main Shop', 'UTC');
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'pcc-test-shop' \gset
commit;

\echo '=========================================================='
\echo '2. Platform owner sees the FULL platform_members roster (2 rows, not just their own)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select count(*) as members_visible_to_owner from public.platform_members;
commit;

\echo '=========================================================='
\echo '3. platform_support sees ONLY their own row — the admin-roster policy does not apply to them'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as members_visible_to_support from public.platform_members;
commit;

\echo '=========================================================='
\echo '4. platform_support CANNOT start a support-view session'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: only a platform owner or platform_admin may start a support-view session'
select public.start_platform_support_session(:'org_id', 'organization');
rollback;

\echo '=========================================================='
\echo '5. platform_owner starts a support-view session — succeeds and is audited'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select organization_id, target_type, ended_at is null as is_open from public.start_platform_support_session(:'org_id', 'organization', null, 'checking a support ticket');
commit;

begin;
reset role;
select count(*) as audit_rows from public.platform_audit_log where action = 'platform_support_session_started' and actor_user_id = 'fafafafa-0000-0000-0000-000000000001';
commit;

\echo '=========================================================='
\echo '6. Starting a SECOND session for the same actor auto-closes the first (one open per actor)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select id as second_session_id from public.start_platform_support_session(:'org_id', 'organization') \gset
commit;

begin;
reset role;
select count(*) as open_sessions_for_owner from public.platform_support_sessions where platform_actor_id = 'fafafafa-0000-0000-0000-000000000001' and ended_at is null;
commit;

\echo '=========================================================='
\echo '7. Support (a different platform member) cannot end the owners session'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: support session not found, not yours, or already ended'
select public.end_platform_support_session(:'second_session_id');
rollback;

\echo '=========================================================='
\echo '8. The owner ends their own session — succeeds and is audited'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select ended_at is not null as is_closed from public.end_platform_support_session(:'second_session_id');
commit;

begin;
reset role;
select count(*) as audit_end_rows from public.platform_audit_log where action = 'platform_support_session_ended' and actor_user_id = 'fafafafa-0000-0000-0000-000000000001';
commit;

\echo '=========================================================='
\echo '9. platform_invitations: owner sees the roster; a non-platform user sees nothing (RLS still applies)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select id as invite_id from public.create_platform_invitation('platform_support', null) \gset
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select count(*) as invitations_visible_to_owner from public.platform_invitations;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fafafafa-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select count(*) as invitations_visible_to_shop_owner from public.platform_invitations;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.platform_audit_log where actor_user_id in (
  'fafafafa-0000-0000-0000-000000000001', 'fafafafa-0000-0000-0000-000000000002', 'fafafafa-0000-0000-0000-000000000003'
);
delete from public.platform_support_sessions where platform_actor_id = 'fafafafa-0000-0000-0000-000000000001';
delete from public.platform_invitations where id = :'invite_id';
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id = :'org_id';
delete from public.platform_members where user_id in (
  'fafafafa-0000-0000-0000-000000000001', 'fafafafa-0000-0000-0000-000000000002'
);
delete from auth.users where email like '%pcc@fadeup.test';
select count(*) as remaining_users from auth.users where email like '%pcc@fadeup.test';
commit;

\echo 'DONE.'
