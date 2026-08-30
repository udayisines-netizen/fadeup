-- FadeUp R5R.1A verification: the marketplace supply contract
-- (search_public_professionals.business_type).
--
-- Seeds one organization per value of the business_type enum, each with an
-- active location, plus one that is NOT marketplace_visible and one whose only
-- location is inactive. The multi_location organization gets THREE locations,
-- because the customer-facing claim being tested is that each comes back as its
-- own ordinary result rather than one aggregated "group" row. One public,
-- bookable staff barber is attached to the barbershop.
--
-- Proves, as anon: every business type reaches the public contract with its
-- authoritative value; a multi-location organization returns one row per active
-- location and nothing that names it as a parent of anything; staff barber rows
-- are unchanged and still excluded from marketplace supply; hidden
-- organizations and inactive locations stay hidden; anon still reads ZERO rows
-- from organizations directly; the 14-argument input contract still accepts the
-- positional, 13-argument-prefix and named forms; and the pre-existing result
-- semantics (total_count, distance_km, is_open_now, queue_waiting_count,
-- starting_price_cents) are unchanged.
--
-- LEAVES NOTHING BEHIND, because it never commits.
--
-- The whole script is one transaction ending in ROLLBACK. That is not tidiness,
-- it is the only correct option: `organizations` gets a `commercial_plan_changes`
-- row on insert, that table is append-only, and its guard is explicit that there
-- is "no role exemption, on purpose — an audit trail that the most powerful role
-- can rewrite is a log, not an audit trail". So a COMMITTED fixture organization
-- can never be deleted by anyone, and a script that seeds one leaves permanent
-- residue in whatever database it is run against. Rolling back writes no audit
-- history at all.
--
-- Run with:
--   docker cp db/tests/verify_marketplace_supply_type.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_marketplace_supply_type.sql

\set ON_ERROR_STOP on

begin;

insert into public.organizations (name, slug, business_type, marketplace_visible) values
  ('R5R Solo',     'r5r1a-supply-solo',   'solo_professional', true),
  ('R5R Shop',     'r5r1a-supply-shop',   'barbershop',        true),
  ('R5R Hair',     'r5r1a-supply-hair',   'hair_salon',        true),
  ('R5R Mixed',    'r5r1a-supply-mixed',  'mixed_salon',       true),
  ('R5R Group',    'r5r1a-supply-group',  'multi_location',    true),
  ('R5R Hidden',   'r5r1a-supply-hidden', 'barbershop',        false),
  ('R5R Inactive', 'r5r1a-supply-inact',  'barbershop',        true);

-- A real multi-location organization is on a multi-location plan. FadeUp
-- enforces that: `enforce_establishment_capacity` fails a second active
-- location on the free plan, which is correct production behaviour and is NOT
-- worked around here. The fixture is simply modelled honestly — `multi_pro`
-- allows five establishments, and the group below opens three.
--
-- `ensure_organization_commercial_state` gives every new organization the most
-- restrictive plan, so this is an update rather than an insert.
update public.organization_commercial_state s
set plan_key = 'multi_pro'
from public.organizations o
where o.id = s.organization_id and o.slug = 'r5r1a-supply-group';

insert into public.locations (organization_id, name, city, country, timezone, is_active)
select o.id, v.loc, 'Testville', 'ZZ', 'UTC', v.active
from public.organizations o
join (values
  ('r5r1a-supply-solo',   'R5R Solo',             true),
  ('r5r1a-supply-shop',   'R5R Shop',             true),
  ('r5r1a-supply-hair',   'R5R Hair',             true),
  ('r5r1a-supply-mixed',  'R5R Mixed',            true),
  ('r5r1a-supply-group',  'R5R Group Republique', true),
  ('r5r1a-supply-group',  'R5R Group Creteil',    true),
  ('r5r1a-supply-group',  'R5R Group Lyon',       true),
  ('r5r1a-supply-hidden', 'R5R Hidden',           true),
  ('r5r1a-supply-inact',  'R5R Inactive',         false)
) as v(slug, loc, active) on v.slug = o.slug;

