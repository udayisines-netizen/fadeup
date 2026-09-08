# D1 — CONTRAT DE DESIGN AVAL

**Ce document REMPLACE `P1_DOWNSTREAM_CONTRACT.md`** (2026-09-08). Il est le
contrat que M1a lira pour construire l'application native, et que tout lot
frontend V2 suit. Si une décision visuelle manque ici, c'est un défaut de
D1 : remonte-le, ne l'invente pas.

Références : P1A_TOKENS.md (palette, contrastes mesurés) · MASTER_SPEC.md
(produit) · QA_DATA.md §5 (imagerie de démonstration) · le code fait foi
pour les valeurs (`apps/web/src/styles/*.css`).

---

## 0. CE QUI EST RÉVOQUÉ DE P1c — nommément

Un futur agent ne doit pas hériter des deux versions. Sont RÉVOQUÉS :

1. **« Row plutôt que Card »** (P1 §7/§13 de l'ancien contrat). La rangée à
   filet fin reste une primitive de LISTE DENSE (services, réservations,
   réglages, Pro), mais la surface de découverte est portée par des CARTES
   à image, élévation réelle et rayon généreux (`ResultCard`).
2. **« Élévation plate — une seule ombre »**. Une échelle d'élévation réelle
   existe côté client : `--fu-shadow-card`, `--fu-shadow-card-hover`,
   `--fu-shadow-sheet`, `--fu-shadow-sticky`. Le Pro reste sans ombre.
3. **« Un seul moment orchestré par écran »**. Le niveau attendu est
   MARQUÉ : ressorts, transitions partagées, apparitions décalées. La
   motion continue d'informer — elle n'est jamais décorative — mais le
   quota « un par écran » est levé.
4. **« Framer Motion interdit »**. Framer Motion (paquet `motion`) est
   AUTORISÉ, chargé via `LazyMotion` (jamais dans le chunk d'entrée),
   toujours sous `MotionConfig reducedMotion="user"`.
5. **« Poppins jamais l'interface »**. Poppins EST l'interface CLIENT
   (logo, marque, interface unifiés). Geist reste l'interface PRO.
6. **« Desktop rail + liste » sur la recherche**. Le desktop de /search est
   une GRILLE de cartes ; les filtres vivent en barre haute + tiroir.
7. **Rayons P1b** `card 12 / media 4` → **`card 16 / media 10`** (le média
   suit la courbe de sa carte). Contrôles 8, modale 16, feuille 20, avatar
   plein — la hiérarchie par catégories demeure.
8. **« Sombre = Pro seulement »**. Trois écrans CLIENT sont des moments
   sombres composés (thème `moment`) : confirmation de réservation, suivi
   de file, Fade Passport (tokens posés).

## 0bis. CE QUI NE CHANGE PAS (les lois, re-signées par D1)

- **Encre sur vert pour tout CTA vert** : `#080F0D` sur `#00C27A` (8,30:1).
  Blanc sur vert INTERDIT (2,33:1) — garde lint `check-fu-palette.mjs`.
- **Aucune donnée fabriquée** ; `Rating` à `null` n'affiche jamais zéro
  étoile ; les cinq métriques restent distinctes (`MetricValue`) ; un
  profil non revendiqué reste neutre ; aucune disponibilité inventée.
- **WCAG AA**, focus visible, cibles 44 px, `prefers-reduced-motion`
  supprime translations/échelles et garde l'opacité < 100 ms.
- Le bleu n'existe pas. Le logo reste le seul dégradé.
- Propriétés logiques CSS uniquement (RTL) ; aucun `left:`/`right:`.
- BOOK = CTA transactionnel dominant, jamais un onglet ; FOLLOW toujours
  secondaire ; optimisme réservé au social.
- Nav consumer : cinq onglets, cet ordre — Accueil · Recherche · Feed ·
  Réservations · Compte.

---

## 1. Typographie — deux voix

| Surface | Famille | Note |
|---|---|---|
| Client (consumer + moments) | **Poppins** 400/500/600/700, auto-hébergée | rien de lisible < 14 px ; **Medium ≥ 500 sur les petits libellés** ; titres 600 |
| Pro | **Geist Sans** | la densité prime sur l'unité |
| Données numériques (partout) | **Geist Mono** + `tabular-nums` | prix, horaires, positions, identifiants — obligatoire |

Le basculement est porté par le THÈME : chaque `tokens-*.css` redéfinit
`--font-fu-sans` (littéral, jamais un `var()` imbriqué — il gèlerait sur
`:root`). Échelle `text-fu-*` inchangée : 12 (badges seulement) / **14
plancher** / 16 / 20 / 24 / 32 / 44 / 60. Instrument Serif ne s'applique
nulle part au V2.

## 2. Thèmes et fonds

| Thème | Attribut | Fond | Usage |
|---|---|---|---|
| `consumer` | `body[data-theme=consumer]` | **clair** — page `#F6F8F7` (papier teinté vert), surfaces blanches qui se détachent | toute la surface client |
| `moment` | `body[data-theme=moment]` | **sombre composé** `#071310` (noir tiré au vert, PAS le Pro inversé) | confirmation de réservation · suivi de file · Passport |
| `pro` | `body[data-theme=pro]` | sombre `#080F0D`, dense, zéro ombre | OS professionnel |
| `editorial` | `body[data-theme=editorial]` | sombre éditorial | marketing/platform V2 |

Un moment sombre est une COMPOSITION : le vert vif y prend de la force
(chiffres display, célébration, signaux), le logo y existe pleinement.
Jamais une inversion mécanique. Les tokens Passport (`--fu-passport-*`)
vivent dans `tokens-moment.css`.

## 3. Élévation (client)

`--fu-shadow-card` (carte au repos) · `--fu-shadow-card-hover` (survol :
ombre + translation -2 px) · `--fu-shadow-sheet` (feuille au-dessus de la
liste) · `--fu-shadow-sticky` (barre collante). Ombres teintées d'encre,
jamais grises ; jamais la même ombre sous tout ; le Pro n'en porte aucune.

## 4. La carte de résultat (`ResultCard`)

- Mini-bannière (84 px) → portrait rond en surimpression décalé à gauche
  (ring blanc) → nom → type · ville · distance → prix « à partir de » +
  **UN badge d'état**. ~190 px de haut, trois par écran en 390 px.
- Hiérarchie des badges : `disponible maintenant` (point live) PRIME sur
  `ouvert/fermé` ; « Non revendiqué » en libellé court sobre ; TOUT LE
  RESTE (file, zone détaillée, état complet) vit dans la feuille.
- Le repli sans image est COMPOSÉ : surface douce de marque + monogramme
  décoratif (`--fu-brand-watermark`) — jamais un carré gris, jamais une
  fausse image.
- Toute la carte est LE bouton : un tap ouvre la FEUILLE, pas le profil.
- Desktop : grille 2 colonnes ≥ 768, 3 colonnes ≥ 1280. Jamais une colonne
  mobile étirée.

## 5. La feuille de résultat (`ResultSheet` sur `Sheet`)

- Bottom sheet < 768 (ressort, poignée), side sheet inline-end ≥ 768.
- Contenu : bannière + portrait + badges d'état → identité → revendication
  → services principaux (≤ 4, prix réels) → LE CTA selon l'état réel →
  « Voir le profil complet ».
- La liste reste visible dessous ; la position de défilement est préservée
  à la fermeture. Fermeture : glissement vers le bas depuis la zone
  d'en-tête (≥ 90 px), Échap, scrim, bouton.
- `Sheet` est LA primitive : `hero` + `hideHeader` pour la variante média.
  Ne pas écrire une deuxième feuille.

## 6. Le profil — modèle X

Ordre imposé (les deux profils publics) :
**bannière pleine largeur** (40/48) → **portrait rond en surimpression
décalé à gauche** (ring canvas) → nom → revendication + handle → accroche
→ « Travaille chez [Salon] » (barber salarié, cliquable) → localisation →
signaux opérationnels réels → bio → **métriques sur UNE ligne** (cinq,
distinctes) → **CTA Réserver + Suivre INLINE** → services → réalisations en
grille → avis.

La paire de CTA existe en DEUX exemplaires exclusifs : inline (modèle X)
et barre collante — la barre ne se rend que quand la paire inline est
sortie de l'écran (`useInView`) : jamais deux verts pleins visibles.

## 7. L'accueil — tableau de bord

Trois blocs, cet ordre : **En cours** (file active avec position réelle,
prochaine réservation, demande en attente avec échéance — TOUJOURS en haut
quand il existe) → recherche → **Ce que je suis** (suivis, connecté) OU
**Vous avez consulté** (mémoire locale, anonyme) → **Autour de moi**
(cartes + feuille).

Sans compte : les profils consultés viennent du localStorage
(`fu.recentProfiles.v1`), écrits par les pages de profil — la donnée ne
quitte JAMAIS l'appareil, aucun suivi serveur. Première visite : recherche
+ découverte, AUCUNE section vide. L'invitation à créer un compte est une
bannière fermable (≥ 3 visites), jamais une modale.

## 8. Motion — marquée, jamais décorative

| Geste | Implémentation |
|---|---|
| Feuille qui remonte | ressort Framer (stiffness 420 / damping 36) |
| Fermeture de feuille | glissement manuel (MotionValue) + ressort de retour |
| Apparition des résultats | stagger CSS `fu-rise-in` + délai 45 ms/index (plafonné à 8) |
| Portrait carte→profil | View Transitions (`.fu-vt-portrait`, `navigate(..., {viewTransition:true})`) |
| Survol/pression carte | ombre + translation -2 px / scale .985, 120 ms |
| Confirmation de réservation | LE moment fort : coche en ressort (320/16), suites décalées, thème sombre |
| Mouvement de file | `fu-number-in` sur changement de position ; FLIP F1b conservé pour les listes |

Règles : Framer via `LazyMotion` (`domAnimation`/`domMax`), jamais dans le
chunk d'entrée ; `MotionConfig reducedMotion="user"` partout ; sous
`prefers-reduced-motion` AUCUNE translation/échelle, opacité < 100 ms (les
règles globales de theme.css neutralisent le CSS ; les composants Framer
basculent sur des fondus). Budget entrée consumer < 180 Ko gzip.

## 9. Imagerie

- `MediaFrame` reste le cadre générique ; média manquant = état de
  première classe SOIGNÉ (composition monogramme, jamais un carré gris,
  jamais une fausse image, jamais un dégradé sur du vide).
- Bannières d'établissement : AUCUN contrat en base à ce jour — le jeu de
  démonstration passe par `shared/lib/demoMedia.ts` (slugs `demo-*`
  uniquement, retirable — QA_DATA §5). **M1a doit créer le vrai contrat
  d'imagerie d'établissement (colonne + bucket + RPC).**
- Portraits : `professionals.avatar_url` / `staff_profiles.avatar_url` ;
  repli = monogramme déterministe (`Avatar`).
- Portfolio : chaîne B4 réelle (`posts`/`post_media`, bucket privé signé).
- Aucune image ne présente le travail d'un professionnel réel ni un salon
  existant sans droits (MASTER_SPEC §2).

## 10. États et traitement de BOOK/FOLLOW

Inchangés de P1 (re-signés) : le CTA dit l'état RÉEL (`deriveProfileCta`) ;
indisponible → désactivé + note, profil entier visible ; non revendiqué →
demande d'intérêt (F4) quand elle existe, jamais une capacité fabriquée ;
`pending-request` ne dit jamais « réservé » ; chaque état vide propose une
action.

## 11. Architecture d'exécution (rappels bloquants, inchangés)

`features/X` n'importe jamais `features/Y` (la feuille vit donc dans
`shared/ui`). Client Supabase : `features/*/api/**` et `shared/data/**`.
Clés Query par fabriques. Chercher la RPC avant d'écrire une requête ;
`search_public_professionals` TOUJOURS avec `p_entity_type: 'shop'`.
i18n : namespace `v2`, zéro chaîne en dur. Realtime via `useChannel`.

## 12. Questions que ce contrat ne tranche PAS (pour M1a / lots suivants)

1. Le contrat d'imagerie d'établissement en base (bannières réelles).
2. La composition complète du Fade Passport (les tokens existent, l'écran
   non).
3. Le viewer de posts (P4) et le langage carte de la recherche (marqueurs).
4. Les libellés d'état côté Pro (audience « Appelé » vs « C'est votre
   tour »).
5. La dataviz Pro (encre/verts, pas de bleu — non défini au-delà).
