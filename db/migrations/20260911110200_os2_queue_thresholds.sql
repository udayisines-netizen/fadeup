-- FadeUp — OS-2 : les seuils de file, réglables par le propriétaire.
--
-- RÔLE D'APPLICATION : postgres (fonction NEUVE).
--
-- F1b a posé les seuils EN BASE (`location_service_settings` :
-- `queue_capacity_per_barber`, `queue_call_grace_minutes`,
-- `queue_geofence_meters`, `queue_grace_sweep_enabled`) et les a câblés
-- partout — `private.queue_capacity`, le balayage, le rayon de pointage. Ce
-- qui manquait : le professionnel ne pouvait RIEN régler. Seuls
-- `set_location_queue_open` et `set_location_queue_grace_sweep` existaient.
-- Sans cette RPC, l'écran pro n'aurait eu que le choix d'écrire les valeurs
-- en dur — exactement ce que l'énoncé interdit.
--
-- Un paramètre NULL signifie « inchangé » : l'écran peut n'envoyer que le
-- champ que le professionnel a touché, sans jamais écraser les deux autres
-- avec une valeur lue il y a trente secondes.
--
-- Les bornes sont celles de la contrainte
-- `location_service_settings_queue_thresholds_range` déjà en base ; la RPC
-- les vérifie AVANT pour rendre un motif nommé au lieu d'une violation de
-- contrainte brute.

begin;

create or replace function public.set_location_queue_thresholds(
  p_location_id uuid,
  p_capacity_per_barber integer default null,
  p_call_grace_minutes integer default null,
  p_geofence_meters integer default null
)
returns public.location_service_settings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_row public.location_service_settings;
begin
  select l.organization_id into v_organization_id
  from public.locations l where l.id = p_location_id;

  -- Motif nul : v_organization_id est testé AVANT d'être passé à la garde.
  if v_organization_id is null
     or not (select private.has_org_role(v_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to manage queue settings for this location'
      using errcode = '42501', detail = 'fadeup_queue_refusal=not_authorized';
  end if;

  if p_capacity_per_barber is null
     and p_call_grace_minutes is null
     and p_geofence_meters is null then
    raise exception 'nothing to change'
      using errcode = '22023', detail = 'fadeup_queue_refusal=no_change';
  end if;

  if p_capacity_per_barber is not null
     and (p_capacity_per_barber < 1 or p_capacity_per_barber > 200) then
    raise exception 'queue capacity per barber must be between 1 and 200'
      using errcode = '22023', detail = 'fadeup_queue_refusal=capacity_out_of_range';
  end if;

  if p_call_grace_minutes is not null
     and (p_call_grace_minutes < 0 or p_call_grace_minutes > 120) then
    raise exception 'the call grace delay must be between 0 and 120 minutes'
      using errcode = '22023', detail = 'fadeup_queue_refusal=grace_out_of_range';
  end if;

  if p_geofence_meters is not null
     and (p_geofence_meters < 25 or p_geofence_meters > 2000) then
    raise exception 'the check-in radius must be between 25 and 2000 metres'
      using errcode = '22023', detail = 'fadeup_queue_refusal=geofence_out_of_range';
  end if;

  perform private.ensure_location_service_settings(p_location_id);

  update public.location_service_settings s
     set queue_capacity_per_barber = coalesce(p_capacity_per_barber, s.queue_capacity_per_barber),
         queue_call_grace_minutes  = coalesce(p_call_grace_minutes,  s.queue_call_grace_minutes),
         queue_geofence_meters     = coalesce(p_geofence_meters,     s.queue_geofence_meters)
   where s.location_id = p_location_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_location_queue_thresholds(uuid, integer, integer, integer) is
  'Règle les seuils de file d''un établissement : capacité par barber, délai de grâce après l''appel, rayon de pointage. Propriétaire et manager. Un paramètre NULL laisse la valeur en place — l''écran n''envoie que ce que le professionnel a touché.';

revoke all on function public.set_location_queue_thresholds(uuid, integer, integer, integer) from public, anon;
grant execute on function public.set_location_queue_thresholds(uuid, integer, integer, integer) to authenticated;

commit;
