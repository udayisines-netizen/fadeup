# P1a — Audit des directions rejetées

Date : 2026-09-04 · Branche `p1a/audit-direction` · Périmètre : P1a §3.1–§3.2.
Documents lus : `GREENFIELD_RULES.md`, `PRODUCT_UI_BLUEPRINT.md`, `SCREEN_BLUEPRINTS.md`,
`WEB_UI_PURGE_INVENTORY.md`, `R5R0_FRONTEND_AUDIT.md`, `DESIGN_SYSTEM.md`,
`MOTION_SYSTEM.md`, `R5R_FRESHA_REDESIGN_PLAN.md`, `FADEUP_VISUAL_V3_DIRECTION.md`.
Ces documents décrivent des versions supprimées ; ils valent ici comme preuve
d'implémentation et preuve d'anti-pattern, jamais comme direction visuelle.

## 1. Ce qui a été rejeté, et pourquoi

**R5 (août 2026) — rejet produit/design, pas rejet d'ingénierie.** 11 commits,
+9 492 lignes. Le fond technique (client Supabase unique structurellement
imposé, realtime avec invalidation-jamais-payload, i18n 10 locales, discipline
d'honnêteté des données) était excellent et a survécu. Le visuel a été rejeté
parce que :

- **Un design system de prose.** Tokens sémantiques adoptés à ~2,3 % (20 usages
  contre 848 utilitaires Tailwind bruts) ; le token « BOOK » (`--fu-control-xl`)
  avait zéro usage ; le système de z-index était contourné par toutes les
  primitives d'overlay qu'il devait gouverner.
- **Échelle de rayon cassée** : `rounded-xl` (24 px) plus grand que
  `rounded-2xl` (16 px) — la carte pro opérationnelle plus ronde que la surface
  de conversion consumer.
- **Hiérarchie de conversion inversée** : Follow rendu au-dessus de Book et
  portant la seule ombre de la page profil.
- **CTA primaire à 3,58:1** de contraste — échec WCAG AA — avec une suite
  « accessibilité » sans aucune assertion de contraste.
- **Aucune imagerie** dans le produit client : monogrammes et bandes de
  dégradé vides.
- **Cinq mécanismes de thème parallèles**, dont un pro forcé sombre non
  approuvé, et un scoping par attribut qui cassait à la frontière des portails
  Radix (tous les overlays du pro rendus en palette claire).
- **Chrome mobile ~14 % du viewport** avant tout contenu ; sélecteurs de
  langue/thème dans l'en-tête mobile.
- **Grille tarifaire fausse verrouillée par un test** (catalogue jamais aligné
  sur la décision commerciale).
- Une **fausse file animée** (position, ETA, deux personnes nommées) sur
  `/for-business`, cachée du garde-fou i18n/donnée par une exemption.

**R5R « Fresha-derived » (31 août) — plan jamais approuvé comme exécution
visuelle.** Sa cartographie données-réelles/écarts (§0) reste factuellement
précieuse et a nourri le présent contrat de données. Son exécution visuelle a
été balayée avec la purge.

**V3 « editorial certainty » (31 août – 1er sept) — construit, prévisualisé,
rejeté puis purgé** (commit `ebfbd98`). Direction : sérif éditorial Instrument
Serif, matériaux pearl/graphite, héros photographique Artlist, sept fonds
BG-01…07. Le rejet est un rejet de direction par le fondateur ; la purge a
supprimé `customer-v3/`, `pro-v3/`, `ui-v3.css` et 44 pages client/pro/
marketing. Seuls le back-office `/platform` (opérateur Worker V2), les
primitives dont il dépend, et l'infrastructure non visuelle (`lib/queries`,
realtime, i18n, auth) ont été conservés — l'inventaire de purge en fait foi.

## 2. Ce que P1 doit éviter de refaire

1. **Un système de tokens que le produit n'utilise pas.** P1b doit brancher le
   lint/l'usage dès la première primitive ; un token sans consommateur est un
   mensonge documenté.
2. **Casser la monotonie des échelles** (rayon, type). Toute échelle doit être
   vérifiable par arithmétique et bloquer les valeurs Tailwind par défaut
   qu'elle prétend remplacer.
