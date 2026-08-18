-- FadeUp — Wave 1 verification: marketplace publication boundary
--
-- Proves the marketplace-safety requirement from the Wave 1 spec: a Worker
-- V2 acquisition prospect can NEVER appear in public marketplace search
-- results merely by existing in the database, and an organization/barber
-- that has not explicitly opted in (marketplace_visible) is invisible even
-- though it's a real, fully-onboarded FadeUp tenant. Also proves the
-- individual-barber eligibility gate (is_public/is_bookable) added by
-- 20260813100000_marketplace_professionals.sql actually hides a barber when
-- flipped, independent of the shop's own visibility.
--
-- Run with:
--   docker cp db/tests/verify_wave1_marketplace_boundary.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_wave1_marketplace_boundary.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'owner-a+w1@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Owner A"}', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'owner-b+w1@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Owner B"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: Org A (will publish) and Org B (never publishes)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b0000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Wave1 Boundary Shop A', 'wave1-boundary-a', 'Main', 'UTC');
insert into public.services (organization_id, name, duration_minutes, price_cents)
  select id, 'Boundary Fade', 30, 2000 from public.organizations where slug = 'wave1-boundary-a';
insert into public.service_locations (organization_id, service_id, location_id)
  select s.organization_id, s.id, l.id
  from public.services s join public.locations l on l.organization_id = s.organization_id
  where s.organization_id = (select id from public.organizations where slug = 'wave1-boundary-a');
-- A barber only becomes marketplace-discoverable once staff_profiles has a
-- primary location (see list_public_barbers'/search_public_professionals'
-- documented "single primary location" simplification) — the owner's
-- auto-provisioned staff_profiles row (handle_new_membership trigger) has
-- location_id null until explicitly set, same as production onboarding.
update public.staff_profiles set location_id = (select id from public.locations where organization_id = (select id from public.organizations where slug = 'wave1-boundary-a'))
  where organization_id = (select id from public.organizations where slug = 'wave1-boundary-a') and user_id = (select auth.uid());
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'wave1-boundary-a' and sp.user_id = (select auth.uid());
-- Everything from here to the publish call was added when LOT B
-- (20260818220000) made publication conditional on
-- get_organization_readiness().ready_to_publish. This fixture published a
-- shop with no hours, no address, no currency and no service/professional
-- link — i.e. a shop that could never actually return a bookable slot. That
-- is exactly what the new gate exists to stop, so the fixture is completed
-- rather than the gate weakened. The boundary this file tests (an
-- unpublished org and an acquisition prospect must never leak into search)
-- is unchanged.
select public.save_business_profile(
  (select id from public.organizations where slug = 'wave1-boundary-a'),
  'barbershop'::public.business_type, 'EUR', 'FR');
update public.locations
  set address_line1 = '1 rue Boundary', city = 'Paris', country = 'FR', postal_code = '75001'
  where organization_id = (select id from public.organizations where slug = 'wave1-boundary-a');
insert into public.barber_services (organization_id, barber_id, service_id)
  select b.organization_id, b.id, s.id
  from public.barbers b join public.services s on s.organization_id = b.organization_id
  where b.organization_id = (select id from public.organizations where slug = 'wave1-boundary-a')
  on conflict do nothing;
select public.apply_weekly_hours(
  (select id from public.organizations where slug = 'wave1-boundary-a'),
  (select id from public.locations where organization_id = (select id from public.organizations where slug = 'wave1-boundary-a')),
  (select b.id from public.barbers b where b.organization_id = (select id from public.organizations where slug = 'wave1-boundary-a')),
  '[{"day_of_week":0,"open_time":"09:00","close_time":"18:00"},
    {"day_of_week":1,"open_time":"09:00","close_time":"18:00"},
    {"day_of_week":2,"open_time":"09:00","close_time":"18:00"},
    {"day_of_week":3,"open_time":"09:00","close_time":"18:00"},
    {"day_of_week":4,"open_time":"09:00","close_time":"18:00"},
    {"day_of_week":5,"open_time":"09:00","close_time":"18:00"},
    {"day_of_week":6,"open_time":"09:00","close_time":"18:00"}]'::jsonb);
select public.set_organization_marketplace_visible(id, true) from public.organizations where slug = 'wave1-boundary-a';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b0000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Wave1 Boundary Shop B', 'wave1-boundary-b', 'Main', 'UTC');
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'wave1-boundary-b' and sp.user_id = (select auth.uid());
-- Deliberately never call set_organization_marketplace_visible for Org B.
commit;

