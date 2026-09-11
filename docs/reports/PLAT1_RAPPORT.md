# PLAT-1 — Console interne : rôles, permissions, zones, audit

**Branche** `plat1/roles`, créée depuis `rebuild/social-first-v2` (`3a0f5e4`).
**Base** : trois migrations appliquées en production le 2026-09-11.
**Fusion** : aucune. Rien n'a été fusionné, rien n'a été poussé sur une autre branche.

---

## 1. La preuve que `/platform` est intact

C'est le point le plus important du rapport, alors il passe en premier, et il
est mesuré plutôt qu'affirmé.

### Le protocole

Un relevé automatique (`apps/web/e2e/plat1/platform-baseline.mjs`) parcourt
**les 33 routes** de la surface — les 3 portes publiques, les 27 routes gardées,
la redirection de la garde, et une route inexistante sous `/platform` — et
produit pour chacune une empreinte : code HTTP, URL finale, titre, thème sur
`<html>` et sur `<body>`, police calculée, tous les intertitres, tous les liens
de navigation, nombre de tableaux, de boutons, de champs, longueur du texte,
débordement horizontal à 390 px, erreurs console, réponses HTTP ≥ 400. Plus
deux captures par route (1440 px pleine page, 390 px).

**L'« avant » n'est pas une mémoire : c'est le dépôt principal `/opt/fadeup`,
resté sur `3a0f5e4`, servi en parallèle sur un autre port.** Les deux relevés
ont donc tourné contre la même base de données, à quelques minutes
d'intervalle, avec le même navigateur et le même compte.

### Le résultat

| | |
|---|---|
| Routes comparées | **33** |
| Empreintes **identiques champ à champ** | **30** |
| Routes modifiées, toutes voulues par le lot | 3 |
| Erreurs console, avant et après | **0 et 0** |
| Réponses HTTP ≥ 400, avant et après | **0 et 0** |
| Débordement horizontal à 390 px | aucun, avant comme après |

Les trois écarts :

1. **`/platform/team`** — l'écran de gestion des utilisateurs internes, que ce
   lot devait livrer. Un intertitre de plus (« Zones »), 5 champs au lieu de 2,
   19 boutons au lieu de 5.
2. **`/platform/audit`** — le journal, que ce lot devait rendre filtrable. Deux
   champs de filtre apparaissent.
3. **`/platform/organizations`** — **pas une modification de PLAT-1.** Le nom
   d'une organisation QA est passé de « QA F1 mtwesi6k » à « ZZ dead QA F1
   mtwesi6k » **entre les deux relevés**, à 03:42:14, par un lot qui tournait en
   parallèle et neutralisait ses données de test (règle 4 de `QA_DATA.md`).
   Vérifié en base : `organizations.updated_at = 2026-09-11 03:42:14+00`. Aucune
   ligne de code de cette page n'est touchée par PLAT-1.

**Aucune route n'est supprimée, renommée ni déplacée** : la liste des 33 chemins
est identique des deux côtés. **Aucune dépendance n'est ajoutée** :
`apps/web/package.json` n'est pas modifié. **La garde d'accès reste au moins
aussi stricte** — elle attend désormais une information de plus avant de rendre
quoi que ce soit (voir §2).

Captures : `docs/reports/plat1/avant/` et `docs/reports/plat1/apres/`.
Empreintes complètes : `docs/reports/plat1/avant-origine.json` et
`apres-plat1.json` — c'est le fichier qu'il faut rejouer, pas les images.

---

## 2. Le modèle de permissions

### Ce qui existait

`/platform` avait **deux niveaux** : `private.is_platform_admin()` (fondateur +
admin) et `private.has_platform_role([owner, admin, support])`. Un rôle interne
était une position sur une échelle. Nulle part on ne pouvait lire « ce que le
commercial a le droit de faire ».

Les six rôles du fondateur ne forment pas une échelle : le modérateur valide des
onboardings comme le commercial mais n'entre pas au CRM ; le support annule un
rendez-vous que le commercial ne touche pas. Il fallait une grille.

### Où il vit

| Objet | Rôle |
|---|---|
| `public.platform_permissions` | le catalogue des **16 droits**, un par ligne, décrit en clair |
| `public.platform_role_permissions` | la grille rôle × droit — **44 paires** |
| `private.platform_can(clé)` | **LA** question, posée par les RPC et les policies |
| `public.get_my_platform_permissions()` | ce que l'interface lit pour CONDITIONNER son rendu |

La grille telle qu'elle est en production :

