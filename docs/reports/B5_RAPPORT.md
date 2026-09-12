# B5 — Les contrats base manquants

Branche `b5/missing-contracts`, worktree `~/worktrees/b5`.
Trois manques nommés par M1a et M1b §11 : la suppression de compte, les noms
des salons suivis, la colonne de genre. Plus l'export, exigé par le même
MASTER_SPEC §16 et qui n'existait pas.

**Aucune fusion n'a eu lieu.**

---

## 0. Avertissement de méthode : ce lot a été repris, pas écrit d'un trait

Une session antérieure (2026-09-11, 17 h 26 – 18 h 29 UTC) avait écrit les
quatre migrations, la suite de vérification et le volet mobile, **et les avait
appliquées en production**, sans jamais rien commiter ni écrire de rapport. La
présente session a repris un arbre de travail non commité, sur une branche
vierge.

Ce rapport distingue donc systématiquement :

- ce que j'ai **mesuré moi-même** dans cette session ;
- ce qui a été **mesuré par la session antérieure** et dont je n'ai que les
  artefacts, archivés sous `docs/reports/artifacts/b5/` ;
- ce que j'ai **raisonné** sans le remesurer, avec l'argument.

**Quatre corrections m'appartiennent en propre** (§10) :

1. les `grant execute` manquants sur trois fonctions `private` — défaut de B5
   trouvé en production par OS-2 ;
2. **`email_outbox` : la copie SALON gardait le nom du client** — la garantie
   centrale du lot était fausse ;
3. **`auth.audit_log_entries` : l'e-mail d'ouverture de session, le nom civil
   et le téléphone survivaient** — aucune clé étrangère, donc aucune cascade ;
4. côté mobile, **les photos étaient détruites avant que le serveur ait dit
   s'il acceptait**, et le bouton d'export affichait « Données exportées »
   sans rien livrer.

Les points 2 et 3 ont été trouvés par une revue indépendante que j'ai lancée
sur ce travail, et **mesurés en production** avant correction. Les deux trous
de `verify_b5.sql` qui les rendaient invisibles sont bouchés, et chaque
correction a été **vérifiée en cassant le test** : les assertions échouent sur
l'ancien code et passent sur le nouveau.

---

## 1. La suppression : ce qui est tranché, et pourquoi

`public.delete_my_account()` — sans paramètre, `security definer`, propriétaire
`postgres`. La migration ne concède explicitement qu'à `authenticated` ;
`service_role` apparaît en plus dans l'ACL mesurée, hérité des privilèges par
défaut du schéma et non déclaré par le fichier. Sans conséquence —
`service_role` contourne déjà tout — mais autant le dire : **aucun grant
`anon`**, ni ici ni sur `export_my_data`.

### L'historique est ANONYMISÉ, pas supprimé

Un rendez-vous passé n'appartient pas qu'au client : c'est la comptabilité du
salon, sa fiche client, son chiffre d'affaires, et la durée réelle qui nourrit
son estimation de file. L'effacer réécrirait le passé d'un tiers qui n'a rien
demandé. Les **lignes restent** avec tous leurs faits comptables (date,
service, barber, statut, durée) ; seules les colonnes qui **nomment** une
personne sont neutralisées.

### Les avis restent visibles, anonymisés

Supprimer l'avis laisserait un client **modifier silencieusement la note d'un
salon en fermant son compte** — exactement le préjudice que ce lot interdit.
La note et le texte survivent ; `customer_user_id` passe à NULL et
`reviewer_display_name` au jeton `[deleted]`.

La preuve mécanique que le professionnel n'est pas lésé : le trigger
`reviews_maintain_reputation` ne réagit qu'à INSERT/DELETE/UPDATE **OF
status** ; l'anonymisation ne touche pas au statut, donc les agrégats de
réputation ne bougent pas. Mesuré dans `verify_b5.sql` (F3) : réputation avant
5.0000000000000000, après 5.0000000000000000.

**Résidu déclaré** : un texte d'avis où l'auteur se serait nommé lui-même reste
tel quel. Réécrire du texte libre publié serait falsifier un avis ; le
signalement (`report_review`) est le chemin prévu.

### Les photos partent vraiment — et c'est une PRÉCONDITION, pas une promesse

Le backend de stockage est un backend fichier (`STORAGE_BACKEND=file`) :
supprimer la ligne `storage.objects` en SQL laisserait le fichier sur le
disque. Un appel `pg_net` vers l'API Storage serait asynchrone — le compte
serait effacé sans qu'on sache si la photo l'est. Ce serait un **échec ouvert**
sur la seule donnée que le lot qualifie de personnelle au sens fort.

Donc l'inverse : **la RPC refuse** tant qu'il reste un objet de stockage à
l'appelant (`media_not_purged`). Le client appelle **d'abord** la RPC — pour
que le serveur énumère ses refus avant que quoi que ce soit ne soit détruit
(§10.3) — et, si le média est le seul obstacle restant, les supprime par l'API
Storage — qui efface la ligne **et** le fichier, et pour laquelle il a déjà ses
policies — puis rappelle la RPC. L'effacement des photos devient vérifiable au
lieu d'être espéré, et l'échec est **fermé** : pas de photo purgée, pas de
compte effacé.

### Les journaux en ajout seul : une seule exception, étroite et mesurée

| Journal | Sort | Raison |
|---|---|---|
| `platform_audit_log`, `commercial_plan_changes`, `service_mode_changes` | **Non touchés** | Jamais atteints : la RPC refuse les comptes d'entreprise (`business_account`), un client n'y écrit jamais de ligne. Vérifié, pas supposé. |
| `analytics_events` | `actor_user_id` → NULL, `actor_type` → `anonymous`, `dedupe_key` nettoyée | Plus gros volume comportemental rattaché à la personne. La laisser serait garder une clé pseudonyme stable avec laquelle tout le parcours se reconstitue. La table avait **déjà** une exemption par GUC pour le DELETE : l'ajout est dans son dessin, pas contre lui. |
| `support_ticket_messages` (PLAT-2) | **Caviardé**, pas supprimé | Table en ajout seul sans exemption de DELETE. Ici la donnée personnelle n'est pas un identifiant mais **le corps lui-même** : le caviarder est le seul effacement possible ; la ligne garde sa place dans le fil, son horodatage, son type. |
| `audit_logs` | Rien à faire | Clé étrangère déjà `ON DELETE SET NULL`, aucune garde d'ajout seul. |
| `auth.audit_log_entries` (GoTrue) | **Supprimé** (correctif `20260912060000`) | Journal technique d'authentification, pas un journal comptable : rien côté salon n'en dépend et aucune garde d'ajout seul ne le protège. Il n'a **aucune clé étrangère** vers `auth.users`, donc aucune cascade ne l'atteignait, et son payload porte l'adresse e-mail de connexion, le nom civil et le téléphone. |

