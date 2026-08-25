-- FadeUp — R1: opt-in public customer identity + verification
-- Migration: customer_public_profiles
--
-- PRIVATE BY DEFAULT.
--
-- customer_profiles (20260813120000) is the customer's PRIVATE portable
-- identity — phone, email, preferences — under strict owner-only RLS. This
-- table is a SEPARATE, opt-in public projection. Separate on purpose: if the
-- public fields lived on customer_profiles, then every future "expose the
-- public profile" query would be one forgotten column list away from leaking
-- a phone number. Two tables means the private columns are not merely
-- filtered out of the public path — they are not reachable from it at all.
--
-- is_public defaults to FALSE. A normal customer has no public presence, and
-- creating a row here does not create one.
--
-- WHY VERIFICATION CANNOT BE SELF-SERVICE
--
-- The obvious RLS shape for an owner-editable row is
--   using (user_id = auth.uid()) with check (user_id = auth.uid())
-- and that permits updating EVERY COLUMN OF THAT ROW. RLS is row-level; it
-- has no column granularity. With only that policy, a customer issues
--   PATCH /rest/v1/customer_public_profiles?user_id=eq.<me>
--   {"verification_state":"verified","is_public":true}
-- and is now a verified public figure, with no audit record to contradict it.
--
-- Two independent controls stop this:
--
--   1. A table-level REVOKE of UPDATE, then a re-GRANT of only the
--      presentational columns. (A column-level REVOKE would be a silent
--      no-op here — it cannot subtract from the blanket table-level grant
--      that anon/authenticated already hold.)
--   2. guard_customer_public_profile_update(), so any path that reaches the
--      row with more privilege than a normal client still cannot move
--      verification.
--
-- Verification is written ONLY by set_customer_verification(), which is
-- platform-only and writes the state and its audit record in the same
-- transaction, so the trail can never lag the state.
--
-- WHY THERE IS NO customer_verification_events TABLE
--
-- platform_audit_log already exists and already is exactly this: append-only,
-- platform-admin-SELECT-only, (actor_user_id, action, target_type, target_id,
-- metadata jsonb, created_at). Creating a second audit table because the
-- concept has a product name would be duplication, not modelling.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. customer_public_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.customer_public_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Reserved for R6/R7, like professionals.handle. Nullable so nothing has to
  -- invent one, but the uniqueness rule exists from day one.
  username text,

  display_name text,
  avatar_url text,
  bio text,

  -- Opt-in. This is the flag that keeps a normal customer private (§23).
  is_public boolean not null default false,

  persona_category text,
  verification_state text not null default 'not_verified',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_public_profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,30}$'),
  constraint customer_public_profiles_persona_valid
    check (persona_category is null or persona_category in
      ('artist', 'athlete', 'creator', 'public_figure', 'other')),
  constraint customer_public_profiles_verification_valid
    check (verification_state in ('not_verified', 'pending', 'verified', 'revoked')),
  constraint customer_public_profiles_bio_length
    check (bio is null or char_length(bio) <= 500)
);

comment on table public.customer_public_profiles is
  'The opt-in PUBLIC projection of a customer identity. Deliberately separate from customer_profiles, which holds private contact data — the private columns are not reachable from any public path, rather than being filtered out of one. is_public defaults false: a normal customer stays private.';

comment on column public.customer_public_profiles.verification_state is
  'Platform-controlled. Not writable by the customer: see the table-level UPDATE revoke and guard_customer_public_profile_update(). Changed only by set_customer_verification(), which writes the audit record atomically.';

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'customer_public_profiles_username_lower_unique') then
    create unique index customer_public_profiles_username_lower_unique
      on public.customer_public_profiles (lower(username)) where username is not null;
  end if;
end $$;

create index if not exists customer_public_profiles_public_idx
  on public.customer_public_profiles (is_public) where is_public;

drop trigger if exists customer_public_profiles_set_updated_at on public.customer_public_profiles;
create trigger customer_public_profiles_set_updated_at
  before update on public.customer_public_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Column-level hardening
-- ---------------------------------------------------------------------------

revoke update on public.customer_public_profiles from authenticated, anon;
grant update (username, display_name, avatar_url, bio, is_public, persona_category)
  on public.customer_public_profiles to authenticated;

create or replace function public.guard_customer_public_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  if new.verification_state is distinct from old.verification_state then
    raise exception 'customer_public_profiles.verification_state is not self-service';
  end if;

  return new;
end;
$$;

drop trigger if exists customer_public_profiles_guard on public.customer_public_profiles;
create trigger customer_public_profiles_guard
  before update on public.customer_public_profiles
  for each row execute function public.guard_customer_public_profile_update();

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- The owner manages their own row. Anonymous/public reads go exclusively
-- through the projection RPC in 20260824101000, which requires is_public —
-- there is no anon policy here, matching this codebase's rule that zero
-- policies grant to anon.
-- ---------------------------------------------------------------------------

alter table public.customer_public_profiles enable row level security;
alter table public.customer_public_profiles force row level security;

drop policy if exists customer_public_profiles_select on public.customer_public_profiles;
create policy customer_public_profiles_select
  on public.customer_public_profiles
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

drop policy if exists customer_public_profiles_insert on public.customer_public_profiles;
create policy customer_public_profiles_insert
  on public.customer_public_profiles
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    -- A new profile can never arrive pre-verified.
    and verification_state = 'not_verified'
  );

drop policy if exists customer_public_profiles_update on public.customer_public_profiles;
create policy customer_public_profiles_update
  on public.customer_public_profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists customer_public_profiles_update_platform on public.customer_public_profiles;
create policy customer_public_profiles_update_platform
  on public.customer_public_profiles
  for update
  to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

drop policy if exists customer_public_profiles_delete on public.customer_public_profiles;
create policy customer_public_profiles_delete
  on public.customer_public_profiles
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. set_customer_verification
--
-- The only way verification_state ever moves. State change and audit record
-- are written together, so the audit trail cannot disagree with reality.
-- ---------------------------------------------------------------------------

create or replace function public.set_customer_verification(
  p_user_id uuid,
  p_state text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_from text;
begin
  v_actor := (select auth.uid());

  if not (select private.is_platform_admin()) then
    raise exception 'set_customer_verification is platform-only';
  end if;

  if p_state not in ('not_verified', 'pending', 'verified', 'revoked') then
    raise exception 'invalid verification state: %', p_state;
  end if;

  select verification_state into v_from
  from public.customer_public_profiles where user_id = p_user_id;

  if v_from is null then
    raise exception 'customer has no public profile';
  end if;

  update public.customer_public_profiles
  set verification_state = p_state
  where user_id = p_user_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'customer_verification.changed',
    'customer_public_profile',
    p_user_id,
    jsonb_build_object(
      'from_state', v_from,
      'to_state', p_state,
      'reason', p_reason
    )
  );
end;
$$;

comment on function public.set_customer_verification(uuid, text, text) is
  'Platform-only. The single path that moves a customer''s verification_state, writing the state change and its platform_audit_log record in one transaction. The customer can never call this for themselves, and the rationale recorded here is never readable by the customer it concerns.';

revoke execute on function public.set_customer_verification(uuid, text, text) from public, anon;
grant execute on function public.set_customer_verification(uuid, text, text) to authenticated;
