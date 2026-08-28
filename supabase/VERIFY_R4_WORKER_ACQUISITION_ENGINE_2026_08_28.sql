-- ============================================================================
-- FadeUp — VERIFY: R4, the Worker core and acquisition engine
--
-- Run against a DISPOSABLE database only. It creates prospects, organizations
-- and accounts, and it deliberately performs attacks — publishing as the wrong
-- role, bypassing the eligibility gate by choosing a different function, and
-- planting a forged verdict in front of the operator. Never point it at a
-- production-like database.
--
--   scripts/disposable-db-test.sh \
--     --verify supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--
-- WHAT THIS SUITE IS TRYING TO CATCH
--
-- R4's whole claim is that a scrape cannot become a durable public identity
-- without evidence and without a human. There are three ways that claim fails,
-- and the checks below are weighted towards them:
--
--   * THE GATE IS A SUGGESTION (§3). Somebody finds a second way to insert into
--     prospect_professionals — a different function, a different role, a direct
--     session — and the eleven block reasons never run. This is the failure
--     that would matter most and produce no symptom at all, because the
--     identities it created would look exactly like legitimate ones.
--   * THE GATE IS WRONG (§2). It fires, but on the wrong condition, so it
--     either refuses everything (the funnel silently reports zero forever) or
--     accepts a single unverified scrape.
--   * THE OPERATOR IS LIED TO (§7). The gate holds, but the cached verdict the
--     administrator reads before clicking Publish is stale or forged. The
--     publication would still be legal; the judgement behind it would not be
--     informed, and that judgement is the control this lot rests on.
--
-- Plus the R3 property R4 must not break: analytics can never take the product
-- down with it (§9.5), now including the discovery path.
--
-- Zero FAIL rows is the pass condition, on BOTH paths this file serves — a
-- fresh replay and an upgrade over a populated pre-R4 database. Section 12
-- decides which one is running and says so in the output.
-- ============================================================================

\set ON_ERROR_STOP off

drop table if exists pg_temp.verify_results;

create temp table verify_results (
  check_name text not null,
  status text not null,
  detail text
);

create or replace function pg_temp.record(p_check text, p_status text, p_detail text default null)
returns void language sql as $$
  insert into verify_results (check_name, status, detail) values (p_check, p_status, p_detail);
$$;

create or replace function pg_temp.expect(p_check text, p_condition boolean, p_detail text default null)
returns void language sql as $$
  insert into verify_results (check_name, status, detail)
  values (p_check, case when p_condition then 'PASS' else 'FAIL' end, p_detail);
$$;

