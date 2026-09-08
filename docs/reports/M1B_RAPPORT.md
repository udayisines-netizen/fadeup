# FADEUP — Rapport final M1b : application iOS transactionnelle

**Branche** `m1b/ios-transactions`, worktree dédié `~/worktrees/m1b`, créée depuis
`rebuild/social-first-v2`. **Aucune fusion effectuée.** X2 tournait en
parallèle sur `apps/web` — jamais touché.

M1a avait posé le socle, l'onboarding, la recherche et les profils : rien ne se
faisait encore. M1b rend l'application **transactionnelle** : rejoindre une
file, réserver, consulter ses rendez-vous, parcourir le feed, gérer son compte.
À l'issue, l'application client est fonctionnellement complète — Sign in with
Apple, liens universels, push réels et publication restent à M1c
(dépendants du compte développeur Apple).

Le lot a d'abord ré-établi la parité des copies partagées avec `apps/web`
(la fusion P1PRO avait fait diverger 10 fichiers depuis M1a), posé une
fondation commune (session, hors-connexion, thème sombre, StateBadge natif,
feuille d'auth), puis construit les cinq surfaces. La logique métier du web
(F1/F1b/F4/P1PRO) est **copiée verbatim sous la garde anti-dérive** — jamais
réécrite.

---

## Captures

Rendu **react-native-web du même code** (Chromium 390×844, sauf `-430`),
données de **production réelles**, fixtures QA `demo-*` et `qa-f1b-shared`.
`docs/reports/artifacts/m1b/` — le VPS n'a ni iPhone ni macOS (déclaration M1a
toujours vraie), les captures ne sont donc PAS « prises dans Expo Go ».

| Surface | FR | EN |
|---|---|---|
| Feed (390 + 430) | `10-feed-390`, `10-feed-430` | `10-feed-en-390` |
| File — consultation | `20-queue-consult-390` | `20-queue-consult-en-390` |
| File — feuille rejoindre | `21-queue-join-sheet-390` | `21-queue-join-sheet-en-390` |
| File — suivi (position, sombre) | `22-queue-tracking-waiting-390` | `22-queue-tracking-waiting-en-390` |
| File — changer de barber | `23-queue-change-sheet-390` | `23-queue-change-sheet-en-390` |
| File — quitter (confirmation) | `24-queue-leave-confirm-390` | `24-queue-leave-confirm-en-390` |
| File — **l'appel** | `25-queue-called-390` | `25-queue-called-en-390` |
| File — quitter appelé / terminé | `26-…`, `27-queue-ended-left-390` | `26-…-en`, `27-…-en` |
| Réservation — tunnel | `30-book-service`, `31-book-barber`, `32-book-slots`, `33-book-summary` | — |
| Réservation — inscription légère | `34-book-otp-390` | — |
| Réservation — **confirmé (sombre)** | `35-book-confirmed-390` | — |
| Réservation — **demande envoyée** | `36-…`, `37-request-sent-390` | — |
| Mes réservations (+ contre-proposition + file active) | `40-bookings-390`, `41-booking-detail-390` | `40-bookings-en-390` |
| Demande d'intérêt (non revendiqué) | `50-interest-form-390`, `80-pro-unclaimed-390` | — |
| Compte + suivi + like | `60-shop-followed`, `61-feed-liked`, `62-account`, `63-account-scrolled` | — |
| Hors connexion | `70-offline-home-390`, `71-offline-queue-390` | — |
| Feuille d'auth (like anonyme) | `90-auth-sheet-like-390` | — |

---

## 1. La file — ce que le natif rend mieux, l'appel sans push

**Trois gains natifs, exploités :**

1. **Consulter sans rien scanner.** `get_public_queue_status` est accessible
   sans jeton, sans coordonnées, sans authentification (B1/F1). `/q/[slug]`
   s'ouvre directement sur l'attente — nombre de personnes, état de la file,
   estimation *seulement si fiable* (`22-queue-tracking`, `20-queue-consult`).
   Un client consulte depuis son canapé.
