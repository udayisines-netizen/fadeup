# PERF — Le chargement initial : rapport final

Branche `perf/initial-load` (depuis `rebuild/social-first-v2` @ `3a0f5e4`).
Frontend web uniquement. Aucune migration, aucun changement visuel voulu,
`apps/mobile` intouché, aucune fusion.

---

## 1. La cause exacte de l'aspiration statique

Deux causes cumulées, pas une.

**a) L'import statique de `PlatformLayout`** — `src/app/routes.tsx:3` :

```tsx
import { PlatformLayout } from '@/routes/platform-layout'
```

Toutes les PAGES `/platform` étaient paresseuses, mais leur LAYOUT était
importé en statique par la table de routes — donc par l'entrée.

**b) L'aspiration de fermeture par les règles `manualChunks`** — la cause
la plus profonde, et celle qui rendait le défaut invisible. Les règles P1b
(`vite.config.ts`) :

```ts
if (id.includes('/features/pro-') /* … */) return 'pro'
if (id.includes('/pages/platform-') /* … */) return 'platform'
if (id.includes('/features/marketing') /* … */) return 'marketing'
if (id.includes('node_modules/react')) return 'vendor-react'
```

Sous rolldown, chaque groupe aspirait la **fermeture de dépendances** de ses
modules. Mesuré dans la composition réelle des chunks (`dist/stats.html`) :
le chunk `pro` contenait `shared/observability/errorReporting.ts` (importé
par `main.tsx` !), `shared/lib/supabase.ts`, `RealtimeProvider`, `Toast`,
`useSession`… ; le chunk `marketing` contenait `i18n/index.ts`,
`ThemeProvider`, `Button`, `Spinner`, `EmptyState`. L'entrée, qui a besoin
de ces modules partagés, important alors **en statique** les chunks `pro`,
`platform` et `marketing` — et `platform` tirait `maplibre` (sa carte
acquisition) et `marketing`. D'où le graphe d'entrée AVANT dans
`dist/index.html` :

```html
<script type="module" src="/assets/index-*.js">        <!-- 39,4 Ko gz -->
<link rel="modulepreload" href="/assets/marketing-*.js"> <!-- 59,9 -->
<link rel="modulepreload" href="/assets/maplibre-*.js">  <!-- 237,8 -->
<link rel="modulepreload" href="/assets/platform-*.js">  <!-- 211,5 -->
<link rel="modulepreload" href="/assets/vendor-react-*.js"> <!-- 54,3 -->
<link rel="modulepreload" href="/assets/pro-*.js">       <!-- 35,6 -->
```

La règle `node_modules/react` (large) collait aussi react-hook-form,
react-remove-scroll, etc. — utilisés par des surfaces paresseuses seulement —
dans un chunk préchargé. Et le « budget » historique (chunk d'entrée seul,
93 Ko) ne voyait rien de tout cela : le chiffre de 87–93 Ko rapporté depuis
F3 n'a jamais correspondu à ce que le navigateur payait, parce que supabase,
tanstack, i18next et le reste voyageaient cachés dans les chunks aspirés.

### Correctifs

- `routes.tsx` : la route `platform` passe en `lazy` (le routeur résout les
  `lazy` des routes appariées en parallèle — un accès direct à `/platform/x`
  attendait déjà le module de sa page, aucun état de chargement nouveau).
- `vite.config.ts` : suppression des règles de groupe `pro` / `platform` /
  `marketing` (le découpage naturel par route suffit, toutes ces surfaces
  sont paresseuses) ; règle `vendor-react` resserrée au cœur
  (`react/`, `react-dom/`, `scheduler/`) ; `maplibre` (F3) et
  `vendor-supabase` conservés.
- La garantie « jamais dans l'entrée » n'est plus portée par l'empaquetage
  mais par une garde de build (§3).

---

## 2. Chiffres avant / après

### Graphe d'entrée statique (ce que `dist/index.html` précharge), gzip −9

