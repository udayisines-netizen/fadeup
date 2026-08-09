-- FadeUp — LOT 3: authentication + onboarding
-- Migration: invitations
--
-- Lets an org owner/manager invite someone by email to join with a specific
-- role. Redemption (turning an invitation into a membership) happens only
-- through public.accept_invitation() (see 20260809110100), never through a
-- direct client UPDATE — this table has no UPDATE policy at all, so
-- accepted_at/revoked_at can never be forged by a client. Same pattern as
-- audit_logs' "no client-facing write path" in LOT 2.
--
-- Idempotent: safe to re-run.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.membership_role not null,
  token text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitations_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint invitations_token_key unique (token)
);

comment on table public.invitations is
  'Pending/accepted/revoked invitation for a person to join an organization with a specific role. Redeemed only via accept_invitation().';

-- Normalize email so lookups/uniqueness are case-insensitive without needing
-- a functional unique index everywhere that reads this column.
create or replace function public.normalize_invitation_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists invitations_normalize_email on public.invitations;
create trigger invitations_normalize_email
  before insert or update on public.invitations
  for each row execute function public.normalize_invitation_email();

create index if not exists invitations_organization_id_idx on public.invitations (organization_id);

-- Prevent duplicate outstanding invites for the same person to the same org.
-- Re-inviting after a decline/expiry/revoke is fine (that row no longer
-- matches this partial index).
create unique index if not exists invitations_pending_unique
  on public.invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

-- Row Level Security -------------------------------------------------------
-- select: owner/manager of the org (to manage the invite roster), or
--   platform admin. The invitee is not yet a member and cannot SELECT this
--   table directly — they look up an invitation via the
--   get_invitation_by_token() RPC instead, which returns only the limited
--   fields needed to render an accept screen (never the raw row/token list).
-- insert: owner/manager of the org, with the same "only an owner may grant
--   the owner role" guard used on memberships, and invited_by must be the
--   caller (an invitation can never be attributed to someone else).
-- delete: owner/manager may cancel/clean up an invitation.
-- update: intentionally no policy at all — see file header.

alter table public.invitations enable row level security;
alter table public.invitations force row level security;

drop policy if exists invitations_select on public.invitations;
create policy invitations_select
  on public.invitations
  for select
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert
  on public.invitations
  for insert
  to authenticated
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    and invited_by = (select auth.uid())
    and (
      role <> 'owner'
      or (select private.has_org_role(organization_id, array['owner']::public.membership_role[]))
    )
  );

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete
  on public.invitations
  for delete
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

-- Defense in depth, matching audit_logs' style: even if a policy were ever
-- added by mistake, UPDATE stays blocked at the grant level too.
revoke update on public.invitations from anon, authenticated;
