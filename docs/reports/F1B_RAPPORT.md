# FadeUp — Rapport final F1b : files par barber, estimation apprise, et les trois manques de F1

Branche `f1b/queue-completion`, créée depuis `rebuild/social-first-v2`.
**Cinq migrations appliquées en production après sauvegarde, chaque retour
arrière testé sur restauration fidèle, ACL comparées à l'octet près. Aucune
fusion. `/platform` intact, preuve au §9.**

---

## 1. Files par barber — le modèle retenu

### Le modèle

Un établissement expose **une file par barber, plus « premier disponible »
en tête de liste**. En base :

- La position d'une entrée se calcule **dans sa file** :
  `row_number() partitionné par coalesce(barber_id, uuid-zéro)` dans
  `get_public_queue_status` et `get_my_queue_status` (la sentinelle uuid-zéro
  tient lieu de file « premier disponible » — aucun barber ne porte cet id).
- `list_public_queues(slug, location)` — nouvelle RPC anon — rend les files :
  « premier disponible » d'abord, puis chaque barber à file active, **triés
  par nombre de personnes en attente** (un fait, pas une prédiction), un
  barber sans attente et sans client au fauteuil passant devant. Zéro ligne
  pour un lieu inactif ou une zone de service.
- `barbers.queue_enabled` (défaut `true` — comportement F1 inchangé) : un
  apprenti ou un remplaçant peut ne pas avoir de file. Réglé par
  `set_barber_queue_enabled` (**owner ET manager** — « c'est le propriétaire
  qui gère », le manager étant son délégué d'exploitation ; décision au §12).
  Un barber sans file n'apparaît pas côté client, et `join_public_queue` le
  refuse par le motif **distinct** `barber_queue_disabled` (neuvième code de
  la convention `fadeup_queue_refusal`).

### Le cas « sans barber choisi », tranché et documenté

Une entrée sans `barber_id` appartient à **sa propre file** « premier
disponible » — elle n'est comptée dans la file d'aucun barber nommé, parce
qu'elle ne peut pas être dans une file et dans toutes à la fois. Ce qui rend
ce choix honnête est la **doctrine de service** documentée en base : *un
barber sert d'abord SA file, puis « premier disponible »*. Le premier de la
file d'Amine est ainsi réellement le prochain qu'Amine prend, et le nombre
affiché par file reste un fait pur.

Conséquence assumée : la position d'un client « premier disponible » est son
rang parmi les « premier disponible » — dans un salon où les files nommées
sont pleines, il attend plus que son rang ne le suggère. C'est pourquoi le
nombre est affiché par file et l'estimation en minutes de la file « premier
disponible » d'un salon multi-barbers est **NULL** (§2).

### Le déplacement et sa trace

- **Côté salon** : `move_queue_entry(p_entry_id, p_to_barber_id)` —
  propriétaire, manager, réceptionniste **et barber** (nouvelle aide
  `private.is_org_barber`, résolue depuis `auth.uid()`, jamais depuis un id
  fourni : en pratique c'est le barber qui dit « va chez Amine, il est
  libre »). Une entrée **en attente uniquement** (un appelé est déjà engagé).
  L'entrée **garde son `created_at`** : un client déplacé par le salon
  conserve son ancienneté dans la nouvelle file. Le trigger
  `restrict_queue_entry_self_update` — qui interdit à raison à un barber de
  changer `barber_id` en accès direct — apprend le drapeau transactionnel
  `fadeup.queue_move` (même motif que `fadeup.appointment_reschedule`).
- **Côté client** : `change_queue_entry_barber` — à SON initiative
  uniquement, **aucune proposition automatique** ; l'interface annonce la
  perte de place AVANT confirmation. Techniquement : l'entrée est **annulée
  et réinsérée** en fin de la nouvelle file — nouveau `created_at`, donc
  dernière position, sans jamais muter `created_at` (qui reste un fait de
  création). La présence n'est pas redemandée : elle a été prouvée au join
  d'origine, dans le même salon ; la porte (file ouverte, capacité,
  `queue_enabled`) est revérifiée AVANT d'annuler quoi que ce soit.
- **La trace** : table `queue_entry_moves` — qui (`moved_by`, NULL = client
  anonyme), quand, d'où (`from_barber_id`, NULL = premier disponible), vers
  où, `kind` (`staff_move` / `customer_change`), et `new_entry_id` pour la
  réinsertion d'un changement client. RLS forcée, lecture membres de l'org,
  écriture par RPC uniquement.