2. **Le scan est instantané.** `expo-camera` (`CameraView`, `barcodeTypes:['qr']`)
   remplace l'accès caméra web qui traîne. **Le flux caméra n'est monté que
   pendant l'étape scan et libéré au démontage** — pas de voyant resté allumé.
   Un verrou de 2 s entre lectures permet de re-viser un QR refusé.
3. **La géolocalisation ne se demande qu'au geste « rejoindre »**
   (`expo-location`, `getCurrentPositionAsync`, précision haute, timeout 15 s
   posé à la main car l'API n'en offre pas) — jamais à l'ouverture. Les
   coordonnées partent **brutes** au serveur : le verdict de distance est
   mesuré côté base, jamais côté client.

**Les motifs de refus se lisent sur le CODE.** Les 15 codes nommés
(`fadeup_queue_refusal=…`, 8 de F1 + 7 de F1b) plus les 5 échecs locaux
(`geo-denied`, `geo-unavailable`, `scan-failed`, `otp-failed`,
`email-send-failed`) ont chacun leur message. Le module `refusals.ts` (copié
verbatim) est le point de vérité. **Un 42501 devient 401 en anon** —
jamais branché sur le statut HTTP, jamais de déconnexion automatique là-dessus.

**L'appel est impossible à manquer** (`25-queue-called`) : panneau vert plein
pleine largeur, texte **encre `#080F0D` sur vert** (8,30:1 — jamais de blanc
sur vert), `AccessibilityInfo.announceForAccessibility` sur la transition,
**retour haptique** (`expo-haptics`, notification succès, une seule fois — garde
`useRef` comme la notification web), pulsation Reanimated neutralisée sous
réduction de mouvement. Compte à rebours géant `m:ss` (MonoText tabulaire)
depuis `called_deadline_at` via `useNow(1000)`.

**Sans notifications push, l'écran compense :** `useKeepAwake` (expo-keep-awake)
maintient l'écran allumé **tant qu'une entrée est suivie** (waiting/called),
le poll de 6 s reste actif, la mention « L'écran reste allumé pendant votre
attente » l'explique. **Limite honnête :** `focusManager` (posé par M1a)
suspend les requêtes quand l'app passe en arrière-plan ; un téléphone
verrouillé ne recevra donc pas l'appel. **C'est le push M1c qui ferme ce
trou** — dépendance produit, pas défaut du lot.

**Jamais de valeur négative** : échéance dépassée → « Le délai est écoulé,
présentez-vous au comptoir » ; pas d'échéance → rien. Testé (`tracking.test.ts`).

Le **suivi est en fond sombre** (thème `moment`, D1), la consultation reste
claire — seule la position vivante bascule. Quitter demande confirmation
(texte différent si appelé), changer de barber affiche l'avertissement de
perte de place **avant** tout choix (`23`, `24`).

---

## 2. Les trois issues de réservation, et le test anti-« Réservé »

L'interface les distingue **uniquement sur `result.is_request`** (lu de la
RPC, jamais déduit de l'enum de statut) :

- **Confirmé** (`35-book-confirmed`, fond sombre, coche à ressort) — « Rendez-vous
  confirmé », l'organisation a la capacité `booking`.
- **Demande en attente** (`37-request-sent`) — `StateBadge state="pending-request"`
  = « En attente de confirmation » (jamais « Réservé »), échéance **absolue**
  (fuseau du lieu) + **relative** qui défile (« Expire dans 10 min »,
  `remainingParts`, jamais négatif). `is_request` et `expires_at` viennent de
  la RPC. À l'expiration : bascule vers « appeler d'abord » puis « Chercher une
  alternative » en primaire.
- **Demande d'intérêt** (`50-interest-form`, `80-pro-unclaimed`) — profil non
  revendiqué, `preferred_starts_at` posé comme **préférence, pas offre** :
  « Votre préférence — pas un créneau garanti », registre visuel distinct du
  vrai sélecteur de créneaux.

