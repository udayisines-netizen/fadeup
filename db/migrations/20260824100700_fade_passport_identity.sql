-- FadeUp — R1: Fade Passport identity
-- Migration: customer_passports.passport_number + automatic issuance
--
-- NO NEW TABLE. customer_passports (20260813140000) already exists and
-- already enforces exactly one passport per account — user_id is UNIQUE with
-- an FK to auth.users. Creating a `fade_passports` table because the product
-- has a name would duplicate a live entity, orphan the existing photos and
-- share links that reference it, and buy nothing.
--
-- What was genuinely missing is only this:
--
--   1. a STABLE PUBLIC IDENTIFIER for the passport (passport_number);
--   2. AUTOMATIC issuance — today a passport exists only if the customer
--      happens to create one, so "every registered customer owns exactly one
--      Fade Passport" is not true yet;
--   3. an idempotent ensure/backfill path.
--
-- WHAT "REGISTERED CUSTOMER" MEANS HERE
--
-- Anchored to customer_profiles, NOT to auth.users. That is deliberate and it
-- follows this codebase's own definition: 20260813120000_customer_identity.sql
-- states that an auth account which never touches the customer app has no
-- customer_profiles row, and that this "is a legitimate normal state". A
-- professional's or platform admin's login is not a customer and must not be
-- issued a Fade Passport.
--
-- PASSPORT NUMBER IS AN IDENTIFIER, NOT AN AUTHENTICATOR
--
-- 80 bits from gen_random_bytes(10), so the space cannot be enumerated. It is
-- deliberately NOT returned by get_shared_passport or any other anon-callable
-- function, and R1 adds no lookup-by-number path.
--
-- If a future lot adds one (a "scan my passport" flow), understand what that
-- would create: a NON-EXPIRING, NON-REVOCABLE bearer credential, strictly
-- weaker than customer_passport_shares — which already exists beside it and
-- does this properly with a hashed, expiring, revocable token. Lookup by
-- number must go through that mechanism, not around it.
--
-- WALLET IS A SEPARATE CONCEPT
--
-- Nothing here models an Apple/Google Wallet installation. A customer owns a
-- Passport whether or not they ever install it on a device; the install is a
-- different entity belonging to the lot that builds it. No column below
-- implies a device.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports' and column_name = 'passport_number'
  ) then
    alter table public.customer_passports add column passport_number text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_passports' and column_name = 'issued_at'
  ) then
    alter table public.customer_passports add column issued_at timestamptz;
  end if;
end $$;

-- Unique from the moment the column exists, so no window allows a duplicate.
-- Partial: rows predating the backfill are briefly null and must not collide
-- with each other on NULL.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'customer_passports_number_unique') then
    create unique index customer_passports_number_unique
      on public.customer_passports (passport_number) where passport_number is not null;
  end if;
end $$;

comment on column public.customer_passports.passport_number is
  'Stable public identifier for this Fade Passport. 80 bits of randomness — non-sequential and non-enumerable by design. An IDENTIFIER, NOT AN AUTHENTICATOR: it is never returned by any anon-callable function, and any future lookup-by-number flow must go through the revocable, expiring customer_passport_shares token instead of treating this value as a credential.';

comment on column public.customer_passports.issued_at is
  'When the Passport was issued. Distinct from created_at only for rows issued by the R1 backfill, where created_at predates the concept.';

