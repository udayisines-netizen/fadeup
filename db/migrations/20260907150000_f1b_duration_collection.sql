-- FadeUp — F1b chantier 2 (1/2) : collecte des durées réelles de prestation.
--
-- « Le patron déclare, FadeUp observe et affine. » Ce fichier pose la
-- COLLECTE — le vrai livrable du chantier : sans elle, aucun affinage ne
-- sera jamais possible. Chaque prestation terminée enregistre sa durée
-- réelle, par barber et par service, deux canaux :
--
--   file        service_started_at -> completed_at, tous deux horodatés
--               SERVEUR par enforce_queue_transition (jamais le client) ;
--   rendez-vous starts_at (heure planifiée) -> completed_at (geste
--               « terminé » du pro). MESURE APPROXIMATIVE, dite telle
--               quelle : aucun geste « commencer » n'existe sur un
--               rendez-vous ; un « terminé » cliqué en retard produit une
--               valeur aberrante que l'estimateur écarte (bornes 3–240 min).
--
-- TOUT est enregistré, y compris l'aberrant : la donnée sert le futur
-- modèle ; c'est l'ESTIMATEUR qui filtre à la lecture, pas la collecte.
--
-- L'estimateur (private.estimated_service_duration_minutes) implémente la
-- bascule progressive décidée par F1b §3 :
--   < 5 mesures  : durée déclarée telle quelle ;
--   5 à 20       : moyenne pondérée, poids de l'observé = (n-4)/16 ;
--   > 20         : l'observé l'emporte.
-- Moyenne mobile pondérée sur les 20 dernières mesures valides, les
-- récentes comptant davantage (poids linéaires 20..1). Pas de modèle
-- prédictif : ça se débogue et ça s'explique à un barbier.
--
-- Bornes d'aberration : une mesure < 3 min est un double-clic, > 240 min un
-- « terminé » oublié avant la pause — ni l'une ni l'autre n'est une
-- prestation. Plafond d'écart : l'estimation affichée reste dans
-- [0,5 × déclaré ; 1,5 × déclaré] — au-delà, il y a plus probablement une
-- erreur de mesure qu'une vérité, et l'écart est SIGNALÉ au professionnel
-- (get_service_duration_insights.estimate_capped) au lieu d'être appliqué
-- en silence.
--
-- Repli en cascade : barber+service -> salon+service -> déclaré -> RIEN.
-- Le dernier cas compte : aucune minute inventée, jamais.
--
-- Appliquer en tant que POSTGRES (propriétaire des tables et fonctions).

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- La table de collecte.
-- ---------------------------------------------------------------------------

create table public.service_duration_samples (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  -- Nullable : une entrée « premier disponible » terminée sans affectation
  -- reste une mesure valable au niveau du salon.
  barber_id uuid references public.barbers(id) on delete set null,
  service_id uuid not null references public.services(id) on delete cascade,
  source text not null,
  source_entry_id uuid not null,
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone not null,
  duration_minutes numeric generated always as (extract(epoch from (ended_at - started_at)) / 60.0) stored,
  created_at timestamp with time zone default now() not null,
  constraint service_duration_samples_source_valid check (source in ('queue', 'appointment')),
  constraint service_duration_samples_time_order check (ended_at > started_at),
  -- L'idempotence de la collecte : une prestation = une mesure, même si le
  -- trigger rejoue (restauration, replays realtime, double update).
  constraint service_duration_samples_source_unique unique (source, source_entry_id)
);

comment on table public.service_duration_samples is
  'Durée RÉELLE de chaque prestation terminée, par barber et par service (F1b §3). Alimentée par trigger sur queue_entries (service_started_at -> completed_at, horodatés serveur) et appointments (starts_at planifié -> completed_at — approximation assumée, aucun geste "commencer" n''existe). TOUT est enregistré ; l''estimateur écarte les valeurs hors [3 ; 240] minutes à la lecture. Jamais écrite par un client : triggers seulement.';

comment on column public.service_duration_samples.barber_id is
  'NULL = prestation "premier disponible" jamais affectée : mesure de niveau salon, inutilisable pour la moyenne d''un barber mais comptée dans le repli salon+service.';

create index service_duration_samples_barber_service_idx
  on public.service_duration_samples (barber_id, service_id, ended_at desc);
create index service_duration_samples_location_service_idx
  on public.service_duration_samples (location_id, service_id, ended_at desc);

alter table public.service_duration_samples enable row level security;
alter table public.service_duration_samples force row level security;

-- Lecture : les membres de l'organisation (l'écran pro de transparence).
-- Écriture : personne directement — les triggers ci-dessous, exécutés en
-- postgres (BYPASSRLS), sont le seul canal.
create policy service_duration_samples_select on public.service_duration_samples
  for select using ((select private.is_org_member(organization_id)));

