-- FadeUp — B3, chantier 2 : l'essai de 14 jours.
--
-- LA DÉCISION PRODUIT, TELLE QUELLE
--
-- L'essai démarre À LA FIN DE L'ONBOARDING, quand l'organisation devient
-- réellement réservable — c'est-à-dire quand `ready_to_publish` passe à vrai.
-- Pas à la revendication (ça brûlerait des jours sur du paramétrage), pas sur
-- un bouton (une partie ne le presserait jamais). Sans carte bancaire — acté
-- au MASTER_SPEC §4. La revendication et l'onboarding restent gratuits et ne
-- consomment rien.
--
-- CE QUE L'ESSAI OUVRE
--
-- Le niveau Shop Pro (`salon_pro`) — le plan mis en avant. Pour un
-- `solo_professional` : `solo` (Independent), l'équivalent à son échelle.
-- Décision prise seule, documentée au rapport : une organisation qui opère
-- déjà PLUSIEURS établissements reçoit le palier multi_salon couvrant son
-- nombre d'établissements — un essai `salon_pro` la plafonnerait à un
-- établissement et bloquerait sa croissance pendant l'essai, l'inverse de ce
-- qu'un essai doit prouver.
--
-- LE MÉCANISME : PAR effective_plan_key, PAS À CÔTÉ
--
-- `private.org_has_capability` joint sur `private.effective_plan_key`. C'est
-- LE point unique où l'autorisation commerciale se résout, et l'essai passe
-- par lui : un essai actif et non échu SURCLASSE un plan effectif `free`.
-- Rien d'autre ne change — pas de colonne de capacités parallèle, pas de
-- contournement de org_has_capability, et `book_public_appointment` bascule
-- de `pending` à `confirmed` sans qu'une ligne de B2 ne change.
--
-- Un plan payé (grant ou billing) gagne toujours sur l'essai : l'essai ne
-- soulève que depuis `free`.
--
-- UNIQUE PAR ORGANISATION
--
-- `organization_trials` a sa clé primaire sur organization_id : une ligne,
-- pour toujours. Expirée, convertie — la ligne reste, et c'est elle qui rend
-- l'essai non relançable, y compris après retour au Free.
--
-- À L'ÉCHÉANCE
--
-- Retour au Free, automatique : l'essai échu cesse simplement de surclasser.
-- Aucune donnée supprimée, les fonctions payantes deviennent indisponibles,
-- le profil reste publié — MASTER_SPEC §4, mot pour mot. Rappels par e-mail
-- à J-3 et la veille, via email_outbox. Jamais de SMS.
--
-- LE BALAYAGE
--
-- `run_trial_maintenance()`, passe DÉDIÉE du scheduler — pas une charge de
-- plus sur une passe existante : une panne d'un domaine ne doit pas bloquer
-- un autre (leçon B2). Elle démarre les essais devenus éligibles, met en file
-- les rappels dus, et clôt les essais échus.
--
-- LES ORGANISATIONS D'AVANT B3
--
-- Le démarrage automatique ne vaut que pour un onboarding terminé À PARTIR de
-- la mise en production de B3 (le seuil est une constante datée, assumée et
-- commentée dans la fonction). Démarrer d'office l'essai des organisations
-- déjà en place aurait brûlé leurs quatorze jours à leur insu — elles passent
-- par `start_organization_trial`, le déclenchement explicite du propriétaire.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------------

create table if not exists public.organization_trials (
  -- CLÉ PRIMAIRE = organization_id. C'est la contrainte qui fait qu'un essai
  -- est unique par organisation : il n'y a pas de place pour un second.
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  plan_key text not null
    references public.commercial_plans(plan_key) on update cascade on delete restrict,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active',
  -- D'où l'essai est parti : la fin d'onboarding (auto) ou le propriétaire
  -- (explicite). Utile le jour où un professionnel conteste sa date.
  started_from text not null default 'onboarding',
  converted_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_trials_status_known
    check (status in ('active', 'converted', 'expired')),
  constraint organization_trials_source_known
    check (started_from in ('onboarding', 'owner_request')),
  constraint organization_trials_window_ordered check (ends_at > started_at),
  constraint organization_trials_lifecycle_coherent check (
    (status = 'active' and converted_at is null and expired_at is null)
    or (status = 'converted' and converted_at is not null)
    or (status = 'expired' and expired_at is not null))
);

