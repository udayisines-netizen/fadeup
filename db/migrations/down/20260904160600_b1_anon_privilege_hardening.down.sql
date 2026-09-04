-- FadeUp — B1 privilege hardening, rollback.
--
-- Restores the exact ACLs production carried before B1:
--
--   locations      anon = arwdDxtm   authenticated = arwdDxtm
--   queue_entries  anon =  rdDxtm    authenticated =  rdDxtm
--   professionals            anon = (none)  authenticated = (column grants only)
--   location_service_settings anon = (none) authenticated = r
--
-- BE CLEAR ABOUT WHAT THIS RESTORES: `anon` regains TRUNCATE on
-- public.queue_entries, which is not subject to row-level security. It also
-- regains table-level SELECT on public.locations, which covers
-- queue_check_in_token — the QR token chantier 5 relies on nobody being able
-- to read without visiting the shop. Run this only to unblock a genuine
-- regression traced to these revokes, and put it back afterwards.
--
-- The column grants on professionals are untouched by the migration and are
-- untouched here: REVOKE ALL on a table does not remove column-level grants,
-- and the migration's revoke on professionals therefore removed nothing that
-- existed. It is left in place as an assertion.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- MAINTAIN is in every one of these lists because PostgreSQL 17 added it and
-- production's ACLs carry it (the trailing `m` in arwdDxtm). Omitting it makes
-- the rollback LOOK complete while leaving the ACL one privilege short of what
-- was there — a difference a diff of relacl catches and a human does not.
grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.locations to anon, authenticated;

grant select, delete, truncate, references, trigger, maintain
  on table public.queue_entries to anon, authenticated;

-- professionals gets NOTHING back at table level. Production's ACL is
-- `postgres` and `service_role` only; `authenticated` reaches it exclusively
-- through COLUMN grants, which REVOKE ALL on the table never removed. Granting
-- table-level privileges here would leave the database MORE permissive than it
-- was before B1, which is not a rollback.
--
-- location_service_settings gets back exactly SELECT, which is its whole
-- production ACL for `authenticated` (`r`) — it is a realtime-published table
-- and the subscription needs the read.
grant select on table public.location_service_settings to authenticated;

commit;