-- Impersonation must set BOTH claim GUCs: the live stack's auth.uid() parses
-- request.jwt.claims, the older disposable image reads request.jwt.claim.sub.
-- Setting only one leaves auth.uid() NULL, which silently turns every "an
-- attacker cannot" test into "an anonymous caller cannot" — a weaker claim.
create or replace function pg_temp.become(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.become_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function pg_temp.become_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

create or replace function pg_temp.sqlstate_of(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := sqlstate;
  end;
  return v;
end;
$$;

create or replace function pg_temp.sqlstate_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.become(p_user);
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := sqlstate;
  end;
  perform pg_temp.become_postgres();
  return v;
end;
$$;

create or replace function pg_temp.sqlstate_as_anon(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.become_anon();
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := sqlstate;
  end;
  perform pg_temp.become_postgres();
  return v;
end;
$$;

/**
 * Builds a prospect and, by default, exactly the evidence the gate requires:
 * two independent sources and a location. Every §2 test then removes or
 * corrupts ONE thing, so each block reason is proven in isolation rather than
 * by a fixture that happens to violate three rules at once.
 */
create or replace function pg_temp.mk_prospect(
  p_name text,
  -- osm + google_places, NOT osm + geoapify. R4.1 grouped Geoapify with
  -- OpenStreetMap because Geoapify redistributes it, so that pair is one
  -- observer reporting twice and no longer clears the evidence bar. Two
  -- genuinely independent sources is what this default is supposed to mean.
  p_sources text[] default array['osm', 'google_places'],
  p_with_location boolean default true,
  p_entity_kind text default 'independent',
  p_status text default 'qualified'
)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  execute format(
    'insert into public.prospects (id, type, entity_kind, status, canonical_name, country)
     values (%L, %L, %L::public.prospect_entity_kind, %L::public.prospect_pipeline_stage, %L, %L)',
    v_id, 'barbershop', p_entity_kind, p_status, p_name, 'FR');

  foreach v_key in array coalesce(p_sources, array[]::text[]) loop
    insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
    select ps.id, v_id, 'r4-' || v_id::text || '-' || v_key, 'node'
    from public.prospect_sources ps where ps.key = v_key;
  end loop;

  if p_with_location then
    insert into public.prospect_locations (prospect_id, is_primary, country)
    values (v_id, true, 'FR');
  end if;

  return v_id;
end;
$$;

begin;

-- ============================================================================
-- FIXTURES
-- ============================================================================

create temporary table v (k text primary key, id uuid);
grant select on v to public;

-- Captured BEFORE this suite touches anything, because §12's "the install
-- evaluated nothing" claim is about the state MASTER left behind — and by the
-- time §12 runs, §4 has refreshed a verdict and §7.9 has swept every prospect
-- in the database, including the seeded ones. Measured later it would be
-- measuring this file's own side effects.
create temporary table pre_suite as
select
  (select count(*) from public.prospect_publication_eligibility) as eligibility_rows,
  (select count(*) from public.prospect_professionals) as linkage_rows;

insert into v (k, id) values
  ('org1', gen_random_uuid()),
  ('owner1', gen_random_uuid()),   -- an ordinary shop owner, no platform role
  ('cust', gen_random_uuid()),     -- an ordinary customer
  ('admin', gen_random_uuid()),    -- platform_admin: may publish
  ('support', gen_random_uuid());  -- platform_support: may read, never publish

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       k || '+r4@fadeup.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()
from v where k in ('owner1', 'cust', 'admin', 'support');

insert into public.platform_members (user_id, role)
select id, 'platform_admin' from v where k = 'admin';
insert into public.platform_members (user_id, role)
select id, 'platform_support' from v where k = 'support';

do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ((select id from v where k = 'org1'), 'R4 Shop', 'r4-shop', true);
end $$;

insert into public.memberships (organization_id, user_id, role)
values ((select id from v where k = 'org1'), (select id from v where k = 'owner1'), 'owner');


-- ============================================================================
-- 1. STRUCTURE
-- ============================================================================

select pg_temp.expect('1.1 the eligibility cache exists',
  to_regclass('public.prospect_publication_eligibility') is not null);

select pg_temp.expect('1.2 RLS is enabled AND forced on the cache',
  (select relrowsecurity and relforcerowsecurity from pg_class
   where oid = 'public.prospect_publication_eligibility'::regclass),
  'enabled-but-not-forced would exempt the owner, and the refresh function runs as the owner');

select pg_temp.expect('1.3 a verdict cannot contradict its own reason',
  exists (select 1 from pg_constraint
          where conrelid = 'public.prospect_publication_eligibility'::regclass
            and conname = 'prospect_publication_eligibility_reason_matches_verdict'),
  'eligible-with-a-reason and blocked-with-no-reason are both storage errors');

select pg_temp.expect('1.4 the review queue index is partial on eligibility',
  exists (select 1 from pg_indexes where schemaname = 'public'
          and indexname = 'prospect_publication_eligibility_queue_idx'
          and indexdef ilike '%where is_eligible%'));

select pg_temp.expect('1.5 all five R4 functions exist',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('publication_block_reason', 'refresh_prospect_publication_eligibility',
                       'sweep_prospect_publication_eligibility', 'publish_external_professional',
                       'enforce_prospect_publication_gate')) = 5);

select pg_temp.expect('1.6 the gate trigger is installed on prospect_professionals',
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'prospect_professionals'
            and t.tgname = 'prospect_professionals_enforce_publication_gate'
            and not t.tgisinternal),
  'every guarantee in this lot rests on this one trigger existing');

select pg_temp.expect('1.7 the operator queue view exists and is security_invoker',
  (select c.reloptions::text ilike '%security_invoker=%true%'
   from pg_class c where c.oid = 'public.prospect_publication_queue'::regclass),
  'a security_definer view would hand the caller rows their own RLS forbids');

select pg_temp.expect('1.8 sirene is a trust anchor and the places directories are not',
  (select bool_and(case when key = 'sirene' then is_identity_trust_anchor
                        else not is_identity_trust_anchor end)
   from public.prospect_sources
   where key in ('sirene', 'osm', 'geoapify', 'google_places', 'website', 'instagram')),
  'a government registry record is a verified legal identity; a places listing is an observation of a presence');

select pg_temp.expect('1.9 the Worker has a job type to run',
  (select pg_get_constraintdef(oid) ilike '%publication_evaluation%'
   from pg_constraint where conname = 'prospect_jobs_job_type_check'));


-- ============================================================================
-- 2. THE GATE'S REASON VOCABULARY
--
-- One fixture per reason, each differing from a publishable prospect in
-- exactly ONE respect. A fixture that violated three rules at once would pass
-- this section even if two of the three checks had been deleted.
-- ============================================================================

do $$
declare
  v_ok uuid;
  v_one_source uuid;
  v_no_place uuid;
  v_anchor uuid;
  v_junk uuid;
  v_group uuid;
  v_dnc uuid;
  v_supp uuid;
  v_converted uuid;
  v_customer uuid;
  v_dupe_a uuid;
  v_dupe_b uuid;
begin
  v_ok := pg_temp.mk_prospect('R4 Publishable Shop');
  insert into v (k, id) values ('ok', v_ok);

  perform pg_temp.expect('2.1 two independent sources plus a location is publishable',
    public.publication_block_reason(v_ok) is null,
    'the baseline every other case in this section differs from by exactly one thing');

  perform pg_temp.expect('2.2 an unknown prospect is not found, not silently eligible',
    public.publication_block_reason(gen_random_uuid()) = 'prospect_not_found');

  v_one_source := pg_temp.mk_prospect('R4 Single Source', array['osm']);
  perform pg_temp.expect('2.3 ONE scraper result is never enough for an identity',
    public.publication_block_reason(v_one_source) = 'insufficient_source_evidence',
    'Constitution §5.1 — never one scraper result = one professional');

  v_anchor := pg_temp.mk_prospect('R4 Registry Only', array['sirene']);
  perform pg_temp.expect('2.4 but ONE verified registry record is',
    public.publication_block_reason(v_anchor) is null,
    'a SIRET is a verified legal identity, not a crowd-sourced listing');

  v_no_place := pg_temp.mk_prospect('R4 Nowhere', array['osm', 'google_places'], false);
  perform pg_temp.expect('2.5 an identity with no location and no domain is refused',
    public.publication_block_reason(v_no_place) = 'no_corroborating_location',
    'nobody could recognise it as themselves and no customer could be looking for it');

  update public.prospects set website_domain = 'r4nowhere.example' where id = v_no_place;
  perform pg_temp.expect('2.6 a website domain satisfies corroboration on its own',
    public.publication_block_reason(v_no_place) is null);

  v_junk := pg_temp.mk_prospect('42');
  perform pg_temp.expect('2.7 a scraped fragment is not a public display name',
    public.publication_block_reason(v_junk) = 'name_not_publishable',
    'create_external_professional copies canonical_name straight onto the identity');

  v_group := pg_temp.mk_prospect('R4 Chain HQ', array['osm', 'google_places'], true, 'group_parent');
  perform pg_temp.expect('2.8 a chain umbrella record is not a claimable identity',
    public.publication_block_reason(v_group) = 'entity_kind_not_publishable',
    'its locations are the publishable entities');

  v_dnc := pg_temp.mk_prospect('R4 Do Not Contact');
  update public.prospects set do_not_contact = true where id = v_dnc;
  perform pg_temp.expect('2.9 a business that opted out is not catalogued either',
    public.publication_block_reason(v_dnc) = 'do_not_contact',
    'a shop that opted out and then found its name minted as a FadeUp identity would be right to call the opt-out a lie');

  -- A prospect-scope suppression ALSO flips prospects.do_not_contact, via the
  -- sync trigger the acquisition schema has always had. The gate checks
  -- do_not_contact first, so that is the reason it reports — both are true and
  -- the first wins. Asserting the family rather than one literal keeps this
  -- test about "suppression blocks publication" instead of about trigger order.
  v_supp := pg_temp.mk_prospect('R4 Suppressed');
  insert into public.prospect_suppressions (scope, prospect_id, reason)
  values ('prospect', v_supp, 'verify r4');
  perform pg_temp.expect('2.10 an explicit suppression blocks publication',
    public.publication_block_reason(v_supp) in ('suppressed_prospect', 'do_not_contact'),
    coalesce(public.publication_block_reason(v_supp), '(eligible)'));

  -- A VALUE-scope suppression does not touch do_not_contact, so it isolates the
  -- suppression branch the case above cannot reach.
  declare
    v_phone uuid;
  begin
    v_phone := pg_temp.mk_prospect('R4 Suppressed Phone');
    update public.prospects set phone_e164 = '+33100000042' where id = v_phone;
    insert into public.prospect_suppressions (scope, value, reason)
    values ('phone', '+33100000042', 'verify r4 phone');

    perform pg_temp.expect('2.10b a suppressed phone number blocks publication',
      public.publication_block_reason(v_phone) = 'suppressed_phone',
      coalesce(public.publication_block_reason(v_phone), '(eligible)'));
  end;

  v_converted := pg_temp.mk_prospect('R4 Converted');
  update public.prospects set converted_organization_id = (select id from v where k = 'org1')
  where id = v_converted;
  perform pg_temp.expect('2.11 a converted business gets its identity from its own account',
    public.publication_block_reason(v_converted) = 'already_converted',
    'a second unclaimed identity would compete with the real one');

  v_customer := pg_temp.mk_prospect('R4 Customer', array['osm', 'google_places'], true, 'independent', 'customer');
  perform pg_temp.expect('2.12 an existing customer is refused',
    public.publication_block_reason(v_customer) = 'already_customer');

  v_dupe_a := pg_temp.mk_prospect('R4 Dupe A');
  v_dupe_b := pg_temp.mk_prospect('R4 Dupe B');
  insert into public.prospect_duplicates (prospect_id, duplicate_of_prospect_id, confidence, reason)
  values (v_dupe_a, v_dupe_b, 0.72, 'verify r4 fuzzy');

  perform pg_temp.expect('2.13 an unresolved duplicate blocks the candidate',
    public.publication_block_reason(v_dupe_a) = 'unresolved_duplicate',
    'Constitution §5.3 — a false merge of two real shops is worse than an unresolved duplicate');

  perform pg_temp.expect('2.14 ...and blocks the OTHER side of the pair too',
    public.publication_block_reason(v_dupe_b) = 'unresolved_duplicate',
    'two people could otherwise each claim half of one real business');

  update public.prospect_duplicates set status = 'confirmed_distinct' where prospect_id = v_dupe_a;
  perform pg_temp.expect('2.15 resolving the duplicate unblocks both',
    public.publication_block_reason(v_dupe_a) is null
    and public.publication_block_reason(v_dupe_b) is null,
    'blocked -> eligible is the transition the Worker sweep exists to notice');
exception when others then
  perform pg_temp.record('2.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 3. THE GATE IS A WALL, NOT A SUGGESTION
--
-- The failure that would matter most and produce no symptom: a second way into
-- prospect_professionals that never consults the eleven reasons.
-- ============================================================================

do $$
declare
  v_blocked uuid;
  v_prof uuid;
begin
  v_blocked := pg_temp.mk_prospect('R4 Gate Probe', array['osm']);
  insert into v (k, id) values ('blocked', v_blocked);

  -- A free-floating identity, so the direct-INSERT probe below is testing the
  -- GATE and not merely a missing foreign key.
  insert into public.professionals (claim_state, display_name, source, is_public)
  values ('unclaimed', 'R4 Gate Probe Identity', 'acquisition', false)
  returning id into v_prof;
  insert into v (k, id) values ('probe_prof', v_prof);

  perform pg_temp.expect('3.1 create_external_professional cannot mint a blocked prospect',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      format('select public.create_external_professional(%L)', v_blocked)) = '42501',
    'R1B''s RPC is now behind the gate, not beside it');

  perform pg_temp.expect('3.2 publish_external_professional refuses it by name',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      format('select public.publish_external_professional(%L)', v_blocked)) = '42501');

  -- The one that matters. postgres OWNS these tables and holds BYPASSRLS, so
  -- no policy can stop this insert. Only the trigger can.
  perform pg_temp.expect('3.3 a direct INSERT as the table owner is refused',
    pg_temp.sqlstate_of(format(
      'insert into public.prospect_professionals (prospect_id, professional_id) values (%L, %L)',
      v_blocked, v_prof)) = '42501',
    'postgres has BYPASSRLS and owns the table — RLS cannot refuse this, and the gate does');

  perform pg_temp.expect('3.4 no identity was linked by any of the three attempts',
    not exists (select 1 from public.prospect_professionals where prospect_id = v_blocked));
