-- Retour arrière de 20260912100400_plat3_acquisition_funnel.sql — EN postgres.
-- Ne détruit AUCUNE donnée : ce fichier n'ajoutait qu'une fonction de lecture.
-- L'écran du tunnel cesse de répondre ; rien d'autre ne bouge.

begin;

drop function if exists public.get_platform_acquisition_funnel(timestamptz, timestamptz, text);

commit;
