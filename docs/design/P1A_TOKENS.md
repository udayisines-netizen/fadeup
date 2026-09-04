# P1a — Tokens : palette et échelles

Définis en P1a, implémentés en P1b (CSS custom properties, préfixe `--fu-`).
Direction retenue : A — Éditorial minimal (voir P1A_VISUAL_DIRECTION.md).
Ancrage de marque non négociable : `#00C27A`, `#28E18E`, `#7FF5C4`, `#E6FFF3`,
`#080F0D`, `#0F1A16`. Ratios de contraste calculés (WCAG 2.x, arrondi 2 déc.).

**Règle de garde** : le bleu ne devient jamais la couleur primaire — liens,
focus et info utilisent les tokens ci-dessous, jamais les défauts navigateur.
Le texte d'un CTA sur vert primaire est l'encre, jamais le blanc.

## BRAND

| Token | Hex | Usage | Contexte | Contraste mesuré |
|---|---|---|---|---|
| `--fu-brand-primary` | `#00C27A` | CTA transactionnel plein, badge live, état actif | clair & sombre | texte encre dessus : **8,30:1** ✓ ; comme texte sur blanc : 2,33:1 → interdit en texte |
| `--fu-brand-interaction` | `#28E18E` | survol/pressed sur sombre, signaux live sombres | sombre | sur `#0F1A16` : **10,39:1** ✓ |
| `--fu-brand-deep` | `#00875A` | liens verts, texte vert sur clair, pressed sur clair | clair | sur blanc : **4,55:1** ✓ AA |
| `--fu-brand-soft` | `#E6FFF3` | surfaces de sélection, fonds de section rythmés | clair | encre dessus : **18,41:1** ✓ |
| (réserve) vert doux | `#7FF5C4` | badges doux, accents Passport | clair | encre dessus : **14,53:1** ✓ |

## NEUTRES (consumer, clair)

Les gris dérivent de l'encre par opacité sur blanc — aucune valeur arbitraire.

| Token | Valeur | Usage | Contraste sur `--fu-canvas` |
|---|---|---|---|
| `--fu-canvas` | `#FFFFFF` | fond de page | — |
| `--fu-surface` | `#FFFFFF` | surface par défaut (confondue avec canvas en direction A) | — |
| `--fu-surface-raised` | `#F7F9F8` | puits, zones de regroupement discrètes | — |
| `--fu-text-primary` | `#080F0D` | texte principal | **19,36:1** ✓ |
| `--fu-text-secondary` | `rgba(8,15,13,.62)` (≈ `#666A69`) | métadonnées, états | **5,48:1** ✓ AA |
| `--fu-text-tertiary` | `rgba(8,15,13,.40)` (≈ `#9BA19E`) | décoratif/désactivé **uniquement** — jamais porteur d'information essentielle | 2,67:1 (hors AA, assumé) |
| `--fu-border` | `rgba(8,15,13,.10)` | hairlines de structure | — |
| `--fu-border-strong` | `rgba(8,15,13,.22)` | contours de contrôle, séparation appuyée | — |

## SÉMANTIQUE

| Token | Hex | Usage | Note |
|---|---|---|---|
| `--fu-success` | `#00875A` | confirmations texte/icône sur clair | 4,55:1 ✓ — le succès reste dans la famille verte |
| `--fu-warning` | `#E0A33E` | attente, retard | **confiné au Pro** (MASTER_SPEC §15) |
| `--fu-danger` | `#D9534F` | annulation, conflit, échec | texte d'erreur sur clair : préférer `#B23F3C` (≥4,5:1) — à vérifier en P1b |
| `--fu-info` | `rgba(8,15,13,.62)` | information neutre | l'info n'est **pas bleue** |

## OVERLAYS

| Token | Valeur | Usage |
|---|---|---|
| `--fu-scrim` | `rgba(8,15,13,.44)` | voile derrière feuilles/modales |
| `--fu-media-gradient` | `linear-gradient(180deg, rgba(8,15,13,0) 55%, rgba(8,15,13,.65) 100%)` | lisibilité de texte posé sur média réel — jamais sur cadre vide |

## SOMBRE (Pro, moments de marque)