**La garde de langue** (`requestCopy.test.ts`) réplique le mécanisme web
(`noBookedWording.test.tsx`) : le module pur `requestCopy.ts` **assemble la
totalité** des chaînes que l'écran « demande envoyée » rend (titre, badge,
corps, deux lignes d'échéance, CTA), et le composant les consomme
exclusivement. Le test passe le motif exact
`/(^|[^\p{L}])(réservé|reserve|booked|confirmé|confirmed)(?![\p{L}])/iu` sur
(a) la sortie complète du module en FR **et** EN, états pending **et** expiré ;
(b) le motif dans les deux sens ; (c) les 15 mêmes sections de copie que le
web. La garde échoue si un texte associe « Réservé » à une demande.

Créneaux : fenêtre 90 jours (jours tous cliquables — proposer un jour n'affirme
rien), pas de 15 min (défaut serveur), **un créneau indisponible n'existe pas
à l'écran** (`32-book-slots` : onglets Matin/Après-midi/Soir dans le fuseau du
lieu). « Premier disponible » fusionne les créneaux par barber, premier arrivé
gagne. **Aucun écran de paiement** : « Prix attendu — À régler sur place ».

**La contre-proposition** (P1PRO, `40-bookings`) : carte en tête de
« Réservations », horaire demandé **barré**, proposé en évidence, note du
salon, échéance qui redéfile, Accepter (primaire) / Refuser (secondaire →
confirmation : la demande sera close). `accept_/decline_booking_counter_proposal`,
zéro optimisme, invalidation au succès.

---

## 3. L'inscription légère — la reprise sur place

Le tunnel vit **entièrement dans les paramètres d'URL** (`s`, `b`, `d`, `t`,
`l` — `useLocalSearchParams` + `router.setParams`). Quand une action exige une
session, la feuille OTP s'ouvre **sur le même écran, sans navigation** : e-mail
→ code à six chiffres → `verifyOtp` pose la session **sur place** →
l'intention repart aussitôt. Le créneau choisi ne bouge pas, parce qu'il est
dans l'URL. C'est structurel, pas un rétablissement d'état.

La même feuille (`AuthSheet`, `90-auth-sheet-like`) sert **partout** où une
action demande une session — suivre, aimer, mes réservations, compte — avec un
message contextuel. Elle **remplace** la feuille « la connexion arrive » de
M1a. Deux chemins : **code e-mail** (motif F1b/F4) et **Google**
(`signInWithOAuth` + navigateur système `expo-web-browser`, retour par lien
profond). Le mappage d'erreurs GoTrue est celui du web (`authErrorKey`) : le
texte brut ne remonte jamais. **Apple est M1c — aucune fondation posée.**

À l'arrivée d'une session, la racine synchronise l'onboarding local →
`customer_profiles` (`profileSync.ts`) : `firstName → display_name`,
`frequency → haircut_frequency` (enum verbatim), `completedAt →
onboarding_completed_at`. **`upsert` sur `user_id`** (la ligne peut ne pas
exister), et **ne remplit que les trous** — la base n'est jamais écrasée. Le
`gender` reste local (aucune colonne, manque déclaré M1a). Écrire cette ligne
émet le Fade Passport par trigger (« devenir client, c'est avoir un Passport »).

---

## 4. Le feed — déduplication, pagination, chemin de réservation

Première interface du module social (le backend B4 existait sans aucune UI,
nulle part). `get_feed`, accessible **anonyme** (`liked_by_me` toujours false ;
`10-feed`, `61-feed-liked`).

**Déduplication : structurelle côté backend** — un post est une ligne, les
follows sont des `exists`, un client qui suit un pro *et* son salon ne voit pas
le post deux fois. Le client garde une **défense par `post_id`**
(`dedupeFeedPages`) pour le seul cas de frontière (deux posts au même
`created_at`).

**Pagination au curseur temporel** : le piège du contrat est que la page est
*sélectionnée* par `created_at desc` puis *re-triée par score* — le curseur de
la page suivante est donc **`min(created_at)` de la page**, pas la dernière
ligne affichée. `nextFeedCursor` l'implémente, testé (`feedPage.test.ts`,
10 cas).