L'immutabilité devient explicitement : « aucun champ ne peut être réécrit,
**sauf** l'effacement à NULL d'un identifiant personnel, par le chemin
d'effacement ».

La garde ne fait pas confiance à un drapeau. `private.erasure_update_allowed()`
compare l'ancienne et la nouvelle ligne **clé par clé** et n'autorise que
(a) les colonnes nommées, (b) vers l'une des valeurs **énumérées** pour elle,
(c) rien d'autre ne bouge, (d) avec le GUC transactionnel posé, (e) sous le
rôle propriétaire. Une colonne apparue ou disparue : faux.

**Coût déclaré** : `get_organization_analytics_summary` compte
`unique_authenticated_viewers` en `distinct actor_user_id` — ce visiteur unique
disparaît du compte. C'est exact : il n'existe plus. `unique_customers`, qui
compte `customer_id`, ne bouge pas — les agrégats client du salon sont intacts.

### Les e-mails transactionnels partent dans LEURS DEUX COPIES

`private.emit_booking_notification` écrit **deux** lignes par événement de
réservation : une pour le client, une pour le **salon**, toutes deux portant le
même payload — donc le même `customer_name`. Ne filtrer que sur `to_email`
laissait la seconde intacte. La jointure se fait désormais sur
`payload->>'appointment_id'`, **en texte et jamais par un cast en uuid** : une
ligne de production porte `appointment_id = "-"`, et le cast faisait échouer
l'effacement entier sur `invalid input syntax for type uuid`. Une donnée libre
écrite par un tiers ne se caste pas.

Couverture mesurée : **aucune** ligne `:business` portant un `customer_name`
n'est dépourvue d'`appointment_id`. La jointure les prend toutes.

### La note du salon est SUPPRIMÉE, pas anonymisée

`customer_notes` (OS-2) est rattachée au **client**, dont la fiche survit à
l'effacement : sans traitement, la note survivrait aussi. Une note libre écrite
sur une personne nommée est la donnée de cette personne, quoi qu'en dise la
main qui l'a écrite ; et une note anonymisée ne dit plus rien à personne. Le
salon garde tout ce qui est comptable ; il perd l'appréciation qu'il portait
sur quelqu'un qui a demandé à disparaître.

### Le délai : IMMÉDIAT et DÉFINITIF, pas de fenêtre de trente jours

Une fenêtre d'annulation oblige à **conserver trente jours l'e-mail, le
téléphone et le nom de quelqu'un qui vient d'en demander l'effacement**, et il
faut justifier cette rétention. Ce qu'elle protège en échange, elle le protège
mal ici : l'authentification FadeUp est un code par e-mail — l'attaquant qui
peut supprimer peut aussi annuler. Et FadeUp ne détient pour un client ni
argent, ni contenu publié (aucune publication client, aucune messagerie) : le
regret porte sur un historique et un Passport. Le RGPD demande l'effacement
« sans retard injustifié » ; immédiat est la posture la plus simple à défendre
et la plus simple à **prouver**.

**Contrepartie assumée** : l'opération est irréversible, donc la confirmation
est la responsabilité de l'interface. `DeleteAccountSheet.tsx` la porte.

### La trace ne contient aucune donnée personnelle — pas même l'UUID

