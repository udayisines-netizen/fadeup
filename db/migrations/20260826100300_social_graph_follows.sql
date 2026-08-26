-- FadeUp — R1B: the follow graph
--
-- ONE ROW PER (follower, professional), MUTATED IN PLACE
--
-- Not an append-only log, not two tables, and not a derived count. The
-- relationship itself is canonical; counts are computed from it.
--
--   state          following | unfollowed    the current edge
--   source         manual | auto            how the CURRENT state arose
--   followed_at    when following began, NULL if it never did
--   unfollowed_at  set on unfollow — this IS the intent
--
-- WHY THERE IS NO STICKY has_explicit_unfollow FLAG
--
-- Because state='unfollowed' ALREADY IS explicit unfollow. Auto-follow can
-- only ever CREATE an edge — the trigger below is ON CONFLICT DO NOTHING, with
-- no DO UPDATE branch anywhere — so no automatic event can ever move a row out
-- of 'unfollowed'. A separate flag would carry exactly the same information and
-- add a second thing every write path has to remember.
--
-- That single ON CONFLICT DO NOTHING is the whole of Constitution §3.4:
--
--   customer explicitly unfollows
--          v
--   later genuine booking fires auto-follow
--          v
--   conflict on (follower_user_id, professional_id) -> DO NOTHING
--          v
--   the customer's decision stands
--
-- It is race-safe for the same reason: the unique index, not application
-- ordering, decides. An auto-follow racing a manual unfollow either loses the
-- insert (row already exists, nothing happens) or wins it and is then
-- overwritten by the unfollow's UPDATE. Neither interleaving can leave a
-- customer following someone they just unfollowed.
--
-- followed_at IS NULLABLE, and that matters
--
-- Unfollowing something you never followed creates a pure tombstone. Stamping
-- followed_at = now() on that row would record a follow that never happened,
-- in a column ANALYTICS_DRAFT §5 is going to read. NULL says "never followed".
--
-- WHY UNCLAIMED PROFESSIONALS CANNOT BE FOLLOWED
--
-- An unclaimed identity is a Worker-discovered external profile, or a roster
-- record whose account was erased. Letting either accrue followers would
-- manufacture social proof about a FadeUp presence that does not exist
-- (Constitution §5.5). Both write paths require claim_state='claimed', so an
-- unclaimed profile's follower count is structurally zero rather than
-- filtered-to-zero at render time.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'follow_state') then
    create type public.follow_state as enum ('following', 'unfollowed');
  end if;
  if not exists (select 1 from pg_type where typname = 'follow_source') then
    create type public.follow_source as enum ('manual', 'auto');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The edge
-- ---------------------------------------------------------------------------

create table if not exists public.professional_follows (
  id uuid primary key default gen_random_uuid(),

  -- The ACCOUNT, not a customers row. customers.user_id is a per-shop CRM
  -- bridge that R1A demoted from evidence precisely because it was squattable;
  -- a social edge must never rest on it.
  --
  -- ON DELETE CASCADE: a follow is the follower's own personal data, and it
  -- means nothing without them. Erasure removes it. This is the one place in
  -- R1B where cascade is right, because there is no business record here — the
  -- service history that must survive erasure lives on appointments.
  follower_user_id uuid not null references auth.users (id) on delete cascade,

  -- ON DELETE CASCADE: an edge pointing at an identity that no longer exists
  -- is not evidence of anything. In practice unreachable — professionals has
  -- no DELETE policy and no DELETE grant — but a default deletion behaviour is
  -- never accepted by accident here.
  professional_id uuid not null references public.professionals (id) on delete cascade,

  state public.follow_state not null default 'following',
  source public.follow_source not null default 'manual',

  followed_at timestamptz,
  unfollowed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Idempotency and race-safety in one line. Follow never has to
  -- select-then-insert.
  constraint professional_follows_unique unique (follower_user_id, professional_id),

  -- The timestamps cannot disagree with the state.
  constraint professional_follows_state_timestamps check (
    (state = 'following' and followed_at is not null and unfollowed_at is null)
    or (state = 'unfollowed' and unfollowed_at is not null)
  )
);

comment on table public.professional_follows is
  'Customer -> professional follow edge, one row per pair, mutated in place. state=''unfollowed'' IS explicit unfollow: auto-follow can only ever CREATE a row (ON CONFLICT DO NOTHING), never transition one, so no automatic event can reverse a customer''s deliberate decision. A follow is an expression of INTENT and is never evidence that a service happened — see customer_professional_relationships for that, and Constitution §3.2.';

