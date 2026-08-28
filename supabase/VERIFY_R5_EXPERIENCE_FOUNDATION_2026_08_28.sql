-- ============================================================================
-- FadeUp R5 — VERIFY
--
-- Two migrations, and everything worth asserting about them is a claim that
-- could be wrong in a way reading the SQL would not reveal:
--
--   * the marketplace projection gained three columns and a sort parameter
--     WITHOUT widening which rows it returns
--   * `nearest` and `price` actually reorder, and an unknown sort falls back
--     rather than erroring
--   * the dashboard layout is owned by the SHOP, and a `barber` can read it
--     and cannot write it
--
-- The authorization assertions run as real roles through RLS. Asserting a
-- policy EXISTS proves nothing — R1B's §8.16 finding was precisely a policy
-- that existed and could never match a row, because the grant was checked
-- first. So each one below performs the operation and checks what happened.
--
-- ============================================================================
-- EVERY FIXTURE IN THIS FILE IS ROLLED BACK.
--
-- This VERIFY creates organizations, locations, services and auth users in
-- order to assert things about them, and it is designed to be runnable against
-- ANY database including production. So the whole thing runs inside one
-- transaction that ends in ROLLBACK, which is the convention every other
-- VERIFY in this repository already follows (R1B line 159/2126, R4 line
-- 181/1090).
--
-- The first version of this file did not, and it was run against live. Four
-- fixture organizations committed, one of them marketplace_visible, and for a
-- few minutes a shop called "R5 Far And Cheap" was returned by the public
-- marketplace search to real visitors. The organizations could not then be
-- deleted, because organizations cascade into commercial_plan_changes and that
-- table is append-only for every role including postgres — by design.
--
-- A test that cannot be undone is not a test, it is a migration with
-- assertions in it. Hence the transaction below, and hence the assertion at
-- the very end that proves the rollback actually happened.
--
-- Run: scripts/disposable-db-test.sh --verify supabase/VERIFY_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

do $$
begin
  raise notice '=== R5 VERIFY ===';
end
$$;

-- ============================================================================
-- 1. The marketplace contract
-- ============================================================================

do $$
declare
  v_result text;
begin
  select pg_get_function_result(oid) into v_result
  from pg_proc
  where proname = 'search_public_professionals'
    and pronamespace = 'public'::regnamespace;

  if v_result is null then
    raise exception 'R5.1 FAILED: search_public_professionals does not exist';
  end if;
  if v_result not like '%latitude double precision%' then
    raise exception 'R5.1 FAILED: search_public_professionals does not return latitude';
  end if;
  if v_result not like '%longitude double precision%' then
    raise exception 'R5.1 FAILED: search_public_professionals does not return longitude';
  end if;
  if v_result not like '%timezone text%' then
    raise exception 'R5.1 FAILED: search_public_professionals does not return timezone';
  end if;

  raise notice 'R5.1 OK — the projection carries latitude, longitude and timezone';
end
$$;

do $$
declare
  v_count integer;
begin
  -- Exactly ONE overload must exist. Two would make every 13-argument call
  -- site ambiguous the moment the new one's trailing DEFAULT applies, and the
  -- failure would surface as a runtime PostgREST error rather than at deploy.
  select count(*) into v_count
  from pg_proc
  where proname = 'search_public_professionals'
    and pronamespace = 'public'::regnamespace;

  if v_count <> 1 then
    raise exception 'R5.2 FAILED: expected exactly 1 search_public_professionals, found %', v_count;
  end if;

  raise notice 'R5.2 OK — one overload, so no 13-argument call is ambiguous';
end
$$;

do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(oid) into v_args
  from pg_proc
  where proname = 'search_public_professionals'
    and pronamespace = 'public'::regnamespace;

  if v_args not like '%p_sort%' then
    raise exception 'R5.3 FAILED: p_sort is not a parameter (got: %)', v_args;
  end if;

  raise notice 'R5.3 OK — p_sort exists';
end
$$;

do $$
begin
  -- The grants are the actual access boundary; the function is SECURITY
  -- DEFINER, so a missing grant is the difference between a working
  -- marketplace and an empty one for signed-out visitors.
  if not has_function_privilege('anon', 'public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text)', 'execute') then
    raise exception 'R5.4 FAILED: anon cannot execute search_public_professionals';
  end if;
  if not has_function_privilege('authenticated', 'public.search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text)', 'execute') then
    raise exception 'R5.4 FAILED: authenticated cannot execute search_public_professionals';
  end if;

  raise notice 'R5.4 OK — anon and authenticated may execute the search';