| Droit | Fondateur | Admin | Support | Modérateur | Commercial | Stagiaire |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `crm.read` | ● | ● | | | ● | |
| `crm.write` | ● | ● | | | ● | |
| `crm.zone_read` | | | | | | ● |
| `crm.field_capture` | ● | ● | | | ● | ● |
| `marketplace.publish` | ● | ● | | | ● | |
| `marketplace.withdraw` | ● | ● | ● | ● | | |
| `onboarding.review` | ● | ● | | ● | ● | |
| `moderation.content` | ● | ● | | ● | | |
| `appointment.cancel` | ● | ● | ● | | | |
| `tenant.read` | ● | ● | ● | ● | | |
| `commercial.plan_assign` | ● | ● | | | ● | |
| `support_view.enter` | ● | ● | | ● | | |
| `billing.manage` | ● | ● | | | | |
| `audit.read` | ● | ● | | | | |
| `internal_roles.manage` | ● | | | | | |
| `barber.delete` | ● | | | | | |

Chaque case vide est une décision autant que chaque case pleine.

### Comment il se vérifie

`private.platform_can()` teste une **existence**, jamais une égalité :

```sql
select exists (
  select 1
  from public.platform_members pm
  join public.platform_role_permissions rp on rp.role = pm.role
  where pm.user_id = (select auth.uid())
    and rp.permission_key = p_permission
);
```

Pour un appelant anonyme, `auth.uid()` vaut NULL, aucune ligne ne joint, le
résultat est **`false` — jamais NULL**. C'est la forme qui évite le piège que X3
a documenté deux fois : une comparaison `colonne = auth.uid()` vaut NULL pour un
anonyme, et `if not NULL` ne lève pas. Toutes les gardes écrites dans ce lot
sont de la forme `if v_actor is null or not (select private.platform_can(...))
then raise` — **le cas nul est traité explicitement**, même là où la fonction
garantit déjà un booléen strict.

**118 policies RLS** ont été réécrites pour poser cette question au lieu des
deux anciennes expressions : 37 sur les tables possédées par `postgres`, 81 sur
celles possédées par `supabase_admin`. Aujourd'hui **120 policies** de `public`
appellent `private.platform_can()` (les deux de plus sont `platform_zones` et
`platform_member_zones`), et **zéro** policy CRM ne référence encore
`has_platform_role`.

### Pourquoi une garde d'interface ne suffit pas

Parce que X3 l'a prouvé deux fois : `reschedule_appointment` laissait déplacer
le rendez-vous walk-in d'un salon tiers, et la policy `staff_profiles_insert`
avait un EXISTS tautologique. Dans les deux cas, l'interface ne proposait rien
de tel — et les deux étaient exploitables en appelant directement.

Alors la preuve de ce lot ne passe pas par l'interface. `verify_plat1.sql`
appelle **les RPC**, et `e2e/plat1/platform-support-view.mjs` appelle PostgREST
**depuis la page, avec le jeton du compte**, exactement comme le ferait
quelqu'un qui ouvre la console du navigateur. Le frontend ne fait que
CONDITIONNER : `usePlatformPermissions()` décide de ce qui est rendu, jamais de
ce qui est permis.

---

## 3. Les zones

**Une zone est un couple (pays ISO-2, ville normalisée).**

### Ce que j'ai regardé avant de trancher

- **Pas de PostGIS** : refusé explicitement en `20260811150000`. La géographie
  disponible est `cube` + `earthdistance`, donc des distances, pas des
  polygones.
- **Pas de géocodeur, pas de table de communes.** Les coordonnées de `locations`
  sont saisies à la main, et `locations.latitude` porte le commentaire « a
  location only participates in distance-sorted search once geocoded ».
- **Le modèle de zone de service de B1** (`locations.kind = 'service_area'`,
  centre + rayon ≤ 100 km) décrit la couverture d'**un** professionnel mobile.
  C'est une donnée d'offre, pas un découpage de territoire. L'employer pour les
  zones commerciales aurait voulu dire inventer des centres et des rayons que
  personne n'a mesurés — exactement ce que le lot interdit.
- **Les données réelles** : `prospect_locations` porte `city` sur 20 lignes sur
  48 et `postal_code` sur 21 sur 48. Ni l'un ni l'autre n'est complet.

### Pourquoi la ville

Parce que c'est ce qu'un stagiaire sur le terrain sait dire de son secteur, et
parce que la normalisation existe déjà dans le code (`extensions.unaccent`,
posée par `20260814000000_marketplace_city_matching.sql`). `city_key =
lower(unaccent(btrim(ville)))` porte l'unicité, si bien que « Saint-Étienne » et
« saint-etienne » sont la même zone. Le **code postal est conservé comme
indication** (`postal_code_hint`) et n'entre jamais dans la décision de
visibilité : une ville en porte plusieurs.

### Plusieurs stagiaires par zone

`platform_member_zones` est une table d'association `(user_id, zone_id)` sans
unicité d'aucun côté : plusieurs stagiaires par zone, plusieurs zones par
stagiaire. Le fondateur seul assigne (`set_platform_member_zones`).

### Ce qu'une zone change

`private.platform_prospect_visible(prospect_id)` tranche en trois issues
explicites :

