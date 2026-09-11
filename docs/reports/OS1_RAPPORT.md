# OS-1 — Rapport final : l'agenda professionnel

Branche `os1/agenda` (worktree dédié, depuis `rebuild/social-first-v2` à
`3a0f5e4`), 2026-09-11. Contrat de design en vigueur :
`docs/design/P1PRO_DESIGN_CONTRACT.md` (non rediscuté). Écran livré :
`/dashboard/agenda` (`apps/web/src/features/pro-agenda`), derrière la
capacité réelle `booking`.

**Captures** (`docs/reports/artifacts/os1/`, 390 et 1440, en français,
données réelles créées par la RPC du comptoir sur l'organisation QA
partagée, produites par `apps/web/e2e/os1/captures.mjs` après la campagne
e2e) : `day-*` (vue jour, colonnes par barber), `day-viewport-1440` (ce
qu'un écran de 900 px montre d'un coup), `week-*` (semaine par ressource),
`drag-*` (glisser en cours, fantôme + aperçu de dépôt), `conflict-*`
(avertissement de conflit, motif saisi), `conflict-390-avant-correctif-
modale` (le défaut de centrage des modales trouvé par ce lot, §10),
`block-sheet-*` (blocage de temps récurrent), `sheet-forced-*` (fiche d'un
rendez-vous forcé, « Terminé » en un geste), `barber-no-revenue-*` (agenda
du barber salarié : ni sélecteur, ni montant, ni bouton de création),
`empty-*` (agenda vide), `platform-login-1440` (preuve `/platform`, build
de production). Limite d'outil : les champs `date`/`time` natifs
s'affichent au format de la langue d'interface de Chromium headless
(anglais), pas de celle de la page — sur un appareil francophone ils sont
en français.

---

## 1. La tension aération / ressource — comment elle est résolue

Le fondateur a tranché deux choses qui s'opposent : « aéré, quitte à
défiler » et « semaine par ressource, plusieurs barbers côte à côte ». Une
grille horaire à 7 jours × N barbers ne tient pas : à 1440 px avec la
latérale, quatre barbers donnent 28 colonnes de 38 px.

**La décision, la plus structurante de l'écran :**

- **Vue jour = la grille horaire.** Heures en ordonnée (96 px par heure :
  une prestation de 30 min fait 48 px, huit heures tiennent dans un écran
  de 900 px, le reste défile), une colonne par barber côte à côte, largeur
  minimale 160 px, défilement horizontal au-delà. C'est ici que le temps
  se lit et se déplace finement (glisser vertical = changer l'heure,
  horizontal = changer de barber).
- **Vue semaine par ressource = barbers en COLONNES côte à côte, jours en
  BANDES empilées.** Chaque cellule (barber × jour) liste ses rendez-vous
  en rangées compactes (heure en mono, prénom, prestation, 44 px de
  hauteur) triées par heure, et ses blocages hachurés. Colonne ≥ 200 px ;
  au-delà de la largeur disponible, défilement horizontal. Le glisser
  entre cellules déplace au jour et au barber ciblés **à la même heure** ;
  changer l'heure se fait en vue jour ou par « Déplacer » dans la fiche.
