-- FadeUp — PLAT-1 (2/3) : le socle de permissions internes, les zones,
-- l'origine des prospects, la vue en tant que bornée, et l'audit scellé.
--
-- ============================================================================
-- LE MANQUE
-- ============================================================================
-- Dix-huit lots ont évité /platform. La console y sert trois comptes internes
-- réels, et son autorisation tient en deux fonctions : `is_platform_admin()`
-- (owner + admin) et `has_platform_role([owner, admin, support])`. Un rôle
-- interne EST donc un niveau, pas un ensemble de droits — il n'y a aucun
-- endroit où lire « ce que le commercial a le droit de faire ».
--
-- Le fondateur a tranché six rôles dont les droits se croisent (le modérateur
-- valide des onboardings comme le commercial, mais n'entre pas au CRM ; le
-- support annule un rendez-vous que le commercial ne touche pas). Une échelle
-- ne représente pas ça. Il faut une grille.
--
-- ============================================================================
-- LE MODÈLE
-- ============================================================================
-- 1. `platform_permissions` — le catalogue des droits, un par ligne, décrit.
-- 2. `platform_role_permissions` — la grille rôle × droit. Ce qui n'y est pas
--    est refusé : le défaut est le refus, par construction et non par
--    convention.
-- 3. `private.platform_can(clé)` — LA question que posent les RPC et les
--    policies. Un appelant anonyme n'a pas de ligne dans platform_members :
--    `exists` rend `false`, jamais NULL. Le piège X3 (`colonne = auth.uid()`
--    vaut NULL pour un anonyme, et `if not NULL` ne lève pas) est traité en
--    amont : cette fonction ne compare rien, elle teste une existence, et
--    chaque garde écrite ici est de la forme `if not private.platform_can(...)
--    then raise`, jamais `if private.platform_can(...) = false`.
-- 4. `public.get_my_platform_permissions()` — ce que l'interface lit pour
--    CONDITIONNER le rendu. Elle n'autorise rien : chaque RPC repose la
--    question côté serveur.
--
-- LES ZONES. Une zone est un couple (pays ISO-2, ville normalisée). Motif :
-- la base ne porte aucune géographie utilisable autrement. Pas de PostGIS
-- (refusé en 20260811150000), pas de géocodeur, pas de table de communes ; les
-- coordonnées de `locations` sont saisies à la main et le plus souvent nulles.
-- `prospect_locations` porte `city` sur 20 lignes de 48 et `postal_code` sur
-- 21 : ni l'un ni l'autre n'est complet, mais la ville est ce qu'un stagiaire
-- sur le terrain sait dire. Le modèle de zone de service de B1
-- (`locations.kind = 'service_area'`, centre + rayon ≤ 100 km) décrit la
-- couverture d'UN professionnel mobile ; l'employer comme découpage de
-- territoire commercial reviendrait à inventer des centres et des rayons que
-- personne n'a mesurés — exactement ce que le lot interdit. Le code postal est
-- conservé sur la zone comme indication, jamais comme identité.
--
-- LES DEUX ORIGINES. `prospects` n'avait pas de colonne de provenance : la
-- trace vivait dans `prospect_source_records` (adaptateur, URL, charge brute),
-- ce qui convient à une machine et pas à un commercial qui décroche son
-- téléphone. PLAT-1 ajoute `origin`, `field_captured_by`, `field_captured_at`
-- et `field_observation` : l'origine, l'auteur, la date, et ce que le
-- stagiaire a vu de ses yeux.
--
-- LA VUE EN TANT QUE. La session existait (20260810140000) sans échéance et
-- sans garde de paiement. PLAT-1 lui ajoute `expires_at` (30 minutes), ouvre
-- l'entrée au modérateur par permission, refuse tout geste de paiement tant
-- qu'une session est ouverte, et rend la session lisible au propriétaire de
-- l'organisation concernée.
--
-- L'AUDIT. `platform_audit_log` était protégé par les seuls privilèges. PLAT-1
-- y pose le déclencheur d'immuabilité de `commercial_plan_changes`, sans
-- exemption de rôle : un journal que le rôle le plus puissant peut réécrire
-- n'est pas un journal.
--
-- À APPLIQUER EN postgres — propriétaires vérifiés : platform_members,
-- platform_audit_log, platform_support_sessions, prospects et toutes les
-- tables prospect_* touchées ici appartiennent à postgres, comme les 22
-- fonctions redéfinies. Les tables outreach_*/ml_*/whatsapp_*/api_* et une
-- partie des prospect_* appartiennent à supabase_admin : leurs policies sont
-- dans 20260911100200, appliqué par supabase_admin.
--
-- Après 20260911100000 (valeurs d'énumération committées).
-- Invariant X3 (règle 4) : grants EXPLICITES sur chaque RPC neuve. Aucune
-- n'est exécutable par anon : PLAT-1 n'ajoute rien à la surface anonyme.
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ============================================================================
-- 1. LE CATALOGUE DES DROITS
-- ============================================================================

create table if not exists public.platform_permissions (
  key text primary key,
  description text not null,
  created_at timestamptz not null default now(),
  constraint platform_permissions_key_shape check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

comment on table public.platform_permissions is
  'Le catalogue des droits internes FadeUp. Une ligne par droit, décrite en clair. Sert de référence à public.platform_role_permissions : un droit qui n''est pas ici ne peut être accordé à personne (clé étrangère).';

alter table public.platform_permissions enable row level security;
alter table public.platform_permissions force row level security;
revoke all on public.platform_permissions from anon, authenticated;
grant select on public.platform_permissions to authenticated;

drop policy if exists platform_permissions_select on public.platform_permissions;
create policy platform_permissions_select
  on public.platform_permissions
  for select
  to authenticated
  using (exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid())));

comment on policy platform_permissions_select on public.platform_permissions is
  'Le catalogue est lisible par tout interne — savoir quels droits existent n''est pas un droit. Un appelant anonyme n''a pas de ligne dans platform_members : l''EXISTS rend false, jamais NULL.';

insert into public.platform_permissions (key, description) values
  ('crm.read',              'Lire le CRM entier : prospects, campagnes, sources, modèles, WhatsApp, quotas.'),
  ('crm.write',             'Écrire dans le CRM : qualifier, annoter, dédupliquer, supprimer.'),
  ('crm.zone_read',         'Lire les prospects de ses zones seulement, et ceux qu''on a saisis soi-même.'),
  ('crm.field_capture',     'Enregistrer un prospect vu sur le terrain, avec son observation.'),
  ('marketplace.publish',   'Publier un prospect sur la marketplace — déclenche l''information RGPD et engage la responsabilité légale.'),
  ('marketplace.withdraw',  'Enregistrer et exécuter une demande de retrait de la marketplace, sous l''engagement des 72 heures.'),
  ('onboarding.review',     'Valider ou refuser une candidature professionnelle et une revendication de profil.'),
  ('moderation.content',    'Masquer un avis ou un post, résoudre un signalement.'),
  ('appointment.cancel',    'Annuler un rendez-vous au nom du support.'),
  ('tenant.read',           'Lire l''identité des organisations pour traiter un appel ou un signalement.'),
  ('commercial.plan_assign','Assigner un plan commercial ou une remise — jamais un moyen de paiement.'),
  ('support_view.enter',    'Prendre la vue d''un propriétaire de salon, sous trace et sous échéance.'),
  ('billing.manage',        'Toucher au paiement : plan payant, moyen de paiement, résiliation, portail.'),
  ('audit.read',            'Consulter le journal d''audit interne.'),
  ('internal_roles.manage', 'Créer, changer et révoquer un rôle interne, et assigner des zones.'),
  ('barber.delete',         'Supprimer définitivement un barber.')
on conflict (key) do update set description = excluded.description;

-- ============================================================================
-- 2. LA GRILLE
-- ============================================================================

create table if not exists public.platform_role_permissions (
  role public.platform_role not null,
  permission_key text not null references public.platform_permissions (key) on update cascade on delete restrict,
  primary key (role, permission_key)
);

comment on table public.platform_role_permissions is
  'La grille rôle interne × droit. LE défaut est le refus : une paire absente n''autorise rien, et il n''existe aucun chemin d''écriture client vers cette table (seul le fondateur, par set_platform_member_role, change le rôle d''une personne ; la grille elle-même ne change que par migration). C''est ici qu''on lit « ce que le commercial a le droit de faire », et nulle part ailleurs.';

alter table public.platform_role_permissions enable row level security;
alter table public.platform_role_permissions force row level security;
revoke all on public.platform_role_permissions from anon, authenticated;
grant select on public.platform_role_permissions to authenticated;

drop policy if exists platform_role_permissions_select on public.platform_role_permissions;
create policy platform_role_permissions_select
  on public.platform_role_permissions
  for select
  to authenticated
  using (exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid())));

-- La grille, telle que le fondateur l'a tranchée. Chaque ligne absente est une
-- décision autant que chaque ligne présente.
insert into public.platform_role_permissions (role, permission_key) values
  -- Fondateur : tout.
  ('platform_owner',     'crm.read'),
  ('platform_owner',     'crm.write'),
  ('platform_owner',     'crm.field_capture'),
  ('platform_owner',     'marketplace.publish'),
  ('platform_owner',     'marketplace.withdraw'),
  ('platform_owner',     'onboarding.review'),
  ('platform_owner',     'moderation.content'),
  ('platform_owner',     'appointment.cancel'),
  ('platform_owner',     'tenant.read'),
  ('platform_owner',     'commercial.plan_assign'),
  ('platform_owner',     'support_view.enter'),
  ('platform_owner',     'billing.manage'),
  ('platform_owner',     'audit.read'),
  ('platform_owner',     'internal_roles.manage'),
  ('platform_owner',     'barber.delete'),
  -- Admin : tout, SAUF supprimer un barber et gérer les rôles internes.
  ('platform_admin',     'crm.read'),
  ('platform_admin',     'crm.write'),
  ('platform_admin',     'crm.field_capture'),
  ('platform_admin',     'marketplace.publish'),
  ('platform_admin',     'marketplace.withdraw'),
  ('platform_admin',     'onboarding.review'),
  ('platform_admin',     'moderation.content'),
  ('platform_admin',     'appointment.cancel'),
  ('platform_admin',     'tenant.read'),
  ('platform_admin',     'commercial.plan_assign'),
  ('platform_admin',     'support_view.enter'),
  ('platform_admin',     'billing.manage'),
  ('platform_admin',     'audit.read'),
  -- Support : l'appel. Clients et pros. Pas de CRM, pas de journal.
  ('platform_support',   'tenant.read'),
  ('platform_support',   'appointment.cancel'),
  ('platform_support',   'marketplace.withdraw'),
  -- Modérateur : le contenu, les onboardings, la vue en tant que. Pas de CRM.
  ('platform_moderator', 'tenant.read'),
  ('platform_moderator', 'moderation.content'),
  ('platform_moderator', 'onboarding.review'),
  ('platform_moderator', 'marketplace.withdraw'),
  ('platform_moderator', 'support_view.enter'),
  -- Commercial : le CRM, la publication, les onboardings, les plans.
  ('platform_sales',     'crm.read'),
  ('platform_sales',     'crm.write'),
  ('platform_sales',     'crm.field_capture'),
  ('platform_sales',     'marketplace.publish'),
  ('platform_sales',     'onboarding.review'),
  ('platform_sales',     'commercial.plan_assign'),
  -- Stagiaire : le terrain, dans sa zone. Rien de public.
  ('platform_intern',    'crm.zone_read'),
  ('platform_intern',    'crm.field_capture')
on conflict (role, permission_key) do nothing;

-- ============================================================================
-- 3. LA QUESTION
-- ============================================================================

