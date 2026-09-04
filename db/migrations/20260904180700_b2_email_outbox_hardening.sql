-- FadeUp — B2 : les droits sous la file d'e-mails.
--
-- CE QUE LA SUITE DE VÉRIFICATION A TROUVÉ
--
-- `email_outbox` porte, en production :
--
--   anon           = arwdDxtm   (tout, TRUNCATE compris)
--   authenticated  = arwdDxtm   (idem)
--
-- avec RLS activée et **une seule** policy, `email_outbox_select_platform`,
-- pour `authenticated`. Donc en lecture la ligne tient : anon n'a aucune
-- policy et lit zéro ligne.
--
-- POURQUOI CE N'EST PAS SUFFISANT, ET POURQUOI B2 NE PEUT PAS LE LAISSER
--
-- 1. TRUNCATE N'EST PAS SOUMIS À RLS. B1 l'a mesuré sur queue_entries et l'a
--    écrit dans BLOCKERS.md §4 : `set local role anon; truncate ...` réussit,
--    sans qu'aucune policy soit consultée. Sur queue_entries, cela détruisait
--    des files d'attente. Sur email_outbox, cela détruit des confirmations de
--    réservation et des liens magiques qui n'ont pas encore été envoyés — des
--    messages dont l'absence ne se remarque que du côté du destinataire.
--
-- 2. B2 A CHANGÉ CE QUE CETTE TABLE CONTIENT. Avant, des accusés de
--    réservation. Depuis ce lot, elle porte aussi les payloads de prospection,
--    et donc les JETONS DE DÉSABONNEMENT en clair dans `payload`. Un jeton de
--    désabonnement lisible par un tiers permet de désinscrire un professionnel
--    à sa place — silencieusement, et définitivement, puisque le
--    désabonnement pose une suppression durable.
--
-- B1 avait durci les quatre tables de SON périmètre et documenté les 83
-- autres pour un lot dédié. email_outbox entre dans le périmètre de B2 par la
-- porte principale : ce lot lui donne un expéditeur et de nouveaux contenus.
-- Les 82 restantes attendent toujours leur lot, et BLOCKERS.md le redit.
--
-- CE QUI EST CONSERVÉ
--
-- `authenticated` garde SELECT, le seul verbe pour lequel une policy existe
-- (`email_outbox_select_platform`, réservée aux administrateurs plateforme).
-- Il perd INSERT, UPDATE et DELETE, qu'aucune policy ne gouverne — donc que
-- RLS refuse déjà, mais qu'il est absurde d'accorder — ainsi que TRUNCATE,
-- TRIGGER et REFERENCES.
--
-- L'écriture reste ce qu'elle a toujours été : les fonctions SECURITY DEFINER
-- (emit_booking_notification, enqueue_prospect_outreach, email_dispatch_batch),
-- qui s'exécutent comme leur propriétaire et ne consultent pas ces droits.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

revoke all on table public.email_outbox from anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.email_outbox from authenticated;

commit;
