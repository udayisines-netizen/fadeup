-- Retour arrière de 20260911200200_plat2_crm_prospect_insight.sql — EN postgres.
-- Ne détruit AUCUNE donnée : ce fichier n'ajoutait que trois fonctions de
-- lecture. Les écrans qui les appellent cessent de fonctionner ; rien d'autre.

begin;

drop function if exists public.get_sales_pipeline_summary();
drop function if exists public.get_prospect_outreach_state(uuid);
drop function if exists public.get_prospect_acquisition_stats(uuid, integer);

commit;
