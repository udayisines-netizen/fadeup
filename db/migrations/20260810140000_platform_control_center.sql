-- FadeUp — Platform control center
-- Migration: platform team roster visibility, platform support-view sessions
--
-- Builds on 20260810130000_platform_roles.sql. Two additions:
--
-- 1. platform_members/platform_invitations previously had NO client read
--    path at all beyond a user confirming their own membership row — correct
--    for that migration (no UI consumed a roster yet), but the /platform
--    Team page needs to list ALL platform staff and pending invitations for
--    platform_owner/platform_admin. Adds exactly that, nothing broader.
--
-- 2. platform_support_sessions: tracks an explicit, audited "I am now
--    viewing organization X for support" context — the mechanism behind the
--    persistent "Platform Support View" banner in CLAUDE.md's support-view
--    section. Actions performed during a session are already attributed to
--    the real platform actor (every write in this schema goes through
--    (select auth.uid()), never a spoofable client value), so this session
--    is a visibility/accountability layer, not a new authorization grant on
--    top of what is_platform_admin() already reads.
--
-- Deliberate, DOCUMENTED scope boundary — do not silently "fix" this later
-- without re-reading this comment: platform_support does NOT get any
-- elevated tenant-table read access from this migration. Doing that
-- properly means every existing "is_platform_admin() OR is_org_member()"
-- SELECT policy across ~18 tenant tables would need to instead check "is
-- platform_admin, OR is_org_member, OR (is platform_support AND there is a
-- currently-active platform_support_sessions row for this organization_id
-- and this caller)" — a real, broader retrofit across the schema, not a
-- one-migration change, and risky to do quickly against already-shipped,
-- already-tested RLS. Support sessions here are usable by platform_owner/
-- platform_admin only, who already have that read access — this migration
-- gives their existing access an explicit, audited, bannered context. Wiring
-- platform_support into the same mechanism is tracked as a separate,
-- deliberate follow-up.
--
-- Idempotent: safe to re-run.

-- platform_members: owner/admin can see the full roster (not just their own row) ---
drop policy if exists platform_members_select_admin on public.platform_members;
create policy platform_members_select_admin
  on public.platform_members
  for select
  to authenticated
  using ((select private.is_platform_admin()));

-- platform_invitations: owner/admin can see the pending/accepted/revoked
-- roster. The original migration ran `revoke all ... from ... authenticated`
-- (correct at the time — there was no read path yet at all), which revokes
-- SELECT itself, not just this policy's effect. A GRANT is required before
-- an RLS policy has anything to scope: policies restrict which ROWS an
-- already-granted privilege can see, they cannot grant a privilege that
-- doesn't exist at the table level.
grant select on public.platform_invitations to authenticated;

drop policy if exists platform_invitations_select_admin on public.platform_invitations;
create policy platform_invitations_select_admin
  on public.platform_invitations
  for select
  to authenticated
  using ((select private.is_platform_admin()));

-- platform_support_sessions -----------------------------------------------------
create table if not exists public.platform_support_sessions (
  id uuid primary key default gen_random_uuid(),
  platform_actor_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_type text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  reason text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint platform_support_sessions_target_type_valid check (target_type in ('organization', 'barber'))
);

comment on table public.platform_support_sessions is
  'Explicit, audited "viewing organization X for support" context — drives the persistent support-view banner. Does not itself grant any read access beyond what is_platform_admin() already has; see this migration''s header.';

create index if not exists platform_support_sessions_actor_idx on public.platform_support_sessions (platform_actor_id, started_at desc);
create index if not exists platform_support_sessions_organization_id_idx on public.platform_support_sessions (organization_id);

-- At most one OPEN session per actor at a time — a platform staffer views one
-- workspace at a time, never a stack of simultaneous sessions to lose track of.
create unique index if not exists platform_support_sessions_one_open_per_actor
  on public.platform_support_sessions (platform_actor_id)
  where ended_at is null;

alter table public.platform_support_sessions enable row level security;
alter table public.platform_support_sessions force row level security;

drop policy if exists platform_support_sessions_select on public.platform_support_sessions;
create policy platform_support_sessions_select
  on public.platform_support_sessions
  for select
  to authenticated
  using (
    platform_actor_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

revoke insert, update, delete on public.platform_support_sessions from anon, authenticated;

-- start_platform_support_session -------------------------------------------------
create or replace function public.start_platform_support_session(
  p_organization_id uuid,
  p_target_type text,
  p_target_user_id uuid default null,
  p_reason text default null
)
returns public.platform_support_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.platform_support_sessions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may start a support-view session';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization not found';
  end if;

  -- Close any session this actor left open — starting a new one always
  -- means "I'm switching what I'm looking at now", not stacking contexts.
  update public.platform_support_sessions
  set ended_at = now()
  where platform_actor_id = (select auth.uid()) and ended_at is null;

  insert into public.platform_support_sessions (platform_actor_id, organization_id, target_type, target_user_id, reason)
  values ((select auth.uid()), p_organization_id, p_target_type, p_target_user_id, nullif(btrim(p_reason), ''))
  returning * into v_session;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'platform_support_session_started',
    'organizations',
    p_organization_id,
    jsonb_build_object('session_id', v_session.id, 'target_type', p_target_type, 'target_user_id', p_target_user_id)
  );

  return v_session;
end;
$$;

comment on function public.start_platform_support_session(uuid, text, uuid, text) is
  'Platform owner/admin only. Opens (and audits) an explicit support-view session for one organization, closing any session the caller left open.';

revoke execute on function public.start_platform_support_session(uuid, text, uuid, text) from public, anon;
grant execute on function public.start_platform_support_session(uuid, text, uuid, text) to authenticated;

-- end_platform_support_session ---------------------------------------------------
create or replace function public.end_platform_support_session(p_id uuid)
returns public.platform_support_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.platform_support_sessions;
begin
  update public.platform_support_sessions
  set ended_at = now()
  where id = p_id and platform_actor_id = (select auth.uid()) and ended_at is null
  returning * into v_session;

  if not found then
    raise exception 'support session not found, not yours, or already ended';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_support_session_ended', 'organizations', v_session.organization_id, jsonb_build_object('session_id', v_session.id));

  return v_session;
end;
$$;

comment on function public.end_platform_support_session(uuid) is
  'Ends the caller''s own support-view session. Cannot end another actor''s session.';

revoke execute on function public.end_platform_support_session(uuid) from public, anon;
grant execute on function public.end_platform_support_session(uuid) to authenticated;