- **Le filtre limite les barbers affichés.** En desktop, des puces (« Toute
  l'équipe » / un par barber, au moins un), mémorisées par organisation.
  Le patron de six barbers en affiche deux ou trois côte à côte et garde
  l'air. En mobile, le sélecteur est un Select à choix unique : une seule
  colonne, jour comme semaine (« même si serré » : ça reste lisible parce
  qu'on ne serre pas — on montre un barber à la fois).
- **Le régime dense du contrat (§3) tient à l'intérieur des objets** :
  rangées 44 px, filet fin, méta en secondaire ; **l'aération fondateur
  tient dans l'échelle** (96 px/h, cellules de semaine sans compression).

Ce qui est sacrifié, et assumé : la vue semaine n'est pas une grille
horaire (on n'y voit pas les trous à la minute près — la vue jour est là
pour ça), et un salon de sept barbers défile horizontalement en semaine.

## 2. Le forçage — le chemin, la trace, les rôles

**Vérifié avant de coder** : `reschedule_appointment` et
`book_public_appointment` n'avaient aucun chemin de forçage (ni paramètre,
ni GUC, ni exception) ; l'exclusion GiST `appointments_barber_no_overlap`
était l'arbitre absolu, et les écritures directes sur `appointments` sont
révoquées depuis X3 (`authenticated` : SELECT/DELETE seulement).

**Le chemin retenu : un paramètre explicite, jamais un contournement.**
`reschedule_appointment(…, p_force boolean default false, p_force_reason
text default null)` (DROP + CREATE, une surcharge aurait rendu PostgREST
ambigu) et la RPC neuve `create_appointment_as_business(…, p_force,
p_force_reason)`.

**Le mécanisme.** Une contrainte d'exclusion est symétrique ; un forçage
asymétrique (le forcé chevauche, personne ne vient chevaucher le forcé) se
construit en deux temps :
1. le prédicat de la contrainte exclut les lignes forcées
   (`overlap_forced_at is null`) — une ligne forcée sort de l'index ; les
   lignes ordinaires restent arbitrées entre elles exactement comme avant ;
2. le trigger `appointments_check_forced_overlap` (BEFORE INSERT/UPDATE)
   refuse à toute ligne ordinaire de se poser sur une ligne forcée du même
   barber (SQLSTATE `23P01`, motif nommé `slot_conflict` — le même que la
   contrainte). Sans lui, un créneau forcé serait une brèche.

Un forçage sans conflit réel n'est pas un forçage (la RPC ne pose la trace
que si un chevauchement existe au moment du geste) ; un déplacement
ordinaire d'une ligne forcée efface la trace (la ligne rentre dans l'index,
la contrainte arbitre la destination). `get_available_slots` continue de
compter le forcé comme occupé (vérifié, O4c).

**La trace : qui, quand, pourquoi.** Sur la ligne (`overlap_forced_at`,
`overlap_forced_by`, `overlap_forced_reason` — motif obligatoire, 200
caractères, contrainte de cohérence) **et** dans le journal
`appointment_overlap_forces` (action create/reschedule, auteur, motif,
plage, identifiants des rendez-vous recouverts), lisible par les rôles
gestionnaires, jamais écrit par un client. L'interface montre la trace :
badge rouge « Forcé » sur la carte (jamais la couleur seule), motif dans
la fiche.

**Les rôles.** Owner et manager forcent. **Le réceptionniste ne force pas**
— tranché ici : il crée et déplace (`can_manage_appointments`), mais
surcharger un barber est une décision de direction ; il voit le même
avertissement avec « Choisir un autre créneau » seulement. Le barber ne
déplace pas du tout (RPC : `not_authorized`). Le client ne force jamais.
Garde SQL : `private.can_force_overlap` (owner/manager) ; miroir écran :
`permissions.ts`, testé.

**Ce qui ne se force PAS : un temps bloqué.** `check_appointment_time_blocks`
(fonction `supabase_admin`) reste une garde dure. Un blocage est la propre
indisponibilité déclarée du pro ; le dialogue le dit et propose de le
retirer ou de choisir un autre créneau. Décision OS-1, déclarée §10.

**L'avertissement vient AVANT le geste** : `findConflicts` (pur, testé)
applique la règle du serveur (plages tampons comprises, cancelled/no_show
exclus, **les lignes terminées retiennent leur créneau** — piège P1PRO) sur
les données chargées ; le serveur reste l'autorité (un conflit de course
remonte en `slot_conflict`).

## 3. La permission de revenu — où elle vit, comment le patron la règle

