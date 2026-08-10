-- FadeUp — Platform owner foundation
-- Migration: platform_role hierarchy, bootstrap claim, platform invitations, audit log
--
-- Replaces the flat public.platform_admins allow-list (LOT 2) with a real
-- three-tier hierarchy — platform_owner / platform_admin / platform_support
-- — per CLAUDE.md's terminology section. This is the FadeUp PLATFORM's own
-- staff, completely distinct from a barbershop's owner/manager/
-- receptionist/barber (public.membership_role, unrelated enum).
--
-- Scope boundary, deliberately: this migration builds bootstrap + invitation
-- + audit infrastructure only. It does NOT build a "demote/remove a platform
-- member" or "transfer ownership" RPC — those are privileged, rare
-- operations explicitly called out as needing their own dedicated,
-- deliberately-designed workflow (see the master plan's platform-owner
-- recovery section), not something to bolt onto this migration. Until that
-- exists, role changes/removals are an operator (direct SQL) action, same
-- posture platform_admins had for ALL writes before this migration.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'platform_role') then
    create type public.platform_role as enum ('platform_owner', 'platform_admin', 'platform_support');
  end if;
end
$$;

comment on type public.platform_role is
  'FadeUp platform staff role — NOT a barbershop role (see public.membership_role for that unrelated concept).';

-- platform_members ----------------------------------------------------------
-- Same security posture as the platform_admins table it replaces: a
-- dedicated table (not a column on profiles), zero client-facing write
-- path, a user may only confirm their OWN row. Grants happen exclusively
-- through claim_platform_owner_bootstrap()/accept_platform_invitation()
-- below (both SECURITY DEFINER) or direct operator SQL — never a table
-- INSERT/UPDATE/DELETE policy.
create table if not exists public.platform_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_members is
  'FadeUp platform staff roster. Grants only via claim_platform_owner_bootstrap()/accept_platform_invitation() or direct operator SQL — no client-facing write path exists.';

create index if not exists platform_members_role_idx on public.platform_members (role);

drop trigger if exists platform_members_set_updated_at on public.platform_members;
create trigger platform_members_set_updated_at
  before update on public.platform_members
  for each row execute function public.set_updated_at();

alter table public.platform_members enable row level security;
alter table public.platform_members force row level security;

drop policy if exists platform_members_select_own on public.platform_members;
create policy platform_members_select_own
  on public.platform_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.platform_members from anon, authenticated;

-- Migrate existing public.platform_admins rows in as platform_owner — the
-- safest capability-preserving mapping, since platform_admins had no
-- internal tiers (every row was an undifferentiated super_admin). Guarded
-- so re-running this migration after platform_admins has already been
-- dropped (by an earlier run of this same file) is a no-op, not an error.
do $$
begin
  if to_regclass('public.platform_admins') is not null then
    insert into public.platform_members (user_id, role, note, created_at, updated_at)
    select user_id, 'platform_owner'::public.platform_role, note, created_at, updated_at
    from public.platform_admins
    on conflict (user_id) do nothing;

    drop table public.platform_admins;
  end if;
end
$$;

-- platform_owner_bootstrap_tokens --------------------------------------------
-- Single-use, hashed-at-rest token minted by an operator (direct SQL — see
-- migration header) to let the very first platform_owner claim their role.
-- Zero client-facing policies of ANY kind: not even SELECT. The claim RPC
-- below is SECURITY DEFINER and looks up by hash itself; a client has no
-- legitimate reason to ever read this table directly.
create table if not exists public.platform_owner_bootstrap_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);

comment on table public.platform_owner_bootstrap_tokens is
  'Single-use hashed bootstrap tokens for claiming platform_owner. Zero client-facing policies — read/write only through claim_platform_owner_bootstrap()/reissue_platform_owner_bootstrap_token() or operator SQL.';

-- "Never two simultaneous active ownership tokens": at most one row may be
-- outstanding (unclaimed, unrevoked) at a time. Indexing a constant under a
-- partial predicate is the standard Postgres idiom for "at most one row
-- matching this condition".
create unique index if not exists platform_owner_bootstrap_tokens_one_active
  on public.platform_owner_bootstrap_tokens ((true))
  where claimed_at is null and revoked_at is null;

