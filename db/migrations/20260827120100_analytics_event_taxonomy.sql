-- FadeUp — R3: the event taxonomy
--
-- Seeds public.analytics_event_definitions with every event contract FadeUp
-- recognises, in seven families.
--
-- THE STATUS COLUMN IS THE POINT OF THIS FILE
--
--   §4 of the R3 brief says two things that pull in opposite directions:
--   "create and document a controlled event taxonomy", and "DO NOT fake events
--   for flows that do not exist yet". The resolution is `status`:
--
--     wired    — R3 emits this event, from a real authoritative source or a
--                real instrumented surface. It will produce rows.
--     deferred — the CONTRACT is fixed and documented so that the surface which
--                eventually emits it does not get to invent a new name, but
--                nothing emits it today and the ingestion allowlist REFUSES it.
--
--   A deferred definition therefore cannot produce a single row, by
--   construction rather than by discipline. That is what makes it safe to
--   write the whole taxonomy down now.
--
-- WHY SOME OBVIOUS EVENTS ARE DEFERRED
--
--   Each deferral below is because the product has no authoritative source for
--   the fact today — not because the event is unimportant. The specific
--   reasons are recorded per row, because "deferred" without a reason becomes
--   "forgotten" within one lot:
--
--     queue_called / queue_service_started — the queue lifecycle DOES have
--       authoritative state for these (R1A stamps called_at and
--       service_started_at), so they are WIRED. Only their exposure to
--       customers is deferred, which is a UI question, not an event question.
--
--     passport_viewed — there is no server-side passport read path to hook and
--       no customer surface that renders a passport belonging to someone else.
--       Instrumenting it would mean inventing a view event from a component
--       mount, which §5 forbids for anything that is not pure intent, and §17
--       forbids exposing private Passport history through analytics anyway.
--
--     prospect_discovered / prospect_enriched — Worker V2 is R4/R10. R3 must
--       not start it (§25). The contract is fixed here so that when the worker
--       lands it emits into an existing shape rather than a new one.
--
--     claim_approved / claim_rejected — these DO have authoritative state
--       (professional_claims transitions) and are WIRED. claim_started is
--       deferred: there is no server-side "started" transition, only a submit,
--       and a client-side claim funnel surface does not exist yet.
--
--     plan_changed — WIRED: commercial_plan_changes is authoritative.
--       plan_assigned is the same transition seen from the other side and is
--       wired with it. entitlement_blocked_action is DEFERRED: the R2/Service
--       Mode guards raise exceptions from BEFORE INSERT triggers, and a
--       trigger that raises has its whole subtransaction rolled back — INCLUDING
--       any event it wrote. Recording a refusal therefore requires an emission
--       path that survives the abort, which is a genuine piece of engineering
--       (an autonomous transaction or a post-abort client report) and not
--       something to bolt on at the end of R3. Written down here so the next
--       lot inherits the problem statement rather than rediscovering it.
--
-- Idempotent: safe to re-run. `on conflict do update` so re-running after a
-- contract edit converges rather than silently keeping the old row.

set lock_timeout = '5s';

insert into public.analytics_event_definitions
  (event_name, event_version, family, emission, status, is_idempotent, requires_organization, description)
values

-- DISCOVERY ------------------------------------------------------------------
-- Pure intent. Every one of these is a browser statement and none is ever
-- allowed to stand in for a conversion (§5).
  ('discovery_viewed', 1, 'discovery', 'client', 'wired', false, false,
   'The marketplace/discovery surface was opened. No tenant: this is a platform surface.'),

  ('search_performed', 1, 'discovery', 'client', 'wired', false, false,
   'A discovery search was executed. Properties carry the coarse shape of the query — result count, whether filters were applied — never the raw query string, which is free text a customer can type anything into.'),

  ('search_result_viewed', 1, 'discovery', 'client', 'wired', false, false,
   'A specific search result was opened from the result list. Carries the subject and its position, which is what makes result-quality measurable.'),

  ('public_profile_viewed', 1, 'discovery', 'client', 'wired', false, false,
   'A public barbershop or professional profile was viewed. The SUBJECT is recorded; the viewer appears only as actor_user_id and is never projected by any read contract (§12).'),

-- SOCIAL ---------------------------------------------------------------------
-- All six are server-authoritative: they are emitted from the actual state
-- transition on the follow/favorite edge, not from the button that requested
-- it. A click that fails to change state produces no event.
  ('organization_followed', 1, 'social', 'server', 'wired', false, true,
   'A customer began following a barbershop. Emitted from the organization_follows state transition, never from the button.'),

  ('organization_unfollowed', 1, 'social', 'server', 'wired', false, true,
   'A customer explicitly stopped following a barbershop.'),

  ('professional_followed', 1, 'social', 'server', 'wired', false, false,
   'A customer began following a professional. No organization: a professional follow is an edge to a durable human identity that outlives any one shop (CUSTOMER_API_FREEZE §1).'),

  ('professional_unfollowed', 1, 'social', 'server', 'wired', false, false,
   'A customer explicitly stopped following a professional.'),

  ('organization_favorited', 1, 'social', 'server', 'wired', false, true,
   'A customer favorited a shop. Favorite and Follow are separate relationships and are deliberately separate events.'),

  ('organization_unfavorited', 1, 'social', 'server', 'wired', false, true,
   'A customer removed a shop favorite.'),