1. l'appelant a `crm.read` → **vrai** (lecture complète) ;
2. l'appelant n'a pas `crm.zone_read` → **faux** (support, modérateur,
   extérieur) ;
3. sinon → vrai **seulement** si le prospect est de sa main
   (`field_captured_by = auth.uid()`) ou si sa localisation tombe dans une de
   ses zones actives.

Un prospect **sans ville** ne tombe dans aucune zone : `platform_zone_key()`
rend NULL et la jointure ne trouve rien. Une donnée manquante ne devient jamais
une autorisation.

Cette visibilité est posée sur `prospects` et sur les quatre tables qui le
décrivent directement (`prospect_locations`, `prospect_contacts`,
`prospect_notes`, `prospect_events`). Tout le reste du CRM — campagnes, sources,
modèles, WhatsApp, quotas — reste en tout-ou-rien sur `crm.read`, ce qui en tient
le stagiaire **entièrement** dehors.

---

## 4. Les deux origines du CRM

`prospects` n'avait **aucune colonne de provenance**. La trace vivait dans
`prospect_source_records` (adaptateur, URL, charge brute), ce qui convient à une
machine et pas à un commercial qui décroche son téléphone.

PLAT-1 ajoute quatre colonnes :

| Colonne | Ce qu'elle dit |
|---|---|
| `origin` (`worker` \| `field`) | Worker V2, ou vu sur le terrain |
| `field_captured_by` | **l'auteur** — `ON DELETE SET NULL` : un stagiaire qui part n'efface pas ce qu'il a observé |
| `field_captured_at` | **la date** |
| `field_observation` | **ce qu'il a vu** : l'enseigne, les fauteuils, l'affluence, le logiciel à la caisse |

Défaut `'worker'` pour les 52 lignes antérieures : elles viennent toutes de
Worker V2. Une contrainte de forme
(`prospects_field_origin_shape`) empêche qu'une origine soit affichée sans la
date qui la rend vérifiable.

**La distinction est visible sans cliquer** : un badge « Field » dans la liste
des prospects, et sur la fiche un badge « Seen in the field » avec un encadré
qui porte la date, l'observation et l'auteur. Une fiche Worker porte le badge
« Worker V2 ».

La saisie passe par `public.capture_field_prospect(...)`, qui :

- exige `crm.field_capture` ;
- **exige l'observation** — sans elle, une fiche terrain ne vaut pas mieux
  qu'une ligne scrapée ;
- refuse une ville hors des zones de l'appelant quand il est borné à ses zones ;
- ne fusionne **jamais** automatiquement : un doublon est refusé en le nommant
  (`fadeup_field_capture_refusal=prospect_already_known`) et l'humain tranche,
  parce que le rapprochement est le métier de `prospect_duplicates` ;
- écrit au journal.

**L'écran de saisie n'est pas dans ce lot** (§6 : « PLAT-1 pose le socle, pas
les écrans métier »). Le contrat est en production et testé ; PLAT-2 pose
l'écran.

---

## 5. La vue en tant que

### Ce qui existait, et ce qui manquait

`platform_support_sessions` existait depuis `20260810140000`, avec sa trace et
son bandeau. Il lui manquait **une échéance**, **une garde de paiement**, et
**une visibilité côté professionnel**. L'entrée était réservée à
`is_platform_admin()`, donc fermée au modérateur.

### Durée : trente minutes

Motif : un dépannage réel dure entre cinq et quinze minutes. Trente laisse le
temps d'un appel difficile et ferme la session **avant l'heure de travail
suivante**. Au-delà, on **ré-entre** — ce qui laisse une seconde trace — plutôt
que de prolonger sans trace.

L'échéance est stockée (`expires_at`, défaut `now() + 30 minutes`, contrainte
`expires_at > started_at`) plutôt que déduite, pour qu'un changement de règle
plus tard ne réécrive pas rétroactivement des sessions déjà ouvertes.
`private.platform_active_support_session()` ne rend une session que si elle est
**non close ET non échue**, et le bandeau interroge la même condition, si bien
qu'il tombe au moment exact où la session cesse d'emprunter quoi que ce soit.

Les sessions antérieures à ce lot, qui n'avaient pas d'échéance, ont été
**fermées** par la migration : une session ouverte depuis avant PLAT-1 est, par
définition, oubliée.

### Trace

Chaque entrée et chaque sortie écrit dans `platform_audit_log`
(`platform_support_session_started` / `_ended`), avec l'organisation, la cible et
l'échéance. Le journal est en ajout seul (§6).

### Aucun accès au paiement — garde côté serveur

`private.assert_not_in_support_view()` est appelée **en première ligne** des six
RPC de paiement : `assign_commercial_plan`, `prepare_billing_checkout`,
`prepare_billing_portal`, `request_billing_cancellation`, `request_plan_change`,
`request_billing_quote`. En tête, avant toute autre vérification : un refus de
paiement ne doit pas dépendre de l'ordre des gardes.

