-- FadeUp — R1: external profiles and the claim lifecycle
-- Migration: professional_profile_claims
--
-- WHAT R1 ADDS TO WORKER, AND WHAT IT DOES NOT
--
-- The Worker discovery pipeline already exists and is mature. Source ->
-- observation -> match -> canonical -> dedupe are all modelled:
-- prospect_sources, prospect_source_records (external_id, source_url,
-- raw_payload, confidence, fetched_at, last_verified_at), prospect_identity_
-- matches (matching_rule, matched_attributes, confidence, rules_version,
-- merge_applied), prospect_duplicates (confidence, status, reviewed_by) and
-- prospects itself. R1 adds NO new observation, matching or dedupe structure,
-- and touches none of those tables.
--
-- Only two things were genuinely missing:
--
--   1. an EXTERNAL PROFILE — which is not a new table either. A
--      Worker-discovered professional is a `professionals` row with
--      source='worker', prospect_id set, user_id null, claim_state
--      'unclaimed'. See 20260824100000 for why that is safe: no barbers row
--      means no availability, no queue, no schedule, no appointments. Worker
--      cannot invent operational truth because the columns to express it do
--      not exist on that table.
--
--   2. the CLAIM lifecycle — this file.
--
-- CLAIM IS NOT SUBSCRIPTION
--
-- claim_state answers "who controls this identity". Nothing here answers
-- "what have they paid for". There is no plan, price, tier or entitlement
-- column anywhere in R1; a claimed profile is Free until R2 says otherwise.
--
-- SECURITY: MODELLED ON professional_applications
--
-- 20260813170000_professional_applications.sql solves the structurally
-- identical problem (registration must not hand out a tenant) and states the
-- principle this file follows: AUTHENTICATED != AUTHORIZED. The claim row is
-- the workflow, never the permission.
--
-- THE TAKEOVER RISK, AND WHY user_id UNIQUE IS NOT THE GUARD
--
-- It is tempting to argue that professionals.user_id being UNIQUE prevents
-- two owners. It does not. It prevents one ACCOUNT owning two IDENTITIES.
-- It does nothing to stop one IDENTITY being handed to a second ACCOUNT:
-- every backfilled professional already has user_id set, and approving a
-- claim by user A against professional P where P.user_id = B would simply
-- overwrite it — B silently loses their identity, their followers and their
-- verified clients, with no unique violation anywhere, because B never filed
-- a claim to collide with.
--
-- The actual guards are:
--   * approval refuses any target whose user_id is already set;
--   * one approved claim per professional, ever (partial unique);
--   * one pending claim per (professional, claimant) — multiple DIFFERENT
--     claimants may be pending at once, which is necessary because the
--     platform arbitrates between them;
--   * SELECT ... FOR UPDATE on the professionals row inside the approval
--     transaction, so two concurrent approvals serialise.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professional_profile_claims
-- ---------------------------------------------------------------------------

create table if not exists public.professional_profile_claims (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  claimant_user_id uuid not null references auth.users (id) on delete cascade,

  state text not null default 'pending',
  evidence jsonb not null default '{}'::jsonb,

  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_profile_claims_state_valid
    check (state in ('pending', 'approved', 'rejected', 'withdrawn'))
);

comment on table public.professional_profile_claims is
  'The lifecycle by which a real professional takes ownership of an external, Worker-discovered profile. Platform-arbitrated: filing a claim grants nothing. Separate from professional_applications, which creates a NEW organization — this takes over an EXISTING identity.';

-- At most one approved claim per professional, permanently. This is the
-- storage-layer guarantee that two concurrent approvals cannot both win.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'professional_profile_claims_one_approved') then
    create unique index professional_profile_claims_one_approved
      on public.professional_profile_claims (professional_id) where state = 'approved';
  end if;
end $$;

-- One pending claim per claimant per professional — stops spam, while still
-- allowing several different claimants to be pending simultaneously.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'professional_profile_claims_one_pending_per_claimant') then
    create unique index professional_profile_claims_one_pending_per_claimant
      on public.professional_profile_claims (professional_id, claimant_user_id) where state = 'pending';
  end if;
end $$;

create index if not exists professional_profile_claims_claimant_idx
  on public.professional_profile_claims (claimant_user_id, submitted_at desc);