create or replace function private.platform_can(p_permission text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  -- Une EXISTENCE, jamais une comparaison : pour un appelant anonyme,
  -- auth.uid() vaut NULL, aucune ligne ne joint, et le résultat est false.
  -- C'est la forme qui évite le piège documenté par X3 (une comparaison
  -- `colonne = auth.uid()` vaut NULL, et `if not NULL` ne lève pas).
  select exists (
    select 1
    from public.platform_members pm
    join public.platform_role_permissions rp on rp.role = pm.role
    where pm.user_id = (select auth.uid())
      and rp.permission_key = p_permission
  );
$$;

comment on function private.platform_can(text) is
  'LE point de vérification des droits internes. Rend true seulement si l''appelant a une ligne dans platform_members dont le rôle porte ce droit dans la grille. Rend false — jamais NULL — pour un anonyme, un compte sans rôle interne, ou un droit inconnu. Toute garde écrite ailleurs doit être de la forme « if not private.platform_can(...) then raise ».';

-- Une fonction appelée DEPUIS UNE POLICY est évaluée sous l'identité de
-- l'appelant : `authenticated` doit pouvoir l'exécuter, sinon toute lecture
-- CRM meurt sur « permission denied ». C'est le régime des autres aides de
-- policy (private.is_platform_admin, private.has_org_role…), vérifié.
revoke all on function private.platform_can(text) from public, anon;
grant execute on function private.platform_can(text) to authenticated;

create or replace function public.get_my_platform_permissions()
returns setof text
language sql
security definer
stable
set search_path = ''
as $$
  select rp.permission_key
  from public.platform_members pm
  join public.platform_role_permissions rp on rp.role = pm.role
  where pm.user_id = (select auth.uid())
  order by 1;
$$;

comment on function public.get_my_platform_permissions() is
  'Les droits internes de l''APPELANT, pour que l''interface conditionne son rendu — une capacité absente n''est pas rendue, jamais grisée. Ne prend aucun paramètre : on ne peut pas l''interroger sur autrui. N''AUTORISE RIEN : chaque RPC repose la question côté serveur. Zéro ligne pour un anonyme.';

revoke all on function public.get_my_platform_permissions() from public, anon;
grant execute on function public.get_my_platform_permissions() to authenticated;

commit;

-- ============================================================================
-- 4. LES ZONES
-- ============================================================================

begin;

create table if not exists public.platform_zones (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  city text not null,
  city_key text not null,
  postal_code_hint text,
  label text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_zones_country_iso check (country ~ '^[A-Z]{2}$'),
  constraint platform_zones_city_not_blank check (btrim(city) <> ''),
  constraint platform_zones_city_key_not_blank check (btrim(city_key) <> ''),
  constraint platform_zones_label_not_blank check (btrim(label) <> '')
);

create unique index if not exists platform_zones_country_city_key_unique
  on public.platform_zones (country, city_key);

comment on table public.platform_zones is
  'Une zone commerciale FadeUp : un couple (pays ISO-2, ville normalisée). Motif du découpage, documenté en tête de migration : la base ne porte aucune autre géographie utilisable — pas de PostGIS, pas de géocodeur, pas de table de communes, et les coordonnées sont saisies à la main. La ville est ce qu''un stagiaire sait dire de son terrain. Le code postal est une INDICATION (postal_code_hint), pas l''identité de la zone : une ville en porte plusieurs.';
comment on column public.platform_zones.city_key is
  'La ville normalisée par private.platform_zone_key() — minuscules, sans accents, sans espaces de bord. C''est elle qui porte l''unicité, pour que « Saint-Étienne » et « saint-etienne » soient la même zone.';
comment on column public.platform_zones.postal_code_hint is
  'Indication pour l''humain qui assigne la zone. Jamais utilisée pour décider ce qu''un stagiaire voit.';

alter table public.platform_zones enable row level security;
alter table public.platform_zones force row level security;
revoke all on public.platform_zones from anon, authenticated;
grant select on public.platform_zones to authenticated;

drop policy if exists platform_zones_select on public.platform_zones;
create policy platform_zones_select
  on public.platform_zones
  for select
  to authenticated
  using (exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid())));

comment on policy platform_zones_select on public.platform_zones is
  'Tout interne voit la liste des zones — un stagiaire doit pouvoir nommer la sienne. Ce qu''il voit DANS une zone est une autre question, tranchée sur prospects. EXISTS : false pour un anonyme, jamais NULL.';

create table if not exists public.platform_member_zones (
  user_id uuid not null references public.platform_members (user_id) on delete cascade,
  zone_id uuid not null references public.platform_zones (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, zone_id)
);

comment on table public.platform_member_zones is
  'Les zones d''un interne. Plusieurs stagiaires par zone et plusieurs zones par stagiaire : c''est une table d''association, sans unicité d''un côté ni de l''autre. Assignée par le fondateur seul (set_platform_member_zones). Une ligne ici n''autorise rien à elle seule : elle RESTREINT ce que voit un rôle porteur de crm.zone_read.';

create index if not exists platform_member_zones_zone_idx on public.platform_member_zones (zone_id);

alter table public.platform_member_zones enable row level security;
alter table public.platform_member_zones force row level security;
revoke all on public.platform_member_zones from anon, authenticated;
grant select on public.platform_member_zones to authenticated;

drop policy if exists platform_member_zones_select on public.platform_member_zones;
create policy platform_member_zones_select
  on public.platform_member_zones
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.platform_can('internal_roles.manage'))
  );

comment on policy platform_member_zones_select on public.platform_member_zones is
  'Chacun voit ses propres zones ; le fondateur voit celles de tout le monde. La comparaison user_id = auth.uid() vaut NULL pour un anonyme — ce qui, dans un USING, ne laisse passer AUCUNE ligne (NULL n''est pas true) — et la branche fondateur rend false. Refus des deux côtés.';

create or replace function private.platform_zone_key(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')))), '');
$$;

comment on function private.platform_zone_key(text) is
  'Normalise un nom de ville en clé de zone : minuscules, sans accents, sans espaces de bord. Rend NULL pour NULL ou pour une chaîne vide — un prospect sans ville n''appartient à aucune zone, et c''est volontaire : il ne faut pas qu''une donnée manquante devienne une autorisation.';

revoke all on function private.platform_zone_key(text) from public, anon, authenticated;

create or replace function private.platform_is_zone_limited()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select private.platform_can('crm.zone_read'))
     and not (select private.platform_can('crm.read'));
$$;

comment on function private.platform_is_zone_limited() is
  'Vrai pour un rôle qui lit le CRM PAR ZONE et non en entier — le stagiaire aujourd''hui. Faux pour un anonyme, pour un rôle sans CRM, et pour un rôle à lecture complète. Les deux appels rendent un booléen strict, jamais NULL.';

revoke all on function private.platform_is_zone_limited() from public, anon, authenticated;


commit;

-- ============================================================================
-- 5. LES DEUX ORIGINES DU CRM
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_origin' and typnamespace = 'public'::regnamespace) then
    create type public.prospect_origin as enum ('worker', 'field');
  end if;
end $$;

comment on type public.prospect_origin is
  'D''où vient un prospect. « worker » : découvert par Worker V2, la fiche est scrapée. « field » : vu par un interne sur le terrain. La distinction est celle que le commercial doit connaître AVANT d''appeler — un salon vu de ses yeux ne vaut pas une fiche scrapée.';

alter table public.prospects
  add column if not exists origin public.prospect_origin not null default 'worker',
  add column if not exists field_captured_by uuid references auth.users (id) on delete set null,
  add column if not exists field_captured_at timestamptz,
  add column if not exists field_observation text;

comment on column public.prospects.origin is
  'Worker ou terrain. Défaut « worker » : les 52 lignes antérieures à PLAT-1 viennent toutes de Worker V2, et leur provenance fine reste dans prospect_source_records.';
comment on column public.prospects.field_captured_by is
  'L''interne qui a saisi la fiche sur le terrain. NULL pour un prospect Worker. ON DELETE SET NULL : un stagiaire qui part n''efface pas ce qu''il a observé.';
comment on column public.prospects.field_observation is
  'Ce que l''interne a VU. Texte libre, court, écrit sur place : l''enseigne, le nombre de fauteuils, l''affluence, le logiciel affiché à la caisse. C''est la valeur ajoutée d''une visite sur une fiche scrapée.';

alter table public.prospects
  drop constraint if exists prospects_field_origin_shape;
alter table public.prospects
  add constraint prospects_field_origin_shape check (
    (origin = 'field') = (field_captured_at is not null)
  );

comment on constraint prospects_field_origin_shape on public.prospects is
  'Une fiche terrain porte sa date de saisie, une fiche Worker n''en porte pas. Empêche qu''une origine soit affichée sans la date qui la rend vérifiable.';

create index if not exists prospects_origin_idx on public.prospects (origin, first_discovered_at desc);
create index if not exists prospects_field_captured_by_idx
  on public.prospects (field_captured_by) where field_captured_by is not null;

commit;

-- ----------------------------------------------------------------------------
-- 5bis. LA VISIBILITÉ D'UN PROSPECT — définie ici parce qu'elle lit
-- prospects.field_captured_by, ajoutée juste au-dessus.
-- ----------------------------------------------------------------------------

begin;

