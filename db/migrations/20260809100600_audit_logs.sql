-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: audit_logs
--
-- Append-only record of significant actions. No updated_at column by
-- design (a log entry is a fact about a point in time and is never edited)
-- and, unlike every other table in this lot, no client-facing INSERT policy
-- either (see rationale below and in
-- 20260809100900_tenant_rls_policies.sql). This migration only creates
-- structure; RLS SELECT policies are added later once the authorization
-- helpers exist. UPDATE/DELETE are revoked from anon/authenticated at the
-- grant level below, in addition to never having a policy — belt and
-- suspenders for a table whose entire value proposition is immutability.
--
-- organization_id and actor_user_id both use ON DELETE SET NULL rather than
-- CASCADE: deleting an organization or a user must not destroy the audit
-- trail that (among other things) may record that very deletion.
--
-- Idempotent: safe to re-run.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (btrim(action) <> '')
);

comment on table public.audit_logs is
  'Append-only audit trail. No client-facing UPDATE/DELETE, and no client-facing INSERT — rows are written by trusted server-side/trigger code only (SECURITY DEFINER or service_role), never directly by an authenticated user, so a row can never be forged to misattribute an action to another org or user.';

create index if not exists audit_logs_organization_id_idx on public.audit_logs (organization_id);
create index if not exists audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);
-- Composite index supports the common access pattern: "recent activity for
-- this org", ordered newest-first.
create index if not exists audit_logs_org_created_at_idx on public.audit_logs (organization_id, created_at desc);

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

-- Defense in depth: even though no INSERT/UPDATE/DELETE policy will ever be
-- created for anon/authenticated on this table, explicitly revoke the
-- table-level grants Supabase's default ALTER DEFAULT PRIVILEGES gives new
-- public-schema tables, so immutability does not rely solely on "nobody
-- wrote a policy for this."
revoke insert, update, delete on public.audit_logs from anon, authenticated;
