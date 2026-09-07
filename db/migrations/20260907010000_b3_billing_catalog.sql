-- FadeUp — B3, chantier 1 : le catalogue de facturation.
--
-- CE QUI FAIT AUTORITÉ
--
-- `public.commercial_plans` fait autorité, et Stripe le reflète. Jamais
-- l'inverse. Un prix affiché ou facturé qui ne viendrait pas de cette table
-- est un bug, et ce fichier est construit pour que ce bug soit impossible :
-- le prix annuel n'est pas une colonne qu'on saisit, c'est une colonne
-- GÉNÉRÉE à partir du prix mensuel et du nombre de mois facturés. On ne peut
-- pas se tromper en la remplissant, parce qu'on ne la remplit pas.
--
-- CE QUE CE FICHIER AJOUTE
--
--   commercial_plans          annual_months_charged, annual_price_minor,
--                             min_establishments, feature_tier_plan_key
--   billing_stripe_products   plan_key -> produit Stripe
--   billing_stripe_prices     plan_key + intervalle -> prix Stripe, historisé
--   organization_billing      client, abonnement, période, échéance, grâce
--   billing_quote_requests    le chemin « sur devis » au-delà de 15
--
-- L'IMMUABILITÉ DES PRIX STRIPE — CONTRAINTE, PAS CHOIX
--
-- Un objet Price de Stripe ne se modifie pas après création : `unit_amount`
-- est en lecture seule. Changer un tarif ne peut donc jamais être un UPDATE.
-- C'est une création suivie d'un archivage, et **les abonnements en cours
-- restent sur l'ancien prix** jusqu'à une migration explicite, décidée et
-- annoncée.
--
-- Ce n'est pas une gêne, c'est une protection : le jour où FadeUp passe
-- `salon_pro` de 49 à 59 €, les professionnels déjà abonnés continuent à
-- payer 49 € tant que personne n'a décidé le contraire. Une hausse subie sur
-- une facture est un motif de résiliation ; une hausse annoncée ne l'est pas.
--
-- `billing_stripe_prices` est donc un HISTORIQUE, pas une correspondance :
-- plusieurs lignes par plan et par intervalle, une seule active à la fois
-- (index unique partiel). L'archivage conserve la ligne, il ne la supprime
-- pas — un abonnement en cours pointe dessus.
--
-- LES BORNES MULTI-ÉTABLISSEMENTS SONT DES DONNÉES
--
-- 2-3 / 4-6 / 7-15 sont des lignes, pas des littéraux dans du code. Le
-- catalogue portait 2 / 5 / 10 en plafonds et aucun plancher ; ce fichier
-- écrit les deux. Élargir un palier plus tard est un UPDATE.
--
-- LE NIVEAU FONCTIONNEL D'UN PALIER EST UN PARAMÈTRE
--
-- MASTER_SPEC et le prompt B3 tranchent : le multi-établissements ouvre le
-- niveau Shop Pro sur tous les établissements. La raison est arithmétique —
-- à trois établissements, 99 € en multi_salon contre 87 € pour trois
-- `salon_essential` à l'unité, le multi est PLUS CHER ; contre 147 € pour
-- trois `salon_pro`, il devient nettement avantageux. Sans niveau supérieur,
-- le palier d'entrée ne se vend pas.
--
-- Plutôt que de recopier vingt-six capacités à la main, `feature_tier_plan_key`
-- nomme le plan dont le palier reprend le niveau, et `sync_plan_feature_tier`
-- fait la copie. Le jour où le fondateur ouvre le niveau Scale, c'est un
-- UPDATE d'une colonne suivi d'un appel de fonction — pas une réécriture.
--
-- La synchronisation est ADDITIVE, jamais soustractive : elle n'a pas le
-- droit de retirer une capacité à un plan sur lequel des organisations sont
-- déjà installées. Retirer est une décision distincte, qui se prend et
-- s'annonce.
--
-- TVA
--
-- Les prix de `commercial_plans` sont HORS TAXE. Stripe Tax calcule la TVA
-- selon le pays du client ; un professionnel français à 49 € HT paie environ
-- 59 € TTC. `organization_billing.tax_id_value` porte le numéro de TVA
-- intracommunautaire quand le client en a un — l'autoliquidation s'applique
-- hors de France, et c'est Stripe qui l'applique, pas nous.
--
-- MODE TEST
--
-- `livemode` est présent sur chaque objet Stripe enregistré, et il est faux
-- partout tant que le fondateur n'a pas décidé le contraire. Un identifiant
-- de prix de test et un identifiant de prix réel ne se ressemblent pas, mais
-- rien dans leur forme ne les distingue : la colonne, si.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Le catalogue : annuel, bornes, niveau fonctionnel
-- ---------------------------------------------------------------------------