**Chaque post à service actif lié expose un chemin vers la réservation**
(`bookTargetForPost`) — la seule justification du module : `31-book` s'ouvre
avec le service prérempli. Sans salon attribuable **ou** sans service actif,
**pas de CTA** (jamais un bouton mort). Likes optimistes (`like_post`/`unlike_post`,
« optimisme réservé au social », D1) réparés par invalidation. **Aucun
commentaire, aucun hashtag, aucune publication client.** Médias signés depuis
le bucket privé (`useSignedPostMedia`), vidéo via `expo-video` ; média manquant
= monogramme de marque, jamais une fausse image.

---

## 5. Hors connexion — ce qui s'affiche, ce qui est masqué

Décision fondateur (§3) : **l'app affiche un état hors connexion, jamais de
donnée périmée.** NetInfo alimente `onlineManager` de TanStack Query (les
requêtes se suspendent et repartent au retour) et un bandeau discret
(`70-offline-home` : « Hors connexion — rien ne peut se mettre à jour »).

Les écrans réseau **refusent le périmé** : le suivi de file et la consultation
affichent `OfflineBlock` (« Cet écran a besoin du réseau… Rien d'ancien ne
vous sera montré », `71-offline-queue`) **à la place** de la position — un
chiffre vieux de dix minutes enverrait le client alors qu'il a déjà été appelé
et manqué. La position n'a le droit d'exister à l'écran que si le réseau est
là. Ce qui reste consultable (contenu déjà chargé, langue) reste ; ce qui
dépend d'un rafraîchissement dit honnêtement qu'il ne peut pas se mettre à jour.

---

## 6. Ce qui n'a pas pu être testé, et ce que M1c reprend

**Faute d'iPhone / macOS sur ce VPS** (déclaration M1a, toujours vraie) :

- **Le scan QR natif** (`CameraView`) **ne rend pas en react-native-web** — la
  feuille de join et son flux sont vérifiés, mais le scan réel, l'haptique et
  `useKeepAwake` attendent l'appareil.
- **Le lancement Expo Go réel**, les gestes tactiles à 120 Hz, VoiceOver, le
  ressort de la feuille et de la coche de confirmation en mouvement réel.
- **Le rendu du fond sombre sur écran OLED** (approximé fidèlement en web).

**Faute de compte développeur Apple** (bloque M1c, pas M1b) : Sign in with
Apple, liens universels, push réels, publication TestFlight/App Store — rien
n'a été commencé, conformément au périmètre. **Prévoir la validation du compte
AVANT M1c.**

**Trouvaille de production (bloquante pour l'envoi d'e-mails, pas pour ce
lot) :** GoTrue répond `500 "550 You have reached your daily email sending
quota"` — **le quota Resend quotidien est épuisé en production**. L'inscription
légère par OTP e-mail ne peut donc pas boucler aujourd'hui (`34-book-otp` :
« L'e-mail n'a pas pu être envoyé »). La QA du parcours connecté a été menée
avec une **vraie session GoTrue** posée via le lien de vérification admin
(`generate_link`) — seul l'e-mail n'a pas pu partir ; le code de l'app est
correct. **À traiter par le fondateur/X1** (relever le quota Resend), hors
périmètre M1b.

---

