-- F1b — retour arrière du balayage de grâce.
--
-- Restaure get_location_queue_check_in dans sa forme B1 exacte (corps relevé
-- sur la production le 2026-09-07 avant modification), retire la passe, le
-- réglage et la colonne de trace.
--
-- ATTENTION : la colonne auto_marked_no_show_at est jetée — les sorties
-- automatiques passées redeviennent indistinguables des manuelles.

set lock_timeout = '5s';

begin;

drop function public.run_queue_grace_maintenance();

drop function public.get_location_queue_check_in(uuid);

CREATE OR REPLACE FUNCTION public.get_location_queue_check_in(p_location_id uuid)
 RETURNS TABLE(location_id uuid, queue_check_in_token text, queue_geofence_meters integer, queue_call_grace_minutes integer, queue_capacity_per_barber integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Receptionist included: reprinting the code that is taped to the counter is
  -- front-of-house work, the same category as opening and closing the queue.
  perform private.assert_service_mode_authority(p_location_id, null, true);

  return query
  select l.id, l.queue_check_in_token,
         s.queue_geofence_meters, s.queue_call_grace_minutes, s.queue_capacity_per_barber
  from public.locations l
  join private.location_service_settings_effective(p_location_id) e on e.location_id = l.id
  left join public.location_service_settings s on s.location_id = l.id
  where l.id = p_location_id;
end;
$function$;

revoke execute on function public.get_location_queue_check_in(uuid) from public, anon;
grant execute on function public.get_location_queue_check_in(uuid) to authenticated, service_role;

drop function public.set_location_queue_grace_sweep(uuid, boolean);

alter table public.queue_entries drop column auto_marked_no_show_at;
alter table public.location_service_settings drop column queue_grace_sweep_enabled;

commit;