| | AVANT | APRÈS |
|---|---|---|
| JS + CSS cumulés | **663,9 Ko** | **229,4 Ko** (−65 %) |
| Polices préchargées | 90,2 Ko (Poppins 23,1 + Geist 67,1) | 23,1 Ko (Poppins seule) |

AVANT (9 fichiers) : maplibre 237,8 + platform 211,5 + marketing 59,9 +
vendor-react 54,3 + index 39,4 + pro 35,6 + index.css 15,0 + platform.css
9,8 + runtime 0,4.

APRÈS (33 fichiers, les 10 premiers) : vendor-react 57,5 + vendor-supabase
51,9 + index 49,0 + index.css 15,0 + i18next 14,9 + tailwind-merge 8,6 +
tanstack-useQuery 7,4 + radix-toast 3,8 + react-i18next 2,7 + radix divers
~7. `platform`, `maplibre`, `marketing`, `pro`, `jsQR`, `zod` : absents
(vérifié par la garde qualitative sur la composition réelle des chunks, et
par zéro requête vers ces chunks sur les quatre routes mesurées).

### Transfert navigateur complet par route (Chromium 390 px, cache vide, gzip ; JS+CSS+polices+images+HTML, appels API exclus)

| Route | AVANT | APRÈS | Δ |
|---|---|---|---|
| `/` | 1 897,5 Ko | 764,8 Ko | −60 % |
| `/search` | 2 051,0 Ko | 1 005,6 Ko | −51 % |
| `/pro/demo` | 1 574,9 Ko | 442,2 Ko | −72 % |
| `/q/demo-maison-kais` | 1 582,3 Ko | 448,6 Ko | −72 % |

Ce qui reste d'important dans ces totaux APRÈS : les **bannières de
démonstration** (~310 Ko sur `/`, ~424 Ko sur `/search` — de l'imagerie de
contenu, hors périmètre de ce lot, consignée §11) et le chargement de fond
de la seconde locale v2 (~13 Ko, après le premier écran).

Découverte en mesurant : le logo `/brand/fadeup-mark-primary.png` pesait
**776,6 Ko** (PNG 1254×1254 servi dans un `size-8`, sur TOUTES les routes).
Rééchantillonné à 256×256 (lanczos3, usage maximal réel : 48 px CSS) →
**45,6 Ko**.

### Temps jusqu'au premier écran (médiane de 5, `/` à 390 px, Fast-3G 1,6 Mbps / 150 ms RTT, CPU ×4, cache vide, mesures appariées)

| | base | perf | Δ |
|---|---|---|---|
| First Contentful Paint | 5 712 ms | 3 956 ms | **−31 %** |

(LCP non capturé : `getEntriesByType('largest-contentful-paint')` exige un
`PerformanceObserver buffered` que la sonde n'installait pas — manque
déclaré, FCP fourni.)

---

## 3. La nouvelle mesure : `scripts/check-entry-graph.mjs`

Branchée dans `npm run build` (`tsc -b && vite build && node
scripts/check-entry-graph.mjs`). Elle mesure **le graphe d'entrée, pas le
fichier isolé** : l'entrée + tous ses imports statiques transitifs, c'est-à-
dire exactement les `<script src>`, `<link rel="modulepreload">` et
`<link rel="stylesheet">` que Vite écrit dans `dist/index.html`.

Deux gardes, chacune **fait échouer le build** (`exit 1`) :

1. **Qualitative** — aucun module des familles interdites (`platform`, `pro`,
   `marketing`, `maplibre`, `jsqr`, `zod`) dans un chunk du graphe d'entrée,
   vérifié sur la **composition réelle** des chunks via les données de
   `rollup-plugin-visualizer` (`dist/stats.html`, dont l'absence fait aussi
   échouer la garde — elle ne peut pas être désactivée en silence). C'est la
   garde contre la CLASSE du défaut : elle casse à la première aspiration,
   quel que soit son poids.
2. **Quantitative** — JS+CSS cumulés du graphe ≤ **240 Ko** gzip (mesuré :
   229,4). Les polices préchargées sont rapportées, hors budget (voir §10
   pour le choix de 240 et non 180).

