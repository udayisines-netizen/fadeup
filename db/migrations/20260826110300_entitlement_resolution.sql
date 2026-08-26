-- FadeUp — R2: resolving what an organization may actually do
--
-- ONE RESOLVER, CONSULTED BY EVERYTHING
--
-- The failure mode R2 exists to prevent is `plan === 'pro'` appearing in a
-- dozen places, each subtly different, none of them authoritative. So every
-- entitlement question in FadeUp goes through the functions in this file, and
-- the chain they implement is:
--
--     authenticated actor
--          v   private.is_org_member / has_org_role / is_platform_admin
--     membership or ownership
--          v
--     organization
--          v   organization_commercial_state (exactly one row)
--     commercial plan + status
--          v   effective plan (status is applied here, once)
--     plan_capabilities
--          v
--     allow / deny, with a reason
--
-- The actor is resolved from auth.uid() and NEVER from an argument. The
-- organization id IS an argument — it has to be, the caller is asking about
-- something — but it is treated as a QUESTION, not as a credential: every
-- entry point re-derives the caller's relationship to it before answering.
-- Passing someone else's organization id gets the same 42501 whether that
-- organization exists or not, so these functions cannot be used to enumerate
-- tenants.
--
-- WHY `planned` CAPABILITIES RESOLVE TO FALSE FOR EVERYONE
--
-- org_has_capability() answers "may this organization USE this", and the honest
-- answer for a capability FadeUp has not built is no — for every plan, at every
-- price. Packaging is recorded (plan_capabilities still contains the row, and
-- the pricing surface still says "on the roadmap"), but a gate that opened for
-- salon_business on `retentionAutomation` would be opening onto nothing. This
-- is the same discipline apps/web/src/lib/commerce/plans.ts already enforces
-- with liveCapabilities(), moved to where it can be trusted.
--
-- STATUS IS APPLIED ONCE, IN effective_plan_key()
--
--   active    -> the assigned plan
--   past_due  -> the assigned plan. A failed payment is a conversation, not a
--                shutdown; access is preserved while it is resolved, and no
--                data is touched either way.
--   canceled  -> free. The organization keeps its identity, its establishments,
--                its customers, its professionals and its history — it drops to
--                network presence. Capacity CAPS then apply going forward, so a
--                cancelled five-location group keeps all five and can create no
--                sixth. Nothing is deleted, ever, by anything in R2.
--
-- Doing this in one function rather than in each caller is the difference
-- between one rule and five drifting interpretations of it.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.effective_plan_key — the plan actually in force
--
-- SECURITY DEFINER because it reads organization_commercial_state, which every
-- client role has had its privileges revoked on. It performs NO authorization
-- of its own and must not be treated as an entry point: it lives in `private`
-- (not exposed through PostgREST, per 20260809100800), EXECUTE is granted to no
-- client role, and every public caller in this file checks membership first.
-- ---------------------------------------------------------------------------

