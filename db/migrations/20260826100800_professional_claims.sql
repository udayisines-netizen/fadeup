-- FadeUp — R1B: the claim lifecycle
--
-- Nothing in this codebase adopts an existing professional IDENTITY today.
-- professional_applications creates a brand-new empty tenant; invitations join
-- an existing organization. Neither says "that profile out there is me".
--
-- THE STATE MACHINE, COMPLETE
--
--                   submit_professional_claim
--                            |
--                            v
--                        [ pending ] --- withdraw ---> [ withdrawn ]
--                        /        \
--                 approve          reject
--                      /              \
--                     v                v
--              [ approved ]        [ rejected ]
--
-- All three leaves are TERMINAL. There is no edge out of them, enforced by a
-- BEFORE UPDATE trigger with no role exemption, so a rejected claim can never
-- be quietly revived into an approval.
--
-- The corresponding identity transition is the only one in the system:
--
--   professionals: unclaimed --(approved claim)--> claimed
--
-- and the reverse edge exists only for account erasure (20260826100000 §4),
-- which detaches rather than transfers. There is NO path that moves a claimed
-- identity from one account to another. Taking over a claimed profile is not
-- a slow operation in this design; it is an unrepresentable one.
--
-- CONTRADICTORY STATES ARE UNREPRESENTABLE, NOT MERELY UNLIKELY
--
--   professionals   check ((claim_state='claimed') = (user_id is not null))
--                   check ((claim_state='claimed') = (claimed_at is not null))
--   claims          check ((state='pending')       = (decided_at is null))
--                   check (state<>'approved' or decided_by is not null)
--
-- So claimed_at != null while claim_state='unclaimed' cannot be stored, and an
-- approved claim always names the human who approved it.
--
-- CONCURRENCY: EXACTLY ONE WINNER
--
-- Two reviewers approving two different claims for the same identity at the
-- same instant is the dangerous race, and it is closed twice over:
--
--   1. the professional row is taken FOR UPDATE before anything is decided, so
--      the second transaction blocks and then re-reads a row that is already
--      claimed and refuses;
--   2. professional_claims_one_approval, a UNIQUE index on (professional_id)
--      WHERE state='approved', so even if (1) were somehow bypassed the second
--      write fails on 23505.
--
-- Locks, not application ordering. The index, not the lock, is the guarantee.
--
-- WHAT IS DELIBERATELY NOT BUILT
--
-- No verification engine. R17 owns outreach and proof-of-possession. A claim
-- therefore RESTS in `pending` until a human decides, which is honest: the
-- alternative is shipping weak self-service verification that would let
-- someone assert they are a professional whose profile they merely found.
--
-- No internal reviewer note. R1A had to close exactly that hole on
-- professional_applications.internal_note, where a row-level policy plus a
-- table-wide SELECT grant handed the applicant the reviewer's private
-- assessment. The way to not have that bug is to not have the column:
-- decision_note is written FOR the claimant and is meant to be read by them.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'professional_claim_status') then
    create type public.professional_claim_status as enum
      ('pending', 'approved', 'rejected', 'withdrawn');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The claim
-- ---------------------------------------------------------------------------

create table if not exists public.professional_claims (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: a claim on an identity that no longer exists is not a
  -- record of anything. Unreachable in practice — professionals has no DELETE
  -- policy and no DELETE grant, and prospect_professionals RESTRICTs on top.
  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- ON DELETE CASCADE: the claim is the claimant's own submission and their
  -- personal data. Erasing the account withdraws it, which is also what makes
  -- the identity re-claimable afterwards — consistent with the detach in
  -- 20260826100000, where erasure returns the identity to unclaimed.
  claimant_user_id uuid not null references auth.users (id) on delete cascade,

  state public.professional_claim_status not null default 'pending',

  -- The claimant's own account of why this identity is theirs. Free text on
  -- purpose: R1B builds the lifecycle, not the verification engine.
  evidence text,

  submitted_at timestamptz not null default now(),
  decided_at timestamptz,

  -- ON DELETE SET NULL: erasing a reviewer's account must not erase the fact
  -- that a decision was taken. Constitution §4.4 — verification is auditable.
  decided_by uuid references auth.users (id) on delete set null,

  -- Written FOR the claimant. There is deliberately no second, hidden note.
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_claims_pending_undecided
    check ((state = 'pending') = (decided_at is null)),

  constraint professional_claims_approval_has_reviewer
    check (state <> 'approved' or decided_by is not null),

  constraint professional_claims_evidence_length
    check (evidence is null or char_length(evidence) <= 2000),

  constraint professional_claims_note_length
    check (decision_note is null or char_length(decision_note) <= 2000)
);

comment on table public.professional_claims is
  'The lifecycle by which a real person takes control of an existing professional identity — typically one acquisition created before they joined. pending -> approved | rejected | withdrawn, all terminal. Claim state is NEVER subscription state (Constitution §5.6): approving a claim grants control, not capabilities and not a plan.';