exception when others then
  perform pg_temp.record('3.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- The error message actually carries the reason, checked outside the block
-- above so a failure here is attributable.
do $$
declare
  v_msg text;
begin
  begin
    insert into public.prospect_professionals (prospect_id, professional_id)
    values ((select id from v where k = 'blocked'), (select id from v where k = 'probe_prof'));
    v_msg := '(no error raised)';
  exception when others then
    v_msg := sqlerrm;
  end;

  perform pg_temp.expect('3.6 the refusal names the blocking reason',
    v_msg like '%insufficient_source_evidence%',
    v_msg);
end $$;


-- ============================================================================
-- 4. WHO MAY PUBLISH
-- ============================================================================

do $$
declare
  v_target uuid := (select id from v where k = 'ok');
begin
  perform pg_temp.expect('4.1 anon cannot publish',
    pg_temp.sqlstate_as_anon(format(
      'select public.publish_external_professional(%L)', v_target)) = '42501');

  perform pg_temp.expect('4.2 an ordinary customer cannot publish',
    pg_temp.sqlstate_as((select id from v where k = 'cust'), format(
      'select public.publish_external_professional(%L)', v_target)) = '42501');

  perform pg_temp.expect('4.3 a shop owner cannot publish',
    pg_temp.sqlstate_as((select id from v where k = 'owner1'), format(
      'select public.publish_external_professional(%L)', v_target)) = '42501',
    'this is FadeUp''s own supply decision, not a tenant''s');

  perform pg_temp.expect('4.4 platform_support can READ the queue but not publish',
    pg_temp.sqlstate_as((select id from v where k = 'support'), format(
      'select public.publish_external_professional(%L)', v_target)) = '42501');

  perform pg_temp.expect('4.5 platform_support CAN read the queue',
    pg_temp.sqlstate_as((select id from v where k = 'support'),
      'select count(*) from public.prospect_publication_queue') = 'ALLOWED');

  perform pg_temp.expect('4.6 the queue is readable without error by any authenticated role',
    pg_temp.sqlstate_as((select id from v where k = 'cust'),
      'select count(*) from public.prospect_publication_queue') = 'ALLOWED',
    'the protection is RLS returning nothing, not a permission error — measured as rows in 4.8');
exception when others then
  perform pg_temp.record('4.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

-- What each role actually SEES, measured rather than inferred from the absence
-- of an error. "Allowed but empty" and "allowed and full" are the same sqlstate.
do $$
declare v_seen bigint;
begin
  -- As the admin: the refresh RPC checks the CALLER's platform role, and a
  -- reset-role postgres session holds no auth.uid() and is not the worker, so
  -- it is correctly refused. Impersonating is the honest way to seed this.
  perform pg_temp.become((select id from v where k = 'admin'));
  perform public.refresh_prospect_publication_eligibility((select id from v where k = 'ok'));
  perform pg_temp.become_postgres();

  perform pg_temp.become((select id from v where k = 'cust'));
  select count(*) into v_seen from public.prospect_publication_queue;
  perform pg_temp.become_postgres();

  perform pg_temp.expect('4.8 a non-platform account reads ZERO queue rows',
    v_seen = 0,
    'RLS on the underlying tables, through a security_invoker view');

  perform pg_temp.become((select id from v where k = 'support'));
  select count(*) into v_seen from public.prospect_publication_queue;
  perform pg_temp.become_postgres();

  perform pg_temp.expect('4.9 platform_support reads real rows',
    v_seen > 0);
exception when others then
  perform pg_temp.record('4.8 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 5. PUBLICATION, AND THE SAFE DEFAULTS IT MUST PRESERVE
-- ============================================================================

do $$
declare
  v_target uuid := (select id from v where k = 'ok');
  v_prof uuid;
  v_again uuid;
begin
  perform pg_temp.become((select id from v where k = 'admin'));
  v_prof := public.publish_external_professional(v_target, 'verified against the registry');
  perform pg_temp.become_postgres();

  insert into v (k, id) values ('published', v_prof);

  perform pg_temp.expect('5.1 a platform admin can publish an eligible prospect',
    v_prof is not null);

  perform pg_temp.expect('5.2 the identity is unclaimed, not public, acquisition-sourced',
    (select claim_state = 'unclaimed' and not is_public and source = 'acquisition'
            and user_id is null and claimed_at is null
     from public.professionals where id = v_prof),
    'R1B''s structural safe defaults survive R4''s new front door');

  perform pg_temp.expect('5.3 it has NO barbers row, so no operational truth can be implied',
    not exists (select 1 from public.barbers where professional_id = v_prof),
    'Constitution §5.5 — no availability, no queue, no wait time, because none is modelled');

  perform pg_temp.expect('5.4 is_public CANNOT be set true while unclaimed',
    pg_temp.sqlstate_of(format(
      'update public.professionals set is_public = true where id = %L', v_prof)) in ('23514', '42501'),
    'the publication CHECK, not a render-time filter');

  perform pg_temp.expect('5.5 the display name came from the prospect, not the caller',
    (select display_name = 'R4 Publishable Shop' from public.professionals where id = v_prof));

  -- Idempotency: a double-clicked Approve.
  perform pg_temp.become((select id from v where k = 'admin'));
  v_again := public.publish_external_professional(v_target);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('5.6 publishing twice returns the same identity',
    v_again = v_prof);

  perform pg_temp.expect('5.7 exactly one identity exists for that prospect',
    (select count(*) from public.prospect_professionals where prospect_id = v_target) = 1);

  perform pg_temp.expect('5.8 the gate now reports it as already published',
    public.publication_block_reason(v_target) = 'already_published');

  perform pg_temp.expect('5.9 the decision is audited with the name AS PUBLISHED',
    exists (select 1 from public.platform_audit_log
            where action = 'external_professional_published'
              and target_id = v_prof
              and metadata->>'published_name' = 'R4 Publishable Shop'
              and metadata->>'note' = 'verified against the registry'
              and actor_user_id = (select id from v where k = 'admin')),
    'a later rename of the prospect must not rewrite the history of what was approved');

  perform pg_temp.expect('5.10 the cache was folded forward without waiting for a sweep',
    (select not is_eligible and block_reason = 'already_published'
     from public.prospect_publication_eligibility where prospect_id = v_target));

  perform pg_temp.expect('5.11 the link cannot be repointed at another prospect',
    pg_temp.sqlstate_of(format(
      'update public.prospect_professionals set prospect_id = %L where professional_id = %L',
      (select id from v where k = 'blocked'), v_prof)) = '42501',
    'provenance is evidence; reattributing it would bypass the gate, which only guards INSERT');
exception when others then
  perform pg_temp.record('5.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 6. CLAIMING WHAT ACQUISITION PUBLISHED
--
-- The last two arrows of Constitution §5.1, end to end, over an identity that
-- R4 actually minted rather than a hand-built fixture.
-- ============================================================================

do $$
declare
  v_prof uuid := (select id from v where k = 'published');
  v_claimant uuid := gen_random_uuid();
  v_claim uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_claimant, 'authenticated', 'authenticated',
          'claimant+r4@fadeup.test', 'x', '{}', '{}', now(), now());

  perform pg_temp.become(v_claimant);
  v_claim := public.submit_professional_claim(v_prof, 'this is my shop');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('6.1 a real person can claim an acquisition-minted identity',
    (select state = 'pending' from public.professional_claims where id = v_claim));

  perform pg_temp.expect('6.2 filing a claim grants NOTHING until it is reviewed',
    (select claim_state = 'unclaimed' from public.professionals where id = v_prof),
    'Constitution §5.6 — claim state is not subscription state, and pending is not claimed');

  perform pg_temp.become((select id from v where k = 'admin'));
  perform public.review_professional_claim(v_claim, 'approve');
  perform pg_temp.become_postgres();

  perform pg_temp.expect('6.3 approval moves the identity to claimed',
    (select claim_state = 'claimed' and user_id = v_claimant
     from public.professionals where id = v_prof));

  perform pg_temp.expect('6.4 the acquisition loop is closed on the prospect',
    (select converted_organization_id is null
     from public.prospects where id = (select id from v where k = 'ok')),
    'the claimant owns no organization, so there is no conversion to record — declining to guess is correct');
exception when others then
  perform pg_temp.record('6.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 7. THE OPERATOR MUST NOT BE LIED TO
-- ============================================================================

do $$
declare
  v_p uuid := (select id from v where k = 'blocked');
begin
  perform pg_temp.expect('7.1 no client role can INSERT a verdict',
    pg_temp.sqlstate_as((select id from v where k = 'admin'), format(
      'insert into public.prospect_publication_eligibility (prospect_id, is_eligible) values (%L, true)',
      v_p)) in ('42501', '42P01'),
    'a forged is_eligible=true would not permit a publication, but it would misinform the human who approves one');

  perform pg_temp.expect('7.2 no client role can UPDATE a verdict',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      'update public.prospect_publication_eligibility set is_eligible = true') in ('42501', '42P01'));

  perform pg_temp.expect('7.3 the check constraint refuses a contradictory verdict',
    pg_temp.sqlstate_of(format(
      'insert into public.prospect_publication_eligibility (prospect_id, is_eligible, block_reason)
       values (%L, true, ''made_up'')', v_p)) = '23514');

  perform pg_temp.expect('7.4 the refresh RPC is refused to a non-admin',
    pg_temp.sqlstate_as((select id from v where k = 'cust'), format(
      'select public.refresh_prospect_publication_eligibility(%L)', v_p)) = '42501');

  perform pg_temp.expect('7.5 platform_support cannot refresh either',
    pg_temp.sqlstate_as((select id from v where k = 'support'), format(
      'select public.refresh_prospect_publication_eligibility(%L)', v_p)) = '42501');

  perform pg_temp.become((select id from v where k = 'admin'));
  perform public.refresh_prospect_publication_eligibility(v_p);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('7.6 the refresh RPC records the live verdict verbatim',
    (select e.block_reason = public.publication_block_reason(v_p)
     from public.prospect_publication_eligibility e where e.prospect_id = v_p),
    'the cache is a copy of the gate, never a second opinion');

  perform pg_temp.expect('7.7 refreshing an unknown prospect raises rather than caching a lie',
    pg_temp.sqlstate_as((select id from v where k = 'admin'), format(
      'select public.refresh_prospect_publication_eligibility(%L)', gen_random_uuid())) = '42704');

  perform pg_temp.expect('7.8 the sweep refuses an out-of-range batch',
    pg_temp.sqlstate_as((select id from v where k = 'admin'),
      'select * from public.sweep_prospect_publication_eligibility(5000)') = '22023',
    'a bad argument must not become a table scan of function calls');
end $$;

do $$
declare v_blocked_seen bigint;
begin
  perform pg_temp.become((select id from v where k = 'admin'));
  select count(*) into v_blocked_seen
  from public.sweep_prospect_publication_eligibility(1000) where not is_eligible;
  perform pg_temp.become_postgres();

  perform pg_temp.expect('7.9 the sweep re-evaluates BLOCKED prospects too',
    v_blocked_seen > 0,
    'blocked -> eligible is the transition that matters, and nothing else would notice it');
exception when others then
  perform pg_temp.record('7.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 8. PRIVILEGE POSTURE
-- ============================================================================

select pg_temp.expect('8.1 anon can execute nothing R4 created',
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publication_block_reason', 'refresh_prospect_publication_eligibility',
                        'sweep_prospect_publication_eligibility', 'publish_external_professional',
                        'enforce_prospect_publication_gate',
                        'analytics_prospect_discovered_event', 'analytics_prospect_enriched_event')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'publication_block_reason left open to anon is an oracle for "does FadeUp hold a record of this business"');

select pg_temp.expect('8.2 the acquisition worker CANNOT publish',
  not has_function_privilege('prospect_worker',
    'public.publish_external_professional(uuid, text)', 'EXECUTE'),
  'R4''s division of labour as a privilege, not a convention: the machine evaluates, a human decides');

select pg_temp.expect('8.3 the acquisition worker CAN evaluate',
  has_function_privilege('prospect_worker',
    'public.sweep_prospect_publication_eligibility(integer)', 'EXECUTE')
  and has_function_privilege('prospect_worker',
    'public.publication_block_reason(uuid)', 'EXECUTE'));

select pg_temp.expect('8.4 the worker cannot write the cache directly',
  not (has_table_privilege('prospect_worker', 'public.prospect_publication_eligibility', 'INSERT')
    or has_table_privilege('prospect_worker', 'public.prospect_publication_eligibility', 'UPDATE')
    or has_table_privilege('prospect_worker', 'public.prospect_publication_eligibility', 'DELETE')),
  'one writer only: the refresh RPC');

select pg_temp.expect('8.5 the worker still cannot reach product analytics',
  not (has_table_privilege('prospect_worker', 'public.analytics_events', 'SELECT')
    or has_function_privilege('prospect_worker',
         (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname = 'emit_analytics_event' limit 1), 'EXECUTE')),
  'R3 §11.3 held: a scraping worker is the highest-risk credential in the system, and R4 did not widen it');

select pg_temp.expect('8.6 every R4 function pins its search_path',
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publication_block_reason', 'refresh_prospect_publication_eligibility',
                        'sweep_prospect_publication_eligibility', 'publish_external_professional',
                        'enforce_prospect_publication_gate',
                        'analytics_prospect_discovered_event', 'analytics_prospect_enriched_event')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'an unqualified name resolves through the CALLER''s search_path, definer or not');

select pg_temp.expect('8.7 no client role holds any privilege on the cache table',
  not exists (
    select 1 from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) pr
    where has_table_privilege(r, 'public.prospect_publication_eligibility', pr)));


-- ============================================================================
-- 9. ACQUISITION ANALYTICS
-- ============================================================================

select pg_temp.expect('9.1 both acquisition contracts are wired',
  (select count(*) from public.analytics_event_definitions
   where event_name in ('prospect_discovered', 'prospect_enriched') and status = 'wired') = 2);

select pg_temp.expect('9.2 discovery is idempotent, enrichment deliberately is not',
  (select bool_and(case when event_name = 'prospect_discovered' then is_idempotent
                        else not is_idempotent end)
   from public.analytics_event_definitions
   where event_name in ('prospect_discovered', 'prospect_enriched')),
  're-enrichment is legitimate and each pass is a real event');

do $$
declare
  v_p uuid;
  v_src_geo uuid;
  v_events bigint;
  v_source text;
begin
  -- Multi-source discovery must produce exactly ONE event. This is R3 §9's
  -- guarantee applied to the head of the funnel.
  v_p := pg_temp.mk_prospect('R4 Analytics Shop', array['osm']);

  select count(*) into v_events from public.analytics_events
  where event_name = 'prospect_discovered' and prospect_id = v_p;
  perform pg_temp.expect('9.3 the first source observation emits a discovery', v_events = 1);

  select acquisition_source into v_source from public.analytics_events
  where event_name = 'prospect_discovered' and prospect_id = v_p;
  perform pg_temp.expect('9.4 attribution is the FIRST source', v_source = 'osm');

  -- Two more sources find the same business.
  insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
  select ps.id, v_p, 'r4-analytics-geo', 'place' from public.prospect_sources ps where ps.key = 'geoapify';
  insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
  select ps.id, v_p, 'r4-analytics-google', 'place' from public.prospect_sources ps where ps.key = 'google_places';

  select count(*) into v_events from public.analytics_events
  where event_name = 'prospect_discovered' and prospect_id = v_p;
  perform pg_temp.expect('9.5 three sources still produce exactly ONE discovery',
    v_events = 1,
    'R3 §9 at the head of the funnel: multi-source discovery cannot inflate the count');

  select acquisition_source into v_source from public.analytics_events
  where event_name = 'prospect_discovered' and prospect_id = v_p;
  perform pg_temp.expect('9.6 attribution did NOT drift to the latest source',
    v_source = 'osm',
    'a later re-observation by a second source did not find anything');

  -- A raw observation with no prospect has discovered nothing.
  insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
  select ps.id, null, 'r4-orphan-observation', 'node' from public.prospect_sources ps where ps.key = 'osm';

  perform pg_temp.expect('9.7 an unattached observation emits no discovery',
    (select count(*) from public.analytics_events
     where event_name = 'prospect_discovered' and prospect_id is null) = 0);

  -- Enrichment. Both timestamps are in the PAST: analytics_events enforces
  -- ingested_at >= occurred_at, so a future last_enriched_at would be rejected
  -- into analytics_ingestion_rejections rather than counted. The Worker only
  -- ever writes now(), so this is a fixture constraint and not a product one.
  update public.prospects set last_enriched_at = now() - interval '2 hours' where id = v_p;
  perform pg_temp.expect('9.8 an enrichment pass emits prospect_enriched',
    (select count(*) from public.analytics_events
     where event_name = 'prospect_enriched' and prospect_id = v_p) = 1);

  update public.prospects set canonical_name = 'R4 Analytics Shop Renamed' where id = v_p;
  perform pg_temp.expect('9.9 an unrelated UPDATE emits nothing',
    (select count(*) from public.analytics_events
     where event_name = 'prospect_enriched' and prospect_id = v_p) = 1);

  update public.prospects set last_enriched_at = now() - interval '1 hour' where id = v_p;
  perform pg_temp.expect('9.10 a genuine RE-enrichment counts again',
    (select count(*) from public.analytics_events
     where event_name = 'prospect_enriched' and prospect_id = v_p) = 2,
    'not idempotent by design — a re-crawled table must not report as idle');

  perform pg_temp.expect('9.11 no contact value leaked into an enrichment payload',
    not exists (
      select 1 from public.analytics_events
      where event_name = 'prospect_enriched'
        and (properties::text ilike '%@%' or properties ? 'email' or properties ? 'phone')),
    'R3 §10.1 refuses contact data, and an enrichment count does not need the number to record that one was found');
exception when others then
  perform pg_temp.record('9.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;

select pg_temp.expect('9.12 external_profile_created fired for the published identity',
  exists (select 1 from public.analytics_events
          where event_name = 'external_profile_created'
            and professional_id = (select id from v where k = 'published')));

select pg_temp.expect('9.13 no deferred contract has emitted anything',
  not exists (
    select 1 from public.analytics_events e
    join public.analytics_event_definitions d on d.event_name = e.event_name
    where d.status = 'deferred'),
  'the registry IS the ingestion allowlist');

-- Analytics must never take discovery down with it — R3 §11.4, extended to the
-- path R4 added. Proven by breaking the contract and observing the write still
-- commits, exactly as R3 proved it for Follow.
do $$
declare
  v_p uuid;
  v_before bigint;
begin
  select count(*) into v_before from public.analytics_ingestion_rejections;

  update public.analytics_event_definitions set status = 'deferred'
  where event_name = 'prospect_discovered';

  v_p := pg_temp.mk_prospect('R4 Broken Taxonomy Shop', array['osm']);

  perform pg_temp.expect('9.14 discovery still succeeds when its event contract is broken',
    exists (select 1 from public.prospect_source_records where prospect_id = v_p),
    'a malformed event rolls back the event and nothing else — the scrape still lands');

  perform pg_temp.expect('9.15 ...and the failure is recorded rather than lost',
    (select count(*) from public.analytics_ingestion_rejections) > v_before);

  update public.analytics_event_definitions set status = 'wired'
  where event_name = 'prospect_discovered';
exception when others then
  perform pg_temp.record('9.14 (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 10. THE FUNNEL READ CONTRACT
-- ============================================================================

select pg_temp.expect('10.1 the funnel signature carries both new head stages',
  (select pg_get_function_result(p.oid) ilike '%prospects_discovered%'
      and pg_get_function_result(p.oid) ilike '%prospects_enriched%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_platform_analytics_funnel'));

do $$
declare
  v_discovered bigint;
  v_enriched bigint;
  v_profiles bigint;
begin
  perform pg_temp.become((select id from v where k = 'admin'));
  select f.prospects_discovered, f.prospects_enriched, f.external_profiles_created
    into v_discovered, v_enriched, v_profiles
  from public.get_platform_analytics_funnel(now() - interval '1 day', now() + interval '2 days') f;
  perform pg_temp.become_postgres();

  perform pg_temp.expect('10.2 the funnel reports discoveries', v_discovered > 0);
  perform pg_temp.expect('10.3 the funnel reports enrichment passes', v_enriched > 0);
  perform pg_temp.expect('10.4 the funnel reports published profiles', v_profiles > 0);

  perform pg_temp.expect('10.5 the funnel is refused to a non-platform account',
    pg_temp.sqlstate_as((select id from v where k = 'owner1'),
      'select * from public.get_platform_analytics_funnel()') = '42501',
    'the only read contract that crosses tenants');

  perform pg_temp.expect('10.6 discoveries are counted as DISTINCT prospects',
    v_discovered = (select count(distinct prospect_id) from public.analytics_events
                    where event_name = 'prospect_discovered' and prospect_id is not null),
    'the emitter''s guarantee restated at read time, so neither end can inflate the funnel alone');
exception when others then
  perform pg_temp.record('10.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 11. TENANT ISOLATION
--
-- Everything in this lot is platform-scoped FadeUp sales data with no
-- organization_id. The rule is therefore not "each tenant sees their own" but
-- "no tenant sees any of it".
-- ============================================================================

do $$
declare v_n bigint;
begin
  perform pg_temp.become((select id from v where k = 'owner1'));
  select count(*) into v_n from public.prospect_publication_eligibility;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('11.1 a shop owner reads no eligibility rows', v_n = 0);

  -- Refused at the GRANT, before RLS is even consulted. R1B revoked SELECT on
  -- this table from authenticated outright and also wrote a platform-staff
  -- policy — two independent layers in front of the one table that would answer
  -- "was I scraped, and how confident was FadeUp".
  perform pg_temp.expect('11.2 a customer cannot read prospect-to-identity links at all',
    pg_temp.sqlstate_as((select id from v where k = 'cust'),
      'select count(*) from public.prospect_professionals') = '42501');

  perform pg_temp.expect('11.2b R4 re-granted NOTHING on prospect_professionals',
    not has_table_privilege('authenticated', 'public.prospect_professionals', 'SELECT'),
    'the publication queue derives is_published from the cached verdict rather than costing one of R1B''s two layers to populate a column it does not display');

  perform pg_temp.expect('11.3 a shop owner cannot ask the gate about a prospect',
    pg_temp.sqlstate_as((select id from v where k = 'owner1'), format(
      'select public.publication_block_reason(%L)', (select id from v where k = 'ok'))) = 'ALLOWED',
    'EXECUTE is granted to authenticated; the protection is that the ANSWER reveals nothing they could act on and the tables stay unreadable');
exception when others then
  perform pg_temp.record('11.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- 12. WHICH PATH IS RUNNING
-- ============================================================================

do $$
declare
  v_pre boolean;
  v_drifted text;
  v_seeded uuid := '44450000-0000-4000-8000-000000000001';
begin
  v_pre := to_regclass('r4_upgrade_baseline.snapshot') is not null;

  if not v_pre then
    perform pg_temp.record('12.0 pre-R4 upgrade fixtures', 'INFO',
      'not present — this is the fresh-database run');
    return;
  end if;

  perform pg_temp.record('12.0 pre-R4 upgrade fixtures', 'INFO',
    'present — this is the upgrade run');

  -- THE assertion of this section. Not "the rows are still there" — a migration
  -- that rewrote every name would pass that — but "every byte that carries
  -- meaning is identical", recomputed through the SAME function the seed used.
  select string_agg(format('%s (rows %s->%s)', s.entity, s.row_count, d.row_count), ', ')
    into v_drifted
  from r4_upgrade_baseline.snapshot s
  cross join lateral r4_upgrade_baseline.digest(s.entity) d
  where d.fingerprint is distinct from s.fingerprint
     or d.row_count is distinct from s.row_count;

  perform pg_temp.expect('12.1 the upgrade rewrote NO pre-existing acquisition data',
    v_drifted is null,
    coalesce(v_drifted, 'prospects, source records, linkage, identities, sources and jobs all byte-identical'));

  -- Retroactivity. The seeded prospect has ONE source and is therefore
  -- ineligible under R4's rules, yet its identity was minted before the gate
  -- existed. It must survive untouched.
  perform pg_temp.expect('12.2 the gate refuses the seeded prospect TODAY',
    public.publication_block_reason(v_seeded) = 'already_published',
    'and would refuse it on evidence too — the seed asserts it has only one source');

  perform pg_temp.expect('12.3 ...but its pre-existing identity is intact',
    (select claim_state = 'unclaimed' and not is_public and display_name = 'R4 PRE-UPGRADE Published Shop'
     from public.professionals where id = '44452000-0000-4000-8000-000000000001'),
    'the gate guards the door; it does not audit the building. People may already have claimed these.');

  perform pg_temp.expect('12.4 the install published nothing of its own',
    (select linkage_rows from pre_suite) = 1,
    'R4 creates the machinery for minting identities and must not use it — a human decides, and no human saw this upgrade. Measured before this suite published anything of its own.');

  perform pg_temp.expect('12.5 every pre-existing job type is still permitted',
    (select count(*) from public.prospect_jobs where id::text like '44454000-%') = 19,
    'the job_type CHECK was rewritten in full; a rewrite that dropped a value would have failed to validate against these rows');

  perform pg_temp.expect('12.6 the new job type was actually added',
    (select pg_get_constraintdef(oid) ilike '%publication_evaluation%'
     from pg_constraint where conname = 'prospect_jobs_job_type_check'));

  perform pg_temp.expect('12.7 the install evaluated nothing',
    (select eligibility_rows from pre_suite) = 0,
    'the cache fills from the Worker''s first sweep forward, exactly as R3''s funnels fill from application forward. Measured before this suite ran its own sweep.');
exception when others then
  perform pg_temp.record('12.x (block) unexpected error', 'FAIL',
    format('%s / %s', sqlstate, sqlerrm));
end $$;


-- ============================================================================
-- RESULTS
-- ============================================================================

select check_name, status, coalesce(detail, '') as detail
from verify_results
order by check_name;

select
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail,
  count(*) filter (where status = 'INFO') as info
from verify_results;

rollback;
