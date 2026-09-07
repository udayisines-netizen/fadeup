-- F1b — retour arrière de la collecte des durées.
--
-- ATTENTION : ce retrait JETTE les mesures collectées dans
-- service_duration_samples. Celles issues de la file sont re-dérivables
-- (les horodatages source vivent dans queue_entries) ; celles issues des
-- rendez-vous aussi (starts_at/completed_at dans appointments). Aucune
-- donnée primaire n'est perdue — seulement l'agrégat.
--
-- À exécuter APRÈS 20260907151000.down.sql et 20260907154000.down.sql
-- (list_public_queues et get_queue_entry_tracking dépendent de
-- private.queue_wait_minutes).

set lock_timeout = '5s';

begin;

drop function public.get_service_duration_insights(uuid);
drop function private.queue_wait_minutes(uuid, uuid, timestamp with time zone);
drop function private.estimated_service_duration_minutes(uuid, uuid, uuid);
drop function private.observed_service_duration(uuid, uuid, uuid);

drop trigger appointments_record_duration on public.appointments;
drop function public.record_appointment_duration_sample();

drop trigger queue_entries_record_duration on public.queue_entries;
drop function public.record_queue_duration_sample();

drop table public.service_duration_samples;

commit;
