-- FadeUp — R1: public projections
-- Migration: get_public_professional, list_public_professional_showcases,
--            get_public_customer_profile, get_my_follow_state
--
-- This is the ONLY anonymous surface R1 adds, and it follows the pattern
-- every existing public read in this codebase uses (get_public_barber,
-- search_public_professionals, get_shared_passport): narrowly-scoped
-- SECURITY DEFINER, set search_path = '', an EXPLICIT column list, every
-- eligibility rule re-derived server-side, revoke from public, grant to
-- anon + authenticated. No table in R1 has an anon RLS policy; there are
-- zero anon policies in this database and R1 keeps it that way.
--
-- WHY COUNTS ARE CAPPED
--
-- Follower count is the highest-QPS read a social product has, and an
-- unbounded COUNT over the follow edge is O(followers), not O(1) — at a
-- million followers that is a million index tuples per profile view. R1 also
-- mutates follow edges IN PLACE and `state` is the partial index's predicate
-- column, so every unfollow churns that index and defeats HOT updates,
-- meaning the "index-only" scan degrades under exactly the write load that
-- makes the count expensive.
--
-- Materialising a counter would add write-path contention and a drift-repair
-- obligation before there is any traffic to justify either. So R1 caps
-- instead: the subquery stops at 1001 rows, the cost is O(1001) at any scale,
-- there is no drift, and the UI renders "1000+" — which is what social
-- products display anyway. R6/R7 can introduce a real materialised counter
-- with real numbers; doing so is purely additive.
--
-- WHAT IS DELIBERATELY NOT RETURNED
--
-- prospect_id (a join key into the whole Worker sales estate, and a
-- disclosure that this tenant was scraped before signing up), user_id,
-- source, raw claim/verification internals, any appointment id, any date, any
-- customer UUID, any organization, any interaction count. The smallest
-- projection that supports "Already cutting X ✓".
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. get_public_professional
-- ---------------------------------------------------------------------------

create or replace function public.get_public_professional(p_professional_id uuid)
returns table (
  professional_id uuid,
  handle text,
  display_name text,
  headline text,
  bio text,
  avatar_url text,
  is_verified boolean,
  is_claimed boolean,
  follower_count integer,
  follower_count_capped boolean,
  verified_client_count integer,
  verified_client_count_capped boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    p.handle,
    p.display_name,
    p.headline,
    p.bio,
    p.avatar_url,
    p.verification_state = 'verified',
    -- "Claimed" is a real, checkable fact about who controls the identity.
    -- It says nothing about a subscription: an unclaimed profile is not a
    -- lapsed customer, and a claimed one is not a paying one.
    p.user_id is not null,
    fc.n,
    fc.n > 1000,
    vc.n,
    vc.n > 1000
  from public.professionals p
  cross join lateral (
    select count(*)::integer as n from (
      select 1 from public.professional_follows f
      where f.professional_id = p.id and f.state = 'following'
      limit 1001
    ) capped
  ) fc
  cross join lateral (
    select count(*)::integer as n from (
      -- Distinct customers across every shop this professional has worked at.
      -- The per-shop rows are the tenants' facts; this aggregate is the
      -- professional's.
      select distinct r.customer_user_id
      from public.customer_professional_relationships r
      where r.professional_id = p.id and r.completed_interaction_count >= 1
      limit 1001
    ) capped
  ) vc
  where p.id = p_professional_id
    and p.is_public;
$$;

comment on function public.get_public_professional(uuid) is
  'Anon-callable public projection of one professional. Zero rows if the professional is not public — never an error, so an unpublished profile is indistinguishable from a wrong id, matching get_public_barber. Counts are capped at 1001 with a *_capped flag so the caller can render "1000+". Never returns prospect_id, user_id or source.';

revoke execute on function public.get_public_professional(uuid) from public;
grant execute on function public.get_public_professional(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. list_public_professional_showcases
--
-- FOUR conditions gate every row, not three:
--
--   1. consent approved                — the customer said yes
--   2. the relationship is genuine     — enforced by the binding trigger and
--                                        re-checked here
--   3. the customer's profile is_public — a customer who is private by
--                                        default must not be rendered on a
--                                        public page merely because they once
--                                        approved a showcase
--   4. verification evaluated LIVE     — so a revoked badge disappears
--                                        immediately rather than persisting
--                                        in a cached boolean
-- ---------------------------------------------------------------------------

create or replace function public.list_public_professional_showcases(p_professional_id uuid)
returns table (
  display_name text,
  username text,
  avatar_url text,
  is_verified boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    cpp.display_name,
    cpp.username,
    cpp.avatar_url,
    cpp.verification_state = 'verified'
  from public.professional_client_showcases s
  join public.professionals p on p.id = s.professional_id
  join public.customer_public_profiles cpp on cpp.user_id = s.customer_user_id
  join public.customer_professional_relationships r on r.id = s.relationship_id
  where s.professional_id = p_professional_id
    and p.is_public
    and s.consent_state = 'approved'
    and cpp.is_public
    and r.completed_interaction_count >= 1
  order by cpp.display_name asc nulls last;
$$;

comment on function public.list_public_professional_showcases(uuid) is
  'Anon-callable. The public social-proof list for one professional ("Already cutting X"). Returns ONLY display name, username, avatar and a live verified flag — never an appointment id, a date, an interaction count, a customer UUID or an organization. Requires approved consent AND a public customer profile AND a genuine completed-service relationship.';

revoke execute on function public.list_public_professional_showcases(uuid) from public;
grant execute on function public.list_public_professional_showcases(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_public_customer_profile
--
-- Lookup by username, not by user id — a public profile is addressed by its
-- public handle, and the account UUID never appears in a public URL.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_customer_profile(p_username text)
returns table (
  username text,
  display_name text,
  avatar_url text,
  bio text,
  persona_category text,
  is_verified boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    cpp.username,
    cpp.display_name,
    cpp.avatar_url,
    cpp.bio,
    cpp.persona_category,
    cpp.verification_state = 'verified'
  from public.customer_public_profiles cpp
  where cpp.username is not null
    and lower(cpp.username) = lower(btrim(coalesce(p_username, '')))
    and cpp.is_public;
$$;

comment on function public.get_public_customer_profile(text) is
  'Anon-callable public projection of a customer identity, addressed by username. Returns zero rows unless the customer opted in with is_public. Never returns email, phone, user_id, booking or visit history, passport data, or anything from customer_profiles/customer_passports.';

revoke execute on function public.get_public_customer_profile(text) from public;
grant execute on function public.get_public_customer_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_my_follow_state — the customer's own view of one edge
-- ---------------------------------------------------------------------------

create or replace function public.get_my_follow_state(p_professional_id uuid)
returns table (
  is_following boolean,
  source text,
  has_explicit_unfollow boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    f.state = 'following',
    f.source,
    f.has_explicit_unfollow
  from public.professional_follows f
  where f.professional_id = p_professional_id
    and f.follower_user_id = (select auth.uid());
$$;

comment on function public.get_my_follow_state(uuid) is
  'Authenticated-only. The caller''s own follow edge for one professional. Zero rows means never followed — distinct from an explicit unfollow, which returns a row with has_explicit_unfollow true.';

revoke execute on function public.get_my_follow_state(uuid) from public, anon;
grant execute on function public.get_my_follow_state(uuid) to authenticated;
