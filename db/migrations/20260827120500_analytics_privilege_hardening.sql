-- FadeUp — R3: privilege hardening, and the assertions that keep it true
--
-- THE DEFAULT THIS FILE EXISTS TO UNDO
--
--   Postgres grants EXECUTE to PUBLIC on every newly created function. Because
--   anon and authenticated inherit from PUBLIC, that means every function the
--   preceding four migrations created is, by default, a callable API endpoint —
--   including nine SECURITY DEFINER trigger functions.
--
--   In practice a trigger function called directly fails immediately ("trigger
--   functions can only be called as triggers"), so this is hardening rather
--   than a live exploit. It is done anyway, because "it happens to fail for an
--   unrelated reason" is not an access control, and because the Supabase
--   security guidance bundled with this repository is unambiguous: a SECURITY
--   DEFINER function in `public` is a public endpoint until somebody revokes it.
--
-- WHAT IS DELIBERATELY LEFT CALLABLE
--
--   Exactly four functions, and each is listed by name below rather than
--   matched by a pattern, so adding a fifth is a decision somebody has to
--   write down:
--
--     track_analytics_event               anon + authenticated  (§11 client path)
--     get_organization_analytics_summary  authenticated         (tenant reads)
--     get_organization_retention_cohort   authenticated
--     get_professional_analytics_summary  authenticated
--     get_platform_analytics_funnel       authenticated         (admin-gated in body)
--
--   Every one of those authorizes its own caller in its body. The grant admits
--   them to the function; the function decides what they may see.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Revoke PUBLIC execute on everything R3 created in `public`
--
-- Driven off the catalogue rather than a hand-maintained list, so a function
-- added by a later R3 fix cannot be forgotten here.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
  v_revoked integer := 0;
begin
  for v_fn in
    select
      p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'analytics\_%'
        or p.proname in (
          'track_analytics_event',
          'reject_analytics_event_mutation',
          'get_organization_analytics_summary',
          'get_organization_retention_cohort',
          'get_professional_analytics_summary',
          'get_platform_analytics_funnel'
        )
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.signature);
    v_revoked := v_revoked + 1;
  end loop;

  raise notice 'R3 hardening: execute revoked from PUBLIC on % analytics functions', v_revoked;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-grant the four (five signatures) that are genuinely client contracts
-- ---------------------------------------------------------------------------

grant execute on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid)
  to anon, authenticated;

grant execute on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assert the table posture
--
-- The foundation migration set this up; re-asserting here means a stray grant
-- issued between the two is corrected on every replay, and means this file
-- alone is enough to restore the posture.
-- ---------------------------------------------------------------------------

revoke all on table public.analytics_events from public, anon, authenticated;
revoke all on table public.analytics_event_definitions from public, anon, authenticated;
revoke all on table public.analytics_ingestion_rejections from public, anon, authenticated;

-- The acquisition worker gets nothing either. It has no reason to read product
-- analytics, and R1A's least-privilege migration removed a broader grant from
-- this same role for exactly the reason that a scraping worker is the
-- highest-risk credential in the system.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    execute 'revoke all on table public.analytics_events from prospect_worker';
    execute 'revoke all on table public.analytics_event_definitions from prospect_worker';
    execute 'revoke all on table public.analytics_ingestion_rejections from prospect_worker';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE ASSERTIONS
--
-- Everything above can be undone by one careless grant in a later migration.
-- These run inside this transaction and refuse to commit if the posture is
-- wrong, so the failure surfaces at deploy time rather than in an audit.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text;
  v_count integer;
