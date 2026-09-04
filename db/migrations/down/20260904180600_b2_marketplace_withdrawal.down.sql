-- FadeUp — B2 chantier 5, retour arrière.
--
-- Supprime le workflow de retrait de marketplace. withdraw_external_professional,
-- écrite par B1, reste : c'est elle qui exécute, et B2 n'a fait que lui donner
-- un déclencheur et une échéance.
--
-- CONSÉQUENCE SUR LES DONNÉES. La table des demandes est supprimée, donc
-- l'historique des retraits demandés et le décompte des 72 h disparaissent.
-- Les retraits DÉJÀ EXÉCUTÉS ne sont pas défaits : les profils restent
-- dépubliés, les prospects restent en do_not_contact, les demandes d'intérêt
-- restent `withdrawn`. C'est volontaire — quelqu'un a demandé à sortir, et un
-- retour arrière technique ne le remet pas en vitrine.
--
-- L'audit de chaque décision reste dans platform_audit_log, qui est
-- append-only et que rien ici ne touche.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

drop function if exists public.list_marketplace_withdrawal_requests(boolean);
drop function if exists public.complete_marketplace_withdrawal(uuid, text);
drop function if exists public.request_marketplace_withdrawal(uuid, text, text);

drop table if exists public.marketplace_withdrawal_requests;
drop type if exists public.marketplace_withdrawal_status;

commit;