| Token | Hex | Usage | Contraste |
|---|---|---|---|
| `--fu-dark-canvas` | `#080F0D` | fond Pro | — |
| `--fu-dark-surface` | `#0F1A16` | panneaux élevés Pro | hiérarchie par valeur de fond + bordures, pas d'ombre |
| `--fu-dark-text-primary` | `#E9F1EC` | texte principal sombre | **15,48:1** ✓ |
| `--fu-dark-text-secondary` | `rgba(233,241,236,.62)` | secondaire sombre | **6,55:1** ✓ |
| (réserve) `--fu-dark-border` | `rgba(233,241,236,.14)` | hairlines sombres | — |
| vert sur sombre | `#00C27A` | signaux | **7,63:1** ✓ |

## Échelles (définies P1a, implémentées P1b)

### `--fu-space-*` — rythme 4 px

`0:0 · 1:4 · 2:8 · 3:12 · 4:16 · 5:20 · 6:24 · 7:32 · 8:40 · 9:48 · 10:64`
(64 réservé au marketing ; le produit ne crée pas de vides 64–96 px internes.)

### `--fu-radius-*` — hiérarchisé, jamais uniforme

| Token | Valeur | Catégorie |
|---|---|---|
| `--fu-radius-control` | 6 px | boutons, champs, chips carrées |
| `--fu-radius-card` | 10 px | objets réellement bornés (ticket, panneau de carte) |
| `--fu-radius-media` | 14 px | médias réels |
| `--fu-radius-modal` | 16 px | modales |
| `--fu-radius-sheet` | 20 px (haut seulement) | feuilles |
| `--fu-radius-avatar` | 9999 px | avatars, puces |
| `--fu-radius-appicon` | dérivé P1c | icône d'application |

Échelle strictement croissante par catégorie — la non-monotonie R5
(`xl` 24 > `2xl` 16) est le contre-exemple à tester en lint/CI (P1b).

### `--fu-shadow-*` — cinq niveaux d'élévation

`0` plat (défaut) · `1` subtil `0 1px 2px rgba(8,15,13,.05)` ·
`2` collant/interactif `0 1px 2px rgba(8,15,13,.05), 0 4px 16px rgba(8,15,13,.06)` ·
`3` feuille/modale `0 8px 32px rgba(8,15,13,.14)` ·
`4` overlay exceptionnel `0 16px 48px rgba(8,15,13,.20)`.
Jamais d'ombre en Pro dense ; jamais la même ombre sous toutes les cartes.

### `--fu-font-*`

Famille : `--fu-font-sans` Geist Sans (+ fallback métrique système) ;
`--fu-font-mono` Geist Mono (`tabular-nums`) pour horaires, durées, prix en
colonne, identifiants ; Poppins **exclusivement marque** (wordmark, print,
marketing for-business) ; IBM Plex Sans Arabic conditionnel.
Corps : `12 · 13 · 14 · 15 · 16 · 19 · 22 · 26 · 30 · 38` ; texte courant
≥ 15 ; données denses Pro ≥ 13 ; jamais de titre marketing dans le produit.
Graisses : 400 corps · 500 emphase/valeurs · 600 identité/titres ·
700 réservé au wordmark et aux chiffres display (file).

### `--fu-duration-*` / `--fu-ease-*`

`--fu-duration-1` 120 ms (retour immédiat) · `--fu-duration-2` 220 ms
(transition d'état) · `--fu-duration-3` 320 ms (feuille/modale) ·
`--fu-ease` `cubic-bezier(0.2, 0, 0, 1)` — un seul moment orchestré par
écran ; `prefers-reduced-motion` supprime translation/échelle, garde
l'opacité < 100 ms (non négociable).

### `--fu-z-*`

`base:0 · raised:10 · sticky:20 · overlay:30 · sheet:40 · toast:50` —
**consommés par les primitives d'overlay dès P1b** (l'échec R5 : un système
z défini et contourné par tous ses clients). Le scoping de thème se fait sur
`:root`, jamais sur un `<div>`, pour survivre aux portails Radix.

## Contrastes exigés vérifiés (récapitulatif chiffré)

| Paire | Ratio | AA |
|---|---|---|
| Texte principal sur fond (`#080F0D` / `#FFFFFF`) | **19,36:1** | ✓ |
| Texte secondaire sur fond (62 % / blanc) | **5,48:1** | ✓ |
| Texte de CTA sur vert primaire (`#080F0D` / `#00C27A`) | **8,30:1** | ✓ |
| (contre-exemple interdit : blanc / `#00C27A`) | 2,33:1 | ✗ |
| Texte principal sombre (`#E9F1EC` / `#0F1A16`) | 15,48:1 | ✓ |
| Texte secondaire sombre (62 % / `#0F1A16`) | 6,55:1 | ✓ |
