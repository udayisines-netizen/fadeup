# FadeUp — Rapport final M1a : application iOS, socle + onboarding + recherche + profils

Branche `m1a/ios-foundation` (depuis `rebuild/social-first-v2`), 2026-09-08.
`apps/web` **non modifié** (P1PRO tourne en parallèle dessus — preuve §8).
**Aucune migration. Aucune fusion.**

**DÉCLARATION EN TÊTE — la limite de vérification de ce lot.** Cet hôte est
un VPS Linux : il n'a ni iPhone, ni macOS, ni simulateur iOS. Le critère
« l'application se lance dans Expo Go sur un iPhone réel » et les « captures
Expo Go » **ne peuvent pas être produits par cette session**. Ce qui a été
prouvé à la place, sans supposition : le bundle **iOS Hermes compile**
(`npx expo export --platform ios`, .hbc de 5,3 Mo, trois exports verts au fil
du lot), et **chaque écran a été vérifié visuellement dans le rendu
react-native-web du MÊME code** (Chromium 390×844, données de production
réelles via `https://fade-up.com`, FR et EN, réduction d'animations —
31 captures dans `docs/reports/artifacts/m1a/`, étiquetées comme telles).
La vérification Expo Go réelle revient au fondateur : `README.md`
d'apps/mobile donne la procédure exacte (`npx expo start --tunnel` depuis ce
VPS). Ne pas confondre ces captures avec des captures d'appareil.

**Captures** (`docs/reports/artifacts/m1a/`, 390×844, données réelles) :
`01–04 onboarding` (accueil, prénom, genre, fréquence) · `05 home` ·
`06 search-list` · `06b filters-sheet` · `06c map-mode` (remplaçant web
déclaré — la carte native est Apple Maps) · `07 result-sheet` ·
`08 shop-profile` (bannière réelle) · `09 pro-profile` (modèle X complet) ·
`10 shop-no-media` (side-agency, le cas nominal du scrapé) ·
`11 home-recent` (mémoire locale) · `12–13 reduced-motion` ·
`14 book-placeholder` · `15 feed-placeholder` · `16 account-language` ·
suffixe `-en` : la passe anglaise complète.

---

## 1. La pile retenue

