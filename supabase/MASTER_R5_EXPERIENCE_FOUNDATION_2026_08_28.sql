-- ============================================================================
-- FadeUp — MASTER: R5, Design System & Experience Foundation
-- Generated 2026-08-28. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r5.sh
-- Verify in sync:   scripts/generate-master-r5.sh --check
--
-- WHAT THIS IS
--
--   Two read-shaped changes. Neither adds a product concept.
--
--   1. THE MARKETPLACE SEARCH GAINS COORDINATES, A TIMEZONE AND A SORT.
--      search_public_professionals already ACCEPTED a latitude and longitude
--      and computed distance_km from them, and returned neither — so a map
--      fed from a result set had nothing to plot. It also carried `timezone`
--      internally (the open-now and queue-window subqueries both depend on it)
--      and dropped it at the final SELECT, so every card that wanted to print
--      a time in the shop's own hours needed a second round trip first.
--
--      A trailing `p_sort text default 'recommended'` is added. Sorting has to
--      happen server-side because the function is paged: "cheapest first" over
--      a distance-ordered page of twenty-four is the cheapest of the nearest,
--      which is a different and misleading answer.
--
--   2. THE PRO DASHBOARD LAYOUT BECOMES A SHOP-OWNED ROW.
--      organization_dashboard_layouts, keyed on organization_id ALONE. Read by
--      any member of the shop, written by owner/manager through RLS.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. NO NEW ROW BECOMES PUBLIC.
--      Exposing latitude and longitude discloses nothing that was not already
--      disclosed: every row this function returns already carried
--      address_line1, city, postal_code and country for an ACTIVE location of
--      a MARKETPLACE_VISIBLE organization. A shop that published its street
--      address has published where it is. Every WHERE clause is carried
--      forward unchanged, and VERIFY R5.9 proves it by flipping
--      marketplace_visible off and asserting the shop disappears.
--
--   B. EXISTING CALLERS KEEP WORKING — BUT POSTGREST MUST BE TOLD.
--      p_sort is trailing and defaulted, so a 13-argument call still resolves
--      and still gets the pre-R5 ordering. PostgREST, however, caches the
--      schema: until it is reloaded it will keep advertising the old signature
--      and reject the new named argument. The reload is at the bottom of this
--      file and is NOT optional. Wave 1 learned this the same way.
--
--   C. `recommended` IS NOT A SCORE.
--      It is the existing ordering, byte for byte — rows with a distance
--      first, then by distance, then alphabetically — and it is also the
--      fallback for any value this function does not recognise, so a stale
--      client asking for a sort that does not exist gets results rather than
--      an error. Ranking belongs to a later backend lot.
--
--   D. NOTHING IS BACKFILLED AND NO SHOP GETS A LAYOUT.
--      organization_dashboard_layouts starts empty. A shop with no row sees
--      the product default; a row appears only when an owner or manager
--      rearranges something.
--
--   E. ONE `private.` FUNCTION IS GRANTED TO `authenticated`, ON PURPOSE.
--      A CHECK constraint that calls a function is evaluated as the WRITING
--      role, not as the table owner. Revoking valid_dashboard_module_keys from
--      authenticated — the house style for everything in private — does not
--      harden the constraint, it makes every INSERT by a real user fail with
--      "permission denied for function". It reads no table and takes no
--      session state.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No change to any RLS policy on any existing table. No new grant to anon.
--   No change to the R4 publication gate, service mode, entitlements, or the
--   analytics event engine. No column removed from any contract. No product
--   data written, updated or deleted.
--
-- SAFETY
--   * Runs inside a single transaction.
--   * Creates one table, removes no table, removes no column, truncates nothing.
--   * Contains no DELETE and no UPDATE of any kind.
--   * Adds no anon grant beyond the EXECUTE the search function already had.
--   * Every object it touches on live is owned by `postgres`, so it applies as
--     postgres — checked before deploying, because R4.1's first attempt failed
--     on ownership of an object a clean replay had never seen.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql
--
--   Then run, and confirm no FAILED assertion in each:
--     supabase/VERIFY_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql
--     supabase/VERIFY_CUSTOMER_API_FREEZE_2026_08_27.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260828120000_marketplace_map_and_sort.sql
-- ============================================================================


