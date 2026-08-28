-- FadeUp — R4: publication is an operator's decision, enforced structurally
--
-- R1B shipped create_external_professional and wrote, in its own report, that
-- the Worker call site belonged to R4. What it could not ship was the thing
-- that decides WHETHER to call it, so the RPC's only protection was that no
-- code had reached it yet.
--
-- This file closes that with two mechanisms that do different jobs:
--
--   1. A BEFORE INSERT TRIGGER on prospect_professionals that consults the LIVE
--      gate. This is the guarantee. It does not care who is inserting, through
--      which function, holding which role. create_external_professional, a
--      future R10 auto-publish lane, a platform administrator with a psql
--      session and a good reason — all three hit the same wall.
--
--   2. publish_external_professional(), the operator's front door. It re-checks
--      the gate first so the caller gets a NAMED reason instead of a trigger
--      exception, takes the decision under a lock, writes the audit trail and
--      refreshes the cache.
--
-- (2) without (1) is a suggestion. (1) without (2) is a wall with no door.
--
-- CONSTITUTION §5.5 — "This must be structurally difficult to violate, not
-- merely discouraged." R1B satisfied §5.5 for OPERATIONAL truth by not
-- modelling it: an external identity has no barbers row, so it has no
-- availability, no queue, no schedule. This file satisfies the other half —
-- that an identity is not minted at all until the evidence supports one —
-- and it does so with a trigger rather than a convention for the same reason.
--
-- WHY THE TRIGGER READS THE LIVE FUNCTION AND NOT THE CACHE
--
-- prospect_publication_eligibility is refreshed by a Worker sweep, so it is
-- always somewhat behind. A trigger that trusted it would mean "this prospect
-- was publishable at some point in the recent past", and the gap is exactly
-- where the dangerous cases live: a duplicate flagged five minutes ago, a
-- suppression added this morning. The cache serves the review list; the live
-- function serves the decision.
--
-- A NOTE ON THE COST THIS IMPOSES ON R1B'S VERIFY
--
-- VERIFY_R1B §7, §9 and §14 mint external identities from fixture prospects
-- that carry no source records, matching a world in which nothing gated
-- minting. Those fixtures now fail on insufficient_source_evidence, correctly.
-- R4 upgrades them to provision real provenance rather than exempting the
-- fixtures from the gate — the same move the Service Mode lot made when its
-- admission rules invalidated R1A's unentitled fixture. A test that has to
-- route around a guarantee is testing the wrong thing.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The wall
--
-- SECURITY DEFINER because the gate reads the whole acquisition schema —
-- suppressions, duplicates, source records, locations — and the trigger must
-- reach an identical verdict no matter which role's INSERT fired it. A verdict
-- that varied by caller would not be a guarantee.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_prospect_publication_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    -- Provenance is evidence (R1B's own words on the RESTRICT further down
    -- this table). Repointing a link would silently reattribute an identity to
    -- a business it was never discovered from, and would do it without ever
    -- passing the gate, since the gate only guards INSERT.
    if new.prospect_id is distinct from old.prospect_id
       or new.professional_id is distinct from old.professional_id then
      raise exception 'a prospect-to-identity link cannot be repointed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_reason := public.publication_block_reason(new.prospect_id);

  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501',
            hint = 'Resolve the blocking condition rather than bypassing the gate; see public.publication_block_reason.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_prospect_publication_gate() is
  'BEFORE INSERT OR UPDATE invariant on prospect_professionals, and the structural half of Constitution §5.5. Every path that could mint an external professional identity passes through this INSERT, so the gate cannot be bypassed by choosing a different function, a different role or a direct session — there is no role exemption, including for platform administrators and service_role. On UPDATE it freezes the link''s two endpoints, so provenance cannot be reattributed after the fact.';

drop trigger if exists prospect_professionals_enforce_publication_gate
  on public.prospect_professionals;
create trigger prospect_professionals_enforce_publication_gate
  before insert or update on public.prospect_professionals
  for each row execute function public.enforce_prospect_publication_gate();

-- ---------------------------------------------------------------------------
-- 2. The door
--
-- Platform administrators only. Deliberately NOT callable by the Worker:
-- R4's division of labour is that the machine evaluates evidence and a human
-- decides. The Worker has EXECUTE on create_external_professional from R1B
-- and keeps it — that grant is now harmless, because the gate stands behind
-- it either way — but nothing in the Worker calls it, and the operator UI is
-- the only publication path that exists.
-- ---------------------------------------------------------------------------

create or replace function public.publish_external_professional(
  p_prospect_id uuid,
  p_note text default null
)
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