create or replace function private.platform_prospect_visible(p_prospect_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select case
    -- Lecture complète du CRM : rien à restreindre.
    when (select private.platform_can('crm.read')) then true
    -- Ni lecture complète ni lecture par zone : refus. C'est ici que support
    -- et modérateur sont tenus hors du CRM.
    when not (select private.platform_can('crm.zone_read')) then false
    -- Un identifiant nul ne désigne rien : refus explicite, pas NULL.
    when p_prospect_id is null then false
    else
      -- Ce que le stagiaire a saisi lui-même, où que ce soit…
      exists (
        select 1 from public.prospects p
        where p.id = p_prospect_id
          and p.field_captured_by = (select auth.uid())
      )
      -- …ou ce qui tombe dans une de ses zones.
      or exists (
        select 1
        from public.prospect_locations pl
        join public.platform_zones z
          on z.country = pl.country
         and z.city_key = private.platform_zone_key(pl.city)
         and z.is_active
        join public.platform_member_zones mz
          on mz.zone_id = z.id
         and mz.user_id = (select auth.uid())
        where pl.prospect_id = p_prospect_id
      )
  end;
$$;

comment on function private.platform_prospect_visible(uuid) is
  'La visibilité d''UN prospect pour l''appelant interne. Trois issues, toutes explicites : lecture complète (true), aucun droit CRM (false), lecture par zone (true seulement si le prospect est de sa main ou tombe dans une de ses zones actives). Un prospect sans ville ne tombe dans aucune zone : private.platform_zone_key() rend NULL et la jointure ne trouve rien — une donnée manquante ne devient jamais une autorisation.';

-- Appelée depuis les policies de prospects et de ses tables filles.
revoke all on function private.platform_prospect_visible(uuid) from public, anon;
grant execute on function private.platform_prospect_visible(uuid) to authenticated;

commit;

-- ============================================================================
-- 6. L'AUDIT SCELLÉ
-- ============================================================================

begin;

create or replace function public.reject_platform_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Aucune exemption de rôle, volontairement — c'est le motif de
  -- reject_commercial_history_mutation(), et sa raison : un journal que le
  -- rôle le plus puissant peut réécrire n'est pas un journal. BYPASSRLS ne
  -- contourne pas un déclencheur ; postgres et service_role sont refusés
  -- comme les autres.
  raise exception 'platform_audit_log est en ajout seul : % n''est pas permis', tg_op
    using errcode = '42501';
end;
$$;

comment on function public.reject_platform_audit_mutation() is
  'Refuse toute MODIFICATION et toute SUPPRESSION dans platform_audit_log, pour tous les rôles sans exception. C''est ce qui rend le journal opposable.';

revoke all on function public.reject_platform_audit_mutation() from public, anon, authenticated;

drop trigger if exists platform_audit_log_append_only on public.platform_audit_log;
create trigger platform_audit_log_append_only
  before update or delete on public.platform_audit_log
  for each row execute function public.reject_platform_audit_mutation();

-- Les privilèges disaient déjà non ; le déclencheur le dit même si un grant
-- futur disait oui. Deux couches, comme l'exige X3.
revoke insert, update, delete, truncate on public.platform_audit_log from anon, authenticated;
-- anon n'a aucune policy sur ce journal : son SELECT ne rend rien. On le
-- retire tout de même — X3 a montré qu'un droit inutile finit par servir.
revoke select on public.platform_audit_log from anon;

comment on table public.platform_audit_log is
  'Le journal des actions internes significatives : qui, quand, quoi, sur quelle ressource, et le résultat. EN AJOUT SEUL — déclencheur platform_audit_log_append_only, sans exemption de rôle. Écrit uniquement par des RPC SECURITY DEFINER ; aucun chemin d''écriture client. Lu par le fondateur et les admins seulement (policy platform_audit_log_select) : le support et les modérateurs n''y accèdent pas, sinon ils voient les actions les uns des autres.';

commit;

-- ============================================================================
-- 7. LA VUE EN TANT QUE : ÉCHÉANCE, TRACE, GARDE DE PAIEMENT
-- ============================================================================

begin;

alter table public.platform_support_sessions
  add column if not exists expires_at timestamptz;

-- Les sessions antérieures à PLAT-1 n'ont pas d'échéance. Plutôt que de leur
-- en inventer une rétroactivement, on les ferme : une session ouverte depuis
-- avant ce lot est, par définition, oubliée.
update public.platform_support_sessions
set ended_at = coalesce(ended_at, now())
where expires_at is null and ended_at is null;

update public.platform_support_sessions
set expires_at = started_at + interval '30 minutes'
where expires_at is null;

alter table public.platform_support_sessions
  alter column expires_at set not null,
  alter column expires_at set default (now() + interval '30 minutes');

alter table public.platform_support_sessions
  drop constraint if exists platform_support_sessions_expiry_after_start;
alter table public.platform_support_sessions
  add constraint platform_support_sessions_expiry_after_start check (expires_at > started_at);

comment on column public.platform_support_sessions.expires_at is
  'Échéance de la session, trente minutes par défaut. Motif : un dépannage réel dure entre cinq et quinze minutes ; trente laisse le temps d''un appel difficile et ferme la session avant l''heure de travail suivante. Au-delà, le bandeau disparaît et les lectures redeviennent ordinaires — on RE-ENTRE, ce qui laisse une seconde trace, plutôt que de prolonger sans trace.';

drop policy if exists platform_support_sessions_select on public.platform_support_sessions;
create policy platform_support_sessions_select
  on public.platform_support_sessions
  for select
  to authenticated
  using (
    platform_actor_id = (select auth.uid())
    or (select private.is_platform_admin())
    -- Le professionnel a le droit de savoir qui a agi sur son compte.
    or (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

comment on policy platform_support_sessions_select on public.platform_support_sessions is
  'Trois lecteurs : l''interne pour ses propres sessions, le fondateur et les admins pour toutes, et le PROPRIÉTAIRE (ou manager) de l''organisation concernée pour celles qui la visent. Cette troisième branche est la réponse de PLAT-1 à « le propriétaire doit pouvoir le savoir » : une trace consultable, pas une notification. Chaque branche rend false ou ne joint rien pour un anonyme.';

revoke select on public.platform_support_sessions from anon;

create or replace function private.platform_active_support_session()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select s.id
  from public.platform_support_sessions s
  where s.platform_actor_id = (select auth.uid())
    and (select auth.uid()) is not null
    and s.ended_at is null
    and s.expires_at > now()
  limit 1;
$$;

comment on function private.platform_active_support_session() is
  'La session de vue empruntée ACTIVE de l''appelant, ou NULL. « Active » veut dire non close ET non échue : une session oubliée n''emprunte plus rien. Le `auth.uid() is not null` est explicite plutôt que déduit de la comparaison — le piège X3 est qu''une comparaison à NULL ne lève pas.';

revoke all on function private.platform_active_support_session() from public, anon, authenticated;

create or replace function private.assert_not_in_support_view(p_action text)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if (select private.platform_active_support_session()) is not null then
    raise exception 'geste de paiement refusé en vue empruntée : %', p_action
      using errcode = '42501',
            detail = 'fadeup_support_view_refusal=payment_forbidden';
  end if;
end;
$$;

comment on function private.assert_not_in_support_view(text) is
  'Refuse un geste de paiement tant qu''une vue empruntée est ouverte. Personne ne change un abonnement au nom d''un autre — ni plan, ni moyen de paiement, ni résiliation, ni portail. La garde est ICI, côté serveur : une garde d''interface n''existe pas.';

revoke all on function private.assert_not_in_support_view(text) from public, anon, authenticated;

commit;

-- ============================================================================
-- 8. LA GESTION DES RÔLES INTERNES — FONDATEUR SEUL
-- ============================================================================

begin;

create or replace function public.list_platform_team()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role public.platform_role,
  note text,
  created_at timestamptz,
  zones jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    pm.user_id,
    u.email::text,
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    pm.role,
    pm.note,
    pm.created_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label, 'country', z.country, 'city', z.city) order by z.label)
        from public.platform_member_zones mz
        join public.platform_zones z on z.id = mz.zone_id
        where mz.user_id = pm.user_id
      ),
      '[]'::jsonb
    )
  from public.platform_members pm
  join auth.users u on u.id = pm.user_id
  where (select private.is_platform_admin())
  order by pm.created_at;
$$;

comment on function public.list_platform_team() is
  'Le trombinoscope interne : qui est là, avec quel rôle, quelles zones, depuis quand. Lisible par le fondateur et les admins — voir l''équipe n''est pas la gérer. Rend zéro ligne à tout autre appelant (le WHERE porte la garde), plutôt que de lever : c''est une lecture de liste. L''e-mail vient de auth.users, hors de portée d''une policy — d''où la fonction SECURITY DEFINER au lieu d''une jointure côté client.';

revoke all on function public.list_platform_team() from public, anon;
grant execute on function public.list_platform_team() to authenticated;

create or replace function public.set_platform_member_role(
  p_user_id uuid,
  p_role public.platform_role,
  p_note text default null
)
returns public.platform_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.platform_role;
  v_member public.platform_members;
begin
  if not (select private.platform_can('internal_roles.manage')) then
    raise exception 'seul le fondateur gère les rôles internes'
      using errcode = '42501', detail = 'fadeup_platform_refusal=internal_roles_manage_required';
  end if;

  if p_user_id is null then
    raise exception 'utilisateur non désigné' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'compte introuvable' using errcode = '42704';
  end if;

  select role into v_previous from public.platform_members where user_id = p_user_id for update;

  -- Le dernier fondateur ne se rétrograde pas lui-même : il n'y aurait plus
  -- personne pour gérer les rôles, et le périmètre serait perdu.
  if v_previous = 'platform_owner' and p_role <> 'platform_owner'
     and (select count(*) from public.platform_members where role = 'platform_owner') <= 1 then
    raise exception 'le dernier fondateur ne peut pas être rétrogradé'
      using errcode = '42501', detail = 'fadeup_platform_refusal=last_owner';
  end if;

  insert into public.platform_members (user_id, role, note)
  values (p_user_id, p_role, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (user_id) do update
    set role = excluded.role,
        note = coalesce(excluded.note, public.platform_members.note),
        updated_at = now()
  returning * into v_member;

  -- Un rôle qui ne lit plus le CRM par zone n'a plus de zone à porter.
  if not exists (
    select 1 from public.platform_role_permissions rp
    where rp.role = p_role and rp.permission_key = 'crm.zone_read'
  ) then
    delete from public.platform_member_zones where user_id = p_user_id;
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    case when v_previous is null then 'platform_member_granted' else 'platform_member_role_changed' end,
    'platform_members',
    p_user_id,
    jsonb_build_object('previous_role', v_previous, 'new_role', p_role)
  );

  return v_member;
end;
$$;

comment on function public.set_platform_member_role(uuid, public.platform_role, text) is
  'Donne ou change le rôle interne d''un compte existant. FONDATEUR SEUL (droit internal_roles.manage) — un admin ne crée pas un admin, et c''est ce qui garde le périmètre au fondateur. Refuse de rétrograder le dernier fondateur. Purge les zones d''un rôle qui ne lit plus par zone. Tracé.';

revoke all on function public.set_platform_member_role(uuid, public.platform_role, text) from public, anon;
grant execute on function public.set_platform_member_role(uuid, public.platform_role, text) to authenticated;

create or replace function public.revoke_platform_member(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.platform_role;
begin
  if not (select private.platform_can('internal_roles.manage')) then
    raise exception 'seul le fondateur gère les rôles internes'
      using errcode = '42501', detail = 'fadeup_platform_refusal=internal_roles_manage_required';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'on ne révoque pas son propre accès interne'
      using errcode = '42501', detail = 'fadeup_platform_refusal=cannot_revoke_self';
  end if;

  select role into v_role from public.platform_members where user_id = p_user_id for update;
  if v_role is null then
    raise exception 'ce compte n''a pas d''accès interne' using errcode = '42704';
  end if;

  if v_role = 'platform_owner'
     and (select count(*) from public.platform_members where role = 'platform_owner') <= 1 then
    raise exception 'le dernier fondateur ne peut pas être révoqué'
      using errcode = '42501', detail = 'fadeup_platform_refusal=last_owner';
  end if;

  -- Une vue empruntée ouverte par quelqu'un qui perd son accès doit se fermer
  -- avec lui : sinon le bandeau disparaît mais la trace reste ouverte.
  update public.platform_support_sessions
  set ended_at = now()
  where platform_actor_id = p_user_id and ended_at is null;

  delete from public.platform_members where user_id = p_user_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_member_revoked', 'platform_members', p_user_id,
          jsonb_build_object('previous_role', v_role, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;

comment on function public.revoke_platform_member(uuid, text) is
  'Retire l''accès interne d''un compte. FONDATEUR SEUL. Refuse l''auto-révocation et la révocation du dernier fondateur. Ferme au passage la vue empruntée que la personne aurait laissée ouverte. Tracé. Les lignes du journal qu''elle a écrites survivent : actor_user_id est ON DELETE SET NULL et le journal est en ajout seul.';

revoke all on function public.revoke_platform_member(uuid, text) from public, anon;
grant execute on function public.revoke_platform_member(uuid, text) to authenticated;

create or replace function public.create_platform_zone(
  p_country text,
  p_city text,
  p_label text default null,
  p_postal_code_hint text default null
)
returns public.platform_zones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_zone public.platform_zones;
begin
  if not (select private.platform_can('internal_roles.manage')) then
    raise exception 'seul le fondateur définit les zones'
      using errcode = '42501', detail = 'fadeup_platform_refusal=internal_roles_manage_required';
  end if;

  v_key := (select private.platform_zone_key(p_city));
  if v_key is null then
    raise exception 'une zone a besoin d''une ville' using errcode = '22023';
  end if;

  insert into public.platform_zones (country, city, city_key, label, postal_code_hint, created_by)
  values (
    upper(btrim(coalesce(p_country, ''))),
    btrim(p_city),
    v_key,
    coalesce(nullif(btrim(coalesce(p_label, '')), ''), btrim(p_city)),
    nullif(btrim(coalesce(p_postal_code_hint, '')), ''),
    (select auth.uid())
  )
  on conflict (country, city_key) do update set is_active = true, updated_at = now()
  returning * into v_zone;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_zone_created', 'platform_zones', v_zone.id,
          jsonb_build_object('country', v_zone.country, 'city', v_zone.city));

  return v_zone;
end;
$$;

comment on function public.create_platform_zone(text, text, text, text) is
  'Crée une zone (pays ISO-2 + ville), ou réactive celle qui existe déjà pour ce couple. FONDATEUR SEUL. Tracé.';

revoke all on function public.create_platform_zone(text, text, text, text) from public, anon;
grant execute on function public.create_platform_zone(text, text, text, text) to authenticated;

create or replace function public.set_platform_member_zones(p_user_id uuid, p_zone_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select private.platform_can('internal_roles.manage')) then
    raise exception 'seul le fondateur assigne les zones'
      using errcode = '42501', detail = 'fadeup_platform_refusal=internal_roles_manage_required';
  end if;

  if not exists (select 1 from public.platform_members where user_id = p_user_id) then
    raise exception 'ce compte n''a pas d''accès interne' using errcode = '42704';
  end if;

  delete from public.platform_member_zones where user_id = p_user_id;

  insert into public.platform_member_zones (user_id, zone_id, assigned_by)
  select p_user_id, z.id, (select auth.uid())
  from public.platform_zones z
  where z.id = any(coalesce(p_zone_ids, '{}'::uuid[]));

  get diagnostics v_count = row_count;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_member_zones_set', 'platform_members', p_user_id,
          jsonb_build_object('zone_count', v_count));

  return v_count;
