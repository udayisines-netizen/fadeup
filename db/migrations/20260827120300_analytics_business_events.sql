-- FadeUp — R3: authoritative business events
--
-- Every event created here comes from a REAL STATE TRANSITION in a table that
-- is already the product's truth. Not one comes from a button.
--
-- THE RULE THIS FILE EXISTS TO ENFORCE (§5)
--
--   CLICK != BUSINESS SUCCESS.
--
--   A customer who taps Follow and whose request then fails must not appear in
--   the follower funnel. The only way to guarantee that is to emit from the
--   row that changed, inside the transaction that changed it — so an event
--   exists if and only if the fact does. A frontend cannot offer that
--   guarantee at any level of care, which is why none of the conversion events
--   in this file are reachable from apps/web.
--
-- WHY AFTER TRIGGERS, AND NOT EDITS TO THE RPCs
--
--   There are four ways to create an appointment and three to create a queue
--   entry — a public RPC, a staff dialog, a direct PostgREST insert, an
--   internal function. Instrumenting the RPCs would leave the other paths
--   silent and would put analytics inside two hundred lines of twice-hardened,
--   security-critical booking code. An AFTER trigger covers every path,
--   touches none of that code, and is exactly the pattern the repository
--   already uses for notifications (20260819100000) and for the
--   customer-professional relationship (20260826100400).
--
--   AFTER, never BEFORE: the event must describe a fact that has already been
--   accepted by every constraint and guard in front of it.
--
-- WHY NONE OF THIS CAN BREAK THE PRODUCT (§14)
--
--   Every trigger calls private.try_emit_analytics_event, never the strict
--   emitter. That wrapper contains a subtransaction, so a malformed event, a
--   missing taxonomy row or a constraint violation rolls back the EVENT and
--   leaves the follow, booking, completion or claim entirely intact. The
--   failure lands in analytics_ingestion_rejections instead of on the customer.
--
--   This is verified rather than asserted: the R3 suite deliberately breaks
--   emission and proves the business action still commits.
--
-- IDEMPOTENCY, PER TRANSITION KIND (§6)
--
--   ONCE-ONLY transitions — completion, cancellation, creation, issuance —
--   get a PERMANENT entity-scoped key: 'appointment:<id>:completed'. R1A's
--   transition guards make a terminal state unleavable for every caller, so
--   that key can never legitimately be reused, and any retry or duplicated
--   trigger collapses onto the existing row.
--
--   REPEATABLE transitions — following, favoriting, re-confirming after a
--   reschedule — get a key scoped to the TRANSITION INSTANT:
--   'org_follow:<user>:<org>:followed:<epoch microseconds>'. MICROseconds, not
--   seconds: a follow, unfollow and re-follow can all land inside one second,
--   and a whole-second key would silently collapse the last two into the
--   first — the monotonic-undercount failure this whole scheme exists to
--   avoid. A second genuine follow next
--   month is a different instant and stays a separate event, which §6
--   explicitly requires; a duplicated trigger inside one transaction shares
--   now() and collapses. Using a permanent key here would silently swallow
--   every re-follow and make the social funnel monotonically wrong.
--
--   The triggers also fire ONLY on a genuine state change. A second Follow RPC
--   on an already-followed shop updates no state, so no trigger arm runs and
--   no event is written — the double-click case is handled before idempotency
--   is even needed.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.analytics_trigger_actor — who caused this transition
--
-- Three genuinely different situations, and conflating them would corrupt
-- every "who does this" report:
--
--   a signed-in account          -> that account, classified from real state
--   a signed-out browser request -> anonymous (a real anonymous booking IS a
--                                   real customer action)
--   no web session at all        -> system (a worker, a sweep, a migration)
--
-- session_user distinguishes (b) from (c): every request through PostgREST
-- arrives as `authenticator`, and nothing else does. This is the same
-- reasoning create_external_professional already relies on, reused rather than
-- reinvented.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_trigger_actor(
  out actor_user_id uuid,
  out actor_type public.analytics_actor_type
)
language plpgsql
stable
set search_path = ''
as $$
begin
  actor_user_id := (select auth.uid());

  if actor_user_id is not null then
    -- NULL means "let the emitter classify from real state".
    actor_type := null;
  elsif session_user = 'authenticator' then
    actor_type := 'anonymous';
  else
    actor_type := 'system';
  end if;
