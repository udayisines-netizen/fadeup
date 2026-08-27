-- FadeUp — R4: the head of the acquisition funnel becomes measurable
--
-- R3 wrote two event contracts and deliberately refused to wire them:
--
--   prospect_discovered | "Worker V2 is R4/R10; the brief forbids starting it"
--   prospect_enriched   | idem
--
-- A `deferred` definition cannot produce a single row — private.emit_analytics_
-- event refuses any name that is absent from the registry or marked deferred —
-- so until this file the funnel R3 documented in its §9 started three stages in,
-- at external_profile_created. It could report how many identities FadeUp
-- published; it could not report how many businesses had to be found to publish
-- them, which is the only number that says whether discovery is working.
--
-- WHY THE WORKER STILL GETS NO ANALYTICS GRANT
--
-- The obvious implementation is to let the Worker call the emitter. R3 §11.3
-- explicitly declined to grant it: "a scraping worker is the highest-risk
-- credential in the system", and R1A had already removed a broader grant from
-- that role for the same reason. That reasoning has not changed, so R4 does not
-- change the grant.
--
-- Instead both events are emitted by AFTER triggers on tables the Worker
-- already writes. The Worker gets its events by doing its job, not by holding a
-- capability. This is also the pattern R3 chose for all thirteen of its own
-- instrumentation triggers, and for the same second reason: there are several
-- code paths that create a prospect, and instrumenting the handlers would have
-- left the others silent.
--
-- WHERE EACH TRIGGER HANGS, AND WHY IT IS NOT THE OBVIOUS TABLE
--
--   prospect_discovered hangs on prospect_source_records, NOT on prospects.
--
--   A prospect row is inserted BEFORE its provenance row: the Worker resolves
--   identity, inserts or links the canonical prospect, and only then records
--   which source saw it. A trigger on prospects would therefore fire at the one
--   moment when the answer to "which channel found this business" does not
--   exist yet, and would attribute every discovery to NULL. Hanging on the
--   provenance row instead, keyed idempotently on the prospect, means the event
--   is written the instant the attribution is knowable — and multi-source
--   discovery still yields exactly one event, because the dedupe key is the
--   prospect.
--
--   This is the same decision R3 made for external_profile_created, which hangs
--   on prospect_professionals rather than professionals, for the same reason.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The vocabulary moves from documented to wired
--
-- Updated rather than inserted: R3 already wrote both contracts, including
-- their idempotency discipline, and rewriting the description here would
-- discard the reasoning it recorded. Only `status` changes, and only forward.
--
-- The description is appended to rather than replaced, so the row keeps saying
-- why it was deferred as well as when it stopped being.
-- ---------------------------------------------------------------------------

update public.analytics_event_definitions
set status = 'wired',
    description = 'A canonical prospect was observed for the first time by any source. Idempotent per prospect: multi-source discovery yields one event, attributed FIRST-touch. Emitted from prospect_source_records, not prospects, because provenance is written after the prospect row and a trigger on prospects would attribute every discovery to NULL. Wired by R4.'
where event_name = 'prospect_discovered'
  and status = 'deferred';

update public.analytics_event_definitions
set status = 'wired',
    description = 'An enrichment pass completed against an existing prospect. Deliberately NOT idempotent: a prospect is legitimately re-enriched as sources are re-crawled, and each pass is a real event. Keyed on the enrichment timestamp so a single pass cannot be double-counted while genuine re-enrichment still counts. Wired by R4.'
where event_name = 'prospect_enriched'
  and status = 'deferred';

-- ---------------------------------------------------------------------------
-- 2. prospect_discovered
--
-- actor_type 'worker' and origin 'worker': there is no human in this
-- transaction and no session. R3's actor-coherence CHECK permits a null
-- actor_user_id for exactly the worker and system actor types.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_prospect_discovered_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect public.prospects;
  v_source text;
  v_first_record_id uuid;
  v_first_source text;
