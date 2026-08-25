-- FadeUp — R1: genuine customer <-> professional relationships
-- Migration: customer_professional_relationships + completion triggers
--
-- CONFIRMED IS NOT COMPLETED.
--
-- A confirmed booking is enough to auto-follow (20260824100300). It is NOT
-- evidence that a haircut happened. Only a completed appointment or a
-- completed queue visit establishes a relationship, and therefore
-- Verified Client status. A future-dated confirmed appointment can never
-- produce one.
--
-- HYBRID MATERIALISED AGGREGATE
--
-- appointments and queue_entries remain the SOURCE OF TRUTH. This table is a
-- rebuildable aggregate over them, maintained on completion. Chosen over pure
-- derivation because a public profile load would otherwise aggregate the two
-- largest tables in the system per professional on every view; chosen over an
-- independent materialisation because "rebuildable" means any bug is
-- correctable by recomputation instead of restore. rebuild_customer_
-- professional_relationships() below is what makes that claim real.
--
-- WHY organization_id IS IN THE UNIQUE KEY
--
-- This is the whole point of the shop dimension, and getting it wrong is a
-- cross-tenant leak. With a two-column key (customer, professional), an
-- upsert would overwrite organization_id with whichever shop most recently
-- completed a service. Concretely: professional P serves customer C twenty
-- times at shop A, then moves to shop B — the exact scenario the durable
-- professionals table exists to support — and serves C once. Shop B would
-- then read completed_interaction_count = 21 with first_completed_at from two
-- years earlier: twenty services transacted at a competitor, exposed to B.
-- Shop A would simultaneously lose access to history that genuinely happened
-- at A. A row's tenant would be decided by a write from a different tenant.
--
-- One row per (customer, professional, shop). "Is a verified client of P" is
-- then an EXISTS across that professional's rows, computed in the projection
-- RPC — the aggregate is the professional's fact, the row is the tenant's.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. customer_professional_relationships
-- ---------------------------------------------------------------------------

create table if not exists public.customer_professional_relationships (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- NOT NULL + CASCADE, deliberately. This is an aggregate whose evidence
  -- (appointments, queue_entries) already cascades from organizations.
  -- Keeping the aggregate after its evidence is gone would assert history
  -- that can no longer be rebuilt. Durability (§14) is a promise about
  -- IDENTITY — professionals rows survive shop deletion — not about per-shop
  -- service history whose underlying records have been erased.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  first_completed_at timestamptz not null,
  last_completed_at timestamptz not null,
  completed_interaction_count integer not null default 0,
  established_by text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_professional_relationships_unique
    unique (customer_user_id, professional_id, organization_id),
  constraint customer_professional_relationships_count_non_negative
    check (completed_interaction_count >= 0),
  constraint customer_professional_relationships_established_by_valid
    check (established_by in ('appointment', 'queue')),
  constraint customer_professional_relationships_dates_ordered
    check (last_completed_at >= first_completed_at)
);

comment on table public.customer_professional_relationships is
  'Genuine completed-service relationships, one row per (customer account, professional, organization). A rebuildable aggregate over appointments/queue_entries, which remain the source of truth. Verified Client means a row here with completed_interaction_count >= 1 — it is NEVER derived from follows, and follows are never derived from it.';

comment on column public.customer_professional_relationships.organization_id is
  'The shop where these services happened. Part of the unique key and immutable: without it, a professional changing shop would carry the previous shop''s service history into the new shop''s RLS scope.';

-- Verified-client count for a professional, across shops.
create index if not exists customer_professional_relationships_professional_idx
  on public.customer_professional_relationships (professional_id);

-- The org-member read path.
create index if not exists customer_professional_relationships_org_idx
  on public.customer_professional_relationships (organization_id, last_completed_at desc);

-- NOTE: deliberately NOT partial on completed_interaction_count >= 1 — the
-- writers never insert a zero, so the predicate is always true and would only
-- cost planner time.

drop trigger if exists customer_professional_relationships_set_updated_at on public.customer_professional_relationships;
create trigger customer_professional_relationships_set_updated_at
  before update on public.customer_professional_relationships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Immutability guard
--
-- The unique key stops a duplicate; this stops the tenant of an existing row
-- being reassigned, which would move a shop's history into another shop's
-- RLS scope without creating any new row at all.
-- ---------------------------------------------------------------------------

create or replace function public.guard_relationship_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id is distinct from old.professional_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'customer_professional_relationships: identity columns are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_professional_relationships_guard on public.customer_professional_relationships;
create trigger customer_professional_relationships_guard
  before update on public.customer_professional_relationships
  for each row execute function public.guard_relationship_update();

-- ---------------------------------------------------------------------------
-- 3. RLS — read only, and never by another tenant
--
-- NO INSERT, UPDATE or DELETE policy exists. This table is trigger-maintained
-- exclusively. Without that rule an authenticated user could POST themselves
-- a relationship with completed_interaction_count = 99 against any
-- professional and forge Verified Client status outright.
--
-- The SECURITY DEFINER triggers write through FORCE RLS because they are
-- owned by postgres (rolbypassrls). This is the same shape
-- appointment_claim_tokens already uses: enable + force, zero policies, and
-- all writes via definer functions.
-- ---------------------------------------------------------------------------

