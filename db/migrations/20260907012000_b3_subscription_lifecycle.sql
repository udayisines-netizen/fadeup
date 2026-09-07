-- FadeUp — B3, chantier 4 (+ le socle du 3) : webhooks Stripe et cycle de vie.
--
-- POURQUOI CETTE PIÈCE EST LA PLUS IMPORTANTE
--
-- Sans elle, la base ne sait jamais qu'un client a cessé de payer. Tout ce
-- que Stripe constate — souscription, échec de carte, résiliation — arrive
-- ici par webhook, et c'est CE fichier qui le traduit en état commercial.
--
-- L'ARCHITECTURE, EN UNE PHRASE
--
-- La fonction Edge `stripe-webhook` vérifie la signature et INSÈRE l'événement
-- brut dans `stripe_webhook_events` (200 en quelques millisecondes) ; le
-- scheduler le TRAITE ensuite, ici, en SQL — même partage des rôles que les
-- e-mails de B2 : l'entrée est mince, la logique vit dans la base où la suite
-- VERIFY peut la tester.
--
-- POURQUOI LA VÉRIFICATION DE SIGNATURE VIT DANS LA FONCTION EDGE, PAS ICI
--
-- Un événement forgé qui serait stocké puis rejeté aurait déjà fait son
-- dégât : son identifiant occuperait la ligne d'idempotence, et le VRAI
-- événement portant le même identifiant serait déduit comme un doublon et
-- perdu. La signature se vérifie donc AVANT toute écriture, dans l'entrée
-- HTTP, et un échec est un 400 sans trace en base. La base re-note quand même
-- `livemode` et refuse de traiter un événement de mode réel : deux barrières
-- valent mieux qu'une.
--
-- IDEMPOTENCE
--
-- Stripe rejoue les événements. La clé primaire de `stripe_webhook_events`
-- EST l'identifiant d'événement Stripe : le rejeu du même `evt_...` est un
-- ON CONFLICT DO NOTHING à l'insertion — le motif B2, en plus simple encore.
--
-- ÉCHEC DE PAIEMENT — DÉCISION TRANCHÉE
--
-- Sept jours de grâce, puis retour au Free. Pendant la grâce : capacités
-- conservées (status `past_due` ne dégrade pas effective_plan_key),
-- professionnel prévenu à J0 puis relancé à J+1, J+3 et J+6. Stripe porte de
-- son côté les Smart Retries sur la carte ; ce que Stripe ne peut pas porter —
-- nos e-mails, notre échéance de sept jours, notre retour au Free — vit ici.
--
-- RETOUR AU FREE SANS CASSER LES DONNÉES
--
-- Le retour au Free d'une organisation multi-établissements ne passe JAMAIS
-- par plan_key='free' : la garde de capacité R2 refuserait (à raison) un plan
-- qui couvre moins d'établissements qu'elle n'en opère. Le retour au Free est
-- status='canceled' — le mécanisme prévu par R2 précisément pour ça :
-- effective_plan_key dégrade vers free, le plan assigné reste lisible, aucune
-- donnée n'est touchée, le profil reste publié.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Les secrets, dans le vault
-- ---------------------------------------------------------------------------

-- Même motif que private.resend_api_key() (B2) : la valeur vit chiffrée dans
-- supabase_vault, installée par db/seeds/b3_install_stripe_secrets.sh qui lit
-- .env (non suivi) et n'affiche rien. Aucun rôle client ne peut exécuter ces
-- fonctions.

create or replace function private.stripe_secret_key()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'stripe_secret_key'
  limit 1;
$$;

revoke all on function private.stripe_secret_key() from public, anon, authenticated;

create or replace function private.stripe_webhook_secret()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'stripe_webhook_secret'
  limit 1;
$$;

revoke all on function private.stripe_webhook_secret() from public, anon, authenticated;