## 7. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (mobile, TS strict) | **0 erreur** |
| `npm test` (mobile, vitest) | **163/163, 18 fichiers** — dont 44 hérités des copies verbatim (booking/queue refusals, deadline, slots, queueLink) verts tels quels, `tracking.test.ts` (18 : anti-négatif, deadlinePassed, `_zero`, terminaux, removedAuto/manual), `requestCopy.test.ts` (garde de langue FR+EN, 2 états), `partition.test.ts`, `feedPage.test.ts` (10 : curseur min, dédup, chemin réservation), `prefs.test.ts` (10) |
| `npm run lint` (mobile) | **0 erreur**, 6 avertissements (tous préexistants sur les copies verbatim `discovery.ts`, `publicQueue.ts`, `slots.ts` et l'usage standard i18next — aucun sur un fichier neuf) |
| `npm run check:drift` | **aucune dérive** — 30 fichiers sous garde (verbatim + adaptés déclarés) |
| `npx expo export --platform ios` | **vert**, bundle Hermes **5,7 Mo** |
| Vérification visuelle (rendu web, Chromium 390 + 430) | **40 captures FR/EN**, données de production réelles, **0 erreur console, 0 requête en échec** sur toutes les passes (file, réservation, feed, compte, hors connexion, profils) |
| **Non-régression `apps/web`** | `typecheck` **0 erreur** · `test` **687/687, 79 fichiers** · `build` **vert** (avertissement de chunks préexistant, D1 §11) |

Vérification manuelle documentée, écran par écran (rendu web, FR puis EN) :
consultation de file (2 personnes réelles, estimation absente car non fiable),
feuille de rejoindre (files par barber, e-mail facultatif, présence exigée
dite), suivi en fond sombre (position 3, « premier disponible »), l'appel
(panneau vert, compte à rebours 4:52), quitter/changer avec avertissements,
tunnel (service → premier disponible → créneau → récap), confirmation sombre
(coche + récap), demande envoyée (badge « En attente de confirmation »,
échéance qui défile), mes réservations (contre-proposition en tête, file
active position 4, à venir), détail/annulation, demande d'intérêt (préférence
non garantie), profil non revendiqué (« Demander un créneau » actif), feed
(like optimiste, source « Vous suivez »), compte (profil, Passport réservé,
favoris/abonnements vides honnêtes, langue), hors connexion (bandeau + blocs).

---

## 8. `apps/web` et `/platform` intacts — preuve

- `git status --porcelain` : les seuls chemins touchés sont `apps/mobile/**`
  (dont `.env.local`, non versionné) et `docs/reports/**`. **Zéro fichier
  `apps/web`** (`git status --porcelain apps/web` → vide). X2 peut continuer
  sans moi.
- La non-régression web (§7) a tourné sur CE worktree après tout le lot.
- `/platform` : aucun code touché, aucune migration.
- **Base :** aucune migration. Écritures QA uniquement (entrées de file et
  rendez-vous de test via les RPC publiques + fixtures `demo-*`/`qa-f1b-shared`),
  **toutes nettoyées** en fin de campagne (résidus vérifiés à zéro). La
  fixture `qa-f1b-shared` a été réactivée puis re-neutralisée (« ZZ dead »)
  selon le protocole éprouvé F1b.

---

## 9. Git

- Branche **`m1b/ios-transactions`**, worktree `~/worktrees/m1b`.
- Ajouts **explicites par chemin** (`git add apps/mobile docs/reports/...`) —
  aucun `git add .`/`-A`, aucun `reset --hard`, aucun `clean`, aucun
  `docker prune`, **aucune fusion**.
- Deux commits : `feat(m1b)` (resynchro + fondation + 5 surfaces) et
  `fix(m1b)` (bandeau hors connexion en survol + 40 captures). Poussée après
  le commit du rapport.

---

## 10. Décisions prises seul, et erreurs déclarées

**Décisions :**

1. **Copies verbatim de la logique F1/F1b/F4/P1PRO sous la garde de drift**
   (19 fichiers + tests) plutôt que réécriture — le contrat de non-dérive M1a.
   `localQueueEntry.ts` adapté à AsyncStorage (async), sha du web figé.
2. **Tokens `moment` complétés depuis `tokens-moment.css`** (M1a n'en avait
   posé que 2 sur ~15) — le web fait foi pour les valeurs.
3. **`StateBadge` natif avec prop `dark`** pour les moments sombres — le web
   change de palette par thème CSS, le natif reçoit `dark`.
4. **Auth légère = OTP e-mail + Google, PAS Apple** — Apple exige le compte
   développeur (M1c). Google via `signInWithOAuth` + navigateur système, le
   seul chemin compatible Expo Go.
