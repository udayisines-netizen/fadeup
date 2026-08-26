-- FadeUp — R1B: every existing barber gets their durable identity
--
-- Separate from the schema migration on purpose (MIGRATION_STRATEGY §1): a
-- backfill is data, it can be long, and it must be restartable independently
-- of the DDL that made it possible.
--
-- THREE POPULATIONS, AND THEY ARE NOT THE SAME
--
--   A. Account-backed roster rows — staff_profiles.user_id is not null.
--      One CLAIMED identity per DISTINCT account, not per barbers row. That is
--      the entire point: one human at two shops must end with ONE identity.
--
--   B. Detached roster rows — staff_profiles.user_id is null, which R1A made
--      reachable when it changed that FK to ON DELETE SET NULL so account
--      erasure would stop cascading away a shop's service history.
--
--      These are real professionals whose account no longer exists. They get
--      an UNCLAIMED identity, one per staff profile. That is honest: the
--      person worked here (the roster row and their appointments prove it),
--      and nobody controls the identity now. Minting a CLAIMED identity would
--      assert an account that was deliberately erased.
--
--   C. Nothing else. If a barbers row survives with no identity the migration
--      RAISES rather than shipping a silently incomplete link, because R2 is
--      going to set this column NOT NULL and a NULL discovered then is a much
--      more expensive problem.
--
-- WHAT IS NOT INHERITED, DELIBERATELY
--
--   is_public. A shop having made someone visible on its own roster is not
--   that person's consent to a platform-wide public identity, and R1B keeps
--   every backfilled identity unpublished. Constitution §2.1's "opting in must
--   be a deliberate act" is about customers, but the same reasoning holds here
--   and the cost of getting it wrong is identical.
--
--   handle. No public username is invented for anyone (see 20260826100000).
--
-- claimed_at is set to the EARLIEST staff_profiles.created_at for that
-- account, not to now(). The account has controlled this professional identity
-- since it first became a barber; stamping now() would assert that a
-- ten-year-old shop's staff were all claimed the day this migration ran.
-- The roster row is real evidence of when that began.
--
-- Deterministic: the display name comes from the account's earliest staff
-- profile under a total ordering (created_at, id), so a re-run on the same
-- data produces the same result.
--
-- Idempotent: every step is guarded on professional_id being null or the
-- identity being absent. A second run does nothing.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- A. One claimed identity per distinct barber-holding account
-- ---------------------------------------------------------------------------

do $$
declare
  v_minted integer;
begin
  perform set_config('fadeup.professional_claim_write', 'on', true);

  insert into public.professionals (user_id, claim_state, claimed_at, display_name, avatar_url, source)
  select distinct on (sp.user_id)
         sp.user_id,
         'claimed'::public.professional_claim_state,
         sp.created_at,
         coalesce(nullif(btrim(sp.display_name), ''), 'Professional'),
         sp.avatar_url,
         'fadeup'::public.professional_source
  from public.staff_profiles sp
  join public.barbers b on b.staff_profile_id = sp.id
  where sp.user_id is not null
  order by sp.user_id, sp.created_at, sp.id
  on conflict (user_id) do nothing;

  get diagnostics v_minted = row_count;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  raise notice 'R1B identity backfill: % claimed identities minted for existing barber accounts', v_minted;
end $$;

-- ---------------------------------------------------------------------------
-- A2. Link the account-backed roster rows
-- ---------------------------------------------------------------------------

update public.barbers b
set professional_id = p.id
from public.staff_profiles sp
join public.professionals p on p.user_id = sp.user_id
where b.staff_profile_id = sp.id
  and b.professional_id is null
  and sp.user_id is not null;

-- ---------------------------------------------------------------------------
-- B. Detached roster rows get an unclaimed identity, one per staff profile
--
-- A loop rather than a data-modifying CTE: each row needs its own generated
-- identity correlated back to its own barbers row, and a loop over a small,
-- deterministic ordering says that plainly. This population is tiny by
-- construction — it only exists where an account was erased.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_professional_id uuid;
  v_minted integer := 0;
begin
  for r in
    select b.id as barber_id, sp.display_name, sp.avatar_url
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.professional_id is null
    order by b.id
  loop
    insert into public.professionals (claim_state, display_name, avatar_url, source)
    values (
      'unclaimed',
      coalesce(nullif(btrim(coalesce(r.display_name, '')), ''), 'Former professional'),
      r.avatar_url,
      'fadeup'
    )
    returning id into v_professional_id;

    update public.barbers set professional_id = v_professional_id where id = r.barber_id;
    v_minted := v_minted + 1;
  end loop;

  if v_minted > 0 then
    raise notice 'R1B identity backfill: % unclaimed identities minted for roster rows whose account was erased', v_minted;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. Completeness, asserted
--
-- An empty backfill reports success vacuously, so the assertion is on the
-- POST-condition rather than on how many rows moved.
-- ---------------------------------------------------------------------------

do $$
declare
  v_unlinked integer;
  v_dupes integer;
  v_total integer;
begin
  select count(*) into v_unlinked from public.barbers where professional_id is null;
  if v_unlinked > 0 then
    raise exception 'R1B identity backfill incomplete: % barbers rows still have no professional identity', v_unlinked
      using errcode = 'P0001';
  end if;

  -- One human at two shops must be ONE identity. If two distinct identities
  -- ended up carrying the same account something is badly wrong; the unique
  -- index on user_id should already make this impossible, so this asserts the
  -- index rather than the query.
  select count(*) into v_dupes
  from (
    select user_id from public.professionals
    where user_id is not null
    group by user_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'R1B identity backfill produced % duplicated account identities', v_dupes
      using errcode = 'P0001';
  end if;

  select count(*) into v_total from public.professionals;
  raise notice 'R1B identity backfill complete: % professional identities, 0 unlinked barbers', v_total;
end $$;