end;
$$;

comment on function private.analytics_trigger_actor() is
  'Resolves the actor for an event emitted from a trigger. Distinguishes a signed-in account (classified from real state by the emitter), a genuinely anonymous web request, and an internal session with no web request at all — using session_user, since every PostgREST request arrives as `authenticator` and nothing else does. Collapsing anonymous into system would erase every anonymous booking from the funnel.';

revoke all on function private.analytics_trigger_actor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. SOCIAL — organization follow
--
-- organization_follows mutates ONE row in place and keeps unfollows as
-- tombstones, so both directions are visible as a transition on is_following.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_organization_follow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_became_following boolean;
  v_became_unfollowed boolean;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_became_following  := new.is_following;
    v_became_unfollowed := not new.is_following;
  else
    -- Only a genuine change of direction. An idempotent re-follow updates
    -- followed_at but leaves is_following true, and must produce nothing.
    v_became_following  := new.is_following and not old.is_following;
    v_became_unfollowed := old.is_following and not new.is_following;
  end if;

  if not (v_became_following or v_became_unfollowed) then
    return null;
  end if;

  -- Only the acting account is needed: these three tables all name their own
  -- subject in a NOT NULL column, so the actor is never unknown and never has
  -- to be classified as anonymous or system.
  select a.actor_user_id into v_actor
  from private.analytics_trigger_actor() a;

  if v_became_following then
    perform private.try_emit_analytics_event(
      p_event_name      => 'organization_followed',
      p_event_origin    => 'backend',
      p_actor_user_id   => coalesce(v_actor, new.follower_user_id),
      p_organization_id => new.organization_id,
      p_occurred_at     => coalesce(new.followed_at, now()),
      -- Transition-scoped: follow, unfollow, follow again are three events.
      p_dedupe_key      => 'org_follow:' || new.follower_user_id::text || ':'
                           || new.organization_id::text || ':followed:'
                           || (extract(epoch from coalesce(new.followed_at, now())) * 1000000)::bigint::text
    );
  else
    perform private.try_emit_analytics_event(
      p_event_name      => 'organization_unfollowed',
      p_event_origin    => 'backend',
      p_actor_user_id   => coalesce(v_actor, new.follower_user_id),
      p_organization_id => new.organization_id,
      p_occurred_at     => coalesce(new.unfollowed_at, now()),
      p_dedupe_key      => 'org_follow:' || new.follower_user_id::text || ':'
                           || new.organization_id::text || ':unfollowed:'
                           || (extract(epoch from coalesce(new.unfollowed_at, now())) * 1000000)::bigint::text
    );
  end if;

  return null;
end;
$$;

comment on function public.analytics_organization_follow_event() is
  'Emits organization_followed / organization_unfollowed from the actual organization_follows state transition. Fires only when is_following genuinely changes direction, so a repeated Follow on an already-followed shop produces nothing. Non-fatal: a failed event never blocks the Follow.';

drop trigger if exists organization_follows_analytics on public.organization_follows;
create trigger organization_follows_analytics
  after insert or update on public.organization_follows
  for each row execute function public.analytics_organization_follow_event();

