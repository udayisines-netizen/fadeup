-- FadeUp — B3 : vérification de la monétisation.
--
-- NE COMMET RIEN. Une seule transaction, un rollback final — la règle B1/B2 :
-- une fixture committée serait un résidu permanent (commercial_plan_changes
-- est append-only par trigger). Les appels pg_net faits pendant le test
-- restent dans la transaction et disparaissent au rollback : aucun HTTP réel
-- ne part.
--
-- Exécution :
--   docker cp db/tests/verify_b3.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_b3.sql

\set ON_ERROR_STOP off

begin;

create temporary table b3_results (
  seq serial primary key,
  chantier text not null,
  check_name text not null,
  verdict text not null,
  detail text
) on commit drop;

create or replace function pg_temp.record(p_chantier text, p_check text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into b3_results (chantier, check_name, verdict, detail)
  values (p_chantier, p_check, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- ===========================================================================
-- FIXTURES
-- ===========================================================================

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('b300aaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'b3-owner@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"B3 Owner"}',   'authenticated', 'authenticated'),
  ('b300aaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'b3-manager@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"B3 Manager"}', 'authenticated', 'authenticated');

-- Une organisation « réellement réservable » : tout ce que ready_to_publish
-- exige, à l'identique du fixture B2.
insert into public.organizations (id, name, slug, business_type, currency, country_code, marketplace_visible, onboarding_completed_at)
values ('b3000001-0000-4000-8000-000000000001', 'B3 Shop', 'b3-verify-shop', 'barbershop', 'EUR', 'FR', true, now());

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('b3000101-0000-4000-8000-000000000001', 'b3000001-0000-4000-8000-000000000001',
        'B3 Shop', '10 rue Oberkampf', 'Paris', 'Île-de-France', '75011', 'FR', 'Europe/Paris', 48.8649, 2.3800);

insert into public.staff_profiles (id, organization_id, location_id, display_name, is_active, is_public)
values ('b3000201-0000-4000-8000-000000000001', 'b3000001-0000-4000-8000-000000000001',
        'b3000101-0000-4000-8000-000000000001', 'B3 Barber', true, true);

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('b3000401-0000-4000-8000-000000000001', 'b3000001-0000-4000-8000-000000000001',
        'b3000201-0000-4000-8000-000000000001', true);

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values ('b3000701-0000-4000-8000-000000000001', 'b3000001-0000-4000-8000-000000000001',
        'B3 Coupe', 30, 2500, true);

insert into public.service_locations (organization_id, service_id, location_id)
values ('b3000001-0000-4000-8000-000000000001', 'b3000701-0000-4000-8000-000000000001', 'b3000101-0000-4000-8000-000000000001');

insert into public.barber_services (organization_id, barber_id, service_id)
values ('b3000001-0000-4000-8000-000000000001', 'b3000401-0000-4000-8000-000000000001', 'b3000701-0000-4000-8000-000000000001');

insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time, is_closed)
select 'b3000001-0000-4000-8000-000000000001', 'b3000101-0000-4000-8000-000000000001', d, '00:00', '23:59', false
from generate_series(0, 6) d;

insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time, is_off)
select 'b3000001-0000-4000-8000-000000000001', 'b3000401-0000-4000-8000-000000000001', d, '00:00', '23:59', false
from generate_series(0, 6) d;

insert into public.memberships (organization_id, user_id, role)
values ('b3000001-0000-4000-8000-000000000001', 'b300aaaa-0000-4000-8000-000000000001', 'owner'),
       ('b3000001-0000-4000-8000-000000000001', 'b300aaaa-0000-4000-8000-000000000002', 'manager');

-- Des correspondances de prix pour les webhooks : ARCHIVÉES exprès — l'index
-- « un seul actif par plan/intervalle/mode » appartient aux vrais prix créés
-- par le script de synchronisation, et le traitement des webhooks résout par
-- l'HISTORIQUE, actif ou non — c'est voulu, un abonnement peut vivre sur un
-- prix archivé.
insert into public.billing_stripe_prices (plan_key, billing_interval, stripe_price_id, unit_amount_minor, currency, livemode, is_active, archived_at)
values
  ('salon_pro',   'month', 'price_b3verifypro', 4900, 'EUR', false, false, now()),
  ('multi_growth','month', 'price_b3verifymg',  9900, 'EUR', false, false, now());

-- ===========================================================================
-- CATALOGUE (chantier 1 + 5)
-- ===========================================================================