-- ============================================================================
-- FadeUp R5 — the marketplace read contract the map and the sort control need
--
-- R5 builds a list/map marketplace with explicit sort options. Two things stood
-- in the way, and both are read-projection gaps rather than model gaps:
--
--   1. NO COORDINATES. `search_public_professionals` ACCEPTS a latitude and a
--      longitude and computes `distance_km` from them, but returns neither, so
--      a result set cannot be plotted. A map fed by a second per-result lookup
--      would be N+1 requests to render one screen.
--
--   2. NO TIMEZONE. The projection carries `timezone` internally — the
--      open-now and queue-window subqueries both depend on it — and drops it
--      at the final SELECT. R5's availability label ("From 17:30") must format
--      in the SHOP's zone, and without it every card would need a separate
--      `list_public_locations` call before it could print a time.
--
-- WHY EXPOSING COORDINATES DISCLOSES NOTHING NEW
--
-- Every row this function returns already carries `address_line1`, `city`,
-- `postal_code` and `country` for an ACTIVE location of a `marketplace_visible`
-- organization. A shop that has opted into a public marketplace and published
-- its street address has published where it is; the latitude and longitude are
-- that same fact in a machine-readable form. No row becomes visible that was
-- not visible before, and the WHERE clauses are untouched.
--
-- WHY SORT IS A PARAMETER AND NOT A CLIENT-SIDE ORDERING
--
-- The function is paged (`p_limit`/`p_offset`). Sorting a page in the browser
-- sorts the wrong twenty-four rows: "cheapest first" over the first page of a
-- distance-ordered result is not the cheapest, it is the cheapest of the
-- nearest. Ordering has to happen where the whole set is.
--
-- WHAT `recommended` MEANS TODAY, SAID PLAINLY
--
-- `recommended` is the EXISTING ordering, unchanged: rows with a distance
-- first, then by distance, then alphabetically. It is not a score, there is no
-- model behind it, and R5 deliberately does not invent one — §12 assigns
-- ranking to a later backend lot. Shipping the parameter now means that lot
-- changes one CASE arm instead of changing every caller.
--
-- The sort options this migration does NOT provide are as deliberate:
--
--   available_soonest   availability is a function of (location, professional,
--                       SERVICE, date). This query has no service, so it
--                       cannot answer the question for a shop at all.
--   rating              there is no reviews table in this schema.
--
-- Neither is stubbed. An option that silently falls back to `recommended`
-- would let the UI offer a sort that does nothing, which is worse than not
-- offering it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

set lock_timeout = '5s';

-- The old 13-argument signature must go before the 14-argument one can be
-- created: Postgres would otherwise keep both, and a 13-argument call would
-- become ambiguous the moment the new one's trailing DEFAULT applies.
drop function if exists public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer
);

