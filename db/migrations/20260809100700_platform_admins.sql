-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: platform_admins
--
-- Platform-level super_admin representation.
--
-- Decision: a dedicated allow-list table of user ids, NOT a boolean column
-- on public.profiles. Rationale:
--   - profiles is a table every authenticated user can UPDATE their own row
--     of (see 20260809100200_profiles.sql: profiles_update_own). A boolean
--     is_super_admin column living on that same row would sit directly next
--     to client-writable columns; any UPDATE policy that isn't perfectly
--     column-scoped forever, on every future migration touching profiles,
--     becomes a privilege-escalation risk. A single missed `with check`
--     tightening away from disaster is not an acceptable design for the
--     most powerful permission in the system.
--   - A separate table can be (and here, is) given NO client-facing
--     INSERT/UPDATE/DELETE policy at all, for any role. Granting or
--     revoking platform-admin status becomes an operator action (direct SQL
--     via a trusted connection, or a future service_role-only admin
--     endpoint with its own audit trail) instead of something that shares
--     any RLS surface with ordinary user self-service.
--   - It composes cleanly with the RLS helper-function pattern used
--     everywhere else in this schema (private.is_platform_admin(), added in
--     20260809100800_authz_helper_functions.sql) and is trivial to audit:
--     "who is a platform admin" is one small table, not a scan for a
--     boolean flag buried in per-user rows.
--
-- Idempotent: safe to re-run.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Allow-list of platform-level super_admin user ids. Operator-managed only — no client-facing write path exists in this schema.';

drop trigger if exists platform_admins_set_updated_at on public.platform_admins;
create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function public.set_updated_at();

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

-- A user may confirm their own platform-admin status (so the frontend can
-- conditionally show admin affordances) but cannot enumerate other admins,
-- and has no write path at all — not even to their own row.
drop policy if exists platform_admins_select_own on public.platform_admins;
create policy platform_admins_select_own
  on public.platform_admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Defense in depth to match audit_logs: no policy will ever grant
-- INSERT/UPDATE/DELETE here for anon/authenticated, and the table-level
-- grant is revoked outright.
revoke insert, update, delete on public.platform_admins from anon, authenticated;