-- ---------------------------------------------------------------------------
-- 3. SOCIAL — professional follow
--
-- No organization_id, deliberately. A professional follow is an edge to a
-- durable human identity that outlives any shop placement
-- (CUSTOMER_API_FREEZE §1); attributing it to whichever shop the person
-- currently works at would make the number wrong the day they move.
--
-- `source` is carried in properties because auto-follow (created by a
-- completed service) and a deliberate manual follow are different social
-- facts, and a follower count that cannot tell them apart is not evidence of
-- anything.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_professional_follow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_became_following boolean;
  v_became_unfollowed boolean;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_became_following  := new.state = 'following';
    v_became_unfollowed := new.state = 'unfollowed';
  else
    v_became_following  := new.state = 'following' and old.state <> 'following';
    v_became_unfollowed := new.state = 'unfollowed' and old.state <> 'unfollowed';
  end if;

  if not (v_became_following or v_became_unfollowed) then
    return null;
  end if;

  -- Only the acting account is needed: these three tables all name their own
  -- subject in a NOT NULL column, so the actor is never unknown and never has
  -- to be classified as anonymous or system.
  select a.actor_user_id into v_actor
  from private.analytics_trigger_actor() a;

  perform private.try_emit_analytics_event(
    p_event_name      => case when v_became_following
                           then 'professional_followed'
                           else 'professional_unfollowed' end,
    p_event_origin    => 'backend',
    p_actor_user_id   => coalesce(v_actor, new.follower_user_id),
    p_professional_id => new.professional_id,
    p_properties      => jsonb_build_object('source', new.source::text),
    p_occurred_at     => coalesce(
                           case when v_became_following then new.followed_at else new.unfollowed_at end,
                           now()),
    p_dedupe_key      => 'pro_follow:' || new.follower_user_id::text || ':'
                         || new.professional_id::text || ':'
                         || case when v_became_following then 'followed:' else 'unfollowed:' end
                         || (extract(epoch from coalesce(
                              case when v_became_following then new.followed_at else new.unfollowed_at end,
                              now())) * 1000000)::bigint::text
  );

  return null;
end;
$$;

comment on function public.analytics_professional_follow_event() is
  'Emits professional_followed / professional_unfollowed from the professional_follows state transition, carrying source (manual vs auto) in properties because an auto-follow earned by a completed service and a deliberate follow are different social facts. Carries no organization: the edge is to a durable identity that outlives any shop placement.';

drop trigger if exists professional_follows_analytics on public.professional_follows;
create trigger professional_follows_analytics
  after insert or update on public.professional_follows
  for each row execute function public.analytics_professional_follow_event();

-- ---------------------------------------------------------------------------
-- 4. SOCIAL — shop favorite
--
-- customer_favorites has no state column: favoriting is an INSERT and
-- unfavoriting is a DELETE. Favorite and Follow stay separate events because
-- CUSTOMER_API_FREEZE §3 keeps them separate relationships.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_favorite_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.customer_favorites;
  v_actor uuid;
  v_direction text;
begin
  if tg_op = 'INSERT' then
    v_row := new;
    v_direction := 'favorited';
  else
    v_row := old;
    v_direction := 'unfavorited';
  end if;

  -- Only the acting account is needed: these three tables all name their own
  -- subject in a NOT NULL column, so the actor is never unknown and never has
  -- to be classified as anonymous or system.
  select a.actor_user_id into v_actor
  from private.analytics_trigger_actor() a;

  perform private.try_emit_analytics_event(
    p_event_name      => case when v_direction = 'favorited'
                           then 'organization_favorited'
                           else 'organization_unfavorited' end,
    p_event_origin    => 'backend',
    p_actor_user_id   => coalesce(v_actor, v_row.user_id),
    p_organization_id => v_row.organization_id,
    p_barber_id       => v_row.barber_id,
    -- A shop favorite and a specific-barber favorite are the same
    -- relationship at different granularity, and reports need to separate them.
    p_properties      => jsonb_build_object(
                           'scope', case when v_row.barber_id is null then 'shop' else 'barber' end),
    p_dedupe_key      => 'favorite:' || v_row.user_id::text || ':'
                         || v_row.organization_id::text || ':'
                         || coalesce(v_row.barber_id::text, 'shop') || ':'
                         || v_direction || ':'
                         || (extract(epoch from now()) * 1000000)::bigint::text
  );

  return null;
