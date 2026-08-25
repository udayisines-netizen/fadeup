-- FadeUp — R1: publishable social proof
-- Migration: professional_client_showcases
--
-- RELATIONSHIP TRUTH IS NOT PERMISSION TO PUBLISH IT.
--
-- That a customer genuinely used a barber, and that the customer is verified,
-- says nothing about whether the barber may advertise it. "Already cutting
-- <public figure> ✓" requires a third, separate fact: the customer said yes.
-- This table is that fact and nothing else.
--
-- WHO MAY DO WHAT
--
--   professional -> may INSERT a request, always as 'pending', nothing else
--   customer     -> the ONLY party who may move consent
--   nobody       -> may DELETE
--
-- The professional having no DELETE is not an oversight. With DELETE, a
-- 'declined' or 'revoked' row is reset by delete-then-reinsert, and the
-- customer can be re-solicited indefinitely — consent bypass by attrition.
-- For the same reason 'revoked' is terminal in the transition guard.
--
-- WHY relationship_id ALONE IS NOT ENOUGH
--
-- A NOT NULL FK proves that SOME relationship row exists. It does not prove
-- that THIS one binds THIS professional to THIS customer. Since RLS WITH
-- CHECK is evaluated against client-supplied values, a professional could
-- otherwise attach any relationship UUID they have ever seen — including one
-- from a completely different pair — and the "genuineness is a foreign key"
-- guarantee would be worthless. guard_showcase_binding() closes that: the
-- referenced relationship must name the same professional AND the same
-- customer AND record at least one completed interaction.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. professional_client_showcases
-- ---------------------------------------------------------------------------

create table if not exists public.professional_client_showcases (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  customer_user_id uuid not null references auth.users (id) on delete cascade,

  -- NOT NULL: a showcase cannot exist without a real completed-service
  -- relationship. Bound to the right parties by guard_showcase_binding().
  relationship_id uuid not null
    references public.customer_professional_relationships (id) on delete cascade,

  consent_state text not null default 'pending',

  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_client_showcases_unique unique (professional_id, customer_user_id),
  constraint professional_client_showcases_consent_valid
    check (consent_state in ('pending', 'approved', 'declined', 'revoked'))
);

comment on table public.professional_client_showcases is
  'Consent to publish a customer<->professional relationship as social proof. Relationship TRUTH lives in customer_professional_relationships; this table is only PERMISSION. A showcase is publishable when consent is approved, the customer''s public profile is public, and the underlying relationship is genuine.';

-- The public projection reads approved rows for one professional.
create index if not exists professional_client_showcases_professional_approved_idx
  on public.professional_client_showcases (professional_id) where consent_state = 'approved';

-- The customer's consent inbox.
create index if not exists professional_client_showcases_customer_pending_idx
  on public.professional_client_showcases (customer_user_id) where consent_state = 'pending';

-- FK maintenance.
create index if not exists professional_client_showcases_relationship_idx
  on public.professional_client_showcases (relationship_id);

drop trigger if exists professional_client_showcases_set_updated_at on public.professional_client_showcases;
create trigger professional_client_showcases_set_updated_at
  before update on public.professional_client_showcases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Binding guard
-- ---------------------------------------------------------------------------

create or replace function public.guard_showcase_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.customer_professional_relationships r
    where r.id = new.relationship_id
      and r.professional_id = new.professional_id
      and r.customer_user_id = new.customer_user_id
      and r.completed_interaction_count >= 1
  ) then
    raise exception 'showcase relationship must name the same professional and customer and record a completed service';
  end if;
  return new;
end;
$$;

comment on function public.guard_showcase_binding() is
  'BEFORE INSERT OR UPDATE: the referenced relationship must bind exactly this professional and this customer, with at least one completed interaction. Without this, a NOT NULL FK proves only that some relationship exists somewhere.';

drop trigger if exists professional_client_showcases_binding on public.professional_client_showcases;
create trigger professional_client_showcases_binding
  before insert or update on public.professional_client_showcases
  for each row execute function public.guard_showcase_binding();

