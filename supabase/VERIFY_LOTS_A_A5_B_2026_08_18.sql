-- ============================================================================
-- FadeUp — VERIFY: LOT A (org-creation hardening)
--                  LOT A.5 (universal identity + access resolution)
--                  LOT B (bookable professional onboarding)
--
-- Companion to MASTER_LOTS_A_A5_B_2026_08_18.sql.
--
-- Emits one row per check:  check_name | status  where status is
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected result: 0 FAIL rows.
--
-- Deliberately BEHAVIOURAL wherever behaviour is what matters. Asserting
-- that a policy row is absent proves very little; SET ROLE and genuinely
-- attempting the write proves the thing we actually care about. Structural
-- checks are included too, but they are the cheap half.
--
-- WHAT THIS FILE CANNOT PROVE, AND DOES NOT PRETEND TO
--   Google and Apple sign-in are network round trips to external identity
--   providers. No SQL can execute them. What SQL CAN prove — and what the
--   A.5 section below does prove — is the security property that actually
--   matters: that arriving with ANY provider identity, including one whose
--   metadata claims platform_admin, grants exactly nothing until
--   platform_members / memberships say otherwise. Those checks are real
--   PASSes. There is no fake "Google works" PASS anywhere in this file.
--
-- Safe to run repeatedly: every fixture is created inside a transaction
-- that is rolled back at the end, so this script leaves no rows behind.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql
-- ============================================================================

\pset pager off
\pset tuples_only off
\set ON_ERROR_STOP off

drop table if exists verify_results;

create temporary table verify_results (
  seq serial primary key,
  check_name text not null,
  status text not null check (status in ('PASS', 'FAIL', 'INFO')),
  detail text
);

-- SECURITY DEFINER so recording still works after SET ROLE anon /
-- authenticated below. Writes only to this session's temp table.
create or replace function pg_temp.record(p_check text, p_status text, p_detail text default null)
returns void language sql security definer as $$
  insert into verify_results (check_name, status, detail) values (p_check, p_status, p_detail);
$$;

create or replace function pg_temp.expect(p_check text, p_condition boolean, p_detail text default null)
returns void language sql security definer as $$
  insert into verify_results (check_name, status, detail)
  values (p_check, case when p_condition then 'PASS' else 'FAIL' end, p_detail);
$$;

