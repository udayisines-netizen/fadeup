-- FadeUp — B2 chantier 1b, retour arrière.
--
-- Supprime le modèle de demande d'intérêt vers un profil non revendiqué, et
-- avec lui la seule chose qui rendait un profil publié par le Worker autre
-- chose qu'un cul-de-sac.
--
-- CONSÉQUENCE SUR LES DONNÉES, DITE AVANT DE LA SUBIR. Les tables sont
-- SUPPRIMÉES : toute demande envoyée par un vrai client à un vrai
-- professionnel disparaît, coordonnées comprises. Ce sont des données
-- clients, et elles ne reviendront pas. Exporter avant, si le retour arrière
-- n'est pas immédiat après l'application.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

drop function if exists public.get_my_interest_requests();
drop function if exists public.expire_interest_requests(integer);
drop function if exists public.create_professional_interest_request(uuid, text, text, timestamptz, text, text, text, text);

drop trigger if exists professional_interest_requests_set_expiry on public.professional_interest_requests;
drop function if exists public.set_interest_request_expiry();

-- La policy de lecture de professional_interest_requests référence la table de
-- contacts (c'est par elle qu'on relie une demande à son auteur), donc l'ordre
-- naïf « contacts puis requests » échoue sur la dépendance. On retire la
-- policy d'abord, plutôt que d'employer CASCADE : CASCADE supprimerait aussi
-- ce que nous n'avons pas nommé.
drop policy if exists professional_interest_requests_select on public.professional_interest_requests;
drop policy if exists professional_interest_request_contacts_select on public.professional_interest_request_contacts;

drop table if exists public.professional_interest_request_contacts;
drop table if exists public.professional_interest_requests;

drop function if exists private.reduce_customer_display_name(text);
drop type if exists public.interest_request_status;

commit;