-- Dix mois payés, douze servis (MASTER_SPEC §4). Le nombre de mois facturés
-- est une colonne et non une constante : un plan pourrait un jour être servi
-- à onze, ou l'annuel être retiré d'un plan en le passant à douze.
alter table public.commercial_plans
  add column if not exists annual_months_charged smallint not null default 10;

alter table public.commercial_plans
  drop constraint if exists commercial_plans_annual_months_sane;
alter table public.commercial_plans
  add constraint commercial_plans_annual_months_sane
  check (annual_months_charged between 1 and 12);

-- GÉNÉRÉE. Personne ne saisit un prix annuel, donc personne ne peut saisir un
-- prix annuel faux. C'est la forme la plus courte de « la base fait autorité ».
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.commercial_plans'::regclass
      and attname = 'annual_price_minor' and not attisdropped
  ) then
    alter table public.commercial_plans
      add column annual_price_minor integer
      generated always as (price_minor * annual_months_charged) stored;
  end if;
end $$;

-- Le plancher d'établissements d'un palier. 1 pour tout le reste du
-- catalogue : `free`, `solo` et les plans salon couvrent un établissement.
alter table public.commercial_plans
  add column if not exists min_establishments integer not null default 1;

alter table public.commercial_plans
  drop constraint if exists commercial_plans_establishment_bounds_sane;
alter table public.commercial_plans
  add constraint commercial_plans_establishment_bounds_sane
  check (min_establishments >= 1 and min_establishments <= max_establishments);

-- Le plan dont ce plan reprend le niveau fonctionnel. Auto-référence : un
-- palier multi_salon pointe vers un plan salon.
alter table public.commercial_plans
  add column if not exists feature_tier_plan_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commercial_plans'::regclass
      and conname = 'commercial_plans_feature_tier_fkey'
  ) then
    alter table public.commercial_plans
      add constraint commercial_plans_feature_tier_fkey
      foreign key (feature_tier_plan_key) references public.commercial_plans(plan_key)
      on update cascade on delete restrict;
  end if;
end $$;

-- Un plan ne peut pas reprendre son propre niveau : la synchronisation
-- tournerait à vide et masquerait une erreur de saisie.
alter table public.commercial_plans
  drop constraint if exists commercial_plans_feature_tier_not_self;
alter table public.commercial_plans
  add constraint commercial_plans_feature_tier_not_self
  check (feature_tier_plan_key is null or feature_tier_plan_key <> plan_key);

comment on column public.commercial_plans.annual_months_charged is
'Nombre de mois facturés sur un an. 10 pour tous les plans payants : dix mois payés, douze servis (MASTER_SPEC §4).';

comment on column public.commercial_plans.annual_price_minor is
'Prix annuel HT en centimes. GÉNÉRÉE à partir de price_minor et annual_months_charged : elle ne se saisit pas, donc elle ne peut pas diverger du mensuel.';

comment on column public.commercial_plans.min_establishments is
'Plancher d''établissements du palier. Avec max_establishments, définit les bornes 2-3 / 4-6 / 7-15 de la famille multi_salon. Paramétrable : élargir un palier est un UPDATE.';

comment on column public.commercial_plans.feature_tier_plan_key is
'Plan dont celui-ci reprend le niveau fonctionnel. Les paliers multi_salon pointent vers salon_pro : le multi ouvre le niveau Shop Pro sur tous les établissements. Changer de niveau est un UPDATE suivi de sync_plan_feature_tier(), pas une réécriture.';

-- ---------------------------------------------------------------------------
-- 2. Les bornes réelles des paliers multi-établissements
-- ---------------------------------------------------------------------------

-- Le catalogue portait 2 / 5 / 10 en plafonds, sans planchers. Le prompt B3
-- tranche 2-3 / 4-6 / 7-15. Ces UPDATE ÉLARGISSENT : aucune organisation ne
-- peut se retrouver au-dessus de son plafond du fait de ce fichier.
update public.commercial_plans set min_establishments = 2, max_establishments = 3
where plan_key = 'multi_growth';

