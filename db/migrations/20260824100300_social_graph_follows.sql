-- FadeUp — R1: the social graph
-- Migration: professional_follows + follow/unfollow RPCs + auto-follow
--
-- FOLLOW IS NOT FAVOURITE, AND FOLLOW IS NOT VERIFIED CLIENT.
--
-- customer_favorites (20260813130000) already exists and is KEPT: it is a
-- private, owner-only bookmark with no public projection. A follow is a
-- public social edge with intent history. Different concepts, both real,
-- neither replaces the other.
--
-- Follower and Verified Client are separate relationships with separate
-- sources of truth and must never be derived from one another. A follow is
-- created by intent; a verified client is created by completed service (see
-- 20260824100400). Nothing in this file reads or writes relationships, and
-- nothing in that file reads or writes follows.
--
-- ONE ROW PER EDGE, MUTATED IN PLACE
--
-- The unique (follower_user_id, professional_id) constraint is what makes
-- Follow idempotent and race-safe: every write is
-- `insert ... on conflict ... do update`, never select-then-insert. Two
-- concurrent Follow requests serialise on one row lock and produce one edge.
--
-- EXPLICIT UNFOLLOW IS STICKY
--
-- has_explicit_unfollow is the intent flag that makes an Unfollow mean
-- something. Once the customer deliberately unfollows, auto-follow must never
-- silently re-follow them on their next booking. Only a deliberate manual
-- Follow clears it.
--
--   manual follow    -> following  / manual / has_explicit_unfollow = false
--   manual unfollow  -> unfollowed / manual / has_explicit_unfollow = TRUE
--   auto, no row     -> following  / auto   / false
--   auto, flag set   -> NOTHING HAPPENS
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professional_follows
-- ---------------------------------------------------------------------------

create table if not exists public.professional_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references auth.users (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,

  state text not null default 'following',
  source text not null default 'manual',

  -- Sticky. Set by a manual unfollow, cleared only by a manual follow.
  has_explicit_unfollow boolean not null default false,

  followed_at timestamptz,
  unfollowed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_follows_unique unique (follower_user_id, professional_id),
  constraint professional_follows_state_valid check (state in ('following', 'unfollowed')),
  constraint professional_follows_source_valid check (source in ('manual', 'auto')),

  -- No legal action produces this combination. Encoding it means the §17
  -- invariant is protected by the database rather than by every write path
  -- remembering the rule.
  constraint professional_follows_intent_consistent
    check (not (state = 'following' and has_explicit_unfollow))
);

comment on table public.professional_follows is
  'The social graph edge: one row per (customer account, professional), mutated in place. state is the current edge; has_explicit_unfollow is durable intent that survives it. Never derived from bookings, and never used to derive verified-client status.';

comment on column public.professional_follows.has_explicit_unfollow is
  'TRUE once the customer has deliberately unfollowed. Suppresses auto-follow permanently until they deliberately follow again. Not client-writable — a PATCH setting this false would erase the opt-out.';

-- Follower count: partial index so the count touches only live edges.
create index if not exists professional_follows_professional_following_idx
  on public.professional_follows (professional_id) where state = 'following';

-- "Professionals I follow", newest first. follower_user_id leads, which is
-- also the RLS predicate column, so the policy is index-friendly.
create index if not exists professional_follows_follower_recent_idx
  on public.professional_follows (follower_user_id, followed_at desc) where state = 'following';

-- NOTE: no bare (follower_user_id) index — it is a strict prefix of
-- professional_follows_unique and would be redundant.

drop trigger if exists professional_follows_set_updated_at on public.professional_follows;
create trigger professional_follows_set_updated_at
  before update on public.professional_follows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — read your own edges, write nothing directly
--
-- There is deliberately NO INSERT, UPDATE or DELETE policy. All mutation goes
-- through the SECURITY DEFINER functions below, which own the state machine.
-- A client able to write this table directly could set state/source/
-- has_explicit_unfollow into combinations the state machine never produces.
--
-- Follower COUNTS are public, via the projection RPC. The follower LIST is
-- not exposed in R1.
-- ---------------------------------------------------------------------------

alter table public.professional_follows enable row level security;
alter table public.professional_follows force row level security;