end;
$$;

comment on function public.analytics_favorite_event() is
  'Emits organization_favorited / organization_unfavorited from customer_favorites, where favoriting is an INSERT and unfavoriting a DELETE. Distinguishes a whole-shop favorite from a specific-barber favorite in properties. Favorite stays a separate event from Follow because they are separate relationships under CUSTOMER_API_FREEZE §3.';

drop trigger if exists customer_favorites_analytics on public.customer_favorites;
create trigger customer_favorites_analytics
  after insert or delete on public.customer_favorites
  for each row execute function public.analytics_favorite_event();

-- ---------------------------------------------------------------------------
-- 5. BOOKING — the appointment lifecycle
--
-- One function, both trigger arms, because the context resolution
-- (professional identity behind the barber placement) is identical and
-- duplicating it is how the two arms drift apart.
--
-- professional_id is looked up from barbers.professional_id: barber_id is an
-- operational placement and professional_id is the durable human. A report of
-- "services delivered by this person" must survive them changing shop, so the
-- event records both.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_type public.analytics_actor_type;
  v_professional_id uuid;
  v_event text;
  v_dedupe text;
  v_occurred timestamptz;
begin
  if tg_op = 'INSERT' then
    v_event   := 'appointment_created';
    v_dedupe  := 'appointment:' || new.id::text || ':created';
    v_occurred := new.created_at;
  else
    -- Status is the only thing this trigger has an opinion about. Rescheduling
    -- a time, editing a note or linking a customer are not analytics events.
    if new.status is not distinct from old.status then
      return null;
    end if;

    case new.status
      when 'confirmed' then
        v_event  := 'appointment_confirmed';
        -- NOT once-only: a customer reschedule returns a confirmed appointment
        -- to pending and the shop confirms it again. Each confirmation is real.
        v_dedupe := 'appointment:' || new.id::text || ':confirmed:'
                    || (extract(epoch from now()) * 1000000)::bigint::text;
        v_occurred := coalesce(new.decided_at, now());
      when 'cancelled' then
        v_event  := 'appointment_cancelled';
        v_dedupe := 'appointment:' || new.id::text || ':cancelled';
        v_occurred := coalesce(new.decided_at, now());
      when 'no_show' then
        v_event  := 'appointment_no_show';
        v_dedupe := 'appointment:' || new.id::text || ':no_show';
        v_occurred := coalesce(new.decided_at, now());
      when 'completed' then
        v_event  := 'appointment_completed';
        v_dedupe := 'appointment:' || new.id::text || ':completed';
        -- completed_at is stamped server-side by R1A's transition guard and is
        -- the only trustworthy answer to "when was this served".
        v_occurred := coalesce(new.completed_at, now());
      else
        -- pending, including the confirmed -> pending reschedule edge. There is
        -- no event for "went back to waiting for a decision"; inventing one
        -- would double-count the eventual confirmation.
        return null;
    end case;
  end if;

  select a.actor_user_id, a.actor_type
    into v_actor, v_actor_type
  from private.analytics_trigger_actor() a;

  select b.professional_id into v_professional_id
  from public.barbers b
  where b.id = new.barber_id;

  perform private.try_emit_analytics_event(
    p_event_name      => v_event,
    p_event_origin    => 'backend',
    p_actor_user_id   => v_actor,
    p_actor_type      => v_actor_type,
    p_organization_id => new.organization_id,
    p_location_id     => new.location_id,
    p_barber_id       => new.barber_id,
    p_professional_id => v_professional_id,
    p_customer_id     => new.customer_id,
    p_appointment_id  => new.id,
    -- Deliberately NOT carried: customer name, phone, email, notes, or the
    -- appointment's scheduled time. §12 forbids future appointment details in
    -- analytics, and the ids above are enough to join under platform
    -- authorization when a report legitimately needs more.
    p_properties      => jsonb_build_object(
                           'service_id', new.service_id,
                           'has_assigned_barber', new.barber_id is not null),
    p_occurred_at     => v_occurred,
    p_dedupe_key      => v_dedupe
  );

  return null;
