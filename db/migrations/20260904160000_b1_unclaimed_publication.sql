-- FadeUp — B1, chantier 1: an unclaimed identity can be published.
--
-- THE DEFECT
--
-- professionals_publication_eligibility (20260826100000_professional_identity)
-- reads:
--
--   check (not is_public or (claim_state = 'claimed' and btrim(display_name) <> ''))
--
-- so `unclaimed AND is_public` is unrepresentable. Three consequences, all
-- observed:
--
--   1. create_external_professional inserts is_public = false and nothing in
--      the schema can ever flip it. Every profile the Worker mints is
--      invisible. The marketplace has no supply to show.
--   2. get_public_external_professional asks for `claim_state = 'unclaimed'
--      AND is_public` — a combination the CHECK forbids. It has returned zero
--      rows for every input since the day it was written, and its own COMMENT
--      says so.
--   3. MASTER_SPEC §5 — the Worker publishes unclaimed profiles, clearly
--      marked, and a customer sends a request to them — has no support.
--
-- This was never a disagreement about the product. R1B wrote the clause as a
-- temporary bar and said so in the source: "R10 removes only the claim_state
-- clause, deliberately and in writing." This file is that removal, and it does
-- the writing.
--
-- WHAT THE ORIGINAL CONSTRAINT PROTECTED, AND WHERE EACH GUARANTEE GOES NOW
--
--   (a) "An identity with no usable name cannot be published."
--       KEPT VERBATIM in the CHECK. Unchanged.
--
--   (b) "Nobody has validated this data." This is the real worry behind the
--       claim_state clause, and dropping it outright would drop the worry with
--       it. It is preserved, not deleted, and split by who does the vouching:
--         - CLAIMED: a human being with an account has taken ownership of the
--           identity. That IS the validation. Nothing more is required — and
--           nothing more may be required, because MASTER_SPEC §9 makes the
--           identity outlive any single shop: a claimed professional between
--           two salons must not be force-depublished for having no employer
--           this week.
--         - UNCLAIMED: nobody has vouched, so the corroboration has to come
--           from the acquisition evidence instead. An unclaimed identity may
--           be published only with a PUBLICATION ANCHOR — see
--           private.professional_publication_anchor below.
--       A CHECK cannot express (b) because it needs other tables, so it moves
--       to a trigger. It is enforced for every writer, including service_role
--       and direct SQL, exactly like the guards this schema already uses.
--
--   (c) "An unclaimed profile never becomes silently verified."
--       claim_state remains the single discriminator, is never writable
--       outside the claim lifecycle (guard_professional_identity, untouched),
--       and this file makes it a MANDATORY COLUMN OF EVERY PUBLIC PROJECTION
--       so no consumer can render a published profile without knowing which
--       kind it is.
--
-- THE RPC PATH: MERGE, NOT REPAIR
--
-- get_public_external_professional is dropped and its purpose folded into
-- get_public_professional / get_public_professional_by_handle, which now serve
-- claimed and unclaimed alike and carry claim_state.
--
-- Its COMMENT defended the split on the grounds that a separate function
-- "cannot leak or fabricate FadeUp state even by accident". That property does
-- not come from having two functions — it comes from the PROJECTION. Neither
-- function selects a single operational column, and an external identity has
-- no barbers row to hang one off in the first place (the structural guarantee
-- R1B built). Keeping two doors instead only creates a way to knock on the
-- wrong one: a front end that asks the claimed-only function about an
-- unclaimed handle gets an empty result and renders "not found" for a profile
-- that exists. One contract, one shape, claim_state inside it.
--
-- Nothing calls get_public_external_professional — verified across apps/ —
-- so the drop breaks no caller. The two survivors gain a column, which is
-- additive for their existing callers.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. The anchor
--
-- What makes an unclaimed identity publishable: evidence, held by somebody
-- else, that the person is real and reachable in the real world.
--
-- Two admissible anchors, and both already exist in the schema:
--
--   'organization'       — the identity is attached to an operating FadeUp
--                          organization through barbers, THE attachment table
--                          (MASTER_SPEC §9).
--
--                          READ THIS BEFORE ASSUMING IT IS THE COMMON CASE: it
--                          is not reachable from the acquisition path at all.
--                          assign_barber_professional, the BEFORE INSERT
--                          trigger on barbers, sets new.professional_id := null
--                          unconditionally and then links an identity only when
--                          the staff_profile has a user_id — in which case the
--                          identity it links or mints is CLAIMED. So a barbers
--                          row can never point at an unclaimed identity that
--                          was minted from a prospect. That is R1B's structural
--                          guarantee working as designed: an external identity
--                          has no barbers row, therefore no availability, no
--                          queue and no schedule.
--
--                          The arm is still not dead. When an account is
--                          erased, guard_professional_identity reverts its
--                          identity to unclaimed while the barbers row keeps
--                          pointing at it — an unclaimed identity that a real
--                          shop still employs. That row may be republished, and
--                          this is the arm that says so.
--
--   'acquisition_source' — the identity came from a canonical prospect that
--                          carries a website domain or at least one located
--                          record. This is EXACTLY the corroboration
--                          publication_block_reason already demands before an
--                          operator may publish at all
--                          ('no_corroborating_location'); re-stating it here
--                          keeps the fact true for the lifetime of the row
--                          rather than only at the instant of publication.
--
-- Note what an anchor is NOT: it is not an address, not a location row, and
-- not a claim to operational capability. B1 words the requirement as "an
-- organization or a service area", and read literally that would make the
-- Worker's own output unpublishable — an external identity has neither by
-- design. The substance of the requirement is a corroborated real-world
-- attachment, and the prospect's domain-or-location is precisely that.
-- ---------------------------------------------------------------------------

