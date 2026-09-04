-- FadeUp — B2 chantier 3, retour arrière.
--
-- Supprime les relances de prospection, leur jeton de désabonnement et le tick
-- d'acquisition.
--
-- CE QUE ÇA RESTAURE, EN CLAIR : un professionnel non revendiqué ne sera plus
-- jamais prévenu qu'un client le cherche — c'est-à-dire que la boucle
-- d'acquisition de MASTER_SPEC §5 redevient muette.
--
-- CE QUI EST CONSERVÉ VOLONTAIREMENT : les `do_not_contact` et les
-- suppressions posés par un désabonnement. Un professionnel qui a dit « ne
-- m'écrivez plus » l'a dit ; un retour arrière technique n'est pas un
-- consentement retrouvé. Seul le jeton disparaît, et un lien déjà envoyé
-- cessera de fonctionner — mais il n'y aura plus rien dont se désabonner.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

drop function if exists public.run_acquisition_maintenance();
drop function if exists private.enqueue_prospect_outreach(integer);
drop function if exists private.prospect_outreach_payload(uuid);
drop function if exists private.prospect_timezone(uuid);
drop function if exists public.unsubscribe_prospect_outreach(text);

drop index if exists public.prospects_outreach_unsubscribe_token_unique;

alter table public.prospects
  drop column if exists outreach_unsubscribe_token;

commit;
