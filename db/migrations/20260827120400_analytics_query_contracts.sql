-- FadeUp — R3: the analytics read layer
--
-- §18: product surfaces must NOT query public.analytics_events directly, and
-- the foundation migration makes that structurally true — anon and
-- authenticated hold no privilege on the table at all, so there is no raw read
-- to forbid.
--
-- This file supplies what replaces it: a small set of SECURITY DEFINER
-- aggregation contracts, each of which authorizes its own caller before
-- reading anything.
--
-- WHAT THESE ARE AND ARE NOT
--
--   They are PRIMITIVES. §18 is explicit that R3 does not build the FadeUp Pro
--   BI dashboard, and nothing here renders, paginates, charts or exports. Each
--   function answers one bounded question over one bounded window and returns
--   counts.
--
--   They return ONLY AGGREGATES. Never a row, never an actor id, never a
--   session id, never a customer name. That is not a stylistic preference: a
--   contract that returned event rows would hand a shop owner the identities
--   of everyone who looked at their profile, which §12 forbids outright. A
--   count of unique viewers is the strongest thing that can be safely exposed,
--   and it is what these return.
--
-- WHY EVERY FUNCTION TAKES AN EXPLICIT WINDOW
--
--   An unbounded aggregate over an append-only event log is a table scan whose
--   cost grows forever. Requiring [from, to) means every one of these is an
--   index range scan on (organization_id, event_name, occurred_at) from the
--   day it ships, and it makes the expensive query unwriteable rather than
--   merely discouraged. The window is also capped, for the same reason.
--
-- WHY NOTHING HERE RUNS AT INGESTION (§21)
--
--   Not one of these functions is called by a trigger, by the emitter or by
--   any business path. Aggregation happens when somebody asks a question, on
--   their own connection, never inside a booking transaction.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.analytics_window — one place that decides what a legal window is
--
-- Defaulting and capping in every function separately is how three of them end
-- up with different maxima and the fourth ends up with none.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_window(
  p_from timestamptz,
  p_to timestamptz,
  out window_from timestamptz,
  out window_to timestamptz
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  window_to   := coalesce(p_to, now());
  window_from := coalesce(p_from, window_to - interval '30 days');

  if window_from >= window_to then
    raise exception 'analytics window start must precede its end'
      using errcode = '22023';
  end if;

  -- Two years. Long enough for any year-over-year question a shop actually
  -- asks, short enough that no single call can scan the whole log.
  if window_to - window_from > interval '730 days' then
    raise exception 'analytics window may not exceed 730 days'
      using errcode = '22023';
  end if;
end;
$$;

comment on function private.analytics_window(timestamptz, timestamptz) is
  'Normalises and CAPS an analytics query window in one place, so every read contract shares the same defaults and the same 730-day maximum. The cap is what keeps an unbounded scan of an append-only log unwriteable rather than merely discouraged.';

revoke all on function private.analytics_window(timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.get_organization_analytics_summary
--
-- The tenant's own numbers, and the §18 primitive list in one row.
--
-- AUTHORIZATION: owner or manager only. Deliberately NOT every member — a
-- barber and a receptionist have no business reading the shop's conversion
-- rates, and `is_org_member` would have granted exactly that. Platform admins
-- are admitted separately because support genuinely needs it.
--
-- Conversion rates are computed here rather than left to the caller, because
-- two callers dividing by different denominators is how the same shop gets two
-- different numbers. booking_conversion_rate is completions over CREATED
-- appointments, not over booking_started: intent is a client event and §5
-- forbids resting a conversion metric on one.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_analytics_summary(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,

  profile_views bigint,
  unique_authenticated_viewers bigint,
  distinct_anonymous_sessions bigint,

  booking_starts bigint,
  appointments_created bigint,
  appointments_confirmed bigint,
  appointments_completed bigint,
  appointments_cancelled bigint,
  appointments_no_show bigint,

  queue_views bigint,
  queue_joins bigint,
  queue_completions bigint,
  queue_cancellations bigint,

  follows bigint,
  unfollows bigint,
  favorites bigint,
  unfavorites bigint,

  unique_customers bigint,
  repeat_customers bigint,

  booking_conversion_rate numeric,
  queue_conversion_rate numeric
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
  if p_organization_id is null then
    raise exception 'organization required' using errcode = '22023';
  end if;

  -- Authorization FIRST, before the window is even parsed. A caller who is not
  -- entitled to these numbers must not be able to distinguish "not allowed"
  -- from "bad window", and must certainly not learn anything by timing.
  if not (
    (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read analytics for this organization'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.organization_id = p_organization_id
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
  ),
  -- A "repeat customer" is an ACCOUNT with more than one delivered service in
  -- the window, counting both channels: a customer who books once and walks in
  -- once is a returning customer, and treating appointments and the queue as
  -- separate worlds would report them as two different one-time visitors.
  completions_by_actor as (
    select s.actor_user_id, count(*) as n
    from scoped s
    where s.event_name in ('appointment_completed', 'queue_completed')
      and s.actor_user_id is not null
    group by s.actor_user_id
  )
  select
    v_from,
    v_to,

    count(*) filter (where s.event_name = 'public_profile_viewed'),
    count(distinct s.actor_user_id) filter (
      where s.event_name = 'public_profile_viewed' and s.actor_user_id is not null),
    -- Anonymous reach, approximated by distinct session handle. Deliberately
    -- named "distinct_anonymous_sessions" and not "unique visitors": a session
    -- handle is short-lived, so one person across two days is two sessions.
    -- Overstating the precision of this number is how it ends up in a pitch
    -- deck as something it is not.
    count(distinct s.session_id) filter (
      where s.event_name = 'public_profile_viewed' and s.actor_user_id is null and s.session_id is not null),

    count(*) filter (where s.event_name = 'booking_started'),
    count(*) filter (where s.event_name = 'appointment_created'),
    count(*) filter (where s.event_name = 'appointment_confirmed'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'appointment_cancelled'),
    count(*) filter (where s.event_name = 'appointment_no_show'),

    count(*) filter (where s.event_name = 'queue_viewed'),
    count(*) filter (where s.event_name = 'queue_joined'),
    count(*) filter (where s.event_name = 'queue_completed'),
    count(*) filter (where s.event_name = 'queue_cancelled'),

    count(*) filter (where s.event_name = 'organization_followed'),
    count(*) filter (where s.event_name = 'organization_unfollowed'),
    count(*) filter (where s.event_name = 'organization_favorited'),
    count(*) filter (where s.event_name = 'organization_unfavorited'),

    (select count(*) from completions_by_actor),
    (select count(*) from completions_by_actor where n > 1),

    -- NULLIF, not a CASE: dividing by zero bookings must yield "no answer",
    -- never 0%. A shop with no bookings has an undefined conversion rate, and
    -- reporting 0% would read as failure rather than absence.
    round(
      count(*) filter (where s.event_name = 'appointment_completed')::numeric
      / nullif(count(*) filter (where s.event_name = 'appointment_created'), 0),
      4),
    round(
      count(*) filter (where s.event_name = 'queue_completed')::numeric
      / nullif(count(*) filter (where s.event_name = 'queue_joined'), 0),
      4)
  from scoped s;
end;
$$;

comment on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz) is
  'The §18 primitive set for ONE organization, over a bounded window, as counts only. Owner/manager or platform admin — deliberately not every member, since a barber has no business reading the shop''s conversion rates. Returns no event row, no actor id and no session id: a shop learns HOW MANY people viewed its profile and never WHO, per §12. Conversion is completions over appointments CREATED, never over booking_started, because intent is a client event and §5 forbids resting conversion on one.';

revoke execute on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.get_professional_analytics_summary
--
-- A professional's own numbers, keyed on the DURABLE identity rather than on a
-- barber placement — so the figures follow the person when they change shop,
-- which is the entire reason professionals exists.
--
-- AUTHORIZATION: the professional themselves, or a platform admin. Not the
-- shop that currently employs them: a professional's cross-shop history is
-- theirs, and R1B built a shop-independent identity precisely so it would not
-- be readable by whoever they happen to work for.
-- ---------------------------------------------------------------------------

create or replace function public.get_professional_analytics_summary(
  p_professional_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,
  profile_views bigint,
  unique_authenticated_viewers bigint,
  follows bigint,
  unfollows bigint,
  appointments_completed bigint,
  queue_completions bigint,
  unique_customers bigint,
  repeat_customers bigint,
  relationships_created bigint
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
  if p_professional_id is null then
    raise exception 'professional required' using errcode = '22023';
  end if;

  if not (
    (select private.is_own_professional(p_professional_id))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read analytics for this professional'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.professional_id = p_professional_id
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
  ),
  completions_by_actor as (
    select s.actor_user_id, count(*) as n
    from scoped s
    where s.event_name in ('appointment_completed', 'queue_completed')
      and s.actor_user_id is not null
    group by s.actor_user_id
  )
  select
    v_from,
    v_to,
    count(*) filter (where s.event_name = 'public_profile_viewed'),
    count(distinct s.actor_user_id) filter (
      where s.event_name = 'public_profile_viewed' and s.actor_user_id is not null),
    count(*) filter (where s.event_name = 'professional_followed'),
    count(*) filter (where s.event_name = 'professional_unfollowed'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'queue_completed'),
    (select count(*) from completions_by_actor),
    (select count(*) from completions_by_actor where n > 1),
    count(*) filter (where s.event_name = 'passport_relationship_created')
  from scoped s;
end;
$$;

comment on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz) is
  'A professional''s own numbers, keyed on the durable R1B identity so they follow the person across shops. Readable by that professional or by a platform admin — deliberately NOT by their current employer, since a shop-independent identity that the shop could read would not be shop-independent. Aggregates only.';

revoke execute on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.get_organization_retention_cohort
--
-- The §10 retention funnel, as a cohort rather than a running total: of the
-- customers whose FIRST delivered service at this shop fell inside the window,
-- how many came back within 30, 60 and 90 days.
--
-- "First" is computed over the whole log, not over the window. A customer who
-- first visited two years ago and returned last week is not a new customer,
-- and a cohort that treated them as one would report retention that never
-- happened.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_retention_cohort(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,
  first_time_customers bigint,
  returned_at_all bigint,
  returned_within_30d bigint,
  returned_within_60d bigint,
  returned_within_90d bigint
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
  if p_organization_id is null then
    raise exception 'organization required' using errcode = '22023';
  end if;

  if not (
    (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read analytics for this organization'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with completions as (
    select e.actor_user_id, e.occurred_at
    from public.analytics_events e
    where e.organization_id = p_organization_id
      and e.event_name in ('appointment_completed', 'queue_completed')
      and e.actor_user_id is not null
  ),
  firsts as (
    select c.actor_user_id, min(c.occurred_at) as first_at
    from completions c
    group by c.actor_user_id
  ),
  cohort as (
    -- The cohort is defined by WHEN THEY FIRST CAME, over all history.
    select f.actor_user_id, f.first_at
    from firsts f
    where f.first_at >= v_from
      and f.first_at < v_to
  ),
  returns as (
    select
      co.actor_user_id,
      min(c.occurred_at - co.first_at) as gap
    from cohort co
    join completions c
      on c.actor_user_id = co.actor_user_id
     and c.occurred_at > co.first_at
    group by co.actor_user_id
  )
  select
    v_from,
    v_to,
    (select count(*) from cohort),
    (select count(*) from returns),
    (select count(*) from returns where gap <= interval '30 days'),
    (select count(*) from returns where gap <= interval '60 days'),
    (select count(*) from returns where gap <= interval '90 days');
end;
$$;

comment on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz) is
  'The §10 retention funnel as a true cohort: of customers whose FIRST delivered service at this shop fell in the window, how many returned at all and within 30/60/90 days. First-visit is computed over all history, not over the window, so a long-standing customer who happened to visit during the window is never miscounted as newly acquired.';

revoke execute on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.get_platform_analytics_funnel
--
-- FadeUp's own numbers: the acquisition and claim funnel of §10, plus the
-- platform-wide product totals. Platform admin only, and it is the only
-- contract here that reads across tenants.
--
-- converted_professionals counts DISTINCT professional_id, not events. That is
-- the §9 guarantee expressed at read time as well as at write time: the same
-- real person discovered through four sources must count once, and a
-- `count(*)` here would have quietly undone the care taken in the emitter.
-- ---------------------------------------------------------------------------

create or replace function public.get_platform_analytics_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,

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
  'FadeUp''s own acquisition/claim funnel and platform product totals, over a bounded window. Platform admin only, and the only read contract that crosses tenants. converted_professionals counts DISTINCT professional identities rather than approval events, so multi-source discovery cannot inflate it — the §9 guarantee enforced at read time as well as at write time.';

revoke execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. private.purge_analytics_events — the retention path
--
-- The ONLY way a row ever leaves analytics_events, and the only holder of the
-- flag the append-only DELETE guard honours.
--
-- Not a cron job and not scheduled here: R3 installs no scheduler (§25 keeps
-- worker/automation scope out), and a retention policy is an operator decision
-- with legal weight. What R3 provides is a safe, auditable, single-purpose
-- primitive for whoever makes that decision, with a floor that makes an
-- accidental "purge everything" impossible.
-- ---------------------------------------------------------------------------

create or replace function private.purge_analytics_events(p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if p_before is null then
    raise exception 'a retention cutoff is required' using errcode = '22023';
  end if;

  -- THE FLOOR. Nothing inside 90 days can be purged by this function at all,
  -- whatever it is asked. A retention job with a mis-signed interval, a
  -- timezone slip or a typo'd unit is the realistic way an event log gets
  -- destroyed, and none of those can reach live data through here.
  if p_before > now() - interval '90 days' then
    raise exception 'analytics retention cutoff must be at least 90 days in the past'
      using errcode = '22023';
  end if;

  -- Transaction-local, and unset immediately afterwards. A client role cannot
  -- reach this function at all, so the flag is not an escape hatch — it is how
  -- one function tells one trigger that this specific DELETE is the sanctioned
  -- one.
  perform set_config('fadeup.analytics_retention_purge', 'on', true);

  delete from public.analytics_events e where e.occurred_at < p_before;
  get diagnostics v_deleted = row_count;

  perform set_config('fadeup.analytics_retention_purge', '', true);

  raise notice 'analytics retention: % events removed before %', v_deleted, p_before;
  return v_deleted;
end;
$$;

comment on function private.purge_analytics_events(timestamptz) is
  'The ONLY path by which an analytics event is ever removed, and the only holder of the flag the append-only DELETE guard honours. Refuses any cutoff inside 90 days, so a mis-signed interval or a typo''d unit in a future retention job cannot reach live data. Deliberately not scheduled: R3 installs no cron, and a retention policy is an operator decision with legal weight.';

revoke all on function private.purge_analytics_events(timestamptz) from public, anon, authenticated;
