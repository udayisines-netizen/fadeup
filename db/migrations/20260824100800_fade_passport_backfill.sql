-- FadeUp — R1: issue Fade Passports to existing customers
--
-- Separate from 20260824100700 so schema and data stay independently
-- reviewable and recoverable (mission §10).
--
-- Two populations, both handled idempotently:
--
--   1. registered customers with NO passport at all — issue one;
--   2. passports created before this migration, which have no number —
--      assign one, touching nothing else on the row.
--
-- Anchored to customer_profiles, matching this codebase's definition of a
-- registered customer (see the header of 20260824100700).
--
-- RESTART-SAFE AND RE-RUNNABLE: every statement is guarded, so re-running is
-- a no-op and an interrupted run resumes. This matters because MASTER replays
-- it against a database that already holds real customers.

set lock_timeout = '5s';

do $$
declare
  v_customers integer;
  v_missing integer;
  v_unnumbered integer;
  v_after integer;
begin
  select count(*) into v_customers from public.customer_profiles;

  select count(*) into v_missing
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);

  select count(*) into v_unnumbered
  from public.customer_passports where passport_number is null;

  -- SET-BASED, not row-by-row.
  --
  -- MASTER wraps every R1 migration in ONE transaction, and an earlier one
  -- takes a brief ACCESS EXCLUSIVE lock on `appointments` to add a column.
  -- That lock is held until COMMIT. A PL/pgSQL loop doing one INSERT plus one
  -- uniqueness probe per registered customer would therefore hold bookings
  -- and the queue unreadable for as long as the loop runs — minutes, on a
  -- real customer base. Two set-based statements keep that window short.
  --
  -- gen_random_bytes() is VOLATILE, so it is evaluated once per row and each
  -- row gets its own number. At 80 bits a collision inside one statement is
  -- not a real event; if one ever occurred the unique index would raise and
  -- the migration would fail loudly rather than issue a duplicate — which is
  -- the correct outcome, and re-running resumes cleanly.

  -- 1. Issue missing passports.
  insert into public.customer_passports (user_id, passport_number, issued_at)
  select cp.user_id,
         'FP' || upper(encode(extensions.gen_random_bytes(10), 'hex')),
         now()
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id)
  on conflict (user_id) do nothing;

  -- 2. Number the pre-existing passports.
  update public.customer_passports
  set passport_number = 'FP' || upper(encode(extensions.gen_random_bytes(10), 'hex')),
      issued_at = coalesce(issued_at, created_at, now())
  where passport_number is null;

  select count(*) into v_after from public.customer_passports;

  raise notice 'R1 Fade Passport backfill: % registered customers, % had no passport, % had no number, passports now %',
    v_customers, v_missing, v_unnumbered, v_after;
end $$;

-- ---------------------------------------------------------------------------
-- Verification (§70) — assert the invariants, do not merely hope for them.
-- ---------------------------------------------------------------------------

-- Every registered customer has exactly one Passport. "Exactly one" is
-- already guaranteed structurally by customer_passports.user_id being UNIQUE,
-- so what needs asserting is "at least one".
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);

  if v_missing > 0 then
    raise exception 'R1 passport backfill incomplete: % registered customers still have no Fade Passport', v_missing;
  end if;
end $$;

-- Every Passport has a number.
do $$
declare
  v_unnumbered integer;
begin
  select count(*) into v_unnumbered from public.customer_passports where passport_number is null;
  if v_unnumbered > 0 then
    raise exception 'R1 passport backfill incomplete: % passports have no number', v_unnumbered;
  end if;
end $$;

-- No duplicate numbers. The partial unique index makes this impossible; the
-- assertion exists so that a future change which weakens the index fails
-- loudly here instead of silently issuing two identical passport numbers.
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes from (
    select passport_number from public.customer_passports
    where passport_number is not null
    group by passport_number having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception 'R1 passport backfill produced % duplicate passport numbers', v_dupes;
  end if;
end $$;
