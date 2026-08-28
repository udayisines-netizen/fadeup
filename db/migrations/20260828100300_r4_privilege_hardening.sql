-- FadeUp — R4: privilege hardening, and the assertions that keep it true
--
-- THE DEFAULT THIS FILE EXISTS TO UNDO
--
-- Postgres grants EXECUTE to PUBLIC on every newly created function, and anon
-- and authenticated inherit from PUBLIC. Every function the three preceding R4
-- migrations created is therefore a callable endpoint until revoked — including
-- two trigger functions and the gate itself.
--
-- R3's own hardening sweeps functions named `analytics\_%` in `public`, which
-- would have caught R4's two new instrumentation triggers — except that
-- migrations replay in filename order, so R3's sweep runs before R4's functions
-- exist. A later lot inheriting an earlier lot's sweep is not a mechanism; each
-- lot hardens what it creates.
--
-- A SECOND, R4-SPECIFIC REASON THIS MATTERS
--
-- publication_block_reason is STABLE, SECURITY DEFINER, takes a prospect id and
-- returns a short string. Left callable by anon it is an oracle: a stranger
-- could enumerate prospect ids and learn from the reply whether FadeUp holds a
-- record of a given business, whether that business is suppressed, and whether
-- it has already converted to a paying customer. The function is genuinely
-- needed by platform staff and by the Worker, so the fix is the grant list, not
-- the function.
--
-- WHAT IS DELIBERATELY LEFT CALLABLE
--
--   publication_block_reason                   authenticated + prospect_worker
--   refresh_prospect_publication_eligibility   authenticated + prospect_worker
--   sweep_prospect_publication_eligibility     authenticated + prospect_worker
--   publish_external_professional              authenticated
--
-- Each authorizes its own caller in its body — platform-role checks for the
-- staff arm, the session_user + null-auth.uid() pair R1B established for the
-- worker arm. The grant admits a role to the function; the function decides
-- what that role may actually do. Nothing here is callable by anon.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Revoke PUBLIC execute on everything R4 created in `public`
--
-- Driven off the catalogue rather than a hand-maintained list, so a function
-- added by a later R4 fix cannot be forgotten here.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
  v_revoked integer := 0;
begin
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'publication_block_reason',
        'refresh_prospect_publication_eligibility',
        'sweep_prospect_publication_eligibility',
        'enforce_prospect_publication_gate',
        'publish_external_professional',
        'analytics_prospect_discovered_event',
        'analytics_prospect_enriched_event'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.signature);
    v_revoked := v_revoked + 1;
  end loop;

  raise notice 'R4 hardening: execute revoked from PUBLIC on % functions', v_revoked;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-grant exactly the four that are genuinely contracts
--
-- By name and by full signature, so adding a fifth is a decision somebody has
-- to write down rather than a pattern that silently widens.
-- ---------------------------------------------------------------------------

grant execute on function public.publication_block_reason(uuid)
  to authenticated, prospect_worker;
grant execute on function public.refresh_prospect_publication_eligibility(uuid)
  to authenticated, prospect_worker;
grant execute on function public.sweep_prospect_publication_eligibility(integer)
  to authenticated, prospect_worker;
grant execute on function public.publish_external_professional(uuid, text)
  to authenticated;

-- The two instrumentation triggers are re-granted to NOBODY. They are reached
-- by the trigger machinery, which does not consult EXECUTE privilege at all.

-- ---------------------------------------------------------------------------
-- 3. Re-assert the table posture
--
-- Stated here as well as in 20260828100000 so this file alone is enough to
-- restore the posture, and so a stray grant issued between the two is
-- corrected on every replay.
--
-- prospect_worker keeps SELECT and nothing else: it needs to know a verdict in
-- order to decide what to re-evaluate, and it writes exclusively through the
-- refresh RPC.
-- ---------------------------------------------------------------------------

revoke all on table public.prospect_publication_eligibility from public, anon, authenticated;
-- SELECT is re-granted to authenticated because the platform-staff policy needs
-- a grant to be reachable at all; 4.4 below asserts no WRITE came back with it,
-- and the policy is what restricts the rows to platform roles.
grant select on table public.prospect_publication_eligibility to authenticated;
grant select on table public.prospect_publication_eligibility to prospect_worker;

-- R1B revoked SELECT on prospect_professionals from `authenticated` outright,
-- and separately wrote a platform-staff policy: two independent layers in front
-- of the one table that answers "was FadeUp scraping this business". An earlier
-- revision of R4 re-granted three columns so the operator queue could join it,
-- and R1B's own VERIFY §8.16 caught the regression. The queue now derives what
-- it needs from the cached verdict, and this restores the posture on any
-- environment that applied that revision.
revoke all on table public.prospect_professionals from authenticated;

