-- Retour arrière de 20260911200300_plat2_qr_posters.sql — À APPLIQUER EN postgres.
--
-- CE QU'IL DÉTRUIT, et qu'il faut savoir avant de l'ordonner : TOUS LES CODES
-- D'AFFICHE et toutes leurs attributions. Les affiches DÉJÀ IMPRIMÉES
-- deviennent alors des papiers morts : leur QR pointera sur un code inconnu.
-- Tant qu'aucun lot n'a été généré, le retour arrière ne coûte rien ; après
-- une impression, il coûte le papier.
--
-- Il retire aussi `resolve_poster_code` de la surface anonyme, ramenant le
-- contrat de 45 à 44 RPC : l'allowlist de x3_anon_surface.sh doit repasser à
-- son état d'avant PLAT-2 dans le même geste.

begin;

drop function if exists public.prepare_poster_letter(text, uuid);
drop function if exists public.resolve_poster_code(text);
drop function if exists public.revoke_poster(text, text);
drop function if exists public.assign_poster(text, uuid);
drop function if exists private.poster_can_assign_to_location(uuid);
drop function if exists public.list_my_poster_locations();
drop function if exists public.list_posters(uuid, public.poster_state, integer);
drop function if exists public.list_poster_batches(integer);
drop function if exists public.generate_poster_batch(integer, text, text);
drop function if exists private.generate_poster_code();

drop table if exists public.posters;
drop table if exists public.poster_batches;
drop type if exists public.poster_state;

delete from public.platform_role_permissions where permission_key in ('poster.assign', 'poster.manage');
delete from public.platform_permissions where key in ('poster.assign', 'poster.manage');

commit;