Prouvé dans le navigateur, RPC appelée directement avec le jeton du fondateur :

| Geste | Hors vue empruntée | En vue empruntée |
|---|---|---|
| `assign_commercial_plan` | **200** | **403** `fadeup_support_view_refusal=payment_forbidden` |
| `prepare_billing_portal` | — | **403** `payment_forbidden` |

et en SQL, les six RPC refusées (assertions H3 à H8), puis **H9 : une session
échue rend le paiement à nouveau possible** — ce qui prouve que la garde est
bien l'échéance et non un verrou permanent.

### Bandeau permanent, non fermable

Barre collée en haut de la fenêtre (`position: sticky`, `z-50`), fond plein
ambre (`rgb(180, 121, 10)`), bordure haute et basse, ombre. Elle porte le
libellé « SUPPORT VIEW », le nom de l'organisation empruntée, **le décompte**
(« 30 min left »), le rappel « No payment action is possible here », et **un
seul bouton : sortir**.

Aucune croix, aucun « masquer », aucun « plus tard ». Relevé dans le navigateur :

```json
{ "text": "SUPPORT VIEW Acting on ZZ dead QA F1 mtwesi6k 30 min left
           No payment action is possible here Exit Support View",
  "buttons": ["Exit Support View"],
  "position": "sticky",
  "background": "rgb(180, 121, 10)" }
```

Et il **persiste en changeant de page** (vérifié : navigation vers
`/platform/applications`, bandeau toujours là). Un modérateur qui oublie où il
est fait des dégâts — c'est la seule raison d'être de ce traitement visuel.

Trois tests unitaires verrouillent la règle, dont un qui compte les boutons du
bandeau et échoue si un second apparaît.

### Refusée à un rôle non habilité — testé en appelant la RPC

Depuis le navigateur, avec le jeton du compte, sans passer par l'interface :

| Rôle | `start_platform_support_session` |
|---|---|
| Support | **403** `fadeup_support_view_refusal=not_authorized` |
| Commercial | **403** `not_authorized` |
| Stagiaire | **403** `not_authorized` |
| Modérateur | 200 — session ouverte, bandeau affiché |

Et en SQL, un anonyme également refusé (assertion G4).

Le bouton d'entrée, lui, **n'est pas rendu** aux rôles qui ne le portent pas.
Pas grisé : absent.

### Ce que le professionnel peut savoir

**Une trace consultable**, comme vous le recommandiez.

`public.list_organization_support_sessions(p_organization_id)` rend au
propriétaire ou au manager d'une organisation la liste des vues empruntées
qu'elle a subies : quand, jusqu'à quand, sur quelle cible, pour quel motif. La
policy `platform_support_sessions_select` porte la même ouverture.

**L'identité de l'interne n'est pas exposée** — décision prise seule, §11. Ce
qui est opposable au professionnel est qu'une session a eu lieu, quand et
pourquoi ; *qui exactement* est une donnée RH qui appartient au journal interne,
lu par le fondateur et les admins.

Testé : le propriétaire voit (J1), un tiers ne voit rien (J2).

---

## 6. L'audit

### Ce qui est tracé

Les sept familles qu'exige le lot, plus celles qui existaient :

| Famille exigée | Action écrite |
|---|---|
| Publication d'un prospect | `external_professional_published` |
| Validation d'un onboarding / d'une revendication | `professional_application_approved` / `_rejected`, `professional_claim_approved` / `_rejected` |
| Masquage d'un avis ou d'un post | `review_moderated`, `post_moderated`, `review_report_resolved` |
| Annulation d'un rendez-vous | `appointment_cancelled_by_platform` |
| Traitement d'un retrait | `marketplace_withdrawal_requested`, `marketplace_withdrawal_completed` |
| Vue en tant que | `platform_support_session_started` / `_ended` |
| Changement de rôle interne | `platform_member_granted`, `platform_member_role_changed`, `platform_member_revoked`, `platform_member_zones_set` |

Plus `field_prospect_captured`, `platform_zone_created`,
`barber_deleted_by_platform`, et les trois actions d'invitation.

`moderate_review` et `resolve_review_report` **n'écrivaient rien** avant ce
lot : elles écrivent désormais. L'assertion I7 vérifie que chacune des sept
familles a bien un écrivain — soit une ligne déjà dans le journal, soit une RPC
qui la produit — plutôt que d'inventer une ligne pour faire passer le test.

### Comment l'immuabilité est garantie

Le motif de `commercial_plan_changes`, repris tel quel :

```sql
create trigger platform_audit_log_append_only
  before update or delete on public.platform_audit_log
  for each row execute function public.reject_platform_audit_mutation();
```

**Aucune exemption de rôle, volontairement.** BYPASSRLS ne contourne pas un
déclencheur : `postgres` et `service_role` sont refusés comme les autres. Un
journal que le rôle le plus puissant peut réécrire n'est pas un journal.

