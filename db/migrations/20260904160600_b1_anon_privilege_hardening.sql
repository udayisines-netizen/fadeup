-- FadeUp — B1: the grants under the tables this prompt touched.
--
-- FOUND BY THE RESTORE TEST, NOT BY READING THE SCHEMA.
--
-- The first b1_test database was restored with --no-owner --no-privileges, and
-- every grant assertion in verify_b1 passed trivially against a database that
-- had no grants at all. Restoring faithfully instead — same owners, same ACLs
-- as production — turned three of them red, and they were right to be red.
--
-- WHAT IS ACTUALLY GRANTED ON THE FOUR TABLES B1 TOUCHES
--
--   locations                  anon = arwdDxtm   authenticated = arwdDxtm
--   queue_entries              anon =  rdDxtm    authenticated =  rdDxtm
--   professionals              anon = (none)     authenticated = column grants
--   location_service_settings  anon = (none)     authenticated = r
--
-- V2_DATA_CONTRACT §4 states the opposite as the contract: "anon n'a aucun
-- SELECT ⇒ pas de Postgres Changes". The document describes the intent; the
-- ACLs describe the database. RLS is what has been holding the line — anon
-- reads zero rows because every policy on both tables names `authenticated`
-- and an unmatched policy denies — and measured here, an anon INSERT into
-- locations is correctly refused with "new row violates row-level security
-- policy". So nothing is leaking today.
--
-- TWO REASONS THAT IS NOT GOOD ENOUGH
--
-- 1. TRUNCATE IS NOT SUBJECT TO RLS. Measured, as anon, against production:
--
--      begin; set local role anon; truncate public.queue_entries;
--      TRUNCATE TABLE
--
--    Every live queue in the product, gone, with no policy consulted. It is
--    not reachable through PostgREST, which exposes no TRUNCATE verb, so this
--    is a latent privilege rather than an open door — but "the API happens not
--    to offer that verb" is not an authorization model.
--
-- 2. CHANTIER 5 ADDED A COLUMN TO A TABLE anon CAN SELECT. A table-level GRANT
--    covers columns added later, so locations.queue_check_in_token was granted
--    to anon and authenticated the instant it was created. RLS returns anon no
--    rows today, so the token does not leak today. It leaks the day anyone
--    adds a permissive anon policy to locations — and a QR token that a
--    customer never has to walk into the shop to obtain is not presence proof
--    at all. Chantier 5's guarantee rests on this grant not existing.
--
-- WHAT THIS FILE DOES, AND WHAT IT DELIBERATELY LEAVES ALONE
--
-- IN SCOPE: the four tables B1 touches. anon loses everything on locations and
-- queue_entries — it needs nothing, because every public read of either goes
-- through a SECURITY DEFINER RPC that runs as its owner. authenticated keeps
-- exactly the four verbs its RLS policies are written for, and loses TRUNCATE,
-- TRIGGER and REFERENCES, which no policy governs and no feature uses.
--
-- OUT OF SCOPE, AND REPORTED RATHER THAN FIXED: the same pattern is
-- database-wide. Measured on production:
--
--   anon           TRUNCATE / TRIGGER / REFERENCES on 54 tables
--   authenticated  TRUNCATE / TRIGGER / REFERENCES on 87 tables
--
-- Every one of those TRUNCATE grants bypasses RLS the same way. Sweeping all
-- 87 belongs in its own hardening lot with its own rollback and its own test
-- run, not smuggled into a prompt about public reads. It is written up in
-- BLOCKERS.md.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. anon holds nothing on these tables
--
-- REVOKE ALL, then nothing back. Public access to establishments and queues is
-- get_public_*/list_public_* and join_public_queue, all SECURITY DEFINER, all
-- owned by postgres, none of which consults the caller's table privileges.
-- ---------------------------------------------------------------------------

revoke all on table public.locations from anon;
revoke all on table public.queue_entries from anon;
revoke all on table public.professionals from anon;
revoke all on table public.location_service_settings from anon;

-- ---------------------------------------------------------------------------
-- 2. authenticated keeps what its policies are written for, and nothing else
--
-- locations has policies for SELECT, INSERT, UPDATE and DELETE naming
-- `authenticated`; queue_entries has the same four plus queue_entries_update_self.
-- Those verbs stay. TRUNCATE, TRIGGER and REFERENCES have no policy, no caller
-- and — in TRUNCATE's case — no RLS at all.
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references on table public.locations from authenticated;
revoke truncate, trigger, references on table public.queue_entries from authenticated;
revoke truncate, trigger, references on table public.professionals from authenticated;
revoke truncate, trigger, references on table public.location_service_settings from authenticated;

-- ---------------------------------------------------------------------------
-- 3. The QR token, explicitly
--
-- Belt and braces on top of the revoke above: a column-level revoke has no
-- effect against a table-level grant, so this is written AFTER the table-level
-- grants are gone, where it does. If a later lot re-grants SELECT on locations
-- to a client role, this line is the record of which column must not come with
-- it — and verify_b1 fails loudly if it ever does.
-- ---------------------------------------------------------------------------

revoke select (queue_check_in_token), update (queue_check_in_token), insert (queue_check_in_token)
  on table public.locations from anon, authenticated;

commit;
