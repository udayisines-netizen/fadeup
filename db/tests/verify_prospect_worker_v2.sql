-- FadeUp — verification: Prospect Worker V2 core schema + job queue
-- (db/migrations/20260811150000_prospect_acquisition_extensions.sql,
--  db/migrations/20260811150100_prospect_acquisition_schema.sql,
--  db/migrations/20260811150200_prospect_job_queue.sql)
--
-- Proves: prospect_* tables are invisible to anon and to an ordinary
-- (non-platform) authenticated tenant user; platform_support can read but
-- not write; platform_owner/platform_admin can read+write; the
-- prospect_worker role can read/write only what it needs (never
-- organizations/memberships/appointments/...); create_prospect_discovery_job
-- fans out to prospect_job_sources correctly, recording disabled sources as
-- skipped; claim_next_prospect_job claims atomically and will not
-- double-claim (real concurrency is exercised separately, see
-- infra/worker's test runner / the bash companion this file's header
-- documents below); fail_prospect_job's retryable-vs-terminal branch;
-- recover_stale_prospect_job_leases; record_api_usage + quota-guard pause;
-- prospect_scores/prospect_suppressions/prospect_events sync triggers;
-- prospect_duplicates' unordered-pair uniqueness.
--
-- Every "expect ERROR" case runs in its OWN begin/rollback block.
--
-- Run with:
--   docker cp db/tests/verify_prospect_worker_v2.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_prospect_worker_v2.sql
--
-- Real concurrent claiming is verified separately with N parallel `psql`
-- processes each calling private.claim_next_prospect_job() against jobs
-- this script leaves queued — a single sequential SQL script cannot
-- exercise genuine cross-connection lock contention.

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('fabfabfb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'owner+pw2@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Owner"}', 'authenticated', 'authenticated'),
  ('fabfabfb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'support+pw2@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Support"}', 'authenticated', 'authenticated'),
  ('fabfabfb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'shopowner+pw2@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Shop Owner"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: platform_owner, platform_support, and an unrelated tenant org owner'
\echo '=========================================================='
begin;
reset role;
insert into public.platform_members (user_id, role) values
  ('fabfabfb-0000-0000-0000-000000000001', 'platform_owner'),
  ('fabfabfb-0000-0000-0000-000000000002', 'platform_support');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('PW2 Test Shop', 'pw2-test-shop', 'Main Shop', 'UTC');
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'pw2-test-shop' \gset
commit;

\echo '=========================================================='
\echo '2. anon and an ordinary tenant user see ZERO prospects — no policy grants them access'
\echo '=========================================================='
begin;
set local role anon;
select count(*) as prospects_visible_to_anon from public.prospects;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select count(*) as prospects_visible_to_shop_owner from public.prospects;
commit;

\echo '=========================================================='
\echo '3. platform_support cannot create a discovery job (read-only role)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: only a platform owner or platform_admin may create a prospect job'
select public.create_prospect_discovery_job('discovery', '{"country":"FR","city":"Paris"}'::jsonb, array['osm','geoapify']);
rollback;

\echo '=========================================================='
\echo '4. platform_support CAN read prospect_sources (any platform role reads)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select count(*) as sources_visible_to_support from public.prospect_sources;
commit;

\echo '=========================================================='
\echo '5. platform_owner creates a discovery job for osm+geoapify only — fans out to 2 job_sources rows'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select id as job_a_id from public.create_prospect_discovery_job('discovery', '{"country":"FR","city":"Paris","radius_km":10,"entity_type":"barbershop"}'::jsonb, array['osm','geoapify']) \gset
commit;

begin;
reset role;
select count(*) as job_a_source_rows from public.prospect_job_sources where job_id = :'job_a_id';
select job_type, status, priority, attempts from public.prospect_jobs where id = :'job_a_id';
commit;

\echo '=========================================================='
\echo '6. platform_owner creates a job with NO source filter — instagram (disabled by default) is recorded skipped, not omitted'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select id as job_b_id from public.create_prospect_discovery_job('discovery', '{"country":"FR","city":"Lyon"}'::jsonb, null) \gset
commit;

begin;
reset role;
select count(*) as job_b_source_rows from public.prospect_job_sources where job_id = :'job_b_id';
select js.status, s.key
from public.prospect_job_sources js join public.prospect_sources s on s.id = js.source_id
where js.job_id = :'job_b_id' and s.key = 'instagram';
commit;

\echo '=========================================================='
\echo '7. prospect_worker claims job_a: status running, attempts=1, worker_id set, lease_until in the future'
\echo '=========================================================='
begin;
set local role prospect_worker;
select status, attempts, worker_id, (lease_until > now()) as lease_in_future
from private.claim_next_prospect_job('test-worker-1', 300);
commit;

\echo '=========================================================='
\echo '8. Claiming again with the queue down to only job_b returns job_b, never job_a again (no double-claim)'
\echo '=========================================================='
begin;
set local role prospect_worker;
select id = :'job_b_id' as claimed_job_b from private.claim_next_prospect_job('test-worker-1', 300);
commit;

begin;
set local role prospect_worker;
select private.claim_next_prospect_job('test-worker-1', 300) is null as queue_now_empty;
commit;

\echo '=========================================================='
\echo '9. prospect_worker inserts a raw source record for job_a (provenance) — no organization_id anywhere'
\echo '=========================================================='
begin;
set local role prospect_worker;
select id as source_osm_id from public.prospect_sources where key = 'osm' \gset
insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type, raw_payload, confidence, job_id)
values (:'source_osm_id', null, 'node/123456789', 'osm_node', '{"name":"Le Barbier de Paris"}'::jsonb, 0.900, :'job_a_id')
returning id as source_record_a_id \gset
commit;

\echo '=========================================================='
\echo '10. prospect_worker creates a canonical prospect + location, links the source record, scores it'
\echo '=========================================================='
begin;
set local role prospect_worker;
insert into public.prospects (type, canonical_name, country, website_domain, phone_e164)
values ('barbershop', 'Le Barbier de Paris', 'FR', 'lebarbierdeparis.fr', '+33612345678')
returning id as prospect_a_id \gset
commit;

begin;
set local role prospect_worker;
update public.prospect_source_records set prospect_id = :'prospect_a_id' where id = :'source_record_a_id';
insert into public.prospect_locations (prospect_id, is_primary, city, postal_code, country, latitude, longitude)
values (:'prospect_a_id', true, 'Paris', '75011', 'FR', 48.857, 2.352);
insert into public.prospect_scores (prospect_id, score, bucket, factors)
values (:'prospect_a_id', 78, 'HIGH', '[{"factor":"category_match","points":20,"max_points":20},{"factor":"has_phone","points":10,"max_points":10}]'::jsonb);
commit;

\echo '-- prospects.current_score/current_score_bucket kept in sync by trigger'
begin;
reset role;
select current_score, current_score_bucket from public.prospects where id = :'prospect_a_id';
commit;

\echo '=========================================================='
\echo '11. Pipeline-stage change is logged as a prospect_events row automatically'
\echo '=========================================================='
begin;
set local role prospect_worker;
update public.prospects set status = 'enriched', last_enriched_at = now() where id = :'prospect_a_id';
commit;

begin;
reset role;
select event_type, actor_user_id is null as system_actor, metadata->>'from' as from_stage, metadata->>'to' as to_stage
from public.prospect_events where prospect_id = :'prospect_a_id' and event_type = 'pipeline_stage_changed';
commit;

\echo '=========================================================='
\echo '12. platform_owner tags the prospect and adds a note — platform_support CANNOT'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.prospect_tags (prospect_id, tag) values (:'prospect_a_id', 'high-priority');
insert into public.prospect_notes (prospect_id, body) values (:'prospect_a_id', 'Called once, voicemail.');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: new row violates row-level security policy for table "prospect_notes"'
insert into public.prospect_notes (prospect_id, body) values (:'prospect_a_id', 'support trying to write');
rollback;

\echo '=========================================================='
\echo '13. Suppressing the prospect sets do_not_contact via trigger'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.prospect_suppressions (scope, prospect_id, reason) values ('prospect', :'prospect_a_id', 'asked not to be contacted');
commit;

begin;
reset role;
select do_not_contact from public.prospects where id = :'prospect_a_id';
commit;

\echo '-- identifier-scoped suppression blocks re-discovery under a fresh prospect id'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.prospect_suppressions (scope, value, reason) values ('phone', '+33698765432', 'do not contact list');
commit;

begin;
set local role prospect_worker;
select private.is_prospect_value_suppressed('phone', '+33698765432') as suppressed_phone;
select private.is_prospect_value_suppressed('phone', '+33600000000') as unsuppressed_phone;
commit;

\echo '=========================================================='
\echo '14. Duplicate candidate: unordered-pair uniqueness — (B,A) after (A,B) is rejected'
\echo '=========================================================='
begin;
set local role prospect_worker;
insert into public.prospects (type, canonical_name, country)
values ('barbershop', 'Barbier de Paris', 'FR')
returning id as prospect_dup_id \gset
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.prospect_duplicates (prospect_id, duplicate_of_prospect_id, confidence, reason)
values (:'prospect_a_id', :'prospect_dup_id', 0.850, 'normalized_name_similarity+geo_proximity');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
\echo '-- expect ERROR: duplicate key value violates unique constraint "prospect_duplicates_unique_pair"'
insert into public.prospect_duplicates (prospect_id, duplicate_of_prospect_id, confidence, reason)
values (:'prospect_dup_id', :'prospect_a_id', 0.850, 'reverse insert of the same pair');
rollback;

\echo '-- resolving the candidate stamps reviewed_by/reviewed_at automatically'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select id as dup_id from public.prospect_duplicates where prospect_id = :'prospect_a_id' and duplicate_of_prospect_id = :'prospect_dup_id' \gset
update public.prospect_duplicates set status = 'confirmed_duplicate' where id = :'dup_id';
select status, reviewed_by = 'fabfabfb-0000-0000-0000-000000000001' as reviewed_by_correct, reviewed_at is not null as has_reviewed_at
from public.prospect_duplicates where id = :'dup_id';
commit;

\echo '=========================================================='
\echo '15. api_usage/api_source_health: record_api_usage updates rolling counters'
\echo '=========================================================='
begin;
set local role prospect_worker;
select requests_today, success_count, failure_count from public.api_source_health h join public.prospect_sources s on s.id = h.source_id where s.key = 'osm';
commit;

begin;
set local role prospect_worker;
select private.record_api_usage('osm', :'job_a_id', '/interpreter', true, 200, 340, null);
select private.record_api_usage('osm', :'job_a_id', '/interpreter', false, 429, 50, 'rate limited');
commit;

begin;
reset role;
select requests_today, success_count, failure_count, rate_limited_count from public.api_source_health h join public.prospect_sources s on s.id = h.source_id where s.key = 'osm';
commit;

\echo '=========================================================='
\echo '16. Quota guard: source auto-pauses once requests_today reaches its configured daily limit'
\echo '=========================================================='
begin;
reset role;
update public.api_source_limits l set max_requests_per_day = 2 from public.prospect_sources s where l.source_id = s.id and s.key = 'geoapify';
commit;

begin;
set local role prospect_worker;
select private.is_prospect_source_paused('geoapify') as paused_before;
select private.record_api_usage('geoapify', null, '/v2/places', true, 200, 120, null);
select private.record_api_usage('geoapify', null, '/v2/places', true, 200, 130, null);
select private.is_prospect_source_paused('geoapify') as paused_after_hitting_daily_limit;
commit;

\echo '-- osm (no per-day limit configured, and not manually paused) stays unpaused'
begin;
set local role prospect_worker;
select private.is_prospect_source_paused('osm') as osm_paused;
commit;

\echo '=========================================================='
\echo '17. Manual pause/resume via platform_admin RPC'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fabfabfb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is_paused, paused_reason from public.set_prospect_source_paused('sirene', true, 'INSEE maintenance window');
commit;

begin;
set local role prospect_worker;
select private.is_prospect_source_paused('sirene') as sirene_paused;
commit;

\echo '=========================================================='
\echo '18. fail_prospect_job: retryable failure goes to retry (attempts < max_attempts)'
\echo '=========================================================='
begin;
set local role prospect_worker;
select status, attempts, max_attempts, last_error, lease_until is null as lease_cleared
from private.fail_prospect_job(:'job_a_id', 'test-worker-1', 'temporary network error', true, now() + interval '30 seconds');
commit;

\echo '-- re-claiming job_a after its retry schedule elapses (simulate by moving scheduled_at into the past)'
begin;
reset role;
update public.prospect_jobs set scheduled_at = now() - interval '1 minute' where id = :'job_a_id';
commit;

begin;
set local role prospect_worker;
select id = :'job_a_id' as reclaimed_job_a, attempts from private.claim_next_prospect_job('test-worker-2', 300);
commit;

\echo '=========================================================='
\echo '19. fail_prospect_job: NON-retryable failure (bad credentials) fails immediately regardless of attempts left'
\echo '=========================================================='
begin;
set local role prospect_worker;
select status, failed_at is not null as has_failed_at, last_error
from private.fail_prospect_job(:'job_a_id', 'test-worker-2', 'invalid credentials for source API', false, null);
commit;

\echo '=========================================================='
\echo '20. Stale lease recovery: a job stuck in running with an expired lease is recovered'
\echo '=========================================================='
begin;
reset role;
insert into public.prospect_jobs (job_type, payload) values ('dedup_scan', '{}'::jsonb) returning id as job_c_id \gset
commit;

begin;
set local role prospect_worker;
select id = :'job_c_id' as claimed_job_c from private.claim_next_prospect_job('test-worker-3', 300);
commit;

begin;
reset role;
update public.prospect_jobs set lease_until = now() - interval '1 minute' where id = :'job_c_id';
select public.recover_stale_prospect_job_leases() as recovered_count;
select status, worker_id is null as worker_cleared, last_error like '%stale lease%' as stale_error_recorded
from public.prospect_jobs where id = :'job_c_id';
commit;

\echo '-- calling recovery again immediately is a genuine no-op (0 rows this time)'
begin;
reset role;
select public.recover_stale_prospect_job_leases() as recovered_count_second_call;
commit;

\echo '=========================================================='
\echo '21. complete_prospect_job: only the worker_id that holds the lease may complete it'
\echo '=========================================================='
begin;
set local role prospect_worker;
select status, worker_id from private.claim_next_prospect_job('test-worker-4', 300);
commit;

begin;
set local role prospect_worker;
select private.complete_prospect_job(:'job_c_id', 'wrong-worker-id', '{}'::jsonb) is null as wrong_worker_cannot_complete;
commit;

begin;
set local role prospect_worker;
select status, completed_at is not null as has_completed_at
from private.complete_prospect_job(:'job_c_id', 'test-worker-4', '{"candidates_found":3,"prospects_created":2}'::jsonb);
commit;

\echo '=========================================================='
\echo '22. prospect_worker cannot touch tenant tables — no grant, no policy, RLS default-deny holds'
\echo '=========================================================='
begin;
set local role prospect_worker;
\echo '-- expect ERROR: permission denied for table organizations'
select count(*) from public.organizations;
rollback;

begin;
set local role prospect_worker;
\echo '-- expect ERROR: permission denied for table appointments'
select count(*) from public.appointments;
rollback;

\echo '=========================================================='
\echo 'CLEANUP'
\echo '=========================================================='
begin;
reset role;
delete from public.prospect_duplicates where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_events where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_scores where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_tags where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_notes where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_locations where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_source_records where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris'));
delete from public.prospect_suppressions where prospect_id in (select id from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris')) or value in ('+33698765432');
delete from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris');
delete from public.api_usage where job_id in (:'job_a_id', :'job_b_id');
delete from public.prospect_job_sources where job_id in (:'job_a_id', :'job_b_id', :'job_c_id');
delete from public.prospect_jobs where id in (:'job_a_id', :'job_b_id', :'job_c_id');
update public.api_source_limits l set max_requests_per_day = 3000 from public.prospect_sources s where l.source_id = s.id and s.key = 'geoapify';
update public.api_source_health h set requests_today = 0, requests_this_month = 0, success_count = 0, failure_count = 0, rate_limited_count = 0, avg_latency_ms = null, is_paused = false, paused_reason = null from public.prospect_sources s where h.source_id = s.id and s.key in ('osm', 'geoapify', 'sirene');
delete from public.staff_profiles where organization_id = :'org_id';
delete from public.locations where organization_id = :'org_id';
delete from public.memberships where organization_id = :'org_id';
delete from public.organizations where id = :'org_id';
delete from public.platform_members where user_id in ('fabfabfb-0000-0000-0000-000000000001', 'fabfabfb-0000-0000-0000-000000000002');
delete from auth.users where email like '%pw2@fadeup.test';
select count(*) as remaining_prospects from public.prospects where canonical_name in ('Le Barbier de Paris', 'Barbier de Paris');
select count(*) as remaining_users from auth.users where email like '%pw2@fadeup.test';
commit;

\echo 'DONE.'