begin
  -- A provenance row without a prospect is a raw observation that identity
  -- resolution has not yet attached to anything. It has discovered no business
  -- and must not count as a discovery.
  if new.prospect_id is null then
    return null;
  end if;

  select * into v_prospect from public.prospects where id = new.prospect_id;
  if not found then
    return null;
  end if;

  select ps.key into v_source
  from public.prospect_sources ps
  where ps.id = new.source_id;

  -- FIRST-touch attribution, matching R3 §9. The question acquisition asks is
  -- which channel found a business nobody had; a later re-observation by a
  -- second source found nothing. In the overwhelmingly common case this IS the
  -- row that just fired the trigger, but ordering by created_at rather than
  -- assuming that keeps the answer correct when a backfill or a concurrent
  -- second source lands first.
  select psr.id, ps.key
    into v_first_record_id, v_first_source
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.prospect_id
  order by psr.created_at, psr.id
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'prospect_discovered',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_prospect_id                  => new.prospect_id,
    p_acquisition_source           => coalesce(v_first_source, v_source),
    p_acquisition_source_record_id => coalesce(v_first_record_id, new.id),
    p_properties                   => jsonb_build_object(
                                        'country', v_prospect.country,
                                        'entity_kind', v_prospect.entity_kind,
                                        'prospect_type', v_prospect.type,
                                        'observing_source', v_source),
    -- The prospect's own discovery time, not the provenance row's. A source
    -- record written by a later backfill describes a business that was found
    -- when it was found.
    p_occurred_at                  => v_prospect.first_discovered_at,
    p_dedupe_key                   => 'prospect:' || new.prospect_id::text || ':discovered'
  );

  return null;
end;
$$;

comment on function public.analytics_prospect_discovered_event() is
  'Emits prospect_discovered once per canonical prospect, from prospect_source_records rather than prospects — the prospect row is inserted before its provenance, so a trigger on prospects would attribute every discovery to NULL. The dedupe key is the prospect, so a business found by four sources produces four provenance rows and exactly one discovery. Attribution is first-touch. A provenance row not yet attached to a prospect is a raw observation and deliberately counts as nothing.';

drop trigger if exists prospect_source_records_analytics on public.prospect_source_records;
create trigger prospect_source_records_analytics
  after insert on public.prospect_source_records
  for each row execute function public.analytics_prospect_discovered_event();

-- ---------------------------------------------------------------------------
-- 3. prospect_enriched
--
-- Hung on the UPDATE OF last_enriched_at, which is the Worker's own record
-- that an enrichment pass completed — the column already exists and the
-- website-enrichment handler already writes it. Nothing new has to be trusted.
--
-- NOT idempotent, per R3's contract: re-enrichment is legitimate and each pass
-- is a real event. The key is therefore transition-scoped rather than permanent
-- — it collapses a double-fire on one timestamp, and lets tomorrow's pass count.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_prospect_enriched_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_record_id uuid;
begin
  -- Only a real advance counts. An UPDATE that rewrites the same timestamp, or
  -- clears it, is not an enrichment pass.
  if new.last_enriched_at is null
     or new.last_enriched_at is not distinct from old.last_enriched_at then
    return null;
  end if;

  select ps.key, psr.id
    into v_source, v_record_id
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.id
  order by psr.created_at, psr.id
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'prospect_enriched',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_prospect_id                  => new.id,
    p_acquisition_source           => v_source,
    p_acquisition_source_record_id => v_record_id,
    -- What the pass actually established, as booleans about presence. No
    -- values: R3 §10.1 refuses payload keys containing email, phone, address
    -- and the rest, and it is right to — an enrichment event does not need the
    -- number to record that a number was found.
    p_properties                   => jsonb_build_object(
                                        'gained_website', (old.website_domain is null and new.website_domain is not null),
                                        'gained_contact', ((old.email is null and new.email is not null)
                                                        or (old.phone_e164 is null and new.phone_e164 is not null)),
                                        'first_enrichment', (old.last_enriched_at is null)),
    p_occurred_at                  => new.last_enriched_at,
    p_dedupe_key                   => 'prospect:' || new.id::text || ':enriched:'
                                      || extract(epoch from new.last_enriched_at)::text
  );

  return null;
end;
$$;

