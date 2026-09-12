-- Retour arrière de 20260912100000_plat3_platform_settings.sql — EN postgres.
--
-- CE QU'IL DÉTRUIT, à savoir avant de l'ordonner :
--
--   * la table `platform_settings` ENTIÈRE — donc toutes les valeurs réglées
--     depuis l'écran. Les VALEURS DE FILE SURVIVENT, parce qu'elles ont été
--     propagées dans `location_service_settings` : un lieu passé à 15 reste à
--     15. Ce qui disparaît, c'est le défaut et la trace de qui l'a posé ;
--   * la colonne `queue_thresholds_overridden` — donc la distinction entre un
--     salon qui a choisi sa capacité et un salon qui suivait le défaut. Elle
--     ne se reconstitue pas : après ce retour arrière, plus personne ne sait
--     lequel des 152 lieux avait réglé le sien ;
--   * le droit `platform.settings` et ses deux attributions.
--
-- Le journal d'audit, lui, garde les lignes `platform_setting_changed` : il
-- est en ajout seul et aucun retour arrière ne l'efface. C'est voulu.
--
-- ORDRE : ce fichier doit passer APRÈS le retour arrière de
-- 20260912100100, qui rend à `book_public_appointment` et à
-- `enqueue_prospect_outreach` des corps qui n'appellent plus
-- `private.platform_setting_int`. L'inverse laisserait deux fonctions
-- appelant une fonction disparue — plpgsql ne le verrait qu'à l'exécution.

begin;

drop function if exists public.get_public_platform_settings();
drop function if exists public.set_platform_setting(text, numeric, text);
drop function if exists public.list_platform_settings();

-- `ensure_location_service_settings` reprend son corps d'avant PLAT-3 :
-- l'insertion nue, qui laisse les DEFAULT de colonne jouer.
create or replace function private.ensure_location_service_settings(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_location_id is null then
    return;
  end if;

  insert into public.location_service_settings (location_id, organization_id)
  select l.id, l.organization_id
  from public.locations l
  where l.id = p_location_id
  on conflict (location_id) do nothing;
end;
$function$;

-- `set_location_queue_thresholds` reprend son corps d'OS-2, sans la ligne
-- `queue_thresholds_overridden` — la colonne va disparaître.
create or replace function public.set_location_queue_thresholds(
  p_location_id uuid,
  p_capacity_per_barber integer default null,
  p_call_grace_minutes integer default null,
  p_geofence_meters integer default null
)
returns public.location_service_settings
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

drop function if exists private.platform_setting_int(text);
drop function if exists private.platform_setting_num(text);

alter table public.location_service_settings drop column if exists queue_thresholds_overridden;

drop policy if exists platform_settings_select on public.platform_settings;
drop table if exists public.platform_settings;

delete from public.platform_role_permissions where permission_key = 'platform.settings';
delete from public.platform_permissions where key = 'platform.settings';

commit;