| Choix | Valeur | Justification |
|---|---|---|
| Expo | **SDK 57.0.20** (gabarit `create-expo-app` du jour) | le SDK stable courant — Expo Go n'accepte que lui ; RN 0.86.3 |
| React | **19.2.3** | même famille que le web (19.2.8) : le code partagé ne rencontre aucune surprise |
| Routeur | **expo-router ~57** (fichiers, `src/app/`, typed routes) | exigé par le prompt ; `Stack.Protected` porte la porte d'onboarding |
| Data | **TanStack Query 5** + fabriques de clés | comme le web — `keys.ts` copié VERBATIM |
| Supabase | `@supabase/supabase-js` 2.116 + AsyncStorage + url-polyfill | singleton typé sur `database.types.ts`, importé par `features/*/api` et `shared/data` seulement |
| i18n | i18next/react-i18next + expo-localization | namespace `v2`, catalogues web copiés verbatim + section `mobile` |
| Motion | Reanimated 4.5 + gesture-handler | ressorts natifs D1 ; `useReducedMotion` synchrone (le piège Framer web n'existe pas ici) |
| Carte | react-native-maps (Apple Maps) | fonctionne dans Expo Go sans clé ; langage F3 minimal (marqueurs accent, zéro cluster), déclaré non ratifié comme au web |
| Tests | vitest (Node) | la logique testée est pure — aucun simulateur requis |
| Icônes | Ionicons outline (@expo/vector-icons) | contour d'abord, épaisseur constante (MASTER_SPEC §17) |

**Aucune bibliothèque de composants tierce** : Sheet, Button, Badge, Avatar,
cartes, feuilles de filtres sont construits (M1a §5). La feuille est UNE
primitive (`shared/ui/Sheet`), utilisée par le résultat, les filtres et la
note « la connexion arrive ».

### Ce qui se partage avec le web — et comment

**Décision : COPIE, avec garde anti-dérive** (`scripts/check-shared-drift.mjs`,
branché dans `npm run check:drift`). Motif : aucun workspace npm n'existe à
la racine, et P1PRO travaille en parallèle sur apps/web — un import vivant à
travers les racines ferait casser le mobile par un lot qui n'en sait rien.
Le garde rend la dérive VISIBLE : les copies **verbatim** doivent rester
byte-identiques à l'original web ; les copies **adaptées** figent le hash de
l'original — s'il change, le script échoue et force une re-revue.

| Fichier | Régime |
|---|---|
| `database.types.ts`, `serviceState.ts`, `waitTime.ts`, `openingHours.ts`, `searchRanking.ts`, `data/keys.ts`, `data/discovery.ts`, `data/postMedia.ts` | **verbatim** (oui — même `discovery.ts`, la couche RPC de la recherche : ses imports résolvent aux mêmes alias) |
| `format.ts` | adapté : `import.meta.env.DEV` → `__DEV__` (Metro ne supporte pas import.meta) |
| `demoMedia.ts` | adapté : assets embarqués (voir §2 et §11.2) |
| catalogues i18n fr/en (11 sections) | verbatim, vérifiés section par section par le garde |
| `recentlyViewed` → `recentProfiles.ts` | RÉÉCRIT (même clé `fu.recentProfiles.v1`, même forme, même plafond de 8) : localStorage synchrone ne se copie pas vers AsyncStorage asynchrone |

Ne se partage pas : CSS/Tailwind/composants web — le thème D1 est TRANSPOSÉ
dans `shared/theme/tokens.ts` (la table de correspondance avec
`tokens-consumer.css`, valeurs identiques).

## 2. La transposition de D1

**Tel quel** : la palette entière (#F6F8F7 papier, #00C27A accent, encre
#080F0D, vert texte approfondi #007A52), la hiérarchie de rayons
(contrôle 8 / carte 16 / média 10 / feuille 20), l'échelle typographique
(12 badges seulement / 14 plancher / 16 / 20 / 24 / 32 / 44), Poppins
400–700 auto-chargée (expo-font), **Geist Mono + tabular-nums sur tout
chiffre** (prix, distances, horaires, handle), **encre sur vert pour tout
CTA vert** (le blanc sur vert n'existe nulle part — vérifié sur les
captures : onboarding, feuille, profils), la carte de résultat
(mini-bannière 84 px, portrait en surimpression, UN badge d'état,
« disponible maintenant » PRIME sur ouvert/fermé, repli composé au
monogramme), la feuille de résultat (bannière + portrait + badges →
identité → revendication → ≤ 4 services aux prix réels → LE CTA selon
l'état réel → profil complet), le modèle X, les moments de motion
(ressort 420/36 de la feuille, stagger 45 ms/index plafonné à 8,
pression scale .985 en 120 ms), la réduction d'animations (fondus < 100 ms,
zéro translation — prouvé par la passe dédiée).

**Ce que le natif rend différemment** (l'intention, pas la déclaration —
M1a §4) : les ombres CSS multicouches deviennent `shadow*` iOS +
`elevation` Android, teintées d'encre, avec l'échelle D1 complète
(card / card-pressed / sheet / sticky) — et la contrainte iOS
« ombre et overflow:hidden ne cohabitent pas » impose une enveloppe
porteuse d'ombre + un intérieur rogné sur carte et feuille. La feuille est
un vrai geste natif : suivi du doigt en direct (Pan), seuil de 90 px OU
vélocité, retour en ressort — le contrat exact du geste manuel que D1 avait
dû réécrire à la main côté web. `prefers-reduced-motion` devient
`useReducedMotion` de Reanimated — SYNCHRONE au premier rendu, le cadre de
translation fuyant du hook Framer n'existe pas ici. Les propriétés logiques
CSS deviennent `insetInlineStart/End` (aucun `left:`/`right:` dans le code,
RTL préservé). Les tokens du thème `moment` sont POSÉS dans tokens.ts pour
M1b — aucun écran M1a ne les rend, conformément au contrat.

**Arbitrages déclarés** :
1. **La transition partagée du portrait carte→profil n'est PAS transposée**
   (View Transitions web → `sharedTransitionTag` Reanimated, encore
   expérimental et instable sous la nouvelle architecture). Le parcours
   carte→feuille→profil garde ressort + stagger ; la transition partagée
   est consignée pour M1b plutôt que livrée fragile.
2. **La barre collante du modèle X** utilise le seuil de défilement natif
   (`onScroll` vs position mesurée de la paire inline) — l'équivalent
   fonctionnel du `useInView` web : jamais deux verts pleins visibles.
3. **Libellés de la nav basse à 12 px Medium** — la convention exacte du
   web D1 (`text-fu-xs` mesuré dans ConsumerShell), seul texte de ce corps
   hors badges.

## 3. L'onboarding

Trois questions, une PAR ÉCRAN (routes natives — le geste de retour iOS
marche), progression visible, chaque question passable, plus « Explorer
sans répondre » dès l'accueil. **Aucun mur de connexion** — il n'existe
d'ailleurs AUCUN écran de connexion dans l'app (M1b). Après la troisième
réponse : **le résultat immédiatement** — la porte se referme
(`Stack.Protected`) et l'accueil s'ouvre sur la découverte réelle.

| Question | Stockage | Contrat base |
|---|---|---|
| Prénom | local (`fu.onboarding.v1`, AsyncStorage) | → `customer_profiles.display_name` en M1b |
| Genre (optionnel, « peu importe », finalité déclarée À L'ÉCRAN : orienter barbershop/salon mixte, réponse qui reste sur l'appareil) | local | **AUCUNE colonne en base** (mesuré sur customer_profiles : display_name, phone, email, haircut_frequency, style_preference, style_notes, appointment_preference — pas de genre). Manque déclaré, pas comblé |
| Fréquence de coupe | local, **valeurs = l'enum `customer_haircut_frequency` VERBATIM** (weekly, every_2_weeks, every_3_weeks, monthly, less_often, depends) — testé contre les types générés : toute dérive casse la compilation | → `customer_profiles.haircut_frequency` en M1b, sans table de traduction |

Pourquoi tout est local : M1a est entièrement anonyme — il n'existe aucun
compte où écrire. La synchronisation locale → `customer_profiles` à la
première connexion est UN DES contrats que M1b devra construire (§12).

## 4. La recherche

**Paramètres câblés** : les 11 de F3 (`p_query`, `p_city`,
`p_service_query`, `p_latitude/longitude`, `p_radius_km`,
`p_min/max_price_cents`, `p_open_now_only`, `p_sort`, `p_limit/offset`) —
et **`p_entity_type: 'shop'` TOUJOURS, écrit par la couche partagée
`shared/data/discovery.ts`** (copie verbatim du web : le seul module qui
parle à la RPC), jamais délégué au défaut distant. Aucun barber salarié ne
peut être un résultat autonome. `p_country` reste non câblé (même raison
que F3 : aucune surface de choix de pays).

**Ce qui remplace l'état d'URL** : `features/discovery/searchState.ts` —
l'état vit dans l'écran (useState), et CE module pur porte la traduction
état → arguments RPC (défauts OMIS, coordonnées arrondies à 4 décimales
≈ 11 m, euros saisis → centimes, « disponible maintenant » jamais envoyé —
c'est un filtre CLIENT sur l'état réel). C'est lui qui est testé (18 cas).

**Comportements F3 conservés** : liste par défaut, carte en MODE ; filtres
en feuille native (brouillon local, appliqué d'un geste) ; « le plus
proche » retiré sans point de recherche ; classement client
(`searchRanking.ts` verbatim) appliqué UNE FOIS les états de service
résolus, jamais rebrassé sous le doigt, jamais sur un tri serveur ;
« disponible maintenant » = lieu OUVERT **et** file accessible, borné
honnêtement aux pages chargées (compte partiel dit tel quel) ; géoloc au
seul geste « Autour de moi » (expo-location, permission demandée LÀ),
refus = note calme + la recherche par ville entière.

**Zéro résultat** : le zéro se dit avec sa raison contextuelle et ses
actions (effacer la recherche, retirer le filtre, chercher au-delà de la
ville) ; autour d'un point, élargissement **25 puis 50 km** en sections
SÉPARÉES ET ÉTIQUETÉES, chaque carte portant sa distance réelle ; les
lignes **sans coordonnées ne remplissent jamais la zone** (section « à
distance inconnue », leçon F3 §4.5) ; le repli style→service se déclenche
à zéro résultat seulement, en section déclarée. Jamais un résultat inventé.

**Un tap ouvre la FEUILLE** (toute la carte est le bouton), la liste reste
dessous — Modal transparent : la position de défilement est préservée par
construction. Le profil complet est un geste de plus.

## 5. Les profils

**`/pro/[handle]`** — modèle X, ordre imposé tenu (capture 09) : bannière →
portrait en surimpression (ring canvas) → nom → revendication + handle
mono → accroche → **« Travaille chez [Salon] » cliquable** (supprimé pour
un indépendant : sa page fusionne profil et établissement — le cas est
traité) → localisation (adresse OU zone qui « se dit », jamais un point
inventé) → signaux opérationnels réels (« File ouverte » depuis
`get_public_service_state`) → bio → **cinq métriques sur UNE ligne**
(Followers réels / Verified Clients « — » sans contrat / Rating null → « — »
/ Reviews comptées / Likes « — » — la distinction F2 zéro-compté vs
sans-contrat, visible sur la capture : `1 · — · — · 0 · —`) → **CTA
Réserver + Suivre INLINE** → services (prix mono, devise réelle) →
réalisations (chaîne B4, médias signés par l'anonyme, tranche de 30) →
avis. Chaîne de résolution F2 complète : `by_handle` → `workplace` (VIDE
pour un non revendiqué — frontière B1) → `get_public_barber` + services +
état par-barber, poll 30 s ; repli de lieu quand `location_id` du staff est
NULL ; **le CTA ne ment jamais pendant la résolution** (état `loading`
distinct — la leçon de la revue F2, reprise d'entrée).

**`/shop/[slug]`** — imagerie du lieu → identité → **note SEULEMENT si
réelle** (« Pas encore d'avis » sinon — jamais zéro étoile) → adresse +
état d'ouverture calculé dans le FUSEAU DU LIEU (`openingHours.ts`
verbatim ; null = aucun état affiché) → métriques → CTA → services groupés
par catégorie réelle → équipe (lien `/pro` pour les seules identités
REVENDIQUÉES — rien d'inventé pour les autres) → réalisations → avis →
horaires (semaine TOUJOURS à 7 jours, « non renseigné » ≠ « fermé »).

**Le média manquant est traité en premier** : bannière absente = surface
douce + monogramme décoratif ; portrait absent = initiales déterministes ;
média de post qui ne signe pas = cadre « pas encore de photo ». La capture
10 (side-agency, organisation réelle sans aucune image) fait foi.

**Le CTA reflète l'état réel** (`deriveProfileCta` verbatim) et **mène à
M1b honnêtement** : `book/[slug]` et `q/[slug]` sont des écrans qui NOMMENT
leur lot et ramènent (capture 14) — jamais un bouton qui ne fait rien.
**Suivre** (session requise — M1b) ouvre une feuille « La connexion
arrive » qui dit le lot et que tout reste consultable : le seul traitement
honnête d'une action dont le prérequis n'existe pas encore.

**Ce qui attend M1b/suivants** : Suivre réel, revendication (« C'est moi »),
file en direct sur le profil salon (F1b), viewer de posts (P4), demande
d'intérêt vers non revendiqué (F4), transition partagée du portrait.

L'accueil (D1 §7, cas anonyme — le seul qui existe sans compte) :
recherche → « Vous avez consulté » (AsyncStorage `fu.recentProfiles.v1`,
écrit par les deux pages de profil, relu à chaque focus, **jamais envoyé au
serveur**) → « À découvrir » (six résultats réels, classés par
disponibilité réelle une fois les états résolus, cartes + feuille).
Première visite : recherche + découverte, AUCUNE section vide (capture 05).
« En cours », suivis et l'invitation à créer un compte arrivent avec M1b
(il n'existe ni session ni file côté app). Aucune géolocalisation à
l'ouverture — « Autour de moi » vit sur Recherche, à un tap.

## 6. Ce qui n'a pas pu être testé faute de compte développeur Apple — et le reste

Le compte développeur ne bloque RIEN de M1a (Expo Go n'en exige pas) ; il
bloque M1c : Sign in with Apple, liens universels, push réel, publication
TestFlight/App Store — rien de tout cela n'a été commencé, conformément au
périmètre. Implication pour M1c : prévoir la validation du compte AVANT le
lot, sinon M1c ne peut ni tester ses entitlements ni publier.

**Limite de CETTE session, distincte** (déclaration en tête) : pas
d'iPhone → pas de lancement Expo Go réel, pas de carte Apple Maps rendue,
pas de gestes tactiles réels (glissement de feuille, ressorts à 120 Hz),
pas de VoiceOver. Le code compile pour iOS et chaque écran est vérifié en
react-native-web ; la passe d'appareil du fondateur est le vrai gate.

## 7. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (mobile, TS 6 strict) | **0 erreur** |
| `npm test` (mobile, vitest) | **58/58, 8 fichiers** — searchState (18 cas : défauts omis, arrondi 4 décimales, euros→centimes, « disponible maintenant » jamais dans les args, distance inconnue hors zone), serviceState/waitTime/openingHours/searchRanking/keys COPIÉS du web et verts tels quels, formatage (centimes entiers qui jettent sur un euro décimal, prix null ≠ zéro, devise non résolue → null), enums d'onboarding verrouillés sur les types générés |
| `npm run lint` (eslint config Expo + React Compiler) | **0 erreur**, 4 avertissements documentés (2 sur la copie verbatim `discovery.ts` — intouchable par contrat de non-dérive — et 2 `import/no-named-as-default-member` sur l'usage standard d'i18next) |
| `npm run check:drift` | **aucune dérive** entre les copies et apps/web |
| `npx expo export --platform ios` | **vert** (bundle Hermes 5,3 Mo) — trois fois au fil du lot, la dernière après le dernier changement |
| Vérification visuelle (rendu react-native-web du même code, Chromium 390×844) | **11 écrans × FR + EN + 2 passes reduced-motion + 3 placeholders = 31 captures**, données de PRODUCTION réelles (9 établissements par `search_public_professionals` via https://fade-up.com), **0 erreur console, 0 requête en échec** sur les passes finales ; aucune clé i18n brute visible en FR ni EN |
| Accessibilité (dans le code, à re-vérifier sur appareil) | rôles et libellés (`accessibilityRole/Label/State`) sur boutons, cartes, radios, progression, feuille ; cibles ≥ 44 px (`touchTarget` token) ; réduction d'animations : fondus < 100 ms, zéro translation (passe dédiée, captures 12–13) ; jamais la couleur seule (badges portent texte + point) |
| **Non-régression apps/web** | `npm run typecheck` **0 erreur** · `npm run test` **687/687, 79 fichiers** · `npm run build` **vert** (avertissement de taille de chunks préexistant, D1 §11) — et `git status` : **zéro fichier modifié hors apps/mobile et docs/reports** |

Vérification manuelle documentée, écran par écran (rendu web, FR puis EN) :
onboarding 4 écrans (saisie, sélections, passage, progression), accueil
(1re visite sans section vide, puis mémoire locale), recherche (9 résultats
réels, prix mono, badges d'état, non revendiqué neutre), filtres (feuille,
brouillon, tri sans « le plus proche » hors point), carte (remplaçant web —
la vraie carte est native), feuille de résultat (services réels, CTA selon
l'état, fermeture), profil salon (bannière réelle, note honnête, horaires
7 jours), profil barber (modèle X entier), side-agency (zéro média, repli
soigné), placeholders honnêtes (book, q, feed, réservations, compte),
langue (bascule persistée dans Compte).

## 8. `apps/web` et `/platform` intacts — preuve

- `git status --porcelain` sur tout le dépôt : les SEULS chemins touchés
  sont `apps/mobile/**` (nouveau) et `docs/reports/**` (rapport +
  captures). **Zéro fichier d'apps/web** — P1PRO peut fusionner sans moi.
- La non-régression web (§7) a tourné sur CE worktree après tout le lot.
- `/platform` : aucun code touché ; production vérifiée en passant —
  `GET https://fade-up.com/ → 200`. Aucune écriture en base (lot 100 %
  lectures publiques), aucune migration, aucun conteneur redémarré.

## 9. Git

- Branche **`m1a/ios-foundation`**, worktree dédié `~/worktrees/m1a`.
- Ajouts EXPLICITES par chemin (`git add apps/mobile docs/reports/...`) —
  aucun `git add .`/`-A`, aucun `reset --hard`, aucun `clean`, aucun
  `docker prune`, **aucune fusion**. Poussée après le commit du rapport.
- Commits : socle (projet Expo, thème, i18n, data, primitives) · écrans
  (onboarding, onglets, recherche, profils, accueil) · docs (rapport +
  captures). Détail exact dans `git log`.

## 10. Décisions prises seul

1. **Copie + garde anti-dérive plutôt qu'import inter-paquets** (§1) — la
   décision structurante du lot, motivée par l'absence de workspace et le
   lot P1PRO parallèle sur apps/web.
2. **SDK 57 depuis le gabarit officiel du jour** — c'est le seul SDK
   qu'Expo Go accepte ; React 19.2 aligne le partagé sur le web.
3. **`https://fade-up.com` comme API de l'app** — la seule origine
   atteignable depuis un iPhone réel ; vérifiée fonctionnelle (RPC 200 avec
   la clé anon courante) avant d'écrire une ligne d'écran.
4. **Feuille construite à la main** (Reanimated + gesture-handler), pas
   @gorhom/bottom-sheet : « les primitives se construisent » (M1a §5) ; le
   geste porte sur la zone d'en-tête/hero (le contrat web D1 exact), ce qui
   évacue le conflit geste-vs-défilement du corps.
5. **Suivre → feuille « la connexion arrive »** (§5) — l'action sociale
   sans session n'a pas de chemin honnête avant M1b ; une feuille qui nomme
   le lot vaut mieux qu'un bouton mort ou un mur.
6. **Genre demandé comme genre** (« Vous êtes… ? », homme/femme/peu
   importe) avec finalité affichée — le prompt spécifie la donnée ; la
   reformuler en préférence de salon aurait collecté autre chose.
7. **Médias de démonstration EMBARQUÉS** (~500 Ko d'assets `demo-*`,
   retirables) — voir la découverte §11.2 : aucune origine distante ne les
   sert aujourd'hui.
8. **Image cœur de React Native plutôt qu'expo-image** — le backend fetch
   d'expo-image sur le véhicule web de QA tombait sous l'ORB de Chromium
   (cross-origin) ; l'Image cœur rend `<img>` sur web et l'API native sur
   iOS, comportement identique partout, transitions perdues négligeables.
9. **Compte porte la bascule de langue dès M1a** — le choix explicite
   persistant est une exigence transverse de globalisation ; l'écran reste
   par ailleurs le placeholder honnête de M1b.
10. **`web.output: "single"`** (SPA) — la sortie web n'est qu'un véhicule
    de QA ; le rendu statique SSR d'Expo exécutait les modules sous Node où
    AsyncStorage attend `window` (corrigé ET contourné).
11. **Le mode carte web est un remplaçant déclaré** (`MapMode.web.tsx`) —
    react-native-maps n'a pas d'implémentation web ; le remplaçant DIT
    l'absence au lieu de casser le bundle de QA.

### Erreurs commises, déclarées

1. **Deux libellés en dur ont existé** dans la primitive Sheet
   (accessibilité française codée en dur) avant d'être basculés sur le
   catalogue — attrapés en relecture, corrigés avant toute campagne.
2. **Mon premier `Continuer` de QA cliquait un écran DÉMONTÉ À L'ÉCRAN
   mais monté au DOM** (expo-router garde la pile) — le script cliquait
   l'occurrence invisible et échouait ; corrigé par un filtre de
   visibilité. Leçon consignée pour les futurs scripts natifs.
3. **`ResultCard`/`ResultSheet` sont nés dans features/discovery** puis ont
   été déplacés vers shared/ui quand l'accueil en a eu besoin — la
   frontière `features/X ↛ features/Y` l'exigeait (même trajectoire que le
   web F3 ; l'erreur a vécu quelques minutes, le lint Expo ne la gardait
   pas encore).
4. **OrganizationProfileScreen a importé BackButton depuis
   features/professional-profile** — violation franche de la frontière,
   corrigée en déplaçant la primitive vers shared/ui.
5. **La première capture d'élévation cachait un vrai défaut iOS** : ombre
   et `overflow: hidden` posés sur la MÊME vue (l'ombre serait invisible
   sur appareil alors que le rendu web la montrait) — restructuré en
   enveloppe + intérieur sur carte ET feuille avant toute vérification.

## 11. Défauts PRÉEXISTANTS découverts, hors périmètre, non corrigés

1. **La production web sert une clé anon PÉRIMÉE — l'API répond 401 à tout
   le trafic anonyme de `https://fade-up.com`.** Mesuré : le bundle déployé
   porte une `VITE_SUPABASE_ANON_KEY` dont la queue (`…usWF6jwA`) ne
   correspond pas à la clé en vigueur (`…wX58KBlU` dans
   infra/supabase/.env) ; un POST RPC avec la clé du bundle → **401**, avec
   la clé courante → 200. La clé a tourné (l'épisode « clé anon périmée »
   de F1b) et la build de production n'a jamais été redéployée depuis.
   **La marketplace web publique est donc cassée en production
   aujourd'hui** — un redéploiement d'apps/web suffit. À traiter par le
   fondateur/X1, PAS par ce lot (interdit de toucher apps/web).
2. **`/demo-media` n'existe pas en production** : la build déployée est
   antérieure à D1 — l'URL des bannières répond le repli HTML de la SPA
   (content-type text/html). Conséquence assumée ici : assets embarqués
   (décision §10.7). Le redéploiement web (point 1) résoudra aussi cela ;
   le vrai contrat d'imagerie d'établissement (colonne + bucket + RPC,
   écart D1 §13.1) reste à créer et N'A PAS été créé ici — il exige une
   migration, interdite dans ce lot.

## 12. Cases non cochées, avec la raison exacte

- **« L'application se lance dans Expo Go sur un iPhone réel »** — NON
  VÉRIFIÉ par cette session : pas d'iPhone sur ce VPS (déclaration en
  tête). Preuves de substitution : export Hermes iOS vert + 31 captures du
  même code en rendu web. Procédure fondateur dans apps/mobile/README.md.
- **Captures « prises dans Expo Go »** — mêmes causes : les captures
  livrées sont le rendu react-native-web, étiquetées comme telles.
- **La carte native (Apple Maps)** n'a pas été rendue visuellement (stub
  web) ; le code MapMode est revu, mais marqueurs/région/callout attendent
  l'appareil.
- **Le contrat d'imagerie d'établissement en base** (héritée de D1 §13.1) :
  exige une migration — interdite ici. Toujours ouvert.
- **La colonne genre** n'existe pas en base : stockage local, synchro
  impossible à préparer au-delà (§3).
- **La transition partagée du portrait** : arbitrage §2.1, reportée.
- **Deux détails d'appareil à vérifier par le fondateur** : la troncature
  éventuelle du libellé d'onglet « Réservations » (12 px Poppins sur
  ~78 px par onglet) et le rendu de la tab bar avec l'encoche/home
  indicator — le rendu web les approxime.

## 13. Ce que M1b devra trancher (et que ce lot n'a pas pu)

1. **La synchronisation onboarding local → `customer_profiles`** à la
   première connexion (display_name + haircut_frequency mappent verbatim ;
   le genre attend une décision de colonne).
2. **Le moment de connexion** (rejoindre une file, réserver, suivre) et son
   parcours d'auth légère — la feuille « la connexion arrive » lui cède la
   place partout.
3. **La file native** (QR + géofence B1 : scanner, permission localisation
   au geste, huit motifs de refus) et les **moments sombres** (confirmation,
   suivi de file — les tokens `moment` attendent dans tokens.ts).
4. **Feuille et retour système** : la question D1 §12 (le retour ferme-t-il
   la feuille ?) est tranchée nativement pour Android (`onRequestClose`) ;
   le geste de retour iOS de la PILE pendant qu'une feuille est ouverte
   reste à arbitrer sur appareil.
5. **La transition partagée du portrait** quand `sharedTransitionTag`
   sortira de l'expérimental (ou un équivalent maison).
6. **La stratégie de rafraîchissement en arrière-plan** (le web polle
   l'état de service à 30 s ; sur mobile, le comportement en arrière-plan
   et au retour d'app doit être défini avec la file M1b).
7. Hérités et toujours ouverts : lecture groupée de disponibilité (N+1
   d'états — 20 lieux = 20 appels, comme le web), taxonomie de styles,
   géocodage des villes, langage visuel de la carte, sémantique
   `is_managed` v2 à ratifier.

---

**Gate R5R rappelé** : ce lot passe la vérification technique accessible à
cette session ; le lancement Expo Go sur appareil réel et la validation
produit restent au fondateur. **Aucune fusion n'a été effectuée. Fin du
rapport.**
