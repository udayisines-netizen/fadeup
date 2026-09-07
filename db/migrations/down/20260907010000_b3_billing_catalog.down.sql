-- FadeUp — B3 : retour arrière de 20260907010000_b3_billing_catalog.sql.
--
-- Rend le schéma à son état d'avant la migration. Comme tous les retours
-- arrière de ce dépôt, il défait le DDL et ne supprime pas les données
-- écrites pendant que la migration était en vigueur — À L'EXCEPTION des
-- quatre tables créées par elle, qui n'existaient pas avant et dont les
-- lignes ne décrivent que des objets Stripe de MODE TEST. Les objets Stripe
-- eux-mêmes ne sont pas touchés : ils vivent chez Stripe, pas ici.
--
-- Les capacités ajoutées par sync_plan_feature_tier aux paliers multi_salon
-- sont retirées : elles n'existaient pas avant la migration, et les plans
-- multi_salon n'ont qu'une organisation (multi_pro), en early_access, dont
-- les capacités d'avant sont restaurées à l'identique par ce fichier.

set lock_timeout = '5s';

begin;

-- 1. Les fonctions.
drop function if exists public.get_billing_catalog();
drop function if exists public.sync_plan_feature_tier(text);

-- 2. Les tables, dans l'ordre inverse de leur création.
drop table if exists public.billing_quote_requests;
drop table if exists public.organization_billing;
drop table if exists public.billing_stripe_prices;
drop table if exists public.billing_stripe_products;

-- 3. Le type.
drop type if exists public.stripe_billing_interval;

-- 4. Les capacités recopiées par la synchronisation de niveau. On restaure
--    EXACTEMENT le paquet d'avant migration, tel que lu en production avant
--    B3 (voir la sortie de plan_capabilities dans le rapport B3) :
--      multi_growth : Essential + live queue + chairs + multi-site
--      multi_pro    : multi_growth + rétention
--      multi_scale  : inchangé (il portait déjà le paquet Scale complet)
delete from public.plan_capabilities
where plan_key = 'multi_growth'
  and capability_key not in (
    'availability','booking','chairMode','chairs','crossLocationView',
    'customerHistory','customers','liveQueue','locationSwitching',
    'manualRebook','marketplace','multiLocation','notifications','passport',
    'publicProfile','queueDisplay','services','team','waitlist','walkIns');

delete from public.plan_capabilities
where plan_key = 'multi_pro'
  and capability_key not in (
    'availability','booking','chairMode','chairs','comebackReminders',
    'crossLocationView','customerHistory','customers','customerSegments',
    'inactiveCustomers','liveQueue','locationSwitching','manualRebook',
    'marketplace','multiLocation','notifications','passport','publicProfile',
    'queueDisplay','retentionAutomation','retentionInsights','returnCycles',
    'services','team','waitlist','walkIns');

delete from public.plan_capabilities
where plan_key = 'multi_scale'
  and capability_key not in (
    'advancedBookingRules','advancedPermissions','advancedReporting',
    'availability','booking','chairMode','chairs','comebackReminders',
    'crossLocationView','customerHistory','customers','customerSegments',
    'inactiveCustomers','liveQueue','locationSwitching','manualRebook',
    'marketplace','multiLocation','notifications','passport',
    'prioritySupport','publicProfile','queueDisplay','retentionAutomation',
    'retentionInsights','returnCycles','services','team','waitlist','walkIns');

-- 5. Les bornes d'avant : plafonds 2 / 5 / 10, pas de plancher (la colonne
--    disparaît juste après, mais l'ordre compte si ce fichier est rejoué
--    partiellement).
update public.commercial_plans set max_establishments = 2  where plan_key = 'multi_growth';
update public.commercial_plans set max_establishments = 5  where plan_key = 'multi_pro';
update public.commercial_plans set max_establishments = 10 where plan_key = 'multi_scale';

-- 6. Les colonnes du catalogue. annual_price_minor est générée : la supprimer
--    ne perd aucune donnée saisie, par construction.
alter table public.commercial_plans drop constraint if exists commercial_plans_feature_tier_not_self;
alter table public.commercial_plans drop constraint if exists commercial_plans_feature_tier_fkey;
alter table public.commercial_plans drop column if exists feature_tier_plan_key;

alter table public.commercial_plans drop constraint if exists commercial_plans_establishment_bounds_sane;
alter table public.commercial_plans drop column if exists min_establishments;

alter table public.commercial_plans drop column if exists annual_price_minor;
alter table public.commercial_plans drop constraint if exists commercial_plans_annual_months_sane;
alter table public.commercial_plans drop column if exists annual_months_charged;

commit;