update public.commercial_plans set min_establishments = 4, max_establishments = 6
where plan_key = 'multi_pro';

update public.commercial_plans set min_establishments = 7, max_establishments = 15
where plan_key = 'multi_scale';

-- ---------------------------------------------------------------------------
-- 3. Le niveau fonctionnel des paliers
-- ---------------------------------------------------------------------------

create or replace function public.sync_plan_feature_tier(p_plan_key text)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_source text;
  v_added integer;
begin
  select p.feature_tier_plan_key into v_source
  from public.commercial_plans p where p.plan_key = p_plan_key;

  if v_source is null then
    -- Pas d'erreur : un plan sans niveau de référence est le cas normal du
    -- catalogue. Zéro capacité ajoutée est la bonne réponse.
    return 0;
  end if;

  -- ADDITIVE. `on conflict do nothing` et aucun DELETE : cette fonction ne
  -- peut pas retirer une capacité à un plan sur lequel des organisations sont
  -- installées. Retirer une capacité est une décision qui s'annonce, pas un
  -- effet de bord d'une synchronisation.
  with inserted as (
    insert into public.plan_capabilities (plan_key, capability_key)
    select p_plan_key, pc.capability_key
    from public.plan_capabilities pc
    where pc.plan_key = v_source
    on conflict (plan_key, capability_key) do nothing
    returning 1
  )
  select count(*) into v_added from inserted;

  return v_added;
end;
$$;

comment on function public.sync_plan_feature_tier(text) is
'Recopie sur le plan les capacités du plan nommé par feature_tier_plan_key. ADDITIVE : n''enlève jamais rien. Rend le niveau fonctionnel d''un palier paramétrable — ouvrir le niveau Scale sur multi_growth est un UPDATE de la colonne suivi d''un appel ici.';

revoke all on function public.sync_plan_feature_tier(text) from public, anon, authenticated;

-- Les trois paliers reprennent au minimum le niveau Shop Pro. multi_scale
-- garde salon_business, qui lui est supérieur : la règle est un plancher, pas
-- un nivellement.
update public.commercial_plans set feature_tier_plan_key = 'salon_pro'
where plan_key in ('multi_growth', 'multi_pro') and feature_tier_plan_key is distinct from 'salon_pro';

update public.commercial_plans set feature_tier_plan_key = 'salon_business'
where plan_key = 'multi_scale' and feature_tier_plan_key is distinct from 'salon_business';

select public.sync_plan_feature_tier('multi_growth');
select public.sync_plan_feature_tier('multi_pro');
select public.sync_plan_feature_tier('multi_scale');

-- ---------------------------------------------------------------------------
-- 4. L'intervalle de facturation
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'stripe_billing_interval') then
    create type public.stripe_billing_interval as enum ('month', 'year');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. La correspondance avec Stripe : produits
-- ---------------------------------------------------------------------------

create table if not exists public.billing_stripe_products (
  plan_key text primary key
    references public.commercial_plans(plan_key) on update cascade on delete restrict,
  stripe_product_id text not null,
  -- Faux tant que le fondateur n'a pas décidé le passage en mode réel. Deux
  -- identifiants de produit, l'un de test et l'autre réel, ne se distinguent
  -- pas à l'œil : cette colonne est la seule chose qui les sépare.
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un identifiant de produit Stripe généré commence par prod_, mais le
  -- script de synchronisation crée les produits avec un identifiant
  -- DÉTERMINISTE (fadeup_<plan>) — c'est ce qui le rend idempotent côté
  -- Stripe. La forme admet donc les deux.
  constraint billing_stripe_products_id_shape check (stripe_product_id ~ '^[A-Za-z0-9_]{1,255}$')
);

create unique index if not exists billing_stripe_products_stripe_id_key
  on public.billing_stripe_products (stripe_product_id);

-- Le catalogue de test et le catalogue réel doivent pouvoir coexister le jour
-- de la bascule. La clé primaire sur plan_key seule l'interdit ; on la garde
-- quand même, et on l'assume : tant que B3 est en mode test, une seule ligne
-- par plan, et le passage en mode réel remplacera la ligne après décision.
comment on table public.billing_stripe_products is
'Correspondance plan FadeUp -> produit Stripe. Une ligne par plan. La base fait autorité : c''est le script de synchronisation qui écrit Stripe à partir d''ici, jamais l''inverse.';