end;
$$;

comment on function public.set_platform_member_zones(uuid, uuid[]) is
  'Remplace les zones d''un interne par la liste fournie (liste vide = aucune zone). FONDATEUR SEUL. Plusieurs stagiaires peuvent partager une zone : rien n''impose l''exclusivité. Tracé.';

revoke all on function public.set_platform_member_zones(uuid, uuid[]) from public, anon;
grant execute on function public.set_platform_member_zones(uuid, uuid[]) to authenticated;

commit;

-- ============================================================================
-- 9. LES GESTES QUI MANQUAIENT
-- ============================================================================

begin;

-- ---- La saisie terrain ------------------------------------------------------

create or replace function public.capture_field_prospect(
  p_type public.prospect_type,
  p_canonical_name text,
  p_country text,
  p_city text,
  p_observation text,
  p_address_line text default null,
  p_postal_code text default null,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_city text := btrim(coalesce(p_city, ''));
  v_city_key text;
  v_name text := btrim(coalesce(p_canonical_name, ''));
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
  v_prospect_id uuid;
  v_existing uuid;
begin
  if v_actor is null or not (select private.platform_can('crm.field_capture')) then
    raise exception 'saisie terrain non autorisée'
      using errcode = '42501', detail = 'fadeup_field_capture_refusal=not_authorized';
  end if;

  if v_name = '' then
    raise exception 'un prospect a besoin d''un nom'
      using errcode = '22023', detail = 'fadeup_field_capture_refusal=name_required';
  end if;

  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'pays attendu au format ISO-2'
      using errcode = '22023', detail = 'fadeup_field_capture_refusal=country_required';
  end if;

  v_city_key := (select private.platform_zone_key(v_city));
  if v_city_key is null then
    raise exception 'une fiche terrain a besoin de sa ville'
      using errcode = '22023', detail = 'fadeup_field_capture_refusal=city_required';
  end if;

  -- Ce que le stagiaire a VU est la raison d'être de la fiche. Sans
  -- observation, elle ne vaut pas mieux qu'une ligne scrapée.
  if v_observation is null then
    raise exception 'une fiche terrain a besoin de ce que vous avez observé'
      using errcode = '22023', detail = 'fadeup_field_capture_refusal=observation_required';
  end if;

  -- Un rôle borné à ses zones ne saisit que dans ses zones.
  if (select private.platform_is_zone_limited()) and not exists (
    select 1
    from public.platform_member_zones mz
    join public.platform_zones z on z.id = mz.zone_id and z.is_active
    where mz.user_id = v_actor and z.country = v_country and z.city_key = v_city_key
  ) then
    raise exception 'cette ville n''est pas dans vos zones'
      using errcode = '42501', detail = 'fadeup_field_capture_refusal=outside_my_zones';
  end if;

  -- Pas de fusion automatique : si la fiche existe déjà dans cette ville, on
  -- refuse en la nommant, et l'humain décide. Le rapprochement est le métier
  -- de prospect_duplicates, pas d'un INSERT.
  select p.id into v_existing
  from public.prospects p
  join public.prospect_locations pl on pl.prospect_id = p.id
  where lower(btrim(p.canonical_name)) = lower(v_name)
    and pl.country = v_country
    and (select private.platform_zone_key(pl.city)) = v_city_key
  limit 1;

  if v_existing is not null then
    raise exception 'ce prospect est déjà connu (%)', v_existing
      using errcode = '23505', detail = 'fadeup_field_capture_refusal=prospect_already_known';
  end if;

  insert into public.prospects (
    type, canonical_name, country, status,
    phone_e164, email,
    origin, field_captured_by, field_captured_at, field_observation
  )
  values (
    p_type, v_name, v_country, 'discovered',
    (select public.normalize_phone_number(p_phone, v_country)),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    'field', v_actor, now(), v_observation
  )
  returning id into v_prospect_id;

  insert into public.prospect_locations (prospect_id, is_primary, address_line, city, postal_code, country)
  values (
    v_prospect_id, true,
    nullif(btrim(coalesce(p_address_line, '')), ''),
    v_city,
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    v_country
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'field_prospect_captured', 'prospects', v_prospect_id,
          jsonb_build_object('country', v_country, 'city', v_city, 'type', p_type));

  return v_prospect_id;
end;
$$;

comment on function public.capture_field_prospect(public.prospect_type, text, text, text, text, text, text, text, text) is
  'Enregistre un salon VU sur le terrain. Le prospect naît avec origin = ''field'', son auteur, sa date et son observation — c''est ce qui le distingue d''une fiche scrapée par Worker V2, et ce que le commercial doit savoir avant d''appeler. Un rôle borné à ses zones ne saisit que dans ses zones. Aucune fusion automatique : un doublon est refusé en le nommant. Tracé.';

revoke all on function public.capture_field_prospect(public.prospect_type, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.capture_field_prospect(public.prospect_type, text, text, text, text, text, text, text, text) to authenticated;

-- ---- L'annulation par le support -------------------------------------------

create or replace function public.cancel_appointment_as_platform(p_appointment_id uuid, p_reason text)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_appointment public.appointments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not (select private.platform_can('appointment.cancel')) then
    raise exception 'annulation interne non autorisée'
      using errcode = '42501', detail = 'fadeup_platform_refusal=appointment_cancel_required';
  end if;

  if v_reason is null then
    raise exception 'une annulation interne a besoin de son motif'
      using errcode = '22023', detail = 'fadeup_platform_refusal=reason_required';
  end if;

  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'rendez-vous introuvable' using errcode = '42704';
  end if;

  if v_appointment.status = 'cancelled' then
    return v_appointment;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'ce rendez-vous ne peut plus être annulé' using errcode = '22023';
  end if;

  update public.appointments
     set status = 'cancelled',
         resolution = 'cancelled_by_business',
         resolution_note = v_reason,
         decided_at = now(),
         decided_by = v_actor
   where id = p_appointment_id
  returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'customer',
    'Your appointment was cancelled', v_reason, 'booking_cancelled'
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'appointment_cancelled_by_platform', 'appointments', v_appointment.id,
          jsonb_build_object('organization_id', v_appointment.organization_id, 'reason', v_reason));

  return v_appointment;
end;
$$;

comment on function public.cancel_appointment_as_platform(uuid, text) is
  'Annule un rendez-vous depuis la console interne. Le support est un support CLIENT autant que pro : c''est pour ça qu''il a ce geste, et pour ça qu''il est tracé — motif obligatoire, journal d''audit, notification au client. Ne remplace pas cancel_appointment_as_business, qui reste le geste du salon.';

revoke all on function public.cancel_appointment_as_platform(uuid, text) from public, anon;
grant execute on function public.cancel_appointment_as_platform(uuid, text) to authenticated;

-- ---- La suppression d'un barber — fondateur seul ---------------------------

create or replace function public.delete_barber_as_platform(p_barber_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_staff uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not (select private.platform_can('barber.delete')) then
    raise exception 'seul le fondateur supprime un barber'
      using errcode = '42501', detail = 'fadeup_platform_refusal=barber_delete_required';
  end if;

  if v_reason is null then
    raise exception 'une suppression a besoin de son motif' using errcode = '22023';
  end if;

  select organization_id, staff_profile_id into v_org, v_staff
  from public.barbers where id = p_barber_id for update;

  if v_org is null then
    raise exception 'barber introuvable' using errcode = '42704';
  end if;

  -- appointments.barber_id est ON DELETE RESTRICT : un barber qui a servi ne
  -- s'efface pas, sinon l'historique de rendez-vous partirait avec lui. On
  -- refuse en le nommant plutôt que de laisser remonter une violation de clé.
  if exists (select 1 from public.appointments where barber_id = p_barber_id) then
    raise exception 'ce barber a un historique de rendez-vous : désactivez-le (offboard_barber) plutôt que de le supprimer'
      using errcode = '42501', detail = 'fadeup_platform_refusal=barber_has_history';
  end if;

  delete from public.barbers where id = p_barber_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'barber_deleted_by_platform', 'barbers', p_barber_id,
          jsonb_build_object('organization_id', v_org, 'staff_profile_id', v_staff, 'reason', v_reason));
end;
$$;

comment on function public.delete_barber_as_platform(uuid, text) is
  'Supprime définitivement un barber. FONDATEUR SEUL — un admin fait tout, sauf ça. Refuse si le barber porte un historique de rendez-vous : la base l''interdit déjà (ON DELETE RESTRICT), la RPC le dit clairement et renvoie vers offboard_barber. Tracé, motif obligatoire.';

revoke all on function public.delete_barber_as_platform(uuid, text) from public, anon;
grant execute on function public.delete_barber_as_platform(uuid, text) to authenticated;

-- ---- La modération d'un post ------------------------------------------------

create or replace function public.moderate_post(p_post_id uuid, p_visibility text, p_reason text default null)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_post public.posts;
begin
  if v_actor is null or not (select private.platform_can('moderation.content')) then
    raise exception 'modération de contenu non autorisée'
      using errcode = '42501', detail = 'fadeup_platform_refusal=moderation_required';
  end if;

  if p_visibility not in ('public', 'followers', 'hidden') then
    raise exception 'visibilité invalide' using errcode = '22023';
  end if;

  update public.posts set visibility = p_visibility, updated_at = now()
  where id = p_post_id
  returning * into v_post;

  if not found then
    raise exception 'post introuvable' using errcode = '42704';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'post_moderated', 'posts', v_post.id,
          jsonb_build_object('visibility', p_visibility, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_post;
end;
$$;

comment on function public.moderate_post(uuid, text, text) is
  'Masque ou rétablit un post depuis la console interne (posts.visibility porte déjà « hidden »). Ne SUPPRIME pas : effacer le contenu d''un professionnel n''est pas de la modération, et delete_post reste le geste de son auteur. Tracé.';

revoke all on function public.moderate_post(uuid, text, text) from public, anon;
grant execute on function public.moderate_post(uuid, text, text) to authenticated;

-- ---- Ce que le professionnel peut savoir ------------------------------------

create or replace function public.list_organization_support_sessions(p_organization_id uuid)
returns table (
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  target_type text,
  reason text
)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.started_at, s.ended_at, s.expires_at, s.target_type, s.reason
  from public.platform_support_sessions s
  where s.organization_id = p_organization_id
    and (select auth.uid()) is not null
    and (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[]))
  order by s.started_at desc
  limit 100;
$$;

comment on function public.list_organization_support_sessions(uuid) is
  'Les vues empruntées qu''une organisation a subies, pour son propriétaire ou son manager. C''est la réponse de PLAT-1 à « le propriétaire doit pouvoir le savoir » : une trace consultable — un professionnel a le droit de savoir qui a agi sur son compte. L''identité de l''interne n''est PAS exposée : ce qui est opposable est qu''une session a eu lieu, quand, et pourquoi ; qui exactement est une donnée RH qui appartient au journal interne. Zéro ligne pour tout autre appelant.';

revoke all on function public.list_organization_support_sessions(uuid) from public, anon;
grant execute on function public.list_organization_support_sessions(uuid) to authenticated;

-- ---- L'entrée en vue empruntée, bornée --------------------------------------

create or replace function public.start_platform_support_session(
  p_organization_id uuid,
  p_target_type text,
  p_target_user_id uuid default null,
  p_reason text default null
)
returns public.platform_support_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_session public.platform_support_sessions;
begin
  -- C'est une fonctionnalité d'ÉLÉVATION DE PRIVILÈGES : si sa garde est
  -- faible, n'importe quel interne devient propriétaire de n'importe quel
  -- salon. Le cas nul est traité avant tout le reste.
  if v_actor is null or not (select private.platform_can('support_view.enter')) then
    raise exception 'vue en tant que non autorisée'
      using errcode = '42501', detail = 'fadeup_support_view_refusal=not_authorized';
  end if;

  if p_target_type not in ('organization', 'barber') then
    raise exception 'cible de vue invalide' using errcode = '22023';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization not found' using errcode = '42704';
  end if;

  -- Toute session laissée ouverte par cet acteur se ferme : entrer quelque
  -- part veut dire « je regarde ÇA maintenant », jamais empiler des contextes.
  update public.platform_support_sessions
  set ended_at = now()
  where platform_actor_id = v_actor and ended_at is null;

  insert into public.platform_support_sessions
    (platform_actor_id, organization_id, target_type, target_user_id, reason, expires_at)
  values
    (v_actor, p_organization_id, p_target_type, p_target_user_id,
     nullif(btrim(coalesce(p_reason, '')), ''), now() + interval '30 minutes')
  returning * into v_session;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor, 'platform_support_session_started', 'organizations', p_organization_id,
    jsonb_build_object('session_id', v_session.id, 'target_type', p_target_type,
                       'target_user_id', p_target_user_id, 'expires_at', v_session.expires_at)
  );

  return v_session;