comment on column public.professional_follows.followed_at is
  'When following began. NULL means it never did — the row is a pure unfollow tombstone. Never stamped speculatively.';

comment on column public.professional_follows.unfollowed_at is
  'The customer''s explicit decision to stop, and the timestamp of it. Preserved across repeat unfollows: the first refusal is the truthful one.';

comment on column public.professional_follows.source is
  'How the CURRENT state arose. A manual follow always overwrites this to ''manual'', because the customer''s own action is what the row now records.';

-- Follower count. Leading column is the count predicate.
create index if not exists professional_follows_professional_idx
  on public.professional_follows (professional_id) where state = 'following';

-- "who I follow", paginated. Leading column is the RLS predicate, so the
-- index and the policy agree. A bare (follower_user_id) index is deliberately
-- NOT added — it is a strict prefix of the unique constraint.
create index if not exists professional_follows_follower_idx
  on public.professional_follows (follower_user_id, followed_at desc) where state = 'following';

drop trigger if exists professional_follows_set_updated_at on public.professional_follows;
create trigger professional_follows_set_updated_at
  before update on public.professional_follows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS
--
-- SELECT: own edges, and platform. NOT the professional — who follows you is
--   the follower's private state, and R1B exposes only a count through the
--   curated projection. A professional learning the identity of every follower
--   is a product decision R6/R7 gets to make deliberately, not a side effect of
--   a policy written here.
--
-- INSERT / UPDATE / DELETE: NO POLICY AT ALL, mirroring
--   appointment_claim_tokens. Every write arrives through a SECURITY DEFINER
--   function owned by postgres. A client that could INSERT directly could
--   forge another customer's edge, choose its own timestamps, or resurrect a
--   row it had unfollowed.
-- ---------------------------------------------------------------------------

alter table public.professional_follows enable row level security;
alter table public.professional_follows force row level security;

-- Supabase default privileges hand anon/authenticated everything on any new
-- public table. Without this the follow graph would ship world-writable.
revoke all on public.professional_follows from anon, authenticated;
grant select (id, professional_id, state, source, followed_at, unfollowed_at, created_at, updated_at)
  on public.professional_follows to authenticated;

drop policy if exists professional_follows_select on public.professional_follows;
create policy professional_follows_select
  on public.professional_follows
  for select
  to authenticated
  using (
    follower_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- 3. follow_professional — deliberate, and the only thing that can reverse an
--    explicit unfollow
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
    raise exception 'follow requires an authenticated session' using errcode = '42501';
  end if;

  -- Unclaimed identities cannot be followed: see the migration header.
  if not exists (
    select 1 from public.professionals p
    where p.id = p_professional_id and p.claim_state = 'claimed'
  ) then
    raise exception 'professional not found or not claimable' using errcode = '42704';
  end if;

  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at, unfollowed_at)
  values (v_user_id, p_professional_id, 'following', 'manual', now(), null)
  on conflict (follower_user_id, professional_id) do update
    set state = 'following',
        source = 'manual',
        -- Re-following something already followed must not restate WHEN it
        -- began. Only a genuine transition moves the timestamp.
        followed_at = case
          when public.professional_follows.state = 'following'
          then public.professional_follows.followed_at
          else now()
        end,
        unfollowed_at = null;
end;
$$;

comment on function public.follow_professional(uuid) is
  'Authenticated-only. Idempotent: following twice is a no-op that preserves the original followed_at. This is the ONLY path that can reverse an explicit unfollow, and it requires the customer''s own deliberate action — Constitution §3.4. The follower is auth.uid(); a caller cannot name someone else.';

revoke execute on function public.follow_professional(uuid) from public, anon;
grant execute on function public.follow_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. unfollow_professional — durable, and it sticks
-- ---------------------------------------------------------------------------

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
    raise exception 'unfollow requires an authenticated session' using errcode = '42501';
  end if;

  if not exists (select 1 from public.professionals p where p.id = p_professional_id) then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- The INSERT branch is what makes an unfollow durable even when no edge
  -- exists yet: it lays the tombstone that a later auto-follow will collide
  -- with. followed_at stays NULL — nothing was ever followed.
  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at, unfollowed_at)
  values (v_user_id, p_professional_id, 'unfollowed', 'manual', null, now())
  on conflict (follower_user_id, professional_id) do update
    set state = 'unfollowed',
        source = 'manual',
        -- Repeat unfollow keeps the FIRST refusal. That is when the customer
        -- actually decided.
        unfollowed_at = coalesce(public.professional_follows.unfollowed_at, now());
