# D1 — Rapport final : reprise de la direction visuelle

Branche `d1/visual-direction` (depuis `rebuild/social-first-v2`), 2026-09-08.
Contrat en vigueur : `docs/design/D1_DESIGN_CONTRACT.md` (remplace
`P1_DOWNSTREAM_CONTRACT.md`).

**Captures** (`docs/reports/artifacts/d1/`, 390 et 1440, données réelles) :
`search-*` (recherche en liste), `sheet-*` (feuille ouverte), `shop-*`
(profil salon), `pro-*` (profil barber), `home-account-*` (accueil avec
compte — réservation RÉELLE créée par le compte QA F4 puis annulée,
convention marquée), `home-anonymous-*` (accueil sans compte, 2e visite),
`booking-confirmed-*` (confirmation, moment sombre — issue d'une
réservation réelle du tunnel complet), `queue-tracking-*` (suivi de file,
moment sombre — entrée anonyme réelle jointe par jeton puis quittée),
`platform-login-1440` (preuve /platform), `avant-recherche-390` (l'état
AVANT D1, pour mémoire).

---

## 1. Ce qui est révoqué de P1c — nommément

| Révoqué | Remplacé par |
|---|---|
| « Row plutôt que Card » sur la découverte | `ResultCard` : mini-bannière, portrait en surimpression, élévation réelle, rayon 16 — la Row reste la primitive des listes denses (services, réservations, Pro) |
| « Élévation plate, une seule ombre » | échelle réelle : `--fu-shadow-card` / `card-hover` / `sheet` / `sticky` (le Pro reste sans ombre) |
| « Un seul moment orchestré par écran » | motion MARQUÉE : ressort de feuille, transition partagée du portrait, stagger des résultats, célébration de confirmation, mouvement de position de file |
| « Framer Motion interdit » | autorisé (paquet `motion`), via `LazyMotion` + `MotionConfig reducedMotion="user"`, jamais dans le chunk d'entrée |
| « Poppins jamais l'interface » | Poppins EST l'interface client ; Geist reste le Pro ; Geist Mono reste les chiffres |
| Desktop « rail + liste » de /search | grille de cartes 2–3 colonnes, filtres en barre haute + tiroir |
| Rayons `card 12 / media 4` | `card 16 / media 10` (hiérarchie par catégories conservée) |
| « Sombre = Pro seulement » | thème `moment` : trois écrans client sombres composés |

L'ancien contrat porte un en-tête de révocation qui pointe vers le nouveau —
un futur agent ne peut pas hériter des deux versions.

## 2. Les images de démonstration

