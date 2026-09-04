-- FadeUp — B2, durcissement de email_outbox : retour arrière.
--
-- Restaure les ACL exactes d'avant B2 :
--
--   anon           = arwdDxtm
--   authenticated  = arwdDxtm
--
-- CE QUE ÇA RESTAURE, EN CLAIR : `anon` retrouve TRUNCATE sur la file
-- d'e-mails, qui n'est pas soumis à RLS, et SELECT sur une table dont les
-- payloads de prospection contiennent des jetons de désabonnement en clair.
-- À n'exécuter que si ces révocations sont elles-mêmes la cause d'une panne.
--
-- MAINTAIN figure dans les deux listes parce que PostgreSQL 17 l'a ajouté et
-- que la production le porte (le `m` final de arwdDxtm) — l'omettre laisserait
-- l'ACL à un privilège près de ce qu'elle était, ce qu'un diff de relacl voit
-- et qu'un humain ne voit pas. C'est l'erreur que le retour arrière de B1
-- avait faite avant d'être corrigée.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.email_outbox to anon, authenticated;

commit;