-- Le balayage d'expiration et l'overlay d'effective_plan_key cherchent tous
-- deux « actif, échéance ».
create index if not exists organization_trials_active_idx
  on public.organization_trials (ends_at) where status = 'active';

alter table public.organization_trials enable row level security;
alter table public.organization_trials force row level security;

-- Le propriétaire voit son essai — l'échéance est une information de premier
-- plan pour lui. Manager et autres rôles : rien, c'est de la facturation.
drop policy if exists organization_trials_select_owner on public.organization_trials;
create policy organization_trials_select_owner on public.organization_trials
  for select to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

revoke all on table public.organization_trials from anon, authenticated;
grant select on table public.organization_trials to authenticated;

drop trigger if exists organization_trials_set_updated_at on public.organization_trials;
create trigger organization_trials_set_updated_at
  before update on public.organization_trials
  for each row execute function public.set_updated_at();

comment on table public.organization_trials is
'Essai de 14 jours, unique par organisation (clé primaire = organization_id, la ligne ne se supprime jamais). Un essai actif surclasse un plan effectif free dans private.effective_plan_key ; échu ou converti, il cesse de surclasser et tout revient au plan réel, sans suppression de données.';

-- ---------------------------------------------------------------------------
-- 2. effective_plan_key apprend l'essai
-- ---------------------------------------------------------------------------

