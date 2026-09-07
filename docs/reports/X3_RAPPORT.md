# X3 — Durcissement de la surface publique : rapport final

Branche `x3/hardening` (depuis `rebuild/social-first-v2`), 2026-09-07.
Quatre migrations appliquées en production (14:30–14:33 UTC), retours
arrière prouvés sur restauration fidèle, ACL comparées privilège par
privilège. Aucune fusion. `/platform` intact.

Particularité de ce lot : le lot **F2** (`f2/public-profiles`) travaillait en
parallèle sur la même production. Contact établi de session à session avant
l'application, fenêtre convenue, F2 prévenu du nouvel invariant (grants
explicites) — voir §10.

---

## 1. Motif `NULL` dans les gardes d'autorisation

**Inventaire : 108 fonctions utilisant `auth.uid()`** (91 `public`,
17 `private`), chacune lue intégralement et munie d'un verdict, par quatre
passes d'audit indépendantes recoupées, plus une cinquième sur les
**343 policies RLS** (dont 49 utilisant `uid()`).

Verdicts fonctions : **101 SÛRES**, **1 VULNÉRABLE**, **6 DOUTEUSES**
(verdict par fonction : **`docs/reports/X3_INVENTAIRE_NULL.md`**). Les motifs sûrs
dominants : rejet `is null` en tête (11 fonctions), gardes déléguées à des
helpers `private.*` en `exists(...)` — qui rendent false, jamais NULL —
et filtres `where col = auth.uid()` échouant-fermé. Policies : **49/49
échouent-fermé** face à uid NULL (en RLS, un prédicat NULL refuse la ligne
par construction) ; l'audit des 343 a néanmoins trouvé un vrai défaut hors
motif NULL (§1.3).

### 1.1 LA vulnérable : `public.reschedule_appointment`

`v_is_customer := v_appointment.customer_id in (select c.id from customers
c where c.user_id = auth.uid())`. Pour un rendez-vous **walk-in**
(`customer_id` NULL — cas documenté du schéma), `NULL IN (ensemble non
vide)` vaut NULL, et `if not (false or NULL)` **ne lève pas**. Tout
utilisateur authentifié possédant une fiche client pouvait donc déplacer ou
réassigner le rendez-vous walk-in d'un salon tiers (SECURITY DEFINER,
notifications comprises) — la réplique exacte du défaut F1b §12.3, côté
rendez-vous. Corrigé par `coalesce(..., false)`
(`20260907170000`), prouvé par verify_x3 A1 (42501 pour l'étranger, chemins
salon et client intacts). Non exploitée : RPC absente de tout front déployé,
uuid non devinable, aucun utilisateur réel.

### 1.2 Les quatre gardes fail-open (DOUTEUSES → durcies)

`private.assert_organization_creation_authorized`,
`public.guard_customers_identity`, `public.guard_marketplace_publication`,
`public.guard_professional_application_update` partageaient l'échappatoire
volontaire `if auth.uid() is null then return new` (« session serveur »).
Or un client PostgREST **anonyme** a exactement uid NULL : la protection
reposait à 100 % sur l'absence de grants d'écriture — une défense à couche
unique, que X3 rend double : l'échappatoire refuse désormais les
rôles-claims `anon`/`authenticated` (`auth.role()`), et laisse passer psql
opérateur, service_role, restaurations et cascades FK. (Détail d'exécution :
dans un SECURITY DEFINER, `current_user` est le propriétaire — seul
`auth.role()` discrimine correctement.) Prouvé par verify_x3 C1–C5.

### 1.3 Corrigés au même titre (au-delà d'auth.uid, comme demandé)