-- Deliberately SECURITY INVOKER, unlike the recorders above: PostgreSQL
-- refuses `SET ROLE` inside a security-definer function ("cannot set
-- parameter role within security-definer function"), and these need no
-- elevation anyway — every caller may already assume `authenticated` and
-- may always RESET back to its own session role.
/**
 * Becomes the given user for subsequent statements in this transaction.
 *
 * Sets BOTH claim GUCs on purpose. The live stack's auth.uid() (installed by
 * the GoTrue migrations) parses request.jwt.claims as JSON; the base
 * supabase/postgres image the disposable harness runs still ships the older
 * auth.uid() reading the flat request.jwt.claim.sub. Setting both makes this
 * file produce identical results in both places, which is the whole point of
 * being able to dry-run it before touching production.
 */
create or replace function pg_temp.become(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute 'set local role authenticated';
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

begin;

-- ============================================================================
-- FIXTURES
-- ============================================================================

create temporary table verify_ids (k text primary key, v uuid);
-- Readable after SET ROLE authenticated / anon below. It holds nothing but
-- this run's fixture UUIDs.
grant select on verify_ids to public;

insert into verify_ids (k, v) values
  ('customer',        '0a000000-0000-4000-8000-000000000001'),
  ('pending',         '0a000000-0000-4000-8000-000000000002'),
  ('rejected',        '0a000000-0000-4000-8000-000000000003'),
  ('approved',        '0a000000-0000-4000-8000-000000000004'),
  ('platform_owner',  '0a000000-0000-4000-8000-000000000005'),
  ('oauth_google',    '0a000000-0000-4000-8000-000000000006'),
  ('oauth_apple',     '0a000000-0000-4000-8000-000000000007'),
  ('solo_owner',      '0a000000-0000-4000-8000-000000000008'),
  ('outsider',        '0a000000-0000-4000-8000-000000000009');

-- Column set deliberately limited to what BOTH a GoTrue-migrated auth.users
-- (the live stack) and the base supabase/postgres image's original auth.users
-- (the disposable harness) carry. email_confirmed_at exists only on the
-- former, and nothing here depends on it — every check below is about
-- authorization, not confirmation state.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000', v.v, 'authenticated', 'authenticated',
  v.k || '+verifyABB@fadeup.test', 'x',
  case v.k
    -- A hostile provider payload: this account arrives claiming, in both
    -- app and user metadata, to be FadeUp platform staff. Section A.5
    -- proves the claim buys it nothing.
    when 'oauth_google' then '{"provider":"google","providers":["google"],"role":"platform_admin"}'::jsonb
    when 'oauth_apple'  then '{"provider":"apple","providers":["apple"]}'::jsonb
    else '{"provider":"email","providers":["email"]}'::jsonb
  end,
  case v.k
    when 'oauth_google' then '{"full_name":"Gina Google","picture":"https://example.test/g.png","role":"platform_admin","platform_role":"platform_owner","is_admin":true}'::jsonb
    -- Sign in with Apple at its least generous: no name, no picture, a
    -- private-relay address. A completely normal, successful sign-in.
    when 'oauth_apple'  then '{}'::jsonb
    else jsonb_build_object('full_name', initcap(v.k))
  end,
  now(), now()
from verify_ids v;

insert into public.platform_members (user_id, role)
select v, 'platform_owner' from verify_ids where k = 'platform_owner';

-- ============================================================================
-- SECTION A — LOT A: organization-creation authorization (SEC-01)
-- ============================================================================

-- A. Structure -----------------------------------------------------------
select pg_temp.expect(
  'A.grant: authenticated holds NO INSERT on organizations',
  not has_table_privilege('authenticated', 'public.organizations', 'INSERT'));

select pg_temp.expect(
  'A.grant: anon holds NO INSERT on organizations',
  not has_table_privilege('anon', 'public.organizations', 'INSERT'));

select pg_temp.expect(
  'A.policy: no INSERT policy exists on organizations',
  not exists (select 1 from pg_policy where polrelid = 'public.organizations'::regclass and polcmd = 'a'));

select pg_temp.expect(
  'A.trigger: creation guard is installed and enabled',
  exists (select 1 from pg_trigger
          where tgrelid = 'public.organizations'::regclass
            and tgname = 'organizations_assert_creation_authorized'
            and tgenabled = 'O'));

select pg_temp.expect(
  'A.regression: organizations SELECT/UPDATE/DELETE policies untouched',
  (select count(*) from pg_policy where polrelid = 'public.organizations'::regclass) = 3,
  'expect exactly organizations_select, _update, _delete');

-- A. Applications used by the behavioural checks --------------------------
select pg_temp.become(v) from verify_ids where k = 'pending';
select public.submit_professional_application('Pen','Ding','+33612000001','Pending Shop ABB','barbershop');
select pg_temp.become(v) from verify_ids where k = 'rejected';
select public.submit_professional_application('Re','Jected','+33612000002','Rejected Shop ABB','barbershop');
select pg_temp.become(v) from verify_ids where k = 'approved';
select public.submit_professional_application(
  'App','Roved','+33612000003','Approved Salon ABB','barbershop',
  p_city := 'Lyon', p_address_line1 := '12 rue de la Ré', p_postal_code := '69001', p_country := 'FR');
select pg_temp.become_postgres();

select pg_temp.become(v) from verify_ids where k = 'platform_owner';
select public.review_professional_application(
  (select a.id from public.professional_applications a
    join verify_ids v on v.v = a.user_id and v.k = 'rejected'),
  'reject', 'Not eligible right now');
select pg_temp.become_postgres();

-- A. Behaviour: direct INSERT is denied for every client identity ----------
do $$
declare
  v_denied boolean;
  v_uid uuid;
begin
  for v_uid in select v from verify_ids where k in ('customer','pending','rejected','approved') loop
    v_denied := false;
    begin
      perform pg_temp.become(v_uid);
      insert into public.organizations (name, slug) values ('Bypass ABB', 'bypass-abb-' || left(v_uid::text, 8));
    exception when others then
      v_denied := true;
    end;
    perform pg_temp.become_postgres();
    perform pg_temp.expect(
      'A.bypass: direct organizations INSERT denied for ' ||
        (select k from verify_ids where v = v_uid),
      v_denied);
  end loop;
end $$;

select pg_temp.expect(
  'A.bypass: no organization row survived a denied INSERT',
  not exists (select 1 from public.organizations where slug like 'bypass-abb-%'));

select pg_temp.expect(
  'A.bypass: no owner membership was created by a denied INSERT',
  not exists (
    select 1 from public.memberships m
    join verify_ids v on v.v = m.user_id
    where v.k in ('customer','pending','rejected')));

-- A. Behaviour: the application gate still refuses via the RPC -------------
do $$
declare v_denied boolean; v_uid uuid; v_k text;
begin
  for v_k, v_uid in select k, v from verify_ids where k in ('pending','rejected') loop
    v_denied := false;
    begin
      perform pg_temp.become(v_uid);
      perform public.create_organization('Self Activate ABB', 'self-activate-abb-' || v_k);
    exception when others then
      v_denied := true;
    end;
    perform pg_temp.become_postgres();
    perform pg_temp.expect('A.gate: create_organization refuses ' || v_k || ' applicant', v_denied);
  end loop;
end $$;

-- A. Behaviour: the legitimate self-serve path still works -----------------
do $$
-- complete_organization_onboarding returns (organization_id, organization_name,
-- organization_slug, location_id, location_name) — a record, not an
-- organizations row.
declare v_row record;
begin
  perform pg_temp.become((select v from verify_ids where k = 'solo_owner'));
  select * into v_row from public.complete_organization_onboarding(
    'Solo Studio ABB', 'solo-studio-abb', 'Studio', 'Europe/Paris');
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A.legit: no-application user can still create an organization',
    v_row.organization_id is not null);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A.legit: no-application user can still create an organization', false, sqlerrm);
end $$;

select pg_temp.expect(
  'A.legit: self-serve creator became owner',
  exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join verify_ids v on v.v = m.user_id
    where o.slug = 'solo-studio-abb' and v.k = 'solo_owner' and m.role = 'owner'));