### Ce que le client voit du déplacement

Son écran de suivi (`get_queue_entry_tracking`, poll 6 s) détecte le
changement de file et l'affiche : « Vous êtes maintenant dans la file
d'Amine Deux », avec sa nouvelle position — prouvé en e2e sur deux
navigateurs (le barber déplace, l'écran client l'affiche sans geste).

### Interface

- **Client** (`/q/:slug`) : un salon **multi-barbers** montre le résumé
  (compte + état) puis la liste des files ; toucher une file ouvre le geste
  « rejoindre » sur CETTE file (la feuille nomme la file choisie) ; le CTA
  collant rejoint « premier disponible ». Un salon **solo garde l'écran F1
  d'origine** — proposer de « choisir » son unique barber serait du bruit
  (décision au §12). Sur l'écran de suivi : « Changer de barber » (registre
  secondaire, seulement s'il existe plusieurs files) et « Quitter la file ».
- **Pro** (`/dashboard/queue`) : l'attente se groupe **par file** dès que
  plusieurs barbers prennent la file (« PREMIER DISPONIBLE · n », puis
  chaque barber), position par file, action « Déplacer » par rangée ouvrant
  la feuille des files cibles. Réglages : interrupteur de file par barber
  (owner/manager) et balayage de grâce. Salon solo : liste plate F1
  inchangée.

## 2. Estimation — déclaré puis appris

### Ce que la collecte enregistre, et où

Table **`service_duration_samples`** (RLS forcée, lecture org, écriture par
triggers seulement), alimentée par deux triggers idempotents (contrainte
unique `(source, source_entry_id)`) :

- **File** : au passage à `completed`, la durée `service_started_at →
  completed_at` — deux horodatages posés PAR LE SERVEUR par
  `enforce_queue_transition`, jamais par un client. Une entrée sans service
  choisi ne produit pas de mesure (on ne sait pas ce qui a été coupé) ; une
  entrée terminée d'un coup depuis « appelé » non plus (durée zéro, garde
  `ended > started`).
- **Rendez-vous** : au passage à `completed`, la durée `starts_at (planifié)
  → completed_at (geste « Terminé »)`. **Approximation assumée et écrite
  dans le schéma** : aucun geste « commencer » n'existe sur un rendez-vous ;
  un « Terminé » cliqué très en retard produit une aberrante que
  l'estimateur écarte.

**Tout est enregistré, y compris l'aberrant** : la donnée sert le futur
modèle ; c'est l'estimateur qui filtre à la lecture. C'est cette collecte —
le vrai livrable du chantier — qui tourne dès aujourd'hui en production.

### La formule de bascule (`private.estimated_service_duration_minutes`)

- **Moins de 5 mesures valides** : la durée déclarée, telle quelle.
- **5 à 20** : moyenne pondérée, poids de l'observé `= (n-4)/16` — 6 % à
  n=5, 50 % à n=12, 100 % à n=20. Une seule coupe anormale ne fait pas
  dérailler l'affichage dès la deuxième prestation.
- **Au-delà de 20** : l'observé l'emporte.
- L'observé est une **moyenne mobile pondérée sur les 20 dernières mesures
  valides**, poids linéaires 20..1 (les récentes comptent davantage). Pas de
  modèle prédictif : ça se débogue et ça s'explique à un barbier.

### Seuils d'aberration et plafonnement

- **Aberrantes écartées à la lecture : hors [3 ; 240] minutes.** Moins de
  trois minutes est un double-clic « Terminé » ; plus de quatre heures est
  un « Terminé » oublié avant la pause. Ni l'un ni l'autre n'est une
  prestation (justification en commentaire de migration).
- **Écart plafonné à ±50 % du déclaré** : 30 min annoncées / 90 observées
  est plus probablement une erreur de pointage qu'une vérité — l'affichage
  est borné à [15 ; 45] et le dépassement est **SIGNALÉ au professionnel**
  (`estimate_capped` dans `get_service_duration_insights`, affiché « Écart
  plafonné » sur l'écran pro avec l'explication), jamais appliqué en
  silence. Justification du seuil : en deçà de ±50 %, la bascule progressive
  suffit ; au-delà, la probabilité d'erreur de mesure domine.

### Le repli en cascade — la preuve qu'aucune minute n'est inventée

