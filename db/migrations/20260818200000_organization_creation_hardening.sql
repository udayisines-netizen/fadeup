-- FadeUp — LOT A: organization-creation authorization hardening (SEC-01)
--
-- Closes the professional-application review bypass found in the Customer +
-- Professional audit.
--
-- THE DEFECT
--
--   20260813170000_professional_applications.sql section 6 added a real
--   server-side guard: create_organization() refuses a caller whose most
--   recent professional_application is pending_review or rejected. That is
--   correct, and it stays.
--
--   But the guard lived ONLY inside that function. The table itself still
--   carried, from 20260809100900_tenant_rls_policies.sql:
--
--       create policy organizations_insert ... to authenticated
--         with check (true);
--
--   and `authenticated` still held the INSERT privilege that Supabase grants
--   by default on public tables. So the whole workflow was routed around by
--   one PostgREST call:
--
--       supabase.from('organizations').insert({ name, slug })
--
--   The AFTER INSERT trigger on_organization_created then wrote an owner
--   membership for auth.uid(), and the caller held a tenant. A pending
--   applicant, a rejected applicant, or an ordinary customer account could
--   all self-activate. No frontend guard could see it, and RequireProAccess
--   already documents that it is UX rather than the security boundary.
--
-- THE FIX — three independent layers, so no single future mistake reopens it
--
--   1. GRANT. Revoke INSERT on public.organizations from anon and
--      authenticated. Every legitimate creation path is already a SECURITY
--      DEFINER function owned by the migration role, and a DEFINER function
--      executes with the owner's privileges — so removing the client grant
--      costs those paths nothing. Verified: the only three `insert into
--      public.organizations` statements in this repository are inside
--      create_organization() (20260809101000, redefined 20260813170000) and
--      review_professional_application() (20260813170000); no frontend code
--      writes the table (only reads and marketplace_visible updates).
--
--   2. POLICY. Drop organizations_insert entirely rather than weakening it
--      to `with check (false)`. Absence of a policy is this schema's
--      established way of saying "no client write path at all" — the same
--      posture invitations, platform_members, platform_audit_log and
--      appointment_claim_tokens already take. A policy that exists but can
--      never pass invites someone to "fix" it later.
--
--   3. TRIGGER. A BEFORE INSERT guard that requires a transaction-local flag
--      which only the sanctioned RPCs set. This is the layer that survives a
--      future migration accidentally re-granting INSERT or re-adding a
--      permissive policy, and it also covers any role that bypasses RLS
--      (BYPASSRLS holders skip policies; they do not skip triggers).
--
--      The flag is set with set_config(..., is_local => true), so it is
--      scoped to the current transaction and cannot leak into a later
--      statement on a pooled connection. Same mechanism, and same reasoning,
--      as the pre-existing fadeup.skip_org_owner_membership flag.
--
--      Deliberate escape hatch: when there is no JWT identity at all
--      ((select auth.uid()) is null) the trigger stands down. That is an
--      operator psql session, a service_role job, or a restore — never a
--      client request, because anon and authenticated both carry a JWT and
--      neither can reach this table any more anyway. This mirrors the
--      identical, already-shipped decision in
--      guard_professional_application_update().
--
-- WHAT DOES NOT CHANGE
--
--   * The application-status check inside create_organization() (pending and
--     rejected still refused) — untouched, and now unroutable-around.
--   * on_organization_created / handle_new_organization — untouched. A
--     legitimate creation still makes the caller the owner, and
--     review_professional_application still suppresses that so the APPLICANT
--     becomes owner rather than the reviewer.
--   * organizations_select / _update / _delete — untouched. Shop A still
--     cannot read or write Shop B, and owner/manager can still edit and
--     publish their own organization.
--   * complete_organization_onboarding() — untouched. It delegates to
--     create_organization(), so it inherits the flag automatically.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Remove the client-facing INSERT surface.
-- ---------------------------------------------------------------------------

revoke insert on public.organizations from anon, authenticated;

drop policy if exists organizations_insert on public.organizations;