-- A. Behaviour: platform approval still works ------------------------------
do $$
declare v_app public.professional_applications;
begin
  perform pg_temp.become((select v from verify_ids where k = 'platform_owner'));
  select * into v_app from public.review_professional_application(
    (select a.id from public.professional_applications a
      join verify_ids v on v.v = a.user_id and v.k = 'approved'),
    'approve');
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A.legit: platform approval creates the organization',
    v_app.organization_id is not null, v_app.status::text);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A.legit: platform approval creates the organization', false, sqlerrm);
end $$;

select pg_temp.expect(
  'A.legit: the APPLICANT owns the approved organization',
  exists (
    select 1 from public.memberships m
    join public.professional_applications a on a.organization_id = m.organization_id
    join verify_ids v on v.v = m.user_id
    where v.k = 'approved' and a.user_id = m.user_id and m.role = 'owner'));

select pg_temp.expect(
  'A.legit: the REVIEWER did not become owner of anything',
  not exists (
    select 1 from public.memberships m
    join verify_ids v on v.v = m.user_id
    where v.k = 'platform_owner'));

-- A. Regression: tenant isolation is unchanged -----------------------------
select pg_temp.become(v) from verify_ids where k = 'outsider';
do $$
declare v_visible integer;
begin
  select count(*) into v_visible from public.organizations
    where slug in ('solo-studio-abb', 'approved-salon-abb');
  perform pg_temp.expect('A.isolation: a non-member sees zero of those organizations', v_visible = 0,
    v_visible || ' visible');
end $$;
select pg_temp.become_postgres();

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from verify_ids where k = 'outsider'));
    update public.organizations set name = 'Hijacked' where slug = 'solo-studio-abb';
    if not found then v_denied := true; end if;
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A.isolation: a non-member cannot rename another org', v_denied);
end $$;

-- ============================================================================
-- SECTION A.5 — universal identity: provider authenticates, database authorizes
-- ============================================================================

select pg_temp.expect(
  'A5.structure: get_my_access exists and takes no arguments',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'get_my_access' and p.pronargs = 0),
  'a resolver that accepted a user id could be asked about someone else');

select pg_temp.expect(
  'A5.structure: get_my_access is SECURITY DEFINER with a pinned search_path',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'get_my_access'
            and p.prosecdef
            and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));