Barber+service → salon+service (mêmes seuils) → durée déclarée → **NULL**.
Le temps d'attente d'une file (`private.queue_wait_minutes`) est la somme
des durées estimées des prestations en attente devant — **toutes doivent
être estimables, sinon NULL** — plus le reste **mesurable** de la prestation
en cours (service connu + début horodaté ; non mesurable : pas ajouté). La
file « premier disponible » d'un salon multi-barbers rend NULL (l'estimer
exigerait un modèle qu'on n'a pas) ; dans un salon solo elle est la vraie
file du lieu et se calcule en entier.

Preuves : `verify_f1b.sql` A6 (service inconnu → NULL ; aberrantes sans
effet ; plafond à 45 signalé) et A7 (« premier disponible » multi-barbers →
NULL) ; e2e « RIEN sans durée » (aucun « ≈ » affiché tant que les entrées
n'ont pas de service, puis « ≈ 60 min » = 2 × 30 déclarées une fois le
service posé) ; côté écran, l'unique porte d'affichage reste
`shared/lib/waitTime.ts` — `formatEstimatedWait(null) → null → rien`, testé.

### L'affichage

Arrondi **au multiple de cinq minutes supérieur** dans `formatEstimatedWait`
(loi partagée, testée) — promettre un peu plus et servir plus tôt vaut mieux
que l'inverse ; zéro reste zéro (une file vide est « sans attente », pas
« 5 min ») et n'est pas rendu. L'écran pro `/dashboard/queue/durations`
montre « annoncé / observé / n mesures » par barber et par service.

### Limite honnête, à connaître