-- One staff barber at the barbershop, public and bookable: the row that must
-- keep behaving exactly as before and must never become marketplace supply.
insert into public.staff_profiles (organization_id, location_id, display_name, is_active, is_public)
select o.id, l.id, 'R5R Staff Barber', true, true
from public.organizations o join public.locations l on l.organization_id = o.id
where o.slug = 'r5r1a-supply-shop';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true
from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
where o.slug = 'r5r1a-supply-shop';

\echo '=========================================================='
\echo '1-4. Every business type reaches the public contract, as anon'
\echo '=========================================================='
set role anon;
select organization_name, marketplace_supply_type
from public.search_public_professionals(p_query => 'R5R', p_entity_type => 'shop', p_limit => 50)
where organization_name in ('R5R Solo', 'R5R Shop', 'R5R Hair', 'R5R Mixed')
order by organization_name;
-- EXPECT exactly four rows, with the INTERNAL enum nowhere in sight:
--   R5R Hair  | barbershop     (hair_salon)
--   R5R Mixed | barbershop     (mixed_salon)
--   R5R Shop  | barbershop     (barbershop)
--   R5R Solo  | independent    (solo_professional)
reset role;

\echo '=========================================================='
\echo '5. A multi-location organization returns one ordinary row PER LOCATION'
\echo '=========================================================='
set role anon;
select location_name, marketplace_supply_type
from public.search_public_professionals(p_query => 'R5R Group', p_entity_type => 'shop', p_limit => 50)
order by location_name;
-- EXPECT three rows, each carrying marketplace_supply_type = barbershop. The
-- word "multi_location" must appear NOWHERE in the output: it is internal
-- topology. There is no aggregate "group" row and no column naming the
-- organization as a parent of anything.
reset role;

\echo '=========================================================='
\echo '6. Staff barber behaviour is UNCHANGED'
\echo '=========================================================='
set role anon;
-- Still returned as a barber row when barber rows are asked for...
select entity_type, barber_display_name, marketplace_supply_type
from public.search_public_professionals(p_query => 'R5R Staff', p_entity_type => 'barber', p_limit => 50);
-- EXPECT one row: barber | R5R Staff Barber | barbershop
-- (unchanged behaviour; the row is still not marketplace supply — see below)

-- ...and still absent from marketplace supply, which is what Home requests.
select count(*) as staff_rows_in_supply
from public.search_public_professionals(p_query => 'R5R Staff', p_entity_type => 'shop', p_limit => 50);
-- EXPECT 0
reset role;

\echo '=========================================================='
\echo '7. Hidden organizations and inactive locations stay hidden'
\echo '=========================================================='
set role anon;
select count(*) as must_be_zero
from public.search_public_professionals(p_query => 'R5R Hidden', p_limit => 50);
-- EXPECT 0 — marketplace_visible = false

select count(*) as must_also_be_zero
from public.search_public_professionals(p_query => 'R5R Inactive', p_limit => 50);
-- EXPECT 0 — its only location is is_active = false
reset role;

\echo '=========================================================='
\echo '8. anon still reads NOTHING from organizations directly'
\echo '=========================================================='
set role anon;
select count(*) as organizations_readable_by_anon from public.organizations;
-- EXPECT 0. The classification is reachable only through the RPC, and only for
-- rows the RPC was already willing to return. RLS is unchanged.
reset role;

\echo '=========================================================='
\echo '9. The 14-argument input contract is unchanged'
\echo '=========================================================='
set role anon;
-- Full positional call, in the historical order.
select count(*) as positional_14
from public.search_public_professionals(
  null, null, 'R5R', null, null, null, null, null, null, false, 'shop', 50, 0, 'recommended'
);