end;
$$;

comment on function public.analytics_appointment_event() is
  'Emits the authoritative appointment lifecycle: created on INSERT, and confirmed/cancelled/no_show/completed from real status transitions. Records both barber_id (operational placement) and professional_id (durable identity) so that "services delivered by this person" survives them changing shop. Carries no customer name, contact detail, note or scheduled time — §12. Once-only transitions use permanent dedupe keys; confirmation uses a transition-scoped one because a reschedule legitimately produces a second confirmation.';

drop trigger if exists appointments_analytics_insert on public.appointments;
create trigger appointments_analytics_insert
  after insert on public.appointments
  for each row execute function public.analytics_appointment_event();

drop trigger if exists appointments_analytics_update on public.appointments;
create trigger appointments_analytics_update
  after update of status on public.appointments
  for each row execute function public.analytics_appointment_event();

-- ---------------------------------------------------------------------------
-- 6. QUEUE — the walk-in lifecycle
--
-- Every timestamp read here is server-stamped by R1A's
-- enforce_queue_transition, which OVERWRITES whatever the browser sent. Before
-- R1A the queue timestamps were written by apps/web and a single UPDATE could
-- claim a service completed before it started, ten days in the past. Building
-- analytics on those columns is only defensible because that is now fixed.
--
-- §16: nothing here invents wait time, position or service state. Position is
-- derived, not stored, and this file does not compute it.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_queue_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_type public.analytics_actor_type;
  v_professional_id uuid;
  v_event text;
  v_suffix text;
  v_occurred timestamptz;
begin
  if tg_op = 'INSERT' then
    v_event    := 'queue_joined';
    v_suffix   := 'joined';
    v_occurred := new.created_at;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;

    case new.status
      when 'called' then
        v_event := 'queue_called';       v_suffix := 'called';
        v_occurred := coalesce(new.called_at, now());
      when 'in_service' then
        v_event := 'queue_service_started'; v_suffix := 'service_started';
        v_occurred := coalesce(new.service_started_at, now());
      when 'completed' then
        v_event := 'queue_completed';    v_suffix := 'completed';
        v_occurred := coalesce(new.completed_at, now());
      when 'cancelled' then
        v_event := 'queue_cancelled';    v_suffix := 'cancelled';
        v_occurred := now();
      when 'no_show' then
        v_event := 'queue_no_show';      v_suffix := 'no_show';
        v_occurred := now();
      else
        return null;
    end case;
  end if;

  select a.actor_user_id, a.actor_type
    into v_actor, v_actor_type
  from private.analytics_trigger_actor() a;

  select b.professional_id into v_professional_id
  from public.barbers b
  where b.id = new.barber_id;

  perform private.try_emit_analytics_event(
    p_event_name      => v_event,
    p_event_origin    => 'backend',
    p_actor_user_id   => v_actor,
    p_actor_type      => v_actor_type,
    p_organization_id => new.organization_id,
    p_location_id     => new.location_id,
    p_barber_id       => new.barber_id,
    p_professional_id => v_professional_id,
    p_customer_id     => new.customer_id,
    p_queue_entry_id  => new.id,
    -- barber_id NULL is a real product state — "any available barber" — and
    -- not a missing value, so it is recorded as a fact rather than left to be
    -- inferred from a NULL.
    p_properties      => jsonb_build_object(
                           'service_id', new.service_id,
                           'requested_specific_barber', new.barber_id is not null),
    p_occurred_at     => v_occurred,
    -- Every queue transition is once-only: the R1A guard forbids going
    -- backwards and forbids leaving a terminal state, for every caller.
    p_dedupe_key      => 'queue_entry:' || new.id::text || ':' || v_suffix
  );

  return null;
end;
$$;