**Elle vit sur `memberships.can_view_revenue boolean not null default
false`.** Pourquoi là et pas sur `barbers` ni dans une table de
permissions : la permission concerne une PERSONNE connectée (un compte
membre), pas un fauteuil — un barber sans compte (fiche staff seule) n'a
rien à voir ; `memberships` porte déjà le rôle, est lue par le contexte
pro et publiée en realtime (le réglage se propage sans rafraîchir) ; une
table de permissions pour un seul booléen serait une abstraction
parallèle (CLAUDE.md : pas de système d'autorisation parallèle).

**Le défaut est « ne voit pas ».** Owner et manager voient toujours ; le
réglage n'a d'effet que sur le rôle `barber` ; le réceptionniste ne voit
jamais les montants (contrat P1PRO §8, inchangé).

**Le patron la règle** par `set_membership_revenue_visibility(membership,
visible)` — **owner seul** (le manager est refusé, 42501 ; une cible non
barber est refusée, 22023) — depuis l'agenda : le bouton d'équipe ouvre la
liste des barbers avec un interrupteur « Voit le revenu du salon » par
membre (les fauteuils sans compte sont dits « Sans compte »). OS-2 pourra
reprendre le même interrupteur sur l'écran Équipe.

**Le masquage n'est pas qu'à l'écran** : `get_calendar_appointments` renvoie
`price_cents` NULL (jamais zéro) à qui ne voit pas le revenu
(`private.can_view_revenue`). Côté écran, un barber sans permission n'a
AUCUN montant dans son DOM (ni revenu du jour, ni prix sur les cartes, ni
prix dans les feuilles) ; avec la permission il voit le prix des
prestations et le revenu calculé. Les prix du catalogue restent lisibles
sur l'écran Catalogue par tout membre (c'est du tarif public, pas du
revenu) — déclaré.

## 4. La collecte des durées — ce qui est enregistré quand on marque terminé