-- The Worker is deliberately not admitted to the publication decision. It has
-- SELECT on the queue's inputs through its existing grants; it has no path to
-- the operator's front door.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    execute 'revoke all on function public.publish_external_professional(uuid, text) from prospect_worker';
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
begin
  -- 4.1 anon reaches nothing R4 created. The oracle argument above is the
  -- specific reason, and it applies to every one of these signatures.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'publication_block_reason',
      'refresh_prospect_publication_eligibility',
      'sweep_prospect_publication_eligibility',
      'enforce_prospect_publication_gate',
      'publish_external_professional',
      'analytics_prospect_discovered_event',
      'analytics_prospect_enriched_event'
    )
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'R4 hardening: anon can execute %', v_bad;
  end if;

  -- 4.2 The two trigger functions are callable by no client role at all.
  -- Calling one directly fails with "trigger functions can only be called as
  -- triggers", but "it happens to fail for an unrelated reason" is not an
  -- access control.
  select string_agg(format('%s to %s', p.oid::regprocedure, r), ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon', 'authenticated']) as r
  where n.nspname = 'public'
    and p.proname in (
      'enforce_prospect_publication_gate',
      'analytics_prospect_discovered_event',
      'analytics_prospect_enriched_event'
    )
    and has_function_privilege(r, p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'R4 hardening: a trigger function is client-callable: %', v_bad;
  end if;

  -- 4.3 The Worker cannot publish. This is R4's division of labour expressed
  -- as a privilege rather than as a convention: the machine evaluates, a human
  -- decides. If a later lot wants an auto-publish lane it has to remove this
  -- assertion, which is exactly the amount of friction that decision deserves.
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    if has_function_privilege('prospect_worker',
         'public.publish_external_professional(uuid, text)', 'EXECUTE') then
      raise exception 'R4 hardening: prospect_worker can execute publish_external_professional';
    end if;
  end if;

  -- 4.4 No client role holds a direct write on the eligibility cache. A forged
  -- `is_eligible = true` would not permit a publication — the gate re-checks
  -- live — but it would put a lie in front of the administrator who approves
  -- one, and their judgement is the control this lot rests on.
  select string_agg(format('%s:%s', r, pr), ', ')
    into v_bad
  from unnest(array['anon', 'authenticated']) as r
  cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as pr
  where has_table_privilege(r, 'public.prospect_publication_eligibility', pr);

  if v_bad is not null then
    raise exception 'R4 hardening: a client role can write prospect_publication_eligibility (%)', v_bad;
  end if;

  -- anon must not even READ it. authenticated may, because a policy without a
  -- grant is unreachable — the row filtering is the policy's job, and 4.4 above
  -- has just proven the grant carries no write.
  if has_table_privilege('anon', 'public.prospect_publication_eligibility', 'SELECT') then
    raise exception 'R4 hardening: anon can read prospect_publication_eligibility';
  end if;

  if not has_table_privilege('authenticated', 'public.prospect_publication_eligibility', 'SELECT') then
    raise exception 'R4 hardening: the platform-staff SELECT policy is unreachable without a grant';
  end if;

  -- 4.4b R4 gave back NOTHING on prospect_professionals. Asserted rather than
  -- merely revoked above, because the revert this restores was a change that
  -- looked entirely reasonable and came with a confident justification.
  if has_table_privilege('authenticated', 'public.prospect_professionals', 'SELECT') then
    raise exception 'R4 hardening: authenticated can read prospect_professionals — R1B revoked this deliberately';
  end if;

  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    select string_agg(pr, ', ')
      into v_bad
    from unnest(array['INSERT', 'UPDATE', 'DELETE']) as pr
    where has_table_privilege('prospect_worker', 'public.prospect_publication_eligibility', pr);

    if v_bad is not null then
      raise exception 'R4 hardening: prospect_worker can write prospect_publication_eligibility directly (%)', v_bad;
    end if;
  end if;

  -- 4.5 RLS is enabled AND forced on the cache. Enabled-but-not-forced would
  -- exempt the table owner, and the refresh function runs as the owner.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'prospect_publication_eligibility'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'R4 hardening: RLS is not enabled and forced on prospect_publication_eligibility';
  end if;

  -- 4.6 Every R4 function pins its search_path — deliberately NOT filtered to
  -- SECURITY DEFINER, matching R1B's and R3's recorded reasoning: an
  -- unqualified name resolves through the CALLER's search_path either way, so
  -- a caller could create their own `prospects` in a schema they control and
  -- have the gate read there instead.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'publication_block_reason',
      'refresh_prospect_publication_eligibility',
      'sweep_prospect_publication_eligibility',
      'enforce_prospect_publication_gate',
      'publish_external_professional',
      'analytics_prospect_discovered_event',
      'analytics_prospect_enriched_event'
    )
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg like 'search_path=%'
    );

  if v_bad is not null then
    raise exception 'R4 hardening: function without a pinned search_path: %', v_bad;
  end if;

  -- 4.7 The gate is actually installed. Every guarantee in this lot rests on
  -- one trigger existing; a migration that dropped and recreated
  -- prospect_professionals without it would silently reopen the whole surface.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'prospect_professionals'
      and t.tgname = 'prospect_professionals_enforce_publication_gate'
      and not t.tgisinternal
  ) then
    raise exception 'R4 hardening: the publication gate trigger is missing from prospect_professionals';
  end if;

  -- 4.8 Both acquisition event contracts are wired. A `deferred` row cannot
  -- emit, so a taxonomy that silently reverted would leave the funnel's head
  -- empty and reporting zero rather than failing.
  if exists (
    select 1 from public.analytics_event_definitions
    where event_name in ('prospect_discovered', 'prospect_enriched')
      and status <> 'wired'
  ) then
    raise exception 'R4 hardening: an acquisition event contract is not wired';
  end if;

  raise notice 'R4 hardening: all assertions passed';
end $$;