Les deux chemins d'échec ont été testés en négatif pendant le lot (budget
abaissé à 100 → exit 1 ; famille factice `react-dom` → exit 1).

---

## 4. Les autres aspirations trouvées, et ce que j'en ai fait

| Aspiration | Poids (gz) | Traitement |
|---|---|---|
| Polices Geist préchargées dans `index.html` | 67,1 Ko | Préchargements retirés ; `@font-face` (`font-display: swap`) les charge quand une surface pro s'affiche. Note : Geist reste la police de **repli** du stack consumer (`Poppins, Geist, system-ui`) — quelques glyphes absents du sous-ensemble latin de Poppins la tirent à l'usage (mesuré sur `/search`, identique AVANT/APRÈS). |
| Les DEUX locales v2 (fr + en) dans l'entrée | ~25 Ko | Un chunk par langue (`shared/i18n/locales/<lng>/index.ts`) ; la locale ACTIVE est attendue avant le premier rendu, **en parallèle** d'`initI18n` ; l'autre se charge en fond ; `LanguageSwitcher` attend `ensureV2Locale` (pas de fenêtre de course). Parité de clés fr/en vérifiée avant de renoncer au repli embarqué. |
| zod dans l'entrée (~13 Ko) via `lib/env.ts`, `shared/lib/env.ts` et `lib/analytics/events.ts` | ~13 Ko | Les deux `env.ts` : validation manuscrite, même contrat (throw au premier usage sur valeur manquante/invalide). Analytics : le binding React (`analytics-context.tsx`, web-only) charge son implémentation dynamiquement et tamponne en ordre les événements pré-chargement ; `events.ts`/`client.ts`/`session.ts` **intouchés** (copies mobiles — la garde anti-dérive `apps/mobile/scripts/check-shared-drift.mjs` passe). |
| `vendor-react` large (react-hook-form, react-remove-scroll… préchargés) | ~15 Ko | Règle resserrée au cœur react ; le reste suit ses importeurs paresseux. |
| Logo PNG 1254×1254 | 731 Ko/route | Rééchantillonné 256×256 (voir §2). |
| jsQR | 47,5 Ko | Déjà paresseux (import dynamique dans `QRScanner`, monté à l'étape scan seulement) — prouvé plutôt que retouché, voir §5. |

Non traité, consigné §11 : bannières démo, chargement legacy i18n (les dix
namespaces d'un coup), CSS unique, `vendor-supabase`.

---

## 5. `/platform` intact — la preuve

**A/B pixel contre la branche de base** : build du commit de base `3a0f5e4`
(worktree jetable, même lockfile) et build du lot, servies côte à côte
(`vite preview` :4177 / :4178), captures back-to-back, diff sur pixels bruts
(sharp, seuil 8/255 sur un canal). Les captures des DEUX côtés et le résumé
brut sont archivés dans **`docs/reports/artifacts/perf/`** (`*-base.jpg`,
`*-perf.jpg`, `ab-summary.json`) — refaits le 11/09 après le redémarrage du
serveur, voir §9 « erreurs » :

| Écran | Divergence |
|---|---|
| `/platform/login` 1440 | **0,000 %** |
| `/platform` (overview, connecté staff) | **0,000 %** |
| `/platform/organizations` (connecté) | **0,000 %** |
| `/platform/audit` (connecté) | **0,000 %** |
| `/platform/acquisition/map` (connecté) | 0,036 % — timing des tuiles raster OSM (les deux builds timeout `networkidle` pareil ; la carte rend fond, marqueurs, légende et contrôles des deux côtés — `platform-acquisition-map-{base,perf}.jpg`) |
| `/`, `/search`, `/pro/demo`, `/q/demo-maison-kais` à 390 | **0,000 %** (×4) |
| les mêmes à 1440 | 0,015 % (×4, valeur identique sur les quatre) — l'anti-aliasing du logo rééchantillonné, rendu à 32 px dans l'en-tête desktop (seule divergence du lot, décision §9.6) |

**Fonctionnel** : connexion staff par le formulaire `/platform/login` →
overview → organizations → audit → acquisition/map, **zéro erreur console,
zéro requête ≥ 400** sur les deux builds. La carte maplibre de l'acquisition
se charge à la demande (chunk `maplibre-*` observé dans la session staff, et
dans elle seule) et fonctionne ; 27 chunks `platform-*` chargés dans la
session staff, aucun chunk de page platform sur les routes consumer.

Précision sur les routes consumer : un fichier nommé `platform-Bx_FmsL_.js`
(1,6 Ko gzip) y est bien demandé — c'est le **namespace de traduction
legacy `platform` en français**, chargé par l'init i18n legacy avec les neuf
autres namespaces (même hash dans la build de base, poste consigné §11.3).
Ce n'est ni le layout ni une page `/platform` ; la garde de build le
distingue parce qu'elle raisonne sur la composition des chunks, pas sur
leur nom.

**La garde reste aussi stricte** (`RequirePlatformRole` vit DANS
`PlatformLayout` — le rendre paresseux n'a pas déplacé une ligne de la
garde) :

- anonyme sur `/platform` → `/platform/login?redirect=%2Fplatform` ;
- anonyme sur `/platform/organizations` (route profonde) → redirection
  login avec `redirect`, rendu **identique** base/perf ;
- connecté NON-staff → écran de refus (« This account doesn't have FadeUp
  platform access »), aucune nav platform rendue, aucune donnée.

**jsQR** (Chromium 390 px, caméra factice `--use-fake-device-for-media-stream`,
capture `jsqr-scan-step-perf.jpg`) : **0** requête `jsQR` au chargement de
`/q/demo-maison-kais`, **0** à l'ouverture de la feuille « Rejoindre la
file » (étape détails), `jsQR-moY_pGiY.js` part **à l'étape scan** seulement,
flux vidéo monté (`BarcodeDetector` absent de Chromium headless → repli
exercé). Sans caméra, `getUserMedia` échoue AVANT l'import et jsQR ne part
jamais — ce qui est le comportement voulu, mais qui a d'abord rendu ma sonde
muette (§9, erreur 5).

Comptes QA temporaires créés pour ces preuves puis supprimés (§8).

---

## 6. Le premier rendu

Aucun scintillement ni état de chargement nouveau :

- aucune nouvelle frontière paresseuse sur le chemin consumer (HomePage et
  toutes les pages étaient déjà `lazy` ; le seul `lazy` ajouté est le layout
  `/platform`, résolu en parallèle des pages qui attendaient déjà) ;
- les attentes avant `createRoot` sont les mêmes qu'avant (i18n) — la locale
  v2 active se charge en **parallèle** d'`initI18n`, pas en série ;
- A/B pixel au rendu stabilisé : 0,000 % sur toutes les surfaces consumer
  (hors logo) ;
- smoke fr et en : aucun flash de clé brute (`v2:*` absent du texte rendu),
  `<html lang>` correct, zéro `pageerror`.

Théorique et assumé : sur un premier chargement pro À FROID, Geist n'étant
plus préchargée, `font-display: swap` peut montrer la police système un
instant sur `/dashboard` ou `/platform` (surfaces derrière connexion). Les
captures connectées A/B sont à 0,000 % au rendu stabilisé.

---

## 7. Validation

| Vérification | Résultat |
|---|---|
| `npm run typecheck` | 0 |
| `npm run lint` | 0 (warnings oxlint préexistants inchangés, garde palette verte) |
| `npm run test` | 79 fichiers, **687/687** |
| `npm run build` (avec la nouvelle garde) | 0 — `229,4 Ko ≤ 240 Ko, aucune famille interdite` |
| `npm run e2e` (chromium-mobile + chromium-desktop, toutes suites, axe intégré ; `E2E_PORT=4620`, code gelé à `7ca7078`, relancée après le redémarrage) | **exit 0 — 230 scénarios : 226 passés, 3 passés à la reprise, 1 sauté (préexistant, connu de tous les lots), 0 échec, 19,1 min.** Les 3 reprises : p1pro « contre-proposer » aux deux largeurs (la carte de demande absente après chargement) et F1b « balayage activé » (desktop). Re-passe ISOLÉE des deux specs (p1pro + f1b, 52 exécutions) : **51 passés, 1 à la reprise, 0 échec** — et cette reprise-là tranche la cause : `expect(booked.status).toBe('pending')` reçoit `'confirmed'` sur la **réponse RPC** du tunnel de réservation, AVANT tout rendu. Le salon QA partagé n'était pas en mode « demande » à cet instant : un état de fixture modifié en parallèle (un serveur dev du lot OS-1 écoute sur 4610 sur la même base ; motif de collision déjà prouvé par F2 §11). Une demande auto-confirmée n'apparaît pas comme carte « à traiter » — c'est exactement le symptôme des trois premières reprises. Aucun de ces tests ne touche le graphe d'entrée, l'i18n ou l'analytics ; la cause est hors du lot et je ne peux pas l'exclure définitivement sans campagne isolée du serveur voisin, ce que je n'ai pas fait. |
| axe (intégré aux suites d1/f1/f1b/f2/f3/f4/p1b/p1pro) | via e2e ci-dessus |
| `probe_public_rpcs.sh --strict` | vert (`ALL PUBLIC READ RPCs: 200`) — relancé après le redémarrage (avec `FADEUP_SUPABASE_ENV=/opt/fadeup/infra/supabase/.env` : le worktree n'a pas d'`infra/supabase/.env` et ce script, contrairement à x3, ne replie pas sur `/opt/fadeup`) |
| `x3_anon_surface.sh --strict` | vert (`X3 SURFACE ANONYME : TOUT PASSE`, compte jetable restant : 0) — relancé après le redémarrage |
| Garde anti-dérive mobile (`check-shared-drift.mjs`) | vert (« aucune dérive ») |

---

## 8. Git

- Branche : `perf/initial-load`, worktree `~/worktrees/perf`, poussée sur
  `origin` (GitHub).
- Commits : `7ca7078` — le lot entier (14 fichiers modifiés + 3 créés :
  `scripts/check-entry-graph.mjs`, `shared/i18n/locales/{fr,en}/index.ts`,
  `apps/web` uniquement) ; puis un second commit portant ce rapport et les
  artefacts A/B (`docs/reports/PERF_RAPPORT.md`,
  `docs/reports/artifacts/perf/`). Aucun changement de code après
  `7ca7078` : la validation de §7 a tourné sur ce commit gelé.
- `apps/mobile`, `features/pro-*` (écrans d'OS-1) : **intouchés** (les
  seuls contacts pro sont la suppression d'une règle d'empaquetage et le
  commentaire de la garde).
- **Aucune fusion n'a eu lieu.** Aucune migration.
- Nettoyage effectué (vérifié après la reprise) : les deux comptes QA
  jetables (`qa.perf.platform@fadeup.test`, `qa.perf.nostaff@fadeup.test`)
  supprimés de la base (`platform_members` revenue à 7 lignes, 0 compte
  `qa.perf.*` restant), worktree jetable de la base retiré (et l'entrée
  fantôme de la première session purgée par `git worktree prune`), serveurs
  de preview arrêtés. Ports 4173/4174/4610 (autres projets/lots) jamais
  touchés — mes services ont vécu sur 4177/4178/4620.

---

## 9. Décisions prises seul

1. **Supprimer les règles `manualChunks` `pro`/`platform`/`marketing`**
   plutôt que les rafistoler : c'est leur sémantique d'aspiration qui créait
   le défaut ; le découpage naturel par route fait mieux, et la garantie
   P1b (« jamais dans l'entrée consumer ») est reprise par une garde de
   build qui la vérifie VRAIMENT (sur la composition des chunks) au lieu de
   la supposer.
2. **Budget de la garde à 240 Ko, pas 180** — voir §10, case non cochée,
   avec l'analyse du plancher. J'ai refusé de « passer sous 180 » en
   différant `supabase-js` après le premier rendu : le premier écran UTILE
   (du contenu réel) a besoin des RPC — le différer aurait amélioré le
   chiffre en dégradant le produit.
3. **Locale v2 active seule embarquée au démarrage** (l'autre en fond) —
   renoncement au « repli en toujours présent » de P1b, APRÈS vérification
   de la parité complète des clés fr/en ; la fenêtre de course de la bascule
   est fermée dans `LanguageSwitcher`.
4. **`env.ts` sans zod** (les deux) : 13 Ko gz pour deux champs requis ;
   contrat conservé à l'identique.
5. **Analytics : implémentation paresseuse dans le binding React seulement**
   — `events.ts`/`client.ts`/`session.ts` sont copiés côté mobile
   (M1a/M1b) ; je n'y ai pas touché pour ne pas créer de dérive. Les
   événements émis avant l'arrivée du module (< 100 ms typ.) sont tamponnés
   en ordre puis rejoués ; en cas d'échec de chargement du chunk, analytics
   reste no-op — même garantie « analytics ne casse jamais le produit ».
6. **Logo 1254² → 256²** : seule divergence visuelle du lot (0,010 % sur
   home-1440, anti-aliasing à 32 px, invisible à l'œil — crops archivés).
   Rendu maximal réel : 48 px CSS ; 256 px couvre un DPR de 5.
7. **`E2E_PORT` paramétrable dans `playwright.config.ts`** : OS-1 tenait le
   port 4610 avec SON serveur dev et `reuseExistingServer: true` m'aurait
   fait tester le code d'un autre worktree sans un mot. Mes campagnes ont
   tourné sur 4620.
8. **Deux comptes QA jetables en base** (staff + non-staff) pour prouver la
   garde — créés, utilisés, supprimés, consignés ici.

### Erreurs commises, déclarées

1. **J'ai introduit une page blanche totale** en parallélisant
   `registerV2Bundles` avec `initI18n` : i18next n'attache
   `hasResourceBundle`/`addResourceBundle` à l'instance QUE pendant
   `init()` ; mon raccourci synchrone pré-init levait un TypeError qui
   empêchait TOUT rendu. Attrapée par mon smoke navigateur sur la build
   suivante (jamais commitée), corrigée (téléchargement parallèle,
   enregistrement après init), revalidée en fr, en, bascule de langue, A/B
   complet et tests.
2. **Deux campagnes e2e invalidées par moi-même** : lancées pendant que je
   continuais d'éditer les sources — or le serveur e2e est le serveur DEV
   (sources vivantes). Tuées, et la campagne finale a tourné en dernier,
   sur le code final gelé.
3. **Une première mesure APRÈS sur un dist obsolète** (le logo remplacé
   après la build) — jetée et refaite après rebuild.
4. **Les preuves visuelles de la première session ont été perdues** : les
   captures A/B, les crops du logo et les journaux réseau vivaient dans le
   scratchpad de session (`/tmp`), effacé par un redémarrage du serveur
   survenu juste après le commit `7ca7078` et pendant la campagne e2e finale.
   La première version de ce rapport les citait « au dossier » sans qu'elles
   soient dans le dépôt. J'ai **refait** l'A/B complet (base `3a0f5e4`
   rebuild dans un worktree jetable, lot rebuild, mêmes écrans, garde,
   jsQR) sur le code gelé et archivé cette fois les deux côtés + le résumé
   brut dans `docs/reports/artifacts/perf/` (1,8 Mo). Les chiffres de §5
   sont ceux de cette reprise ; les chiffres réseau et FCP de §2 sont ceux
   de la première session et n'ont pas été re-mesurés (le code n'a pas
   changé entre les deux ; les crops du logo ne sont pas re-produits).
   La campagne e2e et les deux suites strictes ont aussi été relancées
   après le redémarrage (§7).
5. **Première sonde jsQR muette** lors de la reprise : lancée sans caméra
   factice, `getUserMedia` échouait avant l'import dynamique et je lisais
   « 0 requête à l'étape scan », ce qui aurait pu passer pour un lecteur
   cassé ou pour une preuve. Relancée avec un périphérique factice : le
   chunk part à l'étape scan et seulement là.

---

## 10. Cases non cochées, avec la raison exacte

- **« Le transfert initial mesuré passe sous 180 Ko gzip »** : NON —
  **229,4 Ko** (JS+CSS du graphe d'entrée ; 663,9 avant, −65 %). Le plancher
  atteignable honnêtement est ~225–230 Ko : react-dom+react+scheduler 57,5,
  supabase-js 51,9 (auth + realtime + postgrest + storage, monolithique par
  construction — `createClient` instancie tout), react-router + code
  applicatif 49,0, CSS 15,0, i18next 14,9, tanstack ~9, radix-toast ~11,
  tailwind-merge 8,6, une locale ~12. Tout cela sert le premier écran utile
  (le contenu vient des RPC supabase). L'objectif de 180 supposait que le
  chunk d'entrée historique de 93 Ko reflétait le vrai coût « hors
  platform/maplibre » — il ne l'a jamais fait : supabase, tanstack, i18next
  et les toasts voyageaient cachés dans les chunks aspirés. Les moyens de
  passer sous 180 que j'ai identifiés et REFUSÉS : différer `supabase-js`
  après le premier rendu (maquille la métrique, ralentit l'arrivée des
  données), retirer le fournisseur de toasts ou i18next du démarrage
  (régressions fonctionnelles). Le budget de la garde est posé à 240 Ko
  (mesuré + 5 % de marge) et la garde QUALITATIVE interdit le retour des
  familles aspirées — c'est elle qui empêche la récidive du défaut, pas le
  nombre seul.
- **LCP** : non mesuré (sonde sans `PerformanceObserver buffered`) ; FCP
  apparié fourni (−31 %).
- **WebKit e2e** : toujours non exécutable sur cet hôte (bibliothèques
  système absentes, root requis — bloquant préexistant documenté depuis
  P1b).
- **« `npm run e2e` vert, toutes suites »** : cochée avec réserve — exit 0,
  0 échec, mais 3 scénarios passés à la reprise et non au premier essai
  (§7). La cause identifiée est un état de fixture partagée modifié par un
  lot voisin, pas le code de ce lot ; la campagne strictement isolée qui le
  prouverait à 100 % (serveur OS-1 arrêté) n'a pas été faite, parce que ce
  serveur n'est pas le mien.
- **LCP et transfert réseau non re-mesurés après la reprise** : les chiffres
  de §2 datent de la première session (code identique) ; seuls l'A/B pixel,
  la garde, jsQR, l'e2e et les suites strictes ont été refaits.

---

## 11. Ce qui reste à optimiser (non traité par ce lot)

1. **Les bannières de démonstration** : ~310 Ko sur `/`, ~424 Ko sur
   `/search` (JPEG pleine taille sans `srcset`/`sizes`, pas d'AVIF/WebP).
   Le plus gros poste restant du transfert réel.
2. **`vendor-supabase` (51,9 Ko gz)** : `auth-js` en pèse ~40 % à lui seul ;
   monolithique par construction (`createClient`). À revoir si supabase-js
   expose un jour des sous-modules tree-shakables.
3. **Le legacy i18n charge les DIX namespaces de la locale active à
   l'init** (~25 Ko gz en dizaines de petits chunks) alors que la plupart
   ne servent qu'à `/platform`. Un chargement par surface est possible.
4. **CSS unique (15,0 Ko gz)** : Tailwind génère une feuille pour toute
   l'application, surfaces platform/pro comprises.
5. **framer-motion (~38 Ko gz)** arrive dès la home (paresseux mais
   immédiat) — vérifier ce que la home anime réellement.
6. **Précharger Geist depuis les shells pro** (`ProShell`/`PlatformLayout`)
   pour éliminer le swap théorique à froid (§6).
7. **`/business`** : `fadeup-product-film.mp4` de 2,5 Mo dans `public/` —
   vérifier `preload="none"`/poster à la construction de P4.

---

*Rapport écrit avant affichage, commité et poussé sur `perf/initial-load`.
Aucune fusion. Arrêt après ce rapport, conformément au prompt.*
