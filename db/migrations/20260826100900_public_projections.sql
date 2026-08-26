-- FadeUp — R1B: the public data contract
--
-- There are ZERO anon RLS policies in this database and R1B adds none. Every
-- anonymous read goes through a curated SECURITY DEFINER projection that names
-- its columns explicitly, which is the difference between a data contract and
-- a table that happens to be readable.
--
-- TWO PROJECTIONS, NOT ONE WITH A FLAG
--
-- The tempting design is one function returning a claimed/unclaimed boolean
-- and NULLing the operational columns for unclaimed rows. It is rejected, and
-- the reason is failure mode rather than taste: with one shape, adding a
-- column later — a wait time, an "available today", a client count — silently
-- adds it to the UNCLAIMED contract too, and the only thing standing between a
-- Worker-discovered barbershop and a fabricated wait time is whoever writes
-- that migration remembering to special-case it.
--
-- With two shapes the unclaimed projection PHYSICALLY CANNOT carry
-- bookability, queue state or counts, because those columns are not in its
-- RETURNS TABLE. Constitution §5.5 asks for this to be "structurally difficult
-- to violate, not merely discouraged".
--
-- WHAT NEITHER PROJECTION EXPOSES, FOR ANYONE
--
--   who has a future appointment        Constitution §4.3
--   who is currently in the queue       §4.3
--   live customer presence              §4.3
--   private visit timestamps            §4.3
--   any customer's contact details      §4.3
--   verified-client counts              TARGET_DOMAIN_MODEL §6.2 — withdrawn
--   acquisition provenance              professionals.source is not granted to
--                                       any client and is not selected here
--   claim workflow state                a claim queue is an abuse surface
--
-- A follow is not permission to name someone publicly as a client. The follow
-- COUNT below is an aggregate over the professional; no follower is ever
-- identified, and the relationship aggregate is not read by this file at all.
--
-- UNCLAIMED PUBLICATION IS OFF, AND IT IS OFF IN THE SCHEMA
--
-- professionals carries
--   check (not is_public or (claim_state = 'claimed' and ...))
-- so an unclaimed identity cannot be is_public at all. The unclaimed
-- projection below is therefore correct AND currently returns zero rows for
-- every input. That is deliberate: R10 turns publication on by removing that
-- one clause, having already had this contract reviewed, rather than by
-- writing a projection under launch pressure.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Follower count — computed, capped, never materialized
--
-- TARGET_DOMAIN_MODEL §1 classifies counts as derived rather than stored, and
-- for a single indexed count that is the cheaper AND the more correct choice:
-- nothing can drift from the canonical edges because nothing is duplicating
-- them.
--
-- Capped by a LIMIT inside the subquery, so the cost is bounded no matter how
-- popular a professional becomes. A profile showing "10000+" is the intended
-- product behaviour, not a rounding artefact.
-- ---------------------------------------------------------------------------

create or replace function private.professional_follower_count(p_professional_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from (
    select 1
    from public.professional_follows f
    where f.professional_id = p_professional_id
      and f.state = 'following'
    limit 10000
  ) capped;
$$;

comment on function private.professional_follower_count(uuid) is
  'Follower count computed from the canonical edges, never materialized — so it cannot drift from them. Capped at 10000 by a LIMIT inside the subquery so a very popular profile costs the same as any other. Counts only state=''following'', so an explicit unfollow removes the follower immediately.';

revoke execute on function private.professional_follower_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The CLAIMED projection
--
-- A real professional who controls their own identity and has chosen to be
-- public. Still curated: this returns presentational identity plus one
-- aggregate, and nothing operational. Bookability continues to live where it
-- always has — get_public_barber, list_public_barbers,
-- get_public_available_slots — which are anchored on a barbers row and an
-- organization, and which R1B does not touch.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.id = p_professional_id
    and p.claim_state = 'claimed'
    and p.is_public;
$$;

comment on function public.get_public_professional(uuid) is
  'Anon-callable. The public contract for a CLAIMED professional who has opted in. Returns presentational identity and a capped follower count — no availability, no queue, no wait time, no schedule, no appointment or client data, no acquisition provenance, no claim state. Returns zero rows (never an error) for an identity that is unclaimed, not public, or absent: a non-public professional must be indistinguishable from one that does not exist.';

revoke execute on function public.get_public_professional(uuid) from public;
grant execute on function public.get_public_professional(uuid) to anon, authenticated;

create or replace function public.get_public_professional_by_handle(p_handle text)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.handle is not null
    and lower(p.handle) = lower(btrim(coalesce(p_handle, '')))
    and p.claim_state = 'claimed'
    and p.is_public;
$$;

comment on function public.get_public_professional_by_handle(text) is
  'Anon-callable handle lookup, same contract and same shape as get_public_professional. The shop-independent public address the marketplace has never had — /s/:slug/barbers/:barberId keeps working unchanged and R6/R7 adds the handle route alongside it.';

revoke execute on function public.get_public_professional_by_handle(text) from public;
grant execute on function public.get_public_professional_by_handle(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The UNCLAIMED projection
--
-- A DIFFERENT SHAPE, and that is the entire safety mechanism.
--
--   no follower_count      an external profile has no FadeUp followers, and
--                          showing a zero would still imply a FadeUp presence
--   no location            no bookability, so no "where can I book"
--   no operational field   there is no column to leak
--   is_claimed literal     always false, so a consumer cannot render this as a
--                          claimed profile by forgetting to check
--
-- Returns zero rows today for every input, because the publication CHECK makes
-- is_public impossible while unclaimed. Shipping the contract now and the
-- launch later is the point.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_external_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  is_claimed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         false
  from public.professionals p
  where p.id = p_professional_id
    and p.claim_state = 'unclaimed'
    and p.is_public;
$$;

comment on function public.get_public_external_professional(uuid) is
  'Anon-callable. The public contract for an UNCLAIMED, externally discovered professional. A DELIBERATELY DIFFERENT SHAPE from get_public_professional: it has no follower_count, no location and no operational column, so it cannot leak or fabricate FadeUp state even by accident. is_claimed is a literal false so no consumer can mistake it for a claimed profile. Returns zero rows for every input in R1B — the publication CHECK on professionals forbids is_public while unclaimed, and R10 removes that clause deliberately.';

revoke execute on function public.get_public_external_professional(uuid) from public;
grant execute on function public.get_public_external_professional(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The customer's own follow list
--
-- Without this the follow graph is write-only for the person who owns it: RLS
-- lets a customer read their own EDGES, but professionals_select does not let
-- them read a professional they merely follow, so they would get a list of
-- UUIDs. This resolves each edge through the same curated claimed shape.
--
-- Authenticated-only and scoped to auth.uid() inside the function — a caller
-- cannot pass someone else's id, because there is no parameter to pass.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_followed_professionals()
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  avatar_url text,
  followed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.avatar_url, f.followed_at
  from public.professional_follows f
  join public.professionals p on p.id = f.professional_id
  where f.follower_user_id = (select auth.uid())
    and f.state = 'following'
  order by f.followed_at desc;
$$;

comment on function public.list_my_followed_professionals() is
  'Authenticated-only. The caller''s own follow list, resolved to identities. Takes NO parameter, so there is nothing to forge — the follower is always auth.uid(). Deliberately does not filter on is_public: a customer who followed a professional keeps seeing them if the professional later goes private, which is their own relationship rather than a public listing.';

revoke execute on function public.list_my_followed_professionals() from public, anon;
grant execute on function public.list_my_followed_professionals() to authenticated;
