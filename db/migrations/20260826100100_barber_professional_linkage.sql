-- FadeUp — R1B: the roster points at the identity
--
-- `barbers` and `professionals` answer different questions and must not be
-- collapsed:
--
--   barbers        "is this person bookable, at this shop, right now"
--   professionals  "who is this person, independent of any shop"
--
-- barbers.professional_id is the join. It is NULLABLE for exactly one lot:
-- a column cannot be NOT NULL in the migration that adds it, and the backfill
-- is deliberately a separate file (20260826100200). R2 tightens it —
-- CHECK ... NOT VALID -> VALIDATE -> SET NOT NULL -> drop the check.
--
-- FOREIGN KEY DELETION SEMANTICS, CHOSEN NOT INHERITED
--
--   ON DELETE RESTRICT. Deleting a professional identity that still backs a
--   roster row must fail loudly. This is the same reasoning R1A applied to
--   appointments.barber_id: an identity is what history hangs off, and the
--   only thing worse than an orphaned row is a silently destroyed one. There
--   is no client DELETE path to professionals at all (no policy, no grant), so
--   RESTRICT is defence in depth rather than the primary control.
--
--   Offboarding is NOT deletion, and R1A already made that explicit with
--   offboard_barber(). Removing someone from a roster must never touch their
--   durable identity: they are still a professional, they just no longer work
--   here. That separation is the whole point of this lot.
--
-- UNIQUENESS
--
--   Globally unique would be WRONG — one human working at two shops is
--   precisely the case this lot exists to represent, and that is two barbers
--   rows sharing one professional_id.
--
--   Unique per ORGANIZATION is right, and is a real invariant: a person cannot
--   hold two roster seats at the same shop. It already follows from
--   staff_profiles_org_user_unique plus barbers_staff_profile_unique for
--   account-backed rows, but it must hold for detached and acquisition-minted
--   identities too, where that chain does not apply.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'barbers' and column_name = 'professional_id'
  ) then
    alter table public.barbers
      add column professional_id uuid references public.professionals (id) on delete restrict;
  end if;
end $$;

comment on column public.barbers.professional_id is
  'The durable identity behind this roster seat. Nullable ONLY as an R1B->R2 bridge: the backfill in 20260826100200 fills every row and asserts completeness, and R2 sets NOT NULL. ON DELETE RESTRICT — an identity that still backs a roster row cannot be removed. Not writable by any client (see the column grants below): a shop must not be able to point a roster seat at a professional identity it does not own.';

create index if not exists barbers_professional_id_idx
  on public.barbers (professional_id) where professional_id is not null;

-- Mandatory, not merely nice: without a professional_id index every identity
-- delete attempt seq-scans barbers to evaluate the RESTRICT. This one also
-- carries the per-organization uniqueness invariant.
create unique index if not exists barbers_org_professional_unique
  on public.barbers (organization_id, professional_id) where professional_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Assignment for NEW roster rows
--
-- Every path that creates a barbers row today — the roster UI, invitations,
-- ensure_owner_professional — must keep working unchanged, and must produce a
-- linked row. A BEFORE INSERT trigger derives the identity from the account
-- behind the staff profile, minting one on first sight.
--
-- SECURITY DEFINER because `professionals` has no INSERT policy and no INSERT
-- grant: minting an identity is a server act, never a client one. It sets the
-- claim-write flag around its own INSERT only, and clears it immediately, so
-- the guard trigger's freeze is relaxed for exactly one statement.
--
-- A staff profile with a NULL user_id (an R1A account-erasure tombstone) gets
-- NO identity here: there is no account to claim it, and inventing a claimed
-- identity for a deleted account would be fabrication. The backfill handles
-- the historical case explicitly and honestly; a NEW roster row for a detached
-- staff profile is not a real scenario, and leaving professional_id NULL keeps
-- it visible rather than papered over.
-- ---------------------------------------------------------------------------

create or replace function public.assign_barber_professional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_display_name text;
  v_avatar_url text;
  v_professional_id uuid;
begin
  -- A client-supplied professional_id is never trusted. INSERT on this column
  -- is revoked below, so `authenticated` cannot send one at all; this makes
  -- the same guarantee hold for service_role and direct SQL.
  new.professional_id := null;

  select sp.user_id, sp.display_name, sp.avatar_url
    into v_user_id, v_display_name, v_avatar_url
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if v_user_id is null then
    return new;
  end if;

  select p.id into v_professional_id
  from public.professionals p
  where p.user_id = v_user_id;

  if v_professional_id is null then
    perform set_config('fadeup.professional_claim_write', 'on', true);
    -- ON CONFLICT, not select-then-insert: two roster seats created
    -- concurrently for the same account must yield exactly one identity, and
    -- the unique index on user_id is the only thing that can promise that.
    insert into public.professionals (user_id, claim_state, claimed_at, display_name, avatar_url, source)
    values (
      v_user_id, 'claimed', now(),
      coalesce(nullif(btrim(coalesce(v_display_name, '')), ''), 'Professional'),
      v_avatar_url, 'fadeup'
    )
    on conflict (user_id) do nothing;
    perform set_config('fadeup.professional_claim_write', 'off', true);

    select p.id into v_professional_id
    from public.professionals p
    where p.user_id = v_user_id;
  end if;

  new.professional_id := v_professional_id;
  return new;
end;
$$;

comment on function public.assign_barber_professional() is
  'BEFORE INSERT on barbers. Derives professional_id from the account behind the staff profile, minting the durable identity on first sight via ON CONFLICT (user_id) so concurrent roster creation cannot produce two identities for one person. Always overwrites any caller-supplied professional_id: a shop must never be able to name an identity it does not own.';

drop trigger if exists barbers_assign_professional on public.barbers;
create trigger barbers_assign_professional
  before insert on public.barbers
  for each row execute function public.assign_barber_professional();

-- ---------------------------------------------------------------------------
-- 3. professional_id is server-owned
--
-- A column-level REVOKE cannot subtract from a table-level grant — it is a
-- silent no-op. So the privilege goes at TABLE level and every other column is
-- re-granted explicitly, the same mechanism R1A used for appointments and
-- queue_entries.
--
-- Both INSERT and UPDATE, for the same reason R1A revoked both on
-- booked_by_user_id: revoking UPDATE alone leaves the value forgeable in a
-- single INSERT.
-- ---------------------------------------------------------------------------

revoke insert, update on public.barbers from authenticated, anon;

grant insert (id, organization_id, staff_profile_id, is_bookable, created_at, updated_at)
  on public.barbers to authenticated;
grant update (organization_id, staff_profile_id, is_bookable, created_at, updated_at)
  on public.barbers to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Widen the identity SELECT policy now that the join column exists
--
-- A shop needs to read the identity behind its own roster — the Pro workspace
-- and the roster UI both resolve a name through it. This arm could not be
-- written in 20260826100000 because the column did not exist yet.
-- ---------------------------------------------------------------------------

drop policy if exists professionals_select on public.professionals;
create policy professionals_select
  on public.professionals
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
    or exists (
      select 1
      from public.barbers b
      where b.professional_id = public.professionals.id
        and (select private.is_org_member(b.organization_id))
    )
  );