-- The 13-argument prefix still resolves, via p_sort's default.
select count(*) as positional_13
from public.search_public_professionals(
  null, null, 'R5R', null, null, null, null, null, null, false, 'shop', 50, 0
);

-- And the named form every frontend caller uses.
select count(*) as named
from public.search_public_professionals(
  p_country => null, p_city => null, p_query => 'R5R', p_service_query => null,
  p_latitude => null, p_longitude => null, p_radius_km => null,
  p_min_price_cents => null, p_max_price_cents => null, p_open_now_only => false,
  p_entity_type => 'shop', p_limit => 50, p_offset => 0, p_sort => 'recommended'
);
-- EXPECT all three equal 7 (solo, shop, hair, mixed, and the group's three).
reset role;

\echo '=========================================================='
\echo '10. Existing result semantics are unchanged'
\echo '=========================================================='
set role anon;
select
  count(*) as rows_returned,
  count(distinct total_count) as distinct_total_counts,
  max(total_count) as total_count,
  count(distance_km) as non_null_distance,
  count(is_open_now) as non_null_open_now,
  sum(queue_waiting_count) as queue_sum,
  count(starting_price_cents) as non_null_price
from public.search_public_professionals(p_query => 'R5R', p_entity_type => 'shop', p_limit => 50);
-- EXPECT rows_returned = 7; distinct_total_counts = 1 and total_count = 7 (the
-- window count still describes the whole filtered set); non_null_distance = 0
-- (no coordinates supplied, so no distance is invented); non_null_open_now = 0
-- (no location_hours seeded, so open state stays UNKNOWN rather than false);
-- queue_sum = 0; non_null_price = 0 (no services seeded).

-- The column list itself, so an accidental reorder or drop is visible.
select string_agg(a.attname, ', ' order by a.attnum) as returned_columns
from pg_proc p
join lateral unnest(p.proallargtypes, p.proargmodes, p.proargnames)
     with ordinality as a(atttypid, attmode, attname, attnum) on true
where p.proname = 'search_public_professionals' and a.attmode = 't';
-- EXPECT the historical order, with business_type LAST:
--   entity_type, organization_id, organization_name, organization_slug,
--   barber_id, professional_id, barber_display_name, barber_avatar_url,
--   barber_title, location_id, location_name, address_line1, city, region,
--   postal_code, country, latitude, longitude, timezone, distance_km,
--   starting_price_cents, is_open_now, queue_waiting_count, total_count,
--   marketplace_supply_type
--
-- and NO `business_type`: the raw enum is deliberately not in the public
-- contract.
reset role;

\echo '=========================================================='
\echo '11. The public vocabulary is CLOSED, and every enum value is decided'
\echo '=========================================================='
set role anon;
select coalesce(marketplace_supply_type, '<null>') as value, count(*)
from public.search_public_professionals(p_query => 'R5R', p_limit => 50)
group by 1 order by 1;
-- EXPECT only 'barbershop' and 'independent'. Any other string, and a customer
-- client has been handed an internal concept.
reset role;

-- Every value the enum can hold must be named explicitly in the mapping. A
-- business type added later without a product decision fails HERE rather than
-- silently inheriting the commoner label.
select e.enumlabel,
       pg_get_functiondef(p.oid) like ('%' || e.enumlabel || '%') as is_classified
from pg_enum e
join pg_type t on t.oid = e.enumtypid and t.typname = 'business_type'
cross join pg_proc p
where p.proname = 'search_public_professionals'
order by e.enumsortorder;
-- EXPECT is_classified = t for all five. The mapping enumerates rather than
-- using a catch-all `else`, precisely so this check has teeth.

\echo '=========================================================='
\echo 'Cleanup: rollback — nothing was ever committed'
\echo '=========================================================='
rollback;

-- Proof that the rollback was total. Anything above would have had to commit to
-- appear here, and nothing did.
select count(*) as fixtures_remaining from public.organizations where slug like 'r5r1a-supply-%';
-- EXPECT 0