-- ---------------------------------------------------------------------------
-- 3. Consent transition guard
--
-- Only the customer moves consent. Legal transitions:
--
--   pending  -> approved | declined
--   declined -> approved            (a customer may change their mind)
--   approved -> revoked
--   revoked  -> (nothing)           terminal
-- ---------------------------------------------------------------------------

create or replace function public.guard_showcase_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if new.consent_state is not distinct from old.consent_state then
    return new;
  end if;

  v_actor := (select auth.uid());

  -- Server-side paths (migrations, definer RPCs) and platform admins are
  -- allowed through; every ordinary session must be the customer.
  if v_actor is not null and not (select private.is_platform_admin())
     and v_actor <> new.customer_user_id then
    raise exception 'only the customer may decide whether a relationship is published';
  end if;

  if old.consent_state = 'revoked' then
    raise exception 'a revoked showcase is terminal and cannot be re-opened';
  end if;

  if not (
    (old.consent_state = 'pending'  and new.consent_state in ('approved', 'declined'))
    or (old.consent_state = 'declined' and new.consent_state = 'approved')
    or (old.consent_state = 'approved' and new.consent_state = 'revoked')
  ) then
    raise exception 'illegal showcase consent transition: % -> %', old.consent_state, new.consent_state;
  end if;

  new.decided_at := now();
  if new.consent_state = 'revoked' then
    new.revoked_at := now();
  end if;

  return new;
end;
$$;

comment on function public.guard_showcase_consent() is
  'BEFORE UPDATE: only the customer (or a platform admin, or a server-side path) may move consent_state, and only along legal transitions. revoked is terminal — combined with the absence of any DELETE policy, this is what stops a professional re-soliciting a customer who already said no.';

drop trigger if exists professional_client_showcases_consent on public.professional_client_showcases;
create trigger professional_client_showcases_consent
  before update on public.professional_client_showcases
  for each row execute function public.guard_showcase_consent();

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- Per-command policies are mandatory here. A single FOR ALL policy would let
-- the professional update consent, which is the entire thing this table
-- exists to prevent.
-- ---------------------------------------------------------------------------

alter table public.professional_client_showcases enable row level security;
alter table public.professional_client_showcases force row level security;

drop policy if exists professional_client_showcases_select on public.professional_client_showcases;
create policy professional_client_showcases_select
  on public.professional_client_showcases
  for select
  to authenticated
  using (
    customer_user_id = (select auth.uid())
    or exists (
      select 1 from public.professionals p
      where p.id = professional_client_showcases.professional_id
        and p.user_id = (select auth.uid())
    )
    or (select private.is_platform_admin())
  );

-- The professional may only ever ASK.
drop policy if exists professional_client_showcases_insert on public.professional_client_showcases;
create policy professional_client_showcases_insert
  on public.professional_client_showcases
  for insert
  to authenticated
  with check (
    consent_state = 'pending'
    and decided_at is null
    and revoked_at is null
    and exists (
      select 1 from public.professionals p
      where p.id = professional_client_showcases.professional_id
        and p.user_id = (select auth.uid())
    )
  );

-- Only the customer may answer.
drop policy if exists professional_client_showcases_update on public.professional_client_showcases;
create policy professional_client_showcases_update
  on public.professional_client_showcases
  for update
  to authenticated
  using (customer_user_id = (select auth.uid()))
  with check (customer_user_id = (select auth.uid()));

-- Deliberately NO delete policy for anyone. See the header.

-- The professional must not be able to pre-set decision fields on insert, and
-- the customer must not rewrite the binding. Table-level revoke then re-grant,
-- because a column-level revoke cannot subtract from the blanket grant.
revoke insert, update, delete on public.professional_client_showcases from authenticated, anon;
grant insert (professional_id, customer_user_id, relationship_id, consent_state)
  on public.professional_client_showcases to authenticated;
grant update (consent_state)
  on public.professional_client_showcases to authenticated;