create function public.search_public_professionals(
  p_country text default null,
  p_city text default null,
  p_query text default null,
  p_service_query text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_km double precision default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_open_now_only boolean default false,
  p_entity_type text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  -- Trailing, with a default, so every existing 13-argument call site keeps
  -- working and keeps its current ordering.
  p_sort text default 'recommended'
)
returns table (
  entity_type text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  barber_id uuid,
  professional_id uuid,
  barber_display_name text,
  barber_avatar_url text,
  barber_title text,
  location_id uuid,
  location_name text,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  timezone text,
  distance_km double precision,
  starting_price_cents integer,
  is_open_now boolean,
  queue_waiting_count integer,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with shop_base as (
    select
      'shop'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      null::uuid as barber_id,
      null::uuid as professional_id,
      null::text as barber_display_name,
      null::text as barber_avatar_url,
      null::text as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
    from public.organizations o
    join public.locations l on l.organization_id = o.id
    where o.marketplace_visible
      and l.is_active
      and (p_entity_type is null or p_entity_type = 'shop')
      and (p_country is null or l.country = p_country)
      and (
        p_city is null or p_city = '' or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city) or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city || '%')
      )
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.service_locations sl on sl.service_id = s.id and sl.location_id = l.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  barber_base as (
    select
      'barber'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      b.id as barber_id,
      case when p.claim_state = 'claimed' then p.id else null end as professional_id,
      sp.display_name as barber_display_name,
      sp.avatar_url as barber_avatar_url,
      sp.title as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
    from public.barbers b
    left join public.professionals p on p.id = b.professional_id
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.organizations o on o.id = b.organization_id
    join public.locations l on l.id = sp.location_id
    where o.marketplace_visible
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and l.is_active
      and (p_entity_type is null or p_entity_type = 'barber')
      and (p_country is null or l.country = p_country)
      and (
        p_city is null or p_city = '' or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city) or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city || '%')
      )
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(sp.display_name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.barber_services bs on bs.service_id = s.id and bs.barber_id = b.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  combined as (
    select * from shop_base
    union all
    select * from barber_base
  ),
  priced as (
    select
      c.*,
      (
        select min(s.price_cents)
        from public.services s
        where s.organization_id = c.organization_id and s.is_active
          and (
            (c.entity_type = 'shop' and exists (
              select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = c.location_id
            ))
            or
            (c.entity_type = 'barber' and exists (
              select 1 from public.barber_services bs where bs.service_id = s.id and bs.barber_id = c.barber_id
            ))
          )
      ) as starting_price_cents,
      (
        select not lh.is_closed
          and (now() at time zone c.timezone)::time between lh.open_time and lh.close_time
        from public.location_hours lh
        where lh.location_id = c.location_id
          and lh.day_of_week = extract(dow from (now() at time zone c.timezone))::smallint
      ) as is_open_now,
      (
        -- Two corrections over the original Wave 1 definition (see
        -- 20260813160000_claim_scope_fix.sql for the reasoning):
        --   1. Bounded to TODAY in the location's own timezone. Nothing in
        --      this schema ever expires a 'waiting' queue_entries row, so an
        --      unbounded count happily advertises a queue from last week as
        --      a live wait.
        --   2. A barber row counts only entries actually assigned to that
        --      barber. Counting unassigned (barber_id is null) entries
        --      towards every barber told each of them the shop-wide number
        --      as if it were their own line.
        select count(*)::integer
        from public.queue_entries qe
        where qe.location_id = c.location_id and qe.status = 'waiting'
          and qe.created_at >= (date_trunc('day', now() at time zone c.timezone) at time zone c.timezone)
          and (c.entity_type = 'shop' or qe.barber_id = c.barber_id)
      ) as queue_waiting_count
    from combined c
  ),
  filtered as (
    select *
    from priced
    where (p_radius_km is null or distance_km is null or distance_km <= p_radius_km)
      and (p_min_price_cents is null or starting_price_cents is null or starting_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or starting_price_cents is null or starting_price_cents <= p_max_price_cents)
      and (not p_open_now_only or is_open_now is true)
  )
  select
    f.entity_type,
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.barber_id,
    f.professional_id,
    f.barber_display_name,
    f.barber_avatar_url,
    f.barber_title,
    f.location_id,
    f.location_name,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.latitude,
    f.longitude,
    f.timezone,
    f.distance_km,
    f.starting_price_cents,
    f.is_open_now,
    f.queue_waiting_count,
    count(*) over () as total_count
  from filtered f
  order by
    -- NEAREST. A row with no distance (no coordinates, or the customer gave
    -- no position) sorts last rather than first: `nulls last` on the value
    -- alone would still place unknown-distance rows ahead of a 40km one under
    -- a descending arm, and "nearest" must never lead with "unknown".
    case when p_sort = 'nearest' then (f.distance_km is null) end asc,
    case when p_sort = 'nearest' then f.distance_km end asc nulls last,

    -- PRICE, cheapest first. A shop with no published service has no starting
    -- price; it sorts after every priced one instead of reading as free.
    case when p_sort = 'price' then (f.starting_price_cents is null) end asc,
    case when p_sort = 'price' then f.starting_price_cents end asc nulls last,

    -- RECOMMENDED — and the fallback for any unrecognised value, so a stale
    -- client sending a sort this function has never heard of gets the default
    -- ordering rather than an error or an arbitrary one.
    (f.distance_km is not null) desc,
    f.distance_km asc nulls last,
    f.organization_name asc,
    coalesce(f.barber_display_name, '') asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$function$;

comment on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) is
  'Anon-callable marketplace search for shops and operational barber placements. barber_id remains the booking/roster identifier; professional_id is NULL for shops and for barbers without a currently claimed durable identity, and is the canonical key for Follow when present. R5 adds latitude/longitude/timezone to the projection — no new ROW becomes visible, these are the same publicly-listed locations whose street address the function already returned — and a p_sort parameter accepting recommended (default, the pre-R5 ordering), nearest and price. There is deliberately no available_soonest (availability needs a service, which this query has no notion of) and no rating (no reviews table exists); an unrecognised value falls back to recommended.';

revoke execute on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) from public;

grant execute on function public.search_public_professionals(
  text, text, text, text, double precision, double precision, double precision,
  integer, integer, boolean, text, integer, integer, text
) to anon, authenticated;



-- ============================================================================
-- END db/migrations/20260828120000_marketplace_map_and_sort.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260828120100_organization_dashboard_layout.sql
-- ============================================================================


