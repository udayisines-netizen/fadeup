-- FadeUp — verification: location-scoped staff invitations
-- (db/migrations/20260810150000_invitation_location_scope.sql)
--
-- Proves: an owner can create a location-scoped invitation; a
-- cross-organization location_id is rejected by the consistency trigger
-- (not just RLS); get_invitation_by_token surfaces the location name;
-- accepting the invitation sets the new staff member's
-- staff_profiles.location_id to match.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- Run with:
--   docker cp db/tests/verify_invitation_location_scope.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_invitation_location_scope.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('acacacac-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'jack+lot15b@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Jack Owner"}', 'authenticated', 'authenticated'),
  ('acacacac-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'rita+lot15b@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Rita Receptionist"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Jack onboards with a second location; an unrelated org exists with its own location'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'acacacac-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Jacks Barbers LOT15b', 'jacks-barbers-lot15b', 'Main Shop', 'UTC');
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'jacks-barbers-lot15b' \gset
select id as main_location_id from public.locations where organization_id = :'org_id' \gset
insert into public.locations (organization_id, name, timezone) values (:'org_id', 'Second Shop', 'UTC') returning id as second_location_id \gset
insert into public.organizations (id, name, slug) values ('bcbcbcbc-0000-0000-0000-000000000001', 'Unrelated Org (LOT15b fixture)', 'unrelated-org-lot15b') returning id as unrelated_org_id \gset
insert into public.locations (organization_id, name, timezone) values (:'unrelated_org_id', 'Unrelated Location', 'UTC') returning id as unrelated_location_id \gset
commit;

\echo '=========================================================='
\echo '2. Jack invites Rita as receptionist, scoped to the Second Shop location — succeeds'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'acacacac-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.invitations (organization_id, email, role, token, invited_by, location_id)
values (:'org_id', 'rita+lot15b@fadeup.test', 'receptionist', 'lot15b-rita-token', 'acacacac-0000-0000-0000-000000000001', :'second_location_id')
returning id as invitation_id \gset
commit;

\echo '=========================================================='
\echo '3. A location_id from a DIFFERENT organization is REJECTED (consistency trigger, not just RLS)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'acacacac-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: invitations.location_id must belong to the same organization_id'
insert into public.invitations (organization_id, email, role, token, invited_by, location_id)
values (:'org_id', 'someone-else@fadeup.test', 'barber', 'lot15b-bad-location-token', 'acacacac-0000-0000-0000-000000000001', :'unrelated_location_id');
rollback;

\echo '=========================================================='
\echo '4. get_invitation_by_token surfaces the location name'
\echo '=========================================================='
begin;
reset role;
select organization_name, role, location_name, is_expired, is_accepted, is_revoked from public.get_invitation_by_token('lot15b-rita-token');
commit;

\echo '=========================================================='
\echo '5. Rita accepts — her staff_profiles.location_id is set to the invited location'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'acacacac-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select role from public.accept_invitation('lot15b-rita-token');
commit;

begin;
reset role;
select
  (select location_id from public.staff_profiles where organization_id = :'org_id' and user_id = 'acacacac-0000-0000-0000-000000000002') = :'second_location_id'
  as rita_location_matches_invitation;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.invitations where organization_id in (:'org_id', :'unrelated_org_id');
delete from public.staff_profiles where organization_id in (:'org_id', :'unrelated_org_id');
delete from public.locations where organization_id in (:'org_id', :'unrelated_org_id');
delete from public.memberships where organization_id in (:'org_id', :'unrelated_org_id');
delete from public.organizations where id in (:'org_id', :'unrelated_org_id');
delete from auth.users where email like '%lot15b@fadeup.test';
select count(*) as remaining_users from auth.users where email like '%lot15b@fadeup.test';
commit;

\echo 'DONE.'