-- LE point de jonction de tout le chantier. org_has_capability,
-- get_organization_entitlements, book_public_appointment,
-- get_public_booking_alternatives, les gardes de capacité : tous résolvent le
-- plan par cette fonction. L'essai n'existe qu'ici, donc il existe partout.
create or replace function private.effective_plan_key(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
    -- Un plan payé et vivant gagne toujours : l'essai ne surclasse que `free`.
    when s.status <> 'canceled' and s.plan_key <> 'free' then s.plan_key
    else coalesce(
      (select t.plan_key
       from public.organization_trials t
       where t.organization_id = s.organization_id
         and t.status = 'active'
         and t.ends_at > now()),
      'free')
  end
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id;
$$;

comment on function private.effective_plan_key(uuid) is
'Le plan qui fait autorité pour les capacités et les plafonds. status=canceled dégrade vers free ; un essai actif (organization_trials) surclasse free — et seulement free : un plan payé gagne toujours. À l''échéance de l''essai, le retour au Free est automatique et ne demande aucune écriture.';

-- ---------------------------------------------------------------------------
-- 3. La condition de déclenchement, lisible sans session
-- ---------------------------------------------------------------------------

-- Jumelle booléenne de public.get_organization_readiness : MÊMES conditions,
-- sans l'exigence d'une session authentifiée — le scheduler n'en a pas.
-- Si l'une des deux évolue, l'autre doit évoluer avec elle ; verify_b3.sql
-- les confronte sur les organisations réelles.
create or replace function private.org_ready_to_publish(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    -- ready_to_book : tout ce dont get_public_available_slots dépend.
    exists (select 1 from public.locations l
            where l.organization_id = o.id and l.is_active)
    and exists (select 1 from public.locations l
            where l.organization_id = o.id and l.is_active
              and nullif(btrim(coalesce(l.timezone, '')), '') is not null)
    and exists (select 1 from public.barbers b
            join public.staff_profiles sp on sp.id = b.staff_profile_id
            join public.locations l on l.id = sp.location_id and l.is_active
            where b.organization_id = o.id
              and b.is_bookable and sp.is_active and sp.is_public)
    and exists (select 1 from public.services s
            where s.organization_id = o.id and s.is_active)
    and exists (select 1 from public.services s
            join public.service_locations sl on sl.service_id = s.id
            join public.locations l on l.id = sl.location_id and l.is_active
            where s.organization_id = o.id and s.is_active)
    and exists (select 1 from public.services s
            join public.barber_services bs on bs.service_id = s.id
            join public.barbers b on b.id = bs.barber_id and b.is_bookable
            join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
            where s.organization_id = o.id and s.is_active)
    and exists (select 1 from public.location_hours lh
            join public.locations l on l.id = lh.location_id and l.is_active
            where l.organization_id = o.id and not lh.is_closed)
    and exists (select 1 from public.barber_working_hours bwh
            join public.barbers b on b.id = bwh.barber_id and b.is_bookable
            join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
            where b.organization_id = o.id and not bwh.is_off)
    -- ready_to_publish : les faits tournés vers la marketplace.
    and o.business_type is not null
    and o.currency is not null
    and (
      exists (select 1 from public.locations l
              where l.organization_id = o.id and l.is_active
                and l.kind = 'physical_address'
                and nullif(btrim(coalesce(l.address_line1, '')), '') is not null
                and nullif(btrim(coalesce(l.city, '')), '') is not null
                and nullif(btrim(coalesce(l.country, '')), '') is not null)
      or exists (select 1 from public.locations l
              where l.organization_id = o.id and l.is_active
                and l.kind = 'service_area'))
    and exists (select 1 from public.staff_profiles sp
            where sp.organization_id = o.id and sp.is_public and sp.is_active
              and nullif(btrim(coalesce(sp.display_name, '')), '') is not null)
  from public.organizations o
  where o.id = p_organization_id;
$$;

comment on function private.org_ready_to_publish(uuid) is
'ready_to_publish de get_organization_readiness, sans exigence de session — pour le scheduler. Les deux implémentations portent les MÊMES conditions ; verify_b3.sql les confronte.';

revoke all on function private.org_ready_to_publish(uuid) from public, anon, authenticated;

-- Pas de `comment on function public.get_organization_readiness` ici : elle
-- appartient à supabase_admin (héritage des lots MASTER) et cette migration
-- s'applique en tant que postgres — le bac d'essai fidèle l'a refusé, comme
-- il devait. L'avertissement de jumelage vit sur la jumelle, au-dessus.

-- ---------------------------------------------------------------------------
-- 4. Le niveau accordé
-- ---------------------------------------------------------------------------

create or replace function private.trial_plan_for_org(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when o.business_type = 'solo_professional' then 'solo'
    when private.org_active_establishments(o.id) > 1 then
      -- Plusieurs établissements : le palier multi_salon qui les couvre.
      -- Sans plafond satisfait (plus de 15), le plus haut palier — un essai
      -- ne bloque jamais une organisation qui grandit.
      coalesce(
        (select p.plan_key from public.commercial_plans p
         where p.commercial_family = 'multi_salon' and p.is_available
           and p.max_establishments >= private.org_active_establishments(o.id)
         order by p.tier asc limit 1),
        (select p.plan_key from public.commercial_plans p
         where p.commercial_family = 'multi_salon' and p.is_available
         order by p.tier desc limit 1))
    else 'salon_pro'
  end
  from public.organizations o
  where o.id = p_organization_id;
$$;

comment on function private.trial_plan_for_org(uuid) is
'Le niveau ouvert par l''essai : Shop Pro (salon_pro), le plan mis en avant — un essai d''entrée de gamme ne prouverait pas ce pour quoi le professionnel paiera. Independent (solo) pour un solo_professional. Palier multi_salon couvrant pour une organisation déjà multi-établissements.';

revoke all on function private.trial_plan_for_org(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Le démarrage
-- ---------------------------------------------------------------------------

create or replace function private.start_trial_if_eligible(
  p_organization_id uuid,
  p_source text default 'onboarding'
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_effective text;
begin
  -- Une seule vérité sur l'éligibilité, partagée par la fin d'onboarding, la
  -- RPC du propriétaire et le balayage du scheduler.

  -- Jamais deux essais. La clé primaire le garantit aussi ; tester d'abord
  -- évite de compter sur une exception pour le chemin normal.
  if exists (select 1 from public.organization_trials t
             where t.organization_id = p_organization_id) then
    return false;
  end if;

  -- L'essai ne soulève que depuis free. Une organisation en grant ou en
  -- billing n'a rien à essayer — elle a déjà plus.
  v_effective := private.effective_plan_key(p_organization_id);
  if v_effective is distinct from 'free' then
    return false;
  end if;

  -- La condition produit : réellement réservable.
  if not coalesce(private.org_ready_to_publish(p_organization_id), false) then
    return false;
  end if;

  -- Il faut quelqu'un à qui l'essai profite et à qui écrire les rappels.
  if not exists (select 1 from public.memberships m
                 where m.organization_id = p_organization_id and m.role = 'owner') then
    return false;
  end if;

  insert into public.organization_trials
    (organization_id, plan_key, started_at, ends_at, status, started_from)
  values
    (p_organization_id,
     private.trial_plan_for_org(p_organization_id),
     now(), now() + interval '14 days', 'active', p_source)
  on conflict (organization_id) do nothing;

  return found;
end;
$$;

comment on function private.start_trial_if_eligible(uuid, text) is
'L''unique chemin de démarrage d''un essai : jamais deux, seulement depuis free, seulement une organisation réellement réservable, seulement avec un propriétaire. 14 jours, niveau décidé par trial_plan_for_org.';

revoke all on function private.start_trial_if_eligible(uuid, text) from public, anon, authenticated;

-- Le déclenchement explicite, pour le propriétaire — notamment les
-- organisations d'avant B3, que le démarrage automatique épargne exprès.
create or replace function public.start_organization_trial(p_organization_id uuid)
returns table (plan_key text, started_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'starting a trial requires an authenticated session'
      using errcode = '42501';
  end if;

  -- Propriétaire uniquement. La facturation — et l'essai en est l'antichambre
  -- — n'appartient ni au manager, ni à la réceptionniste, ni au barber.
  if not (select private.has_org_role(p_organization_id, array['owner']::public.membership_role[])) then
    raise exception 'only the organization owner may start the trial'
      using errcode = '42501';
  end if;

  -- Les refus disent POURQUOI : l'interface a besoin d'un motif exploitable.
  if exists (select 1 from public.organization_trials t
             where t.organization_id = p_organization_id) then
    raise exception 'this organization already used its trial'
      using errcode = 'P0001',
            hint = 'A trial is unique per organization and cannot be restarted, even after returning to Free.';
  end if;

  if private.effective_plan_key(p_organization_id) is distinct from 'free' then
    raise exception 'a trial can only start from the Free plan'
      using errcode = 'P0001';
  end if;

  if not coalesce(private.org_ready_to_publish(p_organization_id), false) then
    raise exception 'the organization is not ready: complete onboarding first'
      using errcode = 'P0001',
            hint = 'get_organization_readiness lists exactly what is missing.';
  end if;

  if not private.start_trial_if_eligible(p_organization_id, 'owner_request') then
    -- Tous les motifs lisibles ont été testés au-dessus ; s'il reste un refus,
    -- c'est une course avec un autre démarrage. Le dire tel quel.
    raise exception 'the trial could not be started — it may have just been started elsewhere'
      using errcode = 'P0001';
  end if;

  return query
  select t.plan_key, t.started_at, t.ends_at
  from public.organization_trials t
  where t.organization_id = p_organization_id;
end;
$$;

comment on function public.start_organization_trial(uuid) is
'Démarrage explicite de l''essai par le propriétaire. Le démarrage normal est automatique à la fin de l''onboarding ; cette RPC existe pour les organisations installées avant B3 et pour toute reprise en main. Refus motivés : déjà consommé, pas sur Free, pas prête.';

revoke all on function public.start_organization_trial(uuid) from public, anon;
grant execute on function public.start_organization_trial(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Comment la fin d'onboarding déclenche l'essai
-- ---------------------------------------------------------------------------

-- PAS en modifiant complete_onboarding : cette fonction appartient à
-- supabase_admin (héritage des lots MASTER) et cette migration s'applique en
-- tant que postgres — le bac d'essai fidèle a refusé la redéfinition, et il
-- avait raison. Le déclencheur est donc le BALAYAGE (§9a) : il repère toute
-- organisation dont l'onboarding s'est terminé depuis B3, re-vérifie
-- ready_to_publish à chaque tick, et démarre l'essai dans la minute qui suit
-- le moment où l'organisation devient réellement réservable. Le frontend
-- peut, en plus, appeler start_organization_trial à la fin de l'onboarding
-- pour un démarrage sans même cette minute — les deux chemins convergent sur
-- start_trial_if_eligible et la clé primaire rend leur course inoffensive.

-- ---------------------------------------------------------------------------
-- 7. Les rappels — gabarits
-- ---------------------------------------------------------------------------

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html)
values
  ('trial_ending_soon', 'fr', 'transactional',
   'Votre essai FadeUp se termine dans 3 jours',
   E'Bonjour {{owner_name}},\n\nL''essai de {{organization_name}} se termine le {{ends_at_fr}}.\n\nAprès cette date, sans abonnement, votre compte revient au plan Free : votre profil reste publié et aucune donnée n''est supprimée, mais la réservation en ligne, la file d''attente et les fonctions professionnelles ne seront plus disponibles.\n\nPour continuer sans interruption, choisissez votre plan : {{billing_url}}\n\nL''équipe FadeUp',
   '<p>Bonjour {{owner_name}},</p><p>L''essai de <strong>{{organization_name}}</strong> se termine le <strong>{{ends_at_fr}}</strong>.</p><p>Après cette date, sans abonnement, votre compte revient au plan Free : votre profil reste publié et aucune donnée n''est supprimée, mais la réservation en ligne, la file d''attente et les fonctions professionnelles ne seront plus disponibles.</p><p><a href="{{billing_url}}">Choisir mon plan</a></p><p>L''équipe FadeUp</p>'),
  ('trial_ending_soon', 'en', 'transactional',
   'Your FadeUp trial ends in 3 days',
   E'Hello {{owner_name}},\n\nThe trial for {{organization_name}} ends on {{ends_at_en}}.\n\nAfter that date, without a subscription, your account returns to the Free plan: your profile stays published and no data is deleted, but online booking, the live queue and professional features will no longer be available.\n\nTo continue without interruption, pick your plan: {{billing_url}}\n\nThe FadeUp team',
   '<p>Hello {{owner_name}},</p><p>The trial for <strong>{{organization_name}}</strong> ends on <strong>{{ends_at_en}}</strong>.</p><p>After that date, without a subscription, your account returns to the Free plan: your profile stays published and no data is deleted, but online booking, the live queue and professional features will no longer be available.</p><p><a href="{{billing_url}}">Pick my plan</a></p><p>The FadeUp team</p>'),
  ('trial_ending_final', 'fr', 'transactional',
   'Dernier jour : votre essai FadeUp se termine demain',
   E'Bonjour {{owner_name}},\n\nL''essai de {{organization_name}} se termine demain, le {{ends_at_fr}}.\n\nSans abonnement, votre compte revient au plan Free demain : profil publié, données conservées, mais plus de réservation en ligne ni de fonctions professionnelles.\n\nChoisissez votre plan maintenant : {{billing_url}}\n\nL''équipe FadeUp',
   '<p>Bonjour {{owner_name}},</p><p>L''essai de <strong>{{organization_name}}</strong> se termine <strong>demain</strong>, le {{ends_at_fr}}.</p><p>Sans abonnement, votre compte revient au plan Free demain : profil publié, données conservées, mais plus de réservation en ligne ni de fonctions professionnelles.</p><p><a href="{{billing_url}}">Choisir mon plan</a></p><p>L''équipe FadeUp</p>'),
  ('trial_ending_final', 'en', 'transactional',
   'Last day: your FadeUp trial ends tomorrow',
   E'Hello {{owner_name}},\n\nThe trial for {{organization_name}} ends tomorrow, on {{ends_at_en}}.\n\nWithout a subscription, your account returns to the Free plan tomorrow: profile published, data kept, but no more online booking or professional features.\n\nPick your plan now: {{billing_url}}\n\nThe FadeUp team',
   '<p>Hello {{owner_name}},</p><p>The trial for <strong>{{organization_name}}</strong> ends <strong>tomorrow</strong>, on {{ends_at_en}}.</p><p>Without a subscription, your account returns to the Free plan tomorrow: profile published, data kept, but no more online booking or professional features.</p><p><a href="{{billing_url}}">Pick my plan</a></p><p>The FadeUp team</p>')
on conflict (template_key, locale) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Le destinataire des e-mails de facturation
-- ---------------------------------------------------------------------------

-- Le propriétaire, son adresse d'authentification, sa langue. Une organisation
-- peut avoir plusieurs owners : le plus ancien — déterministe, et c'est
-- presque toujours le fondateur du salon.
create or replace function private.org_owner_recipient(p_organization_id uuid)
returns table (user_id uuid, email text, owner_name text, locale text)
language sql
stable
security definer
set search_path to ''
as $$
  select
    u.id,
    u.email::text,
    coalesce(nullif(btrim(coalesce(p.full_name, '')), ''), split_part(u.email::text, '@', 1)),
    case when p.locale is null or p.locale = 'fr' then 'fr' else 'en' end
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = u.id
  where m.organization_id = p_organization_id
    and m.role = 'owner'
    and u.email is not null
  order by m.created_at asc
  limit 1;
$$;

comment on function private.org_owner_recipient(uuid) is
'Le destinataire des e-mails de facturation : le propriétaire le plus ancien, son e-mail d''authentification, sa langue (fr par défaut, en pour toute autre langue explicite — les gabarits n''existent qu''en fr/en).';

revoke all on function private.org_owner_recipient(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Le balayage
-- ---------------------------------------------------------------------------

create or replace function public.run_trial_maintenance()
returns table (trials_started integer, reminders_queued integer, trials_expired integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_started integer := 0;
  v_reminders integer := 0;
  v_expired integer := 0;
  v_org record;
  v_trial record;
  v_recipient record;
  v_touch text;
  v_template text;
begin
  -- 9a. DÉMARRAGE des essais devenus éligibles.
  --
  -- Le seuil '2026-09-07' est la date de mise en production de B3, en dur et
  -- assumé : les organisations dont l'onboarding s'est terminé AVANT vivaient
  -- déjà sans essai, et le démarrer d'office aurait brûlé leurs quatorze
  -- jours à leur insu. Elles passent par start_organization_trial.
  --
  -- Le filtre SQL est volontairement large (pas de calcul de readiness ici) ;
  -- start_trial_if_eligible re-vérifie tout, ligne par ligne.
  for v_org in
    select o.id
    from public.organizations o
    join public.organization_commercial_state s on s.organization_id = o.id
    where o.onboarding_completed_at >= timestamptz '2026-09-07 00:00:00+00'
      and s.plan_key = 'free'
      and not exists (select 1 from public.organization_trials t
                      where t.organization_id = o.id)
    limit 50
  loop
    if private.start_trial_if_eligible(v_org.id, 'onboarding') then
      v_started := v_started + 1;
    end if;
  end loop;

  -- 9b. RAPPELS à J-3 et J-1.
  --
  -- Idempotents par email_outbox.dedupe_key — le motif B2, index unique
  -- partiel : le rejeu d'un tick ne peut pas produire deux rappels. Les
  -- fenêtres se recouvrent volontairement vers le bas (un scheduler resté
  -- muet 12 h envoie le rappel en retard plutôt que jamais) et le rappel J-1
  -- remplace J-3 si les deux seraient dus en même temps.
  for v_trial in
    select t.organization_id, t.ends_at, o.name as organization_name
    from public.organization_trials t
    join public.organizations o on o.id = t.organization_id
    where t.status = 'active'
      and t.ends_at > now()
      and t.ends_at <= now() + interval '3 days'
  loop
    if v_trial.ends_at <= now() + interval '1 day' then
      v_touch := 'reminder_1d';
      v_template := 'trial_ending_final';
    else
      v_touch := 'reminder_3d';
      v_template := 'trial_ending_soon';
    end if;

    select * into v_recipient
    from private.org_owner_recipient(v_trial.organization_id);
    if v_recipient.email is null then
      continue;
    end if;

    insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
    values (
      v_recipient.email,
      v_template,
      v_recipient.locale,
      jsonb_build_object(
        'owner_name', v_recipient.owner_name,
        'organization_name', v_trial.organization_name,
        'ends_at_fr', to_char(v_trial.ends_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24hMI'),
        'ends_at_en', to_char(v_trial.ends_at at time zone 'Europe/Paris', 'FMMonth DD, YYYY at HH24:MI'),
        'billing_url', 'https://fade-up.com/pro/billing'
      ),
      'transactional',
      'trial:' || v_trial.organization_id::text || ':' || v_touch
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  -- 9c. EXPIRATION. La seule écriture est le statut : le retour au Free est
  -- déjà effectif — effective_plan_key ne regarde que « actif et non échu ».
  -- Aucune donnée n'est touchée, le profil reste publié.
  update public.organization_trials t
  set status = 'expired', expired_at = now()
  where t.status = 'active' and t.ends_at <= now();
  get diagnostics v_expired = row_count;

  return query select v_started, v_reminders, v_expired;
end;
$$;

comment on function public.run_trial_maintenance() is
'Passe dédiée du scheduler (leçon B2 : un domaine en panne ne bloque pas les autres) : démarre les essais devenus éligibles depuis la mise en production de B3, met en file les rappels J-3 et J-1 (idempotents par dedupe_key), clôt les essais échus. Le retour au Free est implicite : un essai non actif ne surclasse plus rien.';

revoke all on function public.run_trial_maintenance() from public, anon, authenticated;
grant execute on function public.run_trial_maintenance() to fadeup_scheduler;

commit;