-- ============================================================================
-- FadeUp R5 — the Pro dashboard layout, owned by the SHOP
--
-- §24: "Layout preference is COMMON TO THE SHOP. NOT personal per staff
-- member. If one authorized user changes the layout, authorized users of that
-- shop should see the saved new layout."
--
-- That sentence is the entire reason this is a table rather than localStorage.
-- A per-browser preference would satisfy "the dashboard can be rearranged" and
-- fail the requirement completely: the owner would arrange the shop's morning
-- view on the desk machine and the manager would see the default on the tablet
-- by the chairs.
--
-- WHY THE ROW IS KEYED ON THE ORGANIZATION AND NOTHING ELSE
--
-- One layout per shop, enforced by the primary key. There is no user column in
-- the key, so there is no shape in which a per-member layout can exist by
-- accident — the requirement is expressed by the schema, not by a convention
-- the next lot has to remember.
--
-- `updated_by` is recorded but is NOT part of the key. It answers "who last
-- rearranged this" for an owner who finds the dashboard changed, which is a
-- real support question; it never scopes a read.
--
-- ============================================================================
-- WHY THE MODULE VOCABULARY IS NOT AN ENUM
-- ============================================================================
--
-- The obvious modelling is an enum of module names with a CHECK. It would make
-- every new dashboard card a migration, which is the wrong coupling: a card is
-- a presentational unit that lives entirely in the frontend, and a schema
-- change to add one would guarantee that the schema and the UI drift the first
-- time somebody ships a card without one.
--
-- So the constraints are SHAPE constraints — bounded length, a conservative
-- key pattern, no duplicates — and the client ignores any key it does not
-- recognise. An obsolete key left behind by a removed card is inert rather
-- than a broken dashboard, and a card added by the frontend works immediately.
--
-- The keys are also not secrets and not tenant data: they are the names of UI
-- panels. The tenant fact here is the ORDER a particular shop chose.
--
-- ============================================================================
-- WHY WRITE AUTHORIZATION IS RLS AND NOT AN RPC
-- ============================================================================
--
-- §40: "Dashboard layout writes must respect organization authorization."
-- The check is exactly "is the caller an owner or manager of this org", which
-- `private.has_org_role` already answers and which the rest of this schema
-- already expresses as a policy. An RPC would add a second place where that
-- question is answered, and a second place is where the answers diverge.
--
-- A `barber` or `receptionist` can therefore READ the shop layout — they have
-- to, it is the dashboard they are looking at — and cannot change it. The
-- write policies name the two roles that own shop configuration everywhere
-- else in FadeUp.
--
-- Idempotent: safe to re-run.
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The shape predicate.
--
-- A function rather than an inline CHECK because both halves of the rule need
-- to look at the array as a SET — "every element matches this pattern" and
-- "no element repeats" — and a CHECK constraint may not contain a subquery.
-- Marked IMMUTABLE, which it is: it reads nothing but its argument.
-- ----------------------------------------------------------------------------
create or replace function private.valid_dashboard_module_keys(p_keys text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_keys is not null
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as key)
    and not exists (
      select 1
      from unnest(p_keys) as key
      where key is null or key !~ '^[a-z][a-z0-9_]{0,39}$'
    );
$$;

comment on function private.valid_dashboard_module_keys(text[]) is
  'CHECK predicate for organization_dashboard_layouts.module_order: every key is a conservative lowercase identifier and no key repeats. Deliberately NOT a vocabulary — dashboard modules are presentational and adding one must not require a migration.';

revoke execute on function private.valid_dashboard_module_keys(text[]) from public, anon;

-- `authenticated` MUST keep EXECUTE, and this is the one place in FadeUp where
-- a `private.` function is granted to it.
--
-- A CHECK constraint that calls a function is evaluated as the WRITING role,
-- not as the table owner. Revoking this from `authenticated` — which is the
-- house style for everything in `private`, and was the first thing tried here
-- — does not harden the constraint, it makes every INSERT by a real user fail
-- with "permission denied for function valid_dashboard_module_keys". Found by
-- running the write as an owner through RLS rather than by reading the DDL.
--
-- Granting it discloses nothing: the function reads no table, takes no
-- session state, and is IMMUTABLE over its own argument. The caller can learn
-- exactly what the constraint would already have told them by failing.
grant execute on function private.valid_dashboard_module_keys(text[]) to authenticated;

