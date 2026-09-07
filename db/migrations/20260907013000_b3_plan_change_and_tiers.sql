-- FadeUp — B3, chantiers 3, 5 et 6 : souscription, changement de plan,
-- annuel, paliers multi-établissements.
--
-- OÙ VIT LA GARDE D'ACCÈS
--
-- « Le propriétaire uniquement. Ni manager, ni réceptionniste, ni barber. »
-- La décision est appliquée ICI, dans chaque RPC, côté serveur. La fonction
-- Edge stripe-billing ne fait que des entrées-sorties Stripe : elle appelle
-- d'abord ces RPC avec le jeton DE L'APPELANT, et un manager qui l'appelle —
-- ou qui appelle PostgREST directement — est refusé par le même code, sans
-- chemin de contournement. La RLS d'organization_billing (owner-only) ferme
-- aussi la lecture.
--
-- CHECKOUT PLUTÔT QUE PAYMENT ELEMENT — TRANCHÉ
--
-- Stripe Checkout, parce qu'il livre pour zéro ligne de code à maintenir :
-- la TVA (Stripe Tax + collecte du numéro intracommunautaire), le SCA/3DS,
-- les échecs de carte, les moyens de paiement locaux, les factures. Payment
-- Element donnerait la maîtrise du pixel au prix de re-livrer tout ça — un
-- coût que rien dans le MASTER_SPEC ne justifie pour un écran de facturation.
-- Le portail client Stripe couvre de même : moyen de paiement, factures,
-- résiliation.
--
-- CHANGEMENT DE PLAN — LES RÈGLES, TELLES QUE TRANCHÉES
--
--   montée en gamme          immédiate, proratisée par Stripe
--   passage mensuel -> annuel immédiat, proratisé (recommandation B3 adoptée)
--   descente de gamme        à la FIN de la période payée, sans proratisation
--   retour annuel -> mensuel  à l'échéance annuelle seulement
--
-- Un remboursement au prorata sur un annuel serait une porte ouverte à
-- l'abus : payer l'annuel (deux mois offerts), profiter, redescendre au
-- mensuel remboursé. Le retour à l'échéance ferme cette porte.
--
-- Une descente infaisable — huit barbers vers `solo`, trois établissements
-- vers un plan qui en couvre un — est REFUSÉE avec un motif exploitable par
-- l'interface. Les données ne bougent jamais pour satisfaire un plan.
--
-- PALIERS MULTI-ÉTABLISSEMENTS
--
-- Le palier est déterminé par le nombre d'établissements ACTIFS. Le
-- franchissement est : détecté par balayage dédié, appliqué à la période
-- suivante (jamais rétroactif), et ANNONCÉ par e-mail avant d'être facturé.
-- Un établissement au-delà du palier payé n'est JAMAIS bloqué — la garde de
-- capacité R2 apprend ici à laisser grandir une organisation multi_salon, et
-- le balayage programme la bascule. Au-delà du palier haut : une demande de
-- devis s'ouvre, pas un mur.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. La garde commune : propriétaire, et personne d'autre
-- ---------------------------------------------------------------------------