select pg_temp.expect(
  'A5.grant: anon cannot execute get_my_access',
  not has_function_privilege('anon', 'public.get_my_access()', 'EXECUTE'));

select pg_temp.expect(
  'A5.grant: authenticated CAN execute get_my_access',
  has_function_privilege('authenticated', 'public.get_my_access()', 'EXECUTE'));

-- The load-bearing invariant behind "Google login is not Platform Admin".
select pg_temp.expect(
  'A5.platform: authenticated holds NO INSERT on platform_members',
  not has_table_privilege('authenticated', 'public.platform_members', 'INSERT'));
select pg_temp.expect(
  'A5.platform: authenticated holds NO UPDATE on platform_members',
  not has_table_privilege('authenticated', 'public.platform_members', 'UPDATE'));
select pg_temp.expect(
  'A5.platform: authenticated holds NO DELETE on platform_members',
  not has_table_privilege('authenticated', 'public.platform_members', 'DELETE'));
select pg_temp.expect(
  'A5.platform: anon holds NO INSERT on platform_members',
  not has_table_privilege('anon', 'public.platform_members', 'INSERT'));

-- No authorization decision anywhere reads provider metadata.
do $$
declare v_hits integer;
begin
  select count(*) into v_hits
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.proname in ('is_platform_admin','is_platform_owner','has_platform_role',
                      'is_org_member','has_org_role','is_own_barber')
    and (p.prosrc like '%raw_user_meta_data%' or p.prosrc like '%raw_app_meta_data%'
         or p.prosrc like '%app_metadata%' or p.prosrc like '%user_metadata%');
  perform pg_temp.expect(
    'A5.metadata: no authorization helper reads provider metadata', v_hits = 0,
    v_hits || ' helper(s) referenced metadata');
end $$;

-- Behaviour: the hostile Google identity.
do $$
declare r record;
begin
  perform pg_temp.become((select v from verify_ids where k = 'oauth_google'));
  select * into r from public.get_my_access();
  perform pg_temp.become_postgres();

  perform pg_temp.expect('A5.google: metadata claiming platform_admin yields NO platform role',
    r.platform_role is null and r.platform_available is false);
  perform pg_temp.expect('A5.google: metadata claiming platform_admin yields NO professional access',
    r.professional_available is false and r.organization_count = 0);
  perform pg_temp.expect('A5.google: the customer experience is available to it',
    r.customer_available is true);
  perform pg_temp.expect('A5.google: resolver reports the caller''s own id',
    r.user_id = (select v from verify_ids where k = 'oauth_google'));
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from verify_ids where k = 'oauth_google'));
    insert into public.platform_members (user_id, role)
      values ((select v from verify_ids where k = 'oauth_google'), 'platform_owner');
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A5.google: a Google identity cannot insert itself into platform_members', v_denied);
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    perform pg_temp.become((select v from verify_ids where k = 'oauth_apple'));
    insert into public.platform_members (user_id, role)
      values ((select v from verify_ids where k = 'oauth_apple'), 'platform_admin');
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A5.apple: an Apple identity cannot insert itself into platform_members', v_denied);
end $$;

select pg_temp.expect(
  'A5.platform: platform_members gained no rows from either OAuth identity',
  not exists (
    select 1 from public.platform_members pm
    join verify_ids v on v.v = pm.user_id
    where v.k in ('oauth_google','oauth_apple')));

-- Behaviour: Apple at its least generous — no name, no avatar, no metadata.
select pg_temp.expect(
  'A5.apple: a nameless Apple sign-in still produced a profile row',
  exists (select 1 from public.profiles p join verify_ids v on v.v = p.id where v.k = 'oauth_apple'),
  'missing name is not an authentication failure');

select pg_temp.expect(
  'A5.apple: the nameless profile stores NULL, never an empty string',
  (select p.full_name is null from public.profiles p
     join verify_ids v on v.v = p.id where v.k = 'oauth_apple'));

select pg_temp.expect(
  'A5.google: Google''s "picture" claim populated avatar_url',
  (select p.avatar_url = 'https://example.test/g.png' from public.profiles p
     join verify_ids v on v.v = p.id where v.k = 'oauth_google'));