-- ---------------------------------------------------------------------------
-- 6. La correspondance avec Stripe : prix, historisés
-- ---------------------------------------------------------------------------

create table if not exists public.billing_stripe_prices (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null
    references public.commercial_plans(plan_key) on update cascade on delete restrict,
  billing_interval public.stripe_billing_interval not null,
  stripe_price_id text not null,
  -- Le montant AU MOMENT DE LA CRÉATION du prix Stripe. Ce n'est pas une
  -- duplication du catalogue : c'est ce que paient réellement les abonnements
  -- accrochés à ce prix, y compris après que commercial_plans a changé.
  unit_amount_minor integer not null,
  currency text not null default 'EUR',
  livemode boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint billing_stripe_prices_id_shape check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint billing_stripe_prices_amount_sane check (unit_amount_minor >= 0),
  constraint billing_stripe_prices_currency_format check (currency ~ '^[A-Z]{3}$'),
  -- Actif et archivé sont exclusifs. Un prix archivé porte sa date.
  constraint billing_stripe_prices_archive_coherent
    check ((is_active and archived_at is null) or (not is_active and archived_at is not null))
);

create unique index if not exists billing_stripe_prices_stripe_id_key
  on public.billing_stripe_prices (stripe_price_id);

-- UN SEUL prix actif par plan, intervalle et mode. C'est ce qui rend le script
-- de synchronisation idempotent : relancé, il trouve la ligne active et ne
-- crée rien. C'est aussi ce qui empêche deux tarifs concurrents d'exister pour
-- le même plan, situation dans laquelle « quel prix paie le prochain client »
-- n'aurait pas de réponse.
create unique index if not exists billing_stripe_prices_one_active_per_plan
  on public.billing_stripe_prices (plan_key, billing_interval, livemode)
  where is_active;

create index if not exists billing_stripe_prices_plan_idx
  on public.billing_stripe_prices (plan_key, billing_interval);

comment on table public.billing_stripe_prices is
'Historique des prix Stripe par plan et intervalle. Un prix Stripe est IMMUABLE : changer un tarif crée une ligne et archive la précédente, et les abonnements en cours restent accrochés à l''ancienne jusqu''à migration explicite. C''est ce qui protège les premiers clients d''une hausse subie.';

comment on column public.billing_stripe_prices.unit_amount_minor is
'Montant HT en centimes au moment de la création du prix Stripe. Volontairement figé : il dit ce que paient les abonnements accrochés à ce prix, pas ce que dit le catalogue aujourd''hui.';

-- ---------------------------------------------------------------------------
-- 7. L'abonnement d'une organisation
-- ---------------------------------------------------------------------------

create table if not exists public.organization_billing (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,

  stripe_customer_id text,
  stripe_subscription_id text,
  -- L'item d'abonnement (si_...) : c'est LUI qu'un changement de plan met à
  -- jour chez Stripe. Le mémoriser évite un aller-retour de lecture au moment
  -- d'appliquer un changement programmé.
  stripe_subscription_item_id text,

  -- Les statuts de Stripe, tels quels. Les traduire en vocabulaire FadeUp
  -- ferait perdre l'information au moment précis où on en a besoin : quand
  -- une facturation part de travers.
  subscription_status text,

  plan_key text references public.commercial_plans(plan_key) on update cascade,
  billing_interval public.stripe_billing_interval,
  stripe_price_id text,

  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,

  -- Sept jours de grâce après un échec de paiement (décision B3 §6). Nul
  -- quand tout va bien.
  grace_until timestamptz,

  -- Le changement PROGRAMMÉ, appliqué à la fin de la période courante : une
  -- descente de gamme, un retour au mensuel, une bascule de palier. Le
  -- professionnel a payé jusqu'au bout de la période, il garde jusqu'au bout.
  scheduled_plan_key text references public.commercial_plans(plan_key) on update cascade,
  scheduled_interval public.stripe_billing_interval,
  scheduled_effective_at timestamptz,
  scheduled_reason text,
  -- Quand le scheduler a transmis le changement programmé à Stripe. Le
  -- programmé ne s'efface qu'au retour du webhook : cette date est ce qui
  -- rend la transmission visible et re-tentable sans être répétée à chaque tick.
  scheduled_dispatched_at timestamptz,

  -- Numéro de TVA intracommunautaire, quand le client en a un. Stripe Tax
  -- applique l'autoliquidation hors de France à partir de là.
  tax_id_type text,
  tax_id_value text,

  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_billing_customer_shape
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  constraint organization_billing_subscription_shape
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  constraint organization_billing_price_shape
    check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint organization_billing_status_known
    check (subscription_status is null or subscription_status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active',
      'past_due', 'canceled', 'unpaid', 'paused')),
  -- Un changement programmé porte toujours sa date : sans elle, personne ne
  -- sait quand l'appliquer et il resterait en attente pour toujours.
  constraint organization_billing_scheduled_coherent
    check ((scheduled_plan_key is null and scheduled_interval is null)
           or scheduled_effective_at is not null),
  constraint organization_billing_period_ordered
    check (current_period_start is null or current_period_end is null
           or current_period_end > current_period_start)
);

