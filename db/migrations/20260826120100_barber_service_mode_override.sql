-- FadeUp — SERVICE MODE: the barber's persistent override
--
-- WHY THIS COLUMN IS ON public.barbers AND NOT ON public.professionals
--
-- R1B deliberately split two things that had been one:
--
--   public.professionals   durable, organization-INDEPENDENT public identity.
--                          It survives leaving a shop, being deleted as a
--                          staff account, and being claimed later. It is what
--                          a follower follows and what a Passport remembers.
--
--   public.barbers         the OPERATIONAL placement: this professional, taking
--                          appointments, for this organization, right now.
--
-- Service mode is operational state. "I am taking walk-ins only today" is a
-- fact about a shift at an establishment, not a fact about a person. Putting it
-- on `professionals` would be convenient and would be wrong twice over:
--
--   1. A professional will eventually work in more than one establishment
--      (R18). Their mode can legitimately differ per establishment — walk-ins
--      at the busy high-street shop, appointments only at the quiet one. A
--      column on the durable identity can hold exactly one answer and would
--      force both shops to agree.
--   2. It would make the durable identity mutable operational state, which is
--      precisely the coupling R1B paid to remove. A professional whose account
--      is erased still has appointments and a Passport; they must not still
--      have an opinion about today's walk-in policy.
--
-- So it goes on the placement row. `barbers` is the right one specifically:
-- staff_profiles covers any role (a receptionist has one, and a receptionist
-- has no service mode), while `barbers` is exactly "this staff member takes
-- appointments" — the population for which the question is meaningful.
--
-- NULL MEANS INHERIT, AND INHERITANCE IS REAL
--
-- The column is nullable and NULL is the default and the overwhelmingly common
-- value. It is NOT backfilled with the establishment's mode: copying the
-- location default into every barber row would turn a live inheritance edge
-- into a snapshot, and changing the establishment default would then require
-- finding and updating every barber who had not deliberately chosen anything.
-- That is the bug this comment exists to prevent someone "tidying up" into
-- existence later.
--
--   Location: hybrid
--     Barber A  override NULL              -> hybrid            (inherits)
--     Barber B  override reservation_only  -> reservation_only  (their own)
--     Barber C  override queue_only        -> queue_only        (their own)
--
--   Location default changes to queue_only:
--     Barber A  -> queue_only         (moved, no row written)
--     Barber B  -> reservation_only   (untouched — they chose)
--     Barber C  -> queue_only         (untouched — they chose, and it now agrees)
--
-- WHY NO REVOKE IS NEEDED HERE, AND WHY THAT WAS CHECKED RATHER THAN ASSUMED
--
-- `authenticated` holds INSERT and UPDATE on public.barbers as COLUMN-level
-- grants, not table-level ones — R1B already revoked the table-level privilege
-- when it protected professional_id (pg_class.relacl shows authenticated=rdDxtm,
-- with no `a` and no `w`; the per-column grants live in pg_attribute.attacl).
--
-- A new column therefore arrives with NO write privilege for any client role,
-- automatically. Re-granting a column list here — the technique 20260825100400
-- needed for appointments.booked_by_user_id, where the grant WAS table-level —
-- would be worse than unnecessary: the natural way to write it is to list "all
-- the columns", which would silently re-grant professional_id and undo R1B's
-- protection. So this file grants nothing, and the assertion block below proves
-- the column really is unwritable rather than trusting that reasoning.
--
-- SELECT is table-level and does cover the new column, which is harmless:
-- public.barbers has RLS enabled and FORCEd with no `anon` policy at all, so
-- anonymous callers read nothing from this table by any route. Public barber
-- data reaches customers only through the curated SECURITY DEFINER projections.
--
-- The only way to WRITE this column is public.set_barber_service_mode_override
-- (20260826120400), which checks the actor and writes the change-history row in
-- the same transaction.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'barbers'
      and column_name = 'service_mode_override'
  ) then
    alter table public.barbers add column service_mode_override public.service_mode;
  end if;
end $$;

comment on column public.barbers.service_mode_override is
  'This barber placement''s PERSISTENT service mode. NULL — the default and the common case — means inherit the establishment default from location_service_settings live, so changing the establishment default moves every inheriting barber with no row updates. Non-NULL means this barber normally works in that mode regardless of the establishment. Beaten by an active temporary override (see service_mode_overrides); beats the establishment default. Deliberately on the OPERATIONAL placement row rather than on the durable public.professionals identity: a professional may work in several establishments under different modes, and R1B''s identity durability must not become mutable operational state. Writable ONLY through public.set_barber_service_mode_override.';

-- A partial index: the resolver's interesting case is the small minority of
-- rows that actually carry an override. Rows inheriting NULL are never looked
-- up by this column.
create index if not exists barbers_service_mode_override_idx
  on public.barbers (service_mode_override) where service_mode_override is not null;

-- ---------------------------------------------------------------------------
-- Prove the column is unwritable by clients, and that R1B's protection of
-- professional_id is still intact.
--
-- This is an assertion, not a fix. If a future migration ever re-grants
-- table-level INSERT/UPDATE on public.barbers, this block fails the replay
-- loudly instead of letting the override quietly become client-writable.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select unnest(array['anon', 'authenticated']) as grantee,
           unnest(array['insert', 'update']) as priv
  loop
    if has_column_privilege(r.grantee, 'public.barbers', 'service_mode_override', r.priv) then
      v_bad := v_bad || format(' %s:%s', r.grantee, r.priv);
    end if;
  end loop;

  -- R1B's own protection, re-checked here because this file is the one that
  -- would break it.
  if has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'update')
     or has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'insert') then
    v_bad := v_bad || ' R1B-regression:professional_id-writable';
  end if;

  if v_bad <> '' then
    raise exception 'service_mode_override privilege check failed —%', v_bad
      using errcode = 'P0001';
  end if;
end $$;