-- Behaviour: a genuine platform member still resolves as one.
do $$
declare r record;
begin
  perform pg_temp.become((select v from verify_ids where k = 'platform_owner'));
  select * into r from public.get_my_access();
  perform pg_temp.become_postgres();
  perform pg_temp.expect('A5.platform: a real platform_members row DOES yield platform access',
    r.platform_available is true and r.platform_role = 'platform_owner');
end $$;

-- Behaviour: one identity, several roles at once, none displacing another.
insert into public.platform_members (user_id, role)
select v, 'platform_admin' from verify_ids where k = 'approved';

do $$
declare r record;
begin
  perform pg_temp.become((select v from verify_ids where k = 'approved'));
  select * into r from public.get_my_access();
  perform pg_temp.become_postgres();
  perform pg_temp.expect(
    'A5.multirole: one auth.users id holds Platform + Professional + Customer simultaneously',
    r.platform_available is true
      and r.professional_available is true
      and r.owned_organization_count >= 1
      and r.customer_available is true,
    format('platform=%s pro=%s owned=%s customer=%s',
           r.platform_available, r.professional_available, r.owned_organization_count, r.customer_available));
end $$;

select pg_temp.expect(
  'A5.multirole: granting a platform role did not remove the organization membership',
  exists (
    select 1 from public.memberships m join verify_ids v on v.v = m.user_id
    where v.k = 'approved' and m.role = 'owner'));

-- The resolver refuses to speak for anyone but the caller.
do $$
declare v_rows integer;
begin
  perform pg_temp.become_postgres();
  execute 'set local role anon';
  select count(*) into v_rows from public.get_my_access();
  execute 'reset role';
  perform pg_temp.expect('A5.resolver: returns zero rows for an unauthenticated caller', v_rows = 0);
exception when others then
  execute 'reset role';
  -- anon has no EXECUTE grant, so a permission error is an equally correct outcome.
  perform pg_temp.expect('A5.resolver: returns zero rows for an unauthenticated caller', true, 'denied by grant');
end $$;

-- ============================================================================
-- SECTION B — bookable professional onboarding
-- ============================================================================

select pg_temp.expect(
  'B.structure: business_type enum carries all five business shapes',
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'business_type')
  = array['solo_professional','barbershop','hair_salon','mixed_salon','multi_location']);

do $$
declare c text;
begin
  foreach c in array array['business_type','currency','country_code','onboarding_completed_at'] loop
    perform pg_temp.expect('B.structure: organizations.' || c || ' exists',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='organizations' and column_name = c));
  end loop;
end $$;

select pg_temp.expect(
  'B.locale: France suggests EUR, never USD',
  public.suggested_currency_for_country('FR') = 'EUR');
select pg_temp.expect(
  'B.locale: France suggests Europe/Paris',
  public.suggested_timezone_for_country('FR') = 'Europe/Paris');
select pg_temp.expect(
  'B.locale: a multi-timezone country returns NULL rather than a guess',
  public.suggested_timezone_for_country('US') is null);
select pg_temp.expect(
  'B.locale: an unknown country suggests no currency rather than defaulting',
  public.suggested_currency_for_country('ZZ') is null);

-- B. Approval carried the applicant's address into a first location --------
do $$
declare v_org uuid; v_loc record;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  select * into v_loc from public.locations l where l.organization_id = v_org limit 1;

  perform pg_temp.expect('B.approval: approval created a first location', v_loc.id is not null);
  perform pg_temp.expect('B.approval: the application address was not discarded',
    v_loc.city = 'Lyon' and v_loc.address_line1 = '12 rue de la Ré' and v_loc.postal_code = '69001',
    coalesce(v_loc.city,'(null)'));
  perform pg_temp.expect('B.approval: timezone derived from the application country',
    v_loc.timezone = 'Europe/Paris', coalesce(v_loc.timezone,'(null)'));
  perform pg_temp.expect('B.approval: currency seeded to EUR from the FR application',
    (select o.currency from public.organizations o where o.id = v_org) = 'EUR');
  perform pg_temp.expect('B.approval: business_type seeded from professional_type',
    (select o.business_type from public.organizations o where o.id = v_org) = 'barbershop');
end $$;

