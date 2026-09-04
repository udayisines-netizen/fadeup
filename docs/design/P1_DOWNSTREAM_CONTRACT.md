# P1 — CONTRAT AVAL (P2 · P3 · P4 · P5)

**Ce document est le contrat.** Trois agents en worktrees séparés, sur P2
Consumer, P3 Pro et P4 Social, doivent produire des écrans appartenant
visiblement au même produit — sans se parler. Si une décision visuelle
manque ici, c'est un défaut de P1 : remonte-le, ne l'invente pas.

Références de détail : P1_DESIGN_SYSTEM.md · P1_MOTION_SYSTEM.md ·
P1_BRAND_FOUNDATION.md · P1_ASSET_GUIDE.md · MASTER_SPEC.md (produit).
Vitrine vivante : `/dev/ui` (DEV). Études de référence : `/demo/*`
(VITE_ENABLE_DEMO). Blocages backend connus : docs/frontend/BLOCKERS.md.

---

## 1. Logo
Master `apps/web/public/brand/fadeup-mark-primary.png`
(md5 `46351c8dc45b1cf330bcdbdacae872f3`) — intouchable, ≥ 40 px.
Dérivés (P1_ASSET_GUIDE) : micro 16–32 px, monochrome, wordmark Poppins,
lockup fixé, favicon.*, apple-touch-icon. Seul élément à dégradé.

## 2. Typographie
Geist Sans = interface (`font-fu-sans`), Geist Mono = données numériques
(`font-fu-mono` + tabular-nums). Poppins = marque, jamais l'interface.
Échelle `text-fu-*` : 12 (badges seulement) / **14 plancher lisible** / 16
corps / 20 / 24 / 32 / 44 / 60. Graisses 400/500/600, 700 réservé.

