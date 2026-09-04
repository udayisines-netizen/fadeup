# P1 — Fondation de marque FadeUp

Consolidé en P1c (2026-09-04). Réconcilie P1A_VISUAL_DIRECTION.md et
P1A_TOKENS.md (qui restent les artefacts d'exploration) ; en cas d'écart,
CE document et P1_DESIGN_SYSTEM.md font foi pour P2+.

## Direction retenue — A, Éditorial minimal, et pourquoi

Blanc tournant fort, conduite typographique, vert très retenu, rangées à
filet fin plutôt que cartes à ombre. Retenue contre B (« le média mène » —
expose aujourd'hui des cadres vides) et C (« luxe produit » — l'élévation ne
survit pas à la densité Pro sombre). Cinq raisons mesurées : lecture la plus
rapide (nom → état → prix → action en un balayage), désirable pour un barber
(registre éditorial, pas SaaS), transposable au Pro sombre sans traduction,
rien ne concurrence le CTA, et le logo — seul objet « riche » — existe au
maximum sur une page plate. Emprunts actés : sombre sélectif pour les
moments de marque (Passport, marketing) ; UNE ombre, réservée aux barres
d'action collantes.

## Le logo canonique — règle absolue

- **Master** : `apps/web/public/brand/fadeup-mark-primary.png` (1254×1254),
  copie conforme de `/opt/fadeup/img/fadeup-mark-primary.png`.
- **md5 : `46351c8dc45b1cf330bcdbdacae872f3`** — vérifié à chaque lot.
- Anneau tressé vert, trois rubans entrelacés, abstrait, dimensionnel,
  **non lettriste**. Interdit : le redessiner, le régénérer, l'approximer,
  en faire un F, changer le nombre de rubans, aplatir sa géométrie,
  écraser le fichier.
- **Le logo est le seul élément à dégradé de l'interface.**
- Lisibilité mesurée (P1a) : parfait à 512 px, lisible à 64, tresse
  fusionnée à 32, illisible à 16.

## Dérivés et seuils d'usage (produits en P1c)

| Asset | Chemin | Usage | Seuil |
|---|---|---|---|
| Master | `public/brand/fadeup-mark-primary.png` | partout où ≥ 40 px | ≥ 40 px |
| Micro-mark | `public/brand/fadeup-mark-micro.svg` | favicon, onglet, pixel | **16–32 px uniquement** |
| Monochrome | `public/brand/fadeup-mark-monochrome.svg` | broderie, tampon, fond unicolore | currentColor |
| Favicon | `public/favicon.svg` + `public/favicon.ico` | navigateur | dérivés du micro |
| Icône d'app | `public/apple-touch-icon.png` | iOS/Android | master sur squircle encre 22,37 % |
| Wordmark | `public/brand/fadeup-wordmark.svg` | « FadeUp », Poppins SemiBold vectorisée | jamais en corps d'interface |
| Lockup | `public/brand/fadeup-lockup-horizontal.svg` | mark + wordmark, proportions FIXÉES (mark 100 / espace 28 / wordmark h46) | ne pas recomposer |

**Le micro-mark ne remplace JAMAIS le master** : c'est un dérivé technique
secondaire pour les tailles où la tresse fusionne (< 40 px). Sa géométrie
« trois arcs » cite les trois rubans sans prétendre les redessiner.

## Étude d'application — dix cas

1. **Fond clair (produit consumer)** : master sur blanc, 32–40 px en
   navigation ; l'anneau est l'unique objet dimensionnel de la page.
2. **Fond sombre (Pro, marketing)** : master tel quel — ses verts portent
   sur `#080F0D`/`#0F1A16` ; jamais de halo ni d'ombre ajoutés.
3. **Mark + wordmark** : uniquement via le lockup fixé ; texte en
   currentColor (encre sur clair, `#EDEFEE` sur sombre).
4. **Navigation desktop** : master 32 px + « FadeUp » en Geist SemiBold
   (chrome d'interface, pas le wordmark Poppins — voir P1_DESIGN_SYSTEM §CTA).
5. **En-tête mobile** : master seul 32–36 px, sans wordmark.
6. **Icône d'application** : `apple-touch-icon.png` — master 132 px centré
   sur squircle encre, rayon 22,37 %.
7. **Favicon** : micro-mark (SVG + ICO 16/32/48). Au-delà de l'onglet,
   revenir au master.
8. **Monochrome** : broderie, gravure, tampon, documents une-couleur —
   `fadeup-mark-monochrome.svg`, une seule couleur, jamais de dégradé simulé.
9. **Usage physique** : vitrophanie et print → master haute résolution ;
   petits formats physiques (étiquette) → monochrome.
10. **Héros marketing** : master en grand (256–512 px) sur sombre éditorial,
    éventuellement adossé au dégradé de marque (`--fu-gradient-brand`) —
    le SEUL contexte où un dégradé d'arrière-plan est admis.

Zones de protection : espace libre ≥ 25 % du diamètre du mark sur chaque
côté ; jamais posé sur une photo chargée sans voile (`--fu-media-gradient`).

## Personnalité

**Oui** : premium, culturel, moderne, confiant, social, natif consumer,
rapide, digne de confiance, désirable, précis, global.
**Non** : corporate, SaaS générique, logiciel de salon, crypto/web3,
startup IA, tableau de bord bancaire, interface de jeu, marketplace bon
marché, cliché de barbershop.

Le test : un barber doit VOULOIR partager son profil ; un client doit sentir
que FadeUp a sa place à côté des meilleures applications de son téléphone ;
un patron doit trouver Pro assez sérieux pour son commerce.

## Direction photographique

**Recherché** : culture barber contemporaine — personnes réelles, travail
réel, geste précis, détail (main, lame, texture de peau et de cheveu),
environnements de salon premium et vécus, portrait éditorial à lumière
naturelle ou dirigée, communauté, authenticité. Cadrages francs, arrière-plans
réels, retouche sobre.

**À éviter** : cliché de banque d'images, enseignes de barbier en boucle,
tondeuses sur fond noir, faux luxe, fumée néon, esthétique cyber, salons
stériles trop parfaits générés par IA.

**Règle d'honnêteté** : toute image de démonstration est clairement
identifiée comme telle (dossier séparé, jamais attribuée à un professionnel
réel). Un profil sans photo montre l'état « média manquant » de `MediaFrame`
— fréquent, pas honteux. Les photos réutilisées en social exigent le
consentement explicite (MASTER_SPEC §10).

## Anti-patterns (rappel, liste complète dans P1_DOWNSTREAM_CONTRACT)

Blanc sur vert (2,33:1 — l'échec de la version précédente), défauts Tailwind
non retouchés, aspect shadcn brut, grandes cartes arrondies génériques,
dégradés violets SaaS, glassmorphisme, titres géants vides, admin B2B
générique, icônes décoratives, MAJUSCULES-ESPACÉES au-dessus des titres hors
étiquettes Pro mono, métadonnées en chapelet de points médians, un seul mot
du titre coloré, flèche « → » collée aux liens, même ombre grise sous toutes
les cartes, marqueurs 01/02/03 hors séquence réelle.
