-- Retour arrière — OS-2 seuils de file.
-- Rôle : postgres. Les valeurs réglées restent en base : seule la RPC part.
begin;
drop function if exists public.set_location_queue_thresholds(uuid, integer, integer, integer);
commit;
