-- FadeUp — F1b chantier 5 (2/2) : le balayage de grâce.
--
-- En heure de pointe, la file se bouche derrière un absent que personne n'a
-- le temps de sortir. Un balayage automatique passe les appelés en absent
-- une fois le délai de grâce écoulé — DÉSACTIVÉ PAR DÉFAUT, activable par
-- salon (sortir quelqu'un qui était aux toilettes est une mauvaise
-- expérience : le patron décide).
--
--   * Réglage : location_service_settings.queue_grace_sweep_enabled, à côté
--     de queue_call_grace_minutes, posé par set_location_queue_grace_sweep
--     (owner/manager).
--   * Passe DÉDIÉE run_queue_grace_maintenance(), appelée par le conteneur
--     fadeup-scheduler dans un appel psql SÉPARÉ des six passes existantes
--     (B2 : une panne d'un domaine ne bloque pas un autre).
--   * Idempotence : la transition called -> no_show est terminale — un
--     redémarrage ne re-balaie rien (la clause WHERE ne matche plus), et la
--     notification est dédupliquée par dedupe_key unique.
--   * Trace : queue_entries.auto_marked_no_show_at distingue une sortie
--     automatique d'un « absent » cliqué par le salon.
--
-- Appliquer en tant que POSTGRES, APRÈS 20260907152000 (valeur d'enum).

set lock_timeout = '5s';

begin;

alter table public.location_service_settings
  add column queue_grace_sweep_enabled boolean not null default false;

comment on column public.location_service_settings.queue_grace_sweep_enabled is
  'Le balayage automatique de grâce est-il actif pour ce lieu ? false par défaut (F1b §6) : par défaut c''est le pro qui décide de sortir un appelé, le balayage est un choix d''exploitation par salon. Lu par run_queue_grace_maintenance à chaque tick.';

alter table public.queue_entries
  add column auto_marked_no_show_at timestamp with time zone;

comment on column public.queue_entries.auto_marked_no_show_at is
  'Horodatage du balayage de grâce quand c''est LUI qui a passé cette entrée en no_show. NULL pour un « absent » décidé par le salon : la trace F1b qui distingue une sortie automatique d''une sortie manuelle.';

-- ---------------------------------------------------------------------------
-- Le réglage, sur le modèle exact de set_location_queue_open.
-- ---------------------------------------------------------------------------

create function public.set_location_queue_grace_sweep(p_location_id uuid, p_enabled boolean)
returns public.location_service_settings
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_organization_id uuid;
  v_row public.location_service_settings;
begin
  if p_enabled is null then
    raise exception 'p_enabled is required' using errcode = '22023';
  end if;

  select l.organization_id into v_organization_id
  from public.locations l where l.id = p_location_id;

  if v_organization_id is null
     or not (select private.has_org_role(v_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to manage queue settings for this location'
      using errcode = '42501';
  end if;

  perform private.ensure_location_service_settings(p_location_id);

  update public.location_service_settings s
     set queue_grace_sweep_enabled = p_enabled
   where s.location_id = p_location_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_location_queue_grace_sweep(uuid, boolean) is
  'Owner/manager : active ou coupe le balayage automatique de grâce du lieu (F1b §6). Le délai lui-même reste queue_call_grace_minutes.';

revoke execute on function public.set_location_queue_grace_sweep(uuid, boolean) from public, anon;
grant execute on function public.set_location_queue_grace_sweep(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_location_queue_check_in expose le nouveau réglage à l'écran pro.
-- DROP puis CREATE : le type de retour change. anon n'a JAMAIS eu ce
-- droit — on le retire explicitement après recréation (l'ACL par défaut du
-- schéma le lui donnerait).
-- ---------------------------------------------------------------------------

drop function public.get_location_queue_check_in(uuid);

create function public.get_location_queue_check_in(p_location_id uuid)
returns table(
  location_id uuid,
  queue_check_in_token text,
  queue_geofence_meters integer,
  queue_call_grace_minutes integer,
  queue_capacity_per_barber integer,
  queue_grace_sweep_enabled boolean
)
  language plpgsql stable security definer
  set search_path to ''
as $$
begin
  -- Receptionist included: reprinting the code that is taped to the counter is
  -- front-of-house work, the same category as opening and closing the queue.
  perform private.assert_service_mode_authority(p_location_id, null, true);

  return query
  select l.id, l.queue_check_in_token,
         s.queue_geofence_meters, s.queue_call_grace_minutes, s.queue_capacity_per_barber,
         s.queue_grace_sweep_enabled
  from public.locations l
  join private.location_service_settings_effective(p_location_id) e on e.location_id = l.id
  left join public.location_service_settings s on s.location_id = l.id
  where l.id = p_location_id;
end;
$$;

comment on function public.get_location_queue_check_in(uuid) is
  'Owner/manager/réceptionniste : le jeton QR du lieu et ses seuils de file — géofence, grâce, capacité par barber, et depuis F1b l''état du balayage de grâce. Jamais exposé à anon : la grâce est un réglage du salon, pas une donnée client.';

revoke execute on function public.get_location_queue_check_in(uuid) from public, anon;
grant execute on function public.get_location_queue_check_in(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La passe elle-même.
-- ---------------------------------------------------------------------------

create function public.run_queue_grace_maintenance()
returns table(entries_swept integer)
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_swept integer := 0;
  v_entry record;
  v_user_id uuid;
  v_locale text;
  v_org_name text;
begin
  for v_entry in
    select qe.id, qe.organization_id, qe.location_id, qe.booked_by_user_id, qe.customer_id
    from public.queue_entries qe
    join public.location_service_settings s on s.location_id = qe.location_id
    where s.queue_grace_sweep_enabled
      and qe.status = 'called'
      and qe.called_at is not null
      and qe.called_at + make_interval(mins => s.queue_call_grace_minutes) <= now()
    order by qe.called_at
    -- Un verrou par ligne : un « arrivé » cliqué au comptoir pendant le tick
    -- gagne — la ligne verrouillée par le salon est simplement sautée et son
    -- nouvel état ne matchera plus au prochain tick.
    for update of qe skip locked
  loop
    update public.queue_entries qe
       set status = 'no_show',
           auto_marked_no_show_at = now()
     where qe.id = v_entry.id
       and qe.status = 'called';

    if not found then
      continue;
    end if;

    v_swept := v_swept + 1;

    -- Le client doit le savoir, SANS être culpabilisé : le délai était
    -- écoulé, pas « vous n'êtes pas venu ». Seul un compte peut recevoir
    -- une notification in-app ; l'anonyme le voit sur son écran de suivi
    -- (get_queue_entry_tracking rend la sortie automatique distinguable).
    v_user_id := v_entry.booked_by_user_id;
    if v_user_id is null and v_entry.customer_id is not null then
      select c.user_id into v_user_id
      from public.customers c where c.id = v_entry.customer_id;
    end if;

    if v_user_id is not null then
      select p.locale into v_locale from public.profiles p where p.id = v_user_id;
      select o.name into v_org_name from public.organizations o where o.id = v_entry.organization_id;

      insert into public.notifications (user_id, type, title, body, organization_id, dedupe_key)
      values (
        v_user_id,
        'queue_grace_removed',
        case when lower(coalesce(v_locale, 'fr')) = 'en'
             then 'You left the queue'
             else 'Vous êtes sorti de la file' end,
        case when lower(coalesce(v_locale, 'fr')) = 'en'
             then format('You were removed from the queue at %s — the response window after your call had passed. You can join again any time the queue is open.', coalesce(v_org_name, ''))
             else format('Vous avez été retiré de la file de %s : le délai après votre appel était écoulé. Vous pouvez la rejoindre à nouveau tant qu''elle est ouverte.', coalesce(v_org_name, '')) end,
        v_entry.organization_id,
        'queue_grace_removed:' || v_entry.id::text
      )
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;

  return query select v_swept;
end;
$$;

comment on function public.run_queue_grace_maintenance() is
  'Passe scheduler DÉDIÉE (F1b §6) : passe en no_show les entrées appelées dont le délai de grâce est écoulé, UNIQUEMENT dans les lieux où le balayage est activé. Idempotente par construction — no_show est terminal, un redémarrage ne re-balaie rien ; notification dédupliquée par clé unique. auto_marked_no_show_at trace la sortie automatique. SKIP LOCKED : un geste du comptoir en cours gagne toujours.';

-- La passe n'appartient qu'au scheduler — jamais un client.
revoke execute on function public.run_queue_grace_maintenance() from public, anon, authenticated;
grant execute on function public.run_queue_grace_maintenance() to fadeup_scheduler, service_role;

commit;