**Contrainte déclarée d'entrée** : le compte Artlist est à **0 génération
d'image gratuite** (les deux ont été dépensées le 2026-08-31, mémoire du
projet ; la dernière génération vidéo reste réservée au fondateur). Aucune
image neuve n'a donc été générée : TOUT est dérivé (recadrages sharp) des
**8 sorties des deux générations déjà payées** (Seedream 5.0 Pro, ids
`01a058d7…` et `01a0596d…` — 4 sorties chacune, récupérées gratuitement via
l'historique Artlist). Aucune ne représente un professionnel réel ni un
salon existant.

| Quoi | Combien | Où | Marquage | Retrait |
|---|---|---|---|---|
| Bannières d'établissement | 8 (une par organisation `demo-*`) | `apps/web/public/demo-media/banners/<slug>.jpg` + registre `shared/lib/demoMedia.ts` (slugs `demo-*` UNIQUEMENT) | chemin `/demo-media/`, slug `demo-*` | supprimer dossier + module |
| Portraits | 2 (`demo.kais.bellamine`, `demo.moussa.diakite`) | `public/demo-media/avatars/` + `professionals.avatar_url` / `staff_profiles.avatar_url` | handle `demo.*`, chemin `/demo-media/` | `update … set avatar_url = null where handle like 'demo.%'` |
| Portfolio (« Réalisations ») | 5 posts / 7 médias JPEG sur DEUX profils (le pro Kaïs + l'organisation Atelier Fadel) | `posts`/`post_media` + bucket privé `post-media/d1-demo/` — la chaîne B4 réelle, signée par l'anonyme | UUID préfixe `d1de`, caption « — démo FadeUp », préfixe `d1-demo/` | `delete from posts where id::text like 'd1de%'` + objets du bucket |

Seed idempotent : `db/seeds/d1_demo_media.sql` (rôle `postgres`, appliqué,
revérifié). Mécanisme documenté dans `QA_DATA.md §5`.

**Décision assumée** : les sources ne contiennent que DEUX visages
distincts. Seules deux identités reçoivent un portrait photo — donner le
même visage à deux professionnels différents aurait été un mensonge visuel.
Les autres gardent le monogramme (le cas « image manquante », soigné par
ailleurs : repli composé surface douce + monogramme, jamais un carré gris —
visible en production réelle sur side-agency, qui n'a aucune image).

**Écart déclaré pour M1a** : il n'existe AUCUN contrat d'imagerie
d'établissement en base (aucune colonne sur organizations/locations —
mesuré). Le registre frontend est un pont de démonstration, pas une
architecture ; le vrai contrat (colonne + bucket + RPC) est à créer.

## 3. La carte de résultat

- **Hauteur réelle mesurée : ~215 px** (390 px, bannière 84 px + portrait en
  surimpression + deux lignes + prix/badge). L'objectif « environ 180 px »
  est approché, pas atteint au pixel — j'ai préféré garder l'air de la
  composition plutôt que d'écraser les interlignes Poppins.
- **Trois cartes tiennent dans un écran de 390×844** une fois les contrôles
  de recherche défilés (la zone liste montre 3 cartes pleines).
- **Hiérarchie des badges retenue** : sur la carte, le prix « à partir de »
  (fait réel, mono) + UN badge d'état — `disponible maintenant` (point
  live) PRIME sur `ouvert/fermé` — + « Non revendiqué » en libellé court
  posé sur la bannière. Le RESTE (compte de file, zone détaillée, état de
  réservation complet, revendication expliquée) vit dans la FEUILLE.
- **Le vert existe à l'écran** sans couvrir les surfaces : CTA Réserver
  plein, badge live, onglet actif, lien d'établissement, chiffres de file.
- Desktop : grille 2 colonnes ≥ 768, 3 ≥ 1280 ; filtres en chips + tiroir.
  Le rail latéral et ses 400 px de vide sont supprimés.
- Un tap ouvre la FEUILLE (liste dessous, défilement préservé — vérifié par
  e2e) ; le profil complet est un geste de plus.

## 4. L'accueil sans compte

- **Première visite absolue** : la recherche en haut, la découverte locale
  en cartes dessous. RIEN d'autre — vérifié par e2e (`home-current`,
  `home-recent`, `home-followed`, `home-invite`, `home-rebook` absents).
- **Dès la deuxième visite** : le bloc « Vous avez consulté » montre les
  profils réellement ouverts — mémoire `localStorage`
  (`fu.recentProfiles.v1`, 8 entrées max), écrite par les deux pages de
  profil, **jamais envoyée au serveur** (vérifiable : aucune RPC nouvelle,
  aucune écriture réseau).
- **L'invitation à créer un compte** apparaît à partir de la 3e visite
  (compteur local, une visite = une session) : une bannière sur la surface
  douce de marque, fermable d'un geste, mémorisée fermée — jamais une
  modale, jamais un mur. Vérifié par e2e (fermée → ne revient pas).
- Connecté : « En cours » (file avec position réelle, prochaine
  réservation, demande en attente AVEC son échéance réelle `expires_at`)
  toujours en tête, puis recherche, suivis, découverte.

## 5. Motion

| Geste | Avec quoi |
|---|---|
| Feuille qui remonte | ressort Framer (stiffness 420 / damping 36) sous 768 px ; latérale CSS au-dessus |
| Fermeture par glissement | geste manuel (pointer capture → MotionValue), seuil 90 px, ressort de retour sinon — le corps de la feuille garde son défilement |
| Apparition des résultats | stagger CSS `fu-rise-in` + 45 ms/index (plafonné) — zéro coût JS |
| Portrait carte→profil | View Transitions API (`.fu-vt-portrait` + `navigate(…, { viewTransition: true })`) |
| Survol/pression des cartes | ombre + translation −2 px / scale .985 en 120 ms |
| Confirmation de réservation | coche en ressort (320/16) + suites décalées — LE moment fort, en sombre |
| Mouvement de file | `fu-number-in` à chaque changement de position (accueil + suivi) ; FLIP F1b conservé |