-- The platform review queue, mirroring professional_applications' convention.
create index if not exists professional_profile_claims_pending_queue_idx
  on public.professional_profile_claims (submitted_at) where state = 'pending';

drop trigger if exists professional_profile_claims_set_updated_at on public.professional_profile_claims;
create trigger professional_profile_claims_set_updated_at
  before update on public.professional_profile_claims
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Guard — the claimant may withdraw, and nothing else
--
-- Without this the claimant self-approves in a single PATCH. The partial
-- unique index would not help: it enforces that at most ONE approval exists,
-- not that the approval was legitimate — the attacker simply wins the race to
-- be that one.
-- ---------------------------------------------------------------------------

create or replace function public.guard_professional_claim_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  if new.professional_id is distinct from old.professional_id
     or new.claimant_user_id is distinct from old.claimant_user_id
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'professional_profile_claims: only the platform may decide a claim';
  end if;

  -- The one state change a claimant may make themselves.
  if new.state is distinct from old.state
     and not (old.state = 'pending' and new.state = 'withdrawn') then
    raise exception 'professional_profile_claims: a claimant may only withdraw a pending claim';
  end if;

  return new;
end;
$$;

drop trigger if exists professional_profile_claims_guard on public.professional_profile_claims;
create trigger professional_profile_claims_guard
  before update on public.professional_profile_claims
  for each row execute function public.guard_professional_claim_update();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.professional_profile_claims enable row level security;
alter table public.professional_profile_claims force row level security;