-- B. Readiness is honest about an unfinished business ----------------------
do $$
declare r record; v_org uuid;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  perform pg_temp.become((select v from verify_ids where k = 'approved'));
  select * into r from public.get_organization_readiness(v_org);
  perform pg_temp.become_postgres();

  perform pg_temp.expect('B.readiness: a freshly approved business is NOT yet bookable',
    r.ready_to_book is false);
  perform pg_temp.expect('B.readiness: a freshly approved business is NOT yet publishable',
    r.ready_to_publish is false);
  perform pg_temp.expect('B.readiness: it already has a location and a timezone',
    r.has_location and r.has_timezone);
  perform pg_temp.expect('B.readiness: missing list names the real gaps',
    r.missing_requirements @> array['service','professional','location_hours','professional_hours'],
    array_to_string(r.missing_requirements, ','));
  -- The wizard picks its starter-service template from this, so readiness
  -- returning the type itself is what keeps "which template" and "is it set"
  -- one answer rather than two queries that can disagree.
  perform pg_temp.expect('B.readiness: returns the business type and currency, not just flags',
    r.business_type = 'barbershop' and r.currency = 'EUR',
    coalesce(r.business_type::text, '(null)') || '/' || coalesce(r.currency, '(null)'));
end $$;

-- B. Readiness is not readable across tenants ------------------------------
do $$
declare v_denied boolean := false; v_org uuid;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  begin
    perform pg_temp.become((select v from verify_ids where k = 'outsider'));
    perform public.get_organization_readiness(v_org);
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.readiness: a non-member cannot read another org''s readiness', v_denied);
end $$;

-- B. An unready business cannot publish, by either path ---------------------
do $$
declare v_denied boolean := false; v_org uuid;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  begin
    perform pg_temp.become((select v from verify_ids where k = 'approved'));
    update public.organizations set marketplace_visible = true where id = v_org;
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.publish: a direct PATCH cannot publish an unready business', v_denied);
end $$;

do $$
declare v_denied boolean := false; v_org uuid;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  begin
    perform pg_temp.become((select v from verify_ids where k = 'approved'));
    perform public.set_organization_marketplace_visible(v_org, true);
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.publish: the validated RPC cannot publish an unready business either', v_denied);
end $$;

select pg_temp.expect(
  'B.publish: the unready business is still unpublished',
  (select not o.marketplace_visible from public.organizations o
     join public.professional_applications a on a.organization_id = o.id
     join verify_ids v on v.v = a.user_id where v.k = 'approved'));

-- B. Drive the whole wizard through to bookable -----------------------------
do $$
declare
  v_org uuid;
  v_loc uuid;
  v_barber uuid;
  v_count integer;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  select l.id into v_loc from public.locations l where l.organization_id = v_org limit 1;

  perform pg_temp.become((select v from verify_ids where k = 'approved'));

  perform public.save_business_profile(v_org, 'hair_salon'::public.business_type, 'EUR', 'FR');
  v_barber := public.ensure_owner_professional(v_org, v_loc, 'Camille R.', 'Coloriste');

  v_count := public.apply_starter_services(v_org, v_loc, '[
      {"name":"Coupe",     "duration_minutes":30, "price_cents":2800},
      {"name":"Brushing",  "duration_minutes":30, "price_cents":2500},
      {"name":"Couleur",   "duration_minutes":90, "price_cents":6500}
    ]'::jsonb, v_barber);

  perform public.apply_weekly_hours(v_org, v_loc, v_barber, '[
      {"day_of_week":1,"open_time":"09:00","close_time":"19:00"},
      {"day_of_week":2,"open_time":"09:00","close_time":"19:00"},
      {"day_of_week":3,"open_time":"09:00","close_time":"19:00"},
      {"day_of_week":4,"open_time":"09:00","close_time":"19:00"},
      {"day_of_week":5,"open_time":"09:00","close_time":"19:00"},
      {"day_of_week":6,"open_time":"10:00","close_time":"18:00"},
      {"day_of_week":0,"is_closed":true}
    ]'::jsonb);

  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.wizard: three starter services were created', v_count = 3);
  perform pg_temp.expect('B.wizard: the owner became a bookable professional', v_barber is not null);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.wizard: the onboarding steps all persisted', false, sqlerrm);
end $$;

