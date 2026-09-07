-- F1b — retour arrière de quitter/suivre/changer.
--
-- Retire les trois RPC client et la règle d'accès partagée. Aucune donnée
-- n'est touchée : les entrées annulées par leave/change restent des faits.
--
-- À exécuter AVANT 20260907153000.down.sql (get_queue_entry_tracking lit
-- auto_marked_no_show_at) et AVANT 20260907151000.down.sql
-- (change_queue_entry_barber écrit queue_entry_moves) et AVANT
-- 20260907150000.down.sql (la RPC de suivi appelle queue_wait_minutes).

set lock_timeout = '5s';

begin;

drop function public.change_queue_entry_barber(uuid, uuid);
drop function public.get_queue_entry_tracking(uuid);
drop function public.leave_public_queue(uuid);
drop function private.queue_entry_client_access(public.queue_entries);

commit;