-- Clients may read their own number but must never choose it.
--
-- user_id IS in the re-grant, and must be. The customer app saves a Passport
-- with a PostgREST upsert (apps/web/src/lib/queries/passport.ts —
-- `.upsert({ user_id, ... }, { onConflict: 'user_id' })`), which emits
-- ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id, ...
-- ON CONFLICT DO UPDATE requires UPDATE privilege on EVERY column in the SET
-- list, so withholding user_id makes the whole save fail with
-- "permission denied for table customer_passports".
--
-- Before this migration that was survivable, because most customers had no
-- passport row and the INSERT arm ran. The trigger below now guarantees every
-- registered customer HAS one, so the conflict arm always runs — withholding
-- user_id here would break the Fade Passport editor for 100% of customers.
--
-- Granting it is safe: the pre-existing RLS UPDATE policy pins
-- user_id = auth.uid() on both USING and WITH CHECK, and user_id is UNIQUE,
-- so a customer can neither move their passport to another account nor
-- collide with one.
--
-- passport_number and issued_at remain withheld — those the client must never
-- choose.
revoke update on public.customer_passports from authenticated, anon;
grant update (user_id, usual_haircut, fade_type, side_length, top_length,
              beard_preferences, preferences_notes, updated_at)
  on public.customer_passports to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Number generation
-- ---------------------------------------------------------------------------

create or replace function private.generate_passport_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_candidate := 'FP' || upper(encode(extensions.gen_random_bytes(10), 'hex'));

    if not exists (
      select 1 from public.customer_passports where passport_number = v_candidate
    ) then
      return v_candidate;
    end if;

    -- At 80 bits a collision is not a real event; this loop exists so that if
    -- one ever happens the answer is a different number, not a failed signup.
    if v_attempt >= 5 then
      raise exception 'could not generate a unique passport number after % attempts', v_attempt;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ensure_customer_passport
--
-- Idempotent and concurrency-safe. Arbitrates on the pre-existing user_id
-- unique index rather than doing select-then-insert, so two concurrent
-- signups (or a retried one) produce exactly one Passport.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_customer_passport(p_user_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_number text;
begin
  v_user_id := coalesce(p_user_id, (select auth.uid()));
  if v_user_id is null then
    raise exception 'ensure_customer_passport requires a user';
  end if;

  -- Only the caller's own passport may be ensured by a client session.
  -- p_user_id is accepted for the trigger and the backfill, which run with
  -- auth.uid() null.
  if (select auth.uid()) is not null
     and v_user_id <> (select auth.uid())
     and not (select private.is_platform_admin()) then
    raise exception 'ensure_customer_passport may only be called for your own account';
  end if;

  insert into public.customer_passports (user_id, passport_number, issued_at)
  values (v_user_id, private.generate_passport_number(), now())
  on conflict (user_id) do nothing;

  select passport_number into v_number
  from public.customer_passports where user_id = v_user_id;

  -- A passport that predates this migration exists but has no number yet.
  -- Assign one without disturbing anything else on the row.
  if v_number is null then
    update public.customer_passports
    set passport_number = private.generate_passport_number(),
        issued_at = coalesce(issued_at, created_at, now())
    where user_id = v_user_id and passport_number is null
    returning passport_number into v_number;
  end if;

  return v_number;
end;
$$;

comment on function public.ensure_customer_passport(uuid) is
  'Idempotent: guarantees exactly one Fade Passport, with a number, for the given account. Race-safe via the user_id unique index — concurrent or retried creation yields one passport. Callable by a customer for themselves only; the trigger and backfill pass p_user_id with no session.';

revoke execute on function public.ensure_customer_passport(uuid) from public, anon;
grant execute on function public.ensure_customer_passport(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Automatic issuance
--
-- AFTER INSERT on customer_profiles: becoming a registered customer issues
-- the Passport. This is what makes "exactly one per registered customer" true
-- rather than aspirational.
--
-- Cannot raise: a failure here would abort customer onboarding, and a missing
-- passport is recoverable (the backfill and ensure_customer_passport both fix
-- it) whereas a failed signup is not.
-- ---------------------------------------------------------------------------

create or replace function public.customer_profiles_ensure_passport()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_customer_passport(new.user_id);
  return new;
exception when others then
  raise warning 'customer_profiles_ensure_passport suppressed error for user %: %', new.user_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists customer_profiles_issue_passport on public.customer_profiles;
create trigger customer_profiles_issue_passport
  after insert on public.customer_profiles
  for each row execute function public.customer_profiles_ensure_passport();
