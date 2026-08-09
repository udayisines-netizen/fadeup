-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: shared updated_at trigger function
--
-- Every mutable table in this schema carries created_at/updated_at.
-- updated_at is maintained server-side by this trigger, never trusted from
-- client input. Attach with:
--   create trigger <table>_set_updated_at
--     before update on public.<table>
--     for each row execute function public.set_updated_at();
--
-- Excluded from audit_logs by design: audit_logs is append-only and has no
-- updated_at column (see 20260809100600_audit_logs.sql).
--
-- Idempotent: safe to re-run (create or replace).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: sets NEW.updated_at = now() on every UPDATE of the row it is attached to.';