comment on function public.publish_external_professional(uuid, text) is
  'The operator''s front door for minting an external unclaimed professional identity, and the only publication path R4 ships. Platform administrators only, and deliberately NOT the Worker: the machine evaluates evidence, a human decides. Idempotent per prospect, serialised on the prospect row so a double-click cannot produce a second identity, audited to platform_audit_log with the name as published, and it refreshes the eligibility cache so the queue reflects the decision at once.';

revoke execute on function public.publish_external_professional(uuid, text) from public, anon;
grant execute on function public.publish_external_professional(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The review queue read contract
--
-- A view rather than "let the UI join four tables": the operator screen must
-- not be able to widen its own projection. prospects carries commercial
-- scoring, contact details and internal sales state, none of which belongs on
-- a screen whose only question is "is this a real business worth an identity".
--
-- security_invoker so the caller's platform-role policies still apply — the
-- view is a narrower projection, never an escalation.
-- ---------------------------------------------------------------------------

-- ---- WHY THIS VIEW DOES NOT JOIN prospect_professionals --------------------
--
-- The obvious shape is a LEFT JOIN onto the linkage table, giving the operator
-- screen the minted professional_id and an honest `is_published` flag.
--
-- It is not done, because this view is security_invoker: the join would execute
-- with the CALLER's privileges, and R1B revoked SELECT on
-- prospect_professionals from `authenticated` entirely. Making the join work
-- would mean re-granting it — and R1B's VERIFY §8.16 asserts, as a named check,
-- that an ordinary account cannot SELECT acquisition provenance at all.
--
-- That revoke plus the platform-staff policy R1B also wrote is belt AND
-- braces: the policy alone would already return zero rows to an ordinary
-- account, so the grant being absent is a second, independent layer. Removing
-- one of two layers to render a column this screen does not display would be a
-- bad trade, so the flag is derived from the cached verdict instead.
--
-- The cost is honest and small: `is_published` is as fresh as the cache. It is
-- correct immediately after a publication, because publish_external_professional
-- refreshes the row in the same transaction, and the screen offers a Re-check
-- action for every other case.

-- DROP then CREATE, not CREATE OR REPLACE: replace cannot remove a column from
-- an existing view, and an environment that applied an earlier revision of this
-- file has a `professional_id` column that must go. Dropping a view removes a
-- projection, never data, and this one has no dependents.
drop view if exists public.prospect_publication_queue;

create view public.prospect_publication_queue
with (security_invoker = true) as
select
  p.id                        as prospect_id,
  p.canonical_name,
  p.country,
  p.entity_kind,
  p.type                      as prospect_type,
  p.website_domain,
  p.first_discovered_at,
  e.is_eligible,
  e.block_reason,
  e.distinct_source_count,
  e.has_trust_anchor,
  e.evaluated_at,
  (e.block_reason = 'already_published') as is_published
from public.prospects p
join public.prospect_publication_eligibility e on e.prospect_id = p.id;

comment on view public.prospect_publication_queue is
  'The operator review queue for external-profile publication. A deliberately NARROW projection of prospects: name, country, kind, domain and the gate''s own evidence — and none of the commercial score, contact details or sales pipeline state that live on the same row, because the publication decision is about whether a business is real, not whether it is a good lead. security_invoker, so platform-role RLS on the underlying tables still decides who sees anything. Deliberately does NOT join prospect_professionals: that would require re-granting SELECT on it to `authenticated`, removing one of the two independent layers R1B put in front of acquisition provenance, to populate a column this screen does not display.';

revoke all on public.prospect_publication_queue from anon, authenticated;
grant select on public.prospect_publication_queue to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Worker's new job type
--
-- publication_evaluation refreshes the cache for a bounded batch. It is the
-- Worker's entire involvement in publication: it decides nothing, it only keeps
-- the operator's queue current — including for prospects that are currently
-- BLOCKED, because a duplicate being resolved or a second source landing is
-- exactly what turns a blocked prospect into a candidate, and nothing else in
-- the system would notice.
--
-- The constraint is rewritten in full rather than patched, because a CHECK
-- cannot be extended in place. Every pre-existing value is carried forward
-- verbatim; the only difference is the last entry.
-- ---------------------------------------------------------------------------

alter table public.prospect_jobs drop constraint if exists prospect_jobs_job_type_check;
alter table public.prospect_jobs add constraint prospect_jobs_job_type_check
  check (job_type = any (array[
    'discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl',
    'instagram_enrich', 'search_plan', 'identity_resolution',
    'competitor_detection', 'website_enrichment', 'feature_computation',
    'fit_scoring', 'segmentation', 'locale_resolution', 'data_quality',
    'ml_prediction', 'outreach_preparation', 'whatsapp_send',
    'outcome_processing',
    'publication_evaluation'
  ]::text[]));