-- Les ACL par défaut du schéma accordent TOUT (arwdDxtm) à anon et
-- authenticated sur une table neuve — y compris TRUNCATE, hors RLS
-- (BLOCKERS §4). On révoque tout et on ne rend que le SELECT filtré.
revoke all on table public.service_duration_samples from anon;
revoke all on table public.service_duration_samples from authenticated;
grant select on table public.service_duration_samples to authenticated;

-- ---------------------------------------------------------------------------
-- Collecte côté file.
-- ---------------------------------------------------------------------------

create function public.record_queue_duration_sample() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.service_id is not null
     and new.service_started_at is not null
     and new.completed_at is not null
     and new.completed_at > new.service_started_at
  then
    insert into public.service_duration_samples
      (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
    values
      (new.organization_id, new.location_id, new.barber_id, new.service_id,
       'queue', new.id, new.service_started_at, new.completed_at)
    on conflict (source, source_entry_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.record_queue_duration_sample() is
  'AFTER UPDATE sur queue_entries : au passage à completed, enregistre la durée réelle service_started_at -> completed_at (horodatages serveur du trigger de transition). Une entrée sans service choisi ne produit pas de mesure — on ne sait pas ce qui a été coupé. Une entrée terminée d''un coup depuis "appelé" reçoit service_started_at = completed_at par le trigger de transition et ne passe pas la garde ended > started : pas de mesure de zéro minute.';

create trigger queue_entries_record_duration
  after update on public.queue_entries
  for each row execute function public.record_queue_duration_sample();

-- ---------------------------------------------------------------------------
-- Collecte côté rendez-vous.
-- ---------------------------------------------------------------------------

create function public.record_appointment_duration_sample() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.completed_at is not null
     and new.completed_at > new.starts_at
  then
    insert into public.service_duration_samples
      (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
    values
      (new.organization_id, new.location_id, new.barber_id, new.service_id,
       'appointment', new.id, new.starts_at, new.completed_at)
    on conflict (source, source_entry_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.record_appointment_duration_sample() is
  'AFTER UPDATE sur appointments : au passage à completed, enregistre starts_at (planifié) -> completed_at. Approximation assumée et documentée : aucun horodatage de début réel n''existe sur un rendez-vous. Un "terminé" cliqué avant l''heure planifiée ne produit rien (garde ended > started) ; un "terminé" cliqué très en retard produit une valeur que l''estimateur écarte (> 240 min).';

create trigger appointments_record_duration
  after update on public.appointments
  for each row execute function public.record_appointment_duration_sample();

-- ---------------------------------------------------------------------------
-- Les statistiques observées : moyenne mobile pondérée sur les 20 dernières
-- mesures VALIDES (3 à 240 minutes), poids linéaires — la plus récente pèse
-- 20, la vingtième pèse 1.
-- ---------------------------------------------------------------------------

create function private.observed_service_duration(
  p_service_id uuid,
  p_barber_id uuid default null,
  p_location_id uuid default null
) returns table(observed_minutes numeric, sample_count integer)
  language sql stable security definer
  set search_path to ''
as $$
  with valid as (
    select s.duration_minutes,
           row_number() over (order by s.ended_at desc) as recency
    from public.service_duration_samples s
    where s.service_id = p_service_id
      and s.duration_minutes >= 3
      and s.duration_minutes <= 240
      and (p_barber_id is null or s.barber_id = p_barber_id)
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  window_20 as (
    select duration_minutes, (21 - recency)::numeric as weight
    from valid
    where recency <= 20
  )
  select
    case when count(*) > 0
         then round(sum(duration_minutes * weight) / sum(weight), 1)
         else null end,
    (select count(*) from valid)::integer
  from window_20;
$$;

comment on function private.observed_service_duration(uuid, uuid, uuid) is
  'Moyenne mobile pondérée des 20 dernières mesures valides (bornes 3–240 min) pour un service, restreinte au barber et/ou au lieu si fournis. sample_count est le nombre TOTAL de mesures valides — c''est lui qui pilote la bascule progressive.';

-- ---------------------------------------------------------------------------
-- L'estimateur : bascule progressive, plafond d'écart, repli en cascade.
-- ---------------------------------------------------------------------------

create function private.estimated_service_duration_minutes(
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid
) returns integer
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_declared integer;
  v_observed numeric;
  v_count integer;
  v_weight numeric;
  v_estimate numeric;
begin
  if p_service_id is null then
    return null; -- pas de service, pas de durée : la loi produit tient.
  end if;

  select s.duration_minutes into v_declared
  from public.services s
  where s.id = p_service_id and s.is_active;

  -- Étage 1 : la moyenne de CE barber pour CE service.
  if p_barber_id is not null then
    select o.observed_minutes, o.sample_count into v_observed, v_count
    from private.observed_service_duration(p_service_id, p_barber_id, null) o;
  else
    v_count := 0;
  end if;

  -- Étage 2 : la moyenne du salon pour ce service.
  if coalesce(v_count, 0) < 5 then
    select o.observed_minutes, o.sample_count into v_observed, v_count
    from private.observed_service_duration(p_service_id, null, p_location_id) o;
  end if;

  -- Étage 3 : la durée déclarée. Étage 4 : rien.
  if coalesce(v_count, 0) < 5 or v_observed is null then
    return v_declared; -- peut être null : alors RIEN n'est affiché.
  end if;

  -- Bascule progressive : poids de l'observé = (n-4)/16, borné à 1.
  -- n=5 -> 6 %, n=12 -> 50 %, n>=20 -> 100 %. Une seule coupe anormale ne
  -- fait pas dérailler l'affichage dès la deuxième prestation.
  v_weight := least((v_count - 4)::numeric / 16.0, 1.0);
  if v_declared is not null then
    v_estimate := v_declared * (1 - v_weight) + v_observed * v_weight;
    -- Plafond d'écart : ±50 % du déclaré. 30 min annoncées / 90 observées
    -- est plus probablement un « terminé » oublié qu'une vérité — on borne
    -- et on SIGNALE (estimate_capped côté pro), on n'applique pas en silence.
    v_estimate := greatest(v_estimate, v_declared * 0.5);
    v_estimate := least(v_estimate, v_declared * 1.5);
  else
    v_estimate := v_observed;
  end if;

  return greatest(1, round(v_estimate))::integer;
end;
$$;

comment on function private.estimated_service_duration_minutes(uuid, uuid, uuid) is
  'LA durée estimée d''une prestation (F1b §3) : bascule progressive déclaré -> observé (seuils 5 et 20 mesures), moyenne mobile pondérée sur 20, plafond ±50 % du déclaré, repli barber -> salon -> déclaré -> NULL. NULL signifie « aucune minute affichable » — jamais un zéro inventé.';

-- ---------------------------------------------------------------------------
-- Le temps d'attente d'une file : somme des durées estimées des prestations
-- devant, plus le reste de celle en cours si elle est mesurable.
-- ---------------------------------------------------------------------------

create function private.queue_wait_minutes(
  p_location_id uuid,
  p_barber_id uuid,
  p_before_created_at timestamp with time zone default null
) returns integer
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_barber_count integer;
  v_serving_barber uuid;
  v_total numeric := 0;
  v_entry record;
  v_est integer;
  v_elapsed numeric;
begin
  -- Les barbers capables de prendre la file à ce lieu (min(uuid) n'existe
  -- pas : on compte, puis on prend le seul s'il est seul).
  select count(*) into v_barber_count
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where sp.location_id = p_location_id
    and b.is_bookable and b.queue_enabled
    and sp.is_active;

  if v_barber_count = 1 then
    select b.id into v_serving_barber
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where sp.location_id = p_location_id
      and b.is_bookable and b.queue_enabled
      and sp.is_active;
  end if;

  if p_barber_id is not null then
    v_serving_barber := p_barber_id;
  elsif v_barber_count <> 1 then
    -- File « premier disponible » d'un salon à plusieurs barbers : le temps
    -- dépend de qui se libère — l'estimer serait un modèle qu'on n'a pas.
    -- RIEN plutôt qu'une invention.
    return null;
  end if;

  -- Doctrine des files (F1b §2, documentée au rapport) : un barber sert
  -- d'abord SA file, puis « premier disponible ». La file d'un barber ne
  -- compte donc que ses propres entrées ; la file « premier disponible »
  -- d'un salon solo compte tout (le barber unique sert tout le monde).
  for v_entry in
    select qe.service_id, qe.barber_id
    from public.queue_entries qe
    where qe.location_id = p_location_id
      and qe.status = 'waiting'
      and (
        (p_barber_id is not null and qe.barber_id = p_barber_id)
        or (p_barber_id is null and (qe.barber_id is null or qe.barber_id = v_serving_barber))
      )
      and (p_before_created_at is null or qe.created_at < p_before_created_at)
  loop
    v_est := private.estimated_service_duration_minutes(
      p_location_id, coalesce(v_entry.barber_id, v_serving_barber), v_entry.service_id);
    if v_est is null then
      return null; -- une seule prestation inestimable rend la somme inestimable.
    end if;
    v_total := v_total + v_est;
  end loop;

  -- Le reste de la prestation EN COURS, seulement si elle est mesurable
  -- (service connu, début horodaté, durée estimable). Non mesurable :
  -- simplement pas ajoutée (F1b §3), la somme des attentes reste honnête.
  for v_entry in
    select qe.service_id, qe.barber_id, qe.service_started_at
    from public.queue_entries qe
    where qe.location_id = p_location_id
      and qe.status = 'in_service'
      and (
        (p_barber_id is not null and qe.barber_id = p_barber_id)
        or (p_barber_id is null and (qe.barber_id is null or qe.barber_id = v_serving_barber))
      )
  loop
    if v_entry.service_id is not null and v_entry.service_started_at is not null then
      v_est := private.estimated_service_duration_minutes(
        p_location_id, coalesce(v_entry.barber_id, v_serving_barber), v_entry.service_id);
      if v_est is not null then
        v_elapsed := extract(epoch from (now() - v_entry.service_started_at)) / 60.0;
        v_total := v_total + greatest(0, v_est - v_elapsed);
      end if;
    end if;
  end loop;

  return round(v_total)::integer;
end;
$$;

comment on function private.queue_wait_minutes(uuid, uuid, timestamp with time zone) is
  'Temps d''attente estimé d''une file (p_barber_id NULL = « premier disponible »), en minutes : somme des durées estimées des prestations en attente devant (toutes doivent être estimables, sinon NULL), plus le reste mesurable de la prestation en cours. p_before_created_at borne la somme aux entrées devant une entrée donnée (suivi individuel). NULL = aucune minute affichable.';

-- ---------------------------------------------------------------------------
-- Transparence côté pro : « Vous annoncez 30 min, la moyenne observée est de
-- 27 min sur 34 prestations. » Aucun logiciel ne lui dit ça aujourd'hui.
-- ---------------------------------------------------------------------------

create function public.get_service_duration_insights(p_location_id uuid)
returns table(
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  declared_minutes integer,
  observed_minutes numeric,
  sample_count integer,
  estimate_capped boolean
)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_organization_id uuid;
begin
  select l.organization_id into v_organization_id
  from public.locations l where l.id = p_location_id;

  if v_organization_id is null
     or not (select private.is_org_member(v_organization_id)) then
    raise exception 'not authorized to read duration insights for this location'
      using errcode = '42501';
  end if;

  return query
  select
    pairs.barber_id,
    sp.display_name,
    pairs.service_id,
    s.name,
    s.duration_minutes,
    o.observed_minutes,
    o.sample_count,
    -- L'écart plafonné est SIGNALÉ : au-delà de ±50 % du déclaré avec au
    -- moins 5 mesures, l'affichage borne — le pro doit le savoir pour
    -- corriger sa durée déclarée ou sa façon de pointer.
    (o.sample_count >= 5
       and (o.observed_minutes > s.duration_minutes * 1.5
            or o.observed_minutes < s.duration_minutes * 0.5))
  from (
    select distinct sd.barber_id, sd.service_id
    from public.service_duration_samples sd
    where sd.location_id = p_location_id
  ) pairs
  join public.services s on s.id = pairs.service_id and s.is_active
  left join public.barbers b on b.id = pairs.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  cross join lateral private.observed_service_duration(pairs.service_id, pairs.barber_id, p_location_id) o
  where o.sample_count > 0
  order by sp.display_name nulls first, s.name;
end;
$$;

comment on function public.get_service_duration_insights(uuid) is
  'Membres de l''organisation. Déclaré vs observé par barber et par service : durée déclarée, moyenne mobile pondérée observée, nombre de mesures valides, et le drapeau estimate_capped quand l''écart dépasse ±50 % (l''affichage est alors borné et le pro doit corriger — F1b §3). barber_id NULL = mesures « premier disponible » de niveau salon.';

-- Les fonctions private ne sont exécutées que par les definer postgres ;
-- l'insight pro exige une session. anon n'a rien à faire sur aucune des cinq.
-- (PUBLIC inclus : le défaut PostgreSQL accorde EXECUTE à PUBLIC sur toute
-- fonction neuve hors default ACL, et le schéma private est USAGE-accessible
-- à authenticated — c'est ainsi que queue_stage a pu être appelée.)
revoke execute on function public.record_queue_duration_sample() from public, anon, authenticated;
revoke execute on function public.record_appointment_duration_sample() from public, anon, authenticated;
revoke execute on function private.observed_service_duration(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.estimated_service_duration_minutes(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.queue_wait_minutes(uuid, uuid, timestamp with time zone) from public, anon, authenticated;
revoke execute on function public.get_service_duration_insights(uuid) from public, anon;
grant execute on function public.get_service_duration_insights(uuid) to authenticated;

commit;