- **`staff_profiles_insert` (policy RLS)** : l'EXISTS d'appartenance était
  **tautologique** (`m.organization_id = m.organization_id and m.user_id =
  m.user_id` — noms non qualifiés liés à `m` dans la migration d'origine) :
  un owner pouvait rattacher n'importe quel compte de la plateforme comme
  barber de son organisation (exploit prouvé dynamiquement en transaction
  annulée), lui ouvrant `is_own_barber` et les écritures qui en dépendent.
  Policy réécrite (membership réel exigé quand `user_id` est non NULL) +
  **nouveau trigger `private.enforce_staff_profile_identity`** sur la
  réassignation de `user_id` en UPDATE, qu'une policy ne peut pas voir
  (pas d'accès à OLD). verify_x3 B1–B5.
- **`post_likes_select_all`** (`using (true)`) : tout authentifié pouvait
  énumérer les paires (post, utilisateur) de posts qu'il ne peut pas voir →
  restreint à `user_id = uid() or can_view_post(post_id)`.
- **`queue_entry_moves_select` / `service_duration_samples_select`** :
  `to public` → `to authenticated` (sûres de fait, mais la policy ne doit
  pas dépendre de l'état des GRANTs).
- **`book_public_appointment` / `create_professional_interest_request` /
  `reschedule_appointment`** : un horodatage NULL traversait les gardes
  temporelles (rattrapé par accident par un NOT NULL en aval) → rejet
  explicite nommé.

### 1.4 Douteuses examinées, non modifiées (décisions)

- `create_organization` : `v_status` NULL (aucune candidature) traverse la
  garde de statut — **voulu** : la création self-serve est le chemin normal
  d'installation (`/auth/signup → /setup`) ; la garde ne bloque que
  pending/rejected.
- `handle_new_organization`, `analytics_trigger_actor`,
  `create_platform_invitation`, `create_prospect_discovery_job` : chemins
  NULL neutres ou rattrapés par contrainte, sous garde admin — laissés,
  consignés ici.

## 2. Privilèges : le compte avant et après

Avant (tables `public`+`storage`, rôle × privilège) :

| Rôle | TRUNCATE | TRIGGER | REFERENCES | MAINTAIN | SELECT/INSERT/UPDATE/DELETE |
|---|---|---|---|---|---|
| anon | 52 | 52 | 52 | 52 | 59/41/40/42 |
| authenticated | 85 | 85 | 85 | 88 | 136/80/71/75 |

Après : **0 / 0 / 0 / 0** pour les deux rôles (verify_x3 D1, en prod).
SELECT/INSERT/UPDATE/DELETE inchangés à une exception près :
`storage.buckets_analytics` (oubliée de B4, `anon=arwdDxtm`) alignée
lecture seule sur ses sœurs (`iceberg_*`, `s3_*`) — d'où 59/40/39/41 anon
après. Concédants vérifiés avant révocation : `postgres` (50-53 tables),
`supabase_admin` (34-35), `supabase_storage_admin` (storage) — REVOKE
exécuté en `supabase_admin` (superuser = agit comme le propriétaire de
chaque objet, propriétaire = concédant partout, mesuré), **zéro no-op**
(vérifié par re-lecture des ACL après chaque migration).

EXECUTE :

| Cible | Avant | Après |
|---|---|---|
| PUBLIC sur fonctions `private` (explicite+implicite) | 5 + 13 implicites | **0** |
| PUBLIC/anon/authenticated sur fonctions trigger (`public`+`private`) | 60×3 + 14 implicites | **0** |
| PUBLIC sur les 3 utilitaires publics (normalize_phone_number, suggested_*) | 3 | **0** (grants explicites anon/authenticated conservés — le front les appelle) |
| RPC `public` anon-exécutables | 38 (+3 F2) | **41**, inchangées une à une, consacrées en allowlist |

**Ce que j'ai laissé, et pourquoi** : les quatre verbes CRUD gouvernés par
RLS (périmètre du prompt) ; les EXECUTE explicites `authenticated` sur les
helpers `private` (has_org_role, queue_stage… — les policies et triggers
INVOKER en dépendent, F1 §10.1) ; les grants `prospect_worker` (Worker V2) ;
le grant anon sans objet sur `apply_appointment_no_show_rule` (INVOKER, RLS
le neutralise — consigné BLOCKERS §13.2 plutôt qu'élargir le périmètre).
Vérification préalable de chaque retrait : tous les appelants SQL des
fonctions révoquées sont SECURITY DEFINER (aucun rôle client n'en dépend au
runtime) ; le déclenchement des triggers ne vérifie pas EXECUTE — prouvé
empiriquement (verify_x3 B4) et par verify_f1b/e2e.

## 3. `pg_default_acl`

Contenait, pour `public` et `storage` (créateurs `postgres` ET
`supabase_admin`) : `arwdDxtm` pour anon/authenticated sur toute TABLE
neuve, EXECUTE anon/authenticated sur toute FONCTION neuve — la source des
trois découvertes B1/B2/B4 et du « toute fonction neuve EXECUTE » de F1b.
Aucune entrée pour `private` : les fonctions y naissaient PUBLIC-exécutables
par le défaut câblé de PostgreSQL.

Traité (`20260907173000`) : les quatre verbes retirés des défauts TABLES ;
EXECUTE anon/authenticated retiré des défauts FONCTIONS de public/storage ;
et — découverte de ce lot, mesurée au bac d'essai — **une entrée par-schéma
s'AJOUTE au défaut câblé sans pouvoir le retrancher** : retirer le
`PUBLIC=X` implicite exige un REVOKE **global** par rôle créateur, posé pour
`postgres` et `supabase_admin`. Effet de bord assumé et documenté : les
nouvelles fonctions d'un futur CREATE/ALTER EXTENSION ne seront plus
PUBLIC-exécutables (à re-granter si un chemin client en dépend).
Prouvé par verify_x3 E1–E4 : une table neuve naît sans les quatre verbes
(les verbes RLS-gouvernés préservés), une fonction neuve de public naît
sans EXECUTE client, une fonction neuve de private sans PUBLIC — pour les
deux créateurs. Resté ouvert : défauts des SÉQUENCES (BLOCKERS §13.3) et
des schémas Supabase-gérés (graphql*, supabase_functions), hors périmètre.

## 4. Propriété

Inventaire (production) : tables `public` 96 postgres / 34 supabase_admin,
`storage` 10 supabase_storage_admin ; fonctions `public` 227/25,
`private` 91/17. Doctrine écrite : **`docs/frontend/DB_OWNERSHIP.md`** —
`postgres` n'est pas superuser (mesuré), rôle d'application par défaut
`postgres`, vérification du `proowner` avant toute redéfinition, migration
ENTIÈRE en `supabase_admin` quand elle touche un objet `supabase_admin` ou
des grants storage, jamais de moitié de migration. **Uniformisation
REFUSÉE**, argumentée : transférer 42 fonctions SECURITY DEFINER d'un
superuser vers un non-superuser changerait leur sémantique d'exécution ;
storage appartient au service storage ; le coût du statu quo documenté est
faible. Transfert possible fonction par fonction, tracé, si un besoin réel
le justifie. BLOCKERS §9 marqué tranché.

## 5. La suite de tests anonyme — le livrable durable

**`db/tests/x3_anon_surface.sh [--strict]`** — une commande, via Kong :

1. **Contrat de surface** : la liste SQL des RPC anon-exécutables est
   comparée à l'allowlist consacrée (41 RPC) — toute dérive échoue.
2. Lectures publiques : délègue à `probe_public_rpcs.sh --strict`.
3. **Balayage des 130 tables en anon réel** : lecture (aucune ligne ne doit
   sortir — les lectures publiques passent par RPC DEFINER), écriture
   (POST/PATCH/DELETE : rien n'atterrit, prouvé par
   `Prefer: return=representation`).
4. **Ressource d'autrui en anon** : refus NOMMÉS
   (`fadeup_queue_refusal=entry_not_found`…), jamais un demi-succès.
5. **Le même balayage en authentifié SANS DROIT** : compte jetable créé
   (SQL), connecté (GoTrue), 130 tables lues (seuls les catalogues
   commerciaux et ses propres lignes d'identité sortent — liste consacrée
   commentée), écritures muettes, RPC d'autrui refusées (entitlements,
   billing, trial, move_queue_entry, reschedule), PATCH d'une organisation
   réelle → 200 avec 0 ligne ; compte supprimé (0 restant, vérifié).

État : **TOUT PASSE** contre la production durcie.
**Rétrospectivement** : le cas « ressource d'autrui, en anonyme réel et en
authentifié étranger » est exactement ce qui aurait attrapé la faille F1b
§12.3 avant qu'elle existe (leave_public_queue sur une entrée de compte), et
ce qui a attrapé `reschedule_appointment` dans ce lot. Le prochain lot
en hérite : ajouter sa RPC à l'allowlist est une décision visible en diff.

## 6. Données de test

Convention écrite : **`docs/frontend/QA_DATA.md`** — transaction+rollback
d'abord (le mode verify_x3/verify_f1b, zéro trace), sinon marquage AVANT
création (`qa-<lot>-*`, `@fadeup.test`, « ZZ dead »), réutilisation
(modèle `qa-f1b-shared`), neutralisation en fin de campagne ; l'exemption
des journaux append-only est REFUSÉE (un trigger d'intégrité à exceptions
n'est plus une garantie). Compte exact (production) : au début du lot, **72 organisations QA/mortes
sur 81** — 31 B1, 7 R5R-1a, 33 `qa-f1-*`, 1 `qa-f1b-shared` — plus 84
comptes `@fadeup.test`. Après les campagnes e2e de fin de lot (la mienne ET
celle de F2, simultanées) : **76 sur 85** — +2 `qa-f1-*` par campagne, le
motif connu de BLOCKERS §12.2, auto-neutralisées (« ZZ dead »). **Rien n'a
été supprimé** ; hors e2e, X3 n'a rien ajouté (verify en rollback ; le
compte jetable de la suite HTTP est créé puis supprimé à chaque run).

## 7. Migrations, avec retour arrière prouvé

| Migration (rôle : supabase_admin) | Contenu | Down testé |
|---|---|---|
| `20260907170000_x3_null_guard_fixes` | 7 fonctions corrigées, 3 policies, 1 trigger neuf | ✓ |
| `20260907171000_x3_table_privilege_hardening` | 4 verbes retirés partout + buckets_analytics | ✓ |
| `20260907172000_x3_function_execute_hardening` | PUBLIC/trigger/private EXECUTE | ✓ |
| `20260907173000_x3_default_acl_hardening` | défauts tables+fonctions, REVOKE global PUBLIC | ✓ |

Protocole : conteneur jetable même image, **restauration fidèle** du dump
`pre-x3-20260907-140110` (`pg_restore -U supabase_admin`, sans `--no-owner`,
0 erreur, propriétaires prouvés conservés) ; snapshot ACL normalisé T0
(`db/tests/x3_acl_snapshot.sql` : objet × bénéficiaire × privilège ×
**concédant**) ; up ×4 ; verify_x3 (24 assertions) + verify_f1b (A1–A11,
tout passe — la file survit au durcissement) ; down ×4 en ordre inverse ;
snapshot T2. **Diff T0/T2 : zéro ligne** au seul artefact documenté près —
34 fonctions à ACL NULL (défaut implicite) ressortent avec l'ACL
MATÉRIALISÉE équivalente (mêmes privilèges effectifs, mêmes concédants,
marqueur `(implicite)` seul différent). Corps des 7 fonctions et policies :
md5 identiques avant/après down ; trigger disparu. En production : dump
frais `pre-x3-apply-20260907-142957` pris juste avant l'application (la
base avait bougé — F2), puis up ×4, verify_x3 24/24 **sur la prod** (en
rollback), probe --strict 22/22, x3_anon_surface --strict TOUT PASSE.

## 8. `/platform` intact — preuve

Aucun fichier de l'app touché par ce lot hors `db/`, `db-audit/`, `docs/` et
`db/tests/` (git status du worktree ci-dessous, §9). Le conteneur
`fadeup-web` qui sert la production (dont les routes `/platform*`) est
**Up 6 days (healthy)** — jamais redémarré ni reconstruit par X3. Les RPC
plateforme conservent leurs grants (`get_my_access` etc., verify_x3 D4), et
la suite anonyme prouve que `assign_commercial_plan`/
`start_platform_support_session` restent refusées aux rôles sans droit.
`/opt/fadeup` (checkout de production) : aucun fichier modifié par X3 (ses
modifications préexistantes — settings, db-audit anciens — sont antérieures
au lot et pas de ma main ; seuls les dumps `backups/pre-x3-*` ont été
ajoutés, comme demandé).

## 9. Git

Branche `x3/hardening`, poussée sur `origin/x3/hardening`. **Aucune
fusion.** Aucun `git add .`/`-A`, aucun `reset --hard`, aucun `clean`.
Fichiers du lot : 4 migrations + 4 downs, `verify_x3.sql`,
`x3_acl_snapshot.sql`, `x3_anon_surface.sh`, `DB_OWNERSHIP.md`,
`QA_DATA.md`, `BLOCKERS.md` (§4 résolu, §9 tranché, §13 nouveau),
`SCHEMA.sql` régénéré, ce rapport. Huit commits :

| Commit | Contenu |
|---|---|
| `2c86e36` | fix(x3) : motif NULL — reschedule, gardes fail-open, policy staff_profiles |
| `543cfc3` | feat(x3) : révocations + ACL par défaut |
| `94e6442` | test(x3) : verify_x3, instantané ACL, suite de surface anonyme |
| `616ac46` | docs(x3) : DB_OWNERSHIP, QA_DATA, BLOCKERS |
| `3526ef5` | chore(x3) : SCHEMA.sql régénéré |
| `1011e43` | docs(x3) : inventaire NULL exhaustif |
| + 2 | docs(x3) : règle e2e partagée ; rapport final |

## 10. Décisions prises seules, et erreurs commises

Décisions :
1. **Durcir les quatre gardes fail-open** plutôt que documenter l'invariant
   de grants : la défense passe de une à deux couches, tous les chemins
   serveur préservés (prouvé C2/C3, cascades FK comprises).
2. **REVOKE global du EXECUTE PUBLIC par défaut** (pas seulement par-schéma,
   qui est additif et donc impuissant — mesuré) ; effet de bord extensions
   documenté.
3. **Réécrire la policy staff_profiles + trigger** (défaut hors motif NULL,
   mais exploit inter-utilisateurs prouvé : le laisser eût été indéfendable
   dans un lot de durcissement).
4. **`user_id` NULL reste permis** à l'INSERT staff (colonne nullable par
   conception, aucun flux client d'INSERT n'existe — vérifié dans le code).
5. **buckets_analytics** alignée sur la posture B4 (précédent approuvé).
6. **Coordination F2 en direct** : session parallèle détectée (2 RPC créées
   en prod APRÈS mon dump initial), contact de session à session, fenêtre
   convenue, F2 confirmant grants explicites et aucune migration en vol ;
   re-dump juste avant application.
7. `create_organization` self-serve laissé tel quel (chemin produit normal).
8. Le grant anon mort sur `apply_appointment_no_show_rule` consigné, pas
   révoqué (hors périmètre strict, RLS le neutralise).

Erreurs, déclarées :
1. Premier `x3_acl_snapshot.sql` : deux erreurs de typage SQL
   (`acldefault`, `"char"`) — le T0 du bac d'essai a dû être repris par une
   SECONDE restauration fidèle du même dump (base `b3_t0`), la comparaison
   finale est donc bien dump→dump, rien n'a été perdu.
2. Première version du down des fonctions : les 17 fonctions à ACL NULL
   manquaient (aclexplode les saute) — corrigé avant tout passage.
3. Première version de la migration défauts : le REVOKE par-schéma sur
   `private` était un no-op silencieux (sémantique additive découverte au
   bac d'essai, verify E2 l'a attrapé) — c'est LE genre d'erreur que ce lot
   pourchasse, et elle m'est arrivée aussi.
4. Fixture de la suite HTTP : `created_at` manquants dans
   `auth.users`/`auth.identities` → deux 500 GoTrue à blanc avant
   correction (aucune trace : les comptes ratés ont été supprimés).
5. La suite F1 e2e historique n'a PAS été relancée en entier (elle créerait
   2 organisations `qa-f1-*` de plus — QA_DATA règle 3) ; la couverture
   file/booking est assurée par verify_f1b (A1–A11, bac + à travers les
   RPC) et la campagne e2e F1b. Si c'est jugé insuffisant, dites-le.

