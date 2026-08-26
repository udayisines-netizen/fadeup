-- FadeUp — R1B: every existing customer already has a Passport
--
-- Constitution §2.2 says a Passport cannot be missing. Before this migration
-- most are, because a passport row only ever appeared when a customer opened
-- the Passport screen and saved something.
--
-- Two populations, in order:
--
--   1. customers with a customer_profiles row and NO passport   -> issue one
--   2. passports that exist but predate passport_number         -> number them
--
-- Both are set-based and idempotent. Re-running does nothing, because both are
-- predicated on the absence they fix.
--
-- issued_at for a backfilled passport is now(), NOT created_at. That is the
-- honest value: the NUMBER was issued today. Backdating it to when the
-- customer first saved a haircut preference would claim FadeUp had issued an
-- identifier it had not yet invented. created_at still records when the
-- passport content first existed, so nothing is lost.
--
-- After both steps the columns become NOT NULL. That is safe because the
-- BEFORE INSERT trigger from 20260826100500 stamps both on every future row,
-- and it converts "a passport without a number" from a state that must be
-- checked for into one the database refuses to represent.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Issue the missing Passports
--
-- Anchored on customer_profiles, this codebase's own definition of a
-- registered customer. Accounts that never touched the customer app — including
-- every professional and platform admin login — deliberately get nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_issued integer;
begin
  insert into public.customer_passports (user_id)
  select cp.user_id
  from public.customer_profiles cp
  where not exists (
    select 1 from public.customer_passports p where p.user_id = cp.user_id
  )
  on conflict (user_id) do nothing;

  get diagnostics v_issued = row_count;
  raise notice 'R1B Passport backfill: % Passports issued to existing customers', v_issued;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Number the Passports that already existed
--
-- The BEFORE INSERT trigger cannot help these — they were inserted before it
-- existed. A loop, because each row needs its own draw from the CSPRNG and its
-- own uniqueness check; a set-based update would need a correlated random per
-- row anyway. Deterministic ordering so a partial run resumes predictably.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_candidate text;
  v_attempt integer;
  v_numbered integer := 0;
begin
  for r in
    select id from public.customer_passports
    where passport_number is null
    order by created_at, id
  loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_candidate := private.generate_passport_number();
      exit when not exists (
        select 1 from public.customer_passports where passport_number = v_candidate
      );
      if v_attempt >= 5 then
        raise exception 'could not allocate a unique Passport number after % attempts', v_attempt
          using errcode = 'P0001';
      end if;
    end loop;

    -- guard_passport_identity permits exactly this write and no other: it
    -- fires only when old.passport_number IS NOT NULL, so first issuance is
    -- allowed and every later change is refused. Step 3 below then makes the
    -- column NOT NULL, which closes the allowance permanently — from that
    -- point the guard is unconditional.
    update public.customer_passports
    set passport_number = v_candidate,
        issued_at = coalesce(issued_at, now())
    where id = r.id;

    v_numbered := v_numbered + 1;
  end loop;

  raise notice 'R1B Passport backfill: % pre-existing Passports given a durable number', v_numbered;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Assert, then tighten
--
-- The assertions come first so a failure names the actual problem rather than
-- surfacing as an opaque NOT NULL violation.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing integer;
  v_unnumbered integer;
  v_dupes integer;
begin
  select count(*) into v_missing
  from public.customer_profiles cp
  where not exists (select 1 from public.customer_passports p where p.user_id = cp.user_id);
  if v_missing > 0 then
    raise exception 'R1B Passport backfill incomplete: % registered customers still have no Passport', v_missing
      using errcode = 'P0001';
  end if;

  select count(*) into v_unnumbered from public.customer_passports where passport_number is null;
  if v_unnumbered > 0 then
    raise exception 'R1B Passport backfill incomplete: % Passports still have no number', v_unnumbered
      using errcode = 'P0001';
  end if;

  select count(*) into v_dupes from (
    select passport_number from public.customer_passports
    group by passport_number having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'R1B Passport backfill produced % duplicate numbers', v_dupes
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports'
      and column_name = 'passport_number' and is_nullable = 'YES'
  ) then
    alter table public.customer_passports alter column passport_number set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports'
      and column_name = 'issued_at' and is_nullable = 'YES'
  ) then
    alter table public.customer_passports alter column issued_at set not null;
  end if;
end $$;

-- With the column NOT NULL the partial predicate on the unique index is dead
-- weight, but replacing an index is a lock this migration has no reason to
-- take. It stays as-is and still enforces uniqueness over every row.
