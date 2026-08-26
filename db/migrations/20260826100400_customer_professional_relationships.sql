-- FadeUp — R1B: the relationship aggregate
--
-- FOLLOWER IS NOT VERIFIED CLIENT. Constitution §3.2 makes that a hard
-- invariant, and the way to keep an invariant is to give the two facts
-- different sources of truth rather than different filters over one.
--
--   professional_follows                 intent. "I want to see this person."
--   customer_professional_relationships  fact.   "This person served me."
--
-- Neither derives from the other, and nothing in this file reads the follow
-- graph.
--
-- WHY THIS ONE IS MATERIALIZED WHEN FOLLOWER COUNTS ARE NOT
--
-- A follower count is one indexed count over one table; computing it is
-- cheaper than keeping it correct. "Every customer this professional has
-- served, at this shop, with first and last service time" is a grouped join
-- across two evidence tables, read on profile and CRM surfaces. So it is
-- materialized — and because it is, it must be rebuildable, which is what
-- reconcile_customer_professional_relationships() below is for.
--
-- WHY DUPLICATE DELIVERY CANNOT INFLATE THE COUNTER
--
-- Not because the writer is careful. Because R1A made 'completed' TERMINAL for
-- every caller including service_role — enforce_appointment_transition() raises
-- 22023 on any move out of it. A row can therefore ENTER 'completed' exactly
-- once in its lifetime, and the trigger below fires only on that entry. A
-- retried statement re-raises on the transition guard before it ever reaches
-- this trigger.
--
-- Concurrency is handled by ON CONFLICT DO UPDATE, which takes a row lock: two
-- appointments for the same (customer, professional, org) completing at the
-- same instant serialize on the unique index, and both increments land. There
-- is no read-modify-write anywhere.
--
-- WHY THIS TABLE IS TENANT-SCOPED WHEN THE OTHERS ARE NOT
--
-- professionals and the follow edge are deliberately platform-scoped (argued
-- in 20260826100000). This one is different: "customer X was served by
-- professional Y AT SHOP Z" is a statement about a shop's business, so
-- organization_id is NOT NULL, sits in the unique key, is immutable, and is the
-- RLS anchor. A professional working at two shops produces two rows, and shop A
-- cannot read shop B's.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   No verified-client column. Verified-client is a PREDICATE over this table,
--   never stored — storing it would let the two drift.
--   No public count. TARGET_DOMAIN_MODEL §6.2 withdrew it: restricted to
--   self-booked evidence it measures customer signup behaviour, not craft.
--   No publication consent. Truth is not permission (Constitution §4.1), and
--   the showcase that carries permission is R6/R7's, scoped per organization
--   so it cannot travel with a professional to a new shop.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The aggregate
-- ---------------------------------------------------------------------------

create table if not exists public.customer_professional_relationships (
  id uuid primary key default gen_random_uuid(),

  -- The ACCOUNT. Same rule as the follow edge: never customers.user_id, which
  -- R1A demoted from evidence to bridge.
  -- ON DELETE CASCADE — this is a derived view of a person's activity, and it
  -- is rebuildable from appointments/queue_entries, which survive erasure.
  customer_user_id uuid not null references auth.users (id) on delete cascade,

  -- ON DELETE CASCADE, chosen not inherited: the row is fully rebuildable by
  -- reconciliation, so RESTRICT here would add a second deletion dead-end
  -- (barbers.professional_id already RESTRICTs) to protect data that is not
  -- itself evidence. The evidence is on appointments and queue_entries.
  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- The tenant anchor. CASCADE matches every other tenant-scoped table: when a
  -- shop is deleted its business records go with it.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  completed_interaction_count integer not null default 0
    check (completed_interaction_count >= 0),

  first_completed_at timestamptz not null,
  last_completed_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_professional_relationships_unique
    unique (customer_user_id, professional_id, organization_id),

  constraint customer_professional_relationships_ordered
    check (first_completed_at <= last_completed_at)
);

comment on table public.customer_professional_relationships is
  'Materialized truth about services that ACTUALLY HAPPENED: one row per (customer account, professional, organization). Never derived from and never feeding the follow graph — Constitution §3.2. Rebuildable in full by reconcile_customer_professional_relationships(), which is what makes materialization safe. Verified-client is a predicate over this table and is deliberately not a column.';

comment on column public.customer_professional_relationships.customer_user_id is
  'The account that itself booked or checked in, taken from booked_by_user_id. Never customers.user_id: that column is a per-shop CRM bridge that was squattable before R1A and remains staff-adjacent, so it can never establish a fact about a customer.';

comment on column public.customer_professional_relationships.completed_interaction_count is
  'Completed services with a TRUSTWORTHY completion time. Pre-R1A rows whose completed_at is NULL are excluded rather than counted with an invented timestamp — R1A recorded unknown as unknown and this table does not undo that.';

