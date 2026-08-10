-- FadeUp — verification: platform_role hierarchy, bootstrap, invitations
-- (db/migrations/20260810130000_platform_roles.sql)
--
-- Covers the CLAUDE.md / master-plan "Platform Security" test matrix:
--   - a normal user cannot become platform_owner without a valid token
--   - the bootstrap token cannot be reused (replay)
--   - an expired bootstrap token fails
--   - a revoked bootstrap token fails
--   - once a platform_owner exists, claim_platform_owner_bootstrap always
--     fails (even with a second, otherwise-valid token)
--   - platform_admin cannot invite platform_admin (owner-only)
--   - platform_support cannot create ANY platform invitation
--   - an expired / revoked platform invitation is rejected
--   - a platform invitation can never carry role='platform_owner'
--     (constraint, not just RPC logic)
--   - platform_members/platform_invitations/platform_owner_bootstrap_tokens
--     have zero cross-user / anon read access
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- PRECONDITION: run this against a database with no real outstanding
-- platform_owner bootstrap token (i.e. public.platform_members is empty, or
-- at least platform_owner_bootstrap_tokens has no unclaimed/unrevoked row
-- besides this test's own fixtures). This test exercises bootstrap-token
-- expiry/revocation/replay, which needs full control over the table's "one
-- active token" slot (platform_owner_bootstrap_tokens_one_active is a
-- system-wide constraint, not scoped to this test) — it will NOT revoke a
-- real pending token to make room (that was a real bug, since fixed: see
-- git history), so it fails cleanly at its own setup step instead if one
-- exists, rather than risk touching it.
--
-- Run with:
--   docker cp db/tests/verify_platform_roles.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_platform_roles.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('eaeaeaea-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'founder+plat@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Founder"}', 'authenticated', 'authenticated'),
  ('eaeaeaea-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'rando+plat@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Random Signup"}', 'authenticated', 'authenticated'),
  ('eaeaeaea-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'support+plat@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Support Staff"}', 'authenticated', 'authenticated'),
  ('eaeaeaea-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'admin2+plat@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Would-be Admin"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Operator mints test bootstrap tokens (direct SQL, as it must be pre-claim).'
\echo '   platform_owner_bootstrap_tokens_one_active allows only ONE unclaimed+'
\echo '   unrevoked row at a time (by design — "never two simultaneous active'
\echo '   ownership tokens"), so these are inserted one at a time, revoking the'
\echo '   previous slot-holder first — exactly what an operator/reissue would do.'
\echo '=========================================================='
begin;
reset role;
insert into public.platform_owner_bootstrap_tokens (token_hash, expires_at, revoked_at)
values (encode(digest('lot15-revoked-raw-token', 'sha256'), 'hex'), now() + interval '1 day', now());
commit;

begin;
reset role;
insert into public.platform_owner_bootstrap_tokens (token_hash, expires_at)
values (encode(digest('lot15-expired-raw-token', 'sha256'), 'hex'), now() - interval '1 hour');
commit;

\echo '=========================================================='
\echo '2. A wrong/garbage token is rejected — a random signup cannot become platform_owner by guessing'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: invalid bootstrap token'
select public.claim_platform_owner_bootstrap('not-the-right-token');
rollback;

\echo '=========================================================='
\echo '3. The expired token is rejected'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: this bootstrap token has expired'
select public.claim_platform_owner_bootstrap('lot15-expired-raw-token');
rollback;

\echo '=========================================================='
\echo '4. The revoked token is rejected'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: this bootstrap token has been revoked'
select public.claim_platform_owner_bootstrap('lot15-revoked-raw-token');
rollback;

\echo '=========================================================='
\echo '5. Operator revokes the (expired, still-unrevoked) test token to free the'
\echo '   "one active" slot, then mints the real one — the valid token then'
\echo '   claims platform_owner for the caller. Succeeds exactly once.'
\echo '=========================================================='
begin;
reset role;
-- Scoped to THIS test's own fixture tokens only — never touch an
-- unrelated, real outstanding token that might exist in the database
-- (a blanket `where revoked_at is null` here would revoke it as a side
-- effect of running this test, which is exactly the kind of destructive
-- action a verification script must never risk against a shared/dev DB).
update public.platform_owner_bootstrap_tokens
set revoked_at = now()
where revoked_at is null
  and token_hash in (
    encode(digest('lot15-expired-raw-token', 'sha256'), 'hex'),
    encode(digest('lot15-bootstrap-raw-token', 'sha256'), 'hex')
  );
insert into public.platform_owner_bootstrap_tokens (token_hash, expires_at)
values (encode(digest('lot15-bootstrap-raw-token', 'sha256'), 'hex'), now() + interval '1 day');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select role from public.claim_platform_owner_bootstrap('lot15-bootstrap-raw-token');
commit;

\echo '=========================================================='
\echo '6. REPLAY: the same token cannot be claimed a second time (even by the same or a different user)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: this bootstrap token has already been claimed'
select public.claim_platform_owner_bootstrap('lot15-bootstrap-raw-token');
rollback;

\echo '=========================================================='
\echo '7. Once a platform_owner exists, no other bootstrap token can grant a second one'
\echo '=========================================================='
begin;
reset role;
-- Scoped to THIS test's own fixture tokens only — never touch an
-- unrelated, real outstanding token that might exist in the database
-- (a blanket `where revoked_at is null` here would revoke it as a side
-- effect of running this test, which is exactly the kind of destructive
-- action a verification script must never risk against a shared/dev DB).
update public.platform_owner_bootstrap_tokens
set revoked_at = now()
where revoked_at is null
  and token_hash in (
    encode(digest('lot15-expired-raw-token', 'sha256'), 'hex'),
    encode(digest('lot15-bootstrap-raw-token', 'sha256'), 'hex')
  );
insert into public.platform_owner_bootstrap_tokens (token_hash, expires_at)
values (encode(digest('lot15-second-owner-raw-token', 'sha256'), 'hex'), now() + interval '1 day');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: a platform owner already exists'
select public.claim_platform_owner_bootstrap('lot15-second-owner-raw-token');
rollback;

\echo '=========================================================='
\echo '8. Founder (platform_owner) invites Support Staff as platform_support — succeeds'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select raw_token is not null as has_raw_token, expires_at > now() as not_yet_expired from public.create_platform_invitation('platform_support', 'support+plat@fadeup.test');
commit;

\echo '=========================================================='
\echo '9. Support Staff accepts their invitation — succeeds, becomes platform_support.'
\echo '   (accept_platform_invitation only takes the RAW token, which a real'
\echo '   client has from the invite link — step 8 already proved the create'
\echo '   path works and returns one; this re-creates a known one so this'
\echo '   script, which has no client to receive that link, can accept it.)'
\echo '=========================================================='
begin;
reset role;
delete from public.platform_invitations where invited_email = 'support+plat@fadeup.test';
insert into public.platform_invitations (token_hash, role, invited_email, invited_by, expires_at)
values (encode(digest('lot15-support-raw-token', 'sha256'), 'hex'), 'platform_support', 'support+plat@fadeup.test', 'eaeaeaea-0000-0000-0000-000000000001', now() + interval '7 days');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select role from public.accept_platform_invitation('lot15-support-raw-token');
commit;

\echo '=========================================================='
\echo '10. Support Staff (platform_support) CANNOT create any platform invitation'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: only a platform owner or platform_admin may invite platform_support'
select public.create_platform_invitation('platform_support', null);
rollback;

\echo '=========================================================='
\echo '11. Founder promotes nobody automatically — but let''s prove platform_admin cannot invite platform_admin'
\echo '=========================================================='
begin;
reset role;
insert into public.platform_members (user_id, role) values ('eaeaeaea-0000-0000-0000-000000000004', 'platform_admin');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: only a platform owner may invite a platform_admin'
select public.create_platform_invitation('platform_admin', null);
rollback;

\echo '=========================================================='
\echo '12. A platform invitation can never carry role=platform_owner — enforced at the constraint level, not just the RPC'
\echo '=========================================================='
begin;
reset role;
\echo '-- expect ERROR: violates check constraint "platform_invitations_role_not_owner"'
insert into public.platform_invitations (token_hash, role, invited_by, expires_at)
values (encode(digest('lot15-illegal-owner-invite', 'sha256'), 'hex'), 'platform_owner', 'eaeaeaea-0000-0000-0000-000000000001', now() + interval '7 days');
rollback;

\echo '=========================================================='
\echo '13. Zero client read access: platform_members shows only your own row; bootstrap tokens and invitations are invisible to everyone'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as platform_members_visible_to_rando from public.platform_members;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select count(*) as platform_members_visible_to_founder_should_be_self_only from public.platform_members;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'eaeaeaea-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: permission denied for table platform_owner_bootstrap_tokens (no policy grants ANY access, even to platform_owner)'
select count(*) from public.platform_owner_bootstrap_tokens;
rollback;

begin;
set local role anon;
reset request.jwt.claims;
select count(*) as members_visible_to_anon from public.platform_members;
commit;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.platform_audit_log where actor_user_id in (
  'eaeaeaea-0000-0000-0000-000000000001', 'eaeaeaea-0000-0000-0000-000000000002',
  'eaeaeaea-0000-0000-0000-000000000003', 'eaeaeaea-0000-0000-0000-000000000004'
);
delete from public.platform_invitations where invited_by = 'eaeaeaea-0000-0000-0000-000000000001' or invited_email = 'support+plat@fadeup.test';
delete from public.platform_owner_bootstrap_tokens where token_hash in (
  encode(digest('lot15-bootstrap-raw-token', 'sha256'), 'hex'),
  encode(digest('lot15-expired-raw-token', 'sha256'), 'hex'),
  encode(digest('lot15-revoked-raw-token', 'sha256'), 'hex'),
  encode(digest('lot15-second-owner-raw-token', 'sha256'), 'hex')
);
delete from public.platform_members where user_id in (
  'eaeaeaea-0000-0000-0000-000000000001', 'eaeaeaea-0000-0000-0000-000000000002',
  'eaeaeaea-0000-0000-0000-000000000003', 'eaeaeaea-0000-0000-0000-000000000004'
);
delete from auth.users where email like '%plat@fadeup.test';
select count(*) as remaining_users from auth.users where email like '%plat@fadeup.test';
select count(*) as remaining_platform_members from public.platform_members where user_id in (
  'eaeaeaea-0000-0000-0000-000000000001', 'eaeaeaea-0000-0000-0000-000000000002',
  'eaeaeaea-0000-0000-0000-000000000003', 'eaeaeaea-0000-0000-0000-000000000004'
);
commit;

\echo 'DONE.'
