# PLAT-1 — Console interne : rôles, permissions, zones, audit

**Branche** `plat1/roles`, créée depuis `rebuild/social-first-v2` (`3a0f5e4`).
**Base** : cinq migrations appliquées en production le 2026-09-11.
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
| Routes dont l'empreinte diffère | 3 — deux voulues par le lot, une causée par un lot voisin (détail ci-dessous) |
| Erreurs console, avant et après | **0 et 0** |
| Réponses HTTP ≥ 400, avant et après | **0 et 0** |
| Routes débordant horizontalement à 390 px | **3 avant, les mêmes 3 après** — `team`, `acquisition/jobs`, `acquisition/sources` : un défaut hérité de tableaux larges, ni corrigé ni aggravé par ce lot (aucune route neuve ne déborde) |

Les trois écarts :

1. **`/platform/team`** — l'écran de gestion des utilisateurs internes, que ce
   lot devait livrer. Un intertitre de plus (« Zones »), 5 champs au lieu de 2,
   19 boutons au lieu de 5.
2. **`/platform/audit`** — le journal, que ce lot devait rendre filtrable. Deux
   champs de filtre apparaissent.
3. **`/platform/organizations`** — **pas une modification de PLAT-1.** Seule la
   longueur du texte change, parce que **six organisations QA ont été renommées
   en « ZZ dead QA … » pendant ma session**, par un lot qui tournait en
   parallèle et neutralisait ses données de test (règle 4 de `QA_DATA.md`).
   Vérifié en base : six lignes `organizations` avec `updated_at` entre 03:52
   et 04:24, toutes préfixées « ZZ dead ». Aucune ligne de code de cette page
   n'est touchée par PLAT-1 — c'est le contenu de la table qui a bougé sous le
   relevé.

Le débordement de `/platform/team` mérite d'être nommé plutôt que caché : il
existait **avant** ce lot (mesuré sur le dépôt intouché), et la colonne
« Gérer » que j'ajoute ne le crée pas — elle s'ajoute à un tableau qui
dépassait déjà. **Je ne l'ai pas corrigé** : refaire la mise en page mobile des
tableaux hérités est une refonte de la surface, que le lot interdit. **À
consigner pour PLAT-2**, avec les deux autres écrans d'acquisition.

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
celles possédées par `supabase_admin`. Après les durcissements de revue, **130 policies** de `public` appellent
`private.platform_can()` : les 123 du CRM, `organizations_select`,
`platform_member_zones_select`, `platform_audit_log_select`, et les quatre du
détail locataire (`locations`, `memberships`, `barbers`, `staff_profiles`). **Zéro** policy CRM ne référence encore `has_platform_role`.
(Le rapport disait d'abord « les deux de plus sont `platform_zones` et
`platform_member_zones` » : c'était faux, `platform_zones_select` emploie un
`EXISTS` direct. Corrigé après revue.)

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

### Ce qu'elle fait, et ce qu'elle NE fait PAS — à lire avant de cocher la case

La revue indépendante a posé la question juste, et la réponse doit être écrite
noir sur blanc : **ce lot livre le cadre de la vue en tant que, pas
l'élévation.**

`start_platform_support_session` ne donne **aucun droit de lecture
supplémentaire** — son propre commentaire le dit. Ce qui existe après PLAT-1
est : une session datée, bornée, tracée, un bandeau permanent, et une garde de
paiement. Ce qui n'existe pas est un modérateur qui VOIT ce que voit le
propriétaire : il n'a ni les établissements, ni l'équipe, ni les barbers (§16),
et sa fiche d'organisation le lui dit désormais honnêtement au lieu de prétendre
qu'ils n'existent pas.

Le §4 du cahier des charges dit « prend la vue d'un propriétaire de salon **et
agit en son nom** ». **La seconde moitié n'est pas livrée.** Je ne coche donc
pas cette case et je la remonte : décider ce que « voir comme le propriétaire »
ouvre exactement — et le prouver sur des écrans — est le travail de PLAT-2, qui
ne doit surtout pas se construire en croyant la fonctionnalité acquise.