do $$
declare r record; v_org uuid;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  perform pg_temp.become((select v from verify_ids where k = 'approved'));
  select * into r from public.get_organization_readiness(v_org);
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.readiness: the completed business IS bookable', r.ready_to_book is true,
    array_to_string(r.missing_requirements, ','));
  perform pg_temp.expect('B.readiness: the completed business IS publishable', r.ready_to_publish is true,
    array_to_string(r.missing_requirements, ','));
end $$;

-- B. Resuming onboarding must not duplicate anything ------------------------
do $$
declare v_org uuid; v_loc uuid; v_barber uuid; v_services integer; v_barbers integer;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  select l.id into v_loc from public.locations l where l.organization_id = v_org limit 1;

  perform pg_temp.become((select v from verify_ids where k = 'approved'));
  -- Exactly what a resumed wizard replays: same steps, same payloads.
  v_barber := public.ensure_owner_professional(v_org, v_loc, 'Camille R.', 'Coloriste');
  perform public.apply_starter_services(v_org, v_loc, '[
      {"name":"Coupe",     "duration_minutes":30, "price_cents":2800},
      {"name":"Brushing",  "duration_minutes":30, "price_cents":2500},
      {"name":"Couleur",   "duration_minutes":90, "price_cents":6500}
    ]'::jsonb, v_barber);
  perform pg_temp.become_postgres();

  select count(*) into v_services from public.services s where s.organization_id = v_org;
  select count(*) into v_barbers from public.barbers b where b.organization_id = v_org;

  perform pg_temp.expect('B.resume: replaying the services step created no duplicates', v_services = 3,
    v_services || ' services');
  perform pg_temp.expect('B.resume: replaying the professional step created no duplicate professional',
    v_barbers = 1, v_barbers || ' professionals');
end $$;

-- B. A renamed service is respected, not resurrected ------------------------
do $$
declare v_org uuid; v_loc uuid; v_services integer;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  select l.id into v_loc from public.locations l where l.organization_id = v_org limit 1;

  perform pg_temp.become((select v from verify_ids where k = 'approved'));
  update public.services set name = 'Coupe signature'
    where organization_id = v_org and name = 'Coupe';
  perform public.apply_starter_services(v_org, v_loc,
    '[{"name":"Coupe","duration_minutes":30,"price_cents":2800}]'::jsonb);
  perform pg_temp.become_postgres();

  select count(*) into v_services from public.services where organization_id = v_org;
  perform pg_temp.record('B.resume: a renamed service is left alone (template re-adds the original)',
    'INFO', v_services || ' services — templates are initializers, the owner''s rename wins');
end $$;

-- B. Publication now succeeds, through the validated RPC --------------------
do $$
declare v_org uuid; v_published boolean;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  perform pg_temp.become((select v from verify_ids where k = 'approved'));
  perform public.set_organization_marketplace_visible(v_org, true);
  perform pg_temp.become_postgres();
  select o.marketplace_visible into v_published from public.organizations o where o.id = v_org;
  perform pg_temp.expect('B.publish: a ready business CAN publish', v_published is true);
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.publish: a ready business CAN publish', false, sqlerrm);
end $$;

do $$
declare v_org uuid; v_ok boolean := true;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  begin
    perform pg_temp.become((select v from verify_ids where k = 'approved'));
    update public.organizations set marketplace_visible = false where id = v_org;
    update public.organizations set marketplace_visible = true where id = v_org;
  exception when others then v_ok := false;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.publish: unpublishing is never blocked, and re-publishing a ready business works', v_ok);
end $$;

-- B. THE POINT OF THE WHOLE LOT: real, computable booking slots -------------
do $$
declare v_slug text; v_loc uuid; v_barber uuid; v_service uuid; v_date date; v_slots integer;
begin
  select o.slug into v_slug from public.organizations o
    join public.professional_applications a on a.organization_id = o.id
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  select l.id into v_loc from public.locations l
    join public.organizations o on o.id = l.organization_id where o.slug = v_slug limit 1;
  select b.id into v_barber from public.barbers b
    join public.organizations o on o.id = b.organization_id where o.slug = v_slug limit 1;
  select s.id into v_service from public.services s
    join public.organizations o on o.id = s.organization_id
    where o.slug = v_slug and s.name = 'Brushing' limit 1;

  -- The next Wednesday: inside the Mon-Sat hours configured above, and far
  -- enough ahead that the same-day past-time trim cannot empty the result.
  v_date := (current_date + ((10 - extract(dow from current_date)::integer) % 7 + 1))::date;
  v_date := v_date + ((3 - extract(dow from v_date)::integer + 7) % 7);

  execute 'set local role anon';
  select count(*) into v_slots
    from public.get_public_available_slots(v_slug, v_loc, v_barber, v_service, v_date);
  execute 'reset role';

  perform pg_temp.expect(
    'B.bookable: an ANONYMOUS visitor gets real bookable slots after onboarding',
    v_slots > 0,
    v_slots || ' slots on ' || v_date);