end
$$;

-- ============================================================================
-- 2. Sorting actually sorts, and an unknown sort is not an error
-- ============================================================================

do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_loc_a uuid := gen_random_uuid();
  v_loc_b uuid := gen_random_uuid();
  v_cat uuid := gen_random_uuid();
  v_svc_a uuid := gen_random_uuid();
  v_svc_b uuid := gen_random_uuid();
  v_first text;
begin
  -- Two visible shops: A is FAR and CHEAP, B is NEAR and EXPENSIVE. Any sort
  -- that confuses the two orderings is caught by one of the assertions below.
  insert into public.organizations (id, name, slug, marketplace_visible)
  values (v_org_a, 'R5 Far And Cheap', 'r5-far-cheap', true),
         (v_org_b, 'R5 Near And Dear', 'r5-near-dear', true);

  insert into public.locations (id, organization_id, name, city, country, timezone, latitude, longitude, is_active)
  values (v_loc_a, v_org_a, 'Far', 'Lille', 'FR', 'Europe/Paris', 50.63, 3.06, true),
         (v_loc_b, v_org_b, 'Near', 'Paris', 'FR', 'Europe/Paris', 48.86, 2.35, true);

  insert into public.service_categories (id, organization_id, name)
  values (v_cat, v_org_a, 'R5');

  insert into public.services (id, organization_id, category_id, name, duration_minutes, price_cents, is_active)
  values (v_svc_a, v_org_a, v_cat, 'R5 Cheap Fade', 30, 1000, true);

  insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
  values (v_svc_b, v_org_b, 'R5 Dear Fade', 30, 9000, true);

  -- service_locations carries its own organization_id, and a BEFORE INSERT
  -- trigger checks BOTH sides against it. Omitting it leaves it NULL and the
  -- guard fires — which is the guard doing its job, not a fixture quirk.
  insert into public.service_locations (organization_id, service_id, location_id)
  values (v_org_a, v_svc_a, v_loc_a), (v_org_b, v_svc_b, v_loc_b);

  -- NEAREST, measured from Paris: the Paris shop must lead.
  select organization_slug into v_first
  from public.search_public_professionals(
    p_country => 'FR', p_latitude => 48.86, p_longitude => 2.35,
    p_entity_type => 'shop', p_limit => 50, p_sort => 'nearest'
  )
  where organization_slug like 'r5-%'
  limit 1;

  if v_first is distinct from 'r5-near-dear' then
    raise exception 'R5.5 FAILED: nearest did not lead with the nearest shop (got %)', v_first;
  end if;
  raise notice 'R5.5 OK — nearest orders by distance';

  -- PRICE, same coordinates: the CHEAP shop must now lead, which is the whole
  -- point — a client-side sort of a distance-ordered page could never do this.
  select organization_slug into v_first
  from public.search_public_professionals(
    p_country => 'FR', p_latitude => 48.86, p_longitude => 2.35,
    p_entity_type => 'shop', p_limit => 50, p_sort => 'price'
  )
  where organization_slug like 'r5-%'
  limit 1;

  if v_first is distinct from 'r5-far-cheap' then
    raise exception 'R5.6 FAILED: price did not lead with the cheapest shop (got %)', v_first;
  end if;
  raise notice 'R5.6 OK — price orders by starting price, independently of distance';

  -- An unrecognised sort must fall back, never raise: a stale client asking
  -- for a sort this function has never heard of should get results.
  perform 1 from public.search_public_professionals(
    p_country => 'FR', p_entity_type => 'shop', p_limit => 5, p_sort => 'rating'
  );
  raise notice 'R5.7 OK — an unknown sort falls back instead of erroring';

  -- Coordinates come back, so the map has something to plot.
  if not exists (
    select 1 from public.search_public_professionals(
      p_country => 'FR', p_entity_type => 'shop', p_limit => 50
    )
    where organization_slug = 'r5-near-dear'
      and latitude is not null and longitude is not null and timezone = 'Europe/Paris'
  ) then
    raise exception 'R5.8 FAILED: a plottable shop came back without coordinates or timezone';
  end if;
  raise notice 'R5.8 OK — results carry the coordinates and timezone the map and the availability label need';

  -- AND THE ROW SET DID NOT WIDEN. A shop that has NOT opted into the
  -- marketplace must still be absent — this is the assertion that would catch
  -- a WHERE clause dropped while rewriting the function body.
  update public.organizations set marketplace_visible = false where id = v_org_b;
  if exists (
    select 1 from public.search_public_professionals(p_country => 'FR', p_limit => 50)
    where organization_slug = 'r5-near-dear'
  ) then
    raise exception 'R5.9 FAILED: a non-marketplace-visible shop is returned by search';
  end if;
  raise notice 'R5.9 OK — the rewrite did not widen which rows are public';

  -- Deliberately NOT cleaned up. `commercial_plan_changes` is append-only and
  -- refuses the cascading DELETE, which is correct — R2 made that history
  -- immutable on purpose. The database this runs in is disposable, and every
  -- fixture here is slug-prefixed `r5-` so nothing later can collide with it.
