# P1 — Design system FadeUp (référence d'implémentation)

Consolidé en P1c. Source exécutable : `apps/web/src/styles/*.css` (tokens) et
`apps/web/src/shared/ui/*` (primitives). Ce document explique et fige les
règles ; le code EST la valeur exacte. `/dev/ui` (DEV) montre tout, dans les
trois thèmes, FR/EN, LTR/RTL, motion réduite.

## 1. Palette (contrastes mesurés)

Trois thèmes sur `<body data-theme="consumer|pro|editorial">` (le legacy
/platform garde `<html data-theme>` — les deux coexistent). Tokens `--fu-*`.

**Consumer (clair)** — `tokens-consumer.css`
| Token | Valeur | Contraste |
|---|---|---|
| `--fu-canvas` / `--fu-surface` | `#FFFFFF` | — |
| `--fu-surface-subtle` | `#FAFBFA` | — |
| `--fu-surface-brand` | `#E6FFF3` | encre dessus 18,41:1 |
| `--fu-text-primary` | `#080F0D` | **19,36:1** |
| `--fu-text-secondary` | rgba(8,15,13,.62) | **5,48:1** |
| `--fu-text-tertiary` | rgba(8,15,13,.42) | 2,83:1 — **icônes/désactivé UNIQUEMENT, jamais du texte** (42 violations axe purgées en P1b) |
| `--fu-border` | rgba(8,15,13,.10) | le filet |
| `--fu-border-strong` | rgba(8,15,13,.18) | contours de contrôle |
| `--fu-accent` | `#00C27A` | fond de CTA |
| `--fu-accent-fg` | `#080F0D` | **8,30:1 — JAMAIS blanc (2,33:1)**, garde de lint |
| `--fu-accent-text` | `#00875A` | vert COMME TEXTE sur clair, 4,55:1 |
| `--fu-accent-hover` | `#00875A` · `--fu-accent-soft` `#E6FFF3` · `--fu-focus` `#00875A` |
| `--fu-success` `#00875A` · `--fu-danger` `#B23F3C` (texte d'erreur ≥4,5:1) |
| `--fu-shadow-sticky` | la SEULE ombre consumer (barre collante) |

**Pro (sombre)** — `tokens-pro.css` : canvas `#080F0D`, surface `#0F1A16`,
subtle `#0B1311`, hover `#17241F` ; texte `#EDEFEE` (15,48:1) / .64 (6,55:1)
/ .40 ; accent `#28E18E` (texte vert 10,39:1), accent-fg encre ; **états
opérationnels CONFINÉS au Pro** : ok `#28E18E`, warn `#E0A33E`, danger
`#D9534F`, neutral .36. Hiérarchie par valeur de fond et bordures — pas d'ombre.

**Editorial (marketing + platform V2)** — `tokens-editorial.css` : base Pro +
`--fu-gradient-brand` (hero/Passport UNIQUEMENT), accent `#00C27A`.

**Interdits** : toute classe de couleur Tailwind par défaut, tout hex en dur
dans un `.tsx`, le bleu comme couleur silencieuse (liens, focus, info),
blanc sur vert. Lint bloquant (`eslint.config.js` + `scripts/check-fu-palette.mjs`).

## 2. Typographie

- **Interface : Geist Sans** (`font-fu-sans`), 300–700 auto-hébergées.
- **Données numériques : Geist Mono** (`font-fu-mono`, `tabular-nums`) —
  horaires, durées, prix en colonne, identifiants, étiquettes techniques Pro.
- **Poppins = marque uniquement** (wordmark, print, marketing for-business) ;
  n'entre JAMAIS dans l'interface (+33 % de hauteur mesuré sur ligne d'agenda).
- Échelle (`text-fu-*`) : 12 (badges/puces SEULEMENT) · 14 (plancher du texte
  lisible) · 16 (corps) · 20 · 24 · 32 · 44 · 60. Ligne < 72 caractères.
- Graisses : 400 corps · 500 emphase/valeurs · 600 identité/titres · 700
  réservé wordmark et chiffres display.
- Le nom d'un profil : 600, serré (`tracking-tight`), échelle brutale face
  aux métadonnées 14 secondaires — c'est LA signature direction A.
- Arabe : IBM Plex Sans Arabic en chargement conditionnel (acquis legacy).

## 3. Espacement, grille, ruptures

Échelle 4 px (Tailwind par défaut = échelle P1b, vérifié). 64–96 px réservés
au marketing. Conteneurs : contenu lisible `max-w-xl`/`max-w-2xl` ; pages
composées `max-w-4xl`/`max-w-5xl` centrées. Ruptures : **390 / 430 / 768 /
1024 / 1440** — mobile-first strict ; la barre basse consumer disparaît à
768 ; la barre latérale Pro apparaît à 1024. **Desktop composé
intentionnellement** (rail + liste, deux colonnes profil, deux moitiés Pro),
jamais du mobile étiré.

## 4. Rayons (hiérarchisés, jamais uniformes)

`--radius-control` 8 · `--radius-card` 12 · `--radius-media` 4 ·
`--radius-modal` 16 · `--radius-sheet` 20 (coins hauts) ·
`--radius-avatar` 9999 · `--radius-appicon` 22,37 %. Tout-à-24 = interface
générée. Un média n'est jamais plus rond qu'un contrôle.

## 5. Élévation

Plate par défaut. La hiérarchie vient du fond (`surface` / `surface-subtle` /
`surface-hover`) et des filets. **Une ombre existe** : `--fu-shadow-sticky`,
sur `StickyActionBar` (et elle seule) côté consumer. Overlays : scrim
`--fu-scrim` + bordure, pas d'ombre portée décorative. Pro : zéro ombre.

## 6. Icônes

`shared/ui/icons.ts` est LE module (sélection lucide-react, contour,
épaisseur constante). Consumer et Pro partagent la famille. Zéro icône
décorative, zéro import lucide direct dans un composant. Icônes
directionnelles retournées en RTL (`rtl:-scale-x-100`) ; logos et avatars non.

## 7. Hiérarchie des CTA

1. **Book** — `Button variant="primary"` : vert plein `--fu-accent`, texte
   ENCRE. Réservé au CTA transactionnel dominant, un par surface. Sur
   mobile de conversion : pleine largeur dans `StickyActionBar`.
   Indisponible → le CTA affiche l'état RÉEL (désactivé + StateBadge/texte),
   jamais masqué, jamais menteur.
2. **Follow** — `variant="secondary"` : contour + encre. JAMAIS vert plein.
   Bascule confirmée par le pop motion, optimisme autorisé.
3. Tertiaire — texte seul. Destructive — Pro uniquement.
4. Liens verts en `--fu-accent-text` (deep), soulignés au survol.
Aucune flèche « → » par défaut ; toute icône est explicite.

## 8. Grammaire des composants

- **`Row` est la primitive centrale** : rangée à filet fin
  (`border-b --fu-border`), leading / titre (600, clamp 2 lignes possible) /
  méta 14 secondaire / zone de fin. Porte listes de résultats, services,
  réservations, réglages, files. `Card` est l'exception (ticket, panneau),
  jamais la grille par défaut.
- Formulaires : label OBLIGATOIRE et visible ; `error` remplace `hint` et
  pose les aria ; jamais un placeholder en guise de label.
- Overlays : Radix (focus piégé, Échap, aria) + motion V2 ; feuille par le
  bas < 768, côté inline-end au-dessus.
- Données : `Money` (centimes obligatoires, garde runtime), `Duration`
  (« 1 h 15 », jamais « 75 min »), `DateTime` (UTC → fuseau du lieu côté
  pro, de l'appareil côté client, mention si différents), tous en Mono.
- `Avatar` : initiales déterministes en repli, jamais de silhouette.
- `MediaFrame` : le média manquant est un état de PREMIÈRE CLASSE
  (icône + libellé ; `compact` pour les vignettes).
- `Skeleton` reproduit la géométrie réelle (`SkeletonRow`).
- `EmptyState` : titre + description + **action obligatoire**.
- Propriétés logiques CSS uniquement (`start/end`, `ms/me`, `inset-inline`) —
  aucun `left:`/`right:`.

## 9. Consumer vs Pro — deux grammaires

| | Consumer | Pro |
|---|---|---|
| Thème | clair, blanc tournant | sombre `#080F0D`, dense |
| Densité | aérée, comparaison par rangées | opérationnelle, `min-h` réduits, Mono pour étiquettes |
| Couleur d'état | vert de marque + neutres ; JAMAIS warn/danger opérationnels | états ambre/rouge CONFINÉS ici |
| Vocabulaire nav | 5 onglets figés | TODAY/NOW/NEXT/QUEUE + latérale conditionnée aux entitlements (`live_capabilities`), une capacité absente n'est PAS rendue |
| Étiquettes | phrases, jamais de majuscules espacées | étiquettes mono `tracking-widest` autorisées (TODAY, FILE) |
| Ombre | sticky bar uniquement | aucune |

## 10. Preuve sociale — règles

**Cinq métriques, cinq traitements distincts** (`MetricValue`) : Followers
(Users, compact « 1,2 k »), Verified Clients (BadgeCheck, mono, vert texte),
Rating (étoile pleine, mono décimal), Reviews (bulle), Likes (cœur). Jamais
agrégées, jamais la même icône. Absente → « — », **jamais un zéro fabriqué** ;
`Rating` null → « Pas encore d'avis », jamais zéro étoile. Abonnés publics ;
« coupes réalisées » jamais. Notes Google jamais présentées comme avis FadeUp.
`unclaimed` : « Pas encore géré sur FadeUp », neutre — ni rouge, ni alerte ;
claimed ≠ verified (le second seul porte l'icône).

## 11. ADN du Passport

Personnel, premium, persistant, reconnaissable, natif Wallet. Visuel : moment
de marque SOMBRE (editorial) sur produit clair, étiquette mono espacée
« FADE PASSPORT », révélation `fu-passport-in`. Jamais l'aspect d'une carte
bancaire, d'un wallet crypto, d'un pass NFT ou d'une carte d'embarquement.
Le produit ne dit jamais « Créez votre Passport » — il existe déjà.

## 12. Tous les états

Génériques : DEFAULT · HOVER · PRESSED · FOCUS (anneau `--fu-focus`, offset
2) · DISABLED (opacité .45 ; distinct de LOADING qui garde sa couleur ET sa
largeur) · LOADING · SKELETON · EMPTY (avec action) · ERROR (clé i18n,
jamais le texte brut) · SUCCESS.
FadeUp (`StateBadge` + `ClaimBadge`) : UNCLAIMED · CLAIMED · VERIFIED ·
BOOKABLE · NOT-BOOKABLE · AVAILABLE · UNAVAILABLE · PENDING-REQUEST (« En
attente de confirmation », jamais « Réservé ») · CONFIRMED · QUEUE-OPEN
(point vivant) · QUEUE-FULL · QUEUE-CLOSED · CALLED (moment de marque) ·
MISSED · OFFLINE · RECONNECTING · PARTIAL-DATA (l'état honnête quand une
source échoue). Jamais la couleur seule : toujours texte + forme.