-- Verified-client count for one professional (private to them and platform).
create index if not exists customer_professional_relationships_professional_idx
  on public.customer_professional_relationships (professional_id);

-- The org read path: "our clients, most recent first".
create index if not exists customer_professional_relationships_org_recent_idx
  on public.customer_professional_relationships (organization_id, last_completed_at desc);

-- The customer's own read path.
create index if not exists customer_professional_relationships_customer_idx
  on public.customer_professional_relationships (customer_user_id);

drop trigger if exists customer_professional_relationships_set_updated_at
  on public.customer_professional_relationships;
create trigger customer_professional_relationships_set_updated_at
  before update on public.customer_professional_relationships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The identity of a relationship is immutable
--
-- There is no client write path at all, so this guards service_role and direct
-- SQL — the same reasoning R1A used for the appointment transition guard. A
-- relationship that could be repointed at a different customer or a different
-- shop would be a forgery primitive for exactly the "already cutting X" claim
-- this table will eventually support.
-- ---------------------------------------------------------------------------

create or replace function public.guard_customer_professional_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id is distinct from old.professional_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'the identity of a relationship is immutable; reconcile instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_customer_professional_relationship() is
  'BEFORE UPDATE invariant: a relationship row can never be repointed at a different customer, professional or organization. No role is exempt. Corrections happen by reconciliation, which recomputes from evidence rather than editing conclusions.';

drop trigger if exists customer_professional_relationships_guard
  on public.customer_professional_relationships;
create trigger customer_professional_relationships_guard
  before update on public.customer_professional_relationships
  for each row execute function public.guard_customer_professional_relationship();

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- SELECT: the customer (their own history), the professional (their own book
--   of clients), members of THAT organization (their own CRM), platform.
--   Note the organization arm is anchored on this row's organization_id, so a
--   professional's shop A cannot see the row they earned at shop B.
--
-- INSERT / UPDATE / DELETE: no policy. Trigger-maintained, exactly like the
--   follow edge.
-- ---------------------------------------------------------------------------

alter table public.customer_professional_relationships enable row level security;
alter table public.customer_professional_relationships force row level security;

revoke all on public.customer_professional_relationships from anon, authenticated;
grant select on public.customer_professional_relationships to authenticated;

drop policy if exists customer_professional_relationships_select
  on public.customer_professional_relationships;
create policy customer_professional_relationships_select
  on public.customer_professional_relationships
  for select
  to authenticated
  using (
    customer_user_id = (select auth.uid())
    or (select private.is_platform_admin())
    -- Through the definer helper, not an inline subquery: professionals.user_id
    -- is withheld from client SELECT, and a policy that reads another table
    -- does so with the CALLER's privileges — so the inline form raises 42501
    -- instead of returning false.
    or (select private.is_own_professional(public.customer_professional_relationships.professional_id))
    or (select private.is_org_member(public.customer_professional_relationships.organization_id))
  );

-- ---------------------------------------------------------------------------
-- 4. Maintenance
-- ---------------------------------------------------------------------------

