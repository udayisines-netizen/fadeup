-- FadeUp — OS-3 : retour arrière du plafond mensuel.
--
-- La colonne et sa contrainte sont retirées, la fonction de lecture aussi.
-- `commercial_plans` retrouve exactement ses colonnes d'avant : aucune ligne
-- n'a été ajoutée ni supprimée par l'aller, seulement une colonne remplie.

begin;

drop function if exists private.campaign_monthly_allowance(uuid);

alter table public.commercial_plans
  drop constraint if exists commercial_plans_campaign_allowance_positive;
alter table public.commercial_plans
  drop column if exists monthly_campaign_allowance;

commit;