end;
$$;

comment on function public.start_platform_support_session(uuid, text, uuid, text) is
  'Ouvre une vue en tant que propriétaire, pour trente minutes. Réservée aux rôles portant support_view.enter (fondateur, admin, modérateur) — un support ou un commercial est refusé, et la RPC est refusée même appelée directement. Ne donne AUCUN droit de lecture supplémentaire : elle rend explicite, traçable et bornée une capacité que is_platform_admin() portait déjà. Aucun geste de paiement n''est possible tant qu''elle est ouverte.';

revoke all on function public.start_platform_support_session(uuid, text, uuid, text) from public, anon;
grant execute on function public.start_platform_support_session(uuid, text, uuid, text) to authenticated;

-- ---- L'invitation interne — fondateur seul ---------------------------------

create or replace function public.create_platform_invitation(
  p_role public.platform_role,
  p_invited_email text default null,
  p_expires_in interval default '7 days'::interval
)
returns table(id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_token text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  -- SEUL LE FONDATEUR GÈRE LES RÔLES INTERNES. Avant PLAT-1, un admin pouvait
  -- inviter un support ; c'est précisément ce que le fondateur a retiré, pour
  -- garder le contrôle du périmètre.
  if (select auth.uid()) is null or not (select private.platform_can('internal_roles.manage')) then
    raise exception 'seul le fondateur invite un membre interne'
      using errcode = '42501', detail = 'fadeup_platform_refusal=internal_roles_manage_required';
  end if;

  if p_role = 'platform_owner' then
    raise exception 'platform_owner cannot be granted through an invitation';
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + p_expires_in;

  insert into public.platform_invitations (token_hash, role, invited_email, invited_by, expires_at)
  values (
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    p_role,
    nullif(lower(btrim(p_invited_email)), ''),
    (select auth.uid()),
    v_expires_at
  )
  returning platform_invitations.id into v_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_created', 'platform_invitations', v_id,
          jsonb_build_object('role', p_role));

  return query select v_id, v_raw_token, v_expires_at;
end;
$$;

comment on function public.create_platform_invitation(public.platform_role, text, interval) is
  'Crée une invitation interne à usage unique. FONDATEUR SEUL depuis PLAT-1 (droit internal_roles.manage) : un admin ne crée plus un support. platform_owner reste hors invitation (contrainte platform_invitations_role_not_owner). Tracé.';

revoke all on function public.create_platform_invitation(public.platform_role, text, interval) from public, anon;
grant execute on function public.create_platform_invitation(public.platform_role, text, interval) to authenticated;

commit;

-- ============================================================================
-- 10. LES GARDES EXISTANTES PASSENT PAR LA GRILLE
-- ============================================================================
--
-- Neuf RPC portaient `private.is_platform_admin()` — owner + admin, une
-- échelle. Chacune reçoit ici la QUESTION qui correspond à son geste. Les
-- corps sont repris VERBATIM de la production (pg_get_functiondef au
-- 2026-09-11) : seule la ligne de garde change, et pour moderate_review /
-- resolve_review_report une écriture au journal s'ajoute, qui manquait.
--
-- `create or replace` et non `drop` + `create` : une signature inchangée
-- conserve l'ACL de la fonction. Un DROP obligerait à re-matérialiser les
-- grants, et c'est ainsi qu'on perd un droit sans s'en apercevoir.
--
-- private.is_platform_admin() n'est PAS touchée : elle reste la garde de
-- lecture locataire d'une vingtaine de policies, et l'élargir aurait
-- sur-autorisé d'un coup tout ce qu'elle protège.

begin;

-- ---- publish_external_professional → marketplace.publish
-- Publier un prospect sur la marketplace est un geste de COMMERCIAL ou d'admin, jamais de stagiaire : c'est lui qui déclenche l'information RGPD et engage la responsabilité légale.
create or replace function public.publish_external_professional(p_prospect_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('marketplace.publish')) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    -- Idempotente et auto-réparatrice (B1) — mais plus jamais au mépris d'un
    -- retrait ou d'une suppression. LE MÊME garde que la branche neuve
    -- (publication_block_reason), en ignorant seulement already_published,
    -- vrai par construction ici : deux définitions de l'éligibilité avaient
    -- déjà divergé une fois (revue X2, suppressed_email ignoré).
    v_reason := public.publication_block_reason(p_prospect_id);
    if v_reason is not null and v_reason <> 'already_published' then
      perform 1 from public.professionals p
      where p.id = v_existing and not p.is_public;
      if found then
        raise exception 'prospect is not eligible for publication: %', v_reason
          using errcode = '42501';
      end if;
      -- Déjà public ET bloqué : état hérité — on ne dépublie pas en douce
      -- depuis un chemin de publication, on rend l'identité telle qu'elle
      -- est. Le retrait a son propre circuit. Et on n'informe PAS : les
      -- gardes de contact de l'enqueue refuseront de toute façon.
    end if;

    update public.professionals
    set is_public = true
    where id = v_existing and not is_public;

    perform private.enqueue_publication_information(v_existing);

    return v_existing;
  end if;

  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  update public.professionals
  set is_public = true
  where id = v_professional_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  -- Publier, puis informer — dans la même transaction : si la mise en file
  -- échoue, la publication échoue avec elle. On ne publie pas sans informer.
  perform private.enqueue_publication_information(v_professional_id);

  return v_professional_id;
end;
$function$;

-- ---- withdraw_external_professional → marketplace.withdraw
-- Dépublier relève du traitement d'une demande de retrait : support, modérateur, admin, fondateur.
create or replace function public.withdraw_external_professional(p_professional_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('marketplace.withdraw')) then
    raise exception 'only FadeUp platform administrators can withdraw an external professional identity'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id
  for update;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- A claimed identity belongs to its owner. Removing it from public view is
  -- a moderation act with its own review path, not a side door on the
  -- acquisition tooling.
  if v_claim_state = 'claimed' then
    raise exception 'this identity is claimed; withdrawing a claimed profile is not an acquisition action'
      using errcode = '42501';
  end if;

  update public.professionals
  set is_public = false
  where id = p_professional_id and is_public;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_withdrawn',
    'professionals',
    p_professional_id,
    jsonb_build_object(
      'professional_id', p_professional_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  return p_professional_id;
end;
$function$;

-- ---- request_marketplace_withdrawal → marketplace.withdraw
-- Enregistrer une demande de retrait et démarrer les 72 heures : support, modérateur, admin, fondateur.
create or replace function public.request_marketplace_withdrawal(p_professional_id uuid, p_requested_via text, p_requester_note text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, deadline_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_row public.marketplace_withdrawal_requests;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('marketplace.withdraw')) then
    raise exception 'only FadeUp platform administrators can record a withdrawal request'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p where p.id = p_professional_id;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  if v_claim_state = 'claimed' then
    -- Un profil revendiqué se retire tout seul : son propriétaire contrôle sa
    -- visibilité depuis Pro. Passer par ce chemin serait retirer le profil de
    -- quelqu'un à sa place.
    raise exception 'this profile is claimed; its owner controls its visibility'
      using errcode = '42501',
            detail = 'fadeup_withdrawal_refusal=professional_is_claimed';
  end if;

  insert into public.marketplace_withdrawal_requests
    (professional_id, requested_via, requester_note)
  values
    (p_professional_id, p_requested_via, nullif(btrim(coalesce(p_requester_note, '')), ''))
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'marketplace_withdrawal_requested', 'professionals', p_professional_id,
          jsonb_build_object('request_id', v_row.id, 'requested_via', p_requested_via,
                             'deadline_at', v_row.deadline_at));

  return query select v_row.id, v_row.deadline_at;
end;
$function$;

-- ---- complete_marketplace_withdrawal → marketplace.withdraw
-- Exécuter le retrait sous l'engagement des 72 heures : support, modérateur, admin, fondateur.
create or replace function public.complete_marketplace_withdrawal(p_request_id uuid, p_decision_note text DEFAULT NULL::text)
 RETURNS TABLE(professional_id uuid, completed_at timestamp with time zone, hours_taken numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_row public.marketplace_withdrawal_requests;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('marketplace.withdraw')) then
    raise exception 'only FadeUp platform administrators can complete a withdrawal'
      using errcode = '42501';
  end if;

  select * into v_row from public.marketplace_withdrawal_requests
  where id = p_request_id for update;

  if not found then
    raise exception 'withdrawal request not found' using errcode = '42704';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'this withdrawal request is already %', v_row.status
      using errcode = '42501';
  end if;

  -- 1. Dépublier. B1 a écrit cette fonction, elle audite déjà son geste.
  perform public.withdraw_external_professional(v_row.professional_id, p_decision_note);

  -- 2. Couper toute relance future. C'est la moitié du retrait que la simple
  --    dépublication ne couvre pas : un profil invisible qui continue de
  --    recevoir des e-mails de prospection n'est pas retiré, il est caché.
  update public.prospects pr
  set do_not_contact = true
  from public.prospect_professionals pp
  where pp.prospect_id = pr.id
    and pp.professional_id = v_row.professional_id
    and not pr.do_not_contact;

  insert into public.prospect_suppressions (scope, prospect_id, reason)
  select 'prospect', pp.prospect_id, 'marketplace_withdrawal'
  from public.prospect_professionals pp
  where pp.professional_id = v_row.professional_id
  on conflict do nothing;

  -- 3. Les demandes d'intérêt en cours n'ont plus de destinataire. Les laisser
  --    « pending » ferait attendre un client une réponse qui ne viendra
  --    jamais, et la troisième relance partirait vers quelqu'un qui a demandé
  --    à sortir.
  -- La table est nommée en entier dans le WHERE : la clause RETURNS TABLE de
  -- cette fonction déclare une variable `professional_id`, qui masquerait la
  -- colonne et ferait échouer l'UPDATE sur « column reference is ambiguous ».
  update public.professional_interest_requests r
  set status = 'withdrawn', resolved_at = now()
  where r.professional_id = v_row.professional_id and r.status = 'pending';

  update public.marketplace_withdrawal_requests
  set status = 'completed', decided_at = now(), decided_by = v_actor,
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = p_request_id
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'marketplace_withdrawal_completed', 'professionals', v_row.professional_id,
          jsonb_build_object('request_id', v_row.id,
                             'requested_at', v_row.requested_at,
                             'deadline_at', v_row.deadline_at,
                             'within_deadline', v_row.decided_at <= v_row.deadline_at));

  return query select
    v_row.professional_id,
    v_row.decided_at,
    round(extract(epoch from (v_row.decided_at - v_row.requested_at)) / 3600.0, 1);