Deux couches, comme l'exige X3 : les privilèges disaient déjà non (`revoke
insert, update, delete, truncate ... from anon, authenticated`), le déclencheur
le dit **même si un grant futur disait oui**. Le `select` résiduel d'`anon` a
été révoqué au passage.

Prouvé, en `reset role` donc au plus haut privilège disponible :

- I5 : `update public.platform_audit_log` → `42501 platform_audit_log est en ajout seul : UPDATE n'est pas permis`
- I6 : `delete from public.platform_audit_log` → `42501 ... DELETE n'est pas permis`

### Qui le consulte

`platform_audit_log_select` reste sur `private.is_platform_admin()` : **fondateur
et admins seulement**. Vérifié rôle par rôle : le fondateur lit (I1), le support
(I2), le modérateur (I3) et le commercial (I4) obtiennent **zéro ligne**. Dans
l'interface, la page affiche une phrase honnête plutôt qu'un tableau vide, et le
lien n'est pas dans leur navigation.

---

## 7. Migrations

Sauvegarde avant toute écriture : `/opt/fadeup/backups/pre-plat1-20260911-030031.dump`
(3,3 Mo, `pg_dump -Fc`).

| Migration | Rôle | Contenu | Retour arrière |
|---|---|---|---|
| `20260911100000_plat1_role_enum.sql` | `postgres` | les 3 valeurs d'énumération manquantes | testé — voir la réserve ci-dessous |
| `20260911100100_plat1_permission_model.sql` | `postgres` | catalogue, grille, `platform_can`, zones, origines, audit scellé, échéance de vue empruntée, 11 RPC neuves, 18 RPC redéfinies, 37 policies | **testé, ACL identiques** |
| `20260911100200_plat1_crm_policies_admin.sql` | `supabase_admin` | 81 policies CRM | **testé, ACL identiques** |

**Propriétaires vérifiés avant écriture** : les 22 fonctions redéfinies
appartiennent toutes à `postgres` ; les 64 tables CRM se répartissent en 31
`postgres` et 33 `supabase_admin`, d'où la séparation en deux fichiers — une
policy ne se refait que par le propriétaire de sa table, et la règle 3 de
`DB_OWNERSHIP.md` interdit la moitié de migration.

**`create or replace` et jamais `drop` + `create`** sur les 18 fonctions
existantes : une signature inchangée conserve l'ACL. Un DROP obligerait à
re-matérialiser les grants, et c'est ainsi qu'on perd un droit sans s'en
apercevoir (le piège de P1PRO).

### Le test de retour arrière

Bac d'essai fidèle : base `plat1_scratch` restaurée depuis le dump, **owner
aligné sur `postgres` comme en production** (restaurée d'abord en
`supabase_admin`, ce qui produisait 247 erreurs de privilèges — corrigé, puis
**0 erreur**).

Fidélité prouvée avant de commencer : 994 lignes d'ACL, de policies et d'états
RLS comparées entre la production et la restauration → **0 écart**.

Puis : up → suite de permissions verte → down dans l'ordre inverse → nouvelle
comparaison.

| | |
|---|---|
| Lignes comparées après retour arrière | **994** |
| Écarts, ordre des concessions normalisé | **0** |
| Écarts bruts | 2 lignes, uniquement l'**ordre** des concessionnaires dans `relacl` après révocation puis re-concession d'`anon` sur `platform_audit_log` et `platform_support_sessions` — ensembles identiques, chaînes différentes |
| Objets résiduels | tables, colonnes, fonctions, types : **0** |

**La réserve, déclarée** : PostgreSQL n'a pas d'`alter type drop value`. Les
trois valeurs `platform_sales`, `platform_moderator`, `platform_intern` ne
peuvent pas être retirées sans recréer le type, donc sans casser les ~190
policies, colonnes et fonctions qui le référencent. Le retour arrière de
`20260911100000` fait ce qui suffit : il **refuse de tourner** tant qu'un compte
porte un de ces rôles, puis rétablit le commentaire du type. Une valeur que
personne ne porte et qu'aucune grille ne dote de droits n'autorise rien — le
défaut est le refus. **C'est le seul résidu assumé de ce lot.**

### Le contrat de surface anonyme

