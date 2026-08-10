-- FadeUp — Shop access management
-- Migration: location-scoped staff invitations
--
-- Adds an optional location_id to public.invitations (CLAUDE.md section
-- 13: "location scope" as an invitation field) so an owner/manager can
-- invite someone to a specific location, not just the organization at
-- large. Reuses the existing invitations table/accept_invitation() RPC —
-- no new table, per section 13's explicit "do not create duplicate tables
-- if valid invitation infrastructure already exists".
--
-- On acceptance, the invited location becomes the new staff member's
-- staff_profiles.location_id (their "primary location", already a field
-- staff_profiles has had since LOT 6 — this migration is what actually
-- populates it from an invitation instead of leaving it null until an
-- owner/manager sets it by hand afterward).
--
-- Idempotent: safe to re-run.

alter table public.invitations
  add column if not exists location_id uuid references public.locations (id) on delete set null;

comment on column public.invitations.location_id is
  'Optional location scope for this invitation — becomes the accepted member''s staff_profiles.location_id. NULL means no specific location was named.';

-- Tenant-consistency invariant, same pattern as
-- staff_profiles.location_id (20260809120000): location_id, if set, must
-- belong to the SAME organization_id as the invitation itself — enforced
-- at the trigger level, not only RLS, so it holds for any write path.
create or replace function public.check_invitation_location_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'invitations.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_check_location_consistency on public.invitations;
create trigger invitations_check_location_consistency
  before insert or update on public.invitations
  for each row execute function public.check_invitation_location_consistency();

-- get_invitation_by_token: surface the location name on the accept screen ---
-- DROP first: Postgres refuses `create or replace` when the RETURNS TABLE
-- column set itself changes (adding location_name here), not just the body.
drop function if exists public.get_invitation_by_token(text);

create function public.get_invitation_by_token(p_token text)
returns table (
  organization_name text,
  role public.membership_role,
  email text,
  location_name text,
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
    l.name,
    i.expires_at,
    i.expires_at < now(),
    i.accepted_at is not null,
    i.revoked_at is not null
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.locations l on l.id = i.location_id
  where i.token = p_token;
$$;

comment on function public.get_invitation_by_token(text) is
  'Public (anon-callable) lookup of an invitation by token for rendering an accept screen. Returns no rows for an unknown token.';

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- accept_invitation: apply the location scope to the new staff_profiles row ---
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

  -- The AFTER INSERT trigger on memberships (handle_new_membership) has
  -- already created a staff_profiles row for a fresh membership by this
  -- point — apply the invitation's location scope to it, if one was set.
  -- ON CONFLICT's UPDATE path (re-accepting/upgrading an existing member)
  -- still has a pre-existing staff_profiles row to update the same way.
  if v_invitation.location_id is not null then
    update public.staff_profiles
    set location_id = v_invitation.location_id
    where organization_id = v_invitation.organization_id and user_id = (select auth.uid());
  end if;

  update public.invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return v_membership;
end;
$$;

comment on function public.accept_invitation(text) is
  'Redeems an invitation token for the calling authenticated user: creates/upgrades their membership, applies the invitation''s location scope (if any) to their staff_profiles row, and marks the invitation accepted. Requires the caller''s auth email to match the invitation email.';

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
