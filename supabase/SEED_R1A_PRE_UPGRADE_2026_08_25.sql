-- ============================================================================
-- FadeUp — SEED: a pre-R1A database, with the mess R1A has to survive
--
-- Loaded into a DISPOSABLE container between the base migration replay and the
-- MASTER apply:
--
--   scripts/disposable-db-test.sh \
--     --skip-from 20260825100000 \
--     --seed   supabase/SEED_R1A_PRE_UPGRADE_2026_08_25.sql \
--     --master supabase/MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql \
--     --verify supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--
-- NEVER run against a real database. Every row here is deliberately corrupt.
--
-- WHY THIS EXISTS
--
-- Applying MASTER to an empty schema proves the DDL parses. It proves nothing
-- about the parts of R1A that only do anything when data is present:
--
--   * the completed_at backfill, which must fill one row and REFUSE to invent
--     a value for the other;
--   * the queue monotonicity CHECK, added NOT VALID precisely because rows
--     like the one below already exist — the migration must not fail, and must
--     not force validation through;
--   * ALTER ... VALIDATE CONSTRAINT on appointments_barber_id_fkey, which is
--     only meaningful against existing appointment rows;
--   * the fact that R1A does NOT retroactively rewrite history.
--
-- This runs against the PRE-R1A schema, so it must not reference completed_at
-- or booked_by_user_id — neither column exists yet.
--
-- Fixed UUIDs (aaaaaaaa-…) so the VERIFY suite can find these rows by id.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000010',
   'authenticated', 'authenticated', 'seed-owner@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000011',
   'authenticated', 'authenticated', 'seed-barber@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000012',
   'authenticated', 'authenticated', 'seed-squatter@fadeup.test', 'x', '{}', '{}', now(), now());

do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug, marketplace_visible)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'Pre-R1A Shop', 'r1a-seed-pre', true);
end $$;

insert into public.locations (id, organization_id, name, city, country, is_active)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Seed Main', 'Lyon', 'FR', true);

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Seed Fade', 30, 2500, true);

insert into public.memberships (organization_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000010', 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011', 'barber');

insert into public.barbers (id, organization_id, staff_profile_id)
select 'aaaaaaaa-0000-4000-8000-000000000004', sp.organization_id, sp.id
from public.staff_profiles sp
where sp.user_id = 'aaaaaaaa-0000-4000-8000-000000000011';

-- ---------------------------------------------------------------------------
-- 1. Two completed appointments with different amounts of evidence
--
-- complete_appointment() is the only writer of status='completed' AND
-- decided_at together, so on row A the decided_at IS a real record of when a
-- human marked the service done, and the backfill may trust it.
--
-- Row B is what a raw PATCH produced before R1A: completed, with no evidence
-- of when. It is the one that matters. Its scheduled start is right there in
-- starts_at and it must NOT be copied into completed_at — a slot's start time
-- is when the appointment was DUE to begin, not proof that it happened. Row B
-- must come out of the migration with completed_at still NULL.
-- ---------------------------------------------------------------------------

insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id, customer_name,
   starts_at, ends_at, status, decided_at)
values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004',
   'aaaaaaaa-0000-4000-8000-000000000003', 'Has evidence',
   timestamptz '2026-08-01 09:00:00+00', timestamptz '2026-08-01 09:30:00+00',
   'completed', timestamptz '2026-08-01 09:41:00+00'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004',
   'aaaaaaaa-0000-4000-8000-000000000003', 'No evidence',
   timestamptz '2026-08-02 09:00:00+00', timestamptz '2026-08-02 09:30:00+00',
   'completed', null);

-- ---------------------------------------------------------------------------
-- 2. A queue entry whose timestamps are causally impossible
--
-- completed BEFORE service started BEFORE called, the whole thing backdated —
-- exactly the shape a single unguarded UPDATE produced on the live schema.
-- This is why queue_entries_timestamps_monotonic is added NOT VALID: a
-- database that already contains rows like this must still be able to apply
-- R1A. The migration must leave the constraint unvalidated and say so, not
-- fail and not quietly rewrite the row.
-- ---------------------------------------------------------------------------

insert into public.queue_entries
  (id, organization_id, location_id, barber_id, customer_name, status,
   called_at, service_started_at, completed_at)
values
  ('aaaaaaaa-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004',
   'Forged queue row', 'completed',
   timestamptz '2026-07-01 12:00:00+00',
   timestamptz '2026-07-01 11:55:00+00',
   timestamptz '2026-07-01 11:40:00+00');

-- ---------------------------------------------------------------------------
-- 3. A squat that already happened
--
-- A customer row owned by the squatter, carrying someone else's phone, with a
-- booking already attached. R1A stops NEW bookings from attaching this way; it
-- does not retroactively unpick existing links, because the database cannot
-- tell a squat apart from a legitimate historical link and guessing would
-- silently detach real customers from real bookings. The VERIFY suite asserts
-- this row is left ALONE — the honest outcome, and one worth stating out loud
-- rather than discovering later.
-- ---------------------------------------------------------------------------

insert into public.customers (id, organization_id, name, phone, email, user_id)
values ('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Squatter', '+33699990000', 'seed-victim@fadeup.test',
        'aaaaaaaa-0000-4000-8000-000000000012');

insert into public.appointments
  (id, organization_id, location_id, barber_id, service_id, customer_name,
   customer_phone, customer_id, starts_at, ends_at, status)
values
  ('aaaaaaaa-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004',
   'aaaaaaaa-0000-4000-8000-000000000003', 'Victim', '+33699990000',
   'aaaaaaaa-0000-4000-8000-000000000005',
   timestamptz '2026-08-03 09:00:00+00', timestamptz '2026-08-03 09:30:00+00',
   'confirmed');

commit;

-- ============================================================================
-- Seeded. Next: apply MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql, which
-- must COMMIT despite every row above, then run the VERIFY suite — section 11
-- asserts what happened to these specific rows.
-- ============================================================================