comment on table public.organizations is
  'Tenant root. Every business resource must have a provable ownership path to a row here. NO client-facing INSERT path exists: the INSERT grant is revoked from anon/authenticated and there is deliberately no INSERT policy. Organizations are created exclusively by create_organization() (self-serve, refuses pending/rejected applicants) and review_professional_application() (platform approval), both SECURITY DEFINER, both of which set fadeup.org_creation_authorized for the guard trigger below.';

-- ---------------------------------------------------------------------------
-- 2. The guard trigger — the layer that does not depend on grants or policies.
-- ---------------------------------------------------------------------------

create or replace function private.assert_organization_creation_authorized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Set by the sanctioned SECURITY DEFINER creation RPCs, transaction-local.
  -- current_setting(..., true) returns null instead of raising when the GUC
  -- was never set in this session, so an unflagged insert falls through to
  -- the checks below rather than erroring for the wrong reason.
  if coalesce(current_setting('fadeup.org_creation_authorized', true), '') = 'on' then
    return new;
  end if;

  -- review_professional_application() already raises
  -- fadeup.skip_org_owner_membership for exactly one statement — the
  -- approval insert — so it is, today, the approval path's own marker.
  -- Accepting it here keeps THIS migration independently correct: platform
  -- approval keeps working the moment this migration lands, with no edit to
  -- that function. The LOT B migration, which has to touch the approval
  -- function anyway to create the first location, additionally raises the
  -- dedicated flag above, at which point this branch is belt-and-braces.
  if coalesce(current_setting('fadeup.skip_org_owner_membership', true), '') = 'on' then
    return new;
  end if;

  -- No JWT identity: an operator psql session, a service_role job, or a
  -- restore. Not a client request — anon and authenticated no longer hold
  -- the INSERT privilege at all. Same escape hatch, same reasoning, as
  -- public.guard_professional_application_update().
  if (select auth.uid()) is null then
    return new;
  end if;

  raise exception 'organizations may only be created through create_organization() or review_professional_application()'
    using errcode = '42501';
end;
$$;

comment on function private.assert_organization_creation_authorized() is
  'BEFORE INSERT guard on public.organizations. Rejects any creation that did not come through a sanctioned SECURITY DEFINER RPC (which sets the transaction-local fadeup.org_creation_authorized flag). Independent of grants and RLS policies, so it still holds if either is loosened later, and it also covers BYPASSRLS roles, which skip policies but not triggers.';

revoke execute on function private.assert_organization_creation_authorized() from public, anon, authenticated;

drop trigger if exists organizations_assert_creation_authorized on public.organizations;
create trigger organizations_assert_creation_authorized
  before insert on public.organizations
  for each row execute function private.assert_organization_creation_authorized();

-- ---------------------------------------------------------------------------
-- 3. Teach the two legitimate creation paths to raise the flag.
--
--    create_organization(): body preserved verbatim from
--    20260813170000_professional_applications.sql section 6 — the pending/
--    rejected application check is unchanged — with only the flag added
--    around the insert.
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_status public.professional_application_status;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to create an organization';
  end if;

  select a.status into v_status
    from public.professional_applications a
    where a.user_id = (select auth.uid())
    order by a.submitted_at desc
    limit 1;

  if v_status = 'pending_review' then
    raise exception 'your professional application is still being reviewed';
  elsif v_status = 'rejected' then
    raise exception 'your professional application was not approved';
  end if;

  -- Transaction-local, and cleared immediately after the insert so a later
  -- statement in the same transaction cannot ride on it.
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);

  -- on_organization_created (AFTER INSERT trigger on public.organizations)
  -- has already run by this point, making the caller the org's owner.
  return v_org;
end;
$$;

comment on function public.create_organization(text, text) is
  'The only self-serve path that creates an organization. Owned by the calling user via on_organization_created. Refuses callers whose most recent professional application is pending or rejected — otherwise an applicant could self-activate and bypass platform review. Raises fadeup.org_creation_authorized for the BEFORE INSERT guard trigger; the table itself grants no client INSERT.';

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
