-- FadeUp — R1: backfill durable professional identities
--
-- Separate from 20260824100000_professional_identity.sql on purpose: schema
-- migration and data migration are kept apart so each is understandable and
-- recoverable on its own (mission §10).
--
-- WHAT IT DOES
--
-- One `professionals` row per DISTINCT staff_profiles.user_id that has a
-- `barbers` row, then points every barbers row at it.
--
-- WHY "distinct user", NOT "one per barbers row"
--
-- staff_profiles is UNIQUE (organization_id, user_id) and barbers is UNIQUE
-- (staff_profile_id), so a person who is a barber at two shops has TWO
-- barbers rows. Keying the backfill on the barbers row would mint two
-- identities for one human — precisely the duplicate-identity outcome
-- mission §99 forbids. Keying on user_id yields one identity that both
-- barbers rows point at, which is the entire point of the table.
--
-- EDGE CASES, RESOLVED AGAINST THE REAL CONSTRAINTS
--
--   * Barber in two organizations -> 2 barbers rows, 1 professionals row,
--     both professional_id values equal. Correct and intended.
--   * staff_profiles.is_active = false -> still gets an identity. Identity is
--     not activity. Nothing leaks: professionals.is_public defaults false.
--   * A barbers row whose staff_profile was deleted -> IMPOSSIBLE.
--     barbers.staff_profile_id is NOT NULL with ON DELETE CASCADE, so the
--     barbers row is deleted with it. The join below cannot lose rows.
--
-- is_public IS NOT COPIED from staff_profiles. staff_profiles.is_public
-- defaults to TRUE; professionals.is_public defaults to FALSE and public
-- presence must be opted into deliberately. The columns share a name, which
-- is exactly how that privacy regression would get introduced.
--
-- IDEMPOTENT AND RESTART-SAFE
--
-- Both statements are guarded (`on conflict do nothing`,
-- `where professional_id is null`), so re-running is a no-op and an
-- interrupted run simply resumes. This matters because MASTER replays this
-- file against a database that already contains real rows.
--
-- NOTE ON AUDITABILITY: the UPDATE fires barbers_set_updated_at, rewriting
-- barbers.updated_at for every linked row. That is a one-off, migration-wide
-- timestamp churn, not a real edit — recorded here so it is not later
-- mistaken for activity.

set lock_timeout = '5s';

do $$
declare
  v_expected integer;
  v_before integer;
  v_after integer;
  v_unlinked integer;
begin
  select count(distinct sp.user_id)
    into v_expected
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id;

  select count(*) into v_before from public.professionals;

  -- DISTINCT ON needs a deterministic tie-break, or a user with staff
  -- profiles at two shops gets an arbitrary display_name — and a restarted
  -- migration could pick a different one, making the backfill restart-safe
  -- but not idempotent in content.
  insert into public.professionals (user_id, display_name, source, claim_state)
  select distinct on (sp.user_id)
    sp.user_id,
    coalesce(nullif(btrim(sp.display_name), ''), 'Professional'),
    'fadeup',
    'claimed'
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  order by sp.user_id, sp.created_at asc, sp.id asc
  on conflict (user_id) do nothing;

  select count(*) into v_after from public.professionals;

  update public.barbers b
  set professional_id = p.id
  from public.staff_profiles sp
  join public.professionals p on p.user_id = sp.user_id
  where sp.id = b.staff_profile_id
    and b.professional_id is null;

  select count(*) into v_unlinked from public.barbers where professional_id is null;

  raise notice 'R1 professional identity backfill: % distinct barber accounts expected, professionals % -> %, barbers still unlinked: %',
    v_expected, v_before, v_after, v_unlinked;
end $$;

-- Completeness assertion.
--
-- Deliberately NOT "count(professionals) = count(distinct barber users)":
-- that equality breaks the moment a legitimate non-backfill professional
-- exists (an external Worker profile, or a barber created after this ran),
-- so it is not a re-runnable assertion. The invariant that actually matters,
-- and stays true forever, is that no barbers row is left without an identity.
do $$
declare
  v_unlinked integer;
begin
  select count(*) into v_unlinked from public.barbers where professional_id is null;
  if v_unlinked > 0 then
    raise exception 'R1 backfill incomplete: % barbers rows have no professional_id', v_unlinked;
  end if;
end $$;

-- Every backfilled identity must be internally consistent: claimed implies an
-- owner. The table CHECK already enforces this, but asserting it here turns a
-- silent future regression in the backfill query into a loud migration
-- failure.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.professionals
  where (claim_state = 'claimed') <> (user_id is not null);
  if v_bad > 0 then
    raise exception 'R1 backfill produced % professionals with claim_state/user_id disagreement', v_bad;
  end if;
end $$;