create or replace function private.effective_plan_key(p_organization_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when s.status = 'canceled' then 'free'
    else s.plan_key
  end
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id;
$$;

comment on function private.effective_plan_key(uuid) is
  'The plan actually in force for an organization, with commercial status applied exactly once: canceled degrades to free (network presence, nothing deleted), past_due keeps the assigned plan because a failed payment is a conversation rather than a shutdown. Returns NULL when the organization has no commercial state, which every caller treats as deny. Performs no authorization: private schema, no client EXECUTE, and every public caller checks membership first.';

revoke all on function private.effective_plan_key(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.org_has_capability — the one question everything else asks
--
-- Fails closed on every unknown: no organization, no commercial state, an
-- unrecognised plan, an unrecognised capability, a NULL argument. `not exists`
-- would be the natural way to write half of these and would fail OPEN on a
-- typo'd capability name, which is precisely the mistake that makes a gate
-- decorative. Written as an explicit positive match instead.
-- ---------------------------------------------------------------------------

create or replace function private.org_has_capability(p_organization_id uuid, p_capability text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_commercial_state s
    join public.plan_capabilities pc
      on pc.plan_key = private.effective_plan_key(s.organization_id)
    join public.commercial_capabilities c
      on c.capability_key = pc.capability_key
    where s.organization_id = p_organization_id
      and p_organization_id is not null
      and pc.capability_key = p_capability
      -- A capability FadeUp has not built cannot be granted by any plan at any
      -- price. Packaging is still recorded; access is not.
      and c.status = 'live'
  );
$$;

comment on function private.org_has_capability(uuid, text) is
  'THE entitlement question. True only when the organization has commercial state, its effective plan packages the capability, and the capability is actually built (status = live). Fails closed on every unknown — missing state, unknown plan, unknown capability, NULL argument — because a gate that fails open on a typo is decorative. Performs no authorization of its own: callers must already have established the actor''s relationship to the organization.';

revoke all on function private.org_has_capability(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.assert_org_capability — the same question, as a guard
--
-- Raises 42501 with a message naming the capability and the plan in force, so a
-- refused request tells the professional WHY rather than dying as a generic
-- permission error. The organization id is deliberately absent from the
-- message: callers of this function have already established the actor's
-- relationship to it, but an error string tends to end up in a log a wider
-- audience reads.
-- ---------------------------------------------------------------------------

create or replace function private.assert_org_capability(p_organization_id uuid, p_capability text)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_plan text;
begin
  if private.org_has_capability(p_organization_id, p_capability) then
    return;
  end if;

  v_plan := private.effective_plan_key(p_organization_id);

  raise exception 'the % capability is not available on the % plan',
    p_capability, coalesce(v_plan, 'unknown')
    using errcode = '42501',
          hint = 'Change the organization plan through public.assign_commercial_plan(); a client cannot grant itself a capability.';
end;
$$;

comment on function private.assert_org_capability(uuid, text) is
  'org_has_capability() as a guard: returns quietly or raises 42501 naming the capability and the plan in force, so a refusal explains itself instead of surfacing as a generic permission error. Deliberately omits the organization id from the message — error strings travel further than the caller does.';

revoke all on function private.assert_org_capability(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.org_* usage counts — what capacity is measured against
--
-- Defined ONCE so the capacity triggers, the plan-change guard and the read
-- RPC cannot disagree about what "an establishment" or "a professional" means.
-- Three surfaces counting the same thing three ways is how a limit becomes
-- enforceable in one place and bypassable in another.
--
--   establishment   an ACTIVE location. An organization that has deactivated a
--                   location is not operating it, so it does not consume
--                   capacity — and R1A's rule that removal is deactivation
--                   rather than deletion means this is the only count that
--                   reflects reality.
--   operational     a barbers row whose staff_profiles row is active.
--   professional    offboard_barber() sets is_active = false and never deletes,
--                   so a shop that has had thirty barbers over five years
--                   counts the ones working there now. Deliberately NOT
--                   count(barbers): that would make a long-lived shop
--                   permanently over capacity for people who left, and would
--                   turn R1A's durable history into a liability.
-- ---------------------------------------------------------------------------

create or replace function private.org_active_establishments(p_organization_id uuid)
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.locations l
  where l.organization_id = p_organization_id
    and l.is_active;
$$;

comment on function private.org_active_establishments(uuid) is
  'Establishments an organization is currently OPERATING: active locations. A deactivated location consumes no capacity, which is the only reading consistent with R1A making removal a deactivation rather than a deletion.';

create or replace function private.org_active_professionals(p_organization_id uuid)
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where b.organization_id = p_organization_id
    and sp.is_active;
$$;

comment on function private.org_active_professionals(uuid) is
  'Operational professionals an organization currently rosters: barbers rows whose staff_profile is active. Deliberately NOT count(barbers) — offboard_barber() deactivates and never deletes, so counting every row ever created would make a long-lived shop permanently over capacity for people who left.';

revoke all on function private.org_active_establishments(uuid) from public, anon, authenticated;
revoke all on function private.org_active_professionals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.get_organization_entitlements — the read surface
--
-- The single thing the application calls to know what to show, hide, disable
-- and explain. It returns the SAME truth the triggers enforce, which is the
-- point: a UI built on a second, parallel idea of the plan is a UI that will
-- eventually offer a button the database refuses.
--
-- AUTHORIZATION. The caller must be a member of the organization, or a platform
-- admin. Anything else raises 42501 — and it raises the IDENTICAL error whether
-- the organization exists, belongs to someone else, or was never created, so
-- the function cannot be used to test whether a tenant exists.
--
-- Returns exactly one row. Capabilities come back as two arrays rather than as
-- rows because the caller always wants the whole set:
--
--   live_capabilities      what this organization may actually use today. This
--                          is what a gate should consult.
--   packaged_capabilities  everything the plan includes, built or not. This is
--                          what a plan comparison should render, with the
--                          unbuilt ones marked — never counted as included.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_entitlements(p_organization_id uuid)
returns table (
  organization_id uuid,
  plan_key text,
  commercial_family public.commercial_family,
  display_name text,
  price_minor integer,
  price_currency text,
  status public.commercial_status,
  entitlement_source public.entitlement_source,
  -- May differ from plan_key: a canceled subscription resolves to free without
  -- rewriting what the organization is on, so the history stays legible.
  effective_plan_key text,
  max_establishments integer,
  used_establishments integer,
  max_operational_professionals integer,
  used_operational_professionals integer,
  live_capabilities text[],
  packaged_capabilities text[]
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_effective text;
begin
  if (select auth.uid()) is null then
    raise exception 'resolving entitlements requires an authenticated session'
      using errcode = '42501';
  end if;

  -- Identical refusal for "not yours", "not a member" and "does not exist".
  -- Splitting them would be friendlier and would also answer "does this
  -- organization exist" for anyone willing to guess uuids.
  if p_organization_id is null
     or not (
       (select private.is_org_member(p_organization_id))
       or (select private.is_platform_admin())
     ) then
    raise exception 'not authorized to read the commercial state of this organization'
      using errcode = '42501';
  end if;

  v_effective := private.effective_plan_key(p_organization_id);

  if v_effective is null then
    -- An organization the caller genuinely belongs to but which has no
    -- commercial state is a data defect, not an authorization question. Say so
    -- plainly rather than returning zero rows the UI would render as "loading
    -- forever".
    raise exception 'organization has no commercial state — R2 backfill did not cover it'
      using errcode = 'P0001';
  end if;

  return query
  select
    s.organization_id,
    s.plan_key,
    p.commercial_family,
    p.display_name,
    p.price_minor,
    p.price_currency,
    s.status,
    s.entitlement_source,
    v_effective,
    -- Capacity always comes from the EFFECTIVE plan, never the assigned one.
    ep.max_establishments,
    private.org_active_establishments(s.organization_id),
    ep.max_operational_professionals,
    private.org_active_professionals(s.organization_id),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      join public.commercial_capabilities c on c.capability_key = pc.capability_key
      where pc.plan_key = v_effective and c.status = 'live'
    ), array[]::text[]),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      where pc.plan_key = v_effective
    ), array[]::text[])
  from public.organization_commercial_state s
  join public.commercial_plans p on p.plan_key = s.plan_key
  join public.commercial_plans ep on ep.plan_key = v_effective
  where s.organization_id = p_organization_id;
end;
$$;

comment on function public.get_organization_entitlements(uuid) is
  'The authoritative entitlement snapshot for ONE organization the caller belongs to (or any organization, for a platform admin). The organization id is a question, never a credential: membership is re-derived from auth.uid() before anything is returned, and a caller who is not a member gets the IDENTICAL 42501 whether the organization exists or not, so this cannot enumerate tenants. Capacity is reported from the EFFECTIVE plan, so a canceled subscription shows free capacity while the assigned plan remains visible in plan_key.';

revoke execute on function public.get_organization_entitlements(uuid) from public, anon;
grant execute on function public.get_organization_entitlements(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.my_organization_has_capability — the narrow question, safely asked
--
-- A convenience for the application, and deliberately narrower than the
-- resolver: it answers one boolean about one organization the caller belongs
-- to. It returns FALSE rather than raising for an organization the caller has
-- no relationship with — a boolean gate that throws makes every call site write
-- error handling for a case that means "no", and false IS the correct answer to
-- "may I use this here" when the answer to "am I here at all" is no.
--
-- That is not an oracle: false is also the answer for an organization that does
-- not exist, for one the caller does belong to but whose plan lacks the
-- capability, and for a capability nobody has. All four cases are
-- indistinguishable.
-- ---------------------------------------------------------------------------

create or replace function public.my_organization_has_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and p_organization_id is not null
    and (
      (select private.is_org_member(p_organization_id))
      or (select private.is_platform_admin())
    )
    and private.org_has_capability(p_organization_id, p_capability);
$$;

comment on function public.my_organization_has_capability(uuid, text) is
  'One boolean about one organization the caller belongs to. Returns false — never raises — for a non-member, a non-existent organization, a plan without the capability, and a capability that does not exist, so all four are indistinguishable and it leaks nothing. Frontend gating is UX: this exists so the UI can show, hide, disable and EXPLAIN consistently with what the database will actually allow, not so it can be the thing that allows it.';

revoke execute on function public.my_organization_has_capability(uuid, text) from public, anon;
grant execute on function public.my_organization_has_capability(uuid, text) to authenticated;

do $$
begin
  raise notice 'R2 entitlement resolution installed';
end $$;