drop policy if exists professional_follows_select on public.professional_follows;
create policy professional_follows_select
  on public.professional_follows
  for select
  to authenticated
  using (
    follower_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- Belt and braces alongside "no write policy": RLS already denies these, this
-- makes the intent explicit and survives someone adding a policy carelessly.
revoke insert, update, delete on public.professional_follows from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. follow_professional / unfollow_professional
-- ---------------------------------------------------------------------------

create or replace function public.follow_professional(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'follow_professional requires an authenticated session';
  end if;

  if not exists (select 1 from public.professionals where id = p_professional_id) then
    raise exception 'professional not found';
  end if;

  -- Idempotent by constraint, not by prior SELECT. A deliberate follow also
  -- clears the sticky unfollow — the customer has opted back in.
  insert into public.professional_follows (
    follower_user_id, professional_id, state, source, has_explicit_unfollow, followed_at
  )
  values (v_user_id, p_professional_id, 'following', 'manual', false, now())
  on conflict (follower_user_id, professional_id) do update
  set state = 'following',
      source = 'manual',
      has_explicit_unfollow = false,
      followed_at = coalesce(public.professional_follows.followed_at, now()),
      unfollowed_at = null;
end;
$$;

comment on function public.follow_professional(uuid) is
  'Authenticated-only. Idempotent manual Follow — repeated calls produce one edge. Clears any previous explicit-unfollow intent, since the customer has deliberately opted back in.';

revoke execute on function public.follow_professional(uuid) from public, anon;
grant execute on function public.follow_professional(uuid) to authenticated;

create or replace function public.unfollow_professional(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'unfollow_professional requires an authenticated session';
  end if;

  -- Recorded even if no edge exists: "I do not want to follow this person"
  -- is meaningful intent on its own, and it is what stops a later booking
  -- from auto-following them.
  insert into public.professional_follows (
    follower_user_id, professional_id, state, source, has_explicit_unfollow, unfollowed_at
  )
  values (v_user_id, p_professional_id, 'unfollowed', 'manual', true, now())
  on conflict (follower_user_id, professional_id) do update
  set state = 'unfollowed',
      source = 'manual',
      has_explicit_unfollow = true,
      unfollowed_at = now();
end;
$$;

comment on function public.unfollow_professional(uuid) is
  'Authenticated-only. Idempotent manual Unfollow. Records durable intent (has_explicit_unfollow) so a later eligible booking cannot silently re-follow the professional.';

revoke execute on function public.unfollow_professional(uuid) from public, anon;
grant execute on function public.unfollow_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. try_auto_follow
--
-- Never overrides intent. If any row already exists — following, or
-- unfollowed with the sticky flag — this does nothing at all.
-- ---------------------------------------------------------------------------

create or replace function private.try_auto_follow(p_user_id uuid, p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_professional_id is null then
    return;
  end if;

  -- do nothing (not do update): an existing edge always wins, whatever its
  -- state. This single clause is what makes an explicit Unfollow permanent.
  insert into public.professional_follows (
    follower_user_id, professional_id, state, source, has_explicit_unfollow, followed_at
  )
  values (p_user_id, p_professional_id, 'following', 'auto', false, now())
  on conflict (follower_user_id, professional_id) do nothing;
end;
$$;

comment on function private.try_auto_follow(uuid, uuid) is
  'Best-effort, idempotent auto-follow. ON CONFLICT DO NOTHING, so it never overrides an existing edge — an explicitly unfollowed professional is never re-followed, and a retried booking never creates a duplicate.';

-- ---------------------------------------------------------------------------
-- 5. Auto-follow on a confirmed booking
--
-- FIRES ON INSERT OR UPDATE, and that is essential rather than defensive:
-- book_public_appointment inserts rows ALREADY status='confirmed', and
-- appointments.status itself defaults to 'confirmed'. An UPDATE-only trigger
-- would be dead code on the primary booking path.
--
-- ATTRIBUTION: booked_by_user_id only — see 20260824100200 for why
-- customer_id must never be trusted for this. The customers row is
-- additionally required to belong to that same account, so a future code
-- path that stamps booked_by_user_id without resolving the customer properly
-- loses a follow (harmless) rather than forging one.
--
-- SECURITY DEFINER is required, not stylistic: appointments can be updated by
-- a plain PostgREST PATCH as role `authenticated`, which has no write access
-- to professional_follows and is subject to FORCE RLS. An invoker-rights
-- trigger would raise 42501 and abort the booking.
--
-- FAILURE CONTAINMENT, STATED ACCURATELY.
--
-- Early returns cover the expected misses. The exception block covers
-- ordinary errors — unique and FK violations, deadlock, serialization
-- failure, an FK racing a user deletion — so a dropped auto-follow is a lost
-- side-effect rather than a rolled-back booking.
--
-- It does NOT cover everything, and the difference matters: PL/pgSQL's
-- OTHERS deliberately does not match QUERY_CANCELED or ASSERT_FAILURE. A
-- statement_timeout (Supabase sets one per role) therefore still aborts the
-- statement, and with it the booking. That is the correct behaviour — a
-- trigger must not swallow a cancellation the server or the client asked for
-- — but it means "this can never break a booking" would be an overclaim. The
-- honest statement is: this cannot break a booking through any error it is
-- allowed to catch, and the work it does is two index probes and one upsert.
--
-- Auto-follow is explicitly best-effort and lossy. Unlike relationships it is
-- NOT reconstructible, because reconciliation could not distinguish "never
-- followed" from "explicitly unfollowed".
-- ---------------------------------------------------------------------------

create or replace function public.appointments_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.booked_by_user_id is null or new.barber_id is null then
    return new;
  end if;

  -- The account that acted must also own the CRM row this booking landed on.
  if new.customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.user_id = new.booked_by_user_id
  ) then
    return new;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = new.barber_id;

  if v_professional_id is null then
    return new;
  end if;

  perform private.try_auto_follow(new.booked_by_user_id, v_professional_id);
  return new;

exception when others then
  raise warning 'appointments_auto_follow suppressed error for appointment %: %', new.id, sqlerrm;
  return new;
end;
$$;

comment on function public.appointments_auto_follow() is
  'AFTER INSERT OR UPDATE on appointments: on reaching status=confirmed, auto-follows the professional on behalf of the account that ITSELF made the booking. Attributes only via booked_by_user_id, never via caller-typed contact details. Best-effort — never raises, so it cannot break a booking.';

-- Named appointments_social_* so it sorts AFTER the existing operational
-- trigger appointments_notify_new ('s' > 'n'). Deliberate, not incidental.
drop trigger if exists appointments_social_auto_follow on public.appointments;
create trigger appointments_social_auto_follow
  after insert or update on public.appointments
  for each row execute function public.appointments_auto_follow();