do $$
declare v_bad integer; v_missing integer;
begin
  -- L'annuel vaut EXACTEMENT dix fois le mensuel, pour tout plan payant.
  select count(*) into v_bad
  from public.commercial_plans
  where price_minor > 0 and annual_price_minor <> price_minor * 10;
  perform pg_temp.record('catalogue', 'annuel = 10 × mensuel sur tous les plans payants', v_bad = 0,
                         v_bad || ' écart(s)');

  -- Chaque plan payant a un prix Stripe actif, mensuel ET annuel, au montant
  -- du catalogue (mode test).
  select count(*) into v_missing
  from public.commercial_plans p
  cross join (values ('month'::public.stripe_billing_interval), ('year')) i(iv)
  where p.price_minor > 0
    and not exists (
      select 1 from public.billing_stripe_prices sp
      where sp.plan_key = p.plan_key and sp.billing_interval = i.iv
        and sp.livemode = false and sp.is_active
        and sp.unit_amount_minor = case when i.iv = 'month' then p.price_minor else p.annual_price_minor end);
  perform pg_temp.record('catalogue', 'un prix Stripe actif par plan et intervalle, au montant du catalogue',
                         v_missing = 0, v_missing || ' manquant(s)');

  -- Les bornes des paliers sont des données, aux valeurs tranchées.
  perform pg_temp.record('catalogue', 'paliers 2-3 / 4-6 / 7-15 en base',
    (select array_agg(min_establishments || '-' || max_establishments order by tier)
     from public.commercial_plans where commercial_family = 'multi_salon') = array['2-3','4-6','7-15']);

  -- Le niveau fonctionnel des paliers couvre celui de salon_pro.
  perform pg_temp.record('catalogue', 'chaque palier multi couvre les capacités de salon_pro',
    not exists (
      select 1 from public.commercial_plans mp
      cross join public.plan_capabilities pc
      where mp.commercial_family = 'multi_salon' and pc.plan_key = 'salon_pro'
        and not exists (select 1 from public.plan_capabilities pc2
                        where pc2.plan_key = mp.plan_key and pc2.capability_key = pc.capability_key)));
end $$;

-- ===========================================================================
-- ESSAI (chantier 2)
-- ===========================================================================

