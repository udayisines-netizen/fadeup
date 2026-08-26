-- FadeUp — R1B: the Fade Passport becomes automatic and durable
--
-- Constitution §2.2 is unambiguous:
--
--   "Every registered customer owns exactly one Fade Passport, and it exists
--    automatically. It is not something a customer creates, opts into, or can
--    be missing."
--
-- Today it is exactly the opposite: a passport row appears only when the
-- customer fills in the Passport screen, which makes it a feature with a
-- "Get Passport" call to action rather than part of who they are.
--
-- WHAT IS ALREADY RIGHT AND MUST NOT BE REBUILT
--
-- customer_passports.user_id is already UNIQUE with an FK to auth.users, so
-- one-per-account is ALREADY a database guarantee. Photos and revocable hashed
-- share links already hang off it, with a working UI. Creating a new
-- fade_passports table would duplicate a live entity and orphan all of that.
-- Two columns and an issuance path are the entire gap.
--
-- WHO COUNTS AS A "REGISTERED CUSTOMER"
--
-- customer_profiles, not auth.users — this codebase's own definition. An
-- account that never touched the customer app deliberately has no
-- customer_profiles row (see that table's comment), and a professional's or
-- platform admin's login is not a customer. Issuing them a Passport would make
-- the number meaningless.
--
-- THE NUMBER IS AN IDENTIFIER, NOT AN AUTHENTICATOR
--
-- 80 bits from gen_random_bytes, non-sequential, so it leaks no ordering and
-- cannot be enumerated. It is NOT a credential: the credential is the
-- revocable, expiring, sha256-at-rest token in customer_passport_shares, and
-- lookup-by-number must never become an alternative to it. Nothing in this
-- migration adds a lookup-by-number path, and nothing later should without
-- revisiting that sentence.
--
-- IDEMPOTENCY IS STRUCTURAL, NOT PROCEDURAL
--
-- Issuance is `insert ... on conflict (user_id) do nothing` — never
-- select-then-insert. Concurrency and retry then yield exactly one row by
-- construction rather than by luck. The number is generated inside a BEFORE
-- INSERT trigger with a bounded retry on the unique index, so a collision (at
-- 80 bits, effectively never) is handled rather than raised.
--
-- R1A GUARANTEES PRESERVED
--
-- R1A removed the DELETE policy and revoked DELETE on this table. Nothing here
-- restores either. R1A also established that customer_passports.user_id must
-- remain UPDATE-grantable, because apps/web/src/lib/queries/passport.ts saves
-- with .upsert({ user_id, ... }, { onConflict: 'user_id' }) and
-- ON CONFLICT DO UPDATE needs UPDATE on every column in its SET list. The
-- grants below withhold the two NEW columns and leave user_id alone.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The columns
--
-- NOT NULL is deliberately deferred to the backfill migration
-- (20260826100600): a column cannot be NOT NULL in the statement that adds it
-- to a table with rows.
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

comment on column public.customer_passports.passport_number is
  'The Passport''s durable public identifier: 80 bits of gen_random_bytes, non-sequential, unique, server-generated. An IDENTIFIER, never an authenticator — the credential is the revocable hashed token in customer_passport_shares, and lookup-by-number must never become an alternative to it. Never client-supplied and never reassignable: the stamping trigger overwrites any caller value and the freeze guard rejects any later change.';

comment on column public.customer_passports.issued_at is
  'When this Passport was issued. Server-stamped once and frozen. Distinct from created_at only for rows that predate R1B, where it records the backfill rather than pretending to know when the customer first had a Passport.';

-- Uniqueness is enforced by the database, not by the generator being careful.
create unique index if not exists customer_passports_passport_number_unique
  on public.customer_passports (passport_number) where passport_number is not null;

-- ---------------------------------------------------------------------------
-- 2. Number generation
--
-- Grouped hex, because a human reads this aloud to a barber. 20 hex digits =
-- 80 bits. The FP- prefix makes a Passport number recognisable in a support
-- ticket without being confusable with any other identifier in this schema.
-- ---------------------------------------------------------------------------

create or replace function private.generate_passport_number()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_hex text;
begin
  v_hex := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  return 'FP-' || substr(v_hex, 1, 4) || '-' || substr(v_hex, 5, 4) || '-'
              || substr(v_hex, 9, 4) || '-' || substr(v_hex, 13, 4) || '-'
              || substr(v_hex, 17, 4);
end;
$$;

comment on function private.generate_passport_number() is
  '80 bits of CSPRNG, formatted FP-XXXX-XXXX-XXXX-XXXX-XXXX. Non-sequential on purpose: a sequential number would let anyone estimate how many customers FadeUp has and would make neighbouring Passports guessable.';

revoke execute on function private.generate_passport_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The number is server-owned
--
-- BEFORE INSERT: overwrite whatever the caller sent. The column grants below
-- already stop `authenticated` sending one, but this makes the guarantee hold
-- for service_role and direct SQL as well — the same defence-in-depth pattern
-- R1A used for completed_at.
--
-- The retry loop exists for the unique index, not for the entropy. At 80 bits
-- a collision is not a real event; handling it here is what stops a
-- theoretical one from surfacing as a failed customer signup.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, and both halves of that matter. As the invoker this
-- trigger could not execute private.generate_passport_number (revoked from
-- authenticated), so an ordinary client INSERT would fail with 42501; and its
-- collision check would run under RLS, seeing only the caller's own row and
-- therefore checking nothing. Owned by postgres it can do both properly.
create or replace function public.stamp_passport_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate text;
  v_attempt integer := 0;
begin
  new.issued_at := coalesce(new.issued_at, now());

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

  new.passport_number := v_candidate;
  return new;
end;
$$;

comment on function public.stamp_passport_identity() is
  'BEFORE INSERT on customer_passports. Always overwrites passport_number and issued_at with server-generated values, so no caller — client, service_role or direct SQL — can choose their own Passport number. The unique index remains the actual authority; this loop only stops a collision surfacing as a failed signup.';

drop trigger if exists customer_passports_stamp_identity on public.customer_passports;
create trigger customer_passports_stamp_identity
  before insert on public.customer_passports
  for each row execute function public.stamp_passport_identity();

-- ---------------------------------------------------------------------------
-- 4. And it is frozen
--
-- A reassignable Passport number is not an identity. The freeze must survive
-- the PostgREST upsert path, which issues ON CONFLICT DO UPDATE and therefore
-- an UPDATE on every column in its SET list — so "is distinct from" is the
-- right test, not "was mentioned".
-- ---------------------------------------------------------------------------

create or replace function public.guard_passport_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The guard is on CHANGING a number, not on first issuing one. A row that
  -- predates R1B has passport_number NULL until the backfill in
  -- 20260826100600 fills it, and that NULL -> value write must be allowed or
  -- the migration deadlocks against its own invariant.
  --
  -- The allowance closes itself: the same MASTER transaction ends with
  -- passport_number NOT NULL, so from that moment `old.passport_number is
  -- null` is unreachable and this is an unconditional freeze. It is not a
  -- standing exemption, and it needs no GUC bypass to carve out.
  if old.passport_number is not null
     and new.passport_number is distinct from old.passport_number then
    raise exception 'a Fade Passport number is permanent and cannot be reassigned'
      using errcode = '42501';
  end if;
  if old.issued_at is not null and new.issued_at is distinct from old.issued_at then
    raise exception 'customer_passports.issued_at is server-owned'
      using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'a Fade Passport cannot be moved to another account'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_passport_identity() is
  'BEFORE UPDATE invariant on customer_passports. Freezes passport_number, issued_at and user_id against every caller. user_id is included because R1A had to leave it UPDATE-grantable for the PostgREST upsert''s ON CONFLICT SET list — the grant cannot distinguish "same value, resent by upsert" from "repointed at someone else", and this trigger can.';

drop trigger if exists customer_passports_guard_identity on public.customer_passports;
create trigger customer_passports_guard_identity
  before update on public.customer_passports
  for each row execute function public.guard_passport_identity();

-- ---------------------------------------------------------------------------
-- 5. Column privileges
--
-- Table-level revoke then selective re-grant — the only mechanism that
-- actually restricts a column, as R1A established. SELECT keeps every column:
-- the number is the customer's own identity and they must be able to read it.
--
-- user_id STAYS UPDATE-grantable. This is not an oversight; it is a documented
-- R1A finding. Removing it silently breaks the Passport save in the live app.
-- ---------------------------------------------------------------------------

revoke insert, update on public.customer_passports from authenticated, anon;

grant insert (id, user_id, usual_haircut, fade_type, side_length, top_length,
              beard_preferences, preferences_notes, created_at, updated_at)
  on public.customer_passports to authenticated;

grant update (user_id, usual_haircut, fade_type, side_length, top_length,
              beard_preferences, preferences_notes, created_at, updated_at)
  on public.customer_passports to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Automatic issuance
--
-- ensure_customer_passport is the single issuance path: idempotent by
-- construction, safe to call from a trigger, from the backfill, and from a
-- retry after a caller-side failure.
-- ---------------------------------------------------------------------------

create or replace function private.ensure_customer_passport(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  -- ON CONFLICT, never select-then-insert. Two concurrent callers both
  -- succeed and exactly one row exists afterwards; the unique index decides,
  -- not the ordering.
  insert into public.customer_passports (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

comment on function private.ensure_customer_passport(uuid) is
  'The one issuance path. Idempotent and race-safe by construction: ON CONFLICT (user_id) DO NOTHING against the unique index that has protected one-passport-per-account since the Passport shipped. Retrying after any partial failure is always safe.';

revoke execute on function private.ensure_customer_passport(uuid) from public, anon, authenticated;

create or replace function public.customer_profiles_issue_passport()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_customer_passport(new.user_id);
  return null;
end;
$$;

comment on function public.customer_profiles_issue_passport() is
  'AFTER INSERT on customer_profiles. Becoming a FadeUp customer IS having a Fade Passport (Constitution §2.2) — there is no "Get Passport" action to take, and no state in which a registered customer is missing one.';

drop trigger if exists customer_profiles_issue_passport on public.customer_profiles;
create trigger customer_profiles_issue_passport
  after insert on public.customer_profiles
  for each row execute function public.customer_profiles_issue_passport();