## 11. Cases non cochées, avec la raison exacte

- **« npm run e2e vert — scénarios F1 et F1b compris »** — COCHÉE, avec un
  détour déclaré : la campagne complète (f1 + f1b + p1b, 2 projets Chromium)
  a donné 71 passés / 2 échecs F1b / 2 flaky / 8 non lancés (26,5 min) —
  parce qu'elle a tourné **simultanément avec la campagne e2e du lot F2**,
  sur le même dev server (port 4610, `reuseExistingServer`), la même base et
  la même organisation partagée `qa-f1b-shared` dont les tests mutent l'état
  (F2 l'a confirmé de session à session : ses instantanés d'échec montrent
  MES clients). Rejouée ISOLÉE, la suite F1b passe **22/22 en 4,5 min** ;
  `verify_f1b` (A1–A11) passe sur la base durcie ; aucune régression.
  Règle consignée d'un commun accord avec F2 : **une seule campagne e2e à
  la fois sur `qa-f1b-shared`**.
- **Playwright WebKit** — inchangé depuis P1b (BLOCKERS §2), hors de ce lot.
- Tout le reste des critères §7 du prompt est coché.

## 12. Ce qui reste ouvert avant un vrai utilisateur

1. **Fusionner et déployer** : la production sert toujours le build F1 ;
   les correctifs X3 sont en base (actifs), mais branches F1b/F2/X3 non
   fusionnées.
