-- FadeUp — OS-3 : le plafond mensuel de sollicitations, EN BASE.
--
-- RÔLE D'APPLICATION : postgres (colonne et fonctions neuves ; aucune
-- redéfinition d'objet appartenant à supabase_admin).
--
-- LA DÉCISION DU FONDATEUR : Free 3 · Solo 10 · Essential 20 · Pro 50 ·
-- Business 100 · Multi illimité.
--
-- OÙ LE PLAFOND VIT, ET POURQUOI PAS AILLEURS
--
-- Le prompt demande qu'il vive « dans le catalogue de capacités que B3 a
-- construit ». Trois emplacements étaient possibles ; deux sont refusés pour
-- des raisons vérifiées, pas par goût :
--
-- 1. UNE NOUVELLE CAPACITÉ dans `commercial_capabilities` (+ son entrée par
--    plan dans `plan_capabilities`). REFUSÉ. Le catalogue de capacités est
--    sous DOUBLE source de vérité : `apps/web/src/lib/commerce/plans.ts`
--    porte les mêmes 37 clés, et `catalog.test.ts` compare les deux ensemble
--    par ensemble en PARSANT la migration R2. Ajouter une 31e clé live en
--    base sans toucher le module TypeScript ferait DÉRIVER les deux
--    catalogues en silence (le test ne lit pas cette migration-ci) ; les
--    accorder obligerait à modifier un module partagé avec `/platform`,
--    surface de production sur laquelle PLAT-3 travaille en parallèle. Le
--    prompt interdit d'y toucher.
--
-- 2. UNE COLONNE NUMÉRIQUE sur `plan_capabilities`. REFUSÉ pour la même
--    raison, plus une autre : `get_organization_entitlements` rend
--    `live_capabilities text[]` — un tableau plat. Un plafond n'y entre pas
--    sans changer la forme de retour d'un contrat que R2 a posé et que le
--    garde de route `RequireCapability` consomme.
--
-- 3. UNE COLONNE SUR `commercial_plans`. RETENU. C'est EXACTEMENT le
--    précédent des deux seuls plafonds numériques que FadeUp a déjà —
--    `max_establishments` et `max_operational_professionals` — qui ne
--    passent pas par le mécanisme de capacités mais par des colonnes
--    dédiées du plan, lues à travers `private.effective_plan_key`. Un
--    plafond se règle donc par un UPDATE d'une ligne, comme les paliers
--    multi-établissements de B3, et le catalogue reste d'un seul morceau.
--
-- NULL SIGNIFIE ILLIMITÉ, comme `max_operational_professionals`. C'est la
-- convention déjà en place ; en inventer une autre (0 = illimité, -1 =
-- illimité) aurait été un piège pour le prochain lot.
--
-- CE QUE CE PLAFOND N'EST PAS. Ce n'est pas une capacité : la campagne
-- n'est pas GATÉE par le plan, elle est MESURÉE. Le fondateur a donné trois
-- envois au plan Free — donc l'écran se rend à tout plan, et c'est le
-- compteur, pas l'absence de capacité, qui borne. C'est aussi la réponse
-- d'OS-3 à la question ouverte d'OS-2 §12.1 (« la rétention devient-elle une
-- capacité payante ? ») : NON, elle devient une capacité MÉTRÉE. Les six
-- capacités `retention` restent `planned` et ne conditionnent rien.

begin;

-- ---------------------------------------------------------------------------
-- 1. La colonne
-- ---------------------------------------------------------------------------

alter table public.commercial_plans
  add column if not exists monthly_campaign_allowance integer;

alter table public.commercial_plans
  drop constraint if exists commercial_plans_campaign_allowance_positive;
alter table public.commercial_plans
  add constraint commercial_plans_campaign_allowance_positive
  check (monthly_campaign_allowance is null or monthly_campaign_allowance > 0);

comment on column public.commercial_plans.monthly_campaign_allowance is
'Nombre de campagnes de sollicitation par mois calendaire ouvert par ce plan. NULL = illimité (même convention que max_operational_professionals). Décision du fondateur (OS-3) : Free 3, Solo 10, Essential 20, Pro 50, Business 100, famille multi_salon illimitée. Se règle par un UPDATE ; aucun code ne porte ces nombres.';

update public.commercial_plans set monthly_campaign_allowance = 3   where plan_key = 'free';
update public.commercial_plans set monthly_campaign_allowance = 10  where plan_key = 'solo';
update public.commercial_plans set monthly_campaign_allowance = 20  where plan_key = 'salon_essential';
update public.commercial_plans set monthly_campaign_allowance = 50  where plan_key = 'salon_pro';
update public.commercial_plans set monthly_campaign_allowance = 100 where plan_key = 'salon_business';
-- Famille multi_salon : illimité, donc NULL — explicitement, pour que la
-- relecture ne se demande pas si l'UPDATE a été oublié.
update public.commercial_plans set monthly_campaign_allowance = null
  where commercial_family = 'multi_salon';

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.commercial_plans
  where monthly_campaign_allowance is null and commercial_family <> 'multi_salon';
  if v_missing > 0 then
    raise exception 'OS-3 : % plan(s) hors famille multi_salon sans plafond de campagnes', v_missing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Le plafond effectif d'une organisation
-- ---------------------------------------------------------------------------
-- Passe par `private.effective_plan_key` — le seul point de jonction où un
-- essai de 14 jours surclasse le plan assigné (B3). Un salon en essai a donc
-- le plafond de son essai, ce qui est le but d'un essai.

create or replace function private.campaign_monthly_allowance(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select p.monthly_campaign_allowance
  from public.commercial_plans p
  where p.plan_key = private.effective_plan_key(p_organization_id);
$$;

comment on function private.campaign_monthly_allowance(uuid) is
'Le plafond mensuel de campagnes du plan EFFECTIF de l''organisation (essai compris). NULL = illimité — ou organisation inconnue : l''appelant doit avoir déjà vérifié l''existence et le droit AVANT d''appeler, sinon il confondrait « illimité » et « n''existe pas ».';

revoke all on function private.campaign_monthly_allowance(uuid) from public, anon, authenticated;

commit;