`PLAT-1 n'ajoute aucune RPC appelable par `anon`.** Les 11 RPC neuves sont
toutes `revoke all ... from public, anon; grant execute ... to authenticated`.
Le contrat reste à **44 RPC anonymes**, et `x3_anon_surface.sh --strict` le
confirme sans modification de l'allowlist.

**Un point qui a coûté une itération, et qui mérite d'être écrit** : une
fonction appelée **depuis une policy** est évaluée sous l'identité de
l'appelant. `private.platform_can()` et `private.platform_prospect_visible()`
ont donc besoin d'un `grant execute ... to authenticated` — comme
`private.is_platform_admin()` et `private.has_org_role()`, vérifié. Sans lui,
toute lecture CRM meurt sur « permission denied ». Les fonctions appelées
uniquement depuis des SECURITY DEFINER (`assert_not_in_support_view`,
`platform_active_support_session`, `platform_zone_key`,
`platform_is_zone_limited`) restent, elles, sans aucun grant client.

---

## 8. La suite de permissions

`db/tests/verify_plat1.sql` — **66 assertions**, une seule transaction terminée
par `ROLLBACK` (règle 1 de `QA_DATA.md`). Elle crée sept comptes, six rôles,
deux zones et deux prospects, puis n'écrit rien : vérifié après passage en
production, **0 ligne résiduelle**.

```bash
docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
  -v ON_ERROR_STOP=1 -q < db/tests/verify_plat1.sql