`public.account_erasure_log` enregistre l'horodatage, le type d'acteur
(`self` — la RPC n'efface jamais que son appelant) et un objet de **compteurs**
par table. Aucun `user_id`, aucun e-mail, aucun condensat : un UUID conservé
ici resterait un identifiant rattachable aux lignes anonymisées, ce qui
annulerait l'anonymisation qu'il est censé tracer. Le reçu rendu à l'appelant
(`erasure_id`) est la preuve côté personne. La table est elle-même en ajout
seul, RLS activée et **forcée** sans aucune policy, et ses ACL CRUD par défaut
ont été révoquées d'`anon` et d'`authenticated` (mesuré :
`postgres=arwdDxtm | service_role=arwdDxtm`, rien d'autre).

### Les quatre refus, tous nommés

| Motif | Quand |
|---|---|
| `not_authenticated` | `auth.uid()` est NULL. Le motif nul traité **en tête**, jamais un effacement silencieux de rien. |
| `business_account` | Membre d'organisation, de la plateforme, professionnel revendiqué ou fiche staff. Supprimer ce compte orphelinerait une organisation, son personnel et les rendez-vous de **ses** clients. La suppression d'un compte professionnel est un autre problème, **hors périmètre B5** — et le dire est plus honnête que de l'improviser. |
| `active_commitments` | File en cours ou rendez-vous futur non résolu. Les effacer laisserait au salon un créneau tenu par un fantôme injoignable. Le client s'en sort seul : quitter la file, annuler le rendez-vous — le refus ne piège personne. |
| `media_not_purged` | Il reste un objet de stockage à l'appelant (voir plus haut). |

---

## 2. La preuve qu'aucune donnée personnelle ne survit

`db/tests/verify_b5.sql` — une transaction, des assertions qui **lèvent**,
`rollback` final : le script ne laisse rien derrière lui. Réexécuté par moi
dans cette session ; sortie intégrale archivée dans
`docs/reports/artifacts/b5/verify_b5.out`.

Il ne crée **aucune organisation** : il réutilise en lecture seule la structure
de l'organisation QA partagée `qa-f1b-shared` (QA_DATA règle 3) et crée ses
propres comptes dedans, tous annulés au rollback.

Le périmètre réellement effacé sur la fixture, tel que la trace l'enregistre :

```
auth_users_deleted 1          appointments_anonymised 1
customers_anonymised 1        queue_entries_anonymised 2
reviews_anonymised 1          waitlist_entries_anonymised 0
email_outbox_deleted 3        interest_requests_anonymised 0
review_photos_deleted 0       interest_contacts_deleted 0
customer_notes_deleted 1      shop_notifications_deleted 3
support_tickets_redacted 1    shop_notifications_anonymised 2
support_messages_redacted 1   analytics_events_deidentified 8
auth_audit_entries_deleted 2  analytics_dedupe_keys_cleared 4
```

Les deux compteurs qui ont bougé avec le correctif sont exactement les deux
défauts : `email_outbox_deleted` passe de 2 à **3** (la copie salon, que la
fixture crée désormais), et `auth_audit_entries_deleted` **n'existait pas**.

Les deux assertions qui portent la preuve ne sont pas une liste de tables
écrite à la main — elles **balaient le catalogue**, ce qui les rend robustes à
l'arrivée d'une table future :

- **E2 — balayage universel** : l'identifiant du compte est absent des
  **418 colonnes `uuid` de `public`** (profil, Passport, photos, partages,
  favoris, abonnements, likes, notifications, signalements, relations,
  candidatures, revendications, `profiles` compris).
- **E3 — balayage littéral** : e-mail, téléphone, nom et identifiant-en-texte
  absents des **436 colonnes texte, `jsonb` ET `json`** de `public` — c'est ce
  qui attrape un identifiant caché dans une clé d'idempotence
  (`organization_follow:<org>:<uid>`), invisible du balayage uuid.
- **E1 — balayage du schéma `auth` entier**, 144 colonnes : plus une liste de
  trois tables écrites à la main, mais tout le schéma, `audit_log_entries`
  comprise.
- **E8** : aucun objet de stockage sous l'identifiant.
- **E4** : textes libres effacés — rendez-vous, file, fiche salon, note de
  salon, billet et messages de support caviardés sans être amputés.

### Deux trous dans cette preuve, trouvés et bouchés

La version initiale de ces balayages **ne pouvait pas** voir les deux défauts
du §10.3, et une assertion qui ne peut pas échouer est une case cochée à vide :

| Trou | Conséquence | Correction |
|---|---|---|
| E3 restreint à `text` / `character varying` | `email_outbox.payload` est du `jsonb` : le nom du client dans la copie salon était **hors balayage par construction** | `jsonb` **et** `json` inclus — `auth.audit_log_entries.payload` est du `json`, pas du `jsonb`, et l'oublier aurait laissé le second défaut invisible |
| E3 comparant par **égalité** (`col in ($1,$2,$3)`) | un nom ne se trouvait que s'il occupait la colonne **entière** ; noyé dans un texte libre ou une charge utile, il passait | `like '%…%'` sur les quatre aiguilles |
| E1 énumérant trois tables `auth` | `audit_log_entries` n'y était pas | le schéma `auth` est balayé **entier** |
| La fixture ne créait qu'**une** copie d'e-mail, et **aucune** entrée GoTrue | les deux défauts étaient hors d'atteinte du test | la fixture crée les deux copies d'e-mail et les deux formes d'entrée GoTrue (`actor_id` et `traits.user_id`) |

**Vérifié en cassant le test** : sur le code d'avant correctif, E3 lève
`email_outbox.payload contient encore une donnée personnelle (1 ligne(s))` et
E1 lève `auth.audit_log_entries.payload porte encore une donnée du compte
(2 ligne(s))`. Les deux assertions discriminent réellement.

Un troisième point de fragilité a été corrigé au passage : la recherche de
fixture exigeait une localisation **active**, or la tenue de fin de campagne
e2e de F1b neutralise volontairement l'organisation QA partagée. Le script
était donc vert ou rouge selon qu'une campagne venait de tourner — une
dépendance invisible et fausse. Il n'exige plus que la **structure**.

### Un utilisateur ne supprime que son compte

Trois assertions, dont deux par appel direct :

- **C1** : `delete_my_account()` est **unique et sans paramètre** — il n'y a
  rien à forger. C'est la protection principale, portée par la signature.
- **C2** : `private.erase_customer_account(uuid)` n'est exécutable par **aucun**
  rôle client (ACL mesurée : `postgres=X/postgres`, rien d'autre).
- **C3** : appel direct de l'effaceur avec l'identifiant d'autrui → **42501**.

---

## 3. Ce qui reste du côté professionnel

Mesuré après effacement (F1, F2, F3) :

- **le rendez-vous reste** : date, service, barber, statut, horodatage de fin
  intacts — la comptabilité et l'estimation de file sont inchangées ;
- **la file et la fiche client sont conservées**, détachées du compte ;
- **l'avis reste publié**, note 5, sans auteur, et **la réputation ne bouge
  pas d'un centième** ;
- `unique_customers` des analytics, indexé sur `customer_id`, est intact.

Ce que le professionnel perd, et c'est voulu : le nom du client, son
e-mail/téléphone, la note libre qu'il avait écrite sur lui, et un visiteur
unique authentifié dans ses statistiques.

---

## 4. Les abonnements

`public.list_my_followed_organizations()` a été refaite (DROP + CREATE : un
changement de paramètres OUT interdit `create or replace`) et rend désormais :

```
organization_id, organization_name, organization_slug, city, country_code, followed_at
```

Signature asserted exactement, **aucune colonne de plus** (verify H2).

**Rien de plus qu'un profil public.** Vérifié colonne par colonne contre la
surface anonyme réelle :

| Colonne | Déjà publique en anonyme par |
|---|---|
| `organization_name`, `organization_slug`, `country_code` | `get_public_organization(slug)` — mesuré dans son type de retour |
| `city` | `list_public_locations(slug)` rend l'adresse **complète** en anonyme ; la ville est un sous-ensemble strict |

**Ce qui n'est PAS exposé** : nombre d'abonnés, état commercial, visibilité
marketplace, imagerie.

**Pas d'image, et c'est un manque déclaré, pas un oubli** : il n'existe
**aucune colonne d'imagerie d'établissement en base** (manque hérité de D1
§13.1, toujours ouvert). Les bannières de démonstration vivent dans un registre
de fichiers côté web. Inventer une colonne ici aurait élargi le lot ; rendre un
chemin qui n'existe pas aurait été un mensonge.

Deux choix explicites plutôt qu'arbitraires :

- **la ville rendue** est celle de la plus ancienne localisation **active**
  (`order by created_at, id` — déterministe même à égalité), en `left join` :
  une organisation sans localisation active rend `city` NULL, jamais une ligne
  manquante ;
- le filtre `exists(get_public_organization(o.slug))` est **conservé tel quel**.
  Il est aujourd'hui un no-op, mais il porte une intention qui redeviendrait
  effective si cette fonction gagnait un filtre. Le retirer aurait été une
  décision silencieuse.

Le **motif nul** est conservé mot pour mot : `v_user_id is null` → 42501 en
tête. Un anonyme ne reçoit jamais une liste vide qui ressemblerait à « vous ne
suivez personne ».

Le DROP ayant emporté l'ACL, les grants sont **rematérialisés explicitement**
à l'identique de l'ACL mesurée avant migration. Mesuré en production après
coup : `postgres=X | service_role=X | authenticated=X`. **Aucun grant `anon`.**

### `list_my_followed_professionals` — vérifiée, non modifiée

Elle rend déjà `(id, display_name, handle, headline, avatar_url, followed_at)` :
**le même défaut ne s'y trouve pas.** Une divergence mesurée est laissée
intacte — l'absence volontaire de filtre `is_public`, décision de B4 assumée et
documentée dans le COMMENT de la fonction. Revenir dessus aurait été défaire la
décision d'un autre lot sans mandat.

---

## 5. Genre et fréquence

### Où ils vivent

`public.customer_profiles.gender`, enum `public.customer_gender`
(`man`, `woman`, `no_preference`), **nullable**. Les valeurs sont **verbatim**
celles du client mobile (`GENDER_ANSWERS` dans
`apps/mobile/src/features/onboarding/storage.ts`) — pas de table de traduction,
toute dérive casse la compilation. Même règle que
`customer_haircut_frequency`.

`no_preference` (« peu importe ») est une **réponse**, pas une absence :
l'absence est NULL.

**La fréquence de coupe avait déjà sa colonne** (`haircut_frequency`, migration
20260813120000) : le manque n'était pas en base mais côté écran — aucune
surface pour la modifier ou l'effacer. Corrigé hors migration
(`PreferencesSection.tsx`), et `profileSync.ts` écrit désormais les deux en
base au lieu de les garder en AsyncStorage.

### Trois propriétés portées par le schéma, pas par une convention

1. **Optionnelle et effaçable** — la colonne est nullable ; NULL = « pas de
   réponse » **comme** « réponse retirée ». Rien ne distingue les deux, et
   c'est voulu : un drapeau « a refusé de répondre » serait lui-même une donnée
   sur la personne.
2. **Finalité unique et déclarée** — orienter la découverte vers barbershop ou
   salon mixte. Écrite dans le `COMMENT`, seule déclaration que le schéma peut
   porter et que `db-audit/SCHEMA.sql` publie.
3. **Jamais publique.**

### La preuve qu'ils ne fuient nulle part

- Mesuré avant écriture : les trois seules fonctions qui lisent
  `customer_profiles` (`get_my_access`, `get_shared_passport`, `submit_review`)
  **énumèrent leurs colonnes une à une** ; aucune n'utilise `select *`. Une
  colonne ajoutée ne peut donc pas être aspirée par mégarde.
- **verify J1** (assertion sur le catalogue, pas une liste écrite à la main) :
  **aucune** fonction hors `export_my_data` / `erase_customer_account` ne
  mentionne `gender`, et `export_my_data` n'est pas exécutable en anonyme.
- `x3_anon_surface.sh --strict` : 143 tables balayées en rôle `anon` réel
  **et** en authentifié-sans-droit, aucune ligne interdite lisible.

### Comment ils s'effacent

Modifiables et effaçables par leur titulaire via la RLS de `customer_profiles`
(verify B2 et B3). Et ils partent avec la suppression de compte : la ligne
`customer_profiles` est supprimée en cascade depuis `auth.users`, confirmé par
le balayage universel E2.

---

## 6. Migrations

Quatre migrations, chacune avec sa down. Toutes **déjà appliquées en
production** par la session antérieure.

| Migration | Objet |
|---|---|
| `20260911160000_b5_customer_gender.sql` | enum `customer_gender`, colonne `gender`, finalités en COMMENT |
| `20260911160100_b5_followed_organizations.sql` | `list_my_followed_organizations` refaite |
| `20260911160200_b5_account_erasure.sql` | le socle d'effacement, les cinq gardes exemptées, `delete_my_account`, `export_my_data`, `account_erasure_log` |
| `20260911210000_b5_account_erasure_addendum.sql` | ce que la production a gagné **pendant** le lot : `customer_notes` (OS-2), billets de support (PLAT-2), et le durcissement ACL de `account_erasure_log` |
| `20260912060000_b5_erasure_residuals.sql` | **écrite dans cette session** : les deux survivances de données personnelles — copie salon d'`email_outbox`, `auth.audit_log_entries` |

### Pourquoi l'addendum porte l'horodatage 21 h et non 16 h 03

Contrainte d'ordre **dure**. Il redéfinit
`reject_support_ticket_message_mutation`, que PLAT-2 crée à `20260911200000`.
Dans l'ordre des **noms**, un `160300` serait passé **avant** PLAT-2, dont le
`create or replace` — qui ne connaît pas le caviardage — aurait **écrasé
l'exemption** sur toute base rejouée à blanc (CI, bac d'essai, base neuve).
L'effacement de compte se serait alors cassé silencieusement sur le premier fil
de support. En production le défaut est invisible, puisque B5 a appliqué après.
Renommage plutôt que contournement.

### Retour arrière — tour mené dans CETTE session, sur restauration fidèle

Procédure, dans un conteneur jetable (`db/tests/b3_restore_sandbox.sh`, image
identique à la production, restauration **sans** `--no-owner` en
`supabase_admin`, rôles de cluster recréés — donc propriétaires et ACL du dump
conservés tels quels) :

```
dump de la production (avec B5)
  → les 5 down, en ordre inverse                       = T0  (production SANS B5)
  → les 5 up, en ordre                                 = T1
  → les 5 down, en ordre inverse                       = T2
  comparer T0 et T2
```

| Comparaison | Résultat |
|---|---|
| ACL de toutes les tables/vues de `public`, `private`, `storage` | **T0 == T2**, 158 lignes, privilège par privilège |
| ACL **et propriétaires** de toutes les fonctions de `public` et `private` | **T0 == T2**, 456 lignes |
| Corps (md5) des six gardes redéfinies par le lot | **T0 == T2**, 6 fonctions |
| `pg_dump -s` de `public` + `private` | **T0 == T2**, 48 063 lignes |

La seule divergence du dump de schéma était le jeton aléatoire
`\restrict`/`\unrestrict` que `pg_dump` réécrit à chaque export — neutralisé,
il ne reste rien.

**Une erreur de méthode, la mienne, et ce qu'elle a révélé.** Mon premier tour
appliquait les migrations en `supabase_admin` alors qu'elles portent toutes
« à appliquer en `postgres` ». Résultat : `list_my_followed_organizations`
revenait avec le **mauvais propriétaire** (`supabase_admin` au lieu de
`postgres`) et un concédant d'ACL décalé. La comparaison l'a vu — c'est
précisément ce qu'elle est là pour voir. Corrigé (le bac d'essai applique en
`postgres`, comme la doctrine DB_OWNERSHIP §2 l'exige), le tour est propre.
Ce que cela enseigne au passage : la down de `160100` fait `drop` + `create`
**sans** `alter function … owner to`, donc la propriété suit le rôle qui
applique. Le contrat « à appliquer en `postgres` » n'est pas décoratif.

Artefacts versionnés : `docs/reports/artifacts/b5/rollback_comparaison.txt`,
`rollback_md5_T0.txt`, `rollback_md5_T2.txt`.

La session antérieure avait mené trois tours équivalents ; son deuxième avait
attrapé un défaut de la down de l'addendum
(`reject_support_ticket_message_mutation` ne revenait pas à son corps
d'origine), corrigé et confirmé au troisième.

---

## 7. Validation

Tout ce qui suit a été exécuté **dans cette session**, sur l'arbre livré.

### Déterministe

| Suite | Résultat |
|---|---|
| `apps/web` — `npm run typecheck` | **0** (deux projets TypeScript) |
| `apps/web` — `npm run lint` | **0 erreur** (oxlint + eslint `--max-warnings 0` sur les sources + garde palette) |
| `apps/web` — `npm run test` | **721 tests, 85 fichiers, tous verts** |
| `apps/web` — `npm run build` | **0** — 230,0 Ko ≤ budget 240 Ko, `check-entry-graph` vert |
| `apps/mobile` — `npm run typecheck` | **0** |
| `apps/mobile` — `npm run lint` | **0 erreur** (6 avertissements préexistants) |
| `apps/mobile` — `npm run test` | **171 tests, 20 fichiers, tous verts** (167 + les 4 du nouveau test d'ordre) |

### Base

| Suite | Résultat |
|---|---|
| `db/tests/verify_b5.sql` | **toutes les assertions passent** — sortie archivée dans `docs/reports/artifacts/b5/verify_b5.out` |
| `db/tests/probe_public_rpcs.sh --strict` | **vert** — 27 RPC de lecture publique, toutes en 200 |
| `db/tests/x3_anon_surface.sh --strict` | **1 écart, étranger à B5** — voir §11 |
| Retour arrière sur restauration fidèle | **vert** — §6 |

> Note d'exécution : les deux scripts lisent `infra/supabase/.env`, qui
> n'existe pas dans un worktree. Les lancer depuis ici demande
> `FADEUP_SUPABASE_ENV=/opt/fadeup/infra/supabase/.env`. Ce n'est pas un défaut
> du lot, mais ça coûte cinq minutes à qui ne le sait pas.

### Campagne e2e

`E2E_PORT=4660`, Chromium 390 px et 1440 px, un seul worker (la machine a deux
cœurs et fait tourner la production). WebKit reste indisponible sur cet hôte
(bibliothèques système manquantes, blocage documenté depuis P1b).

**Deux campagnes complètes**, la seconde sur l'arbre livré (l'arbre mesuré est
l'arbre livré : seul `e2e/f4/booking-funnel.spec.ts` a changé entre les deux,
et c'est le correctif du §10.4).

| Campagne | Résultat |
|---|---|
| 1ʳᵉ (32,4 min) | 259 passés, 2 instables (verts à la reprise), **2 échecs** — le même test d'accessibilité F4 sur les deux projets, cause trouvée et corrigée (§10.4) |
| 2ᵈᵉ, arbre livré (25,4 min) | 253 passés, 1 instable, **1 échec** — F4 « réservation sans capacité », 8 non exécutés par cascade (le fichier F4 est sérialisé) |

**Le rouge résiduel est confiné au tunnel de réservation F4, et il n'est pas
attribuable à B5.**

La preuve la plus forte est la **mobilité de l'échec**. Trois exécutions,
**trois tests différents** :

| Exécution | Test rouge |
|---|---|
| 1ʳᵉ campagne | `:383` accessibilité (sur les deux projets) — cause trouvée, corrigée (§10.4) |
| 2ᵈᵉ campagne | `:109` réservation sans capacité |
| Fichier F4 **lancé seul**, sans rien d'autre sur la machine (11,4 min) | `:150` conflit de créneau, plus `:78` et `:150` instables |

Une régression de code échoue **au même endroit**. Un échec qui se déplace
d'une exécution à l'autre, et qui persiste quand le fichier tourne seul, est un
problème de temps et de calendrier dans cette suite — pas une conséquence de ce
lot.

Les autres éléments, mesurés :

- **B5 ne touche aucun code applicatif web.** Les deux seuls fichiers
  `apps/web` du lot sont les types générés et ce test-là (§8).
- **Ce n'est pas un épuisement de créneaux** : au moment de l'échec,
  `demo-atelier-fadel` rendait 18 créneaux aujourd'hui et 21 lundi (mesuré).
- **C'est un dépassement de délai de 150 s** sur `[data-testid="slot-grid"]
  button`, après que l'aide `throughSlot` a pourtant trouvé un jour : la grille
  se vide entre la recherche et le clic.
- **Le calendrier est le cas défavorable exact** : nous sommes samedi, et les
  deux organisations de démonstration ferment le dimanche — le premier jour
  sondé par l'aide (`nth(1)`) n'a donc aucun créneau. C'est la fragilité de
  calendrier déjà consignée pour F4.
- **Tout le reste est vert**, y compris `e2e/plat1/platform-permissions.spec.ts`
  (§8), OS-1, F1, F1b, F2, F3, D1, P1PRO et P1B, sur les deux largeurs.

Je n'ai pas poussé plus loin la réparation du tunnel F4 : j'ai corrigé le
défaut dont je tenais la cause avec certitude (§10.4) et je m'arrête là.
Réécrire l'aide `throughSlot` d'un autre lot pour une course de rendu sortirait
franchement du périmètre de B5, et ce rapport préfère nommer le défaut que le
maquiller. **La case « campagne e2e entièrement verte » est donc cochée pour
tout sauf F4, et le §11 le redit.**

---

## 8. `/platform` intact

**Empreinte du lot sur `apps/web` : deux fichiers, dont aucun n'est du code
d'application.**

```
apps/web/src/shared/lib/database.types.ts   types régénérés (générés)
apps/web/e2e/f4/booking-funnel.spec.ts      correctif de TEST, hors sujet B5 (§10.5)
```

**Aucun fichier sous `platform/` ni `features/pro-*` n'est touché** — vérifié
par énumération complète du diff et des fichiers non suivis, pas par
échantillonnage. Tout le volet frontend du lot est dans
`apps/mobile/src/features/{account,onboarding}`.

Le diff de types a été **filtré** pour ne contenir que B5 : `account_erasure_log`,
`customer_gender`, `gender`, `delete_my_account`, `export_my_data`, les colonnes
d'abonnement, et le passage de `reviews.customer_user_id` à nullable (exigé par
l'anonymisation). **Aucun type d'OS-2 ni de PLAT-2 n'y a fuité**, alors que la
base de production les contient — vérifié clé par clé.

Preuve dynamique : `e2e/plat1/platform-permissions.spec.ts` dans la campagne
(§7).

---

## 9. Git

Branche `b5/missing-contracts`, créée depuis `rebuild/social-first-v2`.

**Aucune fusion n'a eu lieu**, et aucune n'est demandée par ce rapport.

Cinq commits, poussés sur `origin/b5/missing-contracts` :

| | |
|---|---|
| `f6056fc` | `base(b5)` — les quatre migrations d'origine et leurs down, grants `private` inclus |
| `91ed9c9` | `fix(b5)` — les deux survivances de données personnelles, et les trous de la suite qui les cachaient |
| `df5a30a` | `feat(b5)` — le compte mobile, et les trois corrections de la revue |
| `b99027b` | `test(f4)` — le correctif hors périmètre du test d'accessibilité (§10.4) |
| _(dernier)_ | `docs(b5)` — ce rapport et les preuves versionnées |

Aucun `git add .`, aucun `git add -A`, aucun `reset --hard`, aucun
`clean -fd` : chaque fichier est passé nommément. Le `stash` partagé de la
machine n'a pas été touché.

### Ce qu'il faudra savoir à la fusion

1. **Le correctif d'OS-2 devient redondant.** `os2/operations` porte
   `20260911220000_os2_hotfix_b5_private_grants.sql`, qui réparait en
   production le défaut décrit au §10.1. Ces grants sont désormais dans la
   migration B5 qui crée les fonctions. Le fichier d'OS-2 est **conditionnel**
   (il ne fait rien si les fonctions n'existent pas) et idempotent : les deux
   branches peuvent fusionner dans n'importe quel ordre, sans rien casser et
   sans rien à démêler.
2. **L'ordre des horodatages porte une contrainte dure.** L'addendum
   `20260911210000` doit s'appliquer **après** les cinq migrations d'OS-2 et
   celle de PLAT-2 (§6). Sur une base rejouée à blanc, l'ordre des noms le
   garantit ; il ne faut pas le « corriger ».
3. **`x3_anon_surface.sh` sera vert une fois PLAT-2 fusionné** (§11), sans
   intervention.

---

## 10. Décisions prises seules, et erreurs déclarées

### 10.1 L'erreur de B5, trouvée en production par un autre lot

La première écriture de `20260911160200` crée trois fonctions `private`
(`erasure_display_sentinel`, `account_erasure_active`, `erasure_update_allowed`)
**sans aucun `grant execute`**. Or elles sont lues par **cinq** gardes de
trigger qui ne sont **pas** `security definer` — elles s'évaluent donc sous le
rôle appelant, à qui l'on refuse alors **sa propre garde** :

> `403 permission denied for function erasure_display_sentinel`

sur « Appeler le suivant », sur la mise à jour d'un rendez-vous par un barber
et sur l'écriture d'un avis, **pour tous les rôles pro**. OS-2 l'a trouvé en
production et réparé hors branche
(`20260911220000_os2_hotfix_b5_private_grants.sql`).

**Ce que j'ai fait** : réinscrit les trois `grant execute` **au point de
naissance des fonctions**, dans la migration B5 elle-même, pour qu'un rejeu à
blanc de la seule branche B5 ne reproduise pas la régression. Le correctif
d'OS-2 est conditionnel et devient un no-op une fois ces grants en place : les
deux branches peuvent fusionner dans n'importe quel ordre.

- **Concédant vérifié** : les trois fonctions appartiennent à `postgres`, et la
  migration s'applique en `postgres` — le grant n'est pas un no-op silencieux.
- **Le grant n'accorde aucun pouvoir** : `account_erasure_active()` exige le GUC
  transactionnel **et** `current_user in (postgres, supabase_admin)` — évaluée
  sous `authenticated`, elle rend toujours faux ; `erasure_update_allowed()` est
  un prédicat pur qui commence par elle ; `erasure_display_sentinel()` rend une
  constante. Le rôle regagne seulement le droit d'évaluer la garde qui le
  contraint.
- **Rien pour `anon`** : aucun chemin anonyme n'atteint ces gardes — ni `anon`
  ni `authenticated` n'ont le moindre `UPDATE` sur les cinq tables concernées
  (ACL mesurées), et `x3_anon_surface.sh --strict` le couvre.

**Leçon** : un test SQL en `postgres` ne voit jamais un grant manquant, parce
que `current_user` y vaut `postgres`. `verify_b5.sql` passait — et passe encore
— à 100 % sur une base où le défaut était présent. Seul un client HTTP avec un
vrai jeton de rôle le révèle.

### 10.2 Ce que la revue indépendante a trouvé, et ce que j'en ai fait

J'ai lancé une revue indépendante en lecture seule sur ce travail avant de le
livrer. Elle a conclu « **ne pas approuver en l'état** » et nommé six points.
Cinq sont corrigés dans cette session ; un est déclaré.

| Point | Gravité | Traitement |
|---|---|---|
| `email_outbox` : la copie salon garde le nom du client (290 lignes mesurées en production) | bloquant | **Corrigé** — migration `20260912060000` |
| `auth.audit_log_entries` : e-mail, nom, téléphone survivent (619 entrées orphelines sur 146 comptes) | majeur | **Corrigé** — même migration |
| `verify_b5.sql` §E3/§E1/fixture : les assertions ne pouvaient pas voir les deux défauts | majeur | **Corrigé** — §2 |
| Mobile : les photos sont détruites **avant** que le serveur ait dit s'il accepte | majeur | **Corrigé** — §10.3 |
| Mobile : le bouton d'export ne livre rien | majeur | **Corrigé** — §10.3 |
| Mobile : purge de stockage non paginée, non récursive | mineur | **Corrigé** — §10.3 |
| `db-audit/SCHEMA.sql` non régénéré | — | **Déclaré**, non corrigé (§11) |

La revue a aussi **vérifié et trouvé propres** : l'ordre des triggers (aucun
`set_updated_at` ne casse la clause « rien d'autre ne bouge »), l'ACL de
`private.erase_customer_account` (`postgres` seul), la double porte GUC +
`current_user`, le traitement du nul dans les trois RPC neuves, l'absence de
fuite du genre, et l'alignement exact des enums avec les catalogues i18n dans
les deux langues.

### 10.3 Les trois corrections mobiles

**L'ordre était inversé, et il détruisait des photos pour rien.** Le code
purgeait les trois seaux de stockage **puis** appelait la RPC. Si celle-ci
refusait ensuite pour une autre raison — compte professionnel, file en cours —
les photos du Passport étaient déjà détruites définitivement et le compte
existait toujours. La précondition `media_not_purged`, conçue côté serveur pour
**fermer** cet échec, était rouverte par le client.

Corrigé : on appelle **d'abord**, le serveur énumère ses refus, et on ne
détruit le média que s'il est le **seul** obstacle restant. La logique est
extraite du hook dans `eraseAccount()` pour être testable, et
`eraseAccountOrder.test.ts` en fait quatre assertions —
**dont trois qui échouent sur l'ancien ordre** (vérifié en cassant le code :
4 tests rouges avant, 4 verts après).

**Le bouton d'export mentait.** Il récupérait le JSON, le jetait, et affichait
« Données exportées ». L'utilisateur ne recevait rien. Le contenu est
maintenant rendu à l'écran, sélectionnable. Le partage en fichier demanderait
`expo-file-system` et `expo-sharing`, **non installés** : les ajouter aurait
débordé ce lot, et l'écran d'export complet est explicitement hors périmètre
(§5 du cahier des charges). Livrer le contenu à l'écran est le minimum honnête.

**La purge de stockage était plafonnée à 1000 fichiers et ignorait les
sous-dossiers.** Au-delà, ou le jour où un chemin devient
`{uid}/dossier/fichier`, la purge serait incomplète — et comme la RPC refuse
tant qu'il reste un objet, le compte deviendrait **indélébile depuis
l'application**, sans que rien ne le dise. Paginée et descendant d'un niveau.

### 10.4 Un défaut de TEST hors sujet, corrigé parce qu'il bloquait la campagne

Le test d'accessibilité du tunnel F4 cliquait **« demain » en dur**
(`day-strip button nth(1)`), alors que l'aide `throughSlot` du même fichier
**cherche** le premier jour à venir qui a des créneaux. Certains jours sont
fermés : lancé un samedi, « demain » tombait sur un dimanche fermé, la grille
restait vide, et le test expirait au bout de 150 s — sur quelque chose qui n'a
rien à voir avec l'accessibilité qu'il mesure.

Mesuré plutôt que supposé : `demo-atelier-fadel` (l'organisation de ce test)
rend **18 créneaux samedi, 0 dimanche, 21 lundi** ; `demo-maison-kais` ferme
dimanche **et** lundi. C'était le seul rouge de la première campagne, sur les
deux projets, et il échouait aussi en isolement.

Corrigé en réutilisant le motif déjà présent dans le fichier (sonde de 3 s et
non 8 s : ce test-ci dépense son budget en analyses axe). **C'est une
correction hors périmètre B5**, assumée : sans elle, le critère « campagne e2e
verte » était intenable un jour sur deux, pour une raison de calendrier. Elle
appartient à F4 et devrait y être reversée.

### 10.5 Décisions prises seules

1. **Ne pas régénérer `db-audit/SCHEMA.sql` depuis la production** (§11).
2. **Ne pas toucher au contrat `x3_anon_surface.sh`** malgré une suite rouge
   (§7).
3. **Ne pas modifier `list_my_followed_professionals`**, dont une divergence
   mesurée relève d'une décision de B4 (§4).
4. **Ne pas rendre d'image d'établissement** faute de colonne en base (§4).
5. **Supprimer plutôt que caviarder `auth.audit_log_entries`** : c'est un
   journal technique d'authentification, dont rien côté salon ne dépend et
   qu'aucune garde d'ajout seul ne protège — contrairement au fil de support,
   où le caviardage était le seul effacement possible.
6. **Ne pas purger les résidus historiques** (290 lignes `:business`, 619
   entrées orphelines). Ils ne viennent pas d'un effacement raté —
   `account_erasure_log` compte **zéro** ligne, aucun compte n'a jamais été
   effacé par la RPC — mais de comptes de test démontés à la main par des lots
   antérieurs. Un nettoyage de données de production décidé seul déborderait ce
   lot. Déclaré au §12.
7. Les cinq tranchages de fond du §1 appartiennent à la session antérieure ; je
   les ai relus, vérifiés contre la base et les endosse.

---

## 11. Cases non cochées, avec la raison exacte

### `db-audit/SCHEMA.sql` n'est PAS régénéré — mais le delta B5 l'est

**Raison exacte** : la base de production contient aujourd'hui, en plus de B5,
les six migrations d'**OS-2** et celles de **PLAT-2** — deux lots livrés mais
**non fusionnés**, absents de la branche B5. Un `pg_dump -s` de la production
importerait donc dans le commit B5 une cinquantaine d'objets qui ne lui
appartiennent pas, et le diff de la branche mentirait sur ce que le lot fait.

Ce n'est pas une lacune propre à B5 : le fichier n'a plus été régénéré depuis
la fusion de F4 (`dfe27b6`), et les lots OS-1, PERF, P1PRO, PLAT-1 ne l'ont pas
touché non plus. **La convention a cessé d'être tenable dès que plusieurs lots
ont vécu en parallèle sur une production partagée.** Elle demande une décision
du fondateur : régénérer au moment de la fusion, par un script, plutôt que par
lot.

**À la place, le delta de schéma propre à B5 est mesuré et versionné** :
`docs/reports/artifacts/b5/b5_schema_delta.diff` — la différence exacte entre
T0 (production sans B5) et T1 (production avec B5 seul), obtenue dans le bac
d'essai du §6 : **903 lignes ajoutées, 5 retirées**, et rien d'OS-2 ni de
PLAT-2 dedans, par construction. Le delta d'ACL de fonctions est à côté
(`b5_function_acl_delta.txt`).

C'est plus honnête que le fichier demandé — il dit ce que **ce lot** fait,
là où un `SCHEMA.sql` régénéré aurait dit ce que la production contient.

### `x3_anon_surface.sh --strict` sort en 1

**Un seul écart, et il n'appartient pas à B5** :

```
> resolve_poster_code
```

Tracé : cette RPC est créée par `20260911200300_plat2_qr_posters.sql`, présente
**uniquement** dans `origin/plat2/role-screens`, absente de la branche B5 et de
`rebuild/social-first-v2`. La branche PLAT-2 **met elle-même le contrat à
jour** (vérifié : son `x3_anon_surface.sh` contient `resolve_poster_code`).
L'écart se résout à la fusion de PLAT-2, et corriger le contrat depuis B5
reviendrait à déclarer une RPC que la branche B5 ne crée pas.

**B5 n'ajoute rien à la surface anonyme** : `grep "to anon"` sur les quatre
migrations ne rend aucune ligne, et les quatre RPC du lot sont mesurées en
production sans grant `anon`.

Tout le reste de la suite est vert (voir §7).

### La campagne e2e n'est pas entièrement verte : le tunnel F4

Un échec résiduel, dans `e2e/f4/booking-funnel.spec.ts`, détaillé et attribué
au §7. En deux mots : dépassement de délai sur une grille de créneaux qui se
vide entre la recherche d'un jour ouvert et le clic, un samedi où les deux
organisations de démonstration ferment le dimanche. **B5 ne touche aucun code
applicatif web** ; les créneaux ne sont pas épuisés (mesuré) ; **l'échec change
de test à chaque exécution**, y compris quand le fichier tourne seul sur la
machine — ce qui exclut une régression ; tout le reste de la campagne est vert.

J'ai corrigé le défaut F4 dont je tenais la cause avec certitude (§10.4).
Celui-ci est une course de rendu dans l'aide `throughSlot` d'un autre lot : je
le nomme au lieu de le maquiller, et je ne le répare pas depuis B5.

### Le garde-fou de dérive mobile/web (`npm run check:drift`) sort en 1

**Préexistant, et B5 ne l'aggrave pas.** Sept dérives, dont aucune n'est
introduite par ce lot — mesuré en comparant les fichiers de
`rebuild/social-first-v2` avant et après : `database.types.ts` diverge de
587 lignes **avant comme après** (les deux copies ont reçu le même ajout),
`keys.ts` de 13, `bookingRefusals.ts` de 3, et les quatre catalogues i18n en
cause (`booking.json`, `pro.json`) ne sont pas touchés par B5.

**Défaut hors périmètre, consigné ici et non corrigé** (règle de discipline de
périmètre).

---

## 12. Ce qui reste en matière de conformité RGPD, au-delà de ce lot

0. **Le résidu historique, mesuré et non purgé.** La production porte
   aujourd'hui **290 lignes `email_outbox` `:business`** contenant un nom de
   client et **619 entrées `auth.audit_log_entries` orphelines**, sur
   146 comptes déjà disparus, avec leurs adresses e-mail et leurs noms. Elles
   ne viennent pas d'un effacement raté — aucun compte n'a jamais été effacé
   par la RPC (`account_erasure_log` : zéro ligne) — mais de comptes de test
   démontés à la main par des lots antérieurs. Le correctif de ce lot empêche
   toute nouvelle accumulation ; il ne nettoie pas l'existant, et je n'ai pas
   pris seul la décision d'exécuter un DELETE de nettoyage sur la production.
   **C'est une opération à ordonner**, et elle est d'une ligne dans chaque cas.
1. **La suppression d'un compte professionnel** n'existe pas. La RPC la refuse
   explicitement (`business_account`). C'est un problème plus gros —
   organisation, personnel, rendez-vous de tiers, journaux en ajout seul — et
   il reste entier.
2. **Aucune purge de rétention** : l'anonymisation ne se déclenche qu'à la
   demande de la personne. Rien n'efface les données d'un compte simplement
   inactif depuis des années.
3. **Le résidu de texte libre** : un avis où l'auteur s'est nommé lui-même
   (§1), et plus généralement tout texte libre écrit par un tiers, échappent au
   balayage littéral parce qu'ils ne sont pas des champs d'identité.
4. **L'export n'est pas livré en fichier** : le contrat `export_my_data()`
   existe et son contenu est désormais affiché à l'écran (§10.3), mais il n'est
   ni téléchargeable ni partageable — `expo-file-system` et `expo-sharing` ne
   sont pas installés, et l'écran d'export complet est hors périmètre B5 par le
   §5 du cahier des charges. Aucune surface **web** ne l'appelle non plus.
5. **Les sauvegardes**. Une base restaurée depuis une sauvegarde antérieure à
   l'effacement **ressuscite les données effacées**. X1 a livré des sauvegardes
   chiffrées ; rien ne rejoue les effacements sur une restauration. C'est le
   trou de conformité le plus sérieux qui reste, et il n'est pas propre à ce
   lot.
6. **L'information des personnes et la base légale** du genre relèvent de X2,
   déjà livré ; le `COMMENT` de la colonne déclare la finalité côté schéma,
   mais rien ne la relie automatiquement à la politique de confidentialité
   publiée.