create or replace function private.record_completed_interaction(
  p_customer_user_id uuid,
  p_barber_id uuid,
  p_organization_id uuid,
  p_completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional_id uuid;
begin
  -- Every one of these is a refusal to invent evidence, not a defensive
  -- shrug: no account attribution, no professional, or no trustworthy
  -- completion time each mean the fact cannot be stated honestly.
  if p_customer_user_id is null or p_barber_id is null or p_completed_at is null then
    return;
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b
  where b.id = p_barber_id;

  if v_professional_id is null then
    return;
  end if;

  insert into public.customer_professional_relationships (
    customer_user_id, professional_id, organization_id,
    completed_interaction_count, first_completed_at, last_completed_at
  )
  values (p_customer_user_id, v_professional_id, p_organization_id, 1, p_completed_at, p_completed_at)
  on conflict (customer_user_id, professional_id, organization_id) do update
    set completed_interaction_count =
          public.customer_professional_relationships.completed_interaction_count + 1,
        first_completed_at =
          least(public.customer_professional_relationships.first_completed_at, excluded.first_completed_at),
        last_completed_at =
          greatest(public.customer_professional_relationships.last_completed_at, excluded.last_completed_at);
end;
$$;

comment on function private.record_completed_interaction(uuid, uuid, uuid, timestamptz) is
  'Concurrency-safe increment via ON CONFLICT DO UPDATE — a row lock, never a read-modify-write. least()/greatest() mean out-of-order arrival cannot corrupt the window. Silently declines to record when attribution, professional or completion time is missing, because the alternative is asserting a service happened on evidence that does not say so.';

revoke execute on function private.record_completed_interaction(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.appointments_record_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Entry into 'completed' only, and R1A makes that state terminal, so this
  -- fires at most once in a row's lifetime.
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.record_completed_interaction(
    new.booked_by_user_id, new.barber_id, new.organization_id, new.completed_at
  );
  return null;
end;
$$;

comment on function public.appointments_record_relationship() is
  'AFTER INSERT OR UPDATE on appointments. Records a completed service exactly once, using completed_at — which R1A made server-stamped and unforgeable — and booked_by_user_id, the only account attribution a shop cannot fabricate.';

drop trigger if exists appointments_record_relationship on public.appointments;
create trigger appointments_record_relationship
  after insert or update of status on public.appointments
  for each row execute function public.appointments_record_relationship();

create or replace function public.queue_entries_record_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.record_completed_interaction(
    new.booked_by_user_id, new.barber_id, new.organization_id, new.completed_at
  );
  return null;
end;
$$;

comment on function public.queue_entries_record_relationship() is
  'AFTER INSERT OR UPDATE on queue_entries. A served walk-in is a completed service (Constitution §3.3). queue_entries.completed_at is server-stamped by the R1A queue guard, so the browser can no longer choose it.';

drop trigger if exists queue_entries_record_relationship on public.queue_entries;
create trigger queue_entries_record_relationship
  after insert or update of status on public.queue_entries
  for each row execute function public.queue_entries_record_relationship();

-- ---------------------------------------------------------------------------
-- 5. Reconciliation
--
-- The counters are materialized, so there must be a way to prove them right
-- and to repair them. This recomputes from the evidence tables and replaces
-- the aggregate — recomputation rather than restore, which is why
-- MIGRATION_STRATEGY §9 can say R1B contains no irreversible transformation.
--
-- One statement, three data-modifying CTEs. They share a snapshot and their
-- targets are disjoint by construction: `removed` only touches rows the
-- evidence does NOT support, `written` only touches rows it does. Scope is
-- applied identically to both, so a per-professional run cannot reach anyone
-- else's aggregate.
--
-- Platform staff only: this is administrative repair, not a product feature.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_customer_professional_relationships(
  p_professional_id uuid default null
)
returns table (rows_written bigint, rows_removed bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can reconcile relationships'
      using errcode = '42501';
  end if;

  return query
  with evidence as (
    select a.booked_by_user_id as customer_user_id, b.professional_id,
           a.organization_id, a.completed_at
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id is not null
      and a.completed_at is not null
      and b.professional_id is not null

    union all

    select q.booked_by_user_id, b.professional_id, q.organization_id, q.completed_at
    from public.queue_entries q
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id is not null
      and q.completed_at is not null
      and b.professional_id is not null
  ),
  truth as (
    select e.customer_user_id, e.professional_id, e.organization_id,
           count(*)::integer as completed_interaction_count,
           min(e.completed_at) as first_completed_at,
           max(e.completed_at) as last_completed_at
    from evidence e
    where p_professional_id is null or e.professional_id = p_professional_id
    group by e.customer_user_id, e.professional_id, e.organization_id
  ),
  removed as (
    -- The WHERE stays on this line deliberately: the MASTER generator refuses
    -- any `delete from` whose line carries no WHERE, and that guard is worth
    -- more than the formatting.
    delete from public.customer_professional_relationships r where true
      and (p_professional_id is null or r.professional_id = p_professional_id)
      and not exists (
        select 1 from truth t
        where t.customer_user_id = r.customer_user_id
          and t.professional_id = r.professional_id
          and t.organization_id = r.organization_id
      )
    returning 1
  ),
  written as (
    insert into public.customer_professional_relationships (
      customer_user_id, professional_id, organization_id,
      completed_interaction_count, first_completed_at, last_completed_at
    )
    select t.customer_user_id, t.professional_id, t.organization_id,
           t.completed_interaction_count, t.first_completed_at, t.last_completed_at
    from truth t
    on conflict (customer_user_id, professional_id, organization_id) do update
      set completed_interaction_count = excluded.completed_interaction_count,
          first_completed_at = excluded.first_completed_at,
          last_completed_at = excluded.last_completed_at
    returning 1
  )
  select (select count(*) from written), (select count(*) from removed);
end;
$$;

comment on function public.reconcile_customer_professional_relationships(uuid) is
  'Platform-only. Recomputes the relationship aggregate from appointments and queue_entries and replaces it, so a materialized counter can always be proven against its evidence. Excludes completed rows with NULL completed_at: R1A left those genuinely unknown and reconciliation does not invent them.';

revoke execute on function public.reconcile_customer_professional_relationships(uuid) from public, anon;
grant execute on function public.reconcile_customer_professional_relationships(uuid) to authenticated;