**Coût bundle mesuré** : le paquet `motion` était DÉJÀ dans le chunk
`platform` (carte d'acquisition legacy). Le surcoût net de D1 est
**≈ +3,8 Ko gz** sur le chunk `pro` (25,0 → 28,8 — là où rolldown a rangé
les féatures partagées) et +0,4 Ko sur l'entrée. **Chunk d'entrée consumer :
36,9 Ko gz (index) + 56,4 (vendor-react) ≈ 93,3 Ko gz — budget 180 Ko
tenu.**

**Reduced-motion, vérifié navigateur ET e2e** : `prefers-reduced-motion:
reduce` → la feuille s'ouvre en fondu < 100 ms, `transform: none` mesuré ;
les règles globales de theme.css neutralisent tout le CSS ; les composants
Framer lisent la media query de façon SYNCHRONE
(`usePrefersReducedMotion`) — le hook Framer natif démarre à `false` et
laissait passer un cadre de translation (bug attrapé par l'e2e, corrigé).

## 6. Les trois moments sombres

Thème `moment` (`tokens-moment.css`, `body[data-theme=moment]`) — une
COMPOSITION, pas une inversion : fond noir tiré au vert (`#071310`),
surfaces `#0d1f18`, vert vif rendu aux signaux et aux chiffres display,
encre sur vert conservée pour les CTA (la loi ne change pas dans le noir),
Poppins conservée (c'est un moment CLIENT).

1. **Confirmation de réservation** — le flux bascule le thème quand (et
   seulement quand) un RENDEZ-VOUS existe (`!outcome.is_request`) : logo
   plein, coche verte en ressort avec halo, récapitulatif sur carte sombre.
   Une demande envoyée reste claire et sobre — jamais célébrée.
2. **Suivi de file** — `/q/:slug` passe en sombre quand le client SUIT SA
   PLACE (pas en consultation) : position en vert display, compte à
   rebours, l'écran qu'on garde ouvert en salon.
3. **Fade Passport** — n'existe pas côté web : ses tokens sont POSÉS
   (`--fu-passport-canvas/card/sheen/accent` dans tokens-moment.css) et
   documentés au contrat pour M1a/P2.

## 7. Poppins — ce qu'il a fallu ajuster pour la lisibilité

- **Bascule par thème** : chaque `tokens-*.css` redéfinit `--font-fu-sans`
  en LITTÉRAL (un `var()` imbriqué gèle sa résolution sur `:root` — piège
  CSS réel, rencontré et documenté dans theme.css). Consumer + moment →
  Poppins ; pro + editorial → Geist. `/platform` legacy garde Inter,
  vérifié au navigateur.
- **Rien de lisible sous 14 px** : l'échelle `text-fu-*` est inchangée, le
  12 px reste réservé aux badges ; les petits libellés passent en
  Medium (500) — ex. libellés de la nav basse, chips, métriques.
- **`tabular-nums` intouchable** : prix, horaires, positions, distances
  restent en Geist Mono — Poppins ne porte jamais un chiffre aligné.
- **Contraste re-mesuré** : le vert texte `#00875A` tombait à 4,27:1 sur le
  nouveau papier teinté `#F6F8F7` (attrapé par axe) → approfondi en
  `#007A52` (5,04:1 canvas / 5,38:1 blanc / 5,11:1 surface douce).
- Poids : 4 fichiers woff2 latin (~8 Ko chacun), auto-hébergés, 400/500/600
  préchargés.

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (legacy + v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **vert** (warnings oxlint informatifs préexistants) |
| `npm run test` (Vitest) | **687/687, 79 fichiers** — aucun test modifié pour passer |
| `npm run build` | **vert** — entrée consumer ≈ 93,3 Ko gz (budget 180) |
| `npm run e2e` (Chromium 390 + 1440, campagne UNIQUE) | **199 passés, 1 sauté (préexistant), 0 échec, 0 flaky — 21,9 min** : les 20 scénarios D1 neufs + toutes les suites antérieures (p1b, F1, F1b, F2, F3, F4). Les specs F3 qui cliquaient l'ancienne rangée ont été réécrites vers le parcours carte→feuille→profil (changement de produit voulu, §11). Empreinte de données : +2 organisations `qa-f1-*` (motif F1 connu, BLOCKERS §12.2), 51/51 neutralisées « ZZ dead », zéro visible en marketplace, zéro réservation QA ouverte |
| axe (dans l'e2e, 390 + 1440) | recherche, accueil, feuille, profils : **aucune violation sérieuse ou critique** (après le correctif de contraste §7) |
| `probe_public_rpcs.sh --strict` | **toutes les RPC publiques : 200** |
| `x3_anon_surface.sh --strict` | **« X3 SURFACE ANONYME : TOUT PASSE »** |
| `/shop/demo-atelier-fadel` | charge en dev ET en build de production (preview) — l'échec au module dynamique constaté au prompt était un cache de dev de l'ancien worktree, aucun défaut reproduit |

## 9. `/platform` intact — preuve

- `git status` : **zéro** fichier touché sous `src/pages/`, `src/routes/`,
  `src/components/`, `src/lib/` (les surfaces legacy).
- Fonction : `GET /platform/login → 200` sur la build de production
  (preview 15181) ; navigateur : la page rend avec **Inter** (mesuré
  `getComputedStyle` — aucune fuite Poppins), thème legacy inchangé
  (l'attribut `data-theme` V2 vit sur `<body>`, le legacy sur `<html>`).
- Instrument Serif : définie dans index.css (legacy), **appliquée nulle
  part** — aucun composant `.tsx` du dépôt ne la référence (grep), aucune
  règle ne la consomme hors sa déclaration. Rien du V2 ne la charge.
- Capture : `platform-login-1440.png` (artifacts).

## 10. Git

- Branche **`d1/visual-direction`**, créée depuis `rebuild/social-first-v2`
  (worktree dédié `~/worktrees/d1`).
- Six commits, ajouts explicites uniquement :
  `001ef8f` imagerie de démonstration · `d18bf83` Poppins + tokens +
  thème moment · `10e9740` primitives (carte, feuille, CTA modèle X) ·
  `f8ce8d6` surfaces (recherche, accueil, profils, moments sombres) ·
  `4c7f001` e2e · `e78a61c` docs (contrat + rapport).
- **Poussée. Aucune fusion.** Aucun `git add .`/`-A`, aucun
  `reset --hard`, aucun `clean`, aucun `docker prune`.

## 11. Décisions prises seul — et erreurs commises, déclarées

**Décisions :**
1. **Images dérivées, pas générées** (solde Artlist à 0) — recadrages
   distincts des 8 sorties payées ; deux bannières (`atelier-fadel`,
   `sofian-cuts`) proviennent de variantes proches de la même scène et se
   ressemblent plus que je ne l'aurais voulu. Assumé, remplaçable quand un
   budget image existera.
2. **Deux portraits photo seulement** (deux visages dans les sources) — le
   reste en monogramme, voir §2.
3. **La paire CTA du modèle X existe en deux exemplaires EXCLUSIFS**
   (inline + barre collante, `useInView`) : « Réserver atteignable sans
   défilement long » ET « un seul CTA dominant visible » tiennent ensemble.
4. **La carte n'a plus de lien direct vers le profil** (le tap ouvre la
   feuille — décision D1 §5) : les specs e2e F3 qui cliquaient `result-link`
   ont été réécrites vers le parcours carte→feuille→profil. C'est une
   modification de tests due à un changement de PRODUIT voulu par le
   prompt, pas un contournement.
5. **Le suivi de file bascule en sombre seulement en suivi actif** — la
   consultation de la file reste claire (le prompt disait « un écran qu'on
   garde ouvert » ; j'ai restreint le moment à cet écran-là).
6. **Devtools React Query derrière un opt-in** (`fu.devtools=1`) : c'était
   LE « rond qui déborde sur l'onglet Compte » (bouton flottant TanStack en
   DEV) — pas un défaut du shell.
7. **`SearchResultRow` conservé** (plus consommé) — sécurité legacy : la
   suppression attend la validation produit de D1.

**Erreurs commises et corrigées en cours de lot :**
- Le hook `useReducedMotion` de Framer (asynchrone) laissait passer un
  cadre de translation sous reduced-motion — attrapé par MON e2e, remplacé
  par une lecture synchrone.
- Ma première implémentation du geste de fermeture (drag Framer natif) ne
  s'accrochait pas dans le portail Radix, puis le glisser NATIF de l'image
  du hero volait le pointeur (pointercancel) — geste réécrit à la main
  (pointer capture + MotionValue), testé fermeture ET retour-ressort.
- Un `var()` imbriqué dans `@theme` gelait Poppins sur `:root` — corrigé en
  redéfinissant `--font-fu-sans` par thème, documenté.
- Le vert texte historique est passé sous AA sur le nouveau fond (4,27:1) —
  attrapé par axe, approfondi (§7).

**Défaut PRÉEXISTANT constaté, hors périmètre, consigné** : le graphe de
chunks fait importer STATIQUEMENT `platform` (218 Ko gz), `marketing` et
`pro` par l'entrée, et `maplibre` (246 Ko gz) suit — mesuré à l'identique
sur la build de la branche de base (`/opt/fadeup/dist`, commit dfe27b6).
Cause probable : `routes.tsx` importe `PlatformLayout` en statique et le
regroupement `manualChunks` colle toutes les pages platform (dont la carte
maplibre) dans un seul chunk. Le critère D1 (entrée < 180 Ko gz) porte sur
le chunk d'entrée et passe, mais le TRANSFERT réel au premier chargement
est ~674 Ko gz. Chantier de découpage à part entière — ne pas le corriger
en douce dans un lot de direction visuelle.

## 12. Cases non cochées

- **« Environ 180 px » de carte** : mesurée à ~215 px (§3) — trois par
  écran tiennent, la lettre du chiffre n'est pas atteinte.
- **Fermeture de feuille « par geste de retour »** : Échap, scrim, bouton
  et glissement fonctionnent ; le bouton RETOUR du navigateur ferme… en
  quittant la page (la feuille n'est pas une entrée d'historique). Décision
  à confirmer : pousser un état d'historique par feuille a des effets de
  bord réels (partage d'URL, retour double) — laissé à M1a.
- **« Leurs coupes récentes » dans le bloc suivis** : aucun RPC groupé de
  posts par profils suivis n'existe (c'est le feed P4). Le bloc montre les
  profils suivis, pas leurs coupes. Manque déclaré, pas comblé par une
  invention.
- **WebKit e2e** : toujours non exécutable sur cet hôte (BLOCKERS §2,
  préexistant).

## 13. Ce que M1a devra trancher (et que D1 n'a pas pu)

1. **Le contrat d'imagerie d'établissement en base** (colonne + bucket +
   RPC) — le registre `demoMedia.ts` n'est qu'un pont de démonstration.
2. **La composition du Fade Passport** — les tokens existent, l'écran non.
3. **Feuille et historique de navigation** (retour système ferme-t-il la
   feuille ?) — voir §12.
4. **Le langage visuel de la carte (onglet Carte)** : marqueurs/clusters
   jamais définis (hérité de P1, toujours ouvert).
5. **La photo des cartes d'organisation en recherche** : la RPC de
   recherche ne renvoie aucun avatar d'équipe pour un barbershop — si le
   portrait de carte doit être un visage plutôt qu'un monogramme, il faut
   l'ajouter au contrat de `search_public_professionals`.
6. **Le chantier de chunks préexistant** (§11) — mérite son propre lot.

---

**Gate R5R rappelé** : ce lot passe la vérification technique ; la
direction visuelle reste soumise à la validation explicite du fondateur.
Aucune fusion n'a été faite.