-- L'INTERRUPTEUR de mode. Tant qu'il rend false, tout — résolution de prix,
-- refus d'événements, scripts — travaille en mode test. Le passage en mode
-- réel est une décision du fondateur qui se matérialisera par une migration
-- d'une ligne, relue et voulue, jamais par un paramètre d'appel.
create or replace function private.billing_livemode()
returns boolean
language sql
immutable
set search_path to ''
as $$
  select false;
$$;

comment on function private.billing_livemode() is
'false = mode test Stripe, partout. Le point UNIQUE à changer le jour où le fondateur décide le passage en mode réel — par migration relue, jamais par argument.';

revoke all on function private.billing_livemode() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le journal des événements
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_webhook_events (
  -- LA clé d'idempotence : l'identifiant d'événement DE STRIPE. Un rejeu du
  -- même evt_... ne peut physiquement pas produire une seconde ligne.
  event_id text primary key,
  event_type text not null,
  livemode boolean not null,
  payload jsonb not null,
  status text not null default 'queued',
  error text,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint stripe_webhook_events_id_shape check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  constraint stripe_webhook_events_status_known
    check (status in ('queued', 'processed', 'skipped', 'failed', 'rejected')),
  constraint stripe_webhook_events_attempts_sane check (attempts >= 0)
);

create index if not exists stripe_webhook_events_queued_idx
  on public.stripe_webhook_events (received_at) where status = 'queued';

create index if not exists stripe_webhook_events_type_idx
  on public.stripe_webhook_events (event_type, received_at desc);

alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_webhook_events force row level security;

-- Lecture : plateforme uniquement. C'est un journal d'exploitation — quand
-- une facturation part de travers, c'est ici qu'on lit ce qui s'est passé.
drop policy if exists stripe_webhook_events_select_platform on public.stripe_webhook_events;
create policy stripe_webhook_events_select_platform on public.stripe_webhook_events
  for select to authenticated
  using ((select private.is_platform_admin()));

-- Aucun droit client. L'écriture arrive par la fonction Edge (service_role,
-- qui contourne la RLS par attribut de rôle) et par le traitement SECURITY
-- DEFINER du scheduler.
revoke all on table public.stripe_webhook_events from anon, authenticated;
grant select on table public.stripe_webhook_events to authenticated;

comment on table public.stripe_webhook_events is
'Journal des webhooks Stripe : charge utile brute et résultat de traitement. Clé primaire = identifiant d''événement Stripe, donc idempotence par construction. Écrit par la fonction Edge stripe-webhook APRÈS vérification de signature ; traité en asynchrone par run_billing_maintenance.';

-- ---------------------------------------------------------------------------
-- 3. Appliquer un état de facturation au plan commercial
-- ---------------------------------------------------------------------------