Le join public **ne demande pas le service** (décision F1 : coût
d'interaction minimal, conservée). Une entrée sans service n'a pas de durée
estimable : l'estimation d'une file ne s'allume que quand ses entrées
portent un service (geste comptoir, ou un futur choix de service au join —
une ligne dans la feuille, BLOCKERS §12.1). La collecte, elle, tourne déjà
sur tout ce qui porte un service, file et rendez-vous.

## 3. Quitter la file

### Le modèle d'autorisation

`leave_public_queue(p_entry_id)`, SECURITY DEFINER, EXECUTE accordé à `anon`
et `authenticated` (vérifié, §7). Deux chemins, portés par
`private.queue_entry_client_access` :

- **Entrée anonyme** (kiosque, comptoir) : posséder l'uuid d'entrée EST la
  capacité — uuid non devinable, retourné au seul créateur par
  `join_public_queue` (le modèle du `claim_token` de B2).
- **Entrée de compte** (`booked_by_user_id` non NULL — c'est bien la colonne
  que la table porte, vérifié) : la capacité ne suffit pas, la session doit
  correspondre — avec le **`coalesce(... , false)` anti-NULL** : pour un
  appelant anonyme `auth.uid()` est NULL, « uuid = NULL » vaut NULL, et un
  `if not NULL` ne lève pas. Sans ce coalesce, un anonyme muni de l'uuid
  pouvait agir sur une entrée de compte — défaut de ma propre migration,
  **attrapé par la suite e2e** avant toute exposition réelle (§12.4),
  corrigé et couvert par `verify_f1b.sql`.

### Le cas « déjà appelé », tranché

**Oui, un client appelé peut quitter** — partir en prévenant vaut mieux que
partir sans rien dire, ciseaux en main ou pas. L'interface exige une
confirmation explicite dont le texte dit que le salon sera informé ; la base
accepte `waiting` ET `called` → `cancelled`, jamais depuis un terminal,
jamais depuis le fauteuil.

### Les nouveaux motifs de refus

`entry_not_found`, `not_entry_owner`, `entry_already_closed`,
`entry_in_service` — plus `entry_not_waiting`, `already_in_that_queue`
(changement) et `barber_queue_disabled` (join/changement) : **quinze codes**
au total dans `features/queue/lib/refusals.ts`, quinze clés, quinze textes
FR et EN réellement distincts, testés. L'accès est vérifié AVANT l'état : un
tiers n'apprend jamais l'état d'une entrée qui ne lui appartient pas.

Côté interface : bouton en registre secondaire (pas de vert plein),
confirmation avant (« revenir signifie repartir en fin de file »), état
honnête après avec une action — un état vide propose toujours une action.

## 4. Compte à rebours client

### L'option retenue

**La RPC dédiée** `get_queue_entry_tracking(p_entry_id)` plutôt que
l'extension de `get_my_queue_status` — parce qu'elle couvre le client
anonyme du mode kiosque, qui est précisément celui qui n'a aucun autre
canal. Même règle d'accès que « quitter ». Elle rend : position dans SA
file, personnes devant, **`called_deadline_at`** (échéance ABSOLUE UTC,
calculée serveur = `called_at` + grâce du lieu), estimation d'attente, et
`removed_automatically`. **La durée de grâce brute n'est jamais renvoyée** —
un client n'a pas à connaître le réglage du salon.

### La preuve qu'un tiers ne voit rien

- un uuid inconnu → `entry_not_found` (e2e contre l'API réelle) ;
- une entrée de compte consultée par un AUTRE compte → `not_entry_owner`
  (`verify_f1b.sql` A10) ;
- une entrée de compte consultée par un anonyme → `not_entry_owner`
  (le cas coalesce, `verify_f1b.sql` A9) ;
- une entrée anonyme n'est lisible que par qui possède l'uuid, communiqué au
  seul créateur.

### Côté interface

Le compte à rebours (m:ss, tick d'une seconde partagé `useNow`) ne s'affiche
**que** si l'échéance est présente ; sans échéance, l'appel reste le panneau
plein écran F1, sans minute — comportement préservé et testé en unitaire.
Échéance dépassée : **aucune valeur négative** — « Le délai est écoulé,
présentez-vous au comptoir, le salon décide » (unitaire + e2e avec recul
serveur de `called_at`). `DateTime`/`Duration` de P1b restent les seules
primitives de format ; le décompte m:ss utilise le même rendu mono
tabulaire.

## 5. Balayage de grâce

- **Réglage** : `location_service_settings.queue_grace_sweep_enabled`,
  **`false` par défaut** — sortir quelqu'un qui était aux toilettes est une
  mauvaise expérience, le patron décide. Posé par
  `set_location_queue_grace_sweep` (owner/manager), exposé à l'écran pro par
  `get_location_queue_check_in` (étendue — toujours interdite à `anon`),
  interrupteur à côté des réglages de file avec l'explication des deux faces.
- **Passe dédiée** : `public.run_queue_grace_maintenance()`, EXECUTE réservé
  à `fadeup_scheduler` (+`service_role`), refusé à `anon`/`authenticated`
  (vérifié). Appelée par `infra/scheduler/tick.sh` dans un **appel psql
  SÉPARÉ** des six passes existantes — une panne d'un domaine ne bloque pas
  un autre (règle B2). `FOR UPDATE SKIP LOCKED` : un « arrivé » cliqué au
  comptoir pendant le tick gagne toujours.
- **Idempotence, prouvée par redémarrage** : la transition `called →
  no_show` est terminale — la seconde passe rend 0 (`verify_f1b.sql` A11 ET
  e2e : `1` puis `0`) ; la notification est dédupliquée par la contrainte
  unique de `dedupe_key`.
- **Trace** : `queue_entries.auto_marked_no_show_at` — une sortie
  automatique est distinguable d'un « Absent » cliqué (vérifié dans les deux
  sens), et `get_queue_entry_tracking.removed_automatically` la porte
  jusqu'à l'écran client.
- **Notification sans reproche** : in-app `queue_grace_removed` (FR/EN selon
  la locale du profil) — « Vous avez été retiré de la file … le délai était
  écoulé », jamais « vous n'êtes pas venu » (l'e2e vérifie l'absence de
  formulation culpabilisante à l'écran aussi). Un client anonyme n'a pas de
  compte à notifier : son écran de suivi le lui dit — c'est son canal.
- **Production** : la fonction existe et ne fait rien (aucun salon ne l'a
  activée) ; le `tick.sh` de production n'exécutera la passe qu'à la fusion.

## 6. Migrations — liste et retour arrière testé

Sauvegarde AVANT toute application :
`/opt/fadeup/backups/pre-f1b-20260907-060039.dump` (pg_dump -Fc, 2,5 Mo).

| Migration | Contenu | Down testé |
|---|---|---|
| `20260907150000_f1b_duration_collection` | table `service_duration_samples` + 2 triggers de collecte + estimateur + `queue_wait_minutes` + `get_service_duration_insights` | ✓ |
| `20260907151000_f1b_barber_queues` | `barbers.queue_enabled` + `set_barber_queue_enabled` + partitions par file (`get_public_queue_status` avec `barber_id`, `get_my_queue_status`) + `list_public_queues` + refus `barber_queue_disabled` + `queue_entry_moves` + `is_org_barber` + `move_queue_entry` + drapeau du trigger de restriction | ✓ |
| `20260907152000_f1b_queue_notification_type` | valeur d'enum `queue_grace_removed` (fichier séparé, hors transaction — motif B4) | ✓ |
| `20260907153000_f1b_grace_sweep` | `queue_grace_sweep_enabled` + `auto_marked_no_show_at` + `set_location_queue_grace_sweep` + `get_location_queue_check_in` étendue + `run_queue_grace_maintenance` | ✓ |
| `20260907154000_f1b_client_exits_and_tracking` | `queue_entry_client_access` + `leave_public_queue` + `get_queue_entry_tracking` + `change_queue_entry_barber` | ✓ |

**Procédure de test, conforme au §1 du prompt** : bac d'essai
`b3_restore_sandbox.sh` — restauration **fidèle** du dump pre-f1b
(`pg_restore -U supabase_admin`, sans `--no-owner`, 0 erreur, propriétaires
conservés : 95 objets `postgres` / 39 `supabase_admin`). Ligne de base
capturée (ACL et propriétaires de TOUTES les fonctions et tables
public/private, colonnes des trois tables touchées), puis up ×5 →
`verify_f1b.sql` (12 groupes d'assertions, tout passe) → down ×5 dans
l'ordre inverse → **trois diffs vides** : fonctions/ACL identiques,
tables/ACL identiques, colonnes identiques. Le cycle a été prouvé **deux
fois** — la seconde avec les fichiers finaux (après les correctifs
`default null` et `coalesce`).

Deux pièges réels attrapés par la fidélité du bac d'essai :
- le down de l'enum devait sauvegarder/recréer **deux** fonctions dont la
  signature porte `notification_type` (`emit_booking_notification` ET
  `private.notify_social`, ajoutée par B4) — et restaurer l'ACL de la
  première (`{postgres=X}` : PUBLIC révoqué), sans quoi la recréation
  laissait `authenticated` l'exécuter via le défaut PUBLIC ;
- `min(uuid)` n'existe pas — corrigé avant toute application.

Avertissements honnêtes portés par les downs eux-mêmes : le retrait de la
collecte jette l'agrégat (re-dérivable des horodatages sources) ; le retrait
de `queue_entry_moves` jette un journal d'audit ; le retrait de
`auto_marked_no_show_at` rend les sorties automatiques passées
indistinguables.

## 7. Droits d'exécution vérifiés

Relevé APRÈS application en production (grantor = `postgres`, propriétaire —
leçon B4 du no-op silencieux) :

| Fonction | anon | authenticated | fadeup_scheduler |
|---|---|---|---|
| `list_public_queues` | ✓ | ✓ | — |
| `get_queue_entry_tracking` | ✓ | ✓ | — |
| `leave_public_queue` | ✓ | ✓ | — |
| `change_queue_entry_barber` | ✓ | ✓ | — |
| `move_queue_entry` | ✗ | ✓ | — |
| `set_barber_queue_enabled` | ✗ | ✓ | — |
| `set_location_queue_grace_sweep` | ✗ | ✓ | — |
| `get_service_duration_insights` | ✗ | ✓ | — |
| `get_location_queue_check_in` (recréée) | ✗ | ✓ | — |
| `get_public_queue_status` (recréée) | ✓ | ✓ | — |
| `run_queue_grace_maintenance` | ✗ | ✗ | ✓ |

Les aides `private.*` neuves (`is_org_barber`, `queue_entry_client_access`,
`observed_service_duration`, `estimated_service_duration_minutes`,
`queue_wait_minutes`) et les fonctions de trigger sont révoquées de
`public`, `anon` ET `authenticated` — le défaut PostgreSQL accorde EXECUTE à
PUBLIC sur toute fonction neuve, et le schéma `private` est accessible à
`authenticated` (c'est ainsi que le défaut `queue_stage` de B1 a pu exister).
Les deux tables neuves : `revoke all` de `anon` et `authenticated`, puis
`grant select` seul à `authenticated` (RLS forcée par-dessus) — jamais les
`arwdDxtm` des ACL par défaut (BLOCKERS §4). La leçon F1 (`queue_stage`) a
été appliquée en amont : chaque fonction appelée depuis PostgREST a ses
droits posés par la migration qui la crée, et `probe_public_rpcs.sh` passe.

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (tsc -b + tsconfig.v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **0 erreur** |
| `npm run test` (Vitest) | **605/605**, 67 fichiers — dont les quinze refus (codes, clés, textes FR/EN distincts), l’arrondi à cinq minutes vers le haut (zéro reste zéro), la garde anti-négatif du compte à rebours, les états de sortie (automatique ≠ manuel, sans reproche), l’avis de déplacement, « Changer de barber » absent en file unique |
| `npm run e2e` (Chromium 390 px et 1440 px : p1b + F1 + F1b) | **84 scénarios : 0 échec** — 80 passés, 3 passés à la reprise (aléa de langue du premier rendu, assertion rendue agnostique puis re-passée 11/11 sans reprise), 1 sauté pré-existant. F1 : **22/22** (non-régression tenue). F1b : 11 scénarios × 2 largeurs. `/platform` re-sondé à 200 après campagne |
| axe-core | aucune violation sérieuse ou critique — `/q` liste des files (nouveau test F1b, deux largeurs) + cibles p1b/F1 existantes |
| Chunk d'entrée consumer | **≈ 84 Ko gzip** (index 27,1 + vendor-react 56,4) — budget 180 Ko tenu ; `PublicQueuePage` en chunk paresseux de 7,7 Ko gzip |
| `probe_public_rpcs.sh --strict` | **23 RPC publiques, toutes 200** (la 23ᵉ est `list_public_queues`, ajoutée à la sonde) |
| `verify_f1b.sql` (bac d'essai fidèle) | **12 groupes, tout passe** — positions par file, tri, refus, déplacement + trace + ancienneté, changement client, seuils 5/20, aberrantes, plafond signalé, NULL honnête, collecte file ET rendez-vous, capacité/propriété/appelé/terminal, échéance serveur, tiers ET anonyme refusés, balayage off par défaut/idempotent/tracé/notifié |
| `database.types.ts` | régénéré (postgres-meta), 10 787 lignes — diff purement additif |
| `db-audit/SCHEMA.sql` | régénéré depuis la production |
| WebKit | non exécutable sur cet hôte (BLOCKERS §2, inchangé) — projets prêts derrière `P1B_WEBKIT=1` |

**Vérification navigateur réelle** (exigence CLAUDE.md), sur l'organisation
partagée réactivée puis re-neutralisée : captures à **390, 430 et 1440 px**
de `/q` (liste des files : « Premier disponible » en tête, tri du plus court
au plus long, « ≈ 30 min » uniquement sur la file dont l'entrée porte un
service — aucune minute ailleurs), de `/dashboard/queue` (groupes par file,
« Déplacer » par rangée, réglages balayage + files par barber) et de
`/dashboard/queue/durations` (état vide avec action) — **zéro erreur
console, zéro requête en échec** sur l'ensemble du parcours. La pastille
flottante en bas à droite des captures est le bouton des TanStack Query
Devtools, DEV uniquement, absent du build de production.

La suite RLS/refus exigée par le §7 du prompt vit dans `verify_f1b.sql`
(quitter/consulter/déplacer la place d'un autre refusés, anonyme sans le bon
identifiant refusé) ET en e2e contre l'API réelle via Kong (mêmes refus,
depuis l'extérieur). Détail appris au passage : PostgREST rend un SQLSTATE
42501 comme **401** au rôle `anon` (403 à `authenticated`) — les tests
acceptent les deux, le code de refus nommé faisant foi.

## 9. `/platform` intact — preuve

- `git diff --name-only $(git merge-base HEAD rebuild/social-first-v2)` :
  **zéro** fichier sous `src/pages/`, `src/routes/`, `src/components/`,
  `src/lib/` (les surfaces legacy).
- Production : `GET http://127.0.0.1:15180/platform/login → 200`.
- La recherche publique de production rend exactement ses **9 lignes
  légitimes** — aucune fixture QA n'a atteint la marketplace (l'organisation
  partagée F1b naît et reste `marketplace_visible=false`).
- Aucune migration ne touche un chemin `/platform` : additives sur le
  domaine file (colonnes nouvelles, fonctions nouvelles, deux recréations de
  RPC à périmètre identique + un champ), et le trigger de restriction ne
  change que par un early-return sous drapeau posé par une RPC autorisée.

## 10. Organisations de test — le compte exact

- **F1b crée UNE organisation** : `qa-f1b-shared`, créée une seule fois par
  le VRAI parcours `/setup`, puis **réutilisée par tous les tests et toutes
  les exécutions** (réactivée au début de suite, neutralisée « ZZ dead » à
  la fin — nom, file fermée, lieu inactif, balayage off, entrées annulées,
  jamais visible marketplace). Plus **deux comptes auth** réutilisés
  (`qa-f1b-shared@` et `qa-f1b-barber@fadeup.test`) et deux barbers de
  fixture dans cette organisation. C'est la réponse à la leçon des 29
  organisations de F1 : le compte F1b n'augmentera plus jamais.
- **La suite F1 historique, elle, crée 2 organisations `qa-f1-*` par
  campagne complète** (une par projet Chromium — son premier test EST le
  parcours d'installation, qui exige un compte neuf). Les campagnes de ce
  lot en ont créé **4** (deux campagnes complètes × 2 — état final : **33** `qa-f1-*`, toutes « ZZ dead », zéro lieu actif, vérifié), toutes neutralisées par leur `afterAll`. Réécrire ce test pour
  borner l'accumulation est consigné en BLOCKERS §12.2 — pas fait en
  contrebande dans ce lot.
- Rien n'est supprimable (journaux append-only, contrainte assumée depuis
  B1) ; rien de tout cela n'apparaît dans la recherche publique (vérifié).

## 11. Git

- Branche : `f1b/queue-completion`, créée depuis `rebuild/social-first-v2`,
  poussée (`origin/f1b/queue-completion`).
- **Aucune fusion n'a été effectuée.** Aucun `git add .`/`-A`, aucun
  `reset --hard`, aucun `clean`, aucun `docker prune`.
- Commits :

| Commit | Contenu |
|---|---|
| `2d70ddd` | base — 5 migrations + downs + `verify_f1b.sql` + sonde RPC + dump schéma + types |
| `40ee80d` | face client — files par barber, suivi enrichi, quitter, changer, compte à rebours |
| `d270f09` | face pro — files groupées, déplacement, réglages, durées apprises |
| `17e4fbf` | scheduler — passe de balayage, appel séparé |
| `f361ca8` | e2e F1b — organisation partagée unique |

(BLOCKERS + le présent rapport forment le commit suivant, poussé avec le
reste avant tout affichage — trois rapports de cette série ont été perdus
faute de l'avoir fait.)

## 12. Décisions prises seul — et toute erreur commise, déclarée

### 12.1 Décisions

1. **La doctrine de service** « un barber sert d'abord sa file, puis
   premier disponible » — le prompt exigeait de trancher le cas « sans
   barber » ; cette doctrine est ce qui rend les positions par file
   honnêtes, elle est écrite dans les commentaires de schéma et ici.
2. **Estimation de la file « premier disponible »** : NULL en salon
   multi-barbers (l'estimer exige un modèle de parallélisme qu'on n'a pas —
   RIEN plutôt qu'une invention) ; calculée en salon solo (elle est la vraie
   file du lieu).
3. **Changement client = annulation + réinsertion** plutôt que mutation de
   `created_at` (qui reste un fait de création) ou colonne d'ordre nouvelle
   (chantier « réorganisation » explicitement hors périmètre). Corollaire :
   l'historique garde les deux entrées, liées par la trace.
4. **Déplacement salon = ancienneté conservée** (le client n'a rien
   demandé) ; **changement client = fin de file** (il choisit, il paie sa
   place) — le prompt fixait le second, le premier est mon choix, tracé.
5. **Un appelé ne « change » pas de barber** (`entry_not_waiting`) : il est
   attendu quelque part ; il peut quitter, puis revenir par la porte
   normale. De même un déplacement salon ne touche qu'une entrée en attente.
6. **`set_barber_queue_enabled` et le balayage : owner ET manager** — le
   prompt dit « c'est le propriétaire qui gère » ; le manager est partout
   ailleurs son délégué d'exploitation (mode de service, ouverture de file),
   l'en exclure aurait été une exception sans précédent.
7. **Salon solo : écran F1 conservé** — une liste de files à une seule file
   nommée est du bruit ; la loi « une file par barber » ne prend son sens
   qu'à plusieurs.
8. **`p_to_barber_id default null`** ajouté aux deux RPC de
   déplacement/changement APRÈS leur première application (re-`CREATE OR
   REPLACE` en production, signatures d'identité inchangées) : les types
   générés exigeaient sinon un uuid non-nullable, et « vers premier
   disponible » se dit `null`.
9. **Le service n'est toujours pas demandé au join** (décision F1
   conservée) — conséquence documentée au §2 et en BLOCKERS §12.1.

### 12.2 Erreur grave évitée de justesse, déclarée : le stub en production

En corrigeant le point 8 ci-dessus, un heredoc d'échafaudage a ÉCRASÉ
`public.move_queue_entry` en production par un stub retournant NULL, pendant
environ une minute, avant réapplication immédiate de la vraie définition
(SECURITY DEFINER et ACL revérifiés à l'appui). Exposition réelle : nulle —
la production sert l'ancien build F1, aucun code déployé n'appelle cette
RPC. Mais c'est exactement le genre de commande qui n'aurait jamais dû
contenir un `create or replace` exécutable, et je l'écris ici pour cela.

### 12.3 Défaut d'autorisation dans MA migration, attrapé par l'e2e, corrigé

La première version de `queue_entry_client_access` comparait
`booked_by_user_id = auth.uid()` sans coalesce : pour un appelant ANONYME le
résultat est NULL, et `if not NULL` ne lève pas — un anonyme muni de l'uuid
pouvait quitter/consulter/changer une entrée DE COMPTE. La suite e2e F1b l'a
attrapé (le test « quitter la place d'un autre » a réussi à quitter),
correctif appliqué en production dans l'heure, `verify_f1b.sql` durci du cas
anonyme. Fenêtre d'exposition : environ une heure, RPC qu'aucun front
déployé n'appelle, et l'exploitation exigeait de posséder l'uuid d'entrée
(non devinable). La leçon qui reste : mes tests SQL simulaient toujours UNE
session ; c'est le client réel anonyme qui a montré le trou.

### 12.4 Autres erreurs corrigées en route

- `min(uuid)` dans `queue_wait_minutes` (attrapé au premier passage du bac
  d'essai) ; deux tests `verify_f1b` mal ordonnés (claims anonymes là où le
  propriétaire devait consulter) — corrigés, la suite passe entière.
- Le `.env.example` du worktree annonce `VITE_SUPABASE_PUBLISHABLE_KEY` ;
  la vraie variable est `VITE_SUPABASE_ANON_KEY` (une demi-heure de dev
  server en erreur ; l'exemple est resté tel quel — hors périmètre, signalé).

## 13. Cases non cochées, avec la raison exacte

- **« Vitest : calcul de la bascule progressive aux trois seuils, écarts
  aberrants écartés, plafonnement »** — NON COCHÉE TELLE QUELLE. La formule
  vit en SQL (`private.estimated_service_duration_minutes`) ; la dupliquer
  en TypeScript pour la tester en Vitest serait tester une copie, pas le
  produit. Ces quatre exigences sont couvertes déterministiquement par
  `verify_f1b.sql` A6 (n=0/4/5/25, aberrantes, plafond signalé, NULL) sur la
  restauration fidèle, et par l'e2e « moins de cinq mesures → durée
  déclarée » contre la base réelle. Vitest couvre ce qui vit côté client :
  arrondi à cinq minutes, garde anti-négatif, quinze refus.
- **« Playwright, WebKit »** — inchangé depuis P1b : bibliothèques système
  absentes, root requis (BLOCKERS §2). Chromium 390/1440 couvre tout.
- **Notification du balayage pour un client SANS compte** — impossible par
  construction (pas de canal) : son écran de suivi est le canal, et il le
  dit sans reproche. Cochée dans sa substance, dite ici pour l'exactitude.
- **Réorganisation manuelle de l'ordre d'attente** — hors périmètre,
  explicitement (F1b §0) ; rien n'a été simulé.

## 14. Ce qu'il manque encore pour installer dans un vrai salon

1. **Fusionner et déployer** : la production sert le build F1 — les files
   par barber, quitter, le compte à rebours et l'écran de balayage
   n'existent que sur cette branche. La passe de balayage ne tournera qu'au
   déploiement du `tick.sh` (recréation du conteneur scheduler). La clé anon
   périmée de `/opt/fadeup/apps/web/.env.local` (constat F1, hors de mon
   périmètre d'écriture) reste à corriger au déploiement.
2. **Demander le service au join** (une ligne dans la feuille « rejoindre »)
   pour allumer l'estimation des files publiques sans dépendre du comptoir —
   BLOCKERS §12.1. La collecte et l'estimateur n'attendent que ça.
3. **Les restes de F1, inchangés** : réception réelle des liens magiques
   (validation fondateur en boîte), second domaine d'envoi, push mobile
   natif (aujourd'hui Notification API du navigateur).
4. Ce qui n'attend RIEN après fusion : un barbershop à trois fauteuils peut
   couper la file de l'apprenti, laisser chaque client choisir son barber ou
   « premier disponible », déplacer un client d'une file à l'autre (tracé),
   voir ce que FadeUp a appris de ses durées ; et un client peut choisir,
   suivre SA file, changer de barber en connaissance de cause, quitter
   proprement, voir son échéance après appel — et être sorti automatiquement
   après grâce si (et seulement si) le salon l'a choisi.

---

**Aucune fusion n'a été effectuée. Fin du rapport.**
