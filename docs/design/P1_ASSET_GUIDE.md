# P1 — Guide des assets FadeUp

Consolidé en P1c. Tout chemin est relatif à `apps/web/`.

## Marque

| Asset | Chemin | Quand l'utiliser | Interdit |
|---|---|---|---|
| **Master mark** (md5 `46351c8dc45b1cf330bcdbdacae872f3`) | `public/brand/fadeup-mark-primary.png` | partout où le mark rend ≥ 40 px : navigation, en-têtes, héros, icône d'app (via dérivé), print | modifier, régénérer, recadrer, recolorer, aplatir, poser une ombre |
| Micro-mark | `public/brand/fadeup-mark-micro.svg` | 16–32 px : favicon, onglet, contextes pixel | l'utiliser ≥ 40 px (le master reprend), le recolorer hors verts de marque |
| Monochrome | `public/brand/fadeup-mark-monochrome.svg` | une couleur imposée : broderie, tampon, gravure, papier | lui simuler un dégradé |
| Wordmark | `public/brand/fadeup-wordmark.svg` | « FadeUp » typographié (Poppins SemiBold vectorisée) : print, signalétique, marketing | corps d'interface, autre casse que « FadeUp », lettre-icône |
| Lockup horizontal | `public/brand/fadeup-lockup-horizontal.svg` | mark + nom ensemble (en-têtes marketing, documents) | recomposer mark et wordmark à la main — les proportions sont fixées |
| Favicon | `public/favicon.svg`, `public/favicon.ico` | navigateur (référencés dans index.html) | — |
| Icône d'app | `public/apple-touch-icon.png` (180×180, squircle encre 22,37 %) | apple-touch / PWA | recadrer le master autrement |

Seuils : master parfait à 512 px, lisible à 64, fusionné à 32, illisible à
16 → **bascule micro-mark sous 40 px**. Zone de protection : ≥ 25 % du
diamètre. Le logo est le seul élément à dégradé de l'interface.

## Polices

| Fichiers | Chemin | Rôle |
|---|---|---|
| Geist Sans 300–700 (latin, woff2) | `public/fonts/geist-sans-latin-*.woff2` | interface (`font-fu-sans`) ; 400 et 600 préchargés dans index.html |
| Geist Mono 300–700 (latin, woff2) | `public/fonts/geist-mono-latin-*.woff2` | données numériques (`font-fu-mono`, tabular-nums) |
| Instrument Serif | `public/fonts/instrument-serif-*.woff2` | LEGACY marketing (surfaces conservées) — pas un choix V2 |
| Poppins | non embarquée (vectorisée dans le wordmark) | marque uniquement ; si un usage print l'exige, la charger hors produit |

Jamais de CDN de polices (latence tierce + RGPD, lancement France).

## Styles et tokens (source exécutable)

| Fichier | Contenu |
|---|---|
| `src/styles/theme.css` | échelles partagées `@theme` (texte `text-fu-*`, rayons `--radius-*`), durées/z `--fu-*`, règle reduced-motion globale |
| `src/styles/tokens-consumer.css` | thème clair — `[data-theme='consumer']` |
| `src/styles/tokens-pro.css` | thème sombre Pro + états opérationnels |
| `src/styles/tokens-editorial.css` | marketing/platform + `--fu-gradient-brand` |
| `src/styles/motion.css` | vocabulaire motion (`fu-press`, `fu-rise-in`, …) |
| `src/styles/fonts.css` | @font-face Geist |
| `src/shared/motion/index.ts` | aides WAAPI (`pop`, `flashUpdate`, `playReorder`, `celebrateSuccess`) |
| `src/shared/ui/icons.ts` | LE module d'icônes (sémantiques, lucide) |

## Données de démonstration

| Fichier | Rôle |
|---|---|
| `scripts/seed-demo.sql` | 8 organisations non revendiquées (slugs `demo-*`, UUID `de3…`), données professionnelles réelles, ZÉRO métrique/activité. Idempotent. **Exécution manuelle uniquement.** |
| `scripts/unseed-demo.sql` | suppression complète (refuse si une activité réelle s'y est rattachée) |

Aucune image de démonstration n'est embarquée à ce jour : les compositions
montrent l'état « média manquant » réel. Si des images de démo arrivent :
dossier séparé `public/demo-media/`, clairement nommées, jamais attribuées à
un professionnel réel.

## Captures QA

`design/p1c/qa/<composition>-<largeur>-<langue>.png` — 390/430/768/1024/1440
× FR/EN pour /demo/discovery, /demo/profile (deux profils), /demo/pro.

## Interdits transverses

- Écraser un asset de `public/brand/` (le master est verrouillé par md5).
- Introduire une icône hors `shared/ui/icons.ts`.
- Charger une police par CDN.
- Utiliser une couleur hors tokens `--fu-*` (lint bloquant).
- Présenter une image de démonstration comme le travail d'un professionnel réel.