```

Elle échoue bruyamment à la première assertion fausse. Ce qu'elle couvre :

| | |
|---|---|
| **A** | la grille répond, et le défaut est le refus (anonyme et compte hors plateforme : zéro droit) |
| **B** | **seul le fondateur gère les rôles internes** — l'admin refusé sur les quatre gestes, le fondateur accepté, le dernier fondateur ni rétrogradable ni révocable, l'auto-révocation refusée, l'anonyme refusé |
| **C** | **un admin ne supprime pas un barber** — et la distinction des deux refus : l'admin bute sur `42501` (autorisation), le fondateur sur `42704` (introuvable), ce qui prouve qu'il a bien passé la garde |
| **D** | **le stagiaire ne voit que sa zone** (voit celui de sa zone, pas celui d'ailleurs, pas ses coordonnées, aucune campagne), **ne publie pas**, saisit dans sa zone, est refusé hors zone, et refusé sans observation |
| **E** | **support et modérateur sans CRM** — zéro prospect, zéro campagne, zéro source, zéro modèle ; le commercial, lui, voit |
| **F** | onboardings : support refusé, commercial et modérateur passent la garde ; modération : commercial refusé, modérateur passe |
| **G** | **la vue en tant que refusée** au support, au commercial, au stagiaire et à l'anonyme ; accordée au modérateur ; échéance à trente minutes vérifiée |
| **H** | **en vue empruntée, les six gestes de paiement refusés** ; hors vue empruntée, accepté ; **session échue, accepté à nouveau** |
| **I** | le journal : lu par le fondateur, pas par le support ni le modérateur ni le commercial ; **ni modifiable ni supprimable même en `reset role`** ; les sept familles d'action ont leur écrivain |
| **J** | **le propriétaire voit les vues empruntées subies**, un tiers ne voit rien |
| **K** | le commercial n'annule pas un rendez-vous, le support passe la garde, une annulation sans motif est refusée |

---

## 9. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (`tsc -b` + `tsconfig.v2`) | **0 erreur** |
| `npm run lint` (oxlint + eslint `--max-warnings 0` + garde palette) | **0 erreur**, garde palette verte |
| `npm run test` (Vitest) | **694 / 694, 81 fichiers** — dont 7 neufs sur le bandeau et la navigation par rôle |
| `NODE_OPTIONS=--max-old-space-size=3072 npm run build` | **succès**, chunk `platform` 813 Ko / **221 Ko gzip**, chargé paresseusement |
| `db/tests/verify_plat1.sql` (production) | **66 assertions vertes, 0 résidu** |
| `db/tests/probe_public_rpcs.sh --strict` | **vert** — toutes les lectures publiques en 200 |
| `db/tests/x3_anon_surface.sh --strict` | **vert** — 137 tables balayées en anonyme et en authentifié-sans-droit, contrat de surface intact à 44 RPC |
| Relevé des 33 routes, avant / après | **30 identiques**, 3 écarts voulus ou externes (§1) |
| Erreurs console sur les 33 routes | **0**, avant comme après |
| Réponses HTTP ≥ 400 | **0**, avant comme après |
| `npm run e2e` | voir §9bis |
| axe | voir §9bis |

Les nouveaux tests unitaires :

- le bandeau ne rend rien sans session ; il nomme l'organisation et le temps
  restant ; **il n'expose qu'un seul bouton**, et le test échoue si un second
  apparaît ; il dit « session échue » passé l'échéance ;
- la navigation : le fondateur voit tout, le support n'a ni CRM ni équipe ni
  journal, le stagiaire n'a que l'acquisition, et **rien n'est grisé ni
  cadenassé à la place d'un lien absent**.

---

## 10. Git

| | |
|---|---|
| Branche | `plat1/roles`, depuis `rebuild/social-first-v2` (`3a0f5e4`) |
| Fichiers touchés | 24 modifiés, 11 ajoutés — **aucun hors périmètre** |
| `app/routes.tsx` | **intouché** (interdit : OS-1 et PERF y travaillent) |
| `vite.config.ts` | **intouché** (interdit : PERF y travaille) |
| `features/pro-*` | **intouché** (interdit : OS-1 y travaille) |
| `apps/mobile` | **intouché** |
| `apps/web/package.json` | **intouché** — aucune dépendance ajoutée |
| Fusion | **aucune** |

`/platform/team` et `/platform/audit` existaient déjà comme routes : les écrans
neufs y sont posés **sans toucher au routeur**, ce qui satisfait à la fois
« aucune route supprimée, renommée ou déplacée » et l'interdiction de modifier
`app/routes.tsx`.

---

## 11. Décisions prises seules

1. **La zone est (pays, ville).** Justifiée en §3. L'alternative — reprendre le
   centre + rayon de B1 — aurait exigé d'inventer des coordonnées.
2. **Trente minutes pour une vue empruntée.** Justifiée en §5.
3. **Le professionnel voit qu'une session a eu lieu, pas qui l'a menée.** Ce qui
   lui est opposable est le fait, la date et le motif ; l'identité de l'interne
   est une donnée RH qui reste au journal interne. **À ratifier.**
4. **`is_platform_admin()` n'est pas touchée.** Elle garde une vingtaine de
   policies de lecture locataire. L'élargir aurait sur-autorisé d'un coup tout
   ce qu'elle protège. Les nouveaux rôles passent par la grille, pas par elle.
5. **Une seule policy locataire élargie : `organizations_select`**, ouverte aux
   porteurs de `tenant.read` (fondateur, admin, support, modérateur). Sans elle,
   un modérateur en vue empruntée verrait un bandeau sans nom d'organisation.
   **Tout le reste des policies locataires garde `is_platform_admin()`** : élargir
   la lecture des rendez-vous, des clients ou des barbers appartient aux écrans
   de PLAT-2, qui pourront la prouver sur des surfaces réelles.
6. **Le CRM, c'est acquisition + outreach + data-science.** « Support : pas de
   CRM » a été lu comme couvrant les trois sections, puisque les trois sont le
   travail commercial. Conséquence assumée : le support **perd** la lecture du
   CRM qu'il avait. Aucun compte support réel n'existe aujourd'hui (les deux
   lignes `platform_support` en base sont des résidus de suite `verify_*`).
7. **La cloche suit la grille.** `submit_professional_application` diffusait sa
   notification à *tout* membre interne ; elle la diffuse désormais aux porteurs
   d'`onboarding.review`. Sans ce changement, une candidature à valider
   atterrissait dans la cloche d'un stagiaire qui ne peut pas l'ouvrir.
8. **`delete_barber_as_platform` refuse un barber qui a un historique** et
   renvoie vers `offboard_barber`. `appointments.barber_id` est `ON DELETE
   RESTRICT` : la base l'interdisait déjà, la RPC le dit clairement au lieu de
   laisser remonter une violation de clé.
9. **`playwright.config.ts` prend un port paramétrable** (`E2E_PORT`, défaut
   4610 inchangé). Trois worktrees tournent en parallèle et
   `reuseExistingServer: true` aurait fait passer mes tests contre le code d'un
   autre lot. PLAT-1 utilise 4630.
10. **`database.types.ts` n'est mis à jour que sur l'énumération.** Voir §12.

---

## 12. Erreurs commises, déclarées

1. **La restauration du bac d'essai, d'abord fausse.** Restaurée en `postgres`
   puis en `supabase_admin` sans aligner le propriétaire de la base : 247
   erreurs, puis un `permission denied for schema public`. Corrigé en alignant
   `datdba` sur `postgres` comme en production — et c'est seulement après cette
   correction que les 994 lignes d'ACL correspondaient. Une restauration dont on
   ne vérifie pas les ACL n'est pas un bac d'essai.
2. **Les grants de policy oubliés.** J'avais révoqué `platform_can` à
   `authenticated`, par réflexe X3. La suite est morte sur « permission denied
   for function platform_prospect_visible ». Une fonction appelée depuis une
   policy s'exécute sous l'identité de l'appelant : c'est écrit en §7 pour que
   ça ne se reperde pas.
3. **Le relevé de référence, incomplet au premier passage.** Il ne couvrait pas
   `/platform/team` ni `/platform/audit` — les deux écrans que j'allais modifier.
   Rattrapé en servant le dépôt principal intouché sur un second port, ce qui
   donne une référence meilleure que la première.
4. **Un délimiteur de fonction cassé par une substitution trop large.** Le
   générateur des corps repris verbatim ajoutait un `;` après *chaque*
   `$function$`, y compris l'ouvrant. Détecté par le `ON_ERROR_STOP` du bac
   d'essai, jamais parti en production.
5. **`assign_commercial_plan` appelée avec un `plan_key` inexistant** pendant la
   preuve navigateur, puis avec `solo` sur une organisation QA. **Le plan a été
   remis à `free`** par la même RPC, sous le compte fondateur QA, avec le motif
   écrit au journal. L'organisation concernée est `qa-f1-mtwesi6k`, déjà marquée
   « ZZ dead ».
6. **Le bandeau affichait « 31 min left » sur une session de trente.** `Math.ceil`
   sur un décalage d'horloge d'une seconde. Passé en `Math.round`.

---

## 13. Cases non cochées, avec la raison exacte

| Case | Raison |
|---|---|
| **`npm run e2e`** | voir §9bis — la campagne a dû attendre qu'un lot parallèle libère le runner |
| **axe sans violation sérieuse ou critique** | voir §9bis |
| **L'écran de saisie terrain** | §6 du lot : « PLAT-1 pose le socle, pas les écrans métier. PLAT-2 construira les surfaces par rôle. » La RPC `capture_field_prospect` est en production et testée (D6 à D9) ; l'origine est **visible** sur la liste et la fiche ; il manque le formulaire. |
| **Support et modérateur : « lecture complète pour traiter un appel »** | Seule `organizations_select` a été élargie (§11.5). La lecture des rendez-vous, des clients et des barbers reste sur `is_platform_admin()`. Élargir une quarantaine de policies locataires sans écran pour les exercer aurait été un élargissement non prouvé. **PLAT-2, avec ses écrans.** |
| **`database.types.ts` régénéré intégralement** | Le générateur `postgres-meta` local produit désormais une forme différente (il n'émet plus `isOneToOne`) : une régénération complète mêlerait 884 lignes sans rapport au diff de ce lot. Seule l'énumération `platform_role` a été mise à jour, à la main. Rien n'en dépend : le client `/platform` (`src/lib/supabase.ts`) n'est **pas** typé sur `Database`. **À faire en une fois, avec un générateur épinglé.** |
| **Les comptes QA `qa-plat1-*`** | Sept comptes `@fadeup.test` créés pour la campagne navigateur (l'authentification réelle exige de vraies lignes `auth.users`). Ils portent les six rôles et servent la suite e2e. **Ils sont encore en base** — voir §14. |

---

## 14. Données de test laissées en place

Sept comptes `qa-plat1-*@fadeup.test` (identifiants `c1a71000-…`), un par rôle
plus un compte hors plateforme, avec le mot de passe `Plat1-QA!2026`, et six
lignes `platform_members` notées « QA PLAT-1 éphémère ».

**Je les laisse** parce que la suite `e2e/plat1/platform-permissions.spec.ts`
s'appuie dessus et se saute proprement s'ils disparaissent. Pour les retirer :

```sql
delete from public.platform_members where note like 'QA PLAT-1%';
delete from auth.users where email like 'qa-plat1-%@fadeup.test';
```

À votre main. Dites-le et je les supprime.

Par ailleurs, les quatre lignes `platform_members` `fafafafa-…` / `fabfabfb-…`
sont des **résidus antérieurs**, laissés par une suite `verify_platform_control_center.sql`
qui a été committée contre la production. Elles ne viennent pas de ce lot, et je
ne les ai pas touchées.

---

## 15. Ce que PLAT-2 devra trancher

1. **Les écrans par rôle.** Le socle est posé ; les surfaces ne le sont pas. Un
   support qui se connecte aujourd'hui voit deux entrées de menu et rien pour
   traiter un appel.
2. **La lecture locataire du support et du modérateur.** Quelles policies
   exactement, et prouvées sur quels écrans. C'est la case non cochée la plus
   importante.
3. **Le formulaire de saisie terrain**, et sa version mobile : un stagiaire
   saisit debout dans la rue, pas devant un écran de 1440 px.
4. **La granularité de la zone.** Une ville suffit pour Saint-Denis, pas pour
   Paris. Arrondissement ? Code postal ? Le modèle actuel se sous-divise sans
   migration destructive (une zone de plus, un `city_key` plus fin), mais il
   faut trancher avant d'assigner de vrais stagiaires.
5. **La file des retraits RGPD.** `list_marketplace_withdrawal_requests` existe
   depuis B2, avec `is_overdue` et `hours_remaining`, et le commentaire de la
   fonction dit lui-même que « c'est la colonne sur laquelle un écran
   `/platform` doit alerter ». Cet écran n'existe toujours pas. Les 72 heures ne
   sont pour l'instant tenues par personne.
6. **L'identité de l'interne, côté professionnel** (§11.3), à ratifier.
7. **Le conflit avec `x2/gdpr`.** Cette branche redéfinit
   `publish_external_professional`, que PLAT-1 redéfinit aussi (une ligne : la
   garde passe de `is_platform_admin()` à `platform_can('marketplace.publish')`).
   Les deux branches ne sont fusionnées ni l'une ni l'autre. **La fusion devra
   reprendre le corps X2 et y appliquer la garde PLAT-1**, pas choisir.
8. **La régénération de `database.types.ts`** avec un générateur épinglé.
