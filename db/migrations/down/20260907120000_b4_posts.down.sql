-- FadeUp — B4 chantier 1, retour arrière.
--
-- Supprime les quatre tables de publications, leurs triggers, leurs policies
-- et les deux helpers private. DESTRUCTIF pour les données de posts écrites
-- pendant que la migration était en vigueur — c'est inhérent à retirer des
-- tables neuves ; aucune donnée antérieure à B4 n'existe dans ces tables.
-- Aucune table préexistante n'est touchée.

set lock_timeout = '5s';

begin;

drop table if exists public.post_likes;
drop table if exists public.post_services;
drop table if exists public.post_media;
drop table if exists public.posts;

drop function if exists public.maintain_post_like_count();
drop function if exists public.check_post_services_consistency();
drop function if exists public.check_post_media_limit();
drop function if exists public.check_post_has_media();
drop function if exists public.posts_guard_immutable_author();
drop function if exists public.check_posts_consistency();
drop function if exists private.can_manage_post(uuid);
drop function if exists private.can_view_post(uuid);

commit;