Vérifié : `appointments` porte `completed_at`, horodaté **côté serveur**
par `enforce_appointment_transition` au passage à `completed` (aucun client
ne fournit l'heure) ; `record_appointment_duration_sample` (F1b) insère
alors dans `service_duration_samples` : organisation, lieu, barber,
service, `started_at = starts_at` (l'heure planifiée), `ended_at =
completed_at`, `duration_minutes` calculée. Une seule mesure par rendez-vous
(unicité source/entrée). L'estimateur écarte < 3 et > 240 min à la lecture.

**Rien à ajouter en base** : « Terminé » depuis l'agenda appelle
`complete_appointment` — la collecte est alimentée telle quelle (prouvé
O7 en SQL, et par l'e2e : une mesure de ~25 min enregistrée au geste).
L'approximation F1b reste : le début est l'heure planifiée, faute d'un
geste « commencer » sur un rendez-vous — ajouter ce geste contredirait
« terminé en un geste » ; consigné pour OS-2 (§12).

## 5. Le glisser-déposer sur mobile — utilisable, avec un repli

**Utilisable.** Pointer Events, sans bibliothèque : souris/stylet = seuil de
4 px ; toucher = **appui long de 280 ms sans bouger** puis glisser (un doigt
qui bouge avant l'échéance est un défilement, laissé au navigateur), puis
`touchmove` neutralisé (écouteur non passif) pour que le navigateur ne
vole pas le pointeur ; menu contextuel supprimé sur la carte ; fantôme
positionné directement (aucune animation nécessaire → utilisable sous
`prefers-reduced-motion`, prouvé par e2e) ; défilement automatique près des
bords. **Preuve** : l'e2e à 390 px déplace un rendez-vous par un glisser
tactile (événements pointer `touch` synthétiques : pointerdown, attente de
l'appui long, pointermove, pointerup) et vérifie la ligne en base.
Limite déclarée : c'est un toucher synthétique (Chromium headless, pas un
doigt) — la mécanique est prouvée, pas l'ergonomie réelle sur téléphone.

**Le repli existe et est dit** : la fiche du rendez-vous porte « Déplacer »
(date, heure, barber) — c'est le chemin testé à 390 px pour le changement
de barber, et celui d'un barber assis à sa tablette qui préfère le menu.

## 6. Migrations — liste et retour arrière

Sauvegardes : `backups/pre-os1-20260911-001947.dump` (md5 `2405d342…`,
avant le bac d'essai) et `backups/pre-os1-apply-20260911-002948.dump` (md5
`1a8af40e…`, re-dump juste avant l'application — deux lots parallèles
vivent sur la même base).

| Migration | Rôle | Contenu | Retour arrière |
|---|---|---|---|
| `20260911100000_os1_time_block_series.sql` | **supabase_admin** (`time_blocks` lui appartient — DB_OWNERSHIP règle 2, mesuré) | `time_blocks.series_id uuid` + index partiel — le lien d'une série hebdomadaire matérialisée | `down` retire index et colonne ; les occurrences restent (blocages valides) — **exécuté 2× en bac d'essai, ok** |
| `20260911101000_os1_agenda.sql` | postgres | colonnes de trace `overlap_forced_*` (+ 2 contraintes), exclusions `barber`/`chair` recréées avec `overlap_forced_at is null`, trigger `check_appointment_forced_overlap`, table `appointment_overlap_forces` (RLS, SELECT gestionnaires), `private.can_force_overlap`, `memberships.can_view_revenue`, `private.can_view_revenue`, `set_membership_revenue_visibility`, `reschedule_appointment` (DROP+CREATE, +2 paramètres, ACL re-matérialisée), `create_appointment_as_business`, `get_calendar_appointments` (DROP+CREATE, +5 colonnes, prix masqué, ACL re-matérialisée) | `down` restaure les deux fonctions **verbatim** (copiées de la production du 2026-09-11), retire RPC/table/trigger/colonnes, remet les exclusions d'origine ; **refuse** tant qu'une ligne active porte un forçage (nomme la requête) — **exécuté 2×, ok ; refus prouvé avec une ligne forcée, succès une fois la ligne annulée** |

**Bac d'essai fidèle** (`b3_restore_sandbox.sh`, sans `--no-owner`) : up 1
(supabase_admin) + up 2 (postgres) → `verify_os1.sql` **« OS1 : TOUT PASSE
(O1–O9) »** (9 familles : exclusion intacte, forçage refusé client /
barber / réceptionniste / sans motif, trace + journal, rien d'ordinaire sur
du forcé (booking public, reschedule, `get_available_slots`), effacement
de la trace, création manuelle et ses gardes, collecte de durée au
« terminé », revenu (défaut, owner seul, cible barber, prix NULL/visible,
réceptionniste), série de blocages sous RLS `authenticated` réel) → down 2
puis down 1 → **diff ACL VIDE** (`x3_acl_snapshot.sql` T0/T2, privilège par
privilège avec concédant) et **md5 des deux définitions restaurées
identiques** ; cycle rejoué une seconde fois avec la preuve de la garde du
down. Propriétaires vérifiés avant écriture.

**Appliquées en production** après re-dump, invariant X3 respecté : grants
EXPLICITES sur toute RPC neuve ou recréée (`authenticated`,
`service_role`), `revoke … from public, anon`. Aucune RPC neuve n'est
appelable en `anon` : le contrat de surface `x3_anon_surface.sh` n'a
**pas** eu à changer et reste vert (vérifié après application).

`database.types.ts` régénéré (postgres-meta) : diff additif — mes objets
plus ceux de X2 déjà en production (`email_outbox.*`,
`professional_information_notices`, `requester_email`) ; le générateur
n'émet plus `isOneToOne: false` (299 → 48 lignes), sans effet sur le
typage du client.

## 7. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (legacy + v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette « encre sur vert ») | **vert** |
| `npm run test` (Vitest) | **714/714, 83 fichiers** — dont 28 tests OS-1 : positionnement et couloirs (`layout.test.ts`), détection de conflit (tampons, terminé retient son créneau), fenêtre d'heures, fuseau et changement d'heure (`time.test.ts`, `recurrence.test.ts`), les neuf gardes de permission (`permissions.test.ts`) |
| `npm run build` | **vert** — chunk pro `pro-*.js` **53,4 Ko gz** (36,7 après P1PRO : +16,7 pour l'agenda entier, aucune bibliothèque de glisser-déposer ni de calendrier) ; entrée `index-*.js` 43,3 Ko gz |
| `npm run e2e` OS-1 seul (Chromium 390 + 1440) | **24 passés, 2 sautés** (deux contrôles desktop non pertinents à 390 : popover d'équipe, geste souris sous reduced-motion) — 13 scénarios : jour, semaine, glisser (souris / toucher synthétique / repli menu), conflit → forçage tracé, forçage refusé (barber, réceptionniste, client), créer / bloquer ponctuel et récurrent / **terminé en un geste avec durée collectée** / absent / annuler avec e-mail client, revenu masqué (écran ET RPC), réglage owner seul, solo sans sélecteur, realtime (seul l'élément arrivé s'anime, et **la navigation entre jours n'anime rien**), aucun canal orphelin, axe, reduced-motion |
| `npm run e2e` complet (toutes suites : p1b, F1, F1b, F2, F3, F4, D1, P1PRO, OS-1) | ****240 passés, 1 instable passé au retry, 3 sautés, 2 échecs = le même test F4 aux deux largeurs + ses 10 suivants sériels non exécutés** — cause environnementale prouvée dans les journaux GoTrue de la nuit (8 occurrences de `550 You have reached your daily email sending quota`), exactement le cas P1PRO §12 (voir §11). L'instable : F3 « un résultat non revendiqué porte son badge neutre » (compte d'états `unclaimed`/`on-request` à 2 au lieu de ≤ 1 sur un rendu, vert au retry) — hors périmètre OS-1, non touché. Campagne UNIQUE (règle 2b), après la fin de la campagne PERF** |
| axe (390 + 1440, thème sombre pro, vue jour et vue semaine) | **aucune violation sérieuse ou critique** (dans la suite e2e) |
| `probe_public_rpcs.sh --strict` | **« ALL PUBLIC READ RPCs: 200 »** (avec `FADEUP_SUPABASE_ENV=/opt/fadeup/infra/supabase/.env` depuis le worktree) |
| `x3_anon_surface.sh --strict` | **« X3 SURFACE ANONYME : TOUT PASSE »** — aucune RPC OS-1 n'est anon-exécutable, la ligne de base n'a pas changé |
| Migrations | appliquées en production, retour arrière prouvé 2× sur restauration fidèle, diff ACL vide (§6) |
| Revue indépendante (`opus-reviewer`, lecture seule) | 1 bloquant + 7 importants + 10 mineurs relevés ; **bloquant et 7 importants corrigés** dans ce lot (§10), 4 mineurs corrigés, le reste déclaré (§11, §12) |

Ce que la campagne a laissé en base : **zéro** ligne `qa-os1` (rendez-vous,
blocages, échantillons de durée, journal de forçage — neutralisés en fin de
campagne), `can_view_revenue` remis à `false` sur l'organisation QA, essai
d'organisation prolongé de 2 jours pour la capacité `booking` (comme F1b).
La suite F1 historique crée deux organisations `qa-f1-*` par campagne
complète (motif connu, BLOCKERS §12.2) : toutes « ZZ dead », invisibles.
Une organisation `qa-f1-mtwcc67k` créée à 02:33 par une campagne
antérieure (avant ce lot) était restée sans le préfixe « ZZ dead » : renommée
ici (`marketplace_visible` était déjà `false`).

## 8. `/platform` intact — preuve

- `git status` : **zéro** fichier touché sous `src/pages/`, `src/routes/`,
  `src/components/`, `src/lib/` (la liste complète des fichiers du lot est
  en §9). Le seul fichier partagé de style modifié est
  `src/styles/motion.css` (keyframes de la modale V2, §10) — feuille du
  thème V2 seulement, jamais chargée par le legacy.
- Fonctionnel, sur la **build de production** (`vite preview`, port 4174) :
  `GET /platform/login → 200` ; police calculée du `<body>` et des contrôles
  **Inter** ; aucune police Geist chargée (`document.fonts`) ; **aucun jeton
  `--fu-*`** sur la racine (`--fu-accent` vide) ; `data-theme="light"` sur
  `<html>` (legacy), rien sur `<body>` (V2) ; **0 erreur console, 0 requête
  en échec**. Dans l'autre sens : l'agenda ne charge aucun chunk legacy.
- Capture : `platform-login-1440.png` (sonde `platform-proof.mjs`, conservée
  sous `apps/web/test-results/os1-probe/`, hors dépôt).

## 9. Git

- Branche **`os1/agenda`**, worktree dédié `~/worktrees/os1`, créée depuis
  `rebuild/social-first-v2` à `3a0f5e4`.
- Commits : `932af6b` feat(os1) — code, migrations, tests, captures ;
  `c7c0b83` docs(os1) — ce rapport ; puis un commit docs(os1) qui confirme
  la poussée dans cette section.
- Poussée sur `origin` : `git push -u origin os1/agenda` → `[new branch]
  os1/agenda -> os1/agenda`, `origin/os1/agenda` contient `c7c0b83`
  (vérifié `git branch -r --contains`). Arbre de travail propre.
- **Aucune fusion n'a eu lieu**, ni dans `rebuild/social-first-v2`, ni
  ailleurs ; `/opt/fadeup` (checkout principal) n'a pas été touché ;
  `apps/mobile` n'a pas été touché ; `vite.config.ts` n'a pas été touché.
- Fichiers du lot : `apps/web/src/features/pro-agenda/**` (neuf),
  `apps/web/src/shared/data/proBarbers.ts` (neuf), `apps/web/e2e/os1/**`
  (neuf), `db/migrations/2026091110{0,1}000_os1_*.sql` + leurs `down`
  (neufs), `db/tests/verify_os1.sql` (neuf), `docs/reports/OS1_RAPPORT.md`
  + `artifacts/os1/` (neufs) ; modifiés : `app/routes.tsx` (+15, la route),
  `features/pro-home/api/proHome.ts` (ré-export), `shared/data/keys.ts`,
  `shared/data/organization.ts` (+2 champs), `shared/lib/bookingRefusals.ts`
  (+2 motifs), `shared/lib/database.types.ts` (régénéré),
  `shared/i18n/locales/{fr,en}/{pro,booking}.json` (parité exacte),
  `styles/motion.css` (keyframes modale), `db/migrations/down/README.md`,
  `docs/frontend/V2_DATA_CONTRACT.md`.

## 10. Décisions prises seul — et erreurs commises, déclarées

### Décisions

1. **Semaine par ressource = barbers en colonnes, jours en bandes**, pas
   une grille horaire 7 × N (§1). C'est LA décision structurante de l'écran.
2. **Le réceptionniste ne force pas** (§2) : créer et déplacer oui,
   surcharger un barber est une décision de direction.
3. **Un temps bloqué ne se force pas** : c'est l'indisponibilité déclarée du
   pro ; on propose de le retirer ou de changer de créneau.
4. **La permission de revenu vit sur `memberships`** (§3), pas sur `barbers`
   ni dans une table de permissions.
5. **Un barber salarié ne voit que SON agenda.** « L'accès aux autres dépend
   du rôle » (OS-1 §4) est lu ainsi : le rôle `barber` n'a ni sélecteur ni
   colonne d'un collègue ; la RPC reçoit sa borne (`p_barber_id`) pour que
   la réponse réseau ne porte que ses lignes. **Limite déclarée** : la
   politique RLS `appointments_select` (antérieure à OS-1) laisse tout membre
   de l'organisation lire la table entière — la borne OS-1 est une
   minimisation, pas une autorisation. Resserrer cette RLS touche l'accueil,
   la file et le Worker : c'est à OS-2 (équipe et rôles) de le trancher (§12).
6. **« Terminé » en un geste = un bouton sur la carte**, rendu seulement
   pour une ligne confirmée dont l'heure de début est passée (le client au
   fauteuil), par un rôle habilité ; toujours visible au toucher, au survol
   ou au focus à la souris. La fiche reste le chemin pour le reste.
7. **Un seul lieu à l'écran** : le premier lieu de l'organisation (fuseau,
   fauteuils, création). Le multi-lieu a déjà un sélecteur sur la file ; il
   n'est pas reconstruit ici. Déclaré, pour OS-2.
8. **Le compte des rendez-vous recouverts par une série de blocages** ne
   regarde que la période affichée : le texte le dit désormais
   explicitement au lieu de laisser croire à un décompte total.
9. **Mobile = un barber à la fois**, jour comme semaine (§1) — c'est ce qui
   rend « même si serré » lisible.

### Erreurs commises, déclarées

1. **La session précédente a écrit ce rapport au passé** avec une liste de
   captures « jointes » alors que le répertoire était vide et que la
   campagne e2e n'avait jamais été verte. Trouvé au reprise du lot ; tout
   ce qui suit (§7–§9) a été produit et vérifié dans cette reprise.
2. **La campagne e2e a d'abord échoué sur un sélecteur** : `Input` et
   `Textarea` posent `data-testid` sur le contrôle lui-même, et les tests
   cherchaient un `<textarea>`/`<input>` descendant. Sept sélecteurs
   corrigés (spec et captures). En mode sériel, cet échec masquait les neuf
   tests suivants.
3. **La garde i18n `no-untranslated-status-maps`** a attrapé une carte de
   classes CSS nommée `BAR` (la convention exige un nom `*_CLASS`) :
   renommée, à la cause.
4. **La revue indépendante (opus-reviewer) a relevé sept points importants**
   que la première implémentation avait manqués, tous corrigés ici :
   navigation entre jours qui animait toutes les cartes (jetons remis à zéro
   au changement de fenêtre) ; squelette plein écran à chaque flèche
   (`keepPreviousData`) ; prestation mémorisée d'un formulaire à l'autre ;
   motif de forçage recopié d'un dialogue à l'autre ; CTA mort sur un salon
   sans fauteuil ; deux surfaces cliquables avec rôle/étiquette ARIA
   trompeurs ; animation d'arrivée écrasée par le flash (deux classes qui
   écrivent `animation`). Plus : code mort (cinq exports), une
   interpolation `{{time}}` vide qui figeait l'ordre des mots.
5. **Les modales V2 étaient décentrées — hors écran à 390 px.** Trouvé sur
   la capture du dialogue de conflit à 390 (`conflict-390-avant-correctif-
   modale.png`) et mesuré : `left: 50 %` + propriété `translate: -50 %`
   (Tailwind v4 émet `translate`, pas `transform`) + keyframe
   `fu-modal-in` qui portait ENCORE un `translate(-50 %, -50 %)` dans
   `transform` → décalage d'une largeur entière (x = −163 à 390, x = 272 au
   lieu de 496 à 1440). Défaut antérieur à OS-1 (P1c), qui touchait toutes
   les modales V2 (demandes, réservations, QR de file, confirmations) ;
   invisible aux tests parce que Playwright considère un élément hors
   viewport comme visible, et parce que `prefers-reduced-motion` supprime
   l'animation. **Corrigé à la cause** dans `motion.css` : les keyframes ne
   portent plus que l'opacité et l'échelle, le centrage appartient aux
   utilitaires (`-translate-x-1/2`, `rtl:translate-x-1/2`) ; le variant RTL
   des keyframes devient inutile et disparaît. Mesuré après : x = 16, largeur
   358 à 390 px.
6. **Une campagne e2e parallèle (PERF) a tourné pendant ma troisième
   campagne** sur la même organisation QA partagée (lignes « Adam S. »,
   « Sofiane L. » d'aujourd'hui, en anglais, dans l'instantané d'échec) :
   deux échecs sans cause dans le code, re-passés verts une fois seul. La
   règle 2b de QA_DATA vaut aussi ENTRE worktrees.
7. **`apps/web/src/app/routes.tsx` a été touché** (15 lignes additives : la
   route `agenda` sous `RequireCapability booking`) alors que la consigne
   demandait de l'éviter pendant que PERF y travaille. Il n'existe pas
   d'autre point d'enregistrement d'une route ; le bloc est isolé et
   commenté pour que la fusion reste triviale. `vite.config.ts` n'a pas été
   touché.

## 11. Cases non cochées

- **« `npm run e2e` vert, suites antérieures comprises » : à 99 %.** Le test
  F4 « inscription légère : e-mail → code à 6 chiffres » échoue aux deux
  largeurs et ses suivants sériels (5 × 2) ne courent pas — **le même
  échec, pour la même cause environnementale, que P1PRO §12** : le quota
  d'envoi quotidien Resend (`550 You have reached your daily email sending
  quota`), consommé par les campagnes de la nuit (les miennes comprises :
  chaque annulation et chaque déplacement QA émet son e-mail
  transactionnel). L'interface affiche l'erreur honnête prévue ; rien de ce
  lot ne touche ce chemin ; à re-passer après remise à zéro du quota.
- **« Glisser-déposer sur mobile utilisable » : prouvé par événements
  pointer synthétiques**, pas par un doigt sur un téléphone (§5). Le repli
  « Déplacer » par menu existe et est testé.
- **Cibles tactiles de 44 px** : une prestation de moins de 27 minutes donne
  une carte de moins de 44 px de haut dans la grille (96 px/h) — intrinsèque
  à une grille proportionnelle ; la carte reste ouvrable (la fiche prend le
  relais), le bouton « Terminé » direct n'y est pas rendu. Assumé, déclaré.
- **La lecture serveur des rendez-vous par un barber** reste org-wide (RLS
  antérieure) : borne écran + requête en OS-1, décision RLS pour OS-2 (§10,
  §12).
- **Multi-lieu** : le premier lieu seulement (§10), sélecteur pour OS-2.
- **WebKit** : toujours impossible sur cet hôte (bibliothèques système
  absentes, P1b) — Chromium seulement.

## 12. Ce qu'OS-2 devra trancher

1. **La lecture des rendez-vous par un barber, en base.** RLS
   `appointments_select` = tout membre de l'organisation. OS-1 borne l'écran
   et la requête ; si le produit veut que le téléphone et les notes des
   clients d'un collègue soient inaccessibles à un barber, c'est une
   politique RLS à resserrer (impact : accueil, file, Worker, apps mobiles).
2. **Le sélecteur de lieu** sur l'agenda (et la cohérence fauteuil ↔ lieu
   dans la création manuelle) — le motif de la file peut être repris.
3. **L'interrupteur « voit le revenu »** sur l'écran Équipe (aujourd'hui
   dans le popover d'équipe de l'agenda, owner seul).
4. **Un geste « commencer »** pour que la durée réelle parte de l'heure
   réelle et non de l'heure planifiée (F1b §4) — sans alourdir « terminé en
   un geste ».
5. **La contrainte fauteuil** (`appointments_chair_no_overlap`) a reçu le
   même prédicat `overlap_forced_at is null` que la contrainte barber, mais
   le trigger miroir ne teste que le barber. Aucune RPC n'écrit `chair_id`
   aujourd'hui ; le jour où une fonctionnalité fauteuil arrive, le trigger
   doit gagner une branche `chair_id` (ou la contrainte fauteuil revenir à
   son prédicat d'origine).
6. **La fenêtre de `get_calendar_appointments`** filtre sur `starts_at`
   seulement : un rendez-vous commencé la veille et débordant sur le jour
   n'est ni dessiné ni vu par la détection de conflit (le serveur, lui,
   refuse). Fenêtrer sur `ends_at > from and starts_at < to`, additif.
7. **Le compte des rendez-vous recouverts par une série** sur toute la
   plage de la série (requête dédiée), pas seulement la période affichée.
8. **Le revenu calculé** suit le tarif COURANT du catalogue (pas
   d'instantané à la réservation) : une hausse réécrit le passé. À trancher
   avec OS-3 (insights) : instantané de prix sur la ligne, ou libellé
   assumé.
9. **L'ergonomie réelle du glisser tactile** sur un téléphone (appui long
   280 ms) : prouvée par événements synthétiques seulement.