begin;
reset role;
select id as org_a_id from public.organizations where slug = 'wave1-boundary-a' \gset
select id as org_b_id from public.organizations where slug = 'wave1-boundary-b' \gset
select b.id as barber_a_id from public.barbers b where b.organization_id = :'org_a_id' \gset
select b.id as barber_b_id from public.barbers b where b.organization_id = :'org_b_id' \gset
-- A Worker V2 acquisition prospect with a colliding name, inserted directly
-- (as postgres, which bypasses RLS) exactly like the real acquisition
-- pipeline would — proves the search RPC structurally cannot reach it, not
-- merely that no test happens to query for it.
insert into public.prospects (type, canonical_name, country)
  values ('barbershop', 'Wave1 Boundary Prospect Shop', 'FR');
commit;

\echo '=========================================================='
\echo '2. anon search for "Wave1 Boundary" returns ONLY Org A (shop + barber)'
\echo '=========================================================='
begin;
set local role anon;
select entity_type, organization_name, barber_display_name
from public.search_public_professionals(p_query := 'Wave1 Boundary', p_limit := 50)
order by entity_type, organization_name;
commit;
-- Expect exactly 2 rows: ('barber','Wave1 Boundary Shop A',<name>) and
-- ('shop','Wave1 Boundary Shop A', null). Org B and the prospect must be
-- absent — verified by eye against the printed rows above (psql \gset
-- can't assert row counts across a set-returning call inline, so this
-- script prints results for the operator/CI harness to diff; the assertion
-- queries in section 3 below give hard pass/fail signals).

\echo '=========================================================='
\echo '3. Hard assertions: Org B and the prospect never appear'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_org_b_hits integer;
  v_prospect_hits integer;
begin
  select count(*) into v_org_b_hits
  from public.search_public_professionals(p_query := 'Wave1 Boundary', p_limit := 50)
  where organization_name = 'Wave1 Boundary Shop B';

  if v_org_b_hits <> 0 then
    raise exception 'FAIL: unpublished Org B leaked into marketplace search (% rows)', v_org_b_hits;
  end if;

  select count(*) into v_prospect_hits
  from public.search_public_professionals(p_query := 'Wave1 Boundary', p_limit := 50)
  where organization_name ilike '%Prospect%' or barber_display_name ilike '%Prospect%';

  if v_prospect_hits <> 0 then
    raise exception 'FAIL: an acquisition prospect leaked into marketplace search (% rows)', v_prospect_hits;
  end if;

  raise notice 'PASS: unpublished org and acquisition prospect both absent from marketplace search';
end $$;
commit;

\echo '=========================================================='
\echo '4. anon cannot read public.prospects directly at all'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.prospects;
    -- Either outcome is an acceptable proof of the boundary: a hard
    -- privilege error, or a grant-level SELECT that RLS filters down to
    -- zero rows (Postgres RLS does not raise an error for filtered rows —
    -- it silently returns none, which is the correct, expected behavior
    -- here, not a permission error).
    if v_count > 0 then
      raise exception 'FAIL: anon was able to see % row(s) of public.prospects', v_count;
    end if;
    raise notice 'PASS: anon sees zero rows of public.prospects (RLS-filtered)';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to select public.prospects';
  end;
end $$;
commit;

\echo '=========================================================='
\echo '5. Flipping a barber to non-public hides only that barber, not the shop'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b0000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update public.staff_profiles set is_public = false
  where organization_id = :'org_a_id' and id = (select staff_profile_id from public.barbers where id = :'barber_a_id');
commit;

begin;
set local role anon;
do $$
declare
  v_barber_hits integer;
  v_shop_hits integer;
begin
  select count(*) into v_barber_hits
  from public.search_public_professionals(p_query := 'Wave1 Boundary', p_limit := 50)
  where entity_type = 'barber' and organization_name = 'Wave1 Boundary Shop A';

  select count(*) into v_shop_hits
  from public.search_public_professionals(p_query := 'Wave1 Boundary', p_limit := 50)
  where entity_type = 'shop' and organization_name = 'Wave1 Boundary Shop A';

  if v_barber_hits <> 0 then
    raise exception 'FAIL: barber with is_public=false still appeared (% rows)', v_barber_hits;
  end if;
  if v_shop_hits <> 1 then
    raise exception 'FAIL: shop row disappeared/duplicated after unrelated barber visibility change (% rows)', v_shop_hits;
  end if;

  raise notice 'PASS: is_public=false hides the barber only, shop still visible';
end $$;
commit;

\echo '=========================================================='
\echo '6. Cleanup'
\echo '=========================================================='
begin;
reset role;
delete from public.prospects where canonical_name = 'Wave1 Boundary Prospect Shop';
delete from public.organizations where slug in ('wave1-boundary-a', 'wave1-boundary-b');
delete from auth.users where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
commit;

begin;
reset role;
select count(*) as remaining_orgs from public.organizations where slug in ('wave1-boundary-a', 'wave1-boundary-b');
select count(*) as remaining_prospects from public.prospects where canonical_name = 'Wave1 Boundary Prospect Shop';
select count(*) as remaining_users from auth.users where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
commit;