end;
$function$;

-- ---- list_marketplace_withdrawal_requests → marketplace.withdraw
-- La file des retraits, retards d'abord — visible par ceux qui la traitent.
create or replace function public.list_marketplace_withdrawal_requests(p_include_completed boolean DEFAULT false)
 RETURNS TABLE(id uuid, professional_id uuid, professional_display_name text, professional_handle text, is_still_public boolean, requested_via text, requested_at timestamp with time zone, deadline_at timestamp with time zone, hours_remaining numeric, is_overdue boolean, status marketplace_withdrawal_status, decided_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    w.id, w.professional_id, p.display_name, p.handle, p.is_public,
    w.requested_via, w.requested_at, w.deadline_at,
    round(extract(epoch from (w.deadline_at - now())) / 3600.0, 1),
    w.status = 'pending' and w.deadline_at < now(),
    w.status, w.decided_at
  from public.marketplace_withdrawal_requests w
  join public.professionals p on p.id = w.professional_id
  where (select private.platform_can('marketplace.withdraw'))
    and (p_include_completed or w.status = 'pending')
  -- Les retards en premier : une liste triée par date de demande enterre
  -- l'urgence sous l'historique.
  order by (w.status = 'pending' and w.deadline_at < now()) desc, w.deadline_at;
$function$;

-- ---- review_professional_application → onboarding.review
-- Valider un onboarding est un geste de commercial ou de modérateur autant que d'admin.
create or replace function public.review_professional_application(p_application_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL::text, p_internal_note text DEFAULT NULL::text)
 RETURNS professional_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reviewer uuid;
  v_application public.professional_applications;
  v_org public.organizations;
  v_slug text;
  v_slug_base text;
  v_suffix integer := 0;
  v_country text;
  v_timezone text;
  v_business_type public.business_type;
  v_location_id uuid;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.platform_can('onboarding.review')) then
    raise exception 'only FadeUp platform staff can review professional applications';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;

  -- Row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a status that is no longer pending and returns without
  -- repeating any side effect.
  select * into v_application
    from public.professional_applications a
    where a.id = p_application_id
    for update;

  if not found then
    raise exception 'application not found';
  end if;

  if v_application.status <> 'pending_review' then
    return v_application;
  end if;

  if p_decision = 'reject' then
    update public.professional_applications a
      set status = 'rejected',
          reviewed_at = now(),
          reviewed_by = v_reviewer,
          rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
          internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
      where a.id = v_application.id
      returning * into v_application;

    insert into public.email_outbox (to_email, template, payload)
    values (
      v_application.email,
      'professional_application_rejected',
      jsonb_build_object(
        'business_name', v_application.business_name,
        'first_name', v_application.first_name,
        'rejection_reason', v_application.rejection_reason
      )
    );

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (
      v_reviewer, 'professional_application_rejected', 'professional_applications', v_application.id,
      jsonb_build_object('business_name', v_application.business_name, 'has_reason', v_application.rejection_reason is not null)
    );

    return v_application;
  end if;

  -- ---- approve ----------------------------------------------------------
  v_slug_base := regexp_replace(lower(btrim(v_application.business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(regexp_replace(v_slug_base, '(^-+)|(-+$)', '', 'g'), '-');
  if v_slug_base = '' then
    v_slug_base := 'shop';
  end if;
  v_slug_base := left(v_slug_base, 40);
  v_slug := v_slug_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix::text;
  end loop;

  v_country := nullif(btrim(upper(coalesce(v_application.country, ''))), '');
  if v_country is not null and char_length(v_country) <> 2 then
    -- The application form accepts free text; only a clean alpha-2 code is
    -- trustworthy enough to drive a timezone. Anything else is left for
    -- onboarding to ask about rather than guessed at.
    v_country := null;
  end if;

  -- professional_type is the applicant's own description of their business
  -- and maps cleanly onto the two solo shapes; barbershop maps to barbershop.
  -- Anything a salon-shaped applicant needs is chosen in onboarding step 1,
  -- which is why an unmapped type is left NULL rather than defaulted.
  v_business_type := case v_application.professional_type
    when 'barbershop' then 'barbershop'::public.business_type
    when 'independent_barber' then 'solo_professional'::public.business_type
    when 'private_studio' then 'solo_professional'::public.business_type
    when 'mobile_barber' then 'solo_professional'::public.business_type
    else null
  end;

  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug, business_type, country_code, currency)
  values (
    v_application.business_name,
    v_slug,
    v_business_type,
    v_country,
    public.suggested_currency_for_country(v_country)
  )
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);
  perform set_config('fadeup.skip_org_owner_membership', 'off', true);

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, v_application.user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- First location, from data the applicant already gave us. Creating it
  -- here is what stops an approved shop from starting with zero locations
  -- and the owner retyping an address FadeUp already holds.
  v_timezone := coalesce(public.suggested_timezone_for_country(v_country), 'UTC');
  insert into public.locations (
    organization_id, name, address_line1, city, postal_code, country, timezone
  )
  values (
    v_org.id,
    v_application.business_name,
    nullif(btrim(coalesce(v_application.address_line1, '')), ''),
    nullif(btrim(coalesce(v_application.city, '')), ''),
    nullif(btrim(coalesce(v_application.postal_code, '')), ''),
    v_country,
    v_timezone
  )
  returning id into v_location_id;

  update public.professional_applications a
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_reviewer,
        organization_id = v_org.id,
        internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
    where a.id = v_application.id
    returning * into v_application;

  insert into public.email_outbox (to_email, template, payload)
  values (
    v_application.email,
    'professional_application_approved',
    jsonb_build_object(
      'business_name', v_application.business_name,
      'first_name', v_application.first_name
    )
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_reviewer, 'professional_application_approved', 'professional_applications', v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'organization_id', v_org.id,
      'organization_slug', v_org.slug,
      'location_id', v_location_id
    )
  );

  return v_application;
end;
$function$;

-- ---- review_professional_claim → onboarding.review
-- Arbitrer une revendication est un geste de commercial ou de modérateur autant que d'admin.
create or replace function public.review_professional_claim(p_claim_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS professional_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reviewer uuid;
  v_claim public.professional_claims;
  v_professional public.professionals;
  v_org_id uuid;
  v_org_count integer;
  v_converted boolean := false;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.platform_can('onboarding.review')) then
    raise exception 'only FadeUp platform staff can review professional claims'
      using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;

  -- The row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a state that is no longer pending and returns without
  -- repeating a single side effect.
  select * into v_claim from public.professional_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = '42704';
  end if;

  if v_claim.state <> 'pending' then
    return v_claim;
  end if;

  if p_decision = 'reject' then
    update public.professional_claims
    set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
        decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = v_claim.id
    returning * into v_claim;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (v_reviewer, 'professional_claim_rejected', 'professional_claims', v_claim.id,
            jsonb_build_object('professional_id', v_claim.professional_id,
                               'claimant_user_id', v_claim.claimant_user_id));
    return v_claim;
  end if;

  -- ---- approve ----------------------------------------------------------
  -- Lock the IDENTITY, not just the claim. Two reviewers approving two
  -- different claims for the same professional serialise here; the loser
  -- re-reads a row that is already claimed and refuses below.
  select * into v_professional from public.professionals
  where id = v_claim.professional_id for update;

  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed and cannot be transferred'
      using errcode = '42501';
  end if;

  -- Re-checked under the lock: the claimant may have acquired an identity
  -- between submitting and being reviewed.
  if exists (select 1 from public.professionals p where p.user_id = v_claim.claimant_user_id) then
    raise exception 'the claimant already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  perform set_config('fadeup.professional_claim_write', 'on', true);
  update public.professionals
  set claim_state = 'claimed', user_id = v_claim.claimant_user_id, claimed_at = now()
  where id = v_professional.id;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  update public.professional_claims
  set state = 'approved', decided_at = now(), decided_by = v_reviewer,
      decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = v_claim.id
  returning * into v_claim;

  -- Every other live claim on this identity is now moot. Closing them is not
  -- housekeeping: leaving them pending would let a later reviewer approve a
  -- second one and hit 23505 on the one-approval index, which is a confusing
  -- way to discover the profile was already taken.
  update public.professional_claims
  set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
      decision_note = 'another claim for this professional identity was approved'
  where professional_id = v_professional.id
    and state = 'pending'
    and id <> v_claim.id;

  -- Close the acquisition loop. The organization is DERIVED, never supplied:
  -- a caller-provided organization_id would let a reviewer attribute someone
  -- else's conversion. Exactly one owner membership is unambiguous; zero or
  -- several is not, and this declines to guess rather than picking one.
  select count(*) into v_org_count
  from public.memberships m
  where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

  if v_org_count = 1 then
    select m.organization_id into v_org_id
    from public.memberships m
    where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

    v_converted := private.record_prospect_conversion(v_professional.id, v_org_id);
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_reviewer, 'professional_claim_approved', 'professional_claims', v_claim.id,
          jsonb_build_object('professional_id', v_professional.id,
                             'claimant_user_id', v_claim.claimant_user_id,
                             'owner_organization_count', v_org_count,
                             'prospect_conversion_recorded', v_converted));

  return v_claim;
end;
$function$;

