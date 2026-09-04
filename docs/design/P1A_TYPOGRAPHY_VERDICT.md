# P1a — Verdict typographique

Date : 2026-09-04 · Test : `design/p1a/typography/falsification-test.html`
(HTML statique hors application, Geist Sans / Switzer / Poppins rendus côte à
côte, FR et EN). Captures : `falsification-full.png` + un fichier par bloc
(`bloc1-agenda-{fr,en}.png`, `bloc2-carte-{fr,en}.png`,
`bloc3-chiffres-{fr,en}.png`). Mesures relevées au pixel dans Chromium
(Playwright, `document.fonts.ready` attendu).

## Verdict

**Geist Sans est confirmée comme police d'interface.** Geist Mono pour les
données numériques (horaires, durées, prix en colonne, identifiants).
**Poppins reste la police de marque** — logo, wordmark, print, cartes,
signalétique, page marketing for-business — et n'est pas retenue comme police
d'interface.

## Mesures

### Bloc 1 — ligne d'agenda pro (14 px, colonne 320 px, fond #0F1A16)

`09:30 – 10:15 · Dégradé américain + contour barbe · Mohamed El Amrani · 45 min · 32,00 €`

| Police | FR | EN | Débordement / troncature du prix |
|---|---|---|---|
| Geist Sans | **2 lignes, 61 px** | 2 lignes, 61 px | aucun |
| Switzer | 2 lignes, 61 px | 2 lignes, 61 px | aucun |
| Poppins | **3 lignes, 81 px (+33 %)** | 3 lignes, 81 px | aucun, mais une ligne entière de plus |

Critère « tient sur une ligne ou coupe proprement » : à 320 px aucune police ne
tient sur une seule ligne physique (contenu ~50 caractères) ; Geist coupe
proprement en 2 lignes sans troncature du prix. Poppins consomme une troisième
ligne — c'est exactement le coût de densité que le choix §2.2 anticipait, ici
chiffré : **+33 % de hauteur par rangée d'agenda**.

### Bloc 2 — carte de résultat (358 px)

Nom : `Salon de Coiffure Le Barbier de Saint-Germain-en-Laye` (52 caractères).

| Police | Lignes du nom | Ligne de métadonnées (`Barbershop · Saint-Germain-en-Laye · 1,7 km · Ouvert`) |
|---|---|---|
| Geist Sans | **2 (sans clamp forcé)** | **1 ligne** |
| Switzer | 2 | 2 lignes (« Ouvert » passe à la ligne) |
| Poppins | 2 | 2 lignes |

Geist est la seule des trois à garder la ligne de métadonnées entière sur une
ligne à 358 px — un avantage direct pour la carte de résultat de P2.

### Bloc 3 — chiffres tabulaires (10 prix, 10 durées, 10 horaires)

Mesure : écart max des bords droits par colonne, et uniformité de largeur des
glyphes 0–9 (20 répétitions par glyphe).

| Police | Écart de colonne | Écart de largeur de chiffre |
|---|---|---|
| Geist Mono | **0 px** | **0 px** |
| Switzer (`tabular-nums`) | 0 px | 0 px |
| Poppins (`tabular-nums`) | 0 px | 0,006 px/glyphe (négligeable) |

Alignement au pixel : Geist Mono et Switzer parfaits ; Poppins passable mais
visiblement plus large (colonne de prix ~8 % plus large à contenu égal).

### Confort à 14 px sur fond sombre

Constat visuel sur `bloc1-agenda-*.png` : Geist reste nette et ouverte à
14 px sur `#0F1A16` (hauteur d'x généreuse, chasse compacte) ; Switzer
équivalente ; Poppins reste lisible mais ses formes géométriques rondes plus
larges fatiguent la rangée dense — et la règle de marque existante lui
interdit déjà tout corps sous 14 px (MASTER_SPEC §15), ce qui condamne la
densité Pro.

## Conclusion des quatre critères (Geist Sans)

1. Ligne d'agenda : **PASS** (coupe propre, prix intact, 2 lignes).
2. Nom long sur 2 lignes max à 358 px : **PASS**.
3. Alignement vertical des chiffres au pixel : **PASS** (Geist Mono, 0 px).
4. Confort 14 px sur sombre : **PASS**.

**Test passé → décision actée, on n'y revient plus.** Switzer, également
passante, reste le repli documenté ; il n'est pas activé. Poppins conserve son
rôle de marque exclusivement.

## Notes d'implémentation (pour P1b)

- Charger Geist Sans/Geist Mono en fichiers locaux (`public/fonts/`), pas de
  CDN en production ; `font-display: swap` + fallback métrique.
- `font-variant-numeric: tabular-nums` par token (`--fu-font-*`) sur tout
  horaire/durée/prix en colonne — Geist Mono là où la colonne est le contenu.
- L'arabe reste sur IBM Plex Sans Arabic en chargement conditionnel (acquis
  i18n conservé).