5. **`MomentButton` local à la file** (constructeur file) — `shared/ui/Button`
   n'a pas de palette sombre ; **suivi recommandé** : ajouter un `dark` à
   `Button` et supprimer ce fichier.
6. **Bandeau hors connexion en survol absolu** après le `Stack` — un frère du
   navigateur cassait la mise en page de react-native-screens (constaté en QA).
7. **QA du parcours connecté avec session GoTrue réelle posée hors-e-mail** —
   contournement du quota Resend épuisé (§6), pas une falsification : la
   session est authentique.
8. **`.env.local` du worktree** créé avec la clé anon courante
   (`infra/supabase/.env`) — le bundle de production sert encore une clé
   périmée (défaut M1a §11.1, toujours ouvert).

**Erreurs commises, déclarées :**

1. **Premier harnais de QA en mode `serve` non-SPA** → 404 sur les routes
   profondes ; corrigé en `serve -s`. Aucune capture fausse livrée.
2. **Bandeau hors connexion d'abord monté avant le `Stack`** → écran blanc en
   rendu (react-native-screens) ; déplacé après et posé en absolu (décision 6).
3. **Fixtures QA d'abord pointées sur `qa-f1b-shared`** (0 service) puis sur les
   orgs `demo-*` complètes — perte de temps, aucune donnée fabriquée.

---

## 11. Cases non cochées, avec la raison exacte

- **« L'application se lance dans Expo Go sur un iPhone réel »** — non
  vérifiable sur ce VPS. Substituts : export Hermes iOS vert + 40 captures du
  même code en rendu web. Procédure fondateur dans `apps/mobile/README.md`.
- **« Captures prises dans Expo Go »** — ce sont des rendus react-native-web,
  étiquetés comme tels.
- **Scan QR natif rendu** — `CameraView` ne rend pas en web ; le flux est
  vérifié, le scan réel attend l'appareil.
- **Inscription OTP e-mail bout-en-bout** — quota Resend épuisé en production
  (§6) ; le code est correct, l'envoi ne peut pas partir aujourd'hui.
- **Suppression de compte en libre-service (MASTER_SPEC §16)** — **aucune RPC
  `delete_my_account` n'existe en base** ; livrée en point d'entrée honnête
  (Sheet qui dit la vérité, aucun appel), le chantier base est requis et
  interdit dans ce lot.
- **Salons suivis avec nom** — `list_my_followed_organizations` ne renvoie que
  `organization_id` (manque de contrat) ; rendu en **compteur honnête**, pas de
  N+1 aveugle, pas de nom inventé.

---

## 12. Ce que M1c devra trancher

1. **Sign in with Apple, liens universels, push réels, publication** — tout le
   périmètre M1c, dépendant du compte développeur Apple (à valider AVANT le lot).
2. **Le push est la vraie fermeture de l'appel de file** : sans lui, un
   téléphone verrouillé n'est pas prévenu ; `useKeepAwake` ne compense que
   l'app au premier plan.
3. **Google natif complet** (`@react-native-google-signin`) si l'on quitte
   Expo Go pour un dev build — aujourd'hui `signInWithOAuth` + navigateur.
4. **Le viewer de post plein écran (D1 §12.3, P4)** — la carte de feed est une
   composition inédite (aucun précédent web), à ratifier ; ouvrir un post mène
   au profil, pas encore à un viewer dédié.
5. **`MomentButton` → `dark` sur `shared/ui/Button`** (décision 10.5).
6. **Retrait d'une demande d'intérêt** — aucune RPC (hérité F4), la ligne
   expire seule.
7. **Contrats base à créer** (hors périmètre, migrations interdites ici) :
   `delete_my_account`, `list_my_followed_organizations` élargie (nom/slug),
   colonne `gender`, quota Resend, redéploiement web (clé anon périmée).

---

**Gate R5R rappelé** : ce lot passe la vérification technique accessible à
cette session (typecheck, tests, drift, export iOS, 40 captures propres,
non-régression web) ; le lancement Expo Go sur appareil réel et la validation
produit restent au fondateur. **Aucune fusion n'a été effectuée. Fin du
rapport.**