create or replace function private.professional_publication_anchor(p_professional_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.barbers b
      where b.professional_id = p_professional_id
    ) then 'organization'
    when exists (
      select 1
      from public.prospect_professionals pp
      join public.prospects pr on pr.id = pp.prospect_id
      where pp.professional_id = p_professional_id
        and (
          pr.website_domain is not null
          or exists (
            select 1 from public.prospect_locations pl where pl.prospect_id = pr.id
          )
        )
    ) then 'acquisition_source'
    else null
  end;
$$;

comment on function private.professional_publication_anchor(uuid) is
  'The corroborated real-world attachment that makes an UNCLAIMED identity publishable, or NULL when there is none. Returns the anchor KIND rather than a boolean so a refusal can name what is missing. Claimed identities do not consult this: the account holder is the corroboration.';

revoke all on function private.professional_publication_anchor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The constraint, narrowed to what a CHECK can honestly express
-- ---------------------------------------------------------------------------

alter table public.professionals
  drop constraint if exists professionals_publication_eligibility;

alter table public.professionals
  add constraint professionals_publication_eligibility
  check (not is_public or btrim(display_name) <> '');

comment on constraint professionals_publication_eligibility on public.professionals is
  'Publication needs a usable name. The claim_state clause this constraint carried until B1 is NOT abandoned — it is replaced by professionals_guard_publication, which asks for a corroborating anchor instead, because an unclaimed profile with real evidence behind it is the entire acquisition model (MASTER_SPEC §5) while an unclaimed profile with nothing behind it is what R1B was right to refuse.';

-- ---------------------------------------------------------------------------
-- 3. The guard — the half of the old constraint a CHECK cannot hold
--
-- BEFORE INSERT OR UPDATE, and it fires on every writer. Column grants stop
-- `authenticated` from writing claim_state, but grants protect only the roles
-- they name; service_role and a psql session go through this trigger too, on
-- the same principle as guard_professional_identity.
-- ---------------------------------------------------------------------------

