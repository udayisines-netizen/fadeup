-- FadeUp — LOT 3 verification: onboarding + invitation RPCs
--
-- Seeds two real auth.users fixtures (Frank the founder, Grace the invitee),
-- simulates their sessions the same way db/tests/verify_rls.sql does, and
-- exercises the actual RPCs end to end against the live schema — proving the
-- behavior, not just that the functions exist. Cleans up its own fixtures.
--
-- Run with:
--   docker cp db/tests/verify_onboarding_and_invitations.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_onboarding_and_invitations.sql

-- Several sections below deliberately trigger an error (proving a guard
-- works) and rely on the enclosing `begin; ... rollback;` to recover, so
-- ON_ERROR_STOP stays off for the whole script — read the output, not just
-- the exit code.

begin;

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('a1a1a1a1-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'frank+lot3@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('a1a1a1a1-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'grace+lot3@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{}', 'authenticated', 'authenticated');

commit;

\echo '=========================================================='
\echo '1. complete_organization_onboarding: Frank creates an org + first location atomically'
\echo '=========================================================='

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select * from public.complete_organization_onboarding('Frank''s Fades', 'franks-fades-lot3', 'Main Street', 'America/New_York');

select o.name as org_name, m.role as frank_role
from public.organizations o
join public.memberships m on m.organization_id = o.id and m.user_id = (select auth.uid())
where o.slug = 'franks-fades-lot3';

select name, timezone from public.locations
where organization_id = (select id from public.organizations where slug = 'franks-fades-lot3');

commit;

\echo '=========================================================='
\echo '2. Onboarding rollback: a failing location insert must not leave a half-created org'
\echo '=========================================================='

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

\echo '-- blank location name should violate locations_name_not_blank and roll back the whole call:'
select public.complete_organization_onboarding('Should Not Exist', 'should-not-exist-lot3', '   ', 'UTC');
rollback;

begin;
set local role postgres;
reset role;
select count(*) as orphan_org_count from public.organizations where slug = 'should-not-exist-lot3';
commit;

\echo '=========================================================='
\echo '3. Invitation flow: Frank invites Grace as a barber'
\echo '=========================================================='

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

insert into public.invitations (organization_id, email, role, token, invited_by)
select id, 'GRACE+LOT3@fadeup.test', 'barber', 'lot3-test-token-abc123', (select auth.uid())
from public.organizations where slug = 'franks-fades-lot3'
returning email as normalized_email, role;

commit;

\echo '-- anon can preview the invitation by token (no session at all):'
begin;
set local role anon;
reset request.jwt.claims;
select * from public.get_invitation_by_token('lot3-test-token-abc123');
commit;

\echo '-- Grace accepts the invitation:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

select * from public.accept_invitation('lot3-test-token-abc123');

select m.role
from public.memberships m
join public.organizations o on o.id = m.organization_id
where o.slug = 'franks-fades-lot3' and m.user_id = (select auth.uid());

\echo '-- accepting the same token a second time must fail:'
select public.accept_invitation('lot3-test-token-abc123');
commit;

\echo '=========================================================='
\echo '4. Cross-tenant / wrong-email guards'
\echo '=========================================================='

\echo '-- Frank invites a specific email; a DIFFERENT authenticated user must not be able to redeem it:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.invitations (organization_id, email, role, token, invited_by)
select id, 'someone-else@fadeup.test', 'receptionist', 'lot3-test-token-wrongemail', (select auth.uid())
from public.organizations where slug = 'franks-fades-lot3';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: issued to a different email address'
select public.accept_invitation('lot3-test-token-wrongemail');
rollback;

\echo '=========================================================='
\echo '5. revoke_invitation: a non-owner/manager cannot revoke'
\echo '=========================================================='

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.invitations (organization_id, email, role, token, invited_by)
select id, 'yet-another@fadeup.test', 'barber', 'lot3-test-token-revoke', (select auth.uid())
from public.organizations where slug = 'franks-fades-lot3';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- Grace (barber, not owner/manager) attempts to revoke: expect ERROR'
select public.revoke_invitation((select id from public.invitations where token = 'lot3-test-token-revoke'));
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- Frank (owner) revokes: expect success'
select * from public.revoke_invitation((select id from public.invitations where token = 'lot3-test-token-revoke'));
\echo '-- a revoked invitation cannot be accepted:'
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: this invitation has been revoked'
select public.accept_invitation('lot3-test-token-revoke');
rollback;

\echo '=========================================================='
\echo 'CLEANUP: remove fixture data (as postgres, bypasses RLS)'
\echo '=========================================================='

begin;
reset role;
delete from public.invitations where token like 'lot3-test-token%';
delete from public.locations where organization_id in (select id from public.organizations where slug like '%-lot3');
delete from public.memberships where organization_id in (select id from public.organizations where slug like '%-lot3');
delete from public.organizations where slug like '%-lot3';
delete from auth.users where email in ('frank+lot3@fadeup.test', 'grace+lot3@fadeup.test');

select count(*) as remaining_fixture_orgs from public.organizations where slug like '%-lot3';
select count(*) as remaining_fixture_users from auth.users where email like '%lot3@fadeup.test';
commit;

\echo 'DONE.'