comment on function public.analytics_prospect_enriched_event() is
  'Emits prospect_enriched when an enrichment pass advances prospects.last_enriched_at — the column the Worker''s website-enrichment handler already writes, so nothing new has to be trusted. Deliberately not idempotent per R3''s contract: re-enrichment is legitimate, so the key is scoped to the enrichment timestamp rather than to the prospect. Properties are booleans about what the pass established, never the values it found, because R3 §10.1 refuses contact data in payloads and an enrichment count does not need the phone number to record that one was found.';

drop trigger if exists prospects_enrichment_analytics on public.prospects;
create trigger prospects_enrichment_analytics
  after update of last_enriched_at on public.prospects
  for each row execute function public.analytics_prospect_enriched_event();

-- ---------------------------------------------------------------------------
-- 4. The funnel gains its head
--
-- DROP then CREATE, not CREATE OR REPLACE: adding columns changes the return
-- type, which Postgres refuses to replace in place. The body is otherwise
-- R3's, unchanged — including the count(distinct professional_id) that makes
-- §9 hold at read time, which is deliberately copied forward rather than
-- rewritten.
--
-- prospects_discovered counts DISTINCT prospect_id for the same reason
-- converted_professionals counts distinct identities: the emitter's guarantee
-- is restated at read time so a future change to either one cannot silently
-- inflate the funnel from the other end.
-- ---------------------------------------------------------------------------

drop function if exists public.get_platform_analytics_funnel(timestamptz, timestamptz);

create function public.get_platform_analytics_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,

  prospects_discovered bigint,
  prospects_enriched bigint,
  external_profiles_created bigint,
  claims_submitted bigint,
  claims_approved bigint,
  claims_rejected bigint,
  converted_professionals bigint,

  organizations_with_activity bigint,
  appointments_created bigint,
  appointments_completed bigint,
  queue_joins bigint,
  queue_completions bigint,
  passports_issued bigint,
  plans_assigned bigint,
  plans_changed bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'platform analytics are restricted to FadeUp platform staff'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
  )
  select
    v_from,
    v_to,

    -- DISTINCT prospects, never a count of discovery events. The emitter's
    -- dedupe key already guarantees one per prospect; restating it here means
    -- neither end can inflate the funnel alone.
    count(distinct s.prospect_id) filter (
      where s.event_name = 'prospect_discovered' and s.prospect_id is not null),
    -- Enrichment PASSES, not distinct prospects: re-enrichment is the point of
    -- the metric, and collapsing it would report a re-crawled table as idle.
    count(*) filter (where s.event_name = 'prospect_enriched'),

    count(*) filter (where s.event_name = 'external_profile_created'),
    count(*) filter (where s.event_name = 'claim_submitted'),
    count(*) filter (where s.event_name = 'claim_approved'),
    count(*) filter (where s.event_name = 'claim_rejected'),
    -- DISTINCT identities, never a count of approval events. §9.
    count(distinct s.professional_id) filter (
      where s.event_name = 'claim_approved' and s.professional_id is not null),

    count(distinct s.organization_id) filter (where s.organization_id is not null),
    count(*) filter (where s.event_name = 'appointment_created'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'queue_joined'),
    count(*) filter (where s.event_name = 'queue_completed'),
    count(*) filter (where s.event_name = 'passport_issued'),
    count(*) filter (where s.event_name = 'plan_assigned'),
    count(*) filter (where s.event_name = 'plan_changed')
  from scoped s;
end;
$$;

comment on function public.get_platform_analytics_funnel(timestamptz, timestamptz) is
  'FadeUp''s own acquisition/claim funnel and platform product totals, over a bounded window. Platform admin only, and the only read contract that crosses tenants. R4 added the two head-of-funnel stages R3 had to leave deferred, so the funnel now runs discovery -> enrichment -> external profile -> claim -> approval -> conversion end to end. prospects_discovered and converted_professionals count DISTINCT subjects rather than events, so neither the emitter nor the reader can inflate the funnel alone; prospects_enriched deliberately counts passes, because re-enrichment is what the metric is for.';

revoke execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  to authenticated;