alter table public.platform_owner_bootstrap_tokens enable row level security;
alter table public.platform_owner_bootstrap_tokens force row level security;
revoke all on public.platform_owner_bootstrap_tokens from anon, authenticated;

-- platform_invitations --------------------------------------------------------
-- Invites a person to become platform_admin or platform_support — never
-- platform_owner (ownership is bootstrap/recovery-only, see header). Same
-- hashed-token, zero-UPDATE-policy pattern as public.invitations
-- (20260809110000), but stricter: platform_invitations has NO client
-- SELECT policy either (a pending platform invite roster is itself
-- sensitive — visible only through Phase D's platform team UI, which this
-- migration doesn't build yet, so no read path is opened prematurely).
create table if not exists public.platform_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role public.platform_role not null,
  invited_email text,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_invitations_role_not_owner check (role <> 'platform_owner'),
  constraint platform_invitations_email_format check (
    invited_email is null or invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

comment on table public.platform_invitations is
  'Pending/accepted/revoked platform_admin or platform_support invitations. Never platform_owner — see platform_invitations_role_not_owner. No client-facing read or write path; only through the RPCs in this migration.';

alter table public.platform_invitations enable row level security;
alter table public.platform_invitations force row level security;
revoke all on public.platform_invitations from anon, authenticated;

-- platform_audit_log ----------------------------------------------------------
-- Append-only record of platform-level security events (bootstrap claimed,
-- token reissued, invitation created/accepted/revoked). Distinct from the
-- existing tenant-scoped public.audit_logs (LOT 2) — this is platform, not
-- organization, activity. Same "no client write path" posture; read access
-- is scoped to platform_owner/platform_admin only (private.is_platform_admin(),
-- redefined below), matching section 9's "platform_support has no automatic
-- platform-security authority".
create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.platform_audit_log is
  'Append-only platform-level security event log (bootstrap/invitation/role events). Insert only via this migration''s SECURITY DEFINER RPCs — never a client write path.';

create index if not exists platform_audit_log_created_at_idx on public.platform_audit_log (created_at desc);
create index if not exists platform_audit_log_actor_user_id_idx on public.platform_audit_log (actor_user_id);

alter table public.platform_audit_log enable row level security;
alter table public.platform_audit_log force row level security;

drop policy if exists platform_audit_log_select on public.platform_audit_log;
create policy platform_audit_log_select
  on public.platform_audit_log
  for select
  to authenticated
  using ((select private.is_platform_admin()));

revoke insert, update, delete on public.platform_audit_log from anon, authenticated;

-- Authorization helpers --------------------------------------------------------
-- private.is_platform_admin() is used by ~18 existing RLS policies across
-- the schema (appointments, customers, services, ...) as the "platform
-- staff can see this tenant table for support purposes" check. Redefining
-- its BODY (not its name/signature) to read platform_members instead of the
-- dropped platform_admins table means every one of those existing policies
-- keeps working unchanged — this is exactly the abstraction boundary that
-- helper function was for.
--
-- Deliberate scope change: platform_support does NOT satisfy this check.
-- The old platform_admins table had no tiers, so every existing "is
-- platform staff" RLS check was, in effect, "is any kind of platform
-- staff". Now that there are tiers, granting platform_support the same
-- blanket cross-tenant read access this function implies would be a
-- silent over-grant relative to section 9 ("platform_support: controlled
-- tenant support capability; no automatic platform-security or financial
-- authority") and section 11's support-view model (Phase D) — support
-- should see tenant data through an audited, scoped support-view session,
-- not ambient blanket access. Until Phase D builds that, platform_support
-- simply has no elevated read access anywhere.
create or replace function private.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_members pm
    where pm.user_id = (select auth.uid())
      and pm.role in ('platform_owner', 'platform_admin')
  );
$$;

comment on function private.is_platform_admin() is
  'True if the calling user is platform_owner or platform_admin. platform_support deliberately does NOT satisfy this — see this migration''s header.';

create or replace function private.is_platform_owner()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_members pm
    where pm.user_id = (select auth.uid())
      and pm.role = 'platform_owner'
  );
$$;

comment on function private.is_platform_owner() is
  'True if the calling user is platform_owner specifically.';

create or replace function private.has_platform_role(p_roles public.platform_role[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_members pm
    where pm.user_id = (select auth.uid())
      and pm.role = any(p_roles)
  );
$$;

comment on function private.has_platform_role(public.platform_role[]) is
  'True if the calling user''s platform_members role is one of p_roles. Includes platform_support, unlike is_platform_admin() — use for checks that legitimately include support staff.';

revoke execute on function private.is_platform_admin() from public, anon;
revoke execute on function private.is_platform_owner() from public, anon;
revoke execute on function private.has_platform_role(public.platform_role[]) from public, anon;

grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_platform_owner() to authenticated;
grant execute on function private.has_platform_role(public.platform_role[]) to authenticated;

-- claim_platform_owner_bootstrap ------------------------------------------------
-- The ONLY client-callable way public.platform_owner_bootstrap_tokens is
-- ever read: by hash, inside this function, never by a direct SELECT. Safe
-- to grant EXECUTE broadly (any authenticated user) because without the
-- correct raw token — known only to whoever the operator gave it to
-- out-of-band — this always fails; the "at most one platform_owner already
-- exists" guard is defense in depth beyond the token's own single-use
-- enforcement.
create or replace function public.claim_platform_owner_bootstrap(p_token text)
returns public.platform_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text;
  v_token public.platform_owner_bootstrap_tokens;
  v_member public.platform_members;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to claim platform ownership';
  end if;

  if exists (select 1 from public.platform_members where role = 'platform_owner') then
    raise exception 'a platform owner already exists';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_token
  from public.platform_owner_bootstrap_tokens
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invalid bootstrap token';
  end if;

  if v_token.revoked_at is not null then
    raise exception 'this bootstrap token has been revoked';
  end if;

  if v_token.claimed_at is not null then
    raise exception 'this bootstrap token has already been claimed';
  end if;

  if v_token.expires_at < now() then
    raise exception 'this bootstrap token has expired';
  end if;

  insert into public.platform_members (user_id, role)
  values ((select auth.uid()), 'platform_owner')
  returning * into v_member;

  update public.platform_owner_bootstrap_tokens
  set claimed_at = now(), claimed_by = (select auth.uid())
  where id = v_token.id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_owner_bootstrap_claimed', 'platform_members', (select auth.uid()), jsonb_build_object('bootstrap_token_id', v_token.id));

  return v_member;
end;
$$;

comment on function public.claim_platform_owner_bootstrap(text) is
  'Redeems a bootstrap token for the calling authenticated user: grants platform_owner. Fails if a platform owner already exists or the token is invalid/expired/claimed/revoked.';

revoke execute on function public.claim_platform_owner_bootstrap(text) from public, anon;
grant execute on function public.claim_platform_owner_bootstrap(text) to authenticated;

-- reissue_platform_owner_bootstrap_token ----------------------------------------
-- Recovery path: an existing platform_owner can invalidate any outstanding
-- bootstrap token and mint a fresh one (e.g. to bring in a co-owner, or if
-- the original token was never delivered). Returns the RAW token exactly
-- once — it is never retrievable again afterward, matching "only hashed
-- token stored".
create or replace function public.reissue_platform_owner_bootstrap_token(p_expires_in interval default interval '7 days')
returns table (id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_token text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  if not (select private.is_platform_owner()) then
    raise exception 'only a platform owner may reissue the bootstrap token';
  end if;

  update public.platform_owner_bootstrap_tokens
  set revoked_at = now()
  where claimed_at is null and revoked_at is null;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + p_expires_in;

  insert into public.platform_owner_bootstrap_tokens (token_hash, expires_at)
  values (encode(extensions.digest(v_raw_token, 'sha256'), 'hex'), v_expires_at)
  returning platform_owner_bootstrap_tokens.id into v_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_owner_bootstrap_token_reissued', 'platform_owner_bootstrap_tokens', v_id, '{}'::jsonb);

  return query select v_id, v_raw_token, v_expires_at;
end;
$$;

comment on function public.reissue_platform_owner_bootstrap_token(interval) is
  'Platform-owner-only: revokes any outstanding bootstrap token and mints a new one, returning the raw token once. Never two active tokens at once.';

revoke execute on function public.reissue_platform_owner_bootstrap_token(interval) from public, anon;
grant execute on function public.reissue_platform_owner_bootstrap_token(interval) to authenticated;

-- create_platform_invitation ---------------------------------------------------
-- platform_owner may invite platform_admin or platform_support.
-- platform_admin may invite platform_support only — deliberately: minting
-- new platform_admin peers is kept to the owner alone, a conservative
-- default the master plan leaves unspecified but which avoids uncontrolled
-- admin-tier growth. Returns the raw token once, same pattern as reissue.
create or replace function public.create_platform_invitation(
  p_role public.platform_role,
  p_invited_email text default null,
  p_expires_in interval default interval '7 days'
)
returns table (id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_token text;
  v_id uuid;
  v_expires_at timestamptz;
  v_is_owner boolean;
begin
  if p_role = 'platform_owner' then
    raise exception 'platform_owner cannot be granted through an invitation';
  end if;

  v_is_owner := (select private.is_platform_owner());

  if p_role = 'platform_admin' and not v_is_owner then
    raise exception 'only a platform owner may invite a platform_admin';
  end if;

  if p_role = 'platform_support' and not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may invite platform_support';
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + p_expires_in;

  insert into public.platform_invitations (token_hash, role, invited_email, invited_by, expires_at)
  values (
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    p_role,
    nullif(lower(btrim(p_invited_email)), ''),
    (select auth.uid()),
    v_expires_at
  )
  returning platform_invitations.id into v_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_created', 'platform_invitations', v_id, jsonb_build_object('role', p_role));

  return query select v_id, v_raw_token, v_expires_at;
end;
$$;

comment on function public.create_platform_invitation(public.platform_role, text, interval) is
  'Creates a platform_admin/platform_support invitation and returns the raw token once. platform_admin invites require platform_owner; platform_support invites require platform_owner or platform_admin.';

revoke execute on function public.create_platform_invitation(public.platform_role, text, interval) from public, anon;
grant execute on function public.create_platform_invitation(public.platform_role, text, interval) to authenticated;

-- accept_platform_invitation -----------------------------------------------------
create or replace function public.accept_platform_invitation(p_token text)
returns public.platform_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text;
  v_invitation public.platform_invitations;
  v_caller_email text;
  v_member public.platform_members;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to accept a platform invitation';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_invitation
  from public.platform_invitations
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invalid platform invitation';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'this invitation has been revoked';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'this invitation has already been accepted';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'this invitation has expired';
  end if;

  if v_invitation.invited_email is not null then
    select email into v_caller_email from auth.users where id = (select auth.uid());
    if v_caller_email is null or lower(v_caller_email) <> v_invitation.invited_email then
      raise exception 'this invitation was issued to a different email address';
    end if;
  end if;

  if exists (select 1 from public.platform_members where user_id = (select auth.uid())) then
    raise exception 'you are already a platform member';
  end if;

  insert into public.platform_members (user_id, role)
  values ((select auth.uid()), v_invitation.role)
  returning * into v_member;

  update public.platform_invitations
  set accepted_at = now(), accepted_by = (select auth.uid())
  where id = v_invitation.id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_accepted', 'platform_invitations', v_invitation.id, jsonb_build_object('role', v_invitation.role));

  return v_member;
end;
$$;

comment on function public.accept_platform_invitation(text) is
  'Redeems a platform_admin/platform_support invitation for the calling authenticated user. Requires the caller''s auth email to match invited_email when one was set.';

revoke execute on function public.accept_platform_invitation(text) from public, anon;
grant execute on function public.accept_platform_invitation(text) to authenticated;

-- revoke_platform_invitation -----------------------------------------------------
create or replace function public.revoke_platform_invitation(p_id uuid)
returns public.platform_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.platform_invitations;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may revoke a platform invitation';
  end if;

  update public.platform_invitations
  set revoked_at = now()
  where id = p_id and accepted_at is null and revoked_at is null
  returning * into v_invitation;

  if not found then
    raise exception 'platform invitation not found or already accepted/revoked';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_revoked', 'platform_invitations', v_invitation.id, '{}'::jsonb);

  return v_invitation;
end;
$$;

comment on function public.revoke_platform_invitation(uuid) is
  'Platform owner/admin cancels a pending platform invitation.';

revoke execute on function public.revoke_platform_invitation(uuid) from public, anon;
grant execute on function public.revoke_platform_invitation(uuid) to authenticated;
