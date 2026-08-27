-- FadeUp — R3: controlled ingestion
--
-- There are exactly TWO ways a row reaches public.analytics_events, and no
-- third:
--
--   SERVER   private.emit_analytics_event, called from an authoritative state
--            transition (a trigger or an RPC that already owns the fact).
--            Origin backend/worker/system. This is evidence.
--
--   CLIENT   public.track_analytics_event, the single RPC a browser may call.
--            Origin public_web/customer_web/customer_mobile/pro_web. This is
--            intent, and the emission column on the registry makes it
--            impossible for a browser to write a server event (§5).
--
-- WHAT MAKES IMPERSONATION IMPOSSIBLE RATHER THAN MERELY DISCOURAGED
--
--   public.track_analytics_event HAS NO ACTOR PARAMETER. Not an ignored one,
--   not a validated one — the argument does not exist. The actor is derived
--   inside the function from auth.uid(). A client cannot pass an actor it is
--   not, because there is nowhere to put it. This is the §11 requirement
--   ("no client-provided arbitrary actor_user_id") expressed in the signature
--   rather than in a check that a later edit could relax.
--
-- WHY THE SERVER PATH MUST NEVER RAISE
--
--   §14 and §22: an analytics failure must not break a Follow, a booking or a
--   completion. private.emit_analytics_event is strict and DOES raise — that is
--   what makes it testable. Triggers therefore call
--   private.try_emit_analytics_event, which wraps it in an exception block, and
--   records the failure to analytics_ingestion_rejections instead of
--   propagating it.
--
--   The plpgsql exception block opens a subtransaction, so a failed emission
--   rolls back only itself; the surrounding booking or follow commits
--   untouched. That is the entire safety property, and db/tests exercises it
--   by deliberately breaking emission and asserting the business action still
--   succeeds.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.analytics_actor_type_for — who is acting
--
-- Derived from real state, never asserted by the caller. The order matters:
-- platform staff first (they are the narrowest set), then organization staff,
-- then a claimed professional identity, and only then customer — which is the
-- default because it is the only category that requires no relationship to
-- anything.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_actor_type_for(p_user_id uuid)
returns public.analytics_actor_type
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when p_user_id is null then 'anonymous'::public.analytics_actor_type
    when exists (
      select 1 from public.platform_members pm
      where pm.user_id = p_user_id
        and pm.role in ('platform_owner', 'platform_admin')
    ) then 'platform_admin'::public.analytics_actor_type
    when exists (
      select 1 from public.memberships m where m.user_id = p_user_id
    ) then 'staff'::public.analytics_actor_type
    when exists (
      select 1 from public.professionals p where p.user_id = p_user_id
    ) then 'professional'::public.analytics_actor_type
    else 'customer'::public.analytics_actor_type
  end;
$$;

comment on function private.analytics_actor_type_for(uuid) is
  'Classifies an acting account from actual state — platform membership, organization membership, claimed professional identity — falling back to customer. Never accepts a caller''s claim about who they are. SECURITY DEFINER because it reads tables the client roles cannot; performs no authorization of its own and is not an entry point.';

