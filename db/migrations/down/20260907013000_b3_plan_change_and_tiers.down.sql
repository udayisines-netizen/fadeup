-- FadeUp — B3 : retour arrière de 20260907013000_b3_plan_change_and_tiers.sql.
--
-- Supprime les RPC de facturation et le balayage des paliers, retire le
-- gabarit d'annonce, et restaure enforce_establishment_capacity à sa
-- définition R2 — celle qui refuse tout dépassement, famille multi_salon
-- comprise. Les demandes de devis déjà écrites vivent dans
-- billing_quote_requests, dont le sort appartient au retour arrière du
-- chantier 1.

set lock_timeout = '5s';

begin;

drop function if exists public.request_billing_quote(uuid, integer, text);
drop function if exists public.run_establishment_tier_maintenance();
drop function if exists public.request_billing_cancellation(uuid);
drop function if exists public.request_plan_change(uuid, text, public.stripe_billing_interval);
drop function if exists public.prepare_billing_portal(uuid);
drop function if exists public.record_billing_customer(uuid, text);
drop function if exists public.prepare_billing_checkout(uuid, text, public.stripe_billing_interval);
drop function if exists private.assert_billing_owner(uuid);

delete from public.email_templates where template_key = 'tier_switch_notice';

-- enforce_establishment_capacity : la définition R2, à l'identique.
create or replace function public.enforce_establishment_capacity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plan text;
  v_max integer;
  v_used integer;
begin
  -- An inactive location consumes no capacity, so creating one is always
  -- allowed. It also cannot be a bypass: switching it on later comes back
  -- through this same trigger on UPDATE.
  if not new.is_active then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only two kinds of UPDATE are capacity events: switching a location back
    -- on, and moving it to a different organization (which no code path does,
    -- but an unchecked one would be a way to smuggle capacity between tenants).
    if old.is_active and new.organization_id = old.organization_id then
      return new;
    end if;
  end if;

  -- Guarantee the row that is about to be locked exists. In every normal path
  -- it already does — organizations get commercial state on insert and the R2
  -- backfill covered the rest — so this is the safety net for a restore or a
  -- future code path, and it creates the most restrictive plan, never a
  -- permissive one.
  perform private.ensure_organization_commercial_state(new.organization_id);

  -- THE MUTEX. Everything after this line is serialised per organization.
  perform 1
  from public.organization_commercial_state s
  where s.organization_id = new.organization_id
  for update;

  v_plan := private.effective_plan_key(new.organization_id);

  select p.max_establishments into v_max
  from public.commercial_plans p
  where p.plan_key = v_plan;

  if v_max is null then
    -- No commercial state, or a plan that is not in the catalogue. Fail closed:
    -- an unresolvable plan must never be read as "unlimited".
    raise exception 'cannot create an establishment: the organization has no resolvable commercial plan'
      using errcode = 'P0001',
            hint = 'Every organization must have a row in organization_commercial_state naming a plan that exists in commercial_plans.';
  end if;

  -- The row being inserted (or reactivated) is not yet part of this count: on
  -- INSERT it does not exist, and on the reactivation path it is still
  -- is_active = false in the table. So the question is always "does one more
  -- fit".
  v_used := private.org_active_establishments(new.organization_id);

  if v_used + 1 > v_max then
    raise exception
      'the % plan covers % active establishment(s); this organization already operates %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Multi-salons plan to operate more establishments. Existing establishments are never removed to satisfy a plan.';
  end if;

  return new;
end;
$$;

commit;