comment on function public.analytics_queue_event() is
  'Emits the authoritative walk-in queue lifecycle from queue_entries: joined on INSERT, then called / service_started / completed / cancelled / no_show from real status transitions. Every timestamp it reads is server-stamped by R1A''s enforce_queue_transition, which discards client-supplied values — analytics on these columns would be worthless without that guard. Invents no wait time, position or service state (§16).';

drop trigger if exists queue_entries_analytics_insert on public.queue_entries;
create trigger queue_entries_analytics_insert
  after insert on public.queue_entries
  for each row execute function public.analytics_queue_event();

drop trigger if exists queue_entries_analytics_update on public.queue_entries;
create trigger queue_entries_analytics_update
  after update of status on public.queue_entries
  for each row execute function public.analytics_queue_event();

-- ---------------------------------------------------------------------------
-- 7. PASSPORT
--
-- Two events, and note what is NOT here: nothing reads the Passport's
-- CONTENTS. §17 forbids exposing private Passport history through analytics,
-- so the events record that a passport exists and that a relationship formed —
-- never a haircut, a fade type or a preference note.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_passport_issued_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.try_emit_analytics_event(
    p_event_name    => 'passport_issued',
    p_event_origin  => 'backend',
    p_actor_user_id => new.user_id,
    p_passport_id   => new.id,
    p_occurred_at   => new.created_at,
    p_dedupe_key    => 'passport:' || new.id::text || ':issued'
  );
  return null;
end;
$$;

comment on function public.analytics_passport_issued_event() is
  'Emits passport_issued when a Fade Passport comes into existence. Records that a passport exists and nothing about what is in it — §17 forbids exposing private Passport history through analytics, and no property here reads a preference column. No organization: the Passport is customer-owned and portable, so attributing issuance to a shop would be false.';

drop trigger if exists customer_passports_analytics on public.customer_passports;
create trigger customer_passports_analytics
  after insert on public.customer_passports
  for each row execute function public.analytics_passport_issued_event();

create or replace function public.analytics_relationship_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.try_emit_analytics_event(
    p_event_name      => 'passport_relationship_created',
    p_event_origin    => 'backend',
    p_actor_user_id   => new.customer_user_id,
    p_organization_id => new.organization_id,
    p_professional_id => new.professional_id,
    p_occurred_at     => new.first_completed_at,
    p_dedupe_key      => 'relationship:' || new.id::text || ':created'
  );
  return null;
end;
$$;

comment on function public.analytics_relationship_created_event() is
  'Emits passport_relationship_created when a durable customer-professional relationship first forms from a completed service. The retention funnel''s anchor: this is the moment a first-time customer becomes someone with a history.';

drop trigger if exists customer_professional_relationships_analytics
  on public.customer_professional_relationships;
create trigger customer_professional_relationships_analytics
  after insert on public.customer_professional_relationships
  for each row execute function public.analytics_relationship_created_event();

-- ---------------------------------------------------------------------------
-- 8. ACQUISITION — external profile publication
--
-- Hooked on prospect_professionals, NOT on professionals.
--
-- That is the whole §9 requirement in one decision. prospect_professionals is
-- the UNIFIED LINKAGE between a canonical prospect and a durable professional
-- identity, and it is unique per prospect. Hooking `professionals` instead
-- would have fired before the linkage row existed, leaving the event with no
-- prospect to attribute to — and it would have counted an identity created by
-- any other path as an acquisition.
--
-- Because the linkage is one row per prospect and the event is keyed on the
-- professional, the same real person discovered through four different sources
-- produces four source records, ONE prospect, ONE linkage and therefore
-- exactly ONE external_profile_created. Multi-source discovery can never
-- inflate the conversion count.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_external_profile_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_source_record_id uuid;
begin
  -- The FIRST source that observed this prospect, as the attribution anchor.
  -- Deliberately first-touch rather than last: the question acquisition asks
  -- is which channel found a business nobody had, and a later re-observation
  -- by a second source did not find anything.
  select ps.key, psr.id
    into v_source, v_source_record_id
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.prospect_id
  order by psr.created_at
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'external_profile_created',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_professional_id              => new.professional_id,
    p_prospect_id                  => new.prospect_id,
    p_acquisition_source           => v_source,
    p_acquisition_source_record_id => v_source_record_id,
    p_properties                   => jsonb_build_object(
                                        'matching_rule', new.matching_rule),
    p_occurred_at                  => new.created_at,
    p_dedupe_key                   => 'external_profile:' || new.professional_id::text || ':created'
  );

  return null;
