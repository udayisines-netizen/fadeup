-- FadeUp — B2 chantier 1c, retour arrière.
--
-- Supprime la RPC d'alternatives. Aucune donnée touchée : c'est une lecture.
-- Après ce retour arrière, l'écran d'expiration de P2 n'a plus rien à
-- proposer au client, ce qui est le cul-de-sac que MASTER_SPEC §5 interdit.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

drop function if exists public.get_public_booking_alternatives(double precision, double precision, text, uuid, double precision, integer);

commit;
