-- FadeUp — LOT 3: authentication + onboarding
-- Migration: onboarding RPCs — invitation lookup/accept/revoke, and
-- organization+first-location bootstrap.
--
-- All SECURITY DEFINER, set search_path = '', fully schema-qualified bodies,
-- EXECUTE revoked from PUBLIC and granted explicitly — same pattern as the
-- private.* helpers and create_organization() from LOT 2.
--
-- Idempotent: safe to re-run.

-- get_invitation_by_token ----------------------------------------------------
-- Lets an unauthenticated (or authenticated-but-not-yet-a-member) visitor
-- render "you've been invited to join {org} as {role}" without exposing the
-- invitations table itself. Returns zero rows for an unknown token rather
-- than raising, so a bad/guessed token just renders as "not found" — the
-- token itself (32 random bytes, see application code) is the only thing
-- that gates this, matching how Supabase's own invite links work.
create or replace function public.get_invitation_by_token(p_token text)
returns table (
  organization_name text,
  role public.membership_role,
  email text,
  expires_at timestamptz,
  is_expired boolean,
  is_accepted boolean,
  is_revoked boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    o.name,
    i.role,
    i.email,
    i.expires_at,
    i.expires_at < now(),
    i.accepted_at is not null,
    i.revoked_at is not null
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token;
$$;

comment on function public.get_invitation_by_token(text) is
  'Public (anon-callable) lookup of an invitation by token for rendering an accept screen. Returns no rows for an unknown token.';

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- accept_invitation -----------------------------------------------------------
-- The only path that turns an invitation into a membership. Requires an
-- authenticated caller whose auth.users.email matches the invitation's email
-- (case-insensitively) — this stops an invite link from being redeemed by a
-- different account than the one it was actually issued to, even though the
-- token itself is unguessable. `for update` locks the invitation row so two
-- concurrent accept attempts on the same token can't both succeed.
create or replace function public.accept_invitation(p_token text)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
  v_caller_email text;
  v_membership public.memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to accept an invitation';
  end if;

  select * into v_invitation
  from public.invitations
  where token = p_token
  for update;

  if not found then
    raise exception 'invitation not found';
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

  select email into v_caller_email from auth.users where id = (select auth.uid());

  if v_caller_email is null or lower(v_caller_email) <> v_invitation.email then
    raise exception 'this invitation was issued to a different email address';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (v_invitation.organization_id, (select auth.uid()), v_invitation.role)
  on conflict (organization_id, user_id)
  do update set role = excluded.role
  returning * into v_membership;

  update public.invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return v_membership;
end;
$$;

comment on function public.accept_invitation(text) is
  'Redeems an invitation token for the calling authenticated user: creates/upgrades their membership and marks the invitation accepted. Requires the caller''s auth email to match the invitation email.';

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- revoke_invitation -------------------------------------------------------
-- Owner/manager-only cancellation of a still-pending invitation. Exists as
-- an RPC (not a table UPDATE policy) so invitations keeps zero client-facing
-- UPDATE surface at the grant level — see 20260809110000_invitations.sql.
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not (select private.has_org_role(v_invitation.organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to revoke this invitation';
  end if;

  update public.invitations
  set revoked_at = now()
  where id = p_invitation_id
  returning * into v_invitation;

  return v_invitation;
end;
$$;

comment on function public.revoke_invitation(uuid) is
  'Owner/manager cancels a pending invitation. Raises if the caller is not owner/manager of the invitation''s organization.';

revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- complete_organization_onboarding -----------------------------------------
-- Atomic "create my shop" step: organization + owner membership (via the
-- existing on_organization_created trigger) + first location, in one
-- function call. If the location insert fails for any reason, the whole
-- call rolls back — including the organization row and its owner membership
-- — so onboarding can never leave a half-created organization behind.
create or replace function public.complete_organization_onboarding(
  p_org_name text,
  p_org_slug text,
  p_location_name text,
  p_timezone text default 'UTC'
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_location public.locations;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to create an organization';
  end if;

  select * into v_org from public.create_organization(p_org_name, p_org_slug);

  insert into public.locations (organization_id, name, timezone)
  values (v_org.id, p_location_name, p_timezone)
  returning * into v_location;

  return query select v_org.id, v_org.name, v_org.slug, v_location.id, v_location.name;
end;
$$;

comment on function public.complete_organization_onboarding(text, text, text, text) is
  'Atomic onboarding bootstrap: creates an organization (caller becomes owner via the existing trigger) and its first location in one transaction. Client code should call this instead of separate organization/location inserts.';

revoke execute on function public.complete_organization_onboarding(text, text, text, text) from public, anon;
grant execute on function public.complete_organization_onboarding(text, text, text, text) to authenticated;