create or replace function public.guard_professional_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor text;
begin
  if not new.is_public then
    return new;
  end if;

  if new.claim_state = 'claimed' then
    return new;
  end if;

  -- On INSERT the row does not exist yet, so an anchor that lives in another
  -- table pointing BACK at this id cannot exist either. Publication of an
  -- unclaimed identity is therefore always a second step — mint, link, then
  -- publish — which is also how publish_external_professional behaves.
  if tg_op = 'INSERT' then
    raise exception 'an unclaimed professional identity cannot be created already public'
      using errcode = '42501',
            hint = 'Mint the identity, attach its evidence, then publish it.';
  end if;

  v_anchor := private.professional_publication_anchor(new.id);

  if v_anchor is null then
    raise exception 'this unclaimed professional identity has no publication anchor'
      using errcode = '42501',
            detail = 'fadeup_publication_refusal=no_anchor',
            hint = 'An unclaimed identity may be published only when it is attached to an organization (barbers) or backed by a prospect carrying a website domain or a located source record.';
  end if;

  return new;
end;
$$;

comment on function public.guard_professional_publication() is
  'BEFORE INSERT OR UPDATE on professionals. Holds the half of professionals_publication_eligibility that a CHECK cannot: an UNCLAIMED identity may only be public while a corroborating anchor exists. Claimed identities pass untouched — the account holder is the corroboration, and MASTER_SPEC §9 requires a claimed identity to survive having no employer.';

drop trigger if exists professionals_guard_publication on public.professionals;
create trigger professionals_guard_publication
  before insert or update on public.professionals
  for each row execute function public.guard_professional_publication();

-- ---------------------------------------------------------------------------
-- 4. The public projections — one contract, claim_state always inside it
--
-- DROP then CREATE rather than CREATE OR REPLACE: the return type gains a
-- column, and Postgres refuses to replace a function whose OUT columns change.
-- Grants are re-issued below because a DROP takes them with it.
-- ---------------------------------------------------------------------------

drop function if exists public.get_public_external_professional(uuid);
drop function if exists public.get_public_professional(uuid);
drop function if exists public.get_public_professional_by_handle(text);

create function public.get_public_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  claim_state public.professional_claim_state,
  is_claimed boolean,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         p.claim_state,
         p.claim_state = 'claimed',
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.id = p_professional_id
    and p.is_public;
$$;

comment on function public.get_public_professional(uuid) is
  'Anon-callable. THE public contract for a professional identity, claimed or not. is_public is the only visibility test: claim_state is returned, not filtered on, so the interface can render the neutral "not yet managed on FadeUp" badge instead of a 404 for a profile that exists. Projects identity columns only — no location, no availability, no queue, nothing operational — which is what makes it safe to serve an unclaimed profile through it. follower_count is real: MASTER_SPEC §5 allows follows before a claim, and that count is a genuine acquisition signal.';

create function public.get_public_professional_by_handle(p_handle text)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  claim_state public.professional_claim_state,
  is_claimed boolean,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         p.claim_state,
         p.claim_state = 'claimed',
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.handle is not null
    and lower(p.handle) = lower(btrim(coalesce(p_handle, '')))
    and p.is_public;
$$;

comment on function public.get_public_professional_by_handle(text) is
  'Anon-callable. Same contract and same shape as get_public_professional, addressed by the public handle. Serves claimed and unclaimed identities alike and returns claim_state with them.';