end;
$$;

comment on function public.analytics_external_profile_event() is
  'Emits external_profile_created from prospect_professionals — the unified prospect-to-identity linkage — rather than from professionals. This is what makes §9 hold: one real professional discovered through several sources yields several source records, ONE prospect, ONE linkage and therefore exactly ONE conversion, so multi-source discovery can never inflate the count. Attribution is FIRST-touch, because the question is which channel found a business nobody had.';

drop trigger if exists prospect_professionals_analytics on public.prospect_professionals;
create trigger prospect_professionals_analytics
  after insert on public.prospect_professionals
  for each row execute function public.analytics_external_profile_event();

-- ---------------------------------------------------------------------------
-- 9. CLAIM — submission and decision
--
-- claim_started is deliberately absent: there is no "started" state in
-- professional_claims to hook, and inventing one from a page view would be
-- exactly the fabrication §4 forbids. It stays documented and deferred.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_claim_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_suffix text;
  v_occurred timestamptz;
  v_prospect_id uuid;
  v_source text;
begin
  if tg_op = 'INSERT' then
    v_event := 'claim_submitted'; v_suffix := 'submitted';
    v_occurred := new.submitted_at;
  else
    -- The column is `state`, not `status`: professional_claims deliberately
    -- names it that way because claim state is never subscription state
    -- (Constitution §5.6).
    if new.state is not distinct from old.state then
      return null;
    end if;

    case new.state
      when 'approved' then
        v_event := 'claim_approved'; v_suffix := 'approved';
        v_occurred := coalesce(new.decided_at, now());
      when 'rejected' then
        v_event := 'claim_rejected'; v_suffix := 'rejected';
        v_occurred := coalesce(new.decided_at, now());
      else
        -- withdrawn: the customer changed their mind. Not in the §4 taxonomy
        -- and not invented here.
        return null;
    end case;
  end if;

  -- Close the acquisition loop where one exists. A claim over an identity that
  -- FadeUp itself minted from a prospect is the conversion the whole worker
  -- pipeline exists to produce; a claim over an organically created identity
  -- simply has no prospect, and records none rather than a fabricated one.
  select pp.prospect_id, ps.key
    into v_prospect_id, v_source
  from public.prospect_professionals pp
  left join lateral (
    select psr.source_id
    from public.prospect_source_records psr
    where psr.prospect_id = pp.prospect_id
    order by psr.created_at
    limit 1
  ) first_record on true
  left join public.prospect_sources ps on ps.id = first_record.source_id
  where pp.professional_id = new.professional_id;

  perform private.try_emit_analytics_event(
    p_event_name         => v_event,
    p_event_origin       => 'backend',
    p_actor_user_id      => case when tg_op = 'INSERT' then new.claimant_user_id else new.decided_by end,
    p_actor_type         => case
                              when tg_op = 'INSERT' then null
                              when new.decided_by is null then 'system'::public.analytics_actor_type
                              else null
                            end,
    p_professional_id    => new.professional_id,
    p_prospect_id        => v_prospect_id,
    p_acquisition_source => v_source,
    -- The claimant is recorded as the actor on submission; the evidence text
    -- and the reviewer's decision note are NEVER carried — both are free text
    -- and the note is explicitly platform-private (R1A §2).
    p_properties         => jsonb_build_object('claim_id', new.id),
    p_occurred_at        => v_occurred,
    p_dedupe_key         => 'claim:' || new.id::text || ':' || v_suffix
  );

  return null;