create index if not exists organization_billing_customer_idx
  on public.organization_billing (stripe_customer_id) where stripe_customer_id is not null;

create unique index if not exists organization_billing_subscription_key
  on public.organization_billing (stripe_subscription_id) where stripe_subscription_id is not null;

-- Les deux balayages du scheduler : la grâce échue, et le changement programmé
-- arrivé à terme.
create index if not exists organization_billing_grace_idx
  on public.organization_billing (grace_until) where grace_until is not null;

create index if not exists organization_billing_scheduled_idx
  on public.organization_billing (scheduled_effective_at) where scheduled_effective_at is not null;

comment on table public.organization_billing is
'État Stripe d''une organisation : client, abonnement, période courante, échéance, grâce, changement programmé, TVA. Écrite par les webhooks et par les RPC de facturation, jamais par le client.';

comment on column public.organization_billing.grace_until is
'Fin des sept jours de grâce ouverts par un invoice.payment_failed. Pendant la grâce, les capacités sont conservées (effective_plan_key ne dégrade que sur status = canceled) et le professionnel est relancé à J+1, J+3 et J+6. Après, retour au Free — données conservées, profil toujours publié.';

comment on column public.organization_billing.scheduled_plan_key is
'Plan qui prendra effet à scheduled_effective_at. Une descente de gamme ne coupe jamais une capacité déjà payée : elle attend la fin de la période. Une descente immédiate serait un litige.';

-- ---------------------------------------------------------------------------
-- 8. Le chemin « sur devis », au-delà de quinze établissements
-- ---------------------------------------------------------------------------

-- Sans plafond, une chaîne de cinquante établissements paierait le prix d'une
-- chaîne de sept. Le palier haut est donc borné à 15. Mais borner n'est pas
-- bloquer : au-delà, il y a une demande de devis, tracée, avec une réponse
-- attendue — pas un mur silencieux.
create table if not exists public.billing_quote_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  establishments_requested integer not null,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint billing_quote_requests_count_sane check (establishments_requested > 0),
  constraint billing_quote_requests_status_known
    check (status in ('open', 'contacted', 'closed'))
);

create index if not exists billing_quote_requests_org_idx
  on public.billing_quote_requests (organization_id, created_at desc);

-- Une seule demande ouverte par organisation : cliquer trois fois ne crée pas
-- trois dossiers pour l'équipe commerciale.
create unique index if not exists billing_quote_requests_one_open_per_org
  on public.billing_quote_requests (organization_id) where status = 'open';

comment on table public.billing_quote_requests is
'Demandes de devis au-delà du palier haut (15 établissements). Existe pour qu''un dépassement de palier soit un chemin et non un blocage silencieux.';

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------

alter table public.billing_stripe_products enable row level security;
alter table public.billing_stripe_products force row level security;
alter table public.billing_stripe_prices enable row level security;
alter table public.billing_stripe_prices force row level security;
alter table public.organization_billing enable row level security;
alter table public.organization_billing force row level security;
alter table public.billing_quote_requests enable row level security;
alter table public.billing_quote_requests force row level security;

-- Le catalogue Stripe n'a rien de secret : un identifiant de prix voyage dans
-- le navigateur du client au moment du Checkout. Il est donc lisible par tout
-- utilisateur authentifié, comme commercial_plans l'est déjà.
drop policy if exists billing_stripe_products_select on public.billing_stripe_products;
create policy billing_stripe_products_select on public.billing_stripe_products
  for select to authenticated using (true);

drop policy if exists billing_stripe_prices_select on public.billing_stripe_prices;
create policy billing_stripe_prices_select on public.billing_stripe_prices
  for select to authenticated using (true);