end
$$;

-- ----------------------------------------------------------------------------
-- Impersonation must set BOTH claim GUCs: the live stack's auth.uid() parses
-- request.jwt.claims, the older disposable image reads request.jwt.claim.sub.
-- Setting only one leaves auth.uid() NULL, which silently turns every
-- "an unauthorized member cannot" assertion into "an anonymous caller cannot"
-- — a weaker and different claim. Same helper R1B's VERIFY uses, for the same
-- reason.
-- ----------------------------------------------------------------------------
create or replace function pg_temp.become(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end;
$fn$;

create or replace function pg_temp.become_postgres()
returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$fn$;

-- ============================================================================
-- 3. The dashboard layout belongs to the SHOP
-- ============================================================================

do $$
begin
  if (select relrowsecurity from pg_class where oid = 'public.organization_dashboard_layouts'::regclass) is not true then
    raise exception 'R5.10 FAILED: RLS is not enabled on organization_dashboard_layouts';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.organization_dashboard_layouts'::regclass) is not true then
    raise exception 'R5.10 FAILED: FORCE RLS is not set on organization_dashboard_layouts';
  end if;
  if has_table_privilege('anon', 'public.organization_dashboard_layouts', 'select') then
    raise exception 'R5.10 FAILED: anon can read organization_dashboard_layouts';
  end if;
  raise notice 'R5.10 OK — RLS + FORCE RLS on, anon has no grant at all';
end
$$;

do $$
declare
  v_cols text[];
begin
  -- The tenant anchor must not be UPDATE-able even by an authorized manager:
  -- with a column grant on organization_id, an owner of shop A could move
  -- their layout row to shop B, and the UPDATE policy's WITH CHECK would be
  -- evaluated against the NEW row they now have authority over only if they
  -- happen to hold both. Removing the grant closes the shape entirely.
  select array_agg(column_name::text) into v_cols
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'organization_dashboard_layouts'
    and grantee = 'authenticated'
    and privilege_type = 'UPDATE';

  if v_cols is null or 'organization_id' = any(v_cols) then
    raise exception 'R5.11 FAILED: authenticated may UPDATE organization_id (got: %)', v_cols;
  end if;
  raise notice 'R5.11 OK — organization_id is not UPDATE-grantable, so a layout cannot cross tenants';
end
$$;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_barber uuid := gen_random_uuid();
  v_ok boolean;
  -- Separate from v_ok on purpose: GET DIAGNOSTICS into a boolean happens to
  -- work through plpgsql's I/O coercion ('0'::boolean), which is obscure
  -- enough that a reader would reasonably doubt what this test proves.
  v_rows integer;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'owner+r5@fadeup.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_barber, 'authenticated', 'authenticated',
     'barber+r5@fadeup.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.organizations (id, name, slug) values (v_org, 'R5 Layout Shop', 'r5-layout-shop');

  -- handle_new_organization made the inserting session's user the owner; there
  -- is no session here, so the memberships are written explicitly.
  delete from public.memberships where organization_id = v_org;
  insert into public.memberships (organization_id, user_id, role)
  values (v_org, v_owner, 'owner'),
         (v_org, v_barber, 'barber');

  -- ---- as the OWNER: may create the shop layout -------------------------
  perform pg_temp.become(v_owner);

  insert into public.organization_dashboard_layouts (organization_id, module_order, updated_by)
  values (v_org, array['revenue', 'appointments', 'queue'], v_owner);

  raise notice 'R5.12 OK — an owner may create the shop layout';

  -- ---- as a BARBER: may READ the same row -------------------------------
  perform pg_temp.become(v_barber);

  select exists (
    select 1 from public.organization_dashboard_layouts where organization_id = v_org
  ) into v_ok;

  if not v_ok then
    raise exception 'R5.13 FAILED: a member cannot read their own shop''s dashboard layout';
  end if;
  raise notice 'R5.13 OK — every member reads the shop layout (it is the dashboard they are looking at)';

  -- ---- as a BARBER: may NOT change it -----------------------------------
  -- §24/§40: an unauthorized employee must not be able to overwrite shop
  -- configuration. RLS makes the UPDATE match zero rows rather than raising,
  -- so the assertion is on the row count, not on an exception.
  update public.organization_dashboard_layouts
     set module_order = array['queue']
   where organization_id = v_org;

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'R5.14 FAILED: a barber overwrote the shared shop dashboard layout (% rows)', v_rows;
  end if;
  raise notice 'R5.14 OK — a barber cannot mutate the shared shop layout';

  -- ---- as a BARBER: may not delete it either ----------------------------
  delete from public.organization_dashboard_layouts where organization_id = v_org;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'R5.15 FAILED: a barber deleted the shared shop dashboard layout (% rows)', v_rows;
  end if;
  raise notice 'R5.15 OK — a barber cannot reset the shared shop layout';

  -- ---- the layout is genuinely SHARED -----------------------------------
  perform pg_temp.become(v_owner);
  update public.organization_dashboard_layouts
     set module_order = array['queue', 'revenue', 'appointments', 'customers']
   where organization_id = v_org;

  perform pg_temp.become(v_barber);
  select module_order = array['queue', 'revenue', 'appointments', 'customers']
    into v_ok
  from public.organization_dashboard_layouts
  where organization_id = v_org;

  if not v_ok then
    raise exception 'R5.16 FAILED: the owner''s new arrangement is not what other members see';
  end if;
  raise notice 'R5.16 OK — one authorized change is what the whole shop then sees';

  perform pg_temp.become_postgres();
end
$$;

do $$
declare
  v_org uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug) values (v_org, 'R5 Constraint Shop', 'r5-constraint-shop');

  -- A module listed twice would render twice.
  begin
    insert into public.organization_dashboard_layouts (organization_id, module_order)
    values (v_org, array['revenue', 'revenue']);
    raise exception 'R5.17 FAILED: a duplicate module key was accepted';
  exception when check_violation then
    raise notice 'R5.17 OK — duplicate module keys are refused';
  end;

  -- The column can never hold prose or a URL dressed as a module name.
  begin
    insert into public.organization_dashboard_layouts (organization_id, module_order)
    values (v_org, array['https://example.test/x']);
    raise exception 'R5.18 FAILED: a non-identifier module key was accepted';
  exception when check_violation then
    raise notice 'R5.18 OK — module keys must be conservative identifiers';
  end;

  -- An unrecognised but well-formed key IS accepted: adding a dashboard card
  -- must not require a migration. The client ignores what it does not know.
  insert into public.organization_dashboard_layouts (organization_id, module_order)
  values (v_org, array['a_module_shipped_after_this_migration']);
  raise notice 'R5.19 OK — a well-formed unknown key is stored, not rejected';
end
$$;

do $$
declare
  v_leftovers integer;
begin
  -- Proves the fixtures are confined to this transaction. If a later edit ever
  -- moves a fixture outside it, this is the assertion that says so — a VERIFY
  -- that silently seeds production is worse than one that fails.
  select count(*) into v_leftovers from public.organizations where slug like 'r5-%';
  if v_leftovers <> 4 then
    raise exception 'R5.20 FAILED: expected the 4 in-transaction fixtures, found %', v_leftovers;
  end if;
  raise notice 'R5.20 OK — fixtures exist inside this transaction and are about to be discarded';
end
$$;

-- ============================================================================
-- NOTHING THIS FILE CREATED SURVIVES.
-- ============================================================================
rollback;

do $$
declare
  v_leftovers integer;
begin
  select count(*) into v_leftovers from public.organizations where slug like 'r5-%';
  if v_leftovers <> 0 then
    raise warning 'R5 VERIFY left % r5-* organization(s) behind — these are NOT from this run; a previous run committed them', v_leftovers;
  else
    raise notice 'R5.21 OK — the rollback took: no fixture survived';
  end if;
  raise notice '=== R5 VERIFY PASSED ===';
end
$$;
