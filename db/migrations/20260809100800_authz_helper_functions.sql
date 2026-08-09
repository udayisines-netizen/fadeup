-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: authorization helper functions (private schema)
--
-- `private` is not in PGRST_DB_SCHEMAS (confirmed against the running
-- fadeup-supabase-rest container: only public,graphql_public are exposed),
-- so nothing in this schema is ever directly reachable over PostgREST. It
-- exists solely to hold SECURITY DEFINER helpers used inside RLS policies.
--
-- Each function:
--   - is SQL, STABLE (single evaluation is safely reusable within one
--     statement/query, and the planner can fold repeated calls)
--   - is SECURITY DEFINER with `set search_path = ''` and fully
--     schema-qualified bodies, so it cannot be hijacked via search_path
--     manipulation and always resolves public.memberships /
--     public.platform_admins regardless of caller
--   - resolves the caller's identity via (select auth.uid()) — this reads
--     the request.jwt.claims GUC for the current session, which is
--     unaffected by SECURITY DEFINER's role switch, so the function always
--     checks the real calling user, never the definer (postgres)
--   - has EXECUTE revoked from PUBLIC/anon and granted only to
--     authenticated; service_role never needs it because service_role has
--     BYPASSRLS and skips policies (and these functions) entirely
--
-- Per Supabase RLS performance guidance, every policy that calls these
-- wraps the call in `(select ...)` so it is evaluated once per statement
-- rather than once per row.
--
-- Idempotent: safe to re-run.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function private.is_org_member(uuid) is
  'True if the calling user has any membership (any role) in the given organization.';

create or replace function private.has_org_role(p_organization_id uuid, p_roles public.membership_role[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

comment on function private.has_org_role(uuid, public.membership_role[]) is
  'True if the calling user has a membership in the given organization whose role is one of p_roles.';

create or replace function private.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

comment on function private.is_platform_admin() is
  'True if the calling user is listed in public.platform_admins (platform-level super_admin).';

revoke execute on function private.is_org_member(uuid) from public, anon;
revoke execute on function private.has_org_role(uuid, public.membership_role[]) from public, anon;
revoke execute on function private.is_platform_admin() from public, anon;

grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.membership_role[]) to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