revoke all on function public.get_public_professional(uuid) from public;
revoke all on function public.get_public_professional_by_handle(text) from public;
grant execute on function public.get_public_professional(uuid) to anon, authenticated, service_role;
grant execute on function public.get_public_professional_by_handle(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Publication becomes an act, not just a linkage
--
-- publish_external_professional minted an identity and wrote an audit row, but
-- left is_public = false because the CHECK gave it no other option. The
-- operator pressed Publish and nothing was published. It now publishes.
--
-- The gate, the lock, the audit row and the eligibility refresh are unchanged;
-- only the UPDATE is new. The already-published branch returns the existing
-- identity as before — and now also repairs a row minted before this file, so
-- pressing Publish a second time on an invisible identity makes it visible
-- instead of silently doing nothing.
-- ---------------------------------------------------------------------------

create or replace function public.publish_external_professional(p_prospect_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  -- Lock the PROSPECT, not the linkage row, because the linkage row is what we
  -- are about to create and therefore cannot be locked. Two administrators
  -- double-clicking Publish on the same candidate serialise here; the loser
  -- re-reads a gate that now says already_published and returns the winner's
  -- identity instead of a 23505 they would have to interpret.
  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    -- Idempotent, and self-healing for identities minted while the R1B CHECK
    -- still forbade publication: those rows exist, are linked, and are
    -- invisible. Pressing Publish again finishes the job.
    update public.professionals
    set is_public = true
    where id = v_existing and not is_public;

    return v_existing;
  end if;

  -- Checked here so the operator gets the reason by name. The trigger would
  -- refuse the insert regardless; this is ergonomics on top of the guarantee,
  -- never in place of it.
  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  -- Publication is the point of this function. It happens AFTER the linkage
  -- row exists, because professionals_guard_publication reads the linkage to
  -- find the anchor — the same ordering the guard's INSERT branch describes.
  update public.professionals
  set is_public = true
  where id = v_professional_id;

  -- Constitution §4.4's discipline, applied to acquisition: a decision that
  -- creates a durable public-facing identity records who took it and when.
  -- The prospect's name is captured AS PUBLISHED, so a later rename of the
  -- prospect does not rewrite the history of what was approved.
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  -- Fold the verdict forward immediately so the review queue stops offering a
  -- candidate that has just been published, without waiting for the next
  -- Worker sweep.
  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  return v_professional_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. And the way back
--
-- A publication that cannot be undone is not a decision, it is a trapdoor.
-- MASTER_SPEC §5 gives a professional 72 h to be removed from the marketplace
-- after a validated request; the dated workflow for that belongs to /platform,
-- but the operator needs the act itself to exist before any workflow can call
-- it. Withdrawal does not delete the identity, unlink the prospect or touch
-- claim_state — it stops the public projection, and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_external_professional(p_professional_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can withdraw an external professional identity'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id
  for update;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- A claimed identity belongs to its owner. Removing it from public view is
  -- a moderation act with its own review path, not a side door on the
  -- acquisition tooling.
  if v_claim_state = 'claimed' then
    raise exception 'this identity is claimed; withdrawing a claimed profile is not an acquisition action'
      using errcode = '42501';
  end if;

  update public.professionals
  set is_public = false
  where id = p_professional_id and is_public;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_withdrawn',
    'professionals',
    p_professional_id,
    jsonb_build_object(
      'professional_id', p_professional_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  return p_professional_id;
end;
$$;

comment on function public.withdraw_external_professional(uuid, text) is
  'Platform-admin only. Stops the public projection of an UNCLAIMED identity and audits the decision. Does not delete, unlink or unclaim anything. Refuses on a claimed identity: that profile has an owner, and removing it from view is moderation with its own path.';

-- Same grant shape as publish_external_professional: reachable by an
-- authenticated session, refused inside the function to anyone who is not a
-- platform administrator. The grant is not the authorization.
revoke all on function public.withdraw_external_professional(uuid, text) from public, anon;
grant execute on function public.withdraw_external_professional(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Comments that described the world before this file
-- ---------------------------------------------------------------------------

comment on function public.create_external_professional(uuid) is
  'Platform-staff or acquisition-worker only. Mints ONE unclaimed professional identity per canonical prospect, idempotently, with structurally safe defaults: unclaimed, NOT public (publication is a separate, audited decision — publish_external_professional), no barbers row (so no availability, queue, schedule or appointment can be implied), and a display name copied from the prospect rather than supplied by the caller. Serialises against a concurrent second job on the unique index, returning 40001 so the caller retries into the idempotent branch.';

comment on column public.professionals.is_public is
  'Whether this identity is CURRENTLY projected publicly. Distinct from existence and from eligibility. Never inherited from staff_profiles.is_public. Legal for an unclaimed identity since B1, provided professionals_guard_publication finds a corroborating anchor.';

commit;
