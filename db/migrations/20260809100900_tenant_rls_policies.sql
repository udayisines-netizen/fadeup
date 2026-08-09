-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: RLS policies for organizations, memberships, locations,
-- audit_logs
--
-- Core invariant this migration exists to enforce: a member of organization
-- A must never be able to read or write organization B's rows in any of
-- these tables. Every policy below resolves through
-- private.is_org_member() / private.has_org_role(), which in turn resolve
-- through public.memberships — the one source of truth for "who belongs to
-- which org, with what role."
--
-- anon gets no policy on any of these tables (`to authenticated` only), so
-- the default-deny RLS from each table's own migration continues to apply
-- to anon unchanged: zero access.
--
-- Idempotent: safe to re-run (drop + create each policy).

-- organizations -------------------------------------------------------------
-- select: any member of the org, or a platform admin (read-only support
--   access — see platform_admins migration for why platform admin power is
--   scoped to SELECT only, never write, in this schema).
-- insert: any authenticated user may create a new organization. This is the
--   org-creation/onboarding entry point; the AFTER INSERT trigger on
--   organizations (handle_new_organization, see memberships migration)
--   makes the creator its owner in the same statement.
-- update: owner or manager.
-- delete: owner only.

drop policy if exists organizations_select on public.organizations;
create policy organizations_select
  on public.organizations
  for select
  to authenticated
  using (
    (select private.is_org_member(id))
    or (select private.is_platform_admin())
  );

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert
  on public.organizations
  for insert
  to authenticated
  with check (true);

drop policy if exists organizations_update on public.organizations;
create policy organizations_update
  on public.organizations
  for update
  to authenticated
  using ((select private.has_org_role(id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete
  on public.organizations
  for delete
  to authenticated
  using ((select private.has_org_role(id, array['owner']::public.membership_role[])));

-- memberships -----------------------------------------------------------------
-- select: any member of the org can see the org's full member list (and
--   roles) — needed for staff rosters/management UI. Plus platform admin.
-- insert: owner or manager (adding a member to the org), with the same
--   owner-only guard as update below — a manager cannot bypass the
--   "only an owner may grant the owner role" rule by directly INSERTing a
--   new row with role='owner' instead of UPDATEing an existing one into it.
--   Actual invitation flow/UX lands in a later lot; this is the base
--   authorization rule it will build on.
-- update: owner or manager may change a membership's role, EXCEPT that
--   only an owner may grant or hold the 'owner' role — a manager cannot
--   promote anyone (including themselves) to owner.
-- delete: owner or manager may remove a member, OR a user may remove their
--   own membership (leave the organization).
--
-- Known gap, deliberately deferred (see memberships migration comment):
-- nothing here yet prevents removing the last remaining owner of an org.

drop policy if exists memberships_select on public.memberships;
create policy memberships_select
  on public.memberships
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert
  on public.memberships
  for insert
  to authenticated
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    and (
      role <> 'owner'
      or (select private.has_org_role(organization_id, array['owner']::public.membership_role[]))
    )
  );

drop policy if exists memberships_update on public.memberships;
create policy memberships_update
  on public.memberships
  for update
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  )
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    and (
      role <> 'owner'
      or (select private.has_org_role(organization_id, array['owner']::public.membership_role[]))
    )
  );

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete
  on public.memberships
  for delete
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    or user_id = (select auth.uid())
  );

-- locations ---------------------------------------------------------------
-- select: any member of the org, or platform admin.
-- insert/update/delete: owner or manager.

drop policy if exists locations_select on public.locations;
create policy locations_select
  on public.locations
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists locations_insert on public.locations;
create policy locations_insert
  on public.locations
  for insert
  to authenticated
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

drop policy if exists locations_update on public.locations;
create policy locations_update
  on public.locations
  for update
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  )
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

drop policy if exists locations_delete on public.locations;
create policy locations_delete
  on public.locations
  for delete
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

-- audit_logs ----------------------------------------------------------------
-- select only: owner/manager of the log's organization, or platform admin.
-- Receptionists/barbers do not see the audit trail — it can contain
-- sensitive operational history (role changes, deletions, etc.) beyond what
-- a line-level staff role needs. Rows with organization_id null (reserved
-- for platform-level events, not produced by anything in this lot) are only
-- visible to platform admins.
--
-- No insert/update/delete policy for authenticated/anon, by design — see
-- the audit_logs migration. Writes happen exclusively via trusted
-- server-side/trigger code (SECURITY DEFINER or service_role), which either
-- bypasses RLS (service_role has BYPASSRLS) or would need its own dedicated
-- SECURITY DEFINER function, not a blanket client INSERT policy. This lot
-- does not yet add any such writer (no feature produces audit events yet);
-- that lands with the first feature that needs to record one.

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select
  on public.audit_logs
  for select
  to authenticated
  using (
    (
      organization_id is not null
      and (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    )
    or (select private.is_platform_admin())
  );
