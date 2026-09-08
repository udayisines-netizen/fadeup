# P1PRO — Rapport final : direction visuelle de l'espace professionnel

Branche `p1pro/direction` (depuis `rebuild/social-first-v2`, base `07dd12d`
qui porte D1 fusionné pour ce worktree), 2026-09-08. Contrat livré :
`docs/design/P1PRO_DESIGN_CONTRACT.md` — le pendant pro de
`D1_DESIGN_CONTRACT.md`, que les trois lots d'OS liront.

**Captures** (`docs/reports/artifacts/p1pro/`, 390 et 1440, en français,
données réelles créées par le tunnel réel sur l'organisation QA partagée) :
`home-data-*` (accueil pro avec données), `home-empty-*` (accueil sans rien
de prévu — l'état vide honnête), `requests-*` (liste des demandes),
`counter-sheet-pro-*` (la feuille de contre-proposition côté pro),
`counter-client-*` (la contre-proposition côté client),
`search-onrequest-*` (carte de recherche « Sur demande »),
`sheet-onrequest-*` (feuille « Demander un créneau »), `search-bookable-*`
(salon avec capacité), `shop-onrequest-*` (profil salon « Sur demande »),
`platform-login-1440.png` (preuve /platform).

---

## 1. La direction retenue — et où passe la frontière aération / densité

**Le cas de référence est le patron devant son écran** : l'OS se compose
pour le grand écran (grille de blocs, latérale existante) et s'empile en
mobile dans l'ordre opérationnel — l'inverse du client, assumé. Tout reste
pleinement utilisable en 390 px (vérifié : aucune action inaccessible,
aucun débordement horizontal, cibles 44 px).

Les trois références se combinent ainsi :

- **Notion donne la structure** : la page s'organise en BLOCS bordés
  (`--fu-border`, fond `--fu-surface`, rayon 16, ZÉRO ombre — l'invariant
  pro de D1 tient). La hiérarchie vient de l'agencement, rien ne crie.
- **Apple Music donne la matière** : le sombre profond existant
  (`#080f0d`/`#0f1a16`), des titres confiants, la latérale claire, de la
  respiration là où une décision se prend.
- **La rigueur financière donne le traitement des chiffres** : UN chiffre
  domine par écran (Geist Mono, `tabular-nums`, 32/44 px), les autres sont
  secondaires et alignés. Jamais douze cartes de KPI — l'accueil a UN bloc
  hero et des chiffres secondaires dans son pied.

**La frontière, énoncée au contrat §3 : on AÈRE ce qui se DÉCIDE, on
DENSIFIE ce qui se BALAIE.** Aérés : l'accueil (en composition), l'écran
des demandes à traiter, les insights, les états vides. Denses : le fil
TODAY, la file, l'historique des demandes, l'agenda, le CRM, le catalogue —
la rangée à filet fin y reste LA primitive. Un bloc aéré peut contenir une
liste dense (le bloc QUEUE de l'accueil). Le tableau complet est au contrat,
avec la règle générale pour toute surface non listée.

**La motion pro est sobre mais pas absente** (contrat §5) : CSS seul —
aucun Framer dans le chunk pro — et seuls les changements d'état RÉELS
sont animés : l'arrivée d'une demande (`fu-rise-in`), le mouvement de file
(FLIP F1b conservé), le passage à terminé. Navigation, panneaux et survol
ne bougent pas. `prefers-reduced-motion` neutralise tout (règle globale
theme.css, vérifiée par e2e).

## 2. Ce qui est révoqué de P1c — pour le pro, nommément

| Révoqué | Remplacé par |
|---|---|
| « La rangée à filet fin comme seule primitive pro » | les surfaces de DÉCISION se composent en blocs bordés ; la rangée reste la primitive des listes denses |
| « Les chiffres au fil du texte » | un chiffre DOMINANT par écran en Geist Mono display ; les secondaires hiérarchisés |
| « Un seul moment orchestré / pas de motion » | registre sobre : les trois changements d'état réels sont animés, rien d'autre |
| Rayons P1b `card 12` | la hiérarchie D1 (contrôle 8 / carte 16 / modale 16 / feuille 20) vaut aussi au pro |

Re-signés tels quels : Geist (+ Geist Mono pour tout chiffre), fond sombre,
zéro ombre, couleurs d'état confinées au pro, étiquettes mono
tracking-widest comme SEULE exception aux majuscules espacées, encre sur
vert, capacité absente non rendue. Le contrat le dit en toutes lettres
(§0/§0bis) — un agent aval n'hérite pas de deux versions.

## 3. L'accueil — TODAY / NOW / NEXT / QUEUE

`/dashboard` (`features/pro-home`), composé pour ≥ 1024 px : hero (2/3) +
demandes (1/3), NOW (2/3) + QUEUE (1/3), NEXT, puis le fil TODAY en pleine
largeur. Mobile : NOW → demandes → NEXT → chiffre → QUEUE → TODAY —
l'opérationnel d'abord, debout.

**Le chiffre qui domine, et pourquoi.**
- **owner / manager** : le REVENU CALCULÉ du jour — la somme des prix
  configurés des prestations TERMINÉES (aucun montant encaissé n'existe,
  par design MASTER_SPEC §14 ; le libellé dit « calculé »). C'est le chiffre
  que le patron vient chercher le matin, et la rigueur financière du
  contrat s'y exprime. Un jour sans prestation terminée affiche un vrai
  zéro ; ses secondaires : rendez-vous du jour, terminées, demandes en
  attente (ambre si > 0).
- **barber salarié** : SES prestations restantes — il ne voit JAMAIS le
  revenu du salon (ni le bloc, ni son emplacement vide : la composition se
  refait sans lui). Vérifié par e2e avec le compte barber réel.
- **réceptionniste** : l'opérationnel sans les montants (le rôle gère les
  demandes mais les « indicateurs patron » ne sont pas les siens).
- **solo_professional** : comme owner, sans AUCUNE entrée d'équipe (pas de
  « avec X » sur les lignes, pas d'entrée de nav équipe — via
  `isSoloOrganization`, seul point du produit qui compare l'enum interne,
  gardé par test).

NOW porte « Terminé » en un geste (`complete_appointment`), QUEUE n'existe
que si la capacité `liveQueue` est réelle, le bloc demandes n'existe que
s'il y a des demandes. **Une journée vide est un état vide honnête** avec
une action réelle (« Voir mon profil public ») — pas une grille de zéros
(capture `home-empty-*`).

Realtime : deux canaux de contexte (`appointments`, `queue_entries`
filtrés par organisation), invalidation de clés uniquement.

## 4. Les demandes — le maillon manquant

`/dashboard/requests` (`features/pro-requests`). Le pro arrive d'un e-mail,
souvent en mobile : la liste des demandes À TRAITER est AÉRÉE — un bloc par
décision : service + prix, **l'horaire demandé en mono grand**, prénom du
client, barber, note éventuelle, et **l'échéance qui défile** (compteur
mono, seconde par seconde, ambre sous 15 minutes). La plus urgente en tête
(tri serveur par `expires_at`).