create or replace function private.apply_billing_state(
  p_organization_id uuid,
  p_plan_key text,
  p_status public.commercial_status,
  p_note text,
  p_customer_ref text default null,
  p_subscription_ref text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old_plan text;
  v_old_status public.commercial_status;
begin
  perform private.ensure_organization_commercial_state(p_organization_id);

  select s.plan_key, s.status into v_old_plan, v_old_status
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  if v_old_plan = p_plan_key and v_old_status = p_status then
    return; -- rien à changer, et le rejeu d'un événement passe par ici.
  end if;

  -- free_is_active : le plan free ne connaît pas past_due/canceled. Un retour
  -- au Free se dit donc « status canceled sur le plan assigné », jamais
  -- « plan_key free » — c'est aussi ce qui évite la garde de capacité, qui
  -- refuserait (à raison) free à une organisation multi-établissements.
  if p_plan_key = 'free' and p_status <> 'active' then
    raise exception 'billing state: free implies active — use canceled on the assigned plan instead'
      using errcode = 'P0001';
  end if;

  update public.organization_commercial_state
  set plan_key = p_plan_key,
      status = p_status,
      entitlement_source = 'billing',
      provider = 'stripe',
      provider_customer_ref = coalesce(p_customer_ref, provider_customer_ref),
      provider_subscription_ref = coalesce(p_subscription_ref, provider_subscription_ref),
      assigned_at = now(),
      assigned_by = null,
      assignment_note = p_note
  where organization_id = p_organization_id;

  -- L'historique append-only, comme pour toute décision de plan.
  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (p_organization_id, v_old_plan, p_plan_key,
     v_old_status, p_status, 'billing', null, p_note);
end;
$$;

comment on function private.apply_billing_state(uuid, text, public.commercial_status, text, text, text) is
'L''unique écriture de l''état commercial par la facturation : plan + statut, source billing, provider stripe, historique append-only. Le retour au Free est status=canceled sur le plan assigné (mécanisme R2), jamais plan_key=free — voir l''en-tête de la migration.';

revoke all on function private.apply_billing_state(uuid, text, public.commercial_status, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Les gabarits de la grâce
-- ---------------------------------------------------------------------------

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html)
values
  ('payment_failed_notice', 'fr', 'transactional',
   'Échec de paiement — votre abonnement FadeUp',
   E'Bonjour {{owner_name}},\n\nLe paiement de l''abonnement de {{organization_name}} a échoué.\n\nVos fonctions professionnelles restent actives jusqu''au {{grace_until_fr}}. Sans paiement d''ici là, votre compte reviendra au plan Free : profil publié et données conservées, mais réservation en ligne et fonctions professionnelles suspendues.\n\nMettez à jour votre moyen de paiement : {{billing_url}}\n\nL''équipe FadeUp',
   '<p>Bonjour {{owner_name}},</p><p>Le paiement de l''abonnement de <strong>{{organization_name}}</strong> a échoué.</p><p>Vos fonctions professionnelles restent actives jusqu''au <strong>{{grace_until_fr}}</strong>. Sans paiement d''ici là, votre compte reviendra au plan Free : profil publié et données conservées, mais réservation en ligne et fonctions professionnelles suspendues.</p><p><a href="{{billing_url}}">Mettre à jour mon moyen de paiement</a></p><p>L''équipe FadeUp</p>'),
  ('payment_failed_notice', 'en', 'transactional',
   'Payment failed — your FadeUp subscription',
   E'Hello {{owner_name}},\n\nThe payment for {{organization_name}}''s subscription failed.\n\nYour professional features stay active until {{grace_until_en}}. Without a successful payment by then, your account will return to the Free plan: profile published and data kept, but online booking and professional features suspended.\n\nUpdate your payment method: {{billing_url}}\n\nThe FadeUp team',
   '<p>Hello {{owner_name}},</p><p>The payment for <strong>{{organization_name}}</strong>''s subscription failed.</p><p>Your professional features stay active until <strong>{{grace_until_en}}</strong>. Without a successful payment by then, your account will return to the Free plan: profile published and data kept, but online booking and professional features suspended.</p><p><a href="{{billing_url}}">Update my payment method</a></p><p>The FadeUp team</p>')
on conflict (template_key, locale) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Le traitement d'un événement
-- ---------------------------------------------------------------------------

create or replace function private.process_stripe_event(p_event_id text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_event public.stripe_webhook_events;
  v_obj jsonb;
  v_org uuid;
  v_plan text;
  v_price_id text;
  v_sub_status text;
  v_recipient record;
  v_org_name text;
  v_grace timestamptz;
begin
  select * into v_event
  from public.stripe_webhook_events e
  where e.event_id = p_event_id
  for update skip locked;

  if v_event.event_id is null or v_event.status <> 'queued' then
    return 'skipped';
  end if;

  -- Deuxième barrière de mode : un événement de mode réel n'est pas traité
  -- tant que la base est en mode test, et il le dit.
  if v_event.livemode is distinct from private.billing_livemode() then
    update public.stripe_webhook_events
    set status = 'rejected', error = 'livemode mismatch', processed_at = now(),
        attempts = attempts + 1
    where event_id = p_event_id;
    return 'rejected';
  end if;

  v_obj := v_event.payload -> 'data' -> 'object';

  -- L'organisation : par les métadonnées (posées par nous à la création de la
  -- session et de l'abonnement), sinon par le client Stripe déjà connu.
  v_org := coalesce(
    nullif(v_obj -> 'metadata' ->> 'organization_id', '')::uuid,
    nullif(v_obj -> 'subscription_details' -> 'metadata' ->> 'organization_id', '')::uuid,
    (select b.organization_id from public.organization_billing b
     where b.stripe_customer_id = v_obj ->> 'customer'));

  case v_event.event_type

  when 'checkout.session.completed' then
    if v_org is null then
      update public.stripe_webhook_events
      set status = 'failed', error = 'no organization resolvable from session', attempts = attempts + 1
      where event_id = p_event_id;
      return 'failed';
    end if;

    -- La session lie l'organisation au client Stripe ; l'abonnement lui-même
    -- arrive par customer.subscription.created. Le numéro de TVA collecté par
    -- le Checkout est enregistré ici.
    insert into public.organization_billing (organization_id, stripe_customer_id, livemode)
    values (v_org, v_obj ->> 'customer', v_event.livemode)
    on conflict (organization_id) do update
      set stripe_customer_id = excluded.stripe_customer_id;

    update public.organization_billing
    set tax_id_type = coalesce(v_obj -> 'customer_details' -> 'tax_ids' -> 0 ->> 'type', tax_id_type),
        tax_id_value = coalesce(v_obj -> 'customer_details' -> 'tax_ids' -> 0 ->> 'value', tax_id_value)
    where organization_id = v_org;

  when 'customer.subscription.created', 'customer.subscription.updated' then
    if v_org is null then
      update public.stripe_webhook_events
      set status = 'failed', error = 'no organization resolvable from subscription', attempts = attempts + 1
      where event_id = p_event_id;
      return 'failed';
    end if;

    v_price_id := v_obj -> 'items' -> 'data' -> 0 -> 'price' ->> 'id';
    v_sub_status := v_obj ->> 'status';

    select sp.plan_key into v_plan
    from public.billing_stripe_prices sp
    where sp.stripe_price_id = v_price_id;

    if v_plan is null then
      update public.stripe_webhook_events
      set status = 'failed', error = 'unknown stripe price: ' || coalesce(v_price_id, 'null'), attempts = attempts + 1
      where event_id = p_event_id;
      return 'failed';
    end if;

    insert into public.organization_billing (organization_id, livemode)
    values (v_org, v_event.livemode)
    on conflict (organization_id) do nothing;

    update public.organization_billing
    set stripe_customer_id = coalesce(v_obj ->> 'customer', stripe_customer_id),
        stripe_subscription_id = v_obj ->> 'id',
        stripe_subscription_item_id = v_obj -> 'items' -> 'data' -> 0 ->> 'id',
        subscription_status = v_sub_status,
        plan_key = v_plan,
        billing_interval = case v_obj -> 'items' -> 'data' -> 0 -> 'price' -> 'recurring' ->> 'interval'
                             when 'year' then 'year'::public.stripe_billing_interval
                             else 'month'::public.stripe_billing_interval end,
        stripe_price_id = v_price_id,
        current_period_start = to_timestamp((v_obj -> 'items' -> 'data' -> 0 ->> 'current_period_start')::bigint),
        current_period_end = to_timestamp((v_obj -> 'items' -> 'data' -> 0 ->> 'current_period_end')::bigint),
        cancel_at_period_end = coalesce((v_obj ->> 'cancel_at_period_end')::boolean, false),
        -- Le programmé qui vient de s'appliquer s'efface : le webhook est la
        -- confirmation qu'on attendait.
        scheduled_plan_key = case when scheduled_plan_key = v_plan then null else scheduled_plan_key end,
        scheduled_interval = case when scheduled_plan_key = v_plan then null else scheduled_interval end,
        scheduled_effective_at = case when scheduled_plan_key = v_plan then null else scheduled_effective_at end,
        scheduled_dispatched_at = case when scheduled_plan_key = v_plan then null else scheduled_dispatched_at end
    where organization_id = v_org;

    if v_sub_status in ('active', 'trialing') then
      perform private.apply_billing_state(
        v_org, v_plan, 'active',
        'stripe subscription ' || (v_obj ->> 'id') || ' ' || v_sub_status,
        v_obj ->> 'customer', v_obj ->> 'id');
      -- Un paiement réussi clôt la grâce.
      update public.organization_billing set grace_until = null where organization_id = v_org;
      -- Et convertit l'essai, s'il courait encore.
      update public.organization_trials
      set status = 'converted', converted_at = now()
      where organization_id = v_org and status = 'active';
    elsif v_sub_status = 'past_due' then
      perform private.apply_billing_state(
        v_org, v_plan, 'past_due',
        'stripe subscription ' || (v_obj ->> 'id') || ' past_due',
        v_obj ->> 'customer', v_obj ->> 'id');
    elsif v_sub_status in ('canceled', 'unpaid', 'incomplete_expired') then
      perform private.apply_billing_state(
        v_org, v_plan, 'canceled',
        'stripe subscription ' || (v_obj ->> 'id') || ' ' || v_sub_status,
        v_obj ->> 'customer', v_obj ->> 'id');
      update public.organization_billing set grace_until = null where organization_id = v_org;
    end if;
    -- incomplete / paused : on note (organization_billing est à jour), on ne
    -- change pas l'état commercial.

  when 'customer.subscription.deleted' then
    if v_org is not null then
      update public.organization_billing
      set subscription_status = 'canceled',
          cancel_at_period_end = false,
          grace_until = null,
          scheduled_plan_key = null, scheduled_interval = null,
          scheduled_effective_at = null, scheduled_dispatched_at = null
      where organization_id = v_org;

      -- Retour au Free : statut canceled sur le plan assigné. Profil,
      -- réputation, relations et historique conservés — la RGPD est une
      -- procédure distincte, hors de ce chantier.
      perform private.apply_billing_state(
        v_org,
        (select s.plan_key from public.organization_commercial_state s
         where s.organization_id = v_org),
        'canceled',
        'stripe subscription deleted: ' || (v_obj ->> 'id'),
        v_obj ->> 'customer', v_obj ->> 'id');
    end if;

  when 'invoice.paid' then
    if v_org is not null then
      update public.organization_billing
      set grace_until = null
      where organization_id = v_org;
    end if;

  when 'invoice.payment_failed' then
    if v_org is not null then
      -- SEPT JOURS, comptés du PREMIER échec : un nouvel échec pendant la
      -- grâce ne remet pas le compteur à zéro.
      update public.organization_billing
      set grace_until = coalesce(grace_until, now() + interval '7 days')
      where organization_id = v_org
      returning grace_until into v_grace;

      update public.organization_commercial_state
      set status = 'past_due'
      where organization_id = v_org
        and status = 'active' and plan_key <> 'free';

      -- Prévenu tout de suite (J0). Les relances J+1, J+3, J+6 appartiennent
      -- au balayage — elles sont dues plus tard.
      select o.name into v_org_name from public.organizations o where o.id = v_org;
      select * into v_recipient from private.org_owner_recipient(v_org);
      if v_recipient.email is not null then
        insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
        values (
          v_recipient.email, 'payment_failed_notice', v_recipient.locale,
          jsonb_build_object(
            'owner_name', v_recipient.owner_name,
            'organization_name', v_org_name,
            'grace_until_fr', to_char(v_grace at time zone 'Europe/Paris', 'DD/MM/YYYY'),
            'grace_until_en', to_char(v_grace at time zone 'Europe/Paris', 'FMMonth DD, YYYY'),
            'billing_url', 'https://fade-up.com/pro/billing'),
          'transactional',
          'grace:' || v_org::text || ':' || to_char(v_grace, 'YYYYMMDD') || ':0')
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;

  when 'customer.subscription.trial_will_end' then
    -- L'essai FadeUp vit en base (organization_trials), sans carte et sans
    -- essai Stripe : cet événement ne peut venir que d'un abonnement créé à
    -- la main dans le dashboard. Traité = journalisé, sans effet.
    null;

  else
    update public.stripe_webhook_events
    set status = 'skipped', error = 'unhandled event type', processed_at = now(),
        attempts = attempts + 1
    where event_id = p_event_id;
    return 'skipped';
  end case;

  update public.stripe_webhook_events
  set status = 'processed', processed_at = now(), error = null,
      attempts = attempts + 1
  where event_id = p_event_id;
  return 'processed';

exception when others then
  -- L'échec est une INFORMATION : il reste dans le journal avec son motif, et
  -- l'événement ne bloque pas les suivants.
  update public.stripe_webhook_events
  set status = 'failed', error = sqlerrm, attempts = attempts + 1
  where event_id = p_event_id;
  return 'failed';
end;
$$;

comment on function private.process_stripe_event(text) is
'Traduit UN événement Stripe en état FadeUp : abonnement -> plan et statut (source billing), échec de paiement -> sept jours de grâce + e-mail J0, suppression -> retour au Free par status canceled. Toute erreur est capturée dans le journal, jamais propagée au lot.';

revoke all on function private.process_stripe_event(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Le balayage de facturation
-- ---------------------------------------------------------------------------

create or replace function public.run_billing_maintenance()
returns table (events_processed integer, dunning_queued integer, graces_expired integer, changes_dispatched integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_events integer := 0;
  v_dunning integer := 0;
  v_graces integer := 0;
  v_dispatched integer := 0;
  v_id text;
  v_row record;
  v_recipient record;
  v_touch integer;
  v_key text;
  v_price text;
begin
  -- 6a. Les événements en attente, dans l'ordre d'arrivée.
  for v_id in
    select e.event_id from public.stripe_webhook_events e
    where e.status = 'queued'
    order by e.received_at
    limit 50
  loop
    perform private.process_stripe_event(v_id);
    v_events := v_events + 1;
  end loop;

  -- 6b. Les relances de grâce : J+1, J+3, J+6 après le premier échec.
  -- Idempotentes par dedupe_key, fenêtres ouvertes vers le haut pour qu'un
  -- scheduler resté muet rattrape la relance en retard plutôt que de la
  -- sauter.
  for v_row in
    select b.organization_id, b.grace_until, o.name as organization_name,
           extract(day from now() - (b.grace_until - interval '7 days'))::integer as day_in_grace
    from public.organization_billing b
    join public.organizations o on o.id = b.organization_id
    where b.grace_until is not null and b.grace_until > now()
  loop
    v_touch := case
      when v_row.day_in_grace >= 6 then 6
      when v_row.day_in_grace >= 3 then 3
      when v_row.day_in_grace >= 1 then 1
      else 0 end;
    if v_touch = 0 then
      continue; -- J0 est envoyé par le traitement de l'événement lui-même.
    end if;

    v_key := 'grace:' || v_row.organization_id::text || ':'
             || to_char(v_row.grace_until, 'YYYYMMDD') || ':' || v_touch::text;

    select * into v_recipient from private.org_owner_recipient(v_row.organization_id);
    if v_recipient.email is null then
      continue;
    end if;

    insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
    values (
      v_recipient.email, 'payment_failed_notice', v_recipient.locale,
      jsonb_build_object(
        'owner_name', v_recipient.owner_name,
        'organization_name', v_row.organization_name,
        'grace_until_fr', to_char(v_row.grace_until at time zone 'Europe/Paris', 'DD/MM/YYYY'),
        'grace_until_en', to_char(v_row.grace_until at time zone 'Europe/Paris', 'FMMonth DD, YYYY'),
        'billing_url', 'https://fade-up.com/pro/billing'),
      'transactional', v_key)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_dunning := v_dunning + 1;
    end if;
  end loop;

  -- 6c. La grâce échue : retour au Free (status canceled), et l'abonnement
  -- Stripe est résilié — sans quoi Stripe continuerait de facturer un client
  -- redevenu Free. La résiliation part par pg_net, fire-and-forget : le
  -- webhook subscription.deleted confirmera. La clé peut manquer (base de
  -- test restaurée) : l'état FadeUp dégrade quand même, c'est lui qui compte.
  for v_row in
    select b.organization_id, b.stripe_subscription_id
    from public.organization_billing b
    join public.organization_commercial_state s on s.organization_id = b.organization_id
    where b.grace_until is not null and b.grace_until <= now()
  loop
    perform private.apply_billing_state(
      v_row.organization_id,
      (select s.plan_key from public.organization_commercial_state s
       where s.organization_id = v_row.organization_id),
      'canceled',
      'grace period expired without payment');

    update public.organization_billing
    set grace_until = null
    where organization_id = v_row.organization_id;

    if v_row.stripe_subscription_id is not null
       and private.stripe_secret_key() is not null then
      perform net.http_delete(
        url := 'https://api.stripe.com/v1/subscriptions/' || v_row.stripe_subscription_id,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || private.stripe_secret_key()),
        timeout_milliseconds := 15000);
    end if;

    v_graces := v_graces + 1;
  end loop;

  -- 6d. Les changements programmés arrivés à terme (descente de gamme, retour
  -- au mensuel, bascule de palier) : transmis à Stripe par pg_net, SANS
  -- proratisation — la période qui commence est facturée au nouveau tarif,
  -- celle qui s'achève ne bouge pas. Le webhook subscription.updated
  -- confirmera et effacera le programmé ; en attendant, scheduled_dispatched_at
  -- évite la répétition, avec une re-tentative au bout de six heures.
  for v_row in
    select b.organization_id, b.stripe_subscription_id, b.stripe_subscription_item_id,
           b.scheduled_plan_key, b.scheduled_interval
    from public.organization_billing b
    where b.scheduled_plan_key is not null
      and b.scheduled_effective_at is not null
      and b.scheduled_effective_at <= now()
      and (b.scheduled_dispatched_at is null
           or b.scheduled_dispatched_at < now() - interval '6 hours')
      and b.stripe_subscription_id is not null
      and b.stripe_subscription_item_id is not null
  loop
    if private.stripe_secret_key() is null then
      exit; -- environnement sans clé : rien à transmettre, pas de bruit.
    end if;

    select sp.stripe_price_id into v_price
    from public.billing_stripe_prices sp
    where sp.plan_key = v_row.scheduled_plan_key
      and sp.billing_interval = coalesce(v_row.scheduled_interval, 'month')
      and sp.livemode = private.billing_livemode()
      and sp.is_active;

    if v_price is null then
      continue;
    end if;

    -- Les paramètres passent dans la CHAÎNE DE REQUÊTE : pg_net ne sait
    -- poster que du JSON, que l'API Stripe refuse, mais Stripe accepte ses
    -- paramètres en query string sur un POST — vérifié contre l'API de test.
    -- Les identifiants (si_..., price_...) sont de l'ASCII sûr, rien à encoder.
    perform net.http_post(
      url := 'https://api.stripe.com/v1/subscriptions/' || v_row.stripe_subscription_id
          || '?items[0][id]=' || v_row.stripe_subscription_item_id
          || '&items[0][price]=' || v_price
          || '&proration_behavior=none',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || private.stripe_secret_key()),
      timeout_milliseconds := 15000);

    update public.organization_billing
    set scheduled_dispatched_at = now()
    where organization_id = v_row.organization_id;

    v_dispatched := v_dispatched + 1;
  end loop;

  return query select v_events, v_dunning, v_graces, v_dispatched;
end;
$$;

comment on function public.run_billing_maintenance() is
'Passe dédiée du scheduler (même règle que B2 : un domaine en panne ne bloque pas les autres) : traite les webhooks en file, relance la grâce à J+1/J+3/J+6, clôt la grâce échue (retour au Free + résiliation Stripe), transmet à Stripe les changements de plan programmés arrivés à terme.';

revoke all on function public.run_billing_maintenance() from public, anon, authenticated;
grant execute on function public.run_billing_maintenance() to fadeup_scheduler;

commit;
