-- FadeUp — B4 chantier 4 (1/2), retour arrière.
--
-- Retire les RPC de lecture sociales et la table des poids. Aucune table de
-- données n'est touchée.

set lock_timeout = '5s';

begin;

drop function if exists public.get_public_reputation(uuid, uuid);
drop function if exists public.get_public_reviews(uuid, uuid, timestamptz, integer);
drop function if exists public.get_organization_posts(text, timestamptz, integer);
drop function if exists public.get_professional_posts_by_id(uuid, timestamptz, integer);
drop function if exists public.get_professional_posts(text, timestamptz, integer);
drop function if exists private.professional_posts_page(uuid, timestamptz, integer);
drop function if exists public.get_feed(timestamptz, integer, double precision, double precision);

drop table if exists public.feed_ranking_weights;

commit;