**Les trois actions, hiérarchisées** : Accepter est LE geste primaire
(vert plein encre, la plus grande cible — `flex-[2]`) ; « Proposer un autre
horaire » est secondaire ; Refuser est tertiaire rouge et demande
CONFIRMATION (un client attend derrière), avec un mot facultatif transmis.

**Le salon Free accepte sans mur** — revérifié : `confirm_booking_request`
ne consulte ni plan ni compteur, et l'e2e accepte réellement pendant que
l'essai de l'organisation est expiré. **L'incitation vient APRÈS** une
acceptation réussie : bannière fermable (« Client confirmé — il vous a
trouvé sur FadeUp », essai 14 jours via `start_organization_trial`),
jamais avant, jamais bloquante — l'e2e vérifie que les autres demandes
restent actionnables bannière ouverte.

**L'historique** (dense, rangées à filet fin) : les demandes traitées avec
leur issue — acceptée / acceptée après contre-proposition / réalisée /
refusée / expirée sans réponse / contre-proposition refusée / retirée par
le client — via la RPC neuve `get_booking_request_history`. C'est la trace
de ce que FadeUp apporte au salon.

**Minimisation des coordonnées** : l'écran affiche EXACTEMENT ce que
`get_booking_requests` expose, qui ne répond qu'aux rôles gestionnaires
d'une organisation revendiquée (`private.can_manage_appointments`). La
garde B2 pour les professionnels NON vérifiés est en amont et vérifiée :
`professional_interest_requests` ne stocke que `customer_display_name`
déjà réduit (« Karim B. ») — le prospect ne reçoit jamais téléphone ni
e-mail (`private.prospect_outreach_payload`, mesuré).