-- ---- moderate_review → moderation.content
-- Masquer un avis est le métier du modérateur.
create or replace function public.moderate_review(p_review_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_review public.reviews;
begin
  if (select auth.uid()) is null or not private.platform_can('moderation.content') then
    raise exception 'platform moderation only' using errcode = '42501';
  end if;
  if p_status not in ('published','under_review','removed') then
    raise exception 'invalid moderation status';
  end if;
  -- « La note est mauvaise » n'est pas un motif : seuls les cinq motifs de
  -- la contrainte reviews_moderation_reason_valid sont représentables.
  update public.reviews
     set status = p_status,
         moderation_reason = case when p_status = 'published' then null else p_reason end,
         moderated_at = case when p_status = 'published' then null else now() end,
         moderated_by = case when p_status = 'published' then null else (select auth.uid()) end
   where id = p_review_id
  returning * into v_review;
  if not found then
    raise exception 'review not found';
  end if;
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'review_moderated', 'reviews', v_review.id,
          jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_review;
end;
$function$;

-- ---- resolve_review_report → moderation.content
-- Résoudre un signalement est le métier du modérateur.
create or replace function public.resolve_review_report(p_report_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null or not private.platform_can('moderation.content') then
    raise exception 'platform moderation only' using errcode = '42501';
  end if;
  if p_status not in ('reviewed','dismissed','actioned') then
    raise exception 'invalid report resolution';
  end if;
  update public.review_reports
     set status = p_status,
         resolved_at = now(),
         resolved_by = (select auth.uid())
   where id = p_report_id;
  if not found then
    raise exception 'report not found';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'review_report_resolved', 'review_reports', p_report_id,
          jsonb_build_object('status', p_status));
end;
$function$;

commit;

-- ============================================================================
-- 11. AUCUN ACCÈS AU PAIEMENT EN VUE EMPRUNTÉE
-- ============================================================================
--
-- « Personne ne change un abonnement au nom d'un autre — ni plan, ni moyen de
-- paiement, ni résiliation. » La garde est SERVEUR : les six RPC de paiement
-- refusent tant qu'une vue empruntée est ouverte et non échue. Corps repris
-- verbatim de la production ; une seule ligne s'ajoute, en tête de chacune,
-- AVANT toute autre vérification — un refus de paiement ne doit pas dépendre
-- de l'ordre des gardes.
--
-- assign_commercial_plan reçoit au passage la question commercial.plan_assign
-- (le commercial gère les promotions) à la place de is_platform_admin().

begin;

-- ---- assign_commercial_plan
create or replace function public.assign_commercial_plan(p_organization_id uuid, p_plan_key text, p_status commercial_status DEFAULT 'active'::commercial_status, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_old_plan text;
  v_old_status public.commercial_status;
  v_max_est integer;
  v_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
  v_change_id uuid;
begin
  perform private.assert_not_in_support_view('assign_commercial_plan');
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'changing a commercial plan requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The whole authorization decision, in one line, resolved from the session
  -- and never from an argument. An owner of the organization is NOT sufficient:
  -- the organization is the party being charged, and a party cannot decide what
  -- it owes.
  if (select auth.uid()) is null or not (select private.platform_can('commercial.plan_assign')) then
    raise exception 'only FadeUp platform staff may change an organization commercial plan'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  -- Unknown plan fails closed and says so, rather than being coerced into
  -- something plausible. is_available is checked too: a withdrawn plan may be
  -- kept for the organizations already on it, and must not be newly assignable.
  select p.max_establishments, p.max_operational_professionals
    into v_max_est, v_max_pro
  from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available;

  if v_max_est is null then
    raise exception 'unknown or unavailable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023',
            hint = 'Plan keys are free, solo, salon_essential, salon_pro, salon_business, multi_growth, multi_pro, multi_scale.';
  end if;

  perform private.ensure_organization_commercial_state(p_organization_id);

  -- Serialise against concurrent assignment AND against concurrent location or
  -- roster creation: this is the same row those triggers lock, so "downgrade
  -- while another location is being created" cannot interleave into a state
  -- where both succeeded.
  select s.plan_key, s.status into v_old_plan, v_old_status
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  if v_old_plan is null then
    raise exception 'organization not found' using errcode = '42704';
  end if;

  if v_old_plan = p_plan_key and v_old_status = p_status then
    raise exception 'organization is already on % with status %', p_plan_key, p_status
      using errcode = 'P0001';
  end if;

  -- Counted AFTER the lock, so the numbers in the error message are the
  -- numbers the decision was made on.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  -- The same rule the trigger enforces, checked here so the caller gets an
  -- explanation rather than a constraint violation. Defence in depth, not a
  -- substitute: the trigger still runs on the UPDATE below.
  if v_used_est > v_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %. Nothing has been changed.',
      p_plan_key, v_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp does not remove establishments to satisfy a plan change.';
  end if;

  if v_max_pro is not null and v_used_pro > v_max_pro then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %. Nothing has been changed.',
      p_plan_key, v_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Their identity, followers and appointment history are preserved either way.';
  end if;

  update public.organization_commercial_state
  set plan_key = p_plan_key,
      status = p_status,
      -- Hard-coded. A staff decision is a staff decision, and no argument to
      -- this function can make it look like a payment.
      entitlement_source = 'platform_grant',
      assigned_at = now(),
      assigned_by = v_actor,
      assignment_note = p_note
  where organization_id = p_organization_id;

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (p_organization_id, v_old_plan, p_plan_key,
     v_old_status, p_status, 'platform_grant', v_actor, p_note)
  returning id into v_change_id;

  return v_change_id;
end;
$function$;

-- ---- prepare_billing_checkout
create or replace function public.prepare_billing_checkout(p_organization_id uuid, p_plan_key text, p_interval stripe_billing_interval DEFAULT 'month'::stripe_billing_interval)
 RETURNS TABLE(organization_id uuid, organization_name text, stripe_customer_id text, stripe_price_id text, owner_email text, livemode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.commercial_plans;
  v_price text;
  v_used_est integer;
  v_used_pro integer;
  v_sub_status text;
begin
  perform private.assert_not_in_support_view('prepare_billing_checkout');
  perform private.assert_billing_owner(p_organization_id);

  select * into v_plan from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available and p.price_minor > 0;

  if v_plan.plan_key is null then
    raise exception 'unknown, unavailable or non-payable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023';
  end if;

  -- Un abonnement vivant ne se double pas : on en change.
  select b.subscription_status into v_sub_status
  from public.organization_billing b
  where b.organization_id = p_organization_id;

  if v_sub_status in ('active', 'trialing', 'past_due') then
    raise exception 'this organization already has a subscription — use request_plan_change or the customer portal'
      using errcode = 'P0001';
  end if;

  -- La faisabilité, AVANT le paiement : souscrire un plan qui ne couvre pas
  -- l'activité réelle produirait une organisation en infraction dès la
  -- première seconde.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  if v_used_est > v_plan.max_establishments then
    raise exception 'cannot subscribe to %: it covers % establishment(s) and this organization operates %',
      p_plan_key, v_plan.max_establishments, v_used_est
      using errcode = 'P0001',
            hint = 'Pick a Multi-salons tier that covers every active establishment.';
  end if;

  if v_plan.max_operational_professionals is not null
     and v_used_pro > v_plan.max_operational_professionals then
    raise exception 'cannot subscribe to %: it covers % professional(s) and this organization rosters %',
      p_plan_key, v_plan.max_operational_professionals, v_used_pro
      using errcode = 'P0001',
            hint = 'Pick a plan that covers the whole team — team size is included in shop plans.';
  end if;

  select sp.stripe_price_id into v_price
  from public.billing_stripe_prices sp
  where sp.plan_key = p_plan_key
    and sp.billing_interval = p_interval
    and sp.livemode = private.billing_livemode()
    and sp.is_active;

  if v_price is null then
    raise exception 'no active Stripe price for % / % — run the catalog sync first', p_plan_key, p_interval
      using errcode = 'P0001';
  end if;

  return query
  select
    p_organization_id,
    o.name,
    b.stripe_customer_id,
    v_price,
    (select r.email from private.org_owner_recipient(p_organization_id) r),
    private.billing_livemode()
  from public.organizations o
  left join public.organization_billing b on b.organization_id = o.id
  where o.id = p_organization_id;
end;
$function$;

-- ---- prepare_billing_portal
create or replace function public.prepare_billing_portal(p_organization_id uuid)
 RETURNS TABLE(stripe_customer_id text, livemode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer text;
begin
  perform private.assert_not_in_support_view('prepare_billing_portal');
  perform private.assert_billing_owner(p_organization_id);

  select b.stripe_customer_id into v_customer
  from public.organization_billing b
  where b.organization_id = p_organization_id;

  if v_customer is null then
    raise exception 'no Stripe customer for this organization yet — subscribe first'
      using errcode = 'P0001';
  end if;

  return query select v_customer, private.billing_livemode();
end;
$function$;

-- ---- request_billing_cancellation
create or replace function public.request_billing_cancellation(p_organization_id uuid)
 RETURNS TABLE(stripe_subscription_id text, effective_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_billing public.organization_billing;
begin
  perform private.assert_not_in_support_view('request_billing_cancellation');
  perform private.assert_billing_owner(p_organization_id);

  select * into v_billing from public.organization_billing b
  where b.organization_id = p_organization_id
  for update;

  if v_billing.stripe_subscription_id is null
     or v_billing.subscription_status not in ('active', 'trialing', 'past_due') then
    raise exception 'no live subscription to cancel' using errcode = 'P0001';
  end if;

  -- La fonction Edge pose cancel_at_period_end chez Stripe ; le webhook
  -- confirmera. À l'échéance : retour au Free — profil, réputation, relations
  -- et historique conservés. La suppression définitive est une procédure
  -- RGPD distincte, hors de ce chantier.
  return query select v_billing.stripe_subscription_id, v_billing.current_period_end;
end;
$function$;

-- ---- request_plan_change
create or replace function public.request_plan_change(p_organization_id uuid, p_new_plan_key text, p_new_interval stripe_billing_interval DEFAULT 'month'::stripe_billing_interval)
 RETURNS TABLE(decision text, effective_at timestamp with time zone, stripe_subscription_id text, stripe_subscription_item_id text, stripe_price_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_billing public.organization_billing;
  v_new public.commercial_plans;
  v_current public.commercial_plans;
  v_price text;
  v_used_est integer;
  v_used_pro integer;
  v_upgrade boolean;
begin
  perform private.assert_not_in_support_view('request_plan_change');
  perform private.assert_billing_owner(p_organization_id);

  select * into v_billing from public.organization_billing b
  where b.organization_id = p_organization_id
  for update;

  if v_billing.stripe_subscription_id is null
     or v_billing.subscription_status not in ('active', 'trialing', 'past_due') then
    raise exception 'no live subscription to change — subscribe first'
      using errcode = 'P0001';
  end if;

  select * into v_new from public.commercial_plans p
  where p.plan_key = p_new_plan_key and p.is_available and p.price_minor > 0;

  if v_new.plan_key is null then
    raise exception 'unknown, unavailable or non-payable plan: %', coalesce(p_new_plan_key, '(null)')
      using errcode = '22023';
  end if;

  select * into v_current from public.commercial_plans p
  where p.plan_key = v_billing.plan_key;

  if v_new.plan_key = v_billing.plan_key and p_new_interval = v_billing.billing_interval then
    raise exception 'the organization is already on % (%)', p_new_plan_key, p_new_interval
      using errcode = 'P0001';
  end if;

  -- LA FAISABILITÉ, AVANT TOUT. Un refus est un motif, jamais une donnée
  -- cassée : rien n'a été écrit quand on lève ici.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  if v_used_est > v_new.max_establishments then
    raise exception 'cannot move to %: it covers % establishment(s) and this organization operates %',
      p_new_plan_key, v_new.max_establishments, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first, or pick a tier that covers them. FadeUp never removes an establishment to satisfy a plan change.';
  end if;

  if v_new.max_operational_professionals is not null
     and v_used_pro > v_new.max_operational_professionals then
    raise exception 'cannot move to %: it covers % professional(s) and this organization rosters %',
      p_new_plan_key, v_new.max_operational_professionals, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first — their identity, followers and history are preserved either way.';
  end if;

  select sp.stripe_price_id into v_price
  from public.billing_stripe_prices sp
  where sp.plan_key = p_new_plan_key
    and sp.billing_interval = p_new_interval
    and sp.livemode = private.billing_livemode()
    and sp.is_active;

  if v_price is null then
    raise exception 'no active Stripe price for % / %', p_new_plan_key, p_new_interval
      using errcode = 'P0001';
  end if;

  -- LA DIRECTION. Montée = prix mensuel supérieur, ou passage à l'annuel à
  -- plan égal ou supérieur. Tout le reste attend la fin de la période payée.
  v_upgrade :=
    v_new.price_minor > v_current.price_minor
    or (v_new.price_minor >= v_current.price_minor
        and p_new_interval = 'year' and v_billing.billing_interval = 'month');

  if v_upgrade then
    -- Immédiat. La fonction Edge applique chez Stripe avec proratisation ;
    -- le webhook subscription.updated mettra l'état à jour. Un programmé
    -- antérieur (une descente en attente) est annulé : la dernière décision
    -- du propriétaire gagne.
    update public.organization_billing
    set scheduled_plan_key = null, scheduled_interval = null,
        scheduled_effective_at = null, scheduled_dispatched_at = null,
        scheduled_reason = null
    where organization_id = p_organization_id;

    return query select
      'immediate'::text, now(),
      v_billing.stripe_subscription_id, v_billing.stripe_subscription_item_id, v_price;
  else
    -- Fin de période. Il a payé jusqu'au bout, il garde jusqu'au bout — une
    -- descente qui coupe une capacité déjà payée est un litige.
    update public.organization_billing
    set scheduled_plan_key = p_new_plan_key,
        scheduled_interval = p_new_interval,
        scheduled_effective_at = v_billing.current_period_end,
        scheduled_dispatched_at = null,
        scheduled_reason = 'owner_request'
    where organization_id = p_organization_id;

    return query select
      'scheduled'::text, v_billing.current_period_end,
      v_billing.stripe_subscription_id, v_billing.stripe_subscription_item_id, v_price;
  end if;
end;
$function$;

-- ---- request_billing_quote
create or replace function public.request_billing_quote(p_organization_id uuid, p_establishments integer, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform private.assert_not_in_support_view('request_billing_quote');
  perform private.assert_billing_owner(p_organization_id);

  if p_establishments is null or p_establishments <= 0 then
    raise exception 'establishments must be a positive number' using errcode = '22023';
  end if;

  insert into public.billing_quote_requests
    (organization_id, requested_by, establishments_requested, note)
  values
    (p_organization_id, (select auth.uid()), p_establishments, p_note)
  on conflict (organization_id) where status = 'open' do nothing
  returning id into v_id;

  if v_id is null then
    select q.id into v_id from public.billing_quote_requests q
    where q.organization_id = p_organization_id and q.status = 'open';
  end if;

  return v_id;
end;
$function$;

commit;

-- ============================================================================
-- 12. LE CRM PASSE PAR LA GRILLE (tables appartenant à postgres)
-- ============================================================================
--
-- Avant PLAT-1, toute la console d'acquisition disait la même chose :
--   lecture  : has_platform_role([owner, admin, support])
--   écriture : is_platform_admin()
-- C'est-à-dire : le support lit le CRM entier, et personne d'autre n'y entre.
-- Le fondateur a tranché l'inverse — le support et le modérateur n'ont PAS le
-- CRM, le commercial l'a, le stagiaire n'en voit que sa zone.
--
-- Les deux expressions deviennent donc deux QUESTIONS : `crm.read` et
-- `crm.write`. Cinq tables reçoivent en plus la visibilité par zone : les
-- prospects et ce qui les décrit directement. Les autres tables du CRM
-- (sources, travaux, quotas, doublons…) restent en tout-ou-rien : un
-- stagiaire n'y a rien à faire, et `crm.read` l'en tient dehors entièrement.
--
-- La réécriture est faite par une boucle sur une LISTE ÉCRITE ICI, pas sur un
-- motif de nom : ce qui change est visible dans le diff, et une table ajoutée
-- plus tard ne sera pas emportée par accident. La boucle vérifie le rôle cible
-- de chaque policy avant de la refaire et s'arrête si elle trouve autre chose
-- que `authenticated` — on ne reconstruit pas à l'aveugle une policy dont on
-- n'a pas lu la forme.

begin;

-- ---- Les cinq tables où la zone compte --------------------------------------

drop policy if exists prospects_select_platform_staff on public.prospects;
create policy prospects_select_platform_staff
  on public.prospects for select to authenticated
  using ((select private.platform_prospect_visible(id)));

comment on policy prospects_select_platform_staff on public.prospects is
  'Lecture complète pour un rôle portant crm.read ; pour un rôle borné (le stagiaire), seulement ses zones et ses propres saisies ; rien du tout pour le support, le modérateur et l''extérieur.';

drop policy if exists prospect_locations_select_platform_staff on public.prospect_locations;
create policy prospect_locations_select_platform_staff
  on public.prospect_locations for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

drop policy if exists prospect_contacts_select_platform_staff on public.prospect_contacts;
create policy prospect_contacts_select_platform_staff
  on public.prospect_contacts for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

drop policy if exists prospect_notes_select_platform_staff on public.prospect_notes;
create policy prospect_notes_select_platform_staff
  on public.prospect_notes for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

drop policy if exists prospect_events_select_platform_staff on public.prospect_events;
create policy prospect_events_select_platform_staff
  on public.prospect_events for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

-- ---- Tout le reste du CRM possédé par postgres ------------------------------

do $$
declare
  v_tables text[] := array[
    'api_source_health', 'api_source_limits', 'api_usage',
    'prospect_contacts', 'prospect_duplicates', 'prospect_events',
    'prospect_job_sources', 'prospect_jobs', 'prospect_locations',
    'prospect_notes', 'prospect_outreach', 'prospect_professionals',
    'prospect_publication_eligibility', 'prospect_scores',
    'prospect_social_profiles', 'prospect_source_records', 'prospect_sources',
    'prospect_suppressions', 'prospect_tags', 'prospects'
  ];
  v_zone_selects text[] := array[
    'prospects_select_platform_staff', 'prospect_locations_select_platform_staff',
    'prospect_contacts_select_platform_staff', 'prospect_notes_select_platform_staff',
    'prospect_events_select_platform_staff'
  ];
  r record;
  v_expr text;
  v_done integer := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.roles
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(v_tables)
      and not (p.policyname = any(v_zone_selects))
      and (p.policyname like '%\_select\_platform\_staff' or p.policyname like '%\_select\_platform'
        or p.policyname like '%\_write\_platform\_admin' or p.policyname like '%\_insert\_platform\_admin'
        or p.policyname like '%\_update\_platform\_admin' or p.policyname like '%\_delete\_platform\_admin')
    order by p.tablename, p.policyname
  loop
    if r.roles <> '{authenticated}'::name[] then
      raise exception 'policy %.% cible % et non authenticated — réécriture interrompue',
        r.tablename, r.policyname, r.roles;
    end if;

    v_expr := case when r.cmd = 'SELECT' then 'crm.read' else 'crm.write' end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.cmd = 'SELECT' then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr);
    elsif r.cmd = 'INSERT' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr);
    elsif r.cmd = 'UPDATE' then
      execute format(
        'create policy %I on public.%I for update to authenticated using ((select private.platform_can(%L))) with check ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr, v_expr);
    elsif r.cmd = 'DELETE' then
      execute format(
        'create policy %I on public.%I for delete to authenticated using ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr);
    else
      raise exception 'commande % inattendue sur %.%', r.cmd, r.tablename, r.policyname;
    end if;

    v_done := v_done + 1;
  end loop;

  raise notice 'PLAT-1 : % policies CRM réécrites (postgres)', v_done;

  -- Un filet : si la boucle n'a rien trouvé, c'est que la liste ou les noms
  -- ont changé, et le silence serait pire que l'échec.
  if v_done = 0 then
    raise exception 'aucune policy CRM réécrite — la liste ne correspond plus au schéma';
  end if;
end $$;

-- ---- L'identité des organisations, pour traiter un appel --------------------
--
-- Seule policy locataire que PLAT-1 touche, et volontairement la seule : le
-- modérateur porte support_view.enter, et une vue empruntée sans le nom de
-- l'organisation affiche un bandeau vide. On élargit donc la LECTURE de
-- l'identité d'une organisation aux quatre rôles porteurs de tenant.read
-- (fondateur, admin, support, modérateur). Tout le reste des policies
-- locataires garde is_platform_admin() : élargir la lecture des rendez-vous,
-- des clients ou des barbers appartient aux écrans de PLAT-2, qui pourront la
-- prouver sur des surfaces réelles.

drop policy if exists organizations_select on public.organizations;
create policy organizations_select
  on public.organizations for select to authenticated
  using (
    (select private.is_org_member(id))
    or (select private.platform_can('tenant.read'))
  );

comment on policy organizations_select on public.organizations is
  'Un membre de l''organisation, ou un interne portant tenant.read (fondateur, admin, support, modérateur). Remplace is_platform_admin(), qui excluait le support et le modérateur — deux rôles dont le métier est de traiter un appel ou un signalement sur une organisation nommée.';

commit;

-- ============================================================================
-- 13. LA CLOCHE SUIT LA GRILLE
-- ============================================================================
--
-- `submit_professional_application` diffusait sa notification à TOUT membre
-- interne. Avec six rôles, cela mettrait une candidature à valider dans la
-- cloche d'un stagiaire, qui ne peut pas l'ouvrir. La diffusion suit désormais
-- le droit `onboarding.review` — c'est la même règle que pour les écrans : ce
-- qu'un rôle ne peut pas faire ne lui est pas montré.
--
-- Corps repris verbatim ; seule la clause FROM de la diffusion change.

begin;

create or replace function public.submit_professional_application(p_first_name text, p_last_name text, p_phone text, p_business_name text, p_professional_type professional_type, p_city text DEFAULT NULL::text, p_address_line1 text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_staff_count integer DEFAULT NULL::integer, p_website text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_business_identifier text DEFAULT NULL::text)
 RETURNS professional_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_email text;
  v_application public.professional_applications;
  v_existing public.professional_applications;
  v_phone text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'authentication required to submit a professional application';
  end if;

  -- The email is taken from the verified auth identity, never from the form:
  -- a reviewer must be able to trust that the address they see is the one
  -- that actually owns the account.
  select u.email into v_email from auth.users u where u.id = v_user_id;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'this account has no email address';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'first and last name are required';
  end if;
  if btrim(coalesce(p_business_name, '')) = '' then
    raise exception 'business name is required';
  end if;

  -- Phone is the qualification channel — the reviewer calls this number — so
  -- it is required and normalized here rather than trusted from the client.
  v_phone := public.normalize_phone_number(p_phone);
  if v_phone is null then
    raise exception 'a valid phone number is required';
  end if;

  -- Resubmission is idempotent rather than an error: a double-submit (or a
  -- refresh mid-request) should land the applicant on their status screen,
  -- not on a unique-violation stack trace.
  select * into v_existing
    from public.professional_applications a
    where a.user_id = v_user_id and a.status in ('pending_review', 'approved')
    limit 1;
  if found then
    return v_existing;
  end if;

  insert into public.professional_applications (
    user_id, first_name, last_name, email, phone,
    business_name, professional_type, city, address_line1, postal_code, country,
    staff_count, website, instagram, business_identifier, status
  )
  values (
    v_user_id, btrim(p_first_name), btrim(p_last_name), lower(btrim(v_email)), v_phone,
    btrim(p_business_name), p_professional_type,
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    nullif(btrim(coalesce(p_country, '')), ''),
    p_staff_count,
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_instagram, '')), ''),
    nullif(btrim(coalesce(p_business_identifier, '')), ''),
    'pending_review'
  )
  returning * into v_application;

  -- Fan out to every platform member. Body carries only what a reviewer needs
  -- to decide whether to open the item — no phone, no address.
  insert into public.platform_notifications (recipient_user_id, type, title, body, target_type, target_id)
  select
    pm.user_id,
    'professional_application_submitted',
    v_application.business_name,
    v_application.first_name || ' ' || v_application.last_name,
    'professional_applications',
    v_application.id
  from public.platform_members pm
  join public.platform_role_permissions rp
    on rp.role = pm.role and rp.permission_key = 'onboarding.review';

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_user_id,
    'professional_application_submitted',
    'professional_applications',
    v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'professional_type', v_application.professional_type
    )
  );

  return v_application;
end;
$function$;

drop policy if exists platform_notifications_select on public.platform_notifications;
create policy platform_notifications_select
  on public.platform_notifications for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid()))
  );

drop policy if exists platform_notifications_update_own on public.platform_notifications;
create policy platform_notifications_update_own
  on public.platform_notifications for update to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid()))
  )
  with check (
    recipient_user_id = (select auth.uid())
    and exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid()))
  );

comment on policy platform_notifications_select on public.platform_notifications is
  'Sa propre cloche, et seulement si l''on est encore interne. L''énumération de rôles qui tenait lieu de garde est remplacée par une EXISTENCE : elle vaut false pour un anonyme et reste juste quand la liste des rôles change. Ce qu''un rôle reçoit est décidé à la diffusion, par la grille, pas à la lecture.';

commit;
