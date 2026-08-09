-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: public.create_organization() RPC
--
-- Why this exists (real bug found and fixed during LOT 2 verification, not
-- a hypothetical): PostgreSQL RLS's INSERT ... RETURNING re-checks the
-- table's SELECT policy against the row being returned, and does so before
-- any AFTER ROW trigger for that same INSERT has fired. Confirmed against
-- this exact schema and reproduced on a minimal trigger-less table too —
-- this is general Postgres RLS behavior, not specific to our trigger.
--
-- Consequence for a bare client-facing INSERT policy on organizations: a
-- brand-new user creating their first organization via
-- `insert into organizations (...) returning *` (which is exactly what
-- PostgREST/supabase-js generate for `.insert(...).select()`, the normal
-- way a client gets the created row back) fails with "new row violates
-- row-level security policy for table organizations". The organizations
-- SELECT policy requires private.is_org_member(id), which is only made
-- true by the on_organization_created trigger (see memberships
-- migration) — and that trigger's effect is not yet visible when the
-- RETURNING projection's SELECT-policy check runs. A plain INSERT with no
-- RETURNING still works and the owner membership is still created
-- correctly (verified); it is specifically INSERT ... RETURNING on the
-- brand-new row that fails.
--
-- Fix: a SECURITY DEFINER function for the org-creation bootstrap step.
-- Running as its owner (postgres, which has BYPASSRLS), RLS — including the
-- RETURNING/SELECT-policy interaction above — does not apply at all inside
-- it, so it can insert the organization and return the row in one
-- consistent, race-free operation. It still requires a real authenticated
-- caller (auth.uid() is not null) and still goes through the same
-- on_organization_created trigger to create the owner membership, so the
-- "creator becomes owner" invariant is enforced exactly once, in exactly
-- one place, regardless of which path (this RPC, or a direct table
-- INSERT without RETURNING) is used to create an organization.
--
-- The direct-table-INSERT policy (organizations_insert, added in
-- 20260809100900_tenant_rls_policies.sql) is intentionally left in place
-- alongside this RPC: it remains valid for INSERT statements that do not
-- request RETURNING/representation (e.g. admin scripts, future service-role
-- backends). Application/client code that needs the created row back
-- should call this RPC instead.
--
-- Idempotent: safe to re-run.

create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to create an organization';
  end if;

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;

  -- on_organization_created (AFTER INSERT trigger on public.organizations)
  -- has already run by this point, making the caller the org's owner.
  return v_org;
end;
$$;

comment on function public.create_organization(text, text) is
  'Creates an organization and returns the created row. SECURITY DEFINER bootstrap RPC — use this from client code instead of a bare INSERT ... RETURNING, which fails RLS for a brand-new org (see migration comment). The calling user becomes owner via the existing on_organization_created trigger.';

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