drop policy if exists professional_profile_claims_select on public.professional_profile_claims;
create policy professional_profile_claims_select
  on public.professional_profile_claims
  for select
  to authenticated
  using (
    claimant_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

drop policy if exists professional_profile_claims_insert on public.professional_profile_claims;
create policy professional_profile_claims_insert
  on public.professional_profile_claims
  for insert
  to authenticated
  with check (
    claimant_user_id = (select auth.uid())
    and state = 'pending'
    and decided_at is null
    and decided_by is null
    and rejection_reason is null
  );

drop policy if exists professional_profile_claims_update_own on public.professional_profile_claims;
create policy professional_profile_claims_update_own
  on public.professional_profile_claims
  for update
  to authenticated
  using (claimant_user_id = (select auth.uid()) and state = 'pending')
  with check (claimant_user_id = (select auth.uid()));

drop policy if exists professional_profile_claims_update_platform on public.professional_profile_claims;
create policy professional_profile_claims_update_platform
  on public.professional_profile_claims
  for update
  to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- No DELETE policy: a decided claim is a permanent record.

-- Consistency with the other five new tables: anon holds no write grant.
-- RLS already denies it (no policy grants to anon anywhere in this database),
-- so this is defence in depth, not a fix.
revoke insert, update, delete on public.professional_profile_claims from anon;

-- ---------------------------------------------------------------------------
-- 4. create_external_professional
--
-- The controlled path by which Worker publication (R10) creates an unclaimed
-- identity. It exists in R1 so that the SAFE DEFAULTS are a function
-- contract rather than a convention a future lot has to remember: an external
-- profile is always unowned, always unclaimed, always non-public, always
-- unverified. Nothing here can fabricate operational state.
--
-- R1 does not mass-import anything (§77).
-- ---------------------------------------------------------------------------

create or replace function public.create_external_professional(
  p_prospect_id uuid,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'create_external_professional is platform-only';
  end if;

  if p_prospect_id is null then
    raise exception 'an external professional must reference a prospect';
  end if;

  -- One external identity per prospect. Idempotent by design: a re-run of a
  -- publication job must not mint a second identity for the same real shop.
  select id into v_id from public.professionals where prospect_id = p_prospect_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.professionals (
    user_id, prospect_id, display_name, source, claim_state, verification_state, is_public
  )
  values (
    null, p_prospect_id,
    coalesce(nullif(btrim(p_display_name), ''), 'Barber'),
    'worker', 'unclaimed', 'not_verified', false
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_external_professional(uuid, text) is
  'Platform-only. Creates an UNCLAIMED external professional identity from a Worker prospect, with safe defaults enforced in code: no owner, unclaimed, not public, not verified. Idempotent per prospect.';

revoke execute on function public.create_external_professional(uuid, text) from public, anon;
grant execute on function public.create_external_professional(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. claim_professional_profile — filing a claim grants nothing
-- ---------------------------------------------------------------------------

create or replace function public.claim_professional_profile(
  p_professional_id uuid,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_owner uuid;
  v_found boolean;
  v_claim_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'claim_professional_profile requires an authenticated session';
  end if;

  select p.user_id, true into v_owner, v_found
  from public.professionals p where p.id = p_professional_id;

  if v_found is not true then
    raise exception 'professional not found';
  end if;

  -- An already-owned identity is not claimable. This is the social-engineering
  -- entry point if left open.
  if v_owner is not null then
    raise exception 'this profile is already claimed';
  end if;

  insert into public.professional_profile_claims (professional_id, claimant_user_id, evidence)
  values (p_professional_id, v_user_id, coalesce(p_evidence, '{}'::jsonb))
  on conflict (professional_id, claimant_user_id) where state = 'pending'
  do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    select id into v_claim_id
    from public.professional_profile_claims
    where professional_id = p_professional_id
      and claimant_user_id = v_user_id
      and state = 'pending';
  end if;

  -- Signal that a decision is outstanding. Deliberately does NOT set user_id:
  -- claim_state 'claim_pending' still satisfies the
  -- professionals_claim_state_matches_owner constraint, because only
  -- 'claimed' requires an owner.
  --
  -- guard_professional_update() blocks client-driven claim_state changes, and
  -- SECURITY DEFINER does not change auth.uid() — the caller here is still the
  -- claimant. This transaction-local flag is the documented stand-down, the
  -- same shape as fadeup.org_creation_authorized.
  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals
  set claim_state = 'claim_pending'
  where id = p_professional_id and claim_state = 'unclaimed';

  -- Reset immediately. is_local => true scopes the flag to the TRANSACTION,
  -- not the statement, so leaving it on would disable the guard for every
  -- later statement in the same transaction. The three precedents
  -- (20260818200000, 20260813170000, 20260818220000) all set it back to
  -- 'off'; this copies that half of the pattern too.
  perform set_config('fadeup.professional_identity_authorized', 'off', true);

  return v_claim_id;
end;
$$;

comment on function public.claim_professional_profile(uuid, jsonb) is
  'Authenticated-only. Files a PENDING claim on an unclaimed external profile. Idempotent — repeated calls return the existing pending claim. Grants no control whatsoever; only approve_professional_claim does that, and only a platform admin may call it.';

revoke execute on function public.claim_professional_profile(uuid, jsonb) from public, anon;
grant execute on function public.claim_professional_profile(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. withdraw_professional_claim
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_professional_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  update public.professional_profile_claims
  set state = 'withdrawn'
  where id = p_claim_id
    and claimant_user_id = (select auth.uid())
    and state = 'pending'
  returning professional_id into v_professional_id;

  if v_professional_id is null then
    raise exception 'claim not found, not yours, or not pending';
  end if;

  -- Return the profile to unclaimed if nobody else is still waiting.
  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals p
  set claim_state = 'unclaimed'
  where p.id = v_professional_id
    and p.user_id is null
    and not exists (
      select 1 from public.professional_profile_claims c
      where c.professional_id = v_professional_id and c.state = 'pending'
    );

  perform set_config('fadeup.professional_identity_authorized', 'off', true);
end;
$$;

revoke execute on function public.withdraw_professional_claim(uuid) from public, anon;
grant execute on function public.withdraw_professional_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. approve_professional_claim — platform only
--
-- FOR UPDATE on the professionals row is what serialises two concurrent
-- approvals: the second waits, then sees user_id already set and refuses.
-- The partial unique index is the second, independent guarantee.
--
-- THE DELIBERATE FAIL-CLOSED
--
-- If the claimant already has their own professional identity — the most
-- likely real case, a barber Worker scraped who later signed up natively —
-- this raises rather than proceeding. The correct resolution is a MERGE:
-- repoint barbers, follows and relationships onto one survivor and tombstone
-- the other, with an audit record. R1 does not build the claim engine (§43),
-- and a half-considered merge here would silently destroy social graph data.
-- Failing closed is the safe answer; merge is a hard prerequisite for R17.
-- ---------------------------------------------------------------------------

create or replace function public.approve_professional_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.professional_profile_claims;
  v_owner uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'approve_professional_claim is platform-only';
  end if;

  select * into v_claim
  from public.professional_profile_claims
  where id = p_claim_id and state = 'pending';

  if not found then
    raise exception 'claim not found or not pending';
  end if;

  -- Serialise concurrent approvals on the target identity.
  select user_id into v_owner
  from public.professionals
  where id = v_claim.professional_id
  for update;

  if v_owner is not null then
    raise exception 'this profile is already owned; approving would transfer it away from its current owner';
  end if;

  if exists (select 1 from public.professionals where user_id = v_claim.claimant_user_id) then
    raise exception 'claimant already has a professional identity; merging two identities is not implemented in R1 (see docs/v2/DEPRECATIONS.md)';
  end if;

  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals
  set user_id = v_claim.claimant_user_id,
      claim_state = 'claimed'
  where id = v_claim.professional_id;

  -- Reset before the remaining statements in this function run, so they
  -- execute with the guard active.
  perform set_config('fadeup.professional_identity_authorized', 'off', true);

  update public.professional_profile_claims
  set state = 'approved',
      decided_at = now(),
      decided_by = (select auth.uid())
  where id = p_claim_id;

  -- Every other pending claim on this identity loses.
  update public.professional_profile_claims
  set state = 'rejected',
      decided_at = now(),
      decided_by = (select auth.uid()),
      rejection_reason = 'another claim was approved for this profile'
  where professional_id = v_claim.professional_id
    and id <> p_claim_id
    and state = 'pending';

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'professional_claim.approved',
    'professional',
    v_claim.professional_id,
    jsonb_build_object('claim_id', p_claim_id, 'claimant_user_id', v_claim.claimant_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. reject_professional_claim — platform only
--
-- Without this, a rejected claim strands the target: withdraw_professional_
-- claim() has a reset path but rejection had none, so claim_state would stay
-- 'claim_pending' forever and no future claimant could ever file, because
-- claim_professional_profile only accepts 'unclaimed' targets.
-- ---------------------------------------------------------------------------

create or replace function public.reject_professional_claim(
  p_claim_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'reject_professional_claim is platform-only';
  end if;

  update public.professional_profile_claims
  set state = 'rejected',
      decided_at = now(),
      decided_by = (select auth.uid()),
      rejection_reason = p_reason
  where id = p_claim_id and state = 'pending'
  returning professional_id into v_professional_id;

  if v_professional_id is null then
    raise exception 'claim not found or not pending';
  end if;

  -- Release the profile only when nobody else is still waiting on it.
  perform set_config('fadeup.professional_identity_authorized', 'on', true);

  update public.professionals p
  set claim_state = 'unclaimed'
  where p.id = v_professional_id
    and p.user_id is null
    and not exists (
      select 1 from public.professional_profile_claims c
      where c.professional_id = v_professional_id and c.state = 'pending'
    );

  perform set_config('fadeup.professional_identity_authorized', 'off', true);

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'professional_claim.rejected',
    'professional',
    v_professional_id,
    jsonb_build_object('claim_id', p_claim_id, 'reason', p_reason)
  );
end;
$$;

comment on function public.reject_professional_claim(uuid, text) is
  'Platform-only. Rejects a pending claim and returns the profile to unclaimed when no other claim is still pending, so a rejection never strands an external profile in claim_pending forever.';

revoke execute on function public.reject_professional_claim(uuid, text) from public, anon;
grant execute on function public.reject_professional_claim(uuid, text) to authenticated;

comment on function public.approve_professional_claim(uuid) is
  'Platform-only. Transfers an UNCLAIMED external identity to its claimant. Refuses any already-owned target, so an approval can never take an identity away from an existing owner. Serialises concurrent approvals with SELECT FOR UPDATE, and fails closed when the claimant already has an identity, because merging two identities is deliberately not implemented in R1.';

revoke execute on function public.approve_professional_claim(uuid) from public, anon;
grant execute on function public.approve_professional_claim(uuid) to authenticated;