create or replace function private.assert_billing_owner(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'billing requires an authenticated session'
      using errcode = '42501';
  end if;

  -- Propriétaire UNIQUEMENT — pas manager, pas réceptionniste, pas barber,
  -- et pas non plus le staff plateforme : la facturation d'une organisation
  -- n'appartient qu'à elle.
  if not (select private.has_org_role(p_organization_id, array['owner']::public.membership_role[])) then
    raise exception 'only the organization owner may manage billing'
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.assert_billing_owner(uuid) is
'LA garde de facturation, appelée en tête de chaque RPC billing. Elle vit côté serveur : un manager qui appelle l''API directement — PostgREST ou fonction Edge — est refusé ici, pas par l''interface.';

revoke all on function private.assert_billing_owner(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Préparer une souscription (Checkout)
-- ---------------------------------------------------------------------------

create or replace function public.prepare_billing_checkout(
  p_organization_id uuid,
  p_plan_key text,
  p_interval public.stripe_billing_interval default 'month'
)
returns table (
  organization_id uuid,
  organization_name text,
  stripe_customer_id text,
  stripe_price_id text,
  owner_email text,
  livemode boolean
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plan public.commercial_plans;
  v_price text;
  v_used_est integer;
  v_used_pro integer;
  v_sub_status text;
begin
  perform private.assert_billing_owner(p_organization_id);

  select * into v_plan from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available and p.price_minor > 0;

  if v_plan.plan_key is null then
    raise exception 'unknown, unavailable or non-payable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023';
  end if;

  -- Un abonnement vivant ne se double pas : on en change.
  select b.subscription_status into v_sub_status
  from public.organization_billing b
  where b.organization_id = p_organization_id;

  if v_sub_status in ('active', 'trialing', 'past_due') then
    raise exception 'this organization already has a subscription — use request_plan_change or the customer portal'
      using errcode = 'P0001';
  end if;

  -- La faisabilité, AVANT le paiement : souscrire un plan qui ne couvre pas
  -- l'activité réelle produirait une organisation en infraction dès la
  -- première seconde.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  if v_used_est > v_plan.max_establishments then
    raise exception 'cannot subscribe to %: it covers % establishment(s) and this organization operates %',
      p_plan_key, v_plan.max_establishments, v_used_est
      using errcode = 'P0001',
            hint = 'Pick a Multi-salons tier that covers every active establishment.';
  end if;

  if v_plan.max_operational_professionals is not null
     and v_used_pro > v_plan.max_operational_professionals then
    raise exception 'cannot subscribe to %: it covers % professional(s) and this organization rosters %',
      p_plan_key, v_plan.max_operational_professionals, v_used_pro
      using errcode = 'P0001',
            hint = 'Pick a plan that covers the whole team — team size is included in shop plans.';
  end if;

  select sp.stripe_price_id into v_price
  from public.billing_stripe_prices sp
  where sp.plan_key = p_plan_key
    and sp.billing_interval = p_interval
    and sp.livemode = private.billing_livemode()
    and sp.is_active;

  if v_price is null then
    raise exception 'no active Stripe price for % / % — run the catalog sync first', p_plan_key, p_interval
      using errcode = 'P0001';
  end if;

  return query
  select
    p_organization_id,
    o.name,
    b.stripe_customer_id,
    v_price,
    (select r.email from private.org_owner_recipient(p_organization_id) r),
    private.billing_livemode()
  from public.organizations o
  left join public.organization_billing b on b.organization_id = o.id
  where o.id = p_organization_id;
end;
$$;

comment on function public.prepare_billing_checkout(uuid, text, public.stripe_billing_interval) is
'Autorise et prépare une session Stripe Checkout : propriétaire uniquement, plan payant disponible, faisabilité vérifiée AVANT paiement, prix résolu depuis billing_stripe_prices — jamais un montant passé en argument. La fonction Edge stripe-billing consomme ce retour pour créer la session.';

revoke all on function public.prepare_billing_checkout(uuid, text, public.stripe_billing_interval) from public, anon;
grant execute on function public.prepare_billing_checkout(uuid, text, public.stripe_billing_interval) to authenticated;

-- La fonction Edge écrit le client Stripe qu'elle vient de créer. SECURITY
-- DEFINER + garde propriétaire : le même appelant que le checkout, rien d'autre.
create or replace function public.record_billing_customer(
  p_organization_id uuid,
  p_stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform private.assert_billing_owner(p_organization_id);

  if p_stripe_customer_id is null or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'malformed Stripe customer id' using errcode = '22023';
  end if;

  insert into public.organization_billing (organization_id, stripe_customer_id, livemode)
  values (p_organization_id, p_stripe_customer_id, private.billing_livemode())
  on conflict (organization_id) do update
    set stripe_customer_id = coalesce(public.organization_billing.stripe_customer_id,
                                      excluded.stripe_customer_id);
end;
$$;

comment on function public.record_billing_customer(uuid, text) is
'Enregistre le client Stripe créé par la fonction Edge au moment du premier Checkout. Ne remplace jamais un client déjà lié — un identifiant client ne change pas de son plein gré.';

revoke all on function public.record_billing_customer(uuid, text) from public, anon;
grant execute on function public.record_billing_customer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Le portail client
-- ---------------------------------------------------------------------------

create or replace function public.prepare_billing_portal(p_organization_id uuid)
returns table (stripe_customer_id text, livemode boolean)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_customer text;
begin
  perform private.assert_billing_owner(p_organization_id);

  select b.stripe_customer_id into v_customer
  from public.organization_billing b
  where b.organization_id = p_organization_id;

  if v_customer is null then
    raise exception 'no Stripe customer for this organization yet — subscribe first'
      using errcode = 'P0001';
  end if;

  return query select v_customer, private.billing_livemode();
end;
$$;

comment on function public.prepare_billing_portal(uuid) is
'Autorise l''ouverture du portail client Stripe (moyen de paiement, factures, résiliation en libre-service) : propriétaire uniquement, même garde que tout le reste de la facturation.';

revoke all on function public.prepare_billing_portal(uuid) from public, anon;
grant execute on function public.prepare_billing_portal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Changement de plan
-- ---------------------------------------------------------------------------

create or replace function public.request_plan_change(
  p_organization_id uuid,
  p_new_plan_key text,
  p_new_interval public.stripe_billing_interval default 'month'
)
returns table (
  decision text,
  effective_at timestamptz,
  stripe_subscription_id text,
  stripe_subscription_item_id text,
  stripe_price_id text
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_billing public.organization_billing;
  v_new public.commercial_plans;
  v_current public.commercial_plans;
  v_price text;
  v_used_est integer;
  v_used_pro integer;
  v_upgrade boolean;
begin
  perform private.assert_billing_owner(p_organization_id);

  select * into v_billing from public.organization_billing b
  where b.organization_id = p_organization_id
  for update;

  if v_billing.stripe_subscription_id is null
     or v_billing.subscription_status not in ('active', 'trialing', 'past_due') then
    raise exception 'no live subscription to change — subscribe first'
      using errcode = 'P0001';
  end if;

  select * into v_new from public.commercial_plans p
  where p.plan_key = p_new_plan_key and p.is_available and p.price_minor > 0;

  if v_new.plan_key is null then
    raise exception 'unknown, unavailable or non-payable plan: %', coalesce(p_new_plan_key, '(null)')
      using errcode = '22023';
  end if;

  select * into v_current from public.commercial_plans p
  where p.plan_key = v_billing.plan_key;

  if v_new.plan_key = v_billing.plan_key and p_new_interval = v_billing.billing_interval then
    raise exception 'the organization is already on % (%)', p_new_plan_key, p_new_interval
      using errcode = 'P0001';
  end if;

  -- LA FAISABILITÉ, AVANT TOUT. Un refus est un motif, jamais une donnée
  -- cassée : rien n'a été écrit quand on lève ici.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  if v_used_est > v_new.max_establishments then
    raise exception 'cannot move to %: it covers % establishment(s) and this organization operates %',
      p_new_plan_key, v_new.max_establishments, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first, or pick a tier that covers them. FadeUp never removes an establishment to satisfy a plan change.';
  end if;

  if v_new.max_operational_professionals is not null
     and v_used_pro > v_new.max_operational_professionals then
    raise exception 'cannot move to %: it covers % professional(s) and this organization rosters %',
      p_new_plan_key, v_new.max_operational_professionals, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first — their identity, followers and history are preserved either way.';
  end if;

  select sp.stripe_price_id into v_price
  from public.billing_stripe_prices sp
  where sp.plan_key = p_new_plan_key
    and sp.billing_interval = p_new_interval
    and sp.livemode = private.billing_livemode()
    and sp.is_active;

  if v_price is null then
    raise exception 'no active Stripe price for % / %', p_new_plan_key, p_new_interval
      using errcode = 'P0001';
  end if;

  -- LA DIRECTION. Montée = prix mensuel supérieur, ou passage à l'annuel à
  -- plan égal ou supérieur. Tout le reste attend la fin de la période payée.
  v_upgrade :=
    v_new.price_minor > v_current.price_minor
    or (v_new.price_minor >= v_current.price_minor
        and p_new_interval = 'year' and v_billing.billing_interval = 'month');

  if v_upgrade then
    -- Immédiat. La fonction Edge applique chez Stripe avec proratisation ;
    -- le webhook subscription.updated mettra l'état à jour. Un programmé
    -- antérieur (une descente en attente) est annulé : la dernière décision
    -- du propriétaire gagne.
    update public.organization_billing
    set scheduled_plan_key = null, scheduled_interval = null,
        scheduled_effective_at = null, scheduled_dispatched_at = null,
        scheduled_reason = null
    where organization_id = p_organization_id;

    return query select
      'immediate'::text, now(),
      v_billing.stripe_subscription_id, v_billing.stripe_subscription_item_id, v_price;
  else
    -- Fin de période. Il a payé jusqu'au bout, il garde jusqu'au bout — une
    -- descente qui coupe une capacité déjà payée est un litige.
    update public.organization_billing
    set scheduled_plan_key = p_new_plan_key,
        scheduled_interval = p_new_interval,
        scheduled_effective_at = v_billing.current_period_end,
        scheduled_dispatched_at = null,
        scheduled_reason = 'owner_request'
    where organization_id = p_organization_id;

    return query select
      'scheduled'::text, v_billing.current_period_end,
      v_billing.stripe_subscription_id, v_billing.stripe_subscription_item_id, v_price;
  end if;
end;
$$;

comment on function public.request_plan_change(uuid, text, public.stripe_billing_interval) is
'Changement de plan : propriétaire uniquement, faisabilité vérifiée avant toute écriture (refus motivé, données intactes). Montée — et passage mensuel->annuel — immédiate avec proratisation Stripe ; descente — et retour annuel->mensuel — programmée à la fin de la période payée, transmise à Stripe par le balayage, sans proratisation.';

revoke all on function public.request_plan_change(uuid, text, public.stripe_billing_interval) from public, anon;
grant execute on function public.request_plan_change(uuid, text, public.stripe_billing_interval) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Résiliation
-- ---------------------------------------------------------------------------

create or replace function public.request_billing_cancellation(p_organization_id uuid)
returns table (stripe_subscription_id text, effective_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_billing public.organization_billing;
begin
  perform private.assert_billing_owner(p_organization_id);

  select * into v_billing from public.organization_billing b
  where b.organization_id = p_organization_id
  for update;

  if v_billing.stripe_subscription_id is null
     or v_billing.subscription_status not in ('active', 'trialing', 'past_due') then
    raise exception 'no live subscription to cancel' using errcode = 'P0001';
  end if;

  -- La fonction Edge pose cancel_at_period_end chez Stripe ; le webhook
  -- confirmera. À l'échéance : retour au Free — profil, réputation, relations
  -- et historique conservés. La suppression définitive est une procédure
  -- RGPD distincte, hors de ce chantier.
  return query select v_billing.stripe_subscription_id, v_billing.current_period_end;
end;
$$;

comment on function public.request_billing_cancellation(uuid) is
'Autorise la résiliation (propriétaire uniquement) : l''abonnement court jusqu''à la fin de la période payée, puis retour au Free avec tout l''historique conservé. Aussi disponible en libre-service dans le portail Stripe.';

revoke all on function public.request_billing_cancellation(uuid) from public, anon;
grant execute on function public.request_billing_cancellation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. La garde de capacité apprend les paliers
-- ---------------------------------------------------------------------------

-- Même fonction que R2, UN ajout : une organisation dont le plan effectif est
-- de la famille multi_salon n'est JAMAIS bloquée quand elle ajoute un
-- établissement au-delà de son palier — l'ajout déclenche la bascule (balayage
-- ci-dessous), il ne la refuse pas. Bloquer un client qui veut grandir est
-- l'inverse de ce qu'on vend. Les plans à établissement unique gardent le
-- refus R2 : passer de un à deux établissements est un changement de famille
-- de plan, pas une bascule de palier.
create or replace function public.enforce_establishment_capacity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plan text;
  v_family public.commercial_family;
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

  select p.max_establishments, p.commercial_family into v_max, v_family
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
    -- B3 : la famille multi_salon grandit toujours. Le dépassement déclenche
    -- la bascule de palier (annoncée avant d'être facturée, appliquée à la
    -- période suivante) ou la demande de devis au-delà du palier haut —
    -- run_establishment_tier_maintenance s'en charge au tick suivant.
    if v_family = 'multi_salon' then
      return new;
    end if;

    raise exception
      'the % plan covers % active establishment(s); this organization already operates %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Multi-salons plan to operate more establishments. Existing establishments are never removed to satisfy a plan.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Le gabarit d'annonce de bascule
-- ---------------------------------------------------------------------------

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html)
values
  ('tier_switch_notice', 'fr', 'transactional',
   'Votre palier Multi-salons évolue à la prochaine période',
   E'Bonjour {{owner_name}},\n\n{{organization_name}} opère désormais {{establishments}} établissements. À partir du {{effective_at_fr}}, votre abonnement passera au palier {{new_plan_name}} ({{new_price_eur}} € HT/{{interval_fr}}).\n\nRien ne change d''ici là : la période en cours reste au tarif payé, et aucun établissement n''est bloqué.\n\nDétails et gestion : {{billing_url}}\n\nL''équipe FadeUp',
   '<p>Bonjour {{owner_name}},</p><p><strong>{{organization_name}}</strong> opère désormais {{establishments}} établissements. À partir du <strong>{{effective_at_fr}}</strong>, votre abonnement passera au palier <strong>{{new_plan_name}}</strong> ({{new_price_eur}} € HT/{{interval_fr}}).</p><p>Rien ne change d''ici là : la période en cours reste au tarif payé, et aucun établissement n''est bloqué.</p><p><a href="{{billing_url}}">Détails et gestion</a></p><p>L''équipe FadeUp</p>'),
  ('tier_switch_notice', 'en', 'transactional',
   'Your Multi-locations tier changes next period',
   E'Hello {{owner_name}},\n\n{{organization_name}} now operates {{establishments}} establishments. Starting {{effective_at_en}}, your subscription will move to the {{new_plan_name}} tier ({{new_price_eur}} € excl. VAT/{{interval_en}}).\n\nNothing changes until then: the current period stays at the price you paid, and no establishment is ever blocked.\n\nDetails and management: {{billing_url}}\n\nThe FadeUp team',
   '<p>Hello {{owner_name}},</p><p><strong>{{organization_name}}</strong> now operates {{establishments}} establishments. Starting <strong>{{effective_at_en}}</strong>, your subscription will move to the <strong>{{new_plan_name}}</strong> tier ({{new_price_eur}} € excl. VAT/{{interval_en}}).</p><p>Nothing changes until then: the current period stays at the price you paid, and no establishment is ever blocked.</p><p><a href="{{billing_url}}">Details and management</a></p><p>The FadeUp team</p>')
on conflict (template_key, locale) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Le balayage des paliers
-- ---------------------------------------------------------------------------

create or replace function public.run_establishment_tier_maintenance()
returns table (tier_changes_scheduled integer, quotes_opened integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_scheduled integer := 0;
  v_quotes integer := 0;
  v_row record;
  v_target public.commercial_plans;
  v_recipient record;
begin
  -- Les organisations avec un abonnement multi_salon vivant dont le nombre
  -- d'établissements actifs déborde le palier payé.
  for v_row in
    select b.organization_id, b.plan_key, b.billing_interval, b.current_period_end,
           o.name as organization_name,
           private.org_active_establishments(b.organization_id) as used,
           p.max_establishments as cur_max
    from public.organization_billing b
    join public.commercial_plans p on p.plan_key = b.plan_key
    join public.organizations o on o.id = b.organization_id
    where b.subscription_status in ('active', 'trialing', 'past_due')
      and p.commercial_family = 'multi_salon'
      and private.org_active_establishments(b.organization_id) > p.max_establishments
  loop
    -- Le palier qui COUVRE le nouveau nombre d'établissements. Bornes lues en
    -- base — jamais codées en dur.
    select * into v_target
    from public.commercial_plans p
    where p.commercial_family = 'multi_salon' and p.is_available
      and p.max_establishments >= v_row.used
    order by p.tier asc
    limit 1;

    if v_target.plan_key is null then
      -- AU-DELÀ DU PALIER HAUT : sur devis, jamais un blocage silencieux.
      -- Une demande s'ouvre (une seule à la fois par organisation) ; en
      -- attendant, l'organisation reste sur le palier haut et rien n'est
      -- bloqué.
      insert into public.billing_quote_requests
        (organization_id, requested_by, establishments_requested, note)
      values
        (v_row.organization_id, null, v_row.used,
         'ouverte automatiquement : ' || v_row.used || ' établissements actifs, au-delà du palier haut')
      on conflict (organization_id) where status = 'open' do nothing;
      if found then
        v_quotes := v_quotes + 1;
      end if;
      continue;
    end if;

    if v_target.plan_key = v_row.plan_key then
      continue;
    end if;

    -- Programmé pour la PÉRIODE SUIVANTE, jamais rétroactif. On n'écrase pas
    -- un programmé déjà posé (une descente demandée par le propriétaire, une
    -- bascule déjà annoncée).
    update public.organization_billing b
    set scheduled_plan_key = v_target.plan_key,
        scheduled_interval = b.billing_interval,
        scheduled_effective_at = b.current_period_end,
        scheduled_dispatched_at = null,
        scheduled_reason = 'establishment_tier'
    where b.organization_id = v_row.organization_id
      and b.scheduled_plan_key is null;

    if not found then
      continue;
    end if;

    v_scheduled := v_scheduled + 1;

    -- ANNONCÉ AVANT D'ÊTRE FACTURÉ. Une hausse découverte sur la facture est
    -- un motif de résiliation ; celle-ci arrive par e-mail avec la date et le
    -- montant, pendant que la période en cours reste au tarif payé.
    select * into v_recipient from private.org_owner_recipient(v_row.organization_id);
    if v_recipient.email is not null then
      insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
      values (
        v_recipient.email, 'tier_switch_notice', v_recipient.locale,
        jsonb_build_object(
          'owner_name', v_recipient.owner_name,
          'organization_name', v_row.organization_name,
          'establishments', v_row.used,
          'new_plan_name', v_target.display_name,
          'new_price_eur', (case when coalesce(v_row.billing_interval, 'month') = 'year'
                                 then v_target.annual_price_minor else v_target.price_minor end / 100)::text,
          'interval_fr', case when coalesce(v_row.billing_interval, 'month') = 'year' then 'an' else 'mois' end,
          'interval_en', case when coalesce(v_row.billing_interval, 'month') = 'year' then 'year' else 'month' end,
          'effective_at_fr', to_char(v_row.current_period_end at time zone 'Europe/Paris', 'DD/MM/YYYY'),
          'effective_at_en', to_char(v_row.current_period_end at time zone 'Europe/Paris', 'FMMonth DD, YYYY'),
          'billing_url', 'https://fade-up.com/pro/billing'),
        'transactional',
        'tier:' || v_row.organization_id::text || ':' || v_target.plan_key
          || ':' || to_char(v_row.current_period_end, 'YYYYMMDD'))
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;

  return query select v_scheduled, v_quotes;
end;
$$;

comment on function public.run_establishment_tier_maintenance() is
'Passe dédiée du scheduler : détecte les organisations multi_salon dont les établissements actifs débordent le palier payé, programme la bascule vers le palier couvrant pour la PÉRIODE SUIVANTE (bornes lues en base), l''annonce par e-mail AVANT facturation, et ouvre une demande de devis au-delà du palier haut. Ne bloque jamais rien.';

revoke all on function public.run_establishment_tier_maintenance() from public, anon, authenticated;
grant execute on function public.run_establishment_tier_maintenance() to fadeup_scheduler;

-- ---------------------------------------------------------------------------
-- 9. La demande de devis, côté propriétaire
-- ---------------------------------------------------------------------------

create or replace function public.request_billing_quote(
  p_organization_id uuid,
  p_establishments integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_billing_owner(p_organization_id);

  if p_establishments is null or p_establishments <= 0 then
    raise exception 'establishments must be a positive number' using errcode = '22023';
  end if;

  insert into public.billing_quote_requests
    (organization_id, requested_by, establishments_requested, note)
  values
    (p_organization_id, (select auth.uid()), p_establishments, p_note)
  on conflict (organization_id) where status = 'open' do nothing
  returning id into v_id;

  if v_id is null then
    select q.id into v_id from public.billing_quote_requests q
    where q.organization_id = p_organization_id and q.status = 'open';
  end if;

  return v_id;
end;
$$;

comment on function public.request_billing_quote(uuid, integer, text) is
'Le chemin « sur devis » au-delà de quinze établissements : le propriétaire ouvre (ou retrouve) sa demande. Une seule ouverte à la fois — trois clics ne font pas trois dossiers.';

revoke all on function public.request_billing_quote(uuid, integer, text) from public, anon;
grant execute on function public.request_billing_quote(uuid, integer, text) to authenticated;

commit;