**Un corollaire à connaître.** La garde de paiement porte sur l'**acteur**, pas
sur la cible : rien n'empêche de sortir de la vue, changer le plan, ré-entrer.
L'acte reste tracé au journal, et la garde fait ce qu'elle promet — aucun geste
de paiement **pendant** la vue empruntée — mais elle ne garantit pas à elle
seule que personne ne touche un abonnement au nom d'un autre. Pour les cinq RPC
Stripe, c'est `assert_billing_owner` qui l'interdit ; pour
`assign_commercial_plan`, rien : un admin peut l'appeler sur n'importe quelle
organisation, en vue empruntée ou non. **C'était déjà vrai avant PLAT-1**, et ce
lot ne le change pas.

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
| `20260911100100_plat1_permission_model.sql` | `postgres` | catalogue, grille, `platform_can`, zones, origines, audit scellé, échéance de vue empruntée, 11 RPC neuves (plus 6 aides `private` et un déclencheur), 18 RPC redéfinies, 37 policies | **testé, ACL identiques** |
| `20260911100200_plat1_crm_policies_admin.sql` | `supabase_admin` | 81 policies CRM | **testé, ACL identiques** |
| `20260911100300_plat1_publication_chain.sql` | `postgres` | les 3 gardes internes de la chaîne de publication | **testé** (down puis up rejoués sur le bac d'essai) |
| `20260911100400_plat1_review_hardening.sql` | `postgres` | les 6 durcissements de la revue indépendante (§16) | **testé** (down puis up rejoués sur le bac d'essai) |

**Ce que les quatre migrations ont changé en production**, mesuré objet par
objet contre l'état d'avant :

| | |
|---|---|
| Objets avant / après | 986 / 1016 |
| **Objets supprimés** | **0** |
| Objets ajoutés | 30 (4 tables, leurs policies, les fonctions neuves) |
| Policies modifiées | **127** — les 118 du CRM, les 5 sélections sensibles aux zones, `organizations_select`, les 2 de la cloche, et `platform_support_sessions_select` |
| ACL de table modifiées | **2**, strictement plus strictes : le `SELECT` résiduel d'`anon` révoqué sur `platform_audit_log` et `platform_support_sessions` |

**Concédant vérifié avant révocation**, comme l'exige le lot : les deux
concessions retirées portaient `anon=r/postgres`, et les migrations qui les
retirent s'appliquent en `postgres`. Un `revoke` par le mauvais rôle aurait été
un no-op silencieux ; la vérification après coup montre `anon` réellement
absent des deux ACL.

**Propriétaires vérifiés avant écriture** : les **21 fonctions redéfinies**
(18 dans la migration 2, 3 dans la migration 4) appartiennent toutes à `postgres` ; les 64 tables CRM se répartissent en 31
`postgres` et 33 `supabase_admin`, d'où la séparation en deux fichiers — une
policy ne se refait que par le propriétaire de sa table, et la règle 3 de
`DB_OWNERSHIP.md` interdit la moitié de migration.

**`create or replace` et jamais `drop` + `create`** sur les 21 fonctions
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

**Ce qu'un retour arrière DÉTRUIT, et qu'il faut savoir avant de l'ordonner.**
Le fichier le dit en tête, mais un fondateur qui ne lit que ce rapport doit
l'avoir sous les yeux : le retour arrière de `20260911100100` supprime les
colonnes `field_observation`, `field_captured_by` et `field_captured_at` de
`prospects`, ainsi que les tables `platform_zones` et `platform_member_zones`.
**Les prospects saisis sur le terrain survivent, mais ce que le stagiaire a
observé, qui l'a saisi et quand disparaissent avec les colonnes**, et toutes
les affectations de zones avec les tables. Tant qu'aucune fiche terrain n'a été
saisie et qu'aucune zone n'a été créée — l'état d'aujourd'hui — le retour
arrière ne coûte rien. Après, il coûte cela.

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

`db/tests/verify_plat1.sql` — **80 assertions**, une seule transaction terminée
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
| **L** | **la chaîne de publication va jusqu'au bout** : le commercial franchit les trois gardes, le stagiaire est arrêté, le rafraîchissement d'éligibilité suit la même question |
| **M** | **plusieurs stagiaires partagent une zone**, et le second y voit bien les prospects |
| **N** | les durcissements de revue : **TRUNCATE refusé même en `reset role`**, l'admin ne révoque pas une invitation, le modérateur ne lit ni le trombinoscope ni le détail d'une organisation, l'admin les lit, et **la restriction par zone survit à la réécriture de performance** |

---

## 9. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (`tsc -b` + `tsconfig.v2`) | **0 erreur** |
| `npm run lint` (oxlint + eslint `--max-warnings 0` + garde palette) | **0 erreur**, garde palette verte. Le lot **ajoute un avertissement** oxlint (`require-platform-role.tsx`, `only-export-components`) : le fichier exporte désormais un second hook à côté de son composant. Même motif que les onze avertissements identiques déjà présents dans le dépôt ; déclaré plutôt que tu. |
| `npm run test` (Vitest) | **694 / 694, 81 fichiers** — dont 7 neufs sur le bandeau et la navigation par rôle |
| `NODE_OPTIONS=--max-old-space-size=3072 npm run build` | **succès**, chunk `platform` 813 Ko / **221 Ko gzip**, chargé paresseusement |
| `db/tests/verify_plat1.sql` (production) | **80 assertions vertes, 0 résidu** |
| `db/tests/probe_public_rpcs.sh --strict` | **vert** — toutes les lectures publiques en 200 |
| `db/tests/x3_anon_surface.sh --strict` | **vert** — 137 tables balayées en anonyme et en authentifié-sans-droit, contrat de surface intact à 44 RPC |
| Relevé des 33 routes, avant / après | **30 identiques**, 3 écarts voulus ou externes (§1) |
| Erreurs console sur les 33 routes | **0**, avant comme après |
| Réponses HTTP ≥ 400 | **0**, avant comme après |
| `npm run e2e` — suite PLAT-1 seule | **12 / 12 verts**, 390 px et 1440 px |
| `npm run e2e` — campagne complète | **non lancée** : le runner est occupé par un lot voisin depuis deux heures, et les suites antérieures partagent `qa-f1b-shared`. Voir §9bis. |
| axe | **8 violations sérieuses, toutes de contraste, toutes préexistantes** — dont une sur la page de connexion que ce lot ne touche pas. Le bandeau neuf, lui, en ajoute **zéro**. Voir §9bis. |

### 9bis. axe, et la campagne e2e

**axe — la mesure, puis la déclaration honnête.**

Le lot demande « axe sans violation sérieuse ou critique ». **La case n'est pas
cochée**, et voici exactement pourquoi.

Le même balayage a tourné contre le dépôt **intouché** et contre PLAT-1, sur
quatre écrans × deux largeurs :

| Écran | Nœuds en échec, avant | après |
|---|---|---|
| `/platform/login` (intouché) | 1 | 1 |
| `/platform/organizations` (intouché) | 4 | 4 |
| `/platform/audit` | 5 | 5 |
| `/platform/team` | 8 | **11** |

**Une seule règle échoue partout : `color-contrast`**, et elle échoue **déjà
sur la page de connexion, que ce lot ne touche pas**. Deux causes, toutes deux
dans la palette héritée de `/platform` :

- `--color-ink-500` (#66766e) sur `--color-paper-50` (#f5f8f6) donne **4,48:1**
  — il manque 0,02 pour AA ;
- blanc sur `--color-accent-600` (#0d9b5f) donne **3,57:1** — le bouton
  primaire de toute la console.

PLAT-1 **n'introduit pas de classe de défaut nouvelle** : il ajoute trois
occurrences de deux défauts qui existaient déjà huit fois sur le même écran, en
réutilisant les primitives de la page (un en-tête de colonne, un sous-titre de
section, un bouton primaire). Corriger la cause, c'est modifier deux jetons de
la palette héritée — ce qui repeindrait **tous** les écrans de la console et
détruirait, par construction, la preuve d'équivalence du §1. Le lot dit « c'est
une surface existante, ne la refais pas ». **Je ne l'ai donc pas fait, et je le
déclare plutôt que de le taire.** C'est une décision de produit, pas
d'implémentation.

**Ce que j'ai corrigé, en revanche, c'est ce qui était à moi.** Le bandeau de
vue empruntée est le seul traitement visuel neuf du lot. Sa première version
était blanche sur ambre : **3,7:1, échec AA**. Il porte désormais une encre
fixe sur ambre — **5,1:1 en thème clair, 8,1:1 en sombre** — parce que
`--color-warning-600` s'inverse avec le thème et qu'une couleur prise dans
l'échelle `ink` aurait rendu le bandeau illisible en sombre. Même raisonnement
que le « blanc sur vert interdit » du contrat pro.

Preuve que le bandeau ne coûte rien : le balayage relancé **avec la vue
empruntée ouverte** (le bandeau est présent sur les quatre écrans, le relevé le
note) donne **exactement les mêmes nombres de nœuds** — 11, 5, 4. Le bandeau
ajoute **zéro** violation.

Relevés : `docs/reports/plat1/axe-avant.json`, `axe-apres.json`,
`axe-bandeau.json`.

**Campagne e2e.** `apps/web/e2e/plat1/platform-permissions.spec.ts` a été
écrite : garde et redirection, navigation du fondateur, du support et du
stagiaire, refus honnête du journal, et **refus de la vue en tant que avec la
RPC appelée directement** (403 + motif nommé). Elle se saute proprement si les
comptes QA n'existent pas.

**Résultat — la suite PLAT-1 seule : 12 tests, 12 verts**, en 390 px et en
1440 px (52 s).

```
E2E_PORT=4630 QA_SUPABASE_URL=… QA_ANON_KEY=… npx playwright test e2e/plat1
  12 passed (52.4s)
```

Dont le test qui compte : `start_platform_support_session` appelée **depuis la
page, avec le jeton du support**, rend **403** et le motif nommé
`fadeup_support_view_refusal=not_authorized`. Et celui qui vérifie qu'aucun
lien absent n'est remplacé par un élément grisé ou cadenassé.

**La campagne COMPLÈTE — les suites antérieures comprises — n'a pas pu tourner.**
Un lot voisin occupe le runner Playwright depuis près de deux heures, et le
cahier des charges impose « une seule campagne e2e à la fois ». Les suites
antérieures (d1, f1, f1b, f2, f3, f4, p1b, p1pro) partagent l'organisation
`qa-f1b-shared` : les lancer maintenant corromprait la campagne voisine autant
que la mienne. La suite PLAT-1, elle, ne touche aucune donnée partagée — elle
se connecte, lit `/platform` et appelle une RPC — d'où le lancement isolé.

**Cette case reste donc non cochée**, et c'est une attente d'ordonnancement,
pas un échec : `npm run e2e` est à relancer en entier dès que le runner se
libère. J'ai rendu le port paramétrable (`E2E_PORT`, défaut 4610 inchangé)
précisément pour que trois worktrees puissent cohabiter sans qu'un lot teste le
code d'un autre — `reuseExistingServer` le permettait.

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
| Commits | 6 : le socle, la chaîne de publication, les durcissements de revue, et trois de rapport |
| Fichiers touchés | **aucun hors périmètre** |
| `app/routes.tsx` | **intouché** (interdit : OS-1 et PERF y travaillent) |
| `vite.config.ts` | **intouché** (interdit : PERF y travaille) |
| `features/pro-*` | **intouché** (interdit : OS-1 y travaille) |
| `apps/mobile` | **intouché** |
| `apps/web/package.json` | **intouché** — aucune dépendance ajoutée |
| Poussée | `origin/plat1/roles`, 6 commits |
| Fusion | **aucune** — `git branch --contains HEAD` ne rend que `plat1/roles` |

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
7. **Le défaut le plus grave du lot, trouvé en me relisant et corrigé.**
   `publish_external_professional` avait reçu la garde `marketplace.publish`,
   qui ouvre la publication au commercial — mais elle appelle
   `create_external_professional` et
   `refresh_prospect_publication_eligibility`, deux fonctions SECURITY DEFINER
   qui portaient encore `is_platform_admin()` et
   `has_platform_role([owner, admin])`. Dans un SECURITY DEFINER, `auth.uid()`
   reste celui de l'appelant : ces gardes internes se réévaluaient pour le
   commercial et le refusaient. Mesuré avant correction, en transaction
   annulée :

   ```
   refus 42501 — only FadeUp platform staff or the acquisition worker
                 can create external profiles
   ```

   Autrement dit, le critère « publier sur la marketplace est une action de
   commercial ou d'admin » était **faux en pratique**, alors que la garde
   d'entrée disait oui. Une garde d'entrée qui ment est pire qu'une garde
   absente. Corrigé par `20260911100300_plat1_publication_chain.sql`, et
   verrouillé par les assertions L1 à L3 : le commercial franchit les trois
   gardes, le stagiaire reste arrêté.

   **La leçon, qui vaut pour PLAT-2** : changer la garde d'une RPC ne suffit
   pas ; il faut suivre ce qu'elle APPELLE. Une requête sur le graphe d'appels
   (`pg_proc.prosrc`) a montré que `publish_external_professional` était la
   seule des treize RPC re-gardées dans ce cas — mais c'est une vérification à
   refaire à chaque fois.
8. **Un sélecteur de test qui refermait ce qu'il venait d'ouvrir.** Le script de
   preuve visait `getByRole('button', { name: /support/i })` sur la fiche
   d'organisation ; le bandeau, placé plus haut dans le DOM, porte lui aussi un
   bouton dont le nom contient « support ». Le premier passage ouvrait la
   session, le second cliquait sur « Exit Support View ». Diagnostiqué par le
   journal d'audit, qui montrait une session fermée 46 secondes après son
   ouverture — le journal a servi avant même d'avoir un écran.

---

## 13. Cases non cochées, avec la raison exacte

| Case | Raison |
|---|---|
| **`npm run e2e` en entier** | La suite PLAT-1 est verte (12/12). La campagne complète attend que le runner se libère : un lot voisin le tient depuis deux heures et les suites antérieures partagent `qa-f1b-shared`. Attente d'ordonnancement, pas échec. |
| **axe sans violation sérieuse ou critique** | Le seul défaut est un contraste de la **palette héritée** de `/platform`, présent avant ce lot jusque sur la page de connexion. Le corriger veut dire repeindre toute la console et détruire la preuve d'équivalence du §1. Décision de produit, pas d'implémentation. Voir §9bis. |
| **L'écran de saisie terrain** | §6 du lot : « PLAT-1 pose le socle, pas les écrans métier. PLAT-2 construira les surfaces par rôle. » La RPC `capture_field_prospect` est en production et testée (D6 à D9) ; l'origine est **visible** sur la liste et la fiche ; il manque le formulaire. |
| **Vue en tant que : « agit en son nom »** | Le cadre est livré (trace, échéance, garde de paiement, bandeau) ; **l'élévation de lecture ne l'est pas**. Voir §5, requalifié après revue. |
| **Support et modérateur : « lecture complète pour traiter un appel »** | Seule `organizations_select` a été élargie (§11.5). La lecture des rendez-vous, des clients et des barbers reste sur `is_platform_admin()`. Élargir une quarantaine de policies locataires sans écran pour les exercer aurait été un élargissement non prouvé. **PLAT-2, avec ses écrans.** |
| **`database.types.ts` régénéré intégralement** | Le générateur `postgres-meta` local produit désormais une forme différente (il n'émet plus `isOneToOne`) : une régénération complète mêlerait 884 lignes sans rapport au diff de ce lot. Seule l'énumération `platform_role` a été mise à jour, à la main. Rien n'en dépend : le client `/platform` (`src/lib/supabase.ts`) n'est **pas** typé sur `Database`. **À faire en une fois, avec un générateur épinglé.** |
| **Les comptes QA `qa-plat1-*`** | Sept comptes `@fadeup.test` créés pour la campagne navigateur (l'authentification réelle exige de vraies lignes `auth.users`). Ils portent les six rôles et servent la suite e2e. **Ils sont encore en base** — voir §14. |

---

## 13bis. La revue indépendante, et ce qu'elle a trouvé

Une revue indépendante a été lancée sur le lot avec pour consigne de chercher
des défauts. Elle a restauré la sauvegarde d'avant en schéma seul, extrait les
379 corps de fonctions, et diffé un à un contre la production — la seule façon
de vérifier « repris verbatim » au lieu de me croire. Verdict sur ce point :
**21 corps ont changé, aucun autre, et les diffs ne contiennent que les gardes,
les gardes de paiement ajoutées et les deux écritures d'audit voulues.**

Elle a trouvé **un bloquant et sept points sérieux**. Tous sont corrigés, sauf
un qui est une requalification.

| | Trouvaille | Suite donnée |
|---|---|---|
| **B1** | la production était en avance sur le commit — la 4ᵉ migration n'était pas versionnée | committée (`c86b06c`) |
| **S2** | **faux états vides** : un modérateur lisait « No locations yet » sur un salon qui en a | policies de détail locataire passées par la grille, écran qui dit « non visible avec votre rôle » |
| **S3** | la lecture du CRM était devenue une **sous-requête corrélée** — 52 exécutions sur 52 lignes, 26 ms ; inutilisable à 20 000 prospects | terme non corrélé ajouté ; mesuré : `SubPlan never executed`, 1,3 ms |
| **S4** | `RequirePlatformRole` n'avait pas de branche d'erreur pour les droits : une panne dégradait la console **en silence** | branche ajoutée |
| **S5** | le journal filtrait **côté client sur 200 lignes** et répondait « aucune activité » à une question dont la réponse était « plus loin » | filtres poussés dans la requête, « aucun résultat » distingué de « journal vide » |
| **S6** | **le journal était tronçable** : un déclencheur `for each row` ne voit pas TRUNCATE, et `service_role` gardait ce droit | déclencheur `for each statement` + révocation ; assertion N1 |
| **S7** | « seul le fondateur gère les rôles » fuyait par `revoke_platform_invitation` | garde passée à `internal_roles.manage` ; assertion N2 |
| **S8** | **la vue en tant que ne donne la vue de personne** | requalifiée en §5, case non cochée |

Et neuf points mineurs, dont sept corrigés : l'acteur du journal et l'auteur
d'une fiche terrain lisibles en e-mail plutôt qu'en UUID, l'état « pas pour
vous » de l'écran d'équipe, les concessions `anon` résiduelles, la double
source de vérité sur `audit.read` et le trombinoscope, la région live du
bandeau, et trois chiffres faux dans ce rapport.

**Deux mineurs NE sont pas corrigés, et je le déclare :**

- **Les chaînes anglaises en dur que j'ai ajoutées** à la fiche prospect et à
  la liste (« Field », « Seen in the field », « Worker V2 », « Field
  capture »). Cette page est dans la zone exemptée de la localisation et elle
  est **déjà** entièrement en anglais en dur. Traduire cinq chaînes dans une
  page qui en compte deux cents la rendrait incohérente avec elle-même. Le lot
  a traduit dix langues pour ce qu'il livre (`team`, `audit`, le bandeau, la
  fiche d'organisation) et laisse la zone d'acquisition telle qu'elle est.
  **Sa localisation entière est un chantier PLAT-2.**
- **`cancel_appointment_as_platform` inscrit `cancelled_by_business`.**
  L'énumération `appointment_resolution` n'a pas de valeur pour « annulé par la
  plateforme », et lui en ajouter une toucherait le contrat de réservation que
  consomment OS-1, l'application mobile et les écrans pro. La vérité est dans
  `decided_by` (l'interne) et dans le journal ; l'étiquette de la ligne, elle,
  attribue au salon un geste qu'il n'a pas fait. **À trancher en PLAT-2**, avec
  le contrat de réservation ouvert.

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
2. **Ce que « voir comme le propriétaire » ouvre exactement.** C'est la case
   non cochée la plus importante, et la revue a eu raison de le dire :
   aujourd'hui la vue empruntée est un marqueur journalisé, pas une élévation.
   Quelles policies, pour quels rôles, prouvées sur quels écrans — et
   l'affichage honnête posé par ce lot (« non visible avec votre rôle »)
   montre exactement où il manque quelque chose.
3. **Le formulaire de saisie terrain**, et sa version mobile : un stagiaire
   saisit debout dans la rue, pas devant un écran de 1440 px.
4. **La granularité de la zone.** Une ville suffit pour Saint-Denis, pas pour
   Paris. Arrondissement ? Code postal ? Le modèle actuel se sous-divise sans
   migration destructive (une zone de plus, un `city_key` plus fin), mais il
   faut trancher avant d'assigner de vrais stagiaires.
5. **Trois écrans hérités débordent à 390 px** : `/platform/team`,
   `/platform/acquisition/jobs`, `/platform/acquisition/sources`. Mesuré avant
   et après, identique : ce lot ne les crée pas et ne les corrige pas. Défaut
   consigné séparément, comme l'exige la discipline de périmètre.
6. **Un oracle d'existence de prospect subsiste.** `publication_block_reason`,
   `outreach_block_reason` et `prospect_effective_locale` sont exécutables par
   **tout compte authentifié** sans garde plateforme, et prennent un
   `prospect_id` en paramètre. R1A avait fermé un oracle de la même famille
   (`20260825100900_internal_least_privilege.sql`) ; ceux-là sont restés.
   **Antérieur à PLAT-1**, hors périmètre, consigné ici parce que je l'ai vu en
   traçant le graphe d'appels.
7. **La file des retraits RGPD.** `list_marketplace_withdrawal_requests` existe
   depuis B2, avec `is_overdue` et `hours_remaining`, et le commentaire de la
   fonction dit lui-même que « c'est la colonne sur laquelle un écran
   `/platform` doit alerter ». Cet écran n'existe toujours pas. Les 72 heures ne
   sont pour l'instant tenues par personne.
8. **L'identité de l'interne, côté professionnel** (§11.3), à ratifier.
9. **Le conflit avec `x2/gdpr`, et son piège.** Les deux branches redéfinissent
   `publish_external_professional`. PLAT-1 n'y change qu'une ligne — la garde
   passe de `is_platform_admin()` à `platform_can('marketplace.publish')` — mais
   le corps qu'il reprend est celui de la **production**, qui contient déjà le
   travail X2 : il appelle `private.enqueue_publication_information`, la
   fonction qui envoie l'information article 14. Or **cette fonction n'existe
   pas dans l'historique de migrations de cette branche**, parce que `x2/gdpr`
   n'est pas fusionnée alors que ses migrations sont, elles, appliquées en
   production.

   Conséquence : appliquée à la production, ma migration est juste — elle
   préserve X2. **Rejouée à blanc sur une base neuve depuis les seules
   migrations de `plat1/roles`, elle installerait une fonction qui lèverait à
   l'exécution** (plpgsql ne résout pas ses appels à la création, donc rien
   n'échoue à l'installation). Le piège est écrit en toutes lettres dans la
   migration, au-dessus du corps concerné.

   Reprendre le corps B1 de cette branche aurait été pire : cela aurait effacé
   l'information RGPD en production. **La fusion devra prendre les deux
   branches ensemble**, reprendre le corps X2 et y appliquer la garde PLAT-1 —
   pas choisir l'un des deux. C'est le point le plus délicat à ne pas rater.
10. **La régénération de `database.types.ts`** avec un générateur épinglé.