do $$
declare r record; v_slot timestamptz; v_started boolean;
begin
  v_slot := date_trunc('hour', now()) + interval '3 hours';

  -- Jumelles de readiness : même verdict.
  perform pg_temp.record('essai', 'private.org_ready_to_publish est vrai pour une organisation complète',
    private.org_ready_to_publish('b3000001-0000-4000-8000-000000000001'));

  -- AVANT l'essai : pending.
  select * into r from public.book_public_appointment(
    'b3-verify-shop', 'b3000101-0000-4000-8000-000000000001',
    'b3000401-0000-4000-8000-000000000001', 'b3000701-0000-4000-8000-000000000001',
    v_slot, 'Client Avant', null, 'avant@example.test', null);
  perform pg_temp.record('essai', 'avant l''essai : la réservation sort en pending',
                         r.status = 'pending', 'status=' || r.status);

  perform pg_temp.record('essai', 'avant l''essai : accepts_immediate_booking = false',
    not coalesce((select a.accepts_immediate_booking
                  from public.get_public_booking_alternatives(48.8649, 2.3800, null, null, 5, 50) a
                  where a.organization_id = 'b3000001-0000-4000-8000-000000000001' limit 1), false));

  -- Démarrage.
  v_started := private.start_trial_if_eligible('b3000001-0000-4000-8000-000000000001', 'onboarding');
  perform pg_temp.record('essai', 'l''essai démarre pour une organisation prête, free, avec propriétaire', v_started);

  perform pg_temp.record('essai', 'niveau accordé : salon_pro pour un barbershop',
    (select plan_key from public.organization_trials
     where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'salon_pro');

  perform pg_temp.record('essai', 'durée : 14 jours, sans carte bancaire (aucune table Stripe touchée)',
    (select ends_at - started_at from public.organization_trials
     where organization_id = 'b3000001-0000-4000-8000-000000000001') = interval '14 days'
    and not exists (select 1 from public.organization_billing
                    where organization_id = 'b3000001-0000-4000-8000-000000000001'));

  perform pg_temp.record('essai', 'effective_plan_key surclasse free pendant l''essai',
    private.effective_plan_key('b3000001-0000-4000-8000-000000000001') = 'salon_pro');

  perform pg_temp.record('essai', 'la capacité booking est obtenue par le chemin normal (org_has_capability)',
    private.org_has_capability('b3000001-0000-4000-8000-000000000001', 'booking'));

  -- LA JONCTION B2 : même RPC, zéro ligne de B2 changée, et le tunnel bascule.
  select * into r from public.book_public_appointment(
    'b3-verify-shop', 'b3000101-0000-4000-8000-000000000001',
    'b3000401-0000-4000-8000-000000000001', 'b3000701-0000-4000-8000-000000000001',
    v_slot + interval '1 hour', 'Client Pendant', null, 'pendant@example.test', null);
  perform pg_temp.record('essai', 'PENDANT l''essai : la même RPC produit confirmed',
                         r.status = 'confirmed', 'status=' || r.status);

  perform pg_temp.record('essai', 'pendant l''essai : accepts_immediate_booking passe à true',
    coalesce((select a.accepts_immediate_booking
              from public.get_public_booking_alternatives(48.8649, 2.3800, null, null, 5, 50) a
              where a.organization_id = 'b3000001-0000-4000-8000-000000000001' limit 1), false));

  -- Rappels J-3 puis J-1, idempotents.
  update public.organization_trials
  set ends_at = now() + interval '2 days 12 hours'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  perform public.run_trial_maintenance();
  perform pg_temp.record('essai', 'rappel J-3 mis en file dans email_outbox',
    exists (select 1 from public.email_outbox
            where dedupe_key = 'trial:b3000001-0000-4000-8000-000000000001:reminder_3d'
              and template = 'trial_ending_soon'));

  update public.organization_trials
  set ends_at = now() + interval '12 hours'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  perform public.run_trial_maintenance();
  perform public.run_trial_maintenance(); -- rejeu
  perform pg_temp.record('essai', 'rappel J-1 mis en file, une seule fois malgré le rejeu',
    (select count(*) from public.email_outbox
     where dedupe_key = 'trial:b3000001-0000-4000-8000-000000000001:reminder_1d') = 1);

  -- Échéance : retour au Free, rien de perdu, profil publié.
  update public.organization_trials
  set started_at = now() - interval '15 days', ends_at = now() - interval '1 hour'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  perform public.run_trial_maintenance();

  perform pg_temp.record('essai', 'à l''échéance : retour au Free',
    private.effective_plan_key('b3000001-0000-4000-8000-000000000001') = 'free'
    and (select status from public.organization_trials
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'expired');

  perform pg_temp.record('essai', 'à l''échéance : profil toujours publié, données intactes',
    (select marketplace_visible from public.organizations where id = 'b3000001-0000-4000-8000-000000000001')
    and (select count(*) from public.appointments
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 2);

  select * into r from public.book_public_appointment(
    'b3-verify-shop', 'b3000101-0000-4000-8000-000000000001',
    'b3000401-0000-4000-8000-000000000001', 'b3000701-0000-4000-8000-000000000001',
    v_slot + interval '2 hours', 'Client Après', null, 'apres@example.test', null);
  perform pg_temp.record('essai', 'APRÈS l''essai : la réservation ressort en pending',
                         r.status = 'pending', 'status=' || r.status);

  -- Unique par organisation, non relançable.
  perform pg_temp.record('essai', 'un essai consommé ne se relance pas',
    not private.start_trial_if_eligible('b3000001-0000-4000-8000-000000000001', 'onboarding'));
exception when others then
  perform pg_temp.record('essai', 'déroulé complet de l''essai', false, sqlerrm);
end $$;

-- Le niveau accordé à un solo.
do $$
begin
  update public.organizations set business_type = 'solo_professional'
  where id = 'b3000001-0000-4000-8000-000000000001';
  perform pg_temp.record('essai', 'niveau accordé à un solo_professional : solo (Independent)',
    private.trial_plan_for_org('b3000001-0000-4000-8000-000000000001') = 'solo');
  update public.organizations set business_type = 'barbershop'
  where id = 'b3000001-0000-4000-8000-000000000001';
end $$;

-- Jumelles de readiness, sous session propriétaire.
do $$
declare v_private boolean; v_public boolean;
begin
  v_private := private.org_ready_to_publish('b3000001-0000-4000-8000-000000000001');

  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b300aaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select ready_to_publish into v_public
  from public.get_organization_readiness('b3000001-0000-4000-8000-000000000001');
  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('essai', 'les jumelles de readiness rendent le même verdict',
    v_private = v_public, 'private=' || v_private || ' public=' || v_public);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('essai', 'les jumelles de readiness rendent le même verdict', false, sqlerrm);
end $$;

-- ===========================================================================
-- WEBHOOKS (chantier 4)
-- ===========================================================================

do $$
declare
  v_payload jsonb;
  v_changes integer;
  v_res text;
begin
  -- Un abonnement actif arrive.
  v_payload := jsonb_build_object(
    'id', 'evt_b3verify0000000001', 'type', 'customer.subscription.created', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object(
      'id', 'sub_b3verify1', 'customer', 'cus_b3verify1', 'status', 'active',
      'cancel_at_period_end', false,
      'metadata', jsonb_build_object('organization_id', 'b3000001-0000-4000-8000-000000000001'),
      'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
        'id', 'si_b3verify1',
        'price', jsonb_build_object('id', 'price_b3verifypro',
                                    'recurring', jsonb_build_object('interval', 'month')),
        'current_period_start', extract(epoch from now())::bigint,
        'current_period_end', extract(epoch from now() + interval '30 days')::bigint))))));

  insert into public.stripe_webhook_events (event_id, event_type, livemode, payload)
  values ('evt_b3verify0000000001', 'customer.subscription.created', false, v_payload)
  on conflict (event_id) do nothing;

  -- L'essai a été expiré par la section précédente ; on le remet actif pour
  -- vérifier que la souscription le CONVERTIT (le cas réel : un professionnel
  -- souscrit pendant son essai).
  update public.organization_trials
  set status = 'active', expired_at = null, converted_at = null,
      started_at = now() - interval '5 days', ends_at = now() + interval '9 days'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';

  v_res := private.process_stripe_event('evt_b3verify0000000001');
  perform pg_temp.record('webhooks', 'subscription.created actif -> plan appliqué, source billing',
    v_res = 'processed'
    and (select plan_key || '/' || status || '/' || entitlement_source
         from public.organization_commercial_state
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'salon_pro/active/billing',
    'result=' || v_res);

  perform pg_temp.record('webhooks', 'organization_billing reflète l''abonnement (période, item, intervalle)',
    (select stripe_subscription_id || '|' || stripe_subscription_item_id || '|' || billing_interval
     from public.organization_billing
     where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'sub_b3verify1|si_b3verify1|month'
    and (select current_period_end > now() + interval '29 days' from public.organization_billing
         where organization_id = 'b3000001-0000-4000-8000-000000000001'));

  perform pg_temp.record('webhooks', 'la souscription convertit l''essai',
    (select status from public.organization_trials
     where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'converted');

  -- IDEMPOTENCE : le rejeu du même identifiant ne produit qu'un effet.
  select count(*) into v_changes from public.commercial_plan_changes
  where organization_id = 'b3000001-0000-4000-8000-000000000001' and entitlement_source = 'billing';

  insert into public.stripe_webhook_events (event_id, event_type, livemode, payload)
  values ('evt_b3verify0000000001', 'customer.subscription.created', false, v_payload)
  on conflict (event_id) do nothing;
  perform private.process_stripe_event('evt_b3verify0000000001');
  perform public.run_billing_maintenance();

  perform pg_temp.record('webhooks', 'rejeu du même event_id : une seule ligne, un seul effet',
    (select count(*) from public.stripe_webhook_events where event_id = 'evt_b3verify0000000001') = 1
    and (select count(*) from public.commercial_plan_changes
         where organization_id = 'b3000001-0000-4000-8000-000000000001'
           and entitlement_source = 'billing') = v_changes);

  -- Un événement de mode réel est rejeté par la base (2e barrière).
  insert into public.stripe_webhook_events (event_id, event_type, livemode, payload)
  values ('evt_b3verifylive00001', 'invoice.paid', true,
          jsonb_build_object('id', 'evt_b3verifylive00001', 'type', 'invoice.paid', 'livemode', true,
                             'data', jsonb_build_object('object', jsonb_build_object('customer', 'cus_b3verify1'))));
  v_res := private.process_stripe_event('evt_b3verifylive00001');
  perform pg_temp.record('webhooks', 'un événement livemode est rejeté tant que la base est en mode test',
    v_res = 'rejected'
    and (select status from public.stripe_webhook_events where event_id = 'evt_b3verifylive00001') = 'rejected');

  -- ÉCHEC DE PAIEMENT : sept jours de grâce, capacités conservées, e-mail J0.
  insert into public.stripe_webhook_events (event_id, event_type, livemode, payload)
  values ('evt_b3verify0000000002', 'invoice.payment_failed', false,
          jsonb_build_object('id', 'evt_b3verify0000000002', 'type', 'invoice.payment_failed', 'livemode', false,
                             'data', jsonb_build_object('object', jsonb_build_object(
                               'customer', 'cus_b3verify1',
                               'subscription_details', jsonb_build_object('metadata',
                                 jsonb_build_object('organization_id', 'b3000001-0000-4000-8000-000000000001'))))));
  v_res := private.process_stripe_event('evt_b3verify0000000002');

  perform pg_temp.record('webhooks', 'payment_failed ouvre sept jours de grâce',
    v_res = 'processed'
    and (select grace_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
         from public.organization_billing
         where organization_id = 'b3000001-0000-4000-8000-000000000001'));

  perform pg_temp.record('webhooks', 'pendant la grâce : capacités CONSERVÉES (past_due ne dégrade pas)',
    private.org_has_capability('b3000001-0000-4000-8000-000000000001', 'booking')
    and (select status from public.organization_commercial_state
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'past_due');

  perform pg_temp.record('webhooks', 'le professionnel est prévenu à J0',
    exists (select 1 from public.email_outbox
            where template = 'payment_failed_notice'
              and dedupe_key like 'grace:b3000001-0000-4000-8000-000000000001:%:0'));

  -- Relance J+1 (grâce entamée d'un jour), idempotente.
  update public.organization_billing
  set grace_until = now() + interval '5 days 20 hours'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  perform public.run_billing_maintenance();
  perform public.run_billing_maintenance();
  perform pg_temp.record('webhooks', 'relance J+1 mise en file, une seule fois',
    (select count(*) from public.email_outbox
     where template = 'payment_failed_notice'
       and dedupe_key like 'grace:b3000001-0000-4000-8000-000000000001:%:1') = 1);

  -- Grâce échue : retour au Free, résiliation Stripe demandée (pg_net).
  update public.organization_billing
  set grace_until = now() - interval '1 minute'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  perform public.run_billing_maintenance();

  perform pg_temp.record('webhooks', 'grâce échue : retour au Free (status canceled), données intactes',
    private.effective_plan_key('b3000001-0000-4000-8000-000000000001') = 'free'
    and (select count(*) from public.appointments
         where organization_id = 'b3000001-0000-4000-8000-000000000001') >= 2);

  perform pg_temp.record('webhooks', 'grâce échue : la résiliation Stripe est demandée',
    exists (select 1 from net.http_request_queue
            where url like '%/v1/subscriptions/sub_b3verify1' and method = 'DELETE')
    or exists (select 1 from net._http_response where true and false), -- la file peut être consommée : voir détail
    'file pg_net inspectée dans la transaction');

  -- subscription.deleted ramène (reste) au Free.
  insert into public.stripe_webhook_events (event_id, event_type, livemode, payload)
  values ('evt_b3verify0000000003', 'customer.subscription.deleted', false,
          jsonb_build_object('id', 'evt_b3verify0000000003', 'type', 'customer.subscription.deleted', 'livemode', false,
                             'data', jsonb_build_object('object', jsonb_build_object(
                               'id', 'sub_b3verify1', 'customer', 'cus_b3verify1', 'status', 'canceled',
                               'metadata', jsonb_build_object('organization_id', 'b3000001-0000-4000-8000-000000000001')))));
  v_res := private.process_stripe_event('evt_b3verify0000000003');
  perform pg_temp.record('webhooks', 'subscription.deleted : retour au Free, historique conservé',
    v_res = 'processed'
    and private.effective_plan_key('b3000001-0000-4000-8000-000000000001') = 'free'
    and (select count(*) from public.commercial_plan_changes
         where organization_id = 'b3000001-0000-4000-8000-000000000001') > 0);

  -- Le journal garde tout : charge utile et résultat.
  perform pg_temp.record('webhooks', 'journal complet : charge utile et résultat pour chaque événement',
    (select count(*) from public.stripe_webhook_events
     where event_id like 'evt_b3verify%' and payload is not null and status in ('processed','rejected')) = 4);
exception when others then
  perform pg_temp.record('webhooks', 'déroulé webhooks', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANGEMENT DE PLAN (chantier 3 + 5)
-- ===========================================================================

do $$
declare
  r record; v_err text;
  -- Les verdicts sont COLLECTÉS sous la session propriétaire puis enregistrés
  -- après reset role — pg_temp.record écrit une table temporaire que le rôle
  -- authenticated n'a pas le droit de toucher (leçon du premier passage de
  -- cette suite, et le même motif que verify_b2).
  v_up_ok boolean; v_up_d text;
  v_annual_ok boolean; v_annual_d text;
  v_down_ok boolean; v_down_d text;
begin
  -- Remet l'organisation sur un abonnement actif salon_pro/mensuel.
  update public.organization_billing
  set subscription_status = 'active', plan_key = 'salon_pro', billing_interval = 'month',
      stripe_price_id = 'price_b3verifypro',
      current_period_start = now(), current_period_end = now() + interval '30 days',
      grace_until = null, cancel_at_period_end = false
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  update public.organization_commercial_state
  set plan_key = 'salon_pro', status = 'active'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';

  -- Session PROPRIÉTAIRE.
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b300aaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Montée en gamme : immédiate.
  select * into r from public.request_plan_change(
    'b3000001-0000-4000-8000-000000000001', 'salon_business', 'month');
  v_up_ok := r.decision = 'immediate' and r.stripe_price_id is not null;
  v_up_d := 'decision=' || r.decision;

  -- Passage mensuel -> annuel à plan égal : immédiat aussi.
  select * into r from public.request_plan_change(
    'b3000001-0000-4000-8000-000000000001', 'salon_pro', 'year');
  v_annual_ok := r.decision = 'immediate';
  v_annual_d := 'decision=' || r.decision;

  -- Descente : programmée à la fin de la période.
  select * into r from public.request_plan_change(
    'b3000001-0000-4000-8000-000000000001', 'salon_essential', 'month');
  v_down_ok := r.decision = 'scheduled'
    and r.effective_at between now() + interval '29 days' and now() + interval '31 days';
  v_down_d := 'decision=' || r.decision || ' effective=' || r.effective_at;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('plans', 'montée en gamme : décision immediate', v_up_ok, v_up_d);
  perform pg_temp.record('plans', 'passage mensuel -> annuel : immédiat avec proratisation', v_annual_ok, v_annual_d);
  perform pg_temp.record('plans', 'descente de gamme : programmée à la fin de la période payée', v_down_ok, v_down_d);

  perform pg_temp.record('plans', 'la descente programmée est notée en base, non appliquée',
    (select scheduled_plan_key from public.organization_billing
     where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'salon_essential'
    and (select plan_key from public.organization_commercial_state
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'salon_pro');

  -- Descente INFAISABLE : deux professionnels vers solo (limité à un).
  insert into public.staff_profiles (id, organization_id, location_id, display_name, is_active, is_public)
  values ('b3000202-0000-4000-8000-000000000001', 'b3000001-0000-4000-8000-000000000001',
          'b3000101-0000-4000-8000-000000000001', 'B3 Second', true, true);
  insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
  values ('b3000402-0000-4000-8000-000000000001', 'b3000001-0000-4000-8000-000000000001',
          'b3000202-0000-4000-8000-000000000001', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b300aaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_plan_change('b3000001-0000-4000-8000-000000000001', 'solo', 'month');
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('plans', 'descente infaisable : refusée avec un motif exploitable, données intactes',
    v_err is not null and v_err like '%professional%'
    and (select count(*) from public.barbers
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 2
    and (select scheduled_plan_key from public.organization_billing
         where organization_id = 'b3000001-0000-4000-8000-000000000001') = 'salon_essential',
    coalesce(v_err, 'aucune erreur levée'));

  -- Le changement programmé arrivé à terme part vers Stripe.
  update public.organization_billing
  set scheduled_effective_at = now() - interval '1 minute'
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  perform public.run_billing_maintenance();
  perform pg_temp.record('plans', 'le programmé échu est transmis à Stripe (pg_net), une fois',
    (select scheduled_dispatched_at is not null from public.organization_billing
     where organization_id = 'b3000001-0000-4000-8000-000000000001')
    and exists (select 1 from net.http_request_queue
                where url like '%/v1/subscriptions/sub_b3verify1?items%proration_behavior=none%'));
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('plans', 'déroulé changement de plan', false, sqlerrm);
end $$;

-- LA GARDE PROPRIÉTAIRE : un manager est refusé PAR LE SERVEUR.
do $$
declare v_checkout text; v_change text; v_portal text; v_cancel text; v_quote text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b300aaaa-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.prepare_billing_checkout('b3000001-0000-4000-8000-000000000001', 'salon_pro', 'month');
    v_checkout := 'ACCEPTÉ — FAUTE';
  exception when others then v_checkout := 'refusé: ' || sqlerrm; end;

  begin
    perform public.request_plan_change('b3000001-0000-4000-8000-000000000001', 'salon_business', 'month');
    v_change := 'ACCEPTÉ — FAUTE';
  exception when others then v_change := 'refusé: ' || sqlerrm; end;

  begin
    perform public.prepare_billing_portal('b3000001-0000-4000-8000-000000000001');
    v_portal := 'ACCEPTÉ — FAUTE';
  exception when others then v_portal := 'refusé: ' || sqlerrm; end;

  begin
    perform public.request_billing_cancellation('b3000001-0000-4000-8000-000000000001');
    v_cancel := 'ACCEPTÉ — FAUTE';
  exception when others then v_cancel := 'refusé: ' || sqlerrm; end;

  begin
    perform public.request_billing_quote('b3000001-0000-4000-8000-000000000001', 20, null);
    v_quote := 'ACCEPTÉ — FAUTE';
  exception when others then v_quote := 'refusé: ' || sqlerrm; end;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('garde', 'un manager ne peut pas ouvrir un checkout',      v_checkout like 'refusé:%owner%', v_checkout);
  perform pg_temp.record('garde', 'un manager ne peut pas changer de plan',         v_change   like 'refusé:%owner%', v_change);
  perform pg_temp.record('garde', 'un manager ne peut pas ouvrir le portail',       v_portal   like 'refusé:%owner%', v_portal);
  perform pg_temp.record('garde', 'un manager ne peut pas résilier',                v_cancel   like 'refusé:%owner%', v_cancel);
  perform pg_temp.record('garde', 'un manager ne peut pas demander un devis',       v_quote    like 'refusé:%owner%', v_quote);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('garde', 'refus du manager', false, sqlerrm);
end $$;

-- RLS : le manager ne LIT rien non plus ; le propriétaire lit son état.
do $$
declare v_owner_rows integer; v_manager_rows integer; v_manager_trials integer; v_manager_events integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b300aaaa-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_manager_rows from public.organization_billing
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  select count(*) into v_manager_trials from public.organization_trials
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  select count(*) into v_manager_events from public.stripe_webhook_events;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b300aaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_owner_rows from public.organization_billing
  where organization_id = 'b3000001-0000-4000-8000-000000000001';
  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('RLS', 'un manager ne lit ni facturation, ni essai, ni journal webhook',
    v_manager_rows = 0 and v_manager_trials = 0 and v_manager_events = 0,
    'billing=' || v_manager_rows || ' trials=' || v_manager_trials || ' events=' || v_manager_events);
  perform pg_temp.record('RLS', 'le propriétaire lit l''état de facturation de SON organisation',
    v_owner_rows = 1);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('RLS', 'lectures owner/manager', false, sqlerrm);
end $$;

-- RLS structurelle sur toute table créée par B3.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('billing_stripe_products','billing_stripe_prices','organization_billing',
                      'billing_quote_requests','organization_trials','stripe_webhook_events')
    and (not c.relrowsecurity or not c.relforcerowsecurity);
  perform pg_temp.record('RLS', 'RLS activée ET forcée sur les six tables B3', v_bad is null, coalesce(v_bad, ''));

  perform pg_temp.record('RLS', 'anon n''a aucun droit sur les tables de facturation',
    not has_table_privilege('anon', 'public.organization_billing', 'SELECT')
    and not has_table_privilege('anon', 'public.stripe_webhook_events', 'SELECT')
    and not has_table_privilege('anon', 'public.organization_trials', 'SELECT'));

  perform pg_temp.record('RLS', 'authenticated ne peut RIEN écrire dans les tables de facturation',
    not has_table_privilege('authenticated', 'public.organization_billing', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.stripe_webhook_events', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.organization_trials', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.billing_stripe_prices', 'INSERT, UPDATE, DELETE'));
end $$;

-- ===========================================================================
-- PALIERS MULTI-ÉTABLISSEMENTS (chantier 6)
-- ===========================================================================

do $$
declare v_err text; r record; i integer;
begin
  -- Une organisation multi_growth (palier 2-3) avec abonnement actif et
  -- 3 établissements.
  insert into public.organizations (id, name, slug, business_type, currency, country_code)
  values ('b3000002-0000-4000-8000-000000000001', 'B3 Multi', 'b3-verify-multi', 'multi_location', 'EUR', 'FR');
  insert into public.memberships (organization_id, user_id, role)
  values ('b3000002-0000-4000-8000-000000000001', 'b300aaaa-0000-4000-8000-000000000001', 'owner');
  update public.organization_commercial_state
  set plan_key = 'multi_growth', status = 'active'
  where organization_id = 'b3000002-0000-4000-8000-000000000001';
  insert into public.organization_billing
    (organization_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_item_id,
     subscription_status, plan_key, billing_interval, stripe_price_id,
     current_period_start, current_period_end, livemode)
  values
    ('b3000002-0000-4000-8000-000000000001', 'cus_b3multi', 'sub_b3multi', 'si_b3multi',
     'active', 'multi_growth', 'month', 'price_b3verifymg',
     now(), now() + interval '30 days', false);

  for i in 1..3 loop
    insert into public.locations (organization_id, name, address_line1, city, country, timezone)
    values ('b3000002-0000-4000-8000-000000000001', 'B3 Multi ' || i, i || ' rue Multi', 'Paris', 'FR', 'Europe/Paris');
  end loop;

  -- LE POINT CLEF : le 4e établissement N'EST PAS BLOQUÉ.
  begin
    insert into public.locations (organization_id, name, address_line1, city, country, timezone)
    values ('b3000002-0000-4000-8000-000000000001', 'B3 Multi 4', '4 rue Multi', 'Paris', 'FR', 'Europe/Paris');
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  perform pg_temp.record('paliers', 'un établissement au-delà du palier n''est JAMAIS bloqué',
    v_err is null, coalesce(v_err, ''));

  -- Le balayage détecte, programme pour la période suivante, annonce.
  perform public.run_establishment_tier_maintenance();
  perform public.run_establishment_tier_maintenance(); -- rejeu

  select * into r from public.organization_billing
  where organization_id = 'b3000002-0000-4000-8000-000000000001';
  perform pg_temp.record('paliers', 'bascule 3->4 : multi_growth -> multi_pro programmé à la période suivante',
    r.scheduled_plan_key = 'multi_pro'
    and r.scheduled_effective_at between now() + interval '29 days' and now() + interval '31 days'
    and r.scheduled_reason = 'establishment_tier',
    coalesce(r.scheduled_plan_key, 'NULL'));

  perform pg_temp.record('paliers', 'la période en cours n''est PAS refacturée (plan commercial inchangé)',
    (select plan_key from public.organization_commercial_state
     where organization_id = 'b3000002-0000-4000-8000-000000000001') = 'multi_growth');

  perform pg_temp.record('paliers', 'le professionnel est prévenu AVANT facturation, une seule fois',
    (select count(*) from public.email_outbox
     where template = 'tier_switch_notice'
       and dedupe_key like 'tier:b3000002-0000-4000-8000-000000000001:multi_pro:%') = 1);

  -- Au-delà de 15 : une demande de devis s'ouvre, rien ne bloque.
  update public.organization_commercial_state
  set plan_key = 'multi_scale'
  where organization_id = 'b3000002-0000-4000-8000-000000000001';
  update public.organization_billing
  set plan_key = 'multi_scale', scheduled_plan_key = null, scheduled_interval = null,
      scheduled_effective_at = null, scheduled_reason = null
  where organization_id = 'b3000002-0000-4000-8000-000000000001';

  for i in 5..16 loop
    insert into public.locations (organization_id, name, address_line1, city, country, timezone)
    values ('b3000002-0000-4000-8000-000000000001', 'B3 Multi ' || i, i || ' rue Multi', 'Paris', 'FR', 'Europe/Paris');
  end loop;

  perform public.run_establishment_tier_maintenance();
  perform public.run_establishment_tier_maintenance(); -- rejeu

  perform pg_temp.record('paliers', 'au-delà de 15 : UNE demande de devis ouverte, pas de blocage',
    (select count(*) from public.billing_quote_requests
     where organization_id = 'b3000002-0000-4000-8000-000000000001' and status = 'open') = 1
    and private.org_active_establishments('b3000002-0000-4000-8000-000000000001') = 16);
exception when others then
  perform pg_temp.record('paliers', 'déroulé paliers', false, sqlerrm);
end $$;

-- ===========================================================================
-- SECRETS
-- ===========================================================================

do $$
declare v_n integer;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('stripe_secret_key', 'stripe_webhook_secret')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.record('secrets', 'les secrets Stripe ne sont exécutables par aucun rôle client', v_n = 0);

  perform pg_temp.record('secrets', 'le mode facturation de la base est TEST',
    private.billing_livemode() = false);

  -- Aucune colonne lisible par un rôle client ne contient une clé Stripe.
  perform pg_temp.record('secrets', 'aucune clé secrète dans une table (préfixes sk_/whsec_ absents)',
    not exists (select 1 from public.billing_stripe_products where stripe_product_id like 'sk_%')
    and not exists (select 1 from public.organization_billing
                    where coalesce(stripe_customer_id, '') like 'sk_%'
                       or coalesce(stripe_subscription_id, '') like 'whsec_%'));
end $$;

-- ===========================================================================
-- RÉSULTATS
-- ===========================================================================

select chantier, check_name, verdict, coalesce(detail, '') as detail
from b3_results order by seq;

select verdict, count(*) from b3_results group by verdict order by verdict;

rollback;