## 3. Palette et tokens
UNIQUEMENT `var(--fu-*)` et `--radius-*` (styles/tokens-*.css). Thème par
surface sur `<body data-theme>` : consumer clair · pro sombre · editorial.
**Encre sur vert (8,30:1) ; blanc sur vert INTERDIT (2,33:1). Vert comme
texte sur clair = `--fu-accent-text` (#00875A).** Tertiaire = icônes et
désactivé, jamais du texte. Warn/danger opérationnels : Pro uniquement.
Le bleu n'existe pas. Lint bloquant : classes couleur Tailwind interdites,
hex interdits en .tsx, garde `--fu-accent-fg`.

## 4. Espacement
Échelle 4 px (spacing Tailwind par défaut). 64–96 px : marketing seulement.
Cibles tactiles ≥ 44 px. Contenu lisible max-w-xl/2xl ; pages max-w-4xl/5xl.

## 5. Mise en page et ruptures
Mobile-first strict. Ruptures : **390 / 430 / 768 / 1024 / 1440**.
Nav basse consumer < 768 → barre haute ≥ 768. Latérale Pro ≥ 1024
(tiroir en dessous). Feuilles : bas < 768, inline-end ≥ 768.
**Desktop composé** (rail+liste, colonnes), jamais un mobile centré.
Propriétés logiques CSS uniquement — aucun `left:`/`right:`.

## 6. Rayons
control 8 · card 12 · media 4 · modal 16 · sheet 20 (haut) · avatar 9999 ·
appicon 22,37 %. Toujours via `var(--radius-*)`.

## 7. Élévation
Plate. Hiérarchie = valeur de fond + filets (`--fu-border` ~10 %).
**Une ombre : `--fu-shadow-sticky` sur StickyActionBar.** Pro : zéro ombre.

## 8. Icônes
`@/shared/ui/icons.ts` exclusivement (ajouter là si besoin, sémantique).
Contour, épaisseur constante, partagées consumer/Pro. Directionnelles
retournées en RTL. Aucune icône décorative.

## 9. Hiérarchie des CTA
primary (vert plein, encre) = LE CTA transactionnel dominant, un par
surface · secondary (contour) = registre social/secondaire · tertiary =
texte · destructive = Pro. `loading` garde largeur ET couleur ; `disabled`
atténue. Focus : `ring-2 var(--fu-focus)` offset 2. Pas de flèche « → ».

## 10. Traitement de BOOK
Vert plein, texte encre, contextuel (profil, carte de résultat,
StickyActionBar) — **jamais un onglet**. Indisponible → l'état RÉEL affiché
(désactivé + libellé/StateBadge), profil toujours visible. Aucun optimisme
sur réservation/file/annulation. Prix affiché = `Money` sur `price_cents` +
devise de l'organisation. « À partir de » = minimum réel.

## 11. Traitement de FOLLOW
Toujours `secondary`, jamais vert plein, jamais dominant face à Book.
Bascule confirmée par `pop()`. Optimisme autorisé (follow/like/favori).
Autorisé sur profils non revendiqués. Un unfollow explicite est définitif.

## 12. Navigation consumer
**Cinq onglets, cet ordre : Accueil · Recherche · Feed · Réservations ·
Compte.** Interdit : réordonner, renommer, ajouter (Messagerie, Passport,
bouton flottant). Badge Réservations = un point, pas un compteur.
Implémentation : `app/shells/ConsumerShell.tsx` — ne pas dupliquer.

## 13. Imagerie
`MediaFrame` pour tout média (ratios portrait/carré/paysage/vidéo, rayon 4,
`compact` en vignette). **Média manquant = état de première classe**, jamais
de fausse image ni de dégradé sur du vide. `--fu-media-gradient` seulement
SOUS du texte posé sur un média réel. Avatars : initiales déterministes.
Direction photo : P1_BRAND_FOUNDATION (culture barber réelle ; anti-stock).

## 14. Preuve sociale
Cinq métriques distinctes (`MetricValue`) : Followers / Verified Clients /
Rating / Reviews / Likes — jamais agrégées, jamais la même icône. Donnée
absente → état vide honnête (« — », « Pas encore d'avis ») — **fabriquer un
zéro ou un chiffre est interdit** (loi produit §2). `ClaimBadge` :
unclaimed neutre (« Pas encore géré sur FadeUp »), claimed ≠ verified.
`pending-request` ne dit JAMAIS « réservé ».

## 15. Motion
Vocabulaire fermé (P1_MOTION_SYSTEM) : 120/220/320 ms,
cubic-bezier(.2,0,0,1), classes `fu-*` + aides WAAPI. **Un moment orchestré
par écran. La motion informe.** Listes realtime : l'élément modifié
seulement. Reduced-motion : aucune translation/échelle, opacité < 100 ms.
Framer Motion interdit.

## 16. Consumer vs Pro
Consumer : clair, aéré, vert = signal, aucun état opérationnel ambre/rouge,
phrases. Pro : sombre `#080F0D`, dense, étiquettes mono TRACKING-WIDEST
autorisées, états opérationnels confinés, nav conditionnée aux
`live_capabilities` (une capacité absente n'est PAS rendue — ni grisée ni
cadenassée), TODAY/NOW/NEXT/QUEUE comme accueil. Ni admin SaaS générique,
ni grille de KPI : insight avant data dump.

## 17. Architecture d'exécution (rappels bloquants)
`features/X` n'importe jamais `features/Y` (lint). Client Supabase :
`features/*/api/**` uniquement. Clés Query par fabriques
(`shared/data/keys.ts`). **Chercher la RPC avant d'écrire une requête** ;
`search_public_professionals` TOUJOURS avec `p_entity_type: 'shop'` sur une
surface marketplace. Realtime via `useChannel` (invalidation de clés).
i18n : namespace `v2`, clés `<zone>.<élément>.<variante>`, zéro chaîne en
dur (lint). Erreurs : `toAppError` + clés traduites, jamais le texte brut.
Tout nouvel écran V2 se construit sur `/demo/*` tant que sa route produit
n'est pas approuvée.

## 18. Motifs INTERDITS (liste fermée, exécutoire)
Blanc sur vert · vert plein sur Follow · Book en onglet · données
fabriquées (abonnés, likes, avis, notes, clients vérifiés, réservations,
disponibilité, file, temps d'attente, revenu, analytics) · zéro affiché à
la place d'une absence · badge d'alerte sur unclaimed · classes couleur
Tailwind par défaut · hex en dur dans le TSX · bleu (liens/focus/info) ·
ombres décoratives / même ombre sous toutes les cartes · glassmorphisme ·
dégradés (hors logo et hero marketing) · cartes arrondies uniformes 24 px ·
défauts Tailwind non retouchés / aspect shadcn brut · admin B2B générique ·
douze KPI en grille · icônes décoratives · MAJUSCULES-ESPACÉES hors
étiquettes mono Pro · métadonnées en chapelet de points médians · un seul
mot du titre coloré · « → » collé aux liens · marqueurs 01/02/03 hors
séquence · titres géants vides · sections immenses vides · `left:`/`right:`
en CSS · texte < 14 px · texte en tertiaire · placeholder comme label ·
état signalé par la couleur seule · cul-de-sac (état vide sans action) ·
Framer Motion · icône hors icons.ts · police par CDN · toucher au logo.

---

## Questions auxquelles ce contrat ne répond PAS encore (à trancher en aval, pas à inventer)

1. **Libellés d'état côté Pro** : `called` s'affiche « C'est votre tour »
   (voix client). P3 devra introduire la variante d'audience (« Appelé »)
   dans `states.*` sans dédoubler le composant.
2. **La carte de la recherche** (liste d'abord, carte en onglet — MASTER
   §3) : aucun langage visuel de carte (marqueurs, clusters) n'est défini.
3. **L'écran de confirmation de réservation** : le moment orchestré existe
   (motion), sa composition exacte (récapitulatif, ajout calendrier) est P2.
4. **Le visuel complet du Passport** (au-delà de l'ADN et de la révélation) :
   composition réelle en P2.
5. **Présentation des posts sociaux** (grille portfolio, viewer, ratio
   vidéo) : P4, sur les conventions média de `MediaFrame`.
6. **Graphiques analytics Pro** (courbes, cohortes) : P3 — aucun langage
   de dataviz n'est encore défini (imposer : encre/verts, pas de bleu).
7. **E-mails transactionnels** (gabarits) : hors interface, non couverts.