**Realtime** : canal de contexte `appointments` — une demande créée par le
tunnel anonyme apparaît SANS rafraîchir (prouvé par e2e, l'écran ouvert
pendant l'appel HTTP), animée `fu-rise-in` ; une échéance atteinte sort de
la liste côté client d'écran avant même le balayage serveur (proposer
« Accepter » sur une demande expirée serait un mensonge).

**Correctif au passage** : l'entrée de nav « Demandes » était derrière la
capacité `booking` — un salon Free reçoit des demandes PRÉCISÉMENT parce
qu'il n'a pas cette capacité. L'entrée est désormais conditionnée par le
RÔLE (gestionnaires), pas par la capacité ; la route n'a pas de
`RequireCapability`.

## 5. La contre-proposition — RPC, états, échéance

**Le manque** : B2 avait `confirm` et `decline` ; « pas 18h, mais 18h30 »
— le cas le plus fréquent — forçait un refus sec.

**Le modèle tranché** (regardé `appointment_resolution` d'abord : rien à
inventer, aucun état nouveau) :

- `counter_propose_booking_request(id, starts_at, barber?, note?)`
  **DÉPLACE la demande sur le créneau proposé** — le mécanisme éprouvé de
  `reschedule_appointment` (même garde de colonnes, même validation
  d'horaires `slot_is_within_hours`, même autorité de la contrainte
  d'exclusion). La ligne reste `pending`.
- **Le créneau proposé est RETENU** : la ligne pending déplacée participe à
  `appointments_barber_no_overlap` — prouvé par verify (P8 : un booking
  public sur le créneau proposé est refusé). **L'horaire d'origine est
  libéré** (un autre client peut le prendre — honnête).
- **La demande d'origine DEVIENT la contre-proposition** : une seule ligne,
  pas de double réservation. `counter_proposed_at` posé = le consentement a
  changé de camp ; `counter_original_starts_at` garde l'horaire demandé
  (jamais réécrit par une re-proposition) ; `counter_note` porte le mot du
  salon.
- **Échéance** : `least(horaire proposé, now() + TTL de l'organisation)` —
  le compte à rebours REDÉMARRE (le salon vient de montrer sa volonté),
  jamais au-delà de l'heure proposée. Le trigger d'expiry re-plafonne.
- **Tant que la contre-proposition attend**, `confirm_booking_request`
  refuse (`fadeup_booking_refusal=counter_pending`) — le salon ne peut pas
  accepter à la place du client ; il peut toujours refuser.
- **Le client accepte** (`accept_booking_counter_proposal`) → `confirmed`
  en une transition légale, AUCUNE course possible sur le créneau (il était
  retenu) ; les deux parties sont notifiées.
- **Le client refuse** (`decline_booking_counter_proposal`) → la demande se
  CLÔT (`cancelled` / `cancelled_by_customer`) : le salon avait déjà dit
  non à l'horaire d'origine, le faire revivre serait un faux espoir. Le
  salon est notifié ; le client repart vers les alternatives F4.
- **Il ne répond pas** → l'expiration NORMALE par le balayage existant,
  inchangé.
- Notification `booking_counter_proposed` (valeur d'enum ajoutée, fichier
  séparé — une valeur d'enum n'est pas utilisable dans sa transaction) +
  gabarits e-mail fr/en dans `email_templates` (le client anonyme est
  prévenu par e-mail ; répondre en ligne demande le compte — voir §12).
- `was_request` (colonne + stamp dans `set_appointment_request_expiry`) :
  le marqueur durable « née demande », sans lequel l'historique ne peut pas
  distinguer une demande acceptée d'une réservation directe.

**Côté client** : `get_my_appointments` porte les trois colonnes counter ;
`MyBookingsPage` affiche la contre-proposition EN TÊTE — l'horaire demandé
barré, le proposé en évidence, le mot du salon, le compte à rebours — avec
Accepter (primary) et Refuser (confirmation : « votre demande sera close »,
dit AVANT le geste). `pending-request` ne dit jamais « réservé ».

## 6. Le libellé — « Sur demande » vs « Réservable »

Le constat exact : le badge « Réservable » dérivait du MODE de service
(`deriveProfileCta`) et ignorait la capacité commerciale — le client
découvrait à la dernière étape du tunnel (F4) qu'il envoyait une demande.

Livré, sur `get_public_booking_capability` (F4) + la nouvelle
`get_public_booking_capabilities(slugs[])` en LOT (max 50 — pas de N+1
supplémentaire sur la recherche) :

- **Carte de résultat** : UN badge — `disponible maintenant` (vivant) prime,
  puis **« Sur demande »** (mode ouvert, capacité absente : non revendiqué
  OU Free) ou **« Réservable »** (capacité présente), sinon
  l'ouvert/fermé d'avant. Quand « Sur demande » s'affiche, la mention
  « Non revendiqué » est SUPPRIMÉE de la carte (redondante) — elle reste
  sur la feuille et le profil, où il y a la place d'expliquer.
- **Feuille de résultat** : badge d'état + CTA « Demander un créneau » +
  note (« vous enverrez une demande, le salon répond avant une échéance »).
- **Profils** (salon et barber) : le CTA dominant dit « Demander un
  créneau » avec la note — la destination reste le tunnel réel, dont le
  récapitulatif F4 continue de dire la vérité (`is_request` lu de la
  réponse).
- Capacité INCONNUE (`null`) : rien n'est affirmé — comportement d'avant.

`SearchResultRow` (l'orphelin legacy D1) rend toujours « Réservable » mais
n'est consommé nulle part — sa suppression reste suspendue à la validation
produit de D1, décision D1 §11 conservée.

## 7. Migrations — liste et retour arrière

Sauvegarde AVANT migration : `/opt/fadeup/backups/pre-p1pro-20260908-020845.dump`
(md5 `0e648b8b…`).

| Migration | Contenu | Retour arrière |
|---|---|---|
| `20260908030000_p1pro_counter_notification_type.sql` | `notification_type` + `booking_counter_proposed` (fichier séparé, motif B4/F1b) | down reconstruit le type sans la valeur (sauve/recrée `emit_booking_notification` + `notify_social`, re-révoque PUBLIC), refuse si des lignes portent la valeur |
| `20260908031000_p1pro_counter_proposal.sql` | 4 colonnes `appointments` (+ backfill `was_request`), stamp dans `set_appointment_request_expiry`, garde `counter_pending` dans `confirm_booking_request`, 3 RPC counter, `get_booking_request_history`, `get_public_booking_capabilities`, `get_booking_requests`/`get_my_appointments` recréées (+3 colonnes, ACL re-matérialisée à l'identique), gabarits e-mail fr/en | down restaure les définitions d'origine VERBATIM, retire RPC/colonnes/gabarits |

**Test de retour arrière, sur restauration FIDÈLE du dump de production**
(`b3_restore_sandbox.sh`, sans `--no-owner`) : up 1+2 appliqués →
`verify_p1pro.sql` **« P1PRO : TOUT PASSE (P1–P11) »** (11 familles
d'assertions : stamp was_request, refus anonyme/non-membre, déplacement +
rétention du créneau + échéance redémarrée, notifications + e-mails émis,
confirm refusé pendant counter, accept/decline client, re-proposition,
historique + son autorisation, capacités en lot + garde 50, garde-fous
passé/hors-horaires/ligne réglée) → down 2 puis down 1 → **diff ACL VIDE**
(`x3_acl_snapshot.sql` avant/après, privilège par privilège avec
concédant) et **définitions des 4 fonctions restaurées identiques à la
production** (diff `pg_get_functiondef` nul), colonnes/gabarits/enum
retirés. Propriétaires vérifiés avant écriture : tous `postgres`
(DB_OWNERSHIP règle 2) — les deux migrations s'appliquent en `postgres`.

**Appliquées en production** après la preuve, invariant X3 respecté :
grants EXPLICITES sur toutes les RPC neuves et recréées. Backfill
`was_request` : 11 lignes.

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (legacy + v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **vert** (warnings oxlint informatifs préexistants) |
| `npm run test` (Vitest) | **687/687, 79 fichiers** — deux gardes m'ont attrapé en route (§11), corrigées à la CAUSE |
| `npm run build` | **vert** — entrée consumer ≈ **97,2 Ko gz** (index 40,9 + vendor-react 56,4 — budget 180 tenu) ; chunk pro **36,7 Ko gz** (28,8 après D1 : +7,9 pour les deux écrans, aucun Framer) |
| `npm run e2e` (Chromium 390 + 1440, campagne UNIQUE) | **216 passés, 1 sauté (préexistant), 1 instable passé au retry (F4 créneau, préexistant)** — les 15 scénarios P1PRO neufs (30 exécutions) et toutes les suites antérieures (p1b, F1, F1b, F2, F3, F4, D1), SAUF le test F4 « inscription légère e-mail → code » (2 échecs = le même test aux deux largeurs, + ses 10 suivants sériels non exécutés) : cause ENVIRONNEMENTALE prouvée, voir §12. Après les deux derniers correctifs UI (badge « Réalisée », journée vide), la suite P1PRO seule a été re-passée : **30/30** ; F1b + F3 re-passées après leurs correctifs : **53 passés**. Empreinte : +6 organisations `qa-f1-*` (motif F1 connu, 2 par campagne complète × 3 campagnes, BLOCKERS §12.2), toutes « ZZ dead » invisibles ; zéro ligne QA ouverte, file vidée et refermée, échantillons de durée purgés, essai restauré |
| axe (390 + 1440) | accueil pro, demandes (thème sombre pro) : **aucune violation sérieuse ou critique** |
| « Encre sur vert » | garde lint `check-fu-palette.mjs` verte + grep : aucun vert plein sans `--fu-accent-fg` |
| `probe_public_rpcs.sh --strict` | **toutes les RPC publiques : 200** (la sonde couvre la nouvelle `get_public_booking_capabilities`) |
| `x3_anon_surface.sh --strict` | **« X3 SURFACE ANONYME : TOUT PASSE »** — la RPC publique neuve ajoutée à la LIGNE DE BASE consacrée (décision de ce lot, documentée ici) |
| Données QA | AUCUNE organisation créée ; tout sur `qa-f1b-shared` (réactivée puis neutralisée, état d'essai sauvegardé/restauré) + 1 compte client `qa-p1pro-client@fadeup.test` (sans organisation, réutilisable — motif F4) ; lignes `qa-p1pro-*` closes en fin de campagne |

## 9. `/platform` intact — preuve

- `git status` : **zéro** fichier touché sous `src/pages/`, `src/routes/`,
  `src/components/`, `src/lib/` (mesuré, section 10).
- Fonctionnel : `GET /platform/login → 200` sur la build de production
  (preview) ; le rendu porte **Inter** (mesuré `getComputedStyle`), aucune
  fuite Geist/Poppins — l'attribut de thème V2 vit sur `<body>`, le legacy
  sur `<html>` (piège D1 documenté, revérifié). Dans l'autre sens : le
  thème pro ne charge rien du legacy.
- Capture : `platform-login-1440.png`.

## 10. Git

- Branche **`p1pro/direction`**, worktree dédié, créée depuis
  `rebuild/social-first-v2` (état local incluant D1 — base `07dd12d`).
- Commits (ajouts explicites uniquement, jamais `git add .`/`-A`) :
  `2e9751b` migrations + sondes · `b5d8c7a` libellé + rôle + réponse
  client · `1937bfb` accueil + demandes + routes · `31afb56` e2e (+ spec F3
  adaptée au changement de produit) · un commit docs (contrat, rapport,
  captures, contrat de données) clôt la branche.
- **Poussée. Aucune fusion.** Aucun `reset --hard`, aucun `clean`, aucun
  `docker prune`. Le worktree D1/M1a voisin n'a pas été touché.

## 11. Décisions prises seul — et erreurs commises, déclarées

**Décisions :**
1. **Le modèle de la contre-proposition** (§5) : déplacer la ligne pending
   plutôt qu'une table parallèle — une seule source de vérité du créneau,
   la rétention gratuite par la contrainte existante, et le mécanisme de
   reschedule éprouvé. Coût assumé : l'horaire d'origine est libéré dès la
   proposition.
2. **Refus client = demande close** (pas un retour à « en attente du
   salon ») : le salon a déjà dit non à l'horaire demandé.
3. **Le chiffre dominant par rôle** (§3) : revenu pour owner/manager,
   prestations restantes pour barber, opérationnel sans montants pour
   réceptionniste. Le prompt disait « un chiffre domine » sans fixer
   lequel par rôle.
4. **L'échéance de la contre-proposition redémarre** (`least(proposé,
   now()+TTL)`) plutôt que de conserver l'échéance d'origine — une
   proposition à 5 minutes de l'échéance initiale serait morte-née.
5. **Nav « Demandes » : rôle, pas capacité** (§4) — le conditionnement par
   capacité aurait caché l'écran exactement aux salons qui en ont le plus
   besoin (Free). Décision produit prise seul, cohérente avec B2.
6. **Suppression des lignes qa-p1pro TERMINÉES en fin de campagne** e2e
   (données marquées, organisation QA) : les lignes `completed` retiennent
   leur créneau (l'exclusion n'exclut que cancelled/no_show) et
   bloqueraient la campagne suivante. Les journaux append-only ne sont pas
   touchés.
7. **Le pro n'embarque pas Framer** : la motion pro est CSS seul — le
   registre sobre n'en a pas besoin, et le chunk pro reste maigre.
8. **`was_request` backfillé approximativement** : `status='pending'` OU
   résolution `declined/expired` OU notification `booking_request_created`
   existante. Un reschedule-salon historique pourrait manquer ; sur-
   inclusion impossible par ce prédicat. 11 lignes, déclaré ici.

**Erreurs commises et corrigées en route :**
- **Un vrai bogue de rôle, attrapé par MA campagne e2e** : le contexte pro
  (`useProOrganization`) lisait la PREMIÈRE ligne de memberships visibles —
  or la RLS rend visibles ceux de TOUTE l'équipe (écran Équipe), et un
  barber héritait parfois du rôle de son owner : l'e2e a montré un barber
  salarié avec le REVENU du salon à l'écran. Corrigé à la cause
  (`.eq('user_id', session.user.id)` + le compte dans la clé de cache).
  Le champ `role` est neuf (P1PRO) ; l'ancien code ne lisait que
  `organization_id` — aucune surface antérieure n'exposait de donnée par ce
  biais, mais le même motif aurait pu servir de fondation aux lots d'OS.
- Ma première assertion e2e de TRI supposait « horaire plus proche =
  échéance plus proche » — faux quand le TTL (24 h) précède l'horaire :
  deux demandes de demain partagent l'échéance TTL. Corrigé en testant avec
  une demande pour dans deux heures (échéance = l'heure demandée).
- Mon premier verify P6 réutilisait le MÊME e-mail pour une seconde
  réservation anonyme : `link_customer_from_contact_info` refuse de
  rattacher une réservation anonyme à un client détenteur de compte
  (garde de confidentialité B2 — `customer_id` reste NULL). Découvert en
  sandbox, testé avec des identités distinctes ; la garde elle-même est
  saine et documentée ici.
- Deux gardes de la suite unitaire m'ont rattrapé : l'enum interne
  `solo_professional` écrit dans une feature (déplacé derrière
  `isSoloOrganization` en shared/data), et les messages fr/en manquants
  des quatre nouveaux codes de refus (ajoutés).
- Un compte de cartes lu pendant le squelette (course e2e) — remplacé par
  une attente de la donnée.
- Mon atténuation des rangées passées du fil TODAY (`opacity-60`) faisait
  tomber le texte secondaire à 3,29:1 — attrapé par axe. Remplacée par la
  hiérarchie de COULEUR (titre en secondaire, 6,55:1), aucune opacité sur
  du texte.

## 12. Cases non cochées

- **« `npm run e2e` vert — suites antérieures comprises » : une case à
  93 %.** Le test F4 « inscription légère : e-mail → code à 6 chiffres »
  échoue aux deux largeurs, et ses 5 suivants sériels (× 2) n'ont pas
  couru. Cause prouvée dans les logs GoTrue :
  `550 You have reached your daily email sending quota` — le quota d'envoi
  QUOTIDIEN Resend, épuisé par les campagnes répétées de cette nuit (mes
  itérations P1PRO comprises, chaque réservation QA émettant ses e-mails
  transactionnels). L'interface a affiché l'erreur honnête prévue
  (« L'e-mail n'a pas pu être envoyé »), le même test était vert dans la
  campagne D1 vingt-quatre heures plus tôt, et rien de ce lot ne touche ce
  chemin. À re-passer après la remise à zéro du quota — je ne peux ni
  attendre ~20 h ni toucher la configuration SMTP.
- **« L'échéance qui défile » côté client anonyme** : un client SANS compte
  reçoit l'e-mail de contre-proposition mais ne peut pas répondre en ligne
  (aucune surface anonyme d'accès à sa demande n'existe — le
  `claim_token` de F4 sert au rattachement, pas à la consultation).
  Répondre exige de se connecter avec l'e-mail de la réservation. Manque
  déclaré, pas comblé par une invention — le gabarit e-mail invite à
  ouvrir ses réservations.
- **WebKit e2e** : toujours non exécutable sur cet hôte (BLOCKERS §2,
  préexistant).
- **Le transfert réel au premier chargement** (~674 Ko gz : platform +
  maplibre importés statiquement par l'entrée) : défaut PRÉEXISTANT
  constaté par D1 (§11 de son rapport), toujours là, toujours hors
  périmètre d'un lot de direction.
- **La fenêtre « aujourd'hui » de l'accueil** est calculée dans le fuseau
  de l'APPAREIL (le pro est au salon — même choix que l'étude P1c). Un
  patron consultant depuis un autre fuseau verrait la journée de SON
  appareil. Assumé, consigné pour le lot agenda (qui devra trancher le
  fuseau de référence des vues).
- **Réceptionniste non testé par e2e** (aucun compte QA de ce rôle
  n'existe et en créer un ajouterait un compte au tas) : le conditionnement
  est le même chemin de code que barber/owner (rôle lu du membership),
  couvert par les deux rôles testés.

## 13. Ce que les trois lots d'OS devront trancher

1. **Le langage visuel de l'agenda** (créneaux, conflits, blocages, vue
   semaine par ressource) — la densité est fixée au contrat, pas la forme
   des créneaux.
2. **La dataviz Insights** (encre/verts, un chiffre dominant — le langage
   des courbes et cohortes reste à définir).
3. **Les libellés d'audience de la file** (« Appelé » pro vs « C'est votre
   tour » client) — hérité de P1, toujours ouvert.
4. **La rangée CRM** (méta, geste principal) et la réservation manuelle.
5. **Le fuseau de référence des vues pro** (appareil vs lieu) quand
   l'agenda multi-lieux arrivera.
6. **Une surface anonyme de réponse à la contre-proposition** (lien e-mail
   signé ?) — décision produit + backend, pas un choix d'écran.

---

**Gate R5R rappelé** : ce lot passe la vérification technique ; la
direction pro reste soumise à la validation explicite du fondateur. Aucune
fusion n'a été faite.