end;
$$;

comment on function public.unfollow_professional(uuid) is
  'Authenticated-only. Idempotent, and durable even with no prior edge — it writes a tombstone that later auto-follow attempts collide with. Repeat calls preserve the original unfollowed_at.';

revoke execute on function public.unfollow_professional(uuid) from public, anon;
grant execute on function public.unfollow_professional(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Automatic follow, from evidence FadeUp actually holds
--
-- The provenance question is the whole design. "Which account did this?" has
-- exactly one trustworthy answer in this schema and it is
-- booked_by_user_id, stamped from auth.uid() inside book_public_appointment /
-- join_public_queue and revoked at table level for INSERT AND UPDATE by R1A.
--
-- Explicitly NOT used, and why:
--
--   customers.user_id   squattable (R1A D-1) and staff-settable (D-8). An
--                       attacker who plants a victim's phone number must gain
--                       nothing, and with this column as the predicate they
--                       would gain a follow edge in the victim's name.
--   created_by          both self-service RPCs insert NULL there.
--   contact match       a phone number is not an account.
--
-- So an anonymous booking, a kiosk walk-in and a receptionist-typed
-- appointment produce NO follow. That is lossy, and it is correct: the
-- alternative is fabricating a relationship on behalf of someone who never
-- acted. R3 owns event architecture if this ever needs at-least-once delivery.
--
-- The two qualifying events:
--
--   appointment reaches 'confirmed' — Constitution §3.3 permits a confirmed
--     booking to establish a follow, while forbidding it as evidence of a
--     delivered service. Following is intent; the service record is elsewhere.
--
--   queue entry reaches 'completed' with a named barber — a served walk-in
--     is a real interaction with a specific professional. Earlier queue states
--     are not used: 'waiting' only says someone joined a line.
-- ---------------------------------------------------------------------------

create or replace function private.auto_follow_professional(
  p_follower_user_id uuid,
  p_barber_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if p_follower_user_id is null or p_barber_id is null then
    return;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b
  join public.professionals p on p.id = b.professional_id
  where b.id = p_barber_id
    and p.claim_state = 'claimed';

  if v_professional_id is null then
    return;
  end if;

  -- DO NOTHING, and there is deliberately no DO UPDATE branch. This is the
  -- single clause that makes an explicit unfollow permanent, and it is also
  -- what makes a duplicated or retried event harmless.
  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at)
  values (p_follower_user_id, v_professional_id, 'following', 'auto', now())
  on conflict (follower_user_id, professional_id) do nothing;
end;
$$;

comment on function private.auto_follow_professional(uuid, uuid) is
  'Creates a follow edge from a genuine interaction. ON CONFLICT DO NOTHING with no DO UPDATE branch: it can only ever CREATE an edge, so it can never reverse an explicit unfollow and can never double-count a retried event. Silent no-op when attribution is absent — a booking nobody signed in for attributes to nobody.';

revoke execute on function private.auto_follow_professional(uuid, uuid) from public, anon, authenticated;

create or replace function public.appointments_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'confirmed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return null;
  end if;

  perform private.auto_follow_professional(new.booked_by_user_id, new.barber_id);
  return null;
end;
$$;

comment on function public.appointments_auto_follow() is
  'AFTER INSERT OR UPDATE on appointments. Fires once, on entry to confirmed, and only for a booking the account made ITSELF (booked_by_user_id, the only forgery-resistant attribution in this schema). Constitution §3.3: a confirmed booking may establish a follow; it is never evidence a service was delivered.';

drop trigger if exists appointments_auto_follow on public.appointments;
create trigger appointments_auto_follow
  after insert or update of status on public.appointments
  for each row execute function public.appointments_auto_follow();

create or replace function public.queue_entries_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.auto_follow_professional(new.booked_by_user_id, new.barber_id);
  return null;
end;
$$;

comment on function public.queue_entries_auto_follow() is
  'AFTER INSERT OR UPDATE on queue_entries. A SERVED walk-in with a named barber is a real interaction; earlier queue states are not used, because joining a line says nothing about who served you. Same attribution rule as appointments.';

drop trigger if exists queue_entries_auto_follow on public.queue_entries;
create trigger queue_entries_auto_follow
  after insert or update of status on public.queue_entries
  for each row execute function public.queue_entries_auto_follow();