begin
  -- 4.1 No client role holds ANY privilege on the event log. This is the §11
  -- "clients cannot raw INSERT" requirement, proven rather than asserted, and
  -- it covers SELECT too — a tenant reading another tenant's raw events is the
  -- larger failure.
  select string_agg(format('%s:%s', r, pr), ', ')
    into v_bad
  from unnest(array['anon', 'authenticated']) as r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as pr
  where has_table_privilege(r, 'public.analytics_events', pr);

  if v_bad is not null then
    raise exception 'R3 hardening: a client role holds privilege on analytics_events (%)', v_bad;
  end if;

  -- 4.2 Same for the taxonomy and the diagnostics table.
  select string_agg(format('%s on %s', r, t), ', ')
    into v_bad
  from unnest(array['anon', 'authenticated']) as r
  cross join unnest(array[
    'public.analytics_event_definitions',
    'public.analytics_ingestion_rejections'
  ]) as t
  where has_table_privilege(r, t, 'SELECT')
     or has_table_privilege(r, t, 'INSERT');

  if v_bad is not null then
    raise exception 'R3 hardening: a client role holds privilege on an analytics support table (%)', v_bad;
  end if;

  -- 4.3 RLS is enabled AND forced on all three. Enabled-but-not-forced would
  -- exempt the table owner, and every ingestion function runs as the owner.
  select string_agg(c.relname, ', ')
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('analytics_events', 'analytics_event_definitions', 'analytics_ingestion_rejections')
    and not (c.relrowsecurity and c.relforcerowsecurity);

  if v_bad is not null then
    raise exception 'R3 hardening: RLS is not enabled and forced on: %', v_bad;
  end if;

  -- 4.4 EVERY R3 function pins its search_path — deliberately NOT filtered to
  -- SECURITY DEFINER, matching the reasoning R1B's hardening already records:
  -- an unqualified name resolves through the CALLER's search_path in either
  -- case, so a caller can create their own `analytics_events` in a schema they
  -- control and have the function read or write there instead. Definer
  -- functions make that worse, not different.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.proname like 'analytics\_%'
         or p.proname like '%\_analytics\_%'
         or p.proname in ('track_analytics_event', 'purge_analytics_events',
                          'emit_analytics_event', 'try_emit_analytics_event'))
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg like 'search_path=%'
    );

  if v_bad is not null then
    raise exception 'R3 hardening: SECURITY DEFINER function without a pinned search_path: %', v_bad;
  end if;

  -- 4.5 No analytics function in `private` is callable by a client role. The
  -- private schema is not exposed through PostgREST, so this is defence in
  -- depth — but private.emit_analytics_event accepts an arbitrary actor id,
  -- and a grant on it would hand a client exactly the impersonation the whole
  -- ingestion design exists to prevent.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon', 'authenticated']) as r
  where n.nspname = 'private'
    and (p.proname like '%analytics%' or p.proname like 'purge_analytics%')
    and has_function_privilege(r, p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'R3 hardening: a client role can execute a private analytics function: %', v_bad;
  end if;

  -- 4.6 THE INSTRUMENTATION IS ACTUALLY ATTACHED.
  --
  -- Everything else here is worthless if the triggers are missing: an
  -- analytics engine nothing emits into is an empty table with excellent
  -- documentation. A dropped migration or a renamed table produces exactly
  -- that, and nothing else in the pipeline would notice.
  select count(*)
    into v_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
    and t.tgname in (
      'organization_follows_analytics',
      'professional_follows_analytics',
      'customer_favorites_analytics',
      'appointments_analytics_insert',
      'appointments_analytics_update',
      'queue_entries_analytics_insert',
      'queue_entries_analytics_update',
      'customer_passports_analytics',
      'customer_professional_relationships_analytics',
      'prospect_professionals_analytics',
      'professional_claims_analytics_insert',
      'professional_claims_analytics_update',
      'commercial_plan_changes_analytics'
    );

  if v_count <> 13 then
    raise exception 'R3 hardening: expected 13 analytics triggers attached, found %', v_count;
  end if;

  -- 4.7 The append-only guards are attached. Without them "append-only" is a
  -- comment.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'analytics_events'
      and t.tgname = 'analytics_events_reject_update'
      and not t.tgisinternal
  ) or not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'analytics_events'
      and t.tgname = 'analytics_events_reject_delete'
      and not t.tgisinternal
  ) then
    raise exception 'R3 hardening: analytics_events is missing an append-only guard';
  end if;

  -- 4.8 analytics_events has NO permissive policy. The posture is "no grant,
  -- no policy, unreachable"; a policy appearing here would mean somebody
  -- started down the road of exposing the raw log to clients.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'analytics_events';

  if v_count <> 0 then
    raise exception 'R3 hardening: analytics_events has % RLS policies; it is meant to be unreachable, not selectively readable', v_count;
  end if;

  raise notice 'R3 hardening: all analytics privilege assertions passed';
end $$;