revoke all on function private.analytics_actor_type_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.analytics_commercial_snapshot — the terms in force RIGHT NOW
--
-- §8. Returns the plan the organization is actually on at this instant, so the
-- emitter can freeze it onto the row. Composes R2's private.effective_plan_key
-- rather than reimplementing any commercial logic — the canceled-degrades-to-
-- free and past_due-keeps-plan semantics stay in exactly one place.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_commercial_snapshot(
  p_organization_id uuid,
  out plan_key text,
  out commercial_family public.commercial_family
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.plan_key,
    p.commercial_family
  from public.commercial_plans p
  where p_organization_id is not null
    and p.plan_key = private.effective_plan_key(p_organization_id);
$$;

comment on function private.analytics_commercial_snapshot(uuid) is
  'The plan_key and commercial_family in force for an organization at this instant, for freezing onto an analytics event. Composes R2''s private.effective_plan_key so canceled/past_due semantics are resolved in exactly one place. Returns NULLs for an organization with no commercial state, which is recorded honestly rather than defaulted to ''free''.';

revoke all on function private.analytics_commercial_snapshot(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.assert_analytics_properties_safe — the privacy gate (§12)
--
-- Two rules, both enforced rather than documented:
--
--   a. A FORBIDDEN KEY IS REFUSED. The list is the §12 list, matched on the
--      key name as a substring so `customer_email`, `email` and
--      `contact_email_address` are all caught by one entry. Substring matching
--      produces occasional false positives; on a privacy gate that is the
--      correct direction to be wrong, and the alternative — an exact-match
--      list — is defeated by the first person who writes `userEmail`.
--
--   b. NO NESTED OBJECTS. An object value is where a whole customer record
--      gets pasted in "temporarily". Scalars and arrays of scalars keep
--      properties queryable and keep the blast radius of a mistake to one
--      value.
--
-- A raw email address is additionally matched by shape, because the realistic
-- accident is not a key called `email` — it is a key called `identifier` with
-- an address in it.
-- ---------------------------------------------------------------------------

create or replace function private.assert_analytics_properties_safe(p_properties jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_forbidden text[] := array[
    'email', 'phone', 'mobile', 'password', 'token', 'secret', 'credential',
    'authorization', 'note', 'message', 'body', 'address', 'postcode',
    'postal', 'latitude', 'longitude', 'lat_', 'lng', 'coordinate', 'geo_point',
    'ip_', 'user_agent', 'fingerprint', 'birth', 'ssn', 'tax_id'
  ];
  v_bad text;
begin
  if p_properties is null then
    return;
  end if;

  if jsonb_typeof(p_properties) <> 'object' then
    raise exception 'analytics properties must be a JSON object'
      using errcode = '22023';
  end if;

  for v_key, v_value in select * from jsonb_each(p_properties) loop
    select f into v_bad
    from unnest(v_forbidden) as f
    where lower(v_key) like '%' || f || '%'
    limit 1;

    if v_bad is not null then
      raise exception 'analytics properties may not contain personal data: key % matches forbidden term %', v_key, v_bad
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_value) = 'object' then
      raise exception 'analytics properties may not contain nested objects: key %', v_key
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_value) = 'string'
       and (v_value #>> '{}') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' then
      raise exception 'analytics properties may not contain an email address: key %', v_key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

comment on function private.assert_analytics_properties_safe(jsonb) is
  'The §12 privacy gate on the analytics properties payload. Refuses forbidden key names by substring match, refuses nested objects, and refuses any string value shaped like an email address — because the realistic accident is not a key called ''email'', it is a key called ''identifier'' with an address in it. Substring matching over-refuses slightly, which on a privacy gate is the correct direction to be wrong.';

revoke all on function private.assert_analytics_properties_safe(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.emit_analytics_event — THE writer
--
-- Strict by design. Every rejection below is a bug in a caller, and a bug in a
-- caller must be loud somewhere: this function raises, and the non-fatal
-- wrapper in §5 decides whether the noise reaches the user (never) or the
-- diagnostics table (always).
--
-- Returns the new event id, or NULL when the dedupe key absorbed a duplicate.
-- The distinction matters to tests: "no row was written" and "a duplicate was
-- correctly suppressed" are different outcomes and are reported differently.
-- ---------------------------------------------------------------------------

create or replace function private.emit_analytics_event(
  p_event_name text,
  p_event_origin public.analytics_event_origin,
  p_actor_user_id uuid default null,
  p_actor_type public.analytics_actor_type default null,
  p_organization_id uuid default null,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_professional_id uuid default null,
  p_customer_id uuid default null,
  p_appointment_id uuid default null,
  p_queue_entry_id uuid default null,
  p_passport_id uuid default null,
  p_prospect_id uuid default null,
  p_acquisition_source text default null,
  p_acquisition_source_record_id uuid default null,
  p_properties jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_dedupe_key text default null,
  p_session_id text default null,
  p_locale text default null,
  p_country_code text default null,
  p_platform text default null,
  p_correlation_id uuid default null,
  p_causation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def public.analytics_event_definitions%rowtype;
  v_actor_type public.analytics_actor_type;
  v_plan_key text;
  v_family public.commercial_family;
  v_occurred_at timestamptz;
  v_id uuid;
begin
  -- 4.1 The allowlist. An unknown name is a typo, and a typo that silently
  -- inserted would create a new category nobody queries — the quietest and
  -- most expensive kind of analytics bug.
  select * into v_def
  from public.analytics_event_definitions d
  where d.event_name = p_event_name;

  if not found then
    raise exception 'unknown analytics event: %', p_event_name
      using errcode = '22023';
  end if;

  if v_def.status <> 'wired' then
    raise exception 'analytics event % is documented but not wired', p_event_name
      using errcode = '22023';
  end if;

  -- 4.2 Emission class must match the origin. This is the wall between intent
  -- and evidence (§5): a browser origin can never carry a server event, and a
  -- backend origin can never carry a client one. Enforced here rather than in
  -- the client RPC alone, so that a future internal caller cannot smuggle a
  -- client event in as authoritative either.
  if v_def.emission = 'server'
     and p_event_origin not in ('backend', 'worker', 'system') then
    raise exception 'analytics event % is server-authoritative and cannot be emitted from origin %',
      p_event_name, p_event_origin
      using errcode = '42501';
  end if;

  if v_def.emission = 'client'
     and p_event_origin not in ('public_web', 'customer_web', 'customer_mobile', 'pro_web') then
    raise exception 'analytics event % is client intent and cannot be emitted from origin %',
      p_event_name, p_event_origin
      using errcode = '42501';
  end if;

  -- 4.3 An event that is meaningless without a tenant never gets recorded
  -- without one. Otherwise it vanishes from every per-organization report
  -- while still inflating the platform totals.
  if v_def.requires_organization and p_organization_id is null then
    raise exception 'analytics event % requires an organization', p_event_name
      using errcode = '22023';
  end if;

  -- 4.4 An idempotent event without a dedupe key is not idempotent. The
  -- registry says this event happens once; a caller that forgets the key would
  -- make that a lie on the first retry.
  if v_def.is_idempotent and p_dedupe_key is null then
    raise exception 'analytics event % is declared idempotent and requires a dedupe key', p_event_name
      using errcode = '22023';
  end if;

  perform private.assert_analytics_properties_safe(p_properties);

  -- 4.5 Actor. A caller may state the actor type only when it genuinely knows
  -- better than the derivation — a worker or a system job, which has no
  -- account at all. Everything else is derived.
  v_actor_type := coalesce(
    p_actor_type,
    private.analytics_actor_type_for(p_actor_user_id)
  );

  -- 4.6 THE COMMERCIAL SNAPSHOT (§8). Resolved now, frozen forever. A report
  -- run next year must still see the terms that were in force at the moment
  -- the service was delivered, not the terms the shop happens to be on when
  -- the report runs.
  if p_organization_id is not null then
    select s.plan_key, s.commercial_family
      into v_plan_key, v_family
    from private.analytics_commercial_snapshot(p_organization_id) s;
  end if;

  -- occurred_at defaults to the transaction timestamp, so every event emitted
  -- by one business transition shares an instant and they order deterministically.
  v_occurred_at := coalesce(p_occurred_at, now());

  -- A caller must not be able to date an event into the future; ingested_at
  -- would then violate the table's own coherence constraint, and every funnel
  -- timing built on it would be wrong.
  if v_occurred_at > now() then
    raise exception 'analytics event % cannot occur in the future', p_event_name
      using errcode = '22023';
  end if;

  insert into public.analytics_events (
    event_name, event_version,
    occurred_at, ingested_at,
    actor_type, actor_user_id, customer_id, professional_id,
    organization_id, location_id, barber_id,
    appointment_id, queue_entry_id, passport_id,
    prospect_id, acquisition_source, acquisition_source_record_id,
    event_origin, platform, session_id, locale, country_code,
    plan_key, commercial_family,
    properties, correlation_id, causation_id, dedupe_key
  )
  values (
    p_event_name, v_def.event_version,
    v_occurred_at, now(),
    v_actor_type, p_actor_user_id, p_customer_id, p_professional_id,
    p_organization_id, p_location_id, p_barber_id,
    p_appointment_id, p_queue_entry_id, p_passport_id,
    p_prospect_id, p_acquisition_source, p_acquisition_source_record_id,
    p_event_origin, p_platform, p_session_id, p_locale, p_country_code,
    v_plan_key, v_family,
    coalesce(p_properties, '{}'::jsonb), p_correlation_id, p_causation_id, p_dedupe_key
  )
  -- THE idempotency mechanism (§6). A duplicate is absorbed silently and
  -- returns NULL; it is not an error, because the whole point is that a retry
  -- is allowed to happen.
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, text, text, text, text, uuid, uuid) is
  'THE writer for public.analytics_events. Validates against the taxonomy allowlist, enforces the server/client emission wall, requires a tenant where the contract demands one, requires a dedupe key for idempotent events, applies the §12 privacy gate, derives the actor from real state and freezes the commercial snapshot at emit time. Raises on every violation — callers on a business path must use private.try_emit_analytics_event instead. Returns the new id, or NULL when a duplicate was correctly absorbed.';

revoke all on function private.emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. private.try_emit_analytics_event — the non-fatal wrapper
--
-- Everything on a business path calls THIS. §14: a broken analytics contract
-- must not stop a customer following a shop, and §22: it must not be silent
-- either.
--
-- The exception block is a subtransaction. A failure inside it rolls back the
-- attempted event insert and nothing else, so the surrounding follow, booking
-- or completion is entirely unaffected. The rejection row is written AFTER the
-- handler regains control, in the outer transaction, so it survives.
-- ---------------------------------------------------------------------------

create or replace function private.try_emit_analytics_event(
  p_event_name text,
  p_event_origin public.analytics_event_origin,
  p_actor_user_id uuid default null,
  p_actor_type public.analytics_actor_type default null,
  p_organization_id uuid default null,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_professional_id uuid default null,
  p_customer_id uuid default null,
  p_appointment_id uuid default null,
  p_queue_entry_id uuid default null,
  p_passport_id uuid default null,
  p_prospect_id uuid default null,
  p_acquisition_source text default null,
  p_acquisition_source_record_id uuid default null,
  p_properties jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_dedupe_key text default null,
  p_correlation_id uuid default null,
  p_causation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  begin
    v_id := private.emit_analytics_event(
      p_event_name                   => p_event_name,
      p_event_origin                 => p_event_origin,
      p_actor_user_id                => p_actor_user_id,
      p_actor_type                   => p_actor_type,
      p_organization_id              => p_organization_id,
      p_location_id                  => p_location_id,
      p_barber_id                    => p_barber_id,
      p_professional_id              => p_professional_id,
      p_customer_id                  => p_customer_id,
      p_appointment_id               => p_appointment_id,
      p_queue_entry_id               => p_queue_entry_id,
      p_passport_id                  => p_passport_id,
      p_prospect_id                  => p_prospect_id,
      p_acquisition_source           => p_acquisition_source,
      p_acquisition_source_record_id => p_acquisition_source_record_id,
      p_properties                   => p_properties,
      p_occurred_at                  => p_occurred_at,
      p_dedupe_key                   => p_dedupe_key,
      p_correlation_id               => p_correlation_id,
      p_causation_id                 => p_causation_id
    );
    return v_id;
  exception when others then
    -- Deliberately catching everything. The alternative is enumerating the
    -- error classes analytics may fail with, and being wrong about one of them
    -- on the day a booking fails because a report was misconfigured.
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin::text, left(sqlerrm, 500), 'server_emit');
    return null;
  end;
end;
$$;

comment on function private.try_emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, uuid, uuid) is
  'Non-fatal emission, and the ONLY form any business path may call. Wraps private.emit_analytics_event in a subtransaction so a failed event rolls back itself and nothing else — the surrounding follow, booking or completion always commits. Failures are recorded to analytics_ingestion_rejections rather than propagated, satisfying §14 (analytics never breaks the product) and §22 (analytics never fails silently) at the same time.';

revoke all on function private.try_emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.track_analytics_event — the ONE client entry point
--
-- NOTE THE ARGUMENT LIST. There is no actor, no plan, no occurred_at, no
-- dedupe key and no country. Every one of those is either derived server-side
-- or deliberately not accepted:
--
--   actor        — derived from auth.uid(). See the file header.
--   occurred_at  — now(). A client-supplied timestamp is a client-supplied
--                  history, and it would let one caller reorder a funnel.
--   dedupe_key   — client events are never deduplicated (§6). Repeated views
--                  and searches are real and must stay distinct.
--   plan / family— snapshotted from authoritative commercial state.
--   country_code — not accepted from the browser. A client-asserted country is
--                  a claim, not a fact, and the honest answer today is NULL.
--                  When an edge layer supplies a verified country, it becomes
--                  a server-side derivation and not a new parameter here.
--
-- CONTEXT VALIDATION (§11). The organization must be one that is genuinely
-- PUBLIC — the same get_public_organization gate follow_organization uses —
-- and any location or barber must actually belong to it. This closes the
-- incoherent-context hole (events pointing at a private tenant, or at a barber
-- from a different shop) without pretending to solve view inflation, which is
-- a rate-limiting problem §13 explicitly declines to over-engineer in R3.
-- ---------------------------------------------------------------------------

create or replace function public.track_analytics_event(
  p_event_name text,
  p_event_origin text,
  p_organization_id uuid default null,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_professional_id uuid default null,
  p_properties jsonb default '{}'::jsonb,
  p_session_id text default null,
  p_locale text default null,
  p_correlation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_origin public.analytics_event_origin;
  v_slug text;
  v_reason text;
  v_professional_id uuid;
begin
  v_user_id := auth.uid();

  -- 6.1 Origin. Parsed rather than cast blindly, so an unknown string is a
  -- clean refusal instead of an invalid_text_representation error that tells
  -- the caller nothing.
  if p_event_origin is null
     or p_event_origin not in ('public_web', 'customer_web', 'customer_mobile', 'pro_web') then
    v_reason := 'origin not permitted for a client caller';
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin, v_reason, 'client_rpc');
    raise exception 'analytics origin % is not permitted for a client', coalesce(p_event_origin, '(null)')
      using errcode = '42501';
  end if;

  v_origin := p_event_origin::public.analytics_event_origin;

  -- 6.2 A signed-out caller cannot claim a signed-in surface. customer_web and
  -- pro_web describe authenticated experiences; allowing anon to assert them
  -- would make "logged-in engagement" uncountable.
  if v_user_id is null and v_origin in ('customer_web', 'pro_web') then
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin, 'anonymous caller claimed an authenticated origin', 'client_rpc');
    raise exception 'authentication required for origin %', p_event_origin
      using errcode = '42501';
  end if;

  -- 6.3 Tenant context must be real and public. An arbitrary organization_id
  -- from a browser is exactly what CLAUDE.md says never to trust.
  if p_organization_id is not null then
    select o.slug::text into v_slug
    from public.organizations o
    where o.id = p_organization_id;

    if v_slug is null then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'unknown organization', 'client_rpc');
      raise exception 'organization unavailable' using errcode = '42501';
    end if;

    perform 1 from public.get_public_organization(v_slug) limit 1;

    if not found then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'organization is not public', 'client_rpc');
      raise exception 'organization unavailable' using errcode = '42501';
    end if;
  end if;

  -- 6.4 Location and barber must belong to the organization that was claimed.
  -- Without this a caller could attribute a view of shop A to shop B's
  -- location, which corrupts both tenants' reports at once.
  if p_location_id is not null then
    if p_organization_id is null or not exists (
      select 1 from public.locations l
      where l.id = p_location_id and l.organization_id = p_organization_id
    ) then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'location does not belong to the claimed organization', 'client_rpc');
      raise exception 'analytics context is not coherent' using errcode = '42501';
    end if;
  end if;

  if p_barber_id is not null then
    if p_organization_id is null or not exists (
      select 1 from public.barbers b
      where b.id = p_barber_id and b.organization_id = p_organization_id
    ) then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'barber does not belong to the claimed organization', 'client_rpc');
      raise exception 'analytics context is not coherent' using errcode = '42501';
    end if;
  end if;

  -- 6.5 DERIVE the durable professional identity from the placement when the
  -- caller could not supply it.
  --
  -- A public professional profile page is routed by barber_id and the frozen
  -- customer API deliberately does not expose professional_id — a placement is
  -- what the booking surface needs. Widening that contract so the browser
  -- could send an identity it has no other use for would be the wrong fix; the
  -- server already knows the mapping and is the only party that should be
  -- trusted with it. Without this, every professional profile view would land
  -- with a NULL professional_id and get_professional_analytics_summary would
  -- report zero views forever.
  if p_professional_id is null and p_barber_id is not null then
    select b.professional_id into v_professional_id
    from public.barbers b
    where b.id = p_barber_id;
  else
    v_professional_id := p_professional_id;
  end if;

  -- A professional may only be named if their profile is genuinely public.
  -- get_public_professional is R1B's own projection, so this cannot drift from
  -- what the marketplace actually exposes. Applied only to an id the CALLER
  -- supplied: a server-derived one came from an already-validated placement,
  -- and refusing it would silently drop views of professionals whose personal
  -- profile is private but whose shop placement is public — a real and
  -- legitimate combination.
  if p_professional_id is not null then
    perform 1 from public.get_public_professional(p_professional_id) limit 1;

    if not found then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'professional is not publicly visible', 'client_rpc');
      raise exception 'professional unavailable' using errcode = '42501';
    end if;
  end if;

  -- 6.6 Emit. Note what is NOT forwarded: no dedupe key, no occurred_at, no
  -- actor type. The strict emitter is called directly rather than the
  -- forgiving wrapper, because a client that sends a malformed event should
  -- learn that it did — the web adapter swallows the error so the user never
  -- does (§19).
  begin
    perform private.emit_analytics_event(
      p_event_name      => p_event_name,
      p_event_origin    => v_origin,
      p_actor_user_id   => v_user_id,
      p_organization_id => p_organization_id,
      p_location_id     => p_location_id,
      p_barber_id       => p_barber_id,
      p_professional_id => v_professional_id,
      p_properties      => coalesce(p_properties, '{}'::jsonb),
      p_session_id      => p_session_id,
      p_locale          => p_locale,
      p_platform        => 'web',
      p_correlation_id  => p_correlation_id
    );
  exception when others then
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin, left(sqlerrm, 500), 'client_rpc');
    raise;
  end;
end;
$$;

comment on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid) is
  'The ONLY path by which a browser writes analytics. Deliberately has no actor parameter: the acting account is derived from auth.uid(), so impersonation is impossible by signature rather than by check. Refuses server-authoritative event names outright, refuses authenticated origins from signed-out callers, and refuses incoherent context — an organization that is not public, or a location/barber belonging to a different tenant. Accepts no timestamp, no dedupe key and no commercial context; all three are server-derived.';

revoke execute on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid)
  from public;

-- anon is granted deliberately: discovery, search and public profile views
-- happen while signed out, and an analytics contract that only sees
-- authenticated traffic would report a funnel that starts in the middle.
grant execute on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid)
  to anon, authenticated;