alter table public.customer_professional_relationships enable row level security;
alter table public.customer_professional_relationships force row level security;

drop policy if exists customer_professional_relationships_select on public.customer_professional_relationships;
create policy customer_professional_relationships_select
  on public.customer_professional_relationships
  for select
  to authenticated
  using (
    -- the customer themselves
    customer_user_id = (select auth.uid())
    -- the professional the relationship is about
    or exists (
      select 1 from public.professionals p
      where p.id = customer_professional_relationships.professional_id
        and p.user_id = (select auth.uid())
    )
    -- members of the shop where it happened — and ONLY that shop
    or (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

revoke insert, update, delete on public.customer_professional_relationships from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. record_service_relationship
--
-- The one write path. Idempotent per completion event by construction of the
-- unique key; a retried completion increments the counter, which is correct —
-- each genuine completion is a genuine interaction.
-- ---------------------------------------------------------------------------

create or replace function private.record_service_relationship(
  p_customer_user_id uuid,
  p_professional_id uuid,
  p_organization_id uuid,
  p_occurred_at timestamptz,
  p_evidence text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer_user_id is null or p_professional_id is null or p_organization_id is null then
    return;
  end if;

  insert into public.customer_professional_relationships (
    customer_user_id, professional_id, organization_id,
    first_completed_at, last_completed_at, completed_interaction_count, established_by
  )
  values (
    p_customer_user_id, p_professional_id, p_organization_id,
    coalesce(p_occurred_at, now()), coalesce(p_occurred_at, now()), 1, p_evidence
  )
  on conflict (customer_user_id, professional_id, organization_id) do update
  set first_completed_at = least(
        public.customer_professional_relationships.first_completed_at,
        excluded.first_completed_at),
      last_completed_at = greatest(
        public.customer_professional_relationships.last_completed_at,
        excluded.last_completed_at),
      completed_interaction_count =
        public.customer_professional_relationships.completed_interaction_count + 1;
  -- established_by is deliberately not updated: it records what FIRST
  -- established the relationship.
end;
$$;

comment on function private.record_service_relationship(uuid, uuid, uuid, timestamptz, text) is
  'The single write path for completed-service relationships. Upsert on the (customer, professional, organization) key; keeps the earliest first_completed_at and the latest last_completed_at, and preserves the original established_by.';

-- ---------------------------------------------------------------------------
-- 5. Completion triggers
--
-- SECURITY DEFINER is REQUIRED, not stylistic. Queue completion is not an
-- RPC — apps/web/src/lib/queries/queue.ts issues a raw PostgREST PATCH as
-- role `authenticated`, which has no write access here and is subject to
-- FORCE RLS. An invoker-rights trigger would raise 42501, abort the PATCH,
-- and a barber could not mark a client done.
--
-- INSERT OR UPDATE, because a completed row can be inserted directly (a
-- manager via PostgREST), not only transitioned into.
--
-- FAILURE CONTAINMENT, STATED ACCURATELY. Early returns cover expected
-- misses; the exception block covers ordinary errors — deadlock,
-- serialization failure, FK races, constraint violations. It does NOT cover
-- QUERY_CANCELED or ASSERT_FAILURE, which PL/pgSQL's OTHERS deliberately
-- excludes, so a statement_timeout still aborts the statement and with it the
-- completion. That is correct: a trigger must not swallow a cancellation.
--
-- Swallowing the rest is defensible HERE AND NOWHERE ELSE in this codebase
-- precisely because this table is rebuildable — see section 6. A dropped
-- aggregate row is recoverable; a rolled-back haircut is not. The warning
-- keeps it visible in logs rather than truly silent.
--
-- ATTRIBUTION is via booked_by_user_id only, never customer_id -> user_id.
-- See 20260824100200 for the attack that rule prevents.
-- ---------------------------------------------------------------------------

create or replace function public.appointments_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.booked_by_user_id is null or new.barber_id is null then
    return new;
  end if;

  if new.customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.user_id = new.booked_by_user_id
  ) then
    return new;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = new.barber_id;

  if v_professional_id is null then
    return new;
  end if;

  -- starts_at, not now(): the time the service happened, so a rebuild from
  -- source reproduces exactly the same value.
  perform private.record_service_relationship(
    new.booked_by_user_id, v_professional_id, new.organization_id,
    new.starts_at, 'appointment'
  );
  return new;

exception when others then
  raise warning 'appointments_relationship suppressed error for appointment %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists appointments_social_relationship on public.appointments;
create trigger appointments_social_relationship
  after insert or update on public.appointments
  for each row execute function public.appointments_relationship();

create or replace function public.queue_entries_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  -- queue_entries.barber_id is NULLABLE (an unassigned walk-in, or a barber
  -- row since deleted via ON DELETE SET NULL). No barber means no
  -- professional to relate to.
  if new.booked_by_user_id is null or new.barber_id is null then
    return new;
  end if;

  if new.customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.user_id = new.booked_by_user_id
  ) then
    return new;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = new.barber_id;

  if v_professional_id is null then
    return new;
  end if;

  -- coalesce(completed_at, updated_at) — the SAME expression the rebuild uses,
  -- so recomputing from source reproduces this row exactly rather than
  -- inventing a different timestamp for the same visit.
  perform private.record_service_relationship(
    new.booked_by_user_id, v_professional_id, new.organization_id,
    coalesce(new.completed_at, new.updated_at, now()), 'queue'
  );
  return new;

exception when others then
  raise warning 'queue_entries_relationship suppressed error for queue entry %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists queue_entries_social_relationship on public.queue_entries;
create trigger queue_entries_social_relationship
  after insert or update on public.queue_entries
  for each row execute function public.queue_entries_relationship();

-- ---------------------------------------------------------------------------
-- 6. Reconciliation
--
-- This is what makes "the triggers may safely swallow errors" a real
-- guarantee rather than an excuse. It recomputes the entire aggregate from
-- the source tables using exactly the same rules the triggers apply.
--
-- Platform-only. Not scheduled by R1 — no job infrastructure belongs in this
-- lot — but available for corrective use and for verification.
-- ---------------------------------------------------------------------------

create or replace function public.rebuild_customer_professional_relationships()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'rebuild_customer_professional_relationships is platform-only';
  end if;

  -- DELETE-then-recompute, not upsert-only. An upsert would leave behind rows
  -- whose evidence has since disappeared (an appointment moved off
  -- 'completed', a queue entry deleted), which would make this a "top up"
  -- rather than a rebuild — and the whole justification for letting the
  -- triggers swallow errors is that this function restores TRUTH.
  --
  -- It also corrects counter drift. The triggers increment by one per
  -- transition INTO a completed state, so a row that flaps
  -- completed -> waiting -> completed counts twice for one real visit. That
  -- is a deliberate trade (the trigger cannot cheaply know whether it has
  -- already counted a given row), and this function is the authoritative
  -- correction: it counts evidence rows, not transitions.
  delete from public.customer_professional_relationships r
  where not exists (
    select 1 from public.appointments a
    join public.customers c on c.id = a.customer_id and c.user_id = a.booked_by_user_id
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id = r.customer_user_id
      and b.professional_id = r.professional_id
      and a.organization_id = r.organization_id
  )
  and not exists (
    select 1 from public.queue_entries q
    join public.customers c on c.id = q.customer_id and c.user_id = q.booked_by_user_id
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id = r.customer_user_id
      and b.professional_id = r.professional_id
      and q.organization_id = r.organization_id
  );

  with evidence as (
    select a.booked_by_user_id as customer_user_id,
           b.professional_id,
           a.organization_id,
           a.starts_at as occurred_at,
           'appointment' as evidence_kind
    from public.appointments a
    join public.customers c on c.id = a.customer_id and c.user_id = a.booked_by_user_id
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id is not null
      and b.professional_id is not null

    union all

    select q.booked_by_user_id,
           b.professional_id,
           q.organization_id,
           coalesce(q.completed_at, q.updated_at),
           'queue'  -- same expression as queue_entries_relationship()
    from public.queue_entries q
    join public.customers c on c.id = q.customer_id and c.user_id = q.booked_by_user_id
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id is not null
      and b.professional_id is not null
  ),
  aggregated as (
    select customer_user_id, professional_id, organization_id,
           min(occurred_at) as first_completed_at,
           max(occurred_at) as last_completed_at,
           count(*)::integer as completed_interaction_count,
           (array_agg(evidence_kind order by occurred_at asc))[1] as established_by
    from evidence
    group by customer_user_id, professional_id, organization_id
  ),
  upserted as (
    insert into public.customer_professional_relationships (
      customer_user_id, professional_id, organization_id,
      first_completed_at, last_completed_at, completed_interaction_count, established_by
    )
    select * from aggregated
    on conflict (customer_user_id, professional_id, organization_id) do update
    set first_completed_at = excluded.first_completed_at,
        last_completed_at = excluded.last_completed_at,
        completed_interaction_count = excluded.completed_interaction_count,
        established_by = excluded.established_by
    returning 1
  )
  select count(*)::integer into v_rows from upserted;

  return v_rows;
end;
$$;

comment on function public.rebuild_customer_professional_relationships() is
  'Platform-only. Recomputes every completed-service relationship from appointments/queue_entries using the same rules as the completion triggers. This is the recovery path that makes it safe for those triggers to swallow errors rather than roll back a booking or a queue completion.';

revoke execute on function public.rebuild_customer_professional_relationships() from public, anon;
grant execute on function public.rebuild_customer_professional_relationships() to authenticated;