-- LA GARDE PRODUIT, EN RLS. « Le propriétaire uniquement. Ni manager, ni
-- réceptionniste, ni barber. » Ce n'est pas seulement une règle d'interface :
-- c'est la politique de lecture de la table. Un manager qui interroge
-- l'API PostgREST directement ne voit RIEN, pas une ligne masquée — rien.
drop policy if exists organization_billing_select_owner on public.organization_billing;
create policy organization_billing_select_owner on public.organization_billing
  for select to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

drop policy if exists billing_quote_requests_select_owner on public.billing_quote_requests;
create policy billing_quote_requests_select_owner on public.billing_quote_requests
  for select to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

-- Aucune politique d'écriture, sur aucune de ces tables, pour aucun rôle
-- client. Tout ce qui écrit ici est SECURITY DEFINER et vérifie la propriété
-- lui-même. `force row level security` fait que même le propriétaire de la
-- table subit les politiques : une fonction SECURITY DEFINER possédée par
-- postgres n'est pas dispensée par accident.

revoke all on table public.billing_stripe_products from anon, authenticated;
revoke all on table public.billing_stripe_prices from anon, authenticated;
revoke all on table public.organization_billing from anon, authenticated;
revoke all on table public.billing_quote_requests from anon, authenticated;

grant select on table public.billing_stripe_products to authenticated;
grant select on table public.billing_stripe_prices to authenticated;
grant select on table public.organization_billing to authenticated;
grant select on table public.billing_quote_requests to authenticated;

-- `updated_at` : le même déclencheur que partout ailleurs dans ce schéma.
drop trigger if exists billing_stripe_products_set_updated_at on public.billing_stripe_products;
create trigger billing_stripe_products_set_updated_at
  before update on public.billing_stripe_products
  for each row execute function public.set_updated_at();

drop trigger if exists organization_billing_set_updated_at on public.organization_billing;
create trigger organization_billing_set_updated_at
  before update on public.organization_billing
  for each row execute function public.set_updated_at();

drop trigger if exists billing_quote_requests_set_updated_at on public.billing_quote_requests;
create trigger billing_quote_requests_set_updated_at
  before update on public.billing_quote_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Le catalogue lisible par le produit
-- ---------------------------------------------------------------------------

-- Un seul appel qui donne tout ce dont un écran de tarifs a besoin :
-- le catalogue en base, ses bornes, et les identifiants de prix Stripe
-- correspondants. Aucun prix codé en dur nulle part, aucune raison d'en coder.
create or replace function public.get_billing_catalog()
returns table (
  plan_key text,
  commercial_family public.commercial_family,
  display_name text,
  tier integer,
  is_recommended boolean,
  is_available boolean,
  price_minor integer,
  annual_price_minor integer,
  annual_months_charged smallint,
  price_currency text,
  min_establishments integer,
  max_establishments integer,
  max_operational_professionals integer,
  monthly_stripe_price_id text,
  annual_stripe_price_id text,
  live_capabilities text[]
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    p.plan_key,
    p.commercial_family,
    p.display_name,
    p.tier,
    p.is_recommended,
    p.is_available,
    p.price_minor,
    p.annual_price_minor,
    p.annual_months_charged,
    p.price_currency,
    p.min_establishments,
    p.max_establishments,
    p.max_operational_professionals,
    (select sp.stripe_price_id from public.billing_stripe_prices sp
      where sp.plan_key = p.plan_key and sp.billing_interval = 'month' and sp.is_active),
    (select sp.stripe_price_id from public.billing_stripe_prices sp
      where sp.plan_key = p.plan_key and sp.billing_interval = 'year' and sp.is_active),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      join public.commercial_capabilities c on c.capability_key = pc.capability_key
      where pc.plan_key = p.plan_key and c.status = 'live'
    ), array[]::text[])
  from public.commercial_plans p
  order by p.commercial_family, p.tier;
$$;

comment on function public.get_billing_catalog() is
'Le catalogue tarifaire complet : prix mensuel et annuel HT, bornes d''établissements, capacités livrées et identifiants de prix Stripe actifs. Un écran de tarifs n''a aucune raison de coder un prix en dur ; celui-ci lui donne tout.';

revoke all on function public.get_billing_catalog() from public;
grant execute on function public.get_billing_catalog() to authenticated, anon;

commit;