exception when others then
  execute 'reset role';
  perform pg_temp.expect('B.bookable: an ANONYMOUS visitor gets real bookable slots after onboarding',
    false, sqlerrm);
end $$;

do $$
declare v_hits integer;
begin
  execute 'set local role anon';
  select count(*) into v_hits from public.search_public_professionals(p_query := 'Approved Salon ABB', p_limit := 20);
  execute 'reset role';
  perform pg_temp.expect('B.bookable: the published business is discoverable in marketplace search',
    v_hits > 0, v_hits || ' results');
exception when others then
  execute 'reset role';
  perform pg_temp.expect('B.bookable: the published business is discoverable in marketplace search', false, sqlerrm);
end $$;

-- B. Onboarding permissions do not depend on the authentication method ------
do $$
declare v_denied boolean := false; v_org uuid;
begin
  select a.organization_id into v_org from public.professional_applications a
    join verify_ids v on v.v = a.user_id where v.k = 'approved';
  begin
    perform pg_temp.become((select v from verify_ids where k = 'oauth_google'));
    perform public.save_business_profile(v_org, 'mixed_salon'::public.business_type, 'USD', 'US');
  exception when others then v_denied := true;
  end;
  perform pg_temp.become_postgres();
  perform pg_temp.expect(
    'B.authz: a Google identity with no membership cannot touch someone else''s business profile',
    v_denied);
end $$;

select pg_temp.expect(
  'B.authz: the business profile was not altered by that attempt',
  (select o.currency = 'EUR' and o.business_type = 'hair_salon'
     from public.organizations o
     join public.professional_applications a on a.organization_id = o.id
     join verify_ids v on v.v = a.user_id where v.k = 'approved'));

-- B. complete_onboarding is honest --------------------------------------------
do $$
declare r record; v_org uuid;
begin
  select o.id into v_org from public.organizations o where o.slug = 'solo-studio-abb';
  perform pg_temp.become((select v from verify_ids where k = 'solo_owner'));
  select * into r from public.complete_onboarding(v_org, true);
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.complete: an unfinished business is not stamped complete',
    r.ready_to_book is false and r.is_published is false,
    array_to_string(r.missing_requirements, ','));
  perform pg_temp.expect('B.complete: onboarding_completed_at stays null while incomplete',
    (select o.onboarding_completed_at is null from public.organizations o where o.id = v_org));
exception when others then
  perform pg_temp.become_postgres();
  perform pg_temp.expect('B.complete: an unfinished business is not stamped complete', false, sqlerrm);
end $$;

-- Context -------------------------------------------------------------------
select pg_temp.record('INFO.scope', 'INFO',
  'Google/Apple sign-in is a network round trip and cannot be executed by SQL. The A5 section proves the property SQL can prove: no provider identity or metadata grants any FadeUp role.');
select pg_temp.record('INFO.hours', 'INFO',
  'apply_weekly_hours still writes ONE window per day. Lunch closures and split shifts need a location_hours schema change and are deliberately out of scope for this lot.');
select pg_temp.record('INFO.geocoding', 'INFO',
  'Readiness requires a full address but not latitude/longitude: no geocoding pipeline exists yet, so distance-ranked search remains unavailable to newly onboarded shops.');

-- ============================================================================
-- RESULTS — selected BEFORE the rollback that discards every fixture row
-- ============================================================================

\echo ''
\echo '=================== VERIFY: LOTS A + A.5 + B ==================='
select seq, status, check_name, detail from verify_results order by seq;

\echo ''
\echo '--- summary ---'
select status, count(*) from verify_results group by status order by status;

\echo ''
\echo '--- failures (expected: none) ---'
select check_name, detail from verify_results where status = 'FAIL' order by seq;

rollback;