end;
$$;

comment on function public.analytics_claim_event() is
  'Emits claim_submitted on INSERT and claim_approved / claim_rejected from real professional_claims decisions. Resolves the originating prospect through prospect_professionals so an approved claim closes the acquisition funnel end to end; a claim over an organically created identity records no prospect rather than a fabricated one. Carries neither the applicant''s evidence text nor the reviewer''s private decision note.';

drop trigger if exists professional_claims_analytics_insert on public.professional_claims;
create trigger professional_claims_analytics_insert
  after insert on public.professional_claims
  for each row execute function public.analytics_claim_event();

drop trigger if exists professional_claims_analytics_update on public.professional_claims;
create trigger professional_claims_analytics_update
  after update of state on public.professional_claims
  for each row execute function public.analytics_claim_event();

-- ---------------------------------------------------------------------------
-- 10. COMMERCIAL — plan assignment and movement
--
-- commercial_plan_changes is already an authoritative, append-only, trigger-
-- protected history. This adds an analytics view of it rather than a second
-- source of truth: previous_plan_key IS NULL is precisely "first assignment",
-- which the table's own comment documents.
--
-- NOTE ON THE SNAPSHOT: the emitter freezes the plan in force at this instant,
-- which for a plan change is the NEW plan. The properties carry both keys
-- explicitly, so a report never has to guess which side of the change the
-- snapshot represents.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_plan_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_first boolean := new.previous_plan_key is null;
begin
  perform private.try_emit_analytics_event(
    p_event_name      => case when v_is_first then 'plan_assigned' else 'plan_changed' end,
    p_event_origin    => 'backend',
    p_actor_user_id   => new.changed_by,
    p_actor_type      => case when new.changed_by is null
                           then 'system'::public.analytics_actor_type
                           else null end,
    p_organization_id => new.organization_id,
    p_properties      => jsonb_build_object(
                           'previous_plan_key', new.previous_plan_key,
                           'new_plan_key', new.new_plan_key,
                           'previous_status', new.previous_status,
                           'new_status', new.new_status,
                           'entitlement_source', new.entitlement_source
                         ),
    p_occurred_at     => new.created_at,
    p_dedupe_key      => 'plan_change:' || new.id::text
  );
  return null;
end;
$$;

comment on function public.analytics_plan_change_event() is
  'Emits plan_assigned (previous_plan_key IS NULL — an organization receiving its first plan) or plan_changed, from the already-authoritative commercial_plan_changes history. Both plan keys travel in properties so a report never has to guess which side of the transition the frozen commercial snapshot represents. change_reason is deliberately not carried: it is free text.';

drop trigger if exists commercial_plan_changes_analytics on public.commercial_plan_changes;
create trigger commercial_plan_changes_analytics
  after insert on public.commercial_plan_changes
  for each row execute function public.analytics_plan_change_event();

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT INSTRUMENTED HERE, AND WHY
--
--   entitlement_blocked_action — the guards refuse by RAISING from a BEFORE
--     INSERT trigger, which aborts the subtransaction and would discard any
--     event written inside it. Recording a refusal needs an emission path that
--     survives the abort. Deferred with the reason written down, not forgotten.
--
--   prospect_discovered / prospect_enriched — Worker V2 is R4/R10 and §25
--     forbids starting it. No trigger is attached to prospects or
--     prospect_events by this migration.
--
--   passport_viewed / claim_started — no authoritative source exists. §4:
--     do not fake events for flows that do not exist yet.
--
--   Every DISCOVERY and BOOKING-INTENT event — those are genuinely client
--   surface facts and are emitted through public.track_analytics_event by the
--   web adapter. Nothing in this file emits them, and the emission wall in the
--   ingestion layer makes it impossible for this file to do so by accident.
-- ---------------------------------------------------------------------------