3. **Laisser un CTA primaire sous 4,5:1** ou sans assertion de contraste
   automatisée.
4. **Follow qui concurrence Book.** La hiérarchie de conversion est une règle
   produit, pas un choix de composant.
5. **Thème par attribut sur un `<div>`** : les portails Radix montent sur
   `document.body` et n'héritent rien. Le scoping de thème doit tenir à la
   frontière des overlays (thème sur `:root`, ou `container` explicite).
6. **Exemptions de garde-fous qui cachent des surfaces entières** (l'exemption
   `components/for-business/` masquait à la fois des chaînes anglaises et une
   file fabriquée). Les détecteurs doivent couvrir les entités HTML, les
   ternaires JSX et les littéraux dans les structures de données rendues.
7. **Le sombre partout.** Consumer est clair d'abord ; le sombre est sélectif
   (décision verrouillée P1a §6.2). V3 avait raison sur un point : le sombre
   FadeUp est teinté vert (`#0F1A16`), jamais noir pur ni noir/or de cliché.
8. **Écrans pensés en cartes** : nested-card syndrome, tout-à-24px, ombre grise
   uniforme, hero SaaS dans le produit — les tics déjà listés par MASTER_SPEC
   §15 et R5R0 §7.
9. **Fabriquer ce qui n'existe pas** : la base n'a ni avis, ni médias de
   travaux, ni estimation d'attente. R5R §0 l'avait bien posé : le slot absent
   se replie, il ne se remplit jamais d'un placebo.
10. **Marketing qui ment** : aucune démo animée de produit avec des données
    inventées sans mention d'illustration.

## 3. Ce qui mérite d'être conservé comme acquis (non visuel)

Le client Supabase unique gardé par test, la couche `lib/queries` (44 modules),
`useRealtimeInvalidation` et ses invariants, l'architecture i18n et ses tests
structurels, le modèle de supply marketplace en base (`marketplace_supply_type`),
et la discipline d'honnêteté des données de R5 (composants qui refusent de
deviner). Ce sont des contrats, pas des décisions visuelles.

## 4. Logo — analyse du master (`img/fadeup-mark-primary.png`)

- **Géométrie** : 1254×1254 px, PNG alpha. Trois croissants entrelacés formant
  un anneau tressé continu, asymétrique (léger déséquilibre bas-gauche qui lui
  donne son mouvement). Non lettriste — aucun F, et il ne doit jamais en
  recevoir.
- **Gamme chromatique réelle** : du blanc-vert spéculaire (~`#EAFFF5`) aux
  verts saturés (~`#17C97B`/`#00A868`) jusqu'à des ombres vert-noir très
  profondes (~`#0A2018` et plus sombre). Les reflets sont des artefacts
  d'éclairage 3D : on n'en prélève pas des couleurs d'interface (règle §7).
- **Sur fond clair** : excellent — les ombres profondes dessinent le relief,
  la tresse est nette. **Sur fond sombre** (`#0F1A16`) : très bon, les brins
  clairs portent la forme ; les segments d'ombre fusionnent avec le fond, ce
  qui amincit visuellement l'anneau — prévoir une taille minimale plus grande
  sur sombre.
- **Lisibilité mesurée** (rendus réels 16/32/64/512, clair et sombre,
  `design/p1a/logo/`) :
  - **512 px** : parfait, aucune limite.
  - **64 px** : la tresse reste lisible ; les trois brins se distinguent ; les
    zones d'ombre commencent à se souder. Taille minimale recommandée pour le
    master tel quel.
  - **32 px** : l'entrelacs fusionne en un anneau tourbillonné ; identifiable
    comme « l'anneau FadeUp » mais plus comme une tresse ; sur clair, les
    segments sombres deviennent boueux.
  - **16 px** : illisible — tache annulaire verte moirée ; sur sombre, presque
    invisible.
- **Conséquence (pour P1c)** : favicon et icône d'application exigent un
  dérivé simplifié (anneau aplati à contraste renforcé, géométrie non
  redessinée mais nettoyée), jamais le master réduit. Le master reste l'unique
  logo officiel ; empreinte md5 `46351c8dc45b1cf330bcdbdacae872f3`, copie
  conforme dans `apps/web/public/brand/`.