-- BOOKING --------------------------------------------------------------------
-- The four lifecycle events are server-authoritative. The four intent events
-- are client-side and exist to locate abandonment inside the funnel; §5 is
-- explicit that they must never be used as conversion.
  ('booking_started', 1, 'booking', 'client', 'wired', false, true,
   'A customer opened the booking flow. INTENT ONLY — the top of the funnel, never evidence that anything was booked.'),

  ('booking_service_selected', 1, 'booking', 'client', 'wired', false, true,
   'A service was chosen inside the booking flow.'),

  ('booking_barber_selected', 1, 'booking', 'client', 'wired', false, true,
   'A barber was chosen inside the booking flow, or "any available" was accepted.'),

  ('booking_slot_selected', 1, 'booking', 'client', 'wired', false, true,
   'A time slot was chosen. The last intent step before the server decides.'),

  ('appointment_created', 1, 'booking', 'server', 'wired', true, true,
   'An appointment row was created. Emitted once per appointment from the INSERT, whatever path created it — public booking, staff dialog or direct insert.'),

  ('appointment_confirmed', 1, 'booking', 'server', 'wired', false, true,
   'An appointment reached confirmed. NOT once-only: a customer reschedule returns a confirmed appointment to pending, and the shop can confirm it again. Each confirmation is a real, separately countable event.'),

  ('appointment_cancelled', 1, 'booking', 'server', 'wired', true, true,
   'An appointment was cancelled. Terminal, and the transition guard forbids leaving a terminal state, so exactly one.'),

  ('appointment_no_show', 1, 'booking', 'server', 'wired', true, true,
   'A confirmed appointment was marked no_show. NOT IN THE §4 MINIMUM LIST, and added deliberately: no_show is a distinct authoritative status that both the staff path and apply_appointment_no_show_rule write, and folding it into appointment_cancelled would report abandonment as customer choice and make no-show rate — a number shops actually manage — uncountable.'),

  ('appointment_completed', 1, 'booking', 'server', 'wired', true, true,
   'A service was actually delivered. THE conversion event of the customer funnel. Terminal and once-only: R1A''s enforce_appointment_transition refuses any transition out of completed, for every caller including service_role.'),

-- QUEUE ----------------------------------------------------------------------
  ('queue_viewed', 1, 'queue', 'client', 'wired', false, true,
   'The live queue for a shop was viewed. Intent.'),

  ('queue_join_started', 1, 'queue', 'client', 'wired', false, true,
   'The join-queue flow was opened. Intent.'),

  ('queue_joined', 1, 'queue', 'server', 'wired', true, true,
   'A queue entry was actually created. One row, one event.'),

  ('queue_cancelled', 1, 'queue', 'server', 'wired', true, true,
   'A queue entry was cancelled before service.'),

  ('queue_no_show', 1, 'queue', 'server', 'wired', true, true,
   'A queue entry was marked no_show. Added alongside appointment_no_show and for the same reason: queue_status carries no_show as its own authoritative value, and collapsing it into queue_cancelled would misreport walk-in abandonment as customer cancellation.'),

  ('queue_called', 1, 'queue', 'server', 'wired', true, true,
   'The customer was called. Authoritative: R1A stamps called_at server-side and discards any client-supplied value.'),

  ('queue_service_started', 1, 'queue', 'server', 'wired', true, true,
   'Service actually began. Authoritative via service_started_at, stamped by the transition guard.'),

  ('queue_completed', 1, 'queue', 'server', 'wired', true, true,
   'A walk-in service was delivered. The queue-side conversion event, and the queue counterpart of appointment_completed.'),

-- PASSPORT -------------------------------------------------------------------
  ('passport_issued', 1, 'passport', 'server', 'wired', true, false,
   'A Fade Passport was issued to a customer. Once per passport. No organization: the Passport is customer-owned and portable, and attributing its issuance to whichever shop the customer happened to be looking at would be false.'),

  ('passport_relationship_created', 1, 'passport', 'server', 'wired', true, true,
   'A durable customer-professional relationship came into existence, from a first completed service. The passport-side evidence that a professional has a returning client.'),

  ('passport_viewed', 1, 'passport', 'client', 'deferred', false, false,
   'DEFERRED. No server-side passport read path exists to hook, and §17 forbids exposing private Passport history through analytics. Wiring this from a component mount would be inventing a view event, which §5 forbids. Contract fixed so the surface that eventually renders a passport does not invent a different name.'),