2. **BLOCKERS §13** : écritures anon latentes (~40 tables, RLS-neutralisées)
   à réduire table par table ; défauts des séquences ; grant anon mort sur
   `apply_appointment_no_show_rule`.
3. **`memberships_delete`** : un membre peut supprimer sa propre ligne même
   dernier owner — vérifier qu'un garde-fou existe (observation d'audit,
   non vérifiée à fond, hors périmètre).
4. Les restes F1/F1b déjà consignés (liens magiques en boîte réelle, second
   domaine d'envoi, push natif, service au join).
5. La suite anonyme est un contrat : **l'exécuter dans toute campagne de
   release** (`x3_anon_surface.sh --strict`), sinon elle ne protège rien.

---

## Annexe — vérifications finales

- `npm run typecheck` → 0 (tsc -b + tsconfig.v2).
- `npm run lint` → 0 (oxlint + eslint --max-warnings 0 + garde palette).
- `npm run test` → **605/605** (67 fichiers).
- `npm run build` (NODE_OPTIONS=3072M) → 0.
- `verify_x3.sql` → 24/24, sur restauration fidèle PUIS sur la production
  (transaction + rollback, zéro trace).
- `verify_f1b.sql` → A1–A11 tout passe, sur la base durcie.
- `probe_public_rpcs.sh --strict` → 22/22 lectures publiques en 200.
- `x3_anon_surface.sh --strict` → TOUT PASSE (contrat 41 RPC, 130 tables ×
  2 rôles × lecture/écritures, refus nommés, compte jetable retiré).
- `npm run e2e` → campagne complète 71 passés + 2 échecs par COLLISION avec
  la campagne F2 simultanée (cause prouvée, §11) ; suite F1b rejouée isolée :
  **22/22** ; scénarios F1 exécutés dans la campagne (les échecs ne les
  concernaient pas).
- `db-audit/SCHEMA.sql` régénéré (diff = correctifs X3 + RPC F2).