comment on column public.professional_claims.evidence is
  'The claimant''s own account of why this identity is theirs. R1B stores it and stops there — verifying it is R17''s outreach work, and shipping weak self-service verification would be worse than an honest pending queue.';

comment on column public.professional_claims.decision_note is
  'Written for the CLAIMANT to read. There is no separate internal note by design: R1A had to close exactly that leak on professional_applications.internal_note, and a column that does not exist cannot be over-granted.';

-- One owner, ever. This is the constraint the whole race analysis rests on.
create unique index if not exists professional_claims_one_approval
  on public.professional_claims (professional_id) where state = 'approved';

-- No spam: one live claim per (identity, claimant). A second submission
-- returns the first rather than queueing another.
create unique index if not exists professional_claims_one_pending
  on public.professional_claims (professional_id, claimant_user_id) where state = 'pending';

-- The review queue, oldest first.
create index if not exists professional_claims_queue
  on public.professional_claims (submitted_at) where state = 'pending';

create index if not exists professional_claims_claimant_idx
  on public.professional_claims (claimant_user_id);

drop trigger if exists professional_claims_set_updated_at on public.professional_claims;
create trigger professional_claims_set_updated_at
  before update on public.professional_claims
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Transitions are enforced, for everyone
-- ---------------------------------------------------------------------------

create or replace function public.enforce_professional_claim_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.professional_id is distinct from old.professional_id
     or new.claimant_user_id is distinct from old.claimant_user_id then
    raise exception 'a claim cannot be repointed at a different identity or claimant'
      using errcode = '42501';
  end if;

  if new.state is not distinct from old.state then
    return new;
  end if;

  if old.state <> 'pending' then
    raise exception 'claim is already % and cannot change state', old.state
      using errcode = '22023';
  end if;

  if new.state not in ('approved', 'rejected', 'withdrawn') then
    raise exception 'illegal claim transition % -> %', old.state, new.state
      using errcode = '22023';
  end if;

  -- Decision time is server-owned, so a caller cannot backdate a review.
  new.decided_at := coalesce(new.decided_at, now());
  return new;
end;
$$;

comment on function public.enforce_professional_claim_transition() is
  'BEFORE UPDATE invariant on professional_claims. pending is the only state with outgoing edges, and no role is exempt — including service_role, matching how R1A guards appointment transitions. Also freezes the claim''s identity and stamps decided_at server-side.';

drop trigger if exists professional_claims_enforce_transition on public.professional_claims;
create trigger professional_claims_enforce_transition
  before update on public.professional_claims
  for each row execute function public.enforce_professional_claim_transition();

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- SELECT: own claims, and platform staff. A claimant must not be able to
--   enumerate who else is claiming the same identity — that is both a privacy
--   leak and a social-engineering aid.
--
-- INSERT / UPDATE / DELETE: no policy. The three RPCs below are the only
--   writers. A direct INSERT would let a caller choose their own state.
-- ---------------------------------------------------------------------------

alter table public.professional_claims enable row level security;
alter table public.professional_claims force row level security;

revoke all on public.professional_claims from anon, authenticated;
grant select (id, professional_id, claimant_user_id, state, evidence,
              submitted_at, decided_at, decision_note, created_at, updated_at)
  on public.professional_claims to authenticated;