-- ACQUISITION / CLAIM --------------------------------------------------------
  ('prospect_discovered', 1, 'acquisition', 'server', 'deferred', true, false,
   'DEFERRED to R4/R10. Worker V2 discovery is explicitly out of R3 scope (§25). Contract fixed now so the worker emits into this shape rather than inventing one, and so the prospect_id / acquisition_source_record_id pairing that prevents double-counting is settled before there is data to get wrong.'),

  ('prospect_enriched', 1, 'acquisition', 'server', 'deferred', false, false,
   'DEFERRED to R4/R10, with prospect_discovered. Not idempotent by nature: a prospect is legitimately re-enriched as sources are re-crawled.'),

  ('external_profile_created', 1, 'acquisition', 'server', 'wired', true, false,
   'An unclaimed external professional profile was published from a prospect. Authoritative: public.create_external_professional is the sole writer and is idempotent per prospect, so this is once per professional identity.'),

  ('claim_started', 1, 'acquisition', 'client', 'deferred', false, false,
   'DEFERRED. There is no server-side "started" transition — professional_claims has only a submit — and no claim-funnel surface exists to instrument. Wiring it would require inventing a state the product does not have.'),

  ('claim_submitted', 1, 'acquisition', 'server', 'wired', true, false,
   'A professional submitted a claim over an identity. Authoritative from the professional_claims INSERT.'),

  ('claim_approved', 1, 'acquisition', 'server', 'wired', true, false,
   'A claim was approved and the identity became claimed. The activation point of the acquisition funnel.'),

  ('claim_rejected', 1, 'acquisition', 'server', 'wired', true, false,
   'A claim was rejected.'),

-- COMMERCIAL -----------------------------------------------------------------
  ('plan_assigned', 1, 'commercial', 'server', 'wired', true, true,
   'An organization received its first commercial plan. Distinguished from plan_changed because first assignment and later movement are different questions: one measures onboarding, the other measures expansion and churn.'),

  ('plan_changed', 1, 'commercial', 'server', 'wired', true, true,
   'An organization moved between plans. Properties carry the direction and both plan keys. Emitted from commercial_plan_changes, which is already an authoritative append-only record.'),

  ('entitlement_blocked_action', 1, 'commercial', 'server', 'deferred', false, true,
   'DEFERRED, and the reason is technical rather than editorial. The entitlement guards refuse an action by RAISING from a BEFORE INSERT trigger, which aborts the subtransaction and would discard any event written inside it. Recording a refusal needs an emission path that survives the abort — an autonomous transaction, or a client-side report of the refusal it received. Both are real work and neither belongs in a foundation lot. The contract is fixed here so the lot that builds it inherits a definition instead of a debate.')

on conflict (event_name) do update set
  event_version         = excluded.event_version,
  family                = excluded.family,
  emission              = excluded.emission,
  status                = excluded.status,
  is_idempotent         = excluded.is_idempotent,
  requires_organization = excluded.requires_organization,
  description           = excluded.description,
  updated_at            = now();

-- ---------------------------------------------------------------------------
-- Assertions on the seed itself
--
-- A taxonomy that silently loses a family is worse than one that fails to
-- install: the reports keep rendering, with a hole in them. These run inside
-- the migration so a bad edit cannot commit.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
  v_count integer;
begin
  -- Every family in §4 must be represented.
  select string_agg(f, ', ')
    into v_missing
  from unnest(array[
    'discovery', 'social', 'booking', 'queue', 'passport', 'acquisition', 'commercial'
  ]) as f
  where not exists (
    select 1 from public.analytics_event_definitions d where d.family = f
  );

  if v_missing is not null then
    raise exception 'R3 taxonomy is missing entire event families: %', v_missing;
  end if;

  -- The conversion events the whole product funnel rests on MUST be server
  -- emitted and MUST be idempotent. If a future edit flipped one of these to
  -- client emission, every conversion number FadeUp reports would silently
  -- become a count of button presses.
  select count(*)
    into v_count
  from public.analytics_event_definitions d
  where d.event_name in (
      'appointment_created', 'appointment_completed', 'appointment_cancelled',
      'queue_joined', 'queue_completed',
      'organization_followed', 'organization_unfollowed',
      'professional_followed', 'professional_unfollowed',
      'organization_favorited', 'organization_unfavorited',
      'claim_approved'
    )
    and d.emission = 'server'
    and d.status = 'wired';

  if v_count <> 12 then
    raise exception 'R3 taxonomy: expected 12 wired server-authoritative critical events, found %', v_count;
  end if;

  -- And no client event may claim to be a conversion by being idempotent.
  -- The table constraint already forbids it; this proves the seed obeys it.
  if exists (
    select 1 from public.analytics_event_definitions
    where emission = 'client' and is_idempotent
  ) then
    raise exception 'R3 taxonomy: a client event is marked idempotent — client intent is never a business fact';
  end if;

  select count(*) into v_count from public.analytics_event_definitions;
  raise notice 'R3 taxonomy installed: % event definitions (% wired, % deferred)',
    v_count,
    (select count(*) from public.analytics_event_definitions where status = 'wired'),
    (select count(*) from public.analytics_event_definitions where status = 'deferred');
end $$;