create table if not exists public.organization_dashboard_layouts (
  -- The key IS the requirement. One layout per shop, no user dimension.
  organization_id uuid primary key
    references public.organizations (id)
    on delete cascade,

  -- Ordered list of module keys. Order is the whole payload; a module absent
  -- from the array is one this shop has hidden.
  module_order text[] not null,

  updated_at timestamptz not null default now(),

  -- Who last changed it. ON DELETE SET NULL: an erased account must not take
  -- the shop's dashboard with it.
  updated_by uuid
    references auth.users (id)
    on delete set null,

  -- Bounded so a client bug cannot store an unbounded array in a row every
  -- member of the shop reads on every dashboard load.
  constraint organization_dashboard_layouts_size
    check (array_length(module_order, 1) between 1 and 32),

  -- Conservative key shape, and no duplicates. Not a vocabulary — see the note
  -- above — but enough that the column can never hold prose, a URL, or an
  -- injection attempt dressed as a module name, and enough that a module
  -- cannot be listed twice and render twice.
  constraint organization_dashboard_layouts_keys_valid
    check (private.valid_dashboard_module_keys(module_order))
);

comment on table public.organization_dashboard_layouts is
  'The Pro dashboard module order, owned by the ORGANIZATION rather than by a member — R5 §24. Keyed on organization_id alone so a per-user layout cannot exist by accident. Readable by every member of the shop, writable only by owner/manager. Module keys are validated for shape, not against a vocabulary: dashboard cards are presentational and adding one must not require a migration, so an unrecognised key is inert rather than invalid.';

comment on column public.organization_dashboard_layouts.module_order is
  'Ordered module keys. Order is the payload; a module missing from the array is hidden for this shop. Unknown keys are ignored by the client.';

comment on column public.organization_dashboard_layouts.updated_by is
  'Who last rearranged the shop dashboard. Recorded for support ("why did this move?"), never used to scope a read — the layout is the shop''s, not this person''s.';

drop trigger if exists organization_dashboard_layouts_set_updated_at
  on public.organization_dashboard_layouts;

create trigger organization_dashboard_layouts_set_updated_at
  before update on public.organization_dashboard_layouts
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- RLS / LEAST PRIVILEGE
-- ============================================================================

alter table public.organization_dashboard_layouts enable row level security;
alter table public.organization_dashboard_layouts force row level security;

drop policy if exists organization_dashboard_layouts_select
  on public.organization_dashboard_layouts;

-- Every member reads the shop's layout, because it is the dashboard they are
-- looking at. A platform admin does not: this is a UI preference, and support
-- access to it buys nothing that would justify widening the surface.
create policy organization_dashboard_layouts_select
  on public.organization_dashboard_layouts
  for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists organization_dashboard_layouts_insert
  on public.organization_dashboard_layouts;

create policy organization_dashboard_layouts_insert
  on public.organization_dashboard_layouts
  for insert
  to authenticated
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

drop policy if exists organization_dashboard_layouts_update
  on public.organization_dashboard_layouts;

-- USING and WITH CHECK both, and both naming the SAME organization: without
-- the WITH CHECK an authorized manager of shop A could UPDATE their own row's
-- organization_id to shop B and carry the row across the tenant boundary.
create policy organization_dashboard_layouts_update
  on public.organization_dashboard_layouts
  for update
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  )
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

drop policy if exists organization_dashboard_layouts_delete
  on public.organization_dashboard_layouts;

-- Deleting the row is how a shop returns to the product default, so it is the
-- same authority as changing it.
create policy organization_dashboard_layouts_delete
  on public.organization_dashboard_layouts
  for delete
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

revoke all
  on table public.organization_dashboard_layouts
  from public, anon, authenticated;

-- No column-level grant on organization_id for UPDATE: the tenant anchor is
-- not editable, so the only way to move a layout between shops is to delete
-- one row and insert another, both of which need authority in BOTH shops.
grant select, insert, delete on table public.organization_dashboard_layouts to authenticated;
grant update (module_order, updated_by) on table public.organization_dashboard_layouts to authenticated;



-- ============================================================================
-- END db/migrations/20260828120100_organization_dashboard_layout.sql
-- ============================================================================

commit;

-- ============================================================================
-- POSTGREST SCHEMA RELOAD — NOT OPTIONAL.
--
-- search_public_professionals changed BOTH its return shape and its argument
-- list. PostgREST answers from a cached schema, so until it reloads it keeps
-- advertising the 13-argument version and rejects the new named argument the
-- web client sends. The marketplace would go blank for every visitor while the
-- database itself was perfectly healthy.
--
-- Outside the transaction on purpose: NOTIFY inside a transaction is deferred
-- to commit, and if the commit fails there is nothing to reload anyway.
-- ============================================================================
notify pgrst, 'reload schema';

-- ============================================================================
-- Applied. Nothing was backfilled: organization_dashboard_layouts is empty and
-- every shop sees the product-default dashboard order until someone with
-- owner or manager role rearranges it.
-- ============================================================================