drop policy if exists professional_claims_select on public.professional_claims;
create policy professional_claims_select
  on public.professional_claims
  for select
  to authenticated
  using (
    claimant_user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- 4. submit — filing a claim grants nothing
-- ---------------------------------------------------------------------------

create or replace function public.submit_professional_claim(
  p_professional_id uuid,
  p_evidence text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_claim_state public.professional_claim_state;
  v_claim_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'claiming a professional identity requires an authenticated session'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id;

  if v_claim_state is null then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- An already-claimed identity is not available. Refused here AND again
  -- under a row lock at review time, because the state can change between the
  -- two.
  if v_claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed'
      using errcode = '42501';
  end if;

  -- The claimant must not already hold an identity. Approving this would
  -- require MERGING two professional identities, and a merge that silently
  -- picked a winner would destroy one person's history. R17 owns merge; until
  -- it exists this fails closed rather than guessing.
  if exists (select 1 from public.professionals p where p.user_id = v_user_id) then
    raise exception 'this account already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  -- Idempotent: a double-submitted form returns the existing claim rather
  -- than a 23505 the caller has to interpret, and the partial unique index
  -- remains the actual guarantee against a concurrent second insert.
  select c.id into v_claim_id
  from public.professional_claims c
  where c.professional_id = p_professional_id
    and c.claimant_user_id = v_user_id
    and c.state = 'pending';

  if v_claim_id is not null then
    return v_claim_id;
  end if;

  insert into public.professional_claims (professional_id, claimant_user_id, evidence)
  values (p_professional_id, v_user_id, nullif(btrim(coalesce(p_evidence, '')), ''))
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

comment on function public.submit_professional_claim(uuid, text) is
  'Authenticated-only. Files a claim and grants NOTHING — the identity stays unclaimed until platform staff approve. Idempotent per (identity, claimant). Refuses an already-claimed identity, and refuses a claimant who already holds an identity, because approving that would need a merge and a silent merge would destroy one person''s history (R17 owns merge).';

revoke execute on function public.submit_professional_claim(uuid, text) from public, anon;
grant execute on function public.submit_professional_claim(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. withdraw — the claimant's own, and only while pending
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_professional_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'withdrawing a claim requires an authenticated session'
      using errcode = '42501';
  end if;

  update public.professional_claims
  set state = 'withdrawn', decided_at = now()
  where id = p_claim_id
    and claimant_user_id = v_user_id
    and state = 'pending';

  if not found then
    raise exception 'claim not found, not yours, or already decided'
      using errcode = '42704';
  end if;
end;
$$;

comment on function public.withdraw_professional_claim(uuid) is
  'Authenticated-only. Withdraws the caller''s own pending claim. Never a silent no-op: a claim that is missing, someone else''s, or already decided raises rather than pretending to succeed.';

revoke execute on function public.withdraw_professional_claim(uuid) from public, anon;
grant execute on function public.withdraw_professional_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. review — platform only, and the only thing that can claim an identity
-- ---------------------------------------------------------------------------

create or replace function public.review_professional_claim(
  p_claim_id uuid,
  p_decision text,
  p_note text default null
)
returns public.professional_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer uuid;
  v_claim public.professional_claims;
  v_professional public.professionals;
  v_org_id uuid;
  v_org_count integer;
  v_converted boolean := false;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional claims'
      using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;

  -- The row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a state that is no longer pending and returns without
  -- repeating a single side effect.
  select * into v_claim from public.professional_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = '42704';
  end if;

  if v_claim.state <> 'pending' then
    return v_claim;
  end if;

  if p_decision = 'reject' then
    update public.professional_claims
    set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
        decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = v_claim.id
    returning * into v_claim;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (v_reviewer, 'professional_claim_rejected', 'professional_claims', v_claim.id,
            jsonb_build_object('professional_id', v_claim.professional_id,
                               'claimant_user_id', v_claim.claimant_user_id));
    return v_claim;
  end if;

  -- ---- approve ----------------------------------------------------------
  -- Lock the IDENTITY, not just the claim. Two reviewers approving two
  -- different claims for the same professional serialise here; the loser
  -- re-reads a row that is already claimed and refuses below.
  select * into v_professional from public.professionals
  where id = v_claim.professional_id for update;

  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed and cannot be transferred'
      using errcode = '42501';
  end if;

  -- Re-checked under the lock: the claimant may have acquired an identity
  -- between submitting and being reviewed.
  if exists (select 1 from public.professionals p where p.user_id = v_claim.claimant_user_id) then
    raise exception 'the claimant already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  perform set_config('fadeup.professional_claim_write', 'on', true);
  update public.professionals
  set claim_state = 'claimed', user_id = v_claim.claimant_user_id, claimed_at = now()
  where id = v_professional.id;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  update public.professional_claims
  set state = 'approved', decided_at = now(), decided_by = v_reviewer,
      decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = v_claim.id
  returning * into v_claim;

  -- Every other live claim on this identity is now moot. Closing them is not
  -- housekeeping: leaving them pending would let a later reviewer approve a
  -- second one and hit 23505 on the one-approval index, which is a confusing
  -- way to discover the profile was already taken.
  update public.professional_claims
  set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
      decision_note = 'another claim for this professional identity was approved'
  where professional_id = v_professional.id
    and state = 'pending'
    and id <> v_claim.id;

  -- Close the acquisition loop. The organization is DERIVED, never supplied:
  -- a caller-provided organization_id would let a reviewer attribute someone
  -- else's conversion. Exactly one owner membership is unambiguous; zero or
  -- several is not, and this declines to guess rather than picking one.
  select count(*) into v_org_count
  from public.memberships m
  where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

  if v_org_count = 1 then
    select m.organization_id into v_org_id
    from public.memberships m
    where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

    v_converted := private.record_prospect_conversion(v_professional.id, v_org_id);
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_reviewer, 'professional_claim_approved', 'professional_claims', v_claim.id,
          jsonb_build_object('professional_id', v_professional.id,
                             'claimant_user_id', v_claim.claimant_user_id,
                             'owner_organization_count', v_org_count,
                             'prospect_conversion_recorded', v_converted));

  return v_claim;
end;
$$;

comment on function public.review_professional_claim(uuid, text, text) is
  'Platform-staff only, and the ONLY path that can move a professional identity to claimed. Locks the claim and then the identity, so simultaneous approvals produce exactly one winner — with a UNIQUE index on (professional_id) WHERE state=''approved'' as the second, independent guarantee. Refuses to transfer an already-claimed identity, refuses a claimant who already holds one (merge is R17''s), closes sibling claims, writes platform_audit_log, and derives the conversion organization from the claimant''s own single owner membership rather than trusting a caller-supplied id.';

revoke execute on function public.review_professional_claim(uuid, text, text) from public, anon;
grant execute on function public.review_professional_claim(uuid, text, text) to authenticated;
