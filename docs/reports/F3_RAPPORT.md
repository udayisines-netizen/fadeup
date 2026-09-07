# FadeUp — Rapport final F3 : recherche et accueil

Branche `f3/search`, créée depuis `rebuild/social-first-v2`.

**DÉCLARATION EN TÊTE (exigée par F3 §1)** : le prompt annonçait « une
migration possible mais pas attendue » ; l'inspection du contrat a prouvé
qu'elle était nécessaire (aucun état de revendication dans les 30 colonnes de
la recherche, alors que le badge neutre sur résultat est une exigence F3 §3
et « le cas le plus fréquent au lancement »). **Une migration additive** (31e
colonne `is_managed` de `search_public_professionals`, DROP+CREATE car un
type de retour ne s'étend pas par `CREATE OR REPLACE`) a été appliquée en
production après sauvegarde et retour arrière prouvé sur restauration fidèle
avec ACL comparées — procédure complète au §7. **Aucune fusion. `/platform`
intact, preuve au §9.**

---

## 1. Les paramètres de `search_public_professionals` réellement utilisés

La RPC porte 14 paramètres (tous optionnels). F3 en câble **11** :

| Paramètre | Usage F3 |
|---|---|
| `p_entity_type` | **`'shop'`, TOUJOURS, EXPLICITEMENT** — voir ci-dessous |
| `p_query` | le champ de recherche libre (nom d'organisation, ville, style) |
| `p_city` | la recherche manuelle par ville/quartier (ILIKE préfixe, unaccent) |
| `p_service_query` | le filtre « type de service » ET le repli style→service (§3) |
| `p_latitude` / `p_longitude` | le point de recherche — SEULEMENT après le geste « autour de moi » ou depuis un lien partagé |
| `p_radius_km` | 10 par défaut dès qu'un point existe ; 5/10/25/50 au choix ; 25 puis 50 pour l'élargissement |
| `p_min_price_cents` / `p_max_price_cents` | bornes de prix (euros entiers dans l'URL → centimes) |
| `p_open_now_only` | le filtre « ouvert maintenant » |
| `p_sort` | `recommended` (défaut) / `nearest` / `price` |
| `p_limit` / `p_offset` | pagination « afficher plus », 20 par page, `total_count` fenêtré exact |

**`p_country` n'est pas câblé** (aucune surface de choix de pays n'existe
encore — le jeu réel est monopole FR ; à câbler quand le choix de pays
existera).

**Le paramètre qui exclut les salariés : `p_entity_type: 'shop'`.** Depuis
B1, le défaut en base (`NULL`, vide, valeur inconnue) signifie déjà `'shop'`
— mais une surface marketplace ne délègue pas une loi produit à un défaut
distant : la couche partagée `shared/data/discovery.ts` l'écrit dans CHAQUE
appel, au seul endroit qui parle à la RPC. L'e2e le prouve en interceptant la
requête réseau réelle (`p_entity_type === 'shop'` dans le corps POST) et en
vérifiant que chaque résultat d'une recherche « kais » (nom d'un salon ET
d'un barber salarié) est un lien `/shop/…`, jamais un profil autonome.

`search_public_organizations` n'est **pas consommée** : V2_DATA_CONTRACT §7
la déclare redondante avec `search_public_professionals(p_entity_type:
'shop')` (« à consommer ou déprécier ») — F3 tranche pour l'unique RPC
autoritative, la variante orgs reste à déprécier par un lot base.

## 2. Le classement

**Aujourd'hui** : tri par défaut `recommended` — la distance réelle calculée
serveur, croissante, inconnues en dernier ; sans point de recherche (pas de
distance à trier), l'ordre serveur est alphabétique et le client applique un
tri STABLE par disponibilité réelle (les rangées qui peuvent servir dans
l'heure remontent, l'ordre serveur survit au sein de chaque groupe). Deux
tris explicites : « le plus proche », « prix croissant » — jamais réordonnés
côté client. C'est le « tri honnête et explicable : distance, puis
disponibilité réelle » demandé.

**Où vivent les poids** : `shared/lib/searchRanking.ts` — LE module (déplacé
de features/discovery quand l'accueil s'est mis à classer aussi — frontière
`features/X` ↛ `features/Y`).
`SORT_OPTIONS`, la table `RANKING_WEIGHTS` (rangs de disponibilité) et
`rankResults()` y vivent ensemble ; aucun composant ne contient de constante
de classement (consommateurs : `SearchPage` et l'accueil, par appel de
fonction). Testé unitairement, y compris « un tri serveur n'est jamais
réordonné ». Le classement client s'applique UNE FOIS les états de service
résolus — l'ordre affiché est gelé entre-temps, jamais rebrassé sous le
doigt (correctif de revue M1).

**Comment la formule s'y branchera** : la formule du score FadeUp
(MASTER_SPEC §23, décision fondateur en attente) remplacera le corps de
`rankResults` — ou mieux, descendra en base comme la table de poids du feed
B4, et `p_sort: 'recommended'` la portera côté serveur pour que la
pagination reste cohérente. L'interface n'aura pas à changer : les options
de tri et le point d'appel sont déjà les bons. **Invariant écrit dans le
module** : payer ne donne pas un meilleur classement organique — la mise en
avant sponsorisée sera un emplacement séparé et marqué, jamais un poids
caché dans cette table.

## 3. La recherche par style — possible en partie, par les services réels

**La RPC n'a aucune notion de style.** Preuve : les 14 paramètres (§1) ne
comportent ni style ni tag ; `p_query` cherche dans nom d'organisation,
ville (et nom de barber sur les lignes barber, exclues) ; `p_service_query`
cherche dans **les noms des services ACTIFS** — c'est écrit dans le COMMENT
de la fonction et vérifié dans son corps SQL (db-audit/SCHEMA.sql). Aucune
table de taxonomie de styles n'existe en base.

**Ce que F3 fait, sans rien simuler** : le texte libre passe d'abord par
`p_query` ; si la recherche rend zéro résultat, le MÊME texte est retenté
comme nom de service (`p_service_query`) et les résultats apparaissent dans
une section DÉCLARÉE (« Professionnels proposant “fade” comme service »).
« fade », « taper », « dégradé » vivent réellement dans les noms de services
du jeu de données — le chemin fonctionne exactement dans la mesure où les
professionnels nomment ainsi leurs services, et pas au-delà.

**Ce qui manque pour une vraie recherche par style** (consigné, pas comblé) :
une taxonomie de styles en base (ou des tags sur services/posts B4) et son
paramètre RPC. `burst fade` ou `dégradé américain` ne matchent aujourd'hui
que si un service porte littéralement ce nom. Décision de contrat pour un
lot base ultérieur.

## 4. Zéro résultat — ce que voit l'utilisateur

1. **Le zéro se dit** : « Aucun résultat dans cette zone », avec la raison
   contextuelle (« à moins de 10 km », « à {ville} », « personne ne peut
   servir dans l'heure ») et des actions immédiates (effacer la recherche,
   retirer le filtre de disponibilité, chercher au-delà de la ville). Jamais
   une page vide, jamais un remplissage.
2. **Élargissement progressif autour d'un point** : 25 km, puis 50 km — la
   première couronne non vide s'affiche dans une section SÉPARÉE ET
   ÉTIQUETÉE (« À moins de 25/50 km »), chaque rangée portant sa distance
   réelle. Rien n'est glissé dans la liste principale. L'e2e le prouve
   depuis Melun : rayon de 10 km vide, Paris retrouvé à 50 km, section
   étiquetée, distance affichée.
3. **Recherche par ville vide** : action explicite « chercher au-delà de
   cette ville » (l'élargissement géométrique exige un point ; sans
   géocodage des villes, les « zones voisines » d'une ville ne sont pas
   calculables — dit au §12).
4. **Jusqu'où va l'élargissement** : 50 km, pas plus. Au-delà, un résultat
   n'est plus une alternative de quartier — l'utilisateur garde la main
   (rayon manuel, autre ville).

5. **Lignes sans coordonnées** (cas `side-agency`) : la RPC les conserve
   dans toute recherche par rayon (« distance inconnue est gardée, jamais
   inventée » — décision B1). La revue F3 a montré la conséquence : depuis
   Marseille, une telle ligne « remplissait » la page et empêchait à jamais
   l'état vide et l'élargissement. Corrigé côté surface : par rayon, une
   ligne sans distance NE compte PAS comme « dans la zone » — elle s'affiche
   à part, sous l'en-tête « À distance inconnue » avec sa note ; le zéro se
   déclenche, l'élargissement aussi (e2e depuis Marseille).

## 5. Géolocalisation

- **Demandée uniquement au geste « Autour de moi »** — l'e2e instrumente
  `navigator.geolocation.getCurrentPosition` : **0 appel au chargement**,
  1 appel après le tap, puis l'URL porte le point (4 décimales ≈ 11 m — pas
  de position au mètre dans un lien partagé) et les distances réelles
  apparaissent.
- **Refus** : une note calme (« la recherche par ville fonctionne
  entièrement »), aucun blocage, aucun état d'erreur — et le chemin manuel
  est le MÊME écran avec les mêmes capacités : ville → résultats réels,
  filtres, tri, partage d'URL. E2e : refus simulé, puis ville saisie,
  résultats affichés.
- L'accueil ne déclenche rien non plus : sa recherche route vers `/search`.

## 6. L'accueil — les trois cas

- **Visiteur sans historique** : la recherche (grand champ, Entrée →
  `/search?q=…`) et « À découvrir » — six établissements RÉELS de la
  recherche publique, mêmes rangées que /search (prix réels, disponibilité
  réelle, badges de revendication), classés par le même module de poids une
  fois les états résolus (celui qui peut servir dans l'heure remonte).
  AUCUNE section vide : les sections authentifiées ne se rendent pas (e2e :
  `home-next-appointment`, `home-rebook`, `home-followed` absents du DOM).
- **File active — le cas le plus important** : la carte de file est LE
  premier élément du document, au-dessus même de la recherche. Position en
  chiffre mono (le fait), nom du salon, CTA « Suivre ma place » →
  `/q/:slug?l=…` — **l'écran de suivi F1b réel (`QueueTracking`) est
  réutilisé par la route**, pas recopié (décision §11.3). Deux branches :
  client connecté (`get_my_queue_status`, poll 10 s) et client ANONYME
  (l'entrée locale F1b + `get_queue_entry_tracking`, même clé de cache que
  `/q`). E2e : une VRAIE entrée anonyme (jeton de check-in lu en base,
  position au salon), carte visible, ordre du document vérifié
  (file AVANT recherche), navigation vers le suivi, entrée quittée
  proprement en fin de test.
- **Client récurrent** : prochaine réservation réelle (confirmée ou en
  attente, la plus proche dans le futur — avec `StateBadge` « en attente de
  confirmation » le cas échéant, heure du LIEU) ; « Réserver à nouveau »
  ensemencé par le dernier rendez-vous HONORÉ (barber et service dans
  l'URL : `/book/:slug?service=…&barber=…`) — **destination : la convention
  `NotBuilt` du codebase** (l'écran nomme F4 et ramène), jamais un CTA
  menti ; profils suivis (`list_my_followed_professionals`, mêmes clés de
  cache que le bouton Suivre F2) en rangée d'avatars → `/pro/:handle`.
  Aucune donnée de démonstration de rendez-vous n'existant en base, ce cas
  est couvert par les tests unitaires des sélecteurs purs
  (`nextAppointment`, `lastCompletedAppointment`, `activeQueueEntry` —
  futur seulement, statuts corrects, null honnête) et non par e2e (§12).

## 7. Migration — la procédure suivie

**Deux migrations** (la seconde issue de la revue indépendante, §11) :

`20260907230000_f3_search_is_managed.sql` + down — **additive au contrat** :
une 31e colonne `is_managed boolean` sur `search_public_professionals`.
Aucune table, aucune policy, aucune autre fonction.
`search_public_organizations` non modifiée.

`20260907234500_f3_search_is_managed_claim.sql` + down — **v2 de la
sémantique**, même contrat (CREATE OR REPLACE, type de retour inchangé, ACL
préservée et revérifiée). La revue a mesuré que la v1 (memberships
seulement) faisait dire à la recherche « Pas encore géré sur FadeUp » sous
un établissement dont le barber REVENDIQUÉ affichait « Revendiqué » sur son
propre profil (`demo-maison-kais` / `demo.kais.bellamine`) — et que tout
chemin produit de création d'organisation pose une membership, rendant la
branche « non géré » atteignable seulement par les fixtures.

Sémantique v2, mesurée en production après application :
- **ligne shop** : membership réelle **OU identité professionnelle
  revendiquée rattachée** (la frontière B1 exacte — celle que `/pro`
  affiche). Résultat : `side-agency` (membre), `demo-maison-kais` et
  `demo-atelier-fadel` (identités revendiquées) gérés ; les six
  établissements purement scrapés/démo non gérés → badge neutre. Les trois
  surfaces (recherche, /pro, /shop) ne se contredisent plus.
- **ligne barber** (non affichée par F3, cohérence du contrat) :
  `coalesce(claim_state = 'claimed', false)` — la frontière B1 de
  `get_public_barber.professional_id` ; le `coalesce` est l'invariant X3
  (un barber sans identité liée est non-géré, jamais NULL — défaut attrapé
  au bac d'essai et corrigé AVANT production).

**Cette sémantique reste une décision de contrat à faire RATIFIER** (aucun
document ne définissait « géré » au niveau établissement) : la revue l'a
relevé, la définition retenue est la plus conservatrice qui satisfasse le
badge exigé par F3 §3 sans contredire une autre surface — et le down (retour
v1, puis retour B1 complet) est prouvé.

Procédure, appliquée AUX DEUX migrations (leçons F1b/F2/X3, DB_OWNERSHIP) :
1. propriétaire vérifié : `postgres` (règle 2) → migration appliquée en
   `postgres` ;
2. sauvegarde `/opt/fadeup/backups/pre-f3-20260907-170254.dump` (pg_dump
   -Fc, 2,7 Mo) ;
3. bac d'essai fidèle (`b3_restore_sandbox.sh`, restauration SANS
   `--no-owner`, 0 erreur, 97 objets postgres / 39 supabase_admin) ;
4. ligne de base fonctions+ACL (`x3_acl_snapshot.sql`) → up → exercice
   fonctionnel (shop 8×false + 1×true ; barbers revendiqués true, non
   revendiqués false, sans identité **false pas NULL** ; exécution en rôle
   `anon` dans une transaction lecture seule) → down → **diff ACL vide** →
   re-up (rejouabilité) ;
5. **grants EXPLICITES** (règle 4 X3 — un DROP+CREATE perd l'ACL de toute
   façon) : `revoke all from public` + `grant execute to anon,
   authenticated, service_role`, recalqués sur l'ACL B1 exacte, revérifiés
   en production après application ;
6. down = le corps B1 VERBATIM (pg_get_functiondef d'avant F3) + même ACL +
   même COMMENT ;
7. `database.types.ts` régénéré (postgres-meta — diff : **1 ligne**,
   `is_managed: boolean`) ; `db-audit/SCHEMA.sql` re-dumpé (mêmes options,
   diff purement additif) ; `probe_public_rpcs.sh --strict` et
   `x3_anon_surface.sh --strict` verts APRÈS application.

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (tsc -b + tsconfig.v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **0 erreur** (garde palette verte) |
| `npm run test` (Vitest) | **664/664, 75 fichiers** — dont sérialisation URL en aller-retour (défauts omis, point tronqué, valeurs hostiles), euros→centimes, `p_entity_type` jamais optionnel, classement (stable, jamais sur un tri serveur), disponibilité (fermé+file ≠ disponible — le B2 de la revue, verrouillé en unité), prix nul/« — »/zéro compté, sélecteurs de l'accueil (futur seulement, statuts stricts) |
| `npm run e2e` (Chromium 390 et 1440) | **156 passés, 0 échec, 1 flaky (retry vert), 1 sauté préexistant** (campagne complète 28,1 min : p1b + F1 + F1b + F2 + les 16 scénarios F3 × 2 largeurs). Le flaky : « Book ACTIF » de F2 (desktop), passé au retry lors des deux campagnes complètes — sensibilité à la charge du serveur dev, préexistant, consigné |
| axe-core | **aucune violation sérieuse ou critique** — /search et accueil, 390 et 1440 (dans la suite e2e) |
| Chunk d'entrée consumer | **≈ 87,3 Ko gzip** (index 30,97 + vendor-react 56,36) — budget 180 Ko tenu ; SearchPage 4,9 / HomePage 2,6 Ko gzip paresseux ; maplibre 246,3 Ko gzip dans SON chunk, chargé au seul onglet Carte (prouvé en e2e : `search-map` absent avant l'onglet) |
| `grep -rnE '\b(left\|right):' src/features/discovery src/features/home` | **vide** |
| `probe_public_rpcs.sh --strict` | **toutes les RPC publiques en 200**, revérifié après chacune des deux migrations |
| `x3_anon_surface.sh --strict` | **100 % vert après les migrations F3** (17 h 05) ; l'écart signalé en fin de journée est la RPC du lot F4 parallèle (§12) |
| Vérification navigateur réelle | **10 pages × 3 largeurs (390/430/1440)** : zéro erreur console, zéro requête en échec, zéro débordement horizontal — re-balayé APRÈS les correctifs de revue ; captures inspectées (rangées honnêtes, badges v2 cohérents, section « distance inconnue », carte propre) |
| WebKit | non exécutable sur cet hôte (BLOCKERS §2, inchangé) |

## 9. `/platform` intact — preuve

- `git diff --name-only $(git merge-base HEAD rebuild/social-first-v2)..HEAD`
  ne contient **aucun** fichier sous `src/pages/`, `src/routes/`,
  `src/components/`, `src/lib/` (surfaces legacy) — vérifié.
- Production : `GET http://127.0.0.1:15180/platform/login → 200` (vérifié
  après la migration).
- La migration ne modifie qu'une RPC de LECTURE publique que `/platform`
  n'appelle pas (V2_DATA_CONTRACT V6 : « /platform n'appelle ni cette RPC ni
  search_public_organizations ») ; la colonne est ajoutée en fin de ligne —
  aucun appelant positionnel n'existe.
- Le découpage de chunks (vite.config) change l'EMPAQUETAGE de maplibre pour
  la carte legacy (`platform` importera `maplibre-*.js` séparé au prochain
  déploiement) — **aucun code /platform modifié** ; la production actuelle
  sert sa build existante, intouchée.

## 10. Git — et le compte exact des données de test

- Branche `f3/search` depuis `rebuild/social-first-v2`, poussée. **Aucune
  fusion.** Aucun `git add .`/`-A`, aucun `reset --hard`, aucun `clean`,
  aucun `docker prune`.
- Commits : `db(f3)` migration v1 + down + types + dump ; `feat(f3)`
  /search + accueil + couche partagée + i18n + chunks ; `test(f3)` e2e +
  adaptation p1b ; `fix(f3)` corrections de revue + migration v2 ;
  `docs(f3)` ce rapport.
- **F3 ne crée AUCUNE organisation.** Ses e2e travaillent sur le jeu de
  démonstration existant ; la suite F1 HISTORIQUE, incluse dans la
  non-régression, crée ses 2 organisations `qa-f1-*` par campagne complète
  (motif connu, BLOCKERS §12.2) : 3 campagnes F3 → 6 organisations, toutes
  neutralisées par son afterAll — mesuré en fin de lot : **49 `qa-f1-*` au
  total (lots F3 et F4 de la journée confondus), 0 visible en marketplace,
  0 non préfixée « ZZ dead »**.
- **1 entrée de file réelle** créée par l'e2e de l'accueil (client anonyme,
  jeton de check-in réel, position au salon) puis **quittée dans le même
  test** (`leave_public_queue`) — 0 entrée active restante, vérifié en
  base. Règle « une seule campagne à la fois » tenue : `ps aux | grep
  playwright` avant chaque campagne, aucune campagne étrangère observée
  pendant les exécutions.
- **Aucun compte auth créé.**

## 11. Décisions prises seul — et la revue indépendante

### La revue, et ce qu'elle a changé

Conformément au CLAUDE.md, une revue `opus-reviewer` indépendante a relu le
lot complet (elle a relancé typecheck/lint/vitest/build, inspecté la base et
conduit les pages dans un vrai Chromium à 390/430/1440). Verdict initial :
**ne pas livrer en l'état** — deux bloquants produit et un bloquant de
process, tous corrigés avant ce rapport :

1. **B2 — une disponibilité fabriquée** : « Disponible maintenant »
   s'affichait sur `demo-maison-kais` alors que ses horaires disaient
   « fermé » — ma dérivation lisait « file accessible » comme preuve
   suffisante, la loi dit « être ouvert ne suffit pas » et j'avais lu la
   réciproque. Corrigé : l'affirmation exige lieu OUVERT **et** file
   accessible (`deriveRowAvailability`, unité + rendu revérifié).
2. **B1 — une sémantique `is_managed` qui contredisait /pro** : détail en
   §7 (migration v2). La revue a aussi établi qu'aucun chemin produit ne
   crée d'organisation sans membership — ma phrase « l'offre scrapée n'a
   pas de membres » était une projection, pas une mesure ; retenu tel quel
   ici pour l'exactitude.
3. **B3 — ce rapport n'était ni rempli ni commité** au moment de la revue ;
   corrigé (chiffres du §8 = exécutions finales, rapport poussé avant
   affichage).

Ses points majeurs, traités : classement appliqué seulement une fois les
états résolus, ordre gelé entre-temps (M1 — la liste se rebrassait sous le
doigt pendant ~1,2 s) ; filtre « disponible maintenant » borné honnêtement
aux pages chargées — compte, état vide contextualisé, « charger plus »
toujours accessible, plus jamais des squelettes par-dessus une liste
affichée (M2) ; lignes sans coordonnées sorties de « la zone » (M3, §4.5 —
l'élargissement était inatteignable sur le chemin « autour de moi ») ;
avatars à initiales déterministes au lieu de vingt cadres « pas de photo »
(M5, P1 §13) ; découverte de l'accueil classée par le même module (M6).
Mineurs traités : tri « le plus proche » retiré sans point de recherche,
« — » de prix audible au lecteur d'écran, notes de carte (état vide, lignes
sans position, marqueur du point de recherche), placeholder du rail
raccourci, test e2e du repli par style rendu inconditionnel (« taper »).

Non traités, à dessein, consignés au §12 : le N+1 d'états de service (M4 —
la vraie réponse est un contrat groupé, §13.2) ; l'empilement d'une entrée
d'historique par filtre (M7 — la spec F3 exige que le retour arrière
défasse l'état, je garde la lettre de la spec, arbitrage UX à prendre) ;
le poids de maplibre pour un onglet à faire ratifier (M8, décision §11.3) ;
la hiérarchie visuelle plate de la ligne d'état des rangées (design, à
passer en revue P1).

### Décisions

1. **LA décision lourde : la migration `is_managed`** (§7, v1 puis v2) —
   l'alternative (aucun badge sur les résultats, case F3 non cochée) aurait
   livré une marketplace où l'offre scrapée — le cas que F3 §3 annonce
   comme le plus fréquent — serait indistinguable de l'offre gérée. La
   sémantique est déclarée « à ratifier » ; le retour arrière complet est
   prouvé.
2. **Pas de bouton RÉSERVER sur les rangées de résultat** : toute la rangée
   mène au profil, où vit LE CTA dominant à l'état réel (F2). P1 §10 liste
   « carte de résultat » comme contexte de Book, mais P1 §9 impose UN CTA
   dominant par surface — vingt boutons verts dans une liste auraient dilué
   la loi, et leur destination réelle serait aujourd'hui l'écran NotBuilt de
   F4 : un « Réserver » qui mène à « pas encore construit » sur chaque
   rangée aurait été un mensonge de conversion à l'échelle. À réévaluer
   quand le tunnel F4 existera (dit au §13).
3. **La carte du /search** : construite MINIMALE sur la pile éprouvée du
   dépôt (maplibre-gl + tuiles raster OSM, comme la carte legacy
   /platform) — marqueurs uniformes à la couleur d'accent (jamais le bleu
   par défaut), AUCUN cluster, popup sobre vers le profil, zone de service
   marquée à son CENTRE (le popup dit la zone, aucune adresse). Le contrat
   P1 déclare lui-même que le langage visuel de carte n'est pas tranché :
   ce minimum est à faire RATIFIER, il ne prétend pas être le langage
   final. Chunk paresseux dédié (246 Ko gzip) chargé au premier affichage
   de l'onglet Carte seulement.
4. **« Disponible maintenant » = file accessible** (`get_public_service_state`
   par lieu affiché, cache partagé avec le profil salon). Une réservation
   ouverte ne prouve PAS un créneau dans l'heure (aucune lecture groupée de
   créneaux n'existe) : elle est dite « Réservable », jamais « Disponible
   maintenant ». Le filtre s'applique à l'état RÉEL résolu ; pendant la
   résolution, l'écran montre l'attente, pas une liste affirmée.
5. **Un résultat mène à `/shop/:slug` pour tous les types d'offre** — y
   compris les indépendants (le contrat de recherche ne porte pas de
   handle ; le profil d'établissement F2 rend le cas solo). Évolution de
   contrat possible consignée au §13.
6. **`search_public_organizations` non consommée** (§1).
7. **Déplacement de `localEntry` (file anonyme) vers `shared/lib/`** — même
   motif que les déplacements F1/F2 : l'accueil et la file ne peuvent pas
   s'importer l'une l'autre (frontière lint).
8. **Le repli style→service ne se déclenche qu'à zéro résultat** — les deux
   requêtes en parallèle sur chaque frappe auraient doublé la charge pour un
   gain marginal, et un mélange silencieux des deux natures de correspondance
   aurait été illisible. La section de repli est étiquetée.
9. **Chunking : maplibre isolé** — mesuré : il se fondait dans le chunk
   `platform` (466 Ko gzip) que l'onglet Carte aurait téléchargé en entier.
   Portage de la règle en nommant les deux modules `.mjs` (un filtre large
   attrape le CSS au chemin suffixé d'une requête et rolldown abandonne le
   groupe EN SILENCE — mesuré aussi, documenté dans vite.config).
10. **Découverte accueil sans point** : six résultats réels sans géo,
    classés par disponibilité réelle, plutôt qu'une demande de position à
    l'ouverture — la loi §8 prime sur la pertinence locale ; « Autour de
    moi » vit à un tap, sur /search.

### Erreurs commises, déclarées

0. **Les trois bloquants de la revue étaient MES erreurs** : une
   disponibilité fabriquée (B2 — la violation de loi la plus grave du lot,
   sur la surface qui porte la définition), une sémantique de gestion qui
   contredisait une autre surface (B1), un rapport à gabarits non commité
   (B3). Corrigées et re-testées, mais elles ont existé.
1. **Le motif NULL de la v1** : `p.claim_state = 'claimed'` sur un LEFT
   JOIN rendait `is_managed = NULL` pour un barber sans identité liée —
   l'invariant X3 exact. Attrapé par l'exercice fonctionnel du bac d'essai,
   corrigé (`coalesce`) AVANT toute application en production.
2. **Deux états vides mensongers** (M2/M3 de la revue) : le filtre de
   disponibilité affirmait un vide de zone en n'ayant examiné qu'une page,
   et une ligne sans coordonnées « remplissait » les recherches par rayon
   au point de rendre l'élargissement inatteignable. Les deux étaient des
   violations de la loi « zéro résultat se dit » que mes propres e2e
   n'attrapaient pas — leurs scénarios contournaient les cas (Melun AVEC
   filtre texte). Corrigés, et les e2e renforcés pour couvrir exactement
   ces chemins (Marseille sans texte, repli de style inconditionnel).
3. **Le premier découpage maplibre était un no-op silencieux** : la règle
   `manualChunks` large (paquet entier) était ignorée par rolldown sans un
   mot — j'ai « vérifié » une build qui n'avait pas changé avant de mesurer
   que le chunk n'existait pas. Diagnostiqué (le CSS au chemin suffixé
   casse le groupe), corrigé en nommant les deux modules JS, et la preuve
   du chargement paresseux est en e2e.

## 12. Cases non cochées / limites, avec la raison exacte

- **« Disponible maintenant » ne couvre que le chemin FILE.** Le chemin
  « par créneau dans les 60 min » est inprouvable en liste : aucune lecture
  groupée de créneaux n'existe (§13.2). Une réservation ouverte se dit
  « Réservable », jamais « Disponible maintenant ». Le filtre est un filtre
  CLIENT sur les pages chargées, et tout ce qu'il affirme le dit
  (« parmi les N premiers résultats »).
- **Le N+1 d'états de service demeure** (M4 de la revue) : un
  `get_public_service_state` par lieu affiché (20 par page pleine), en cache
  30 s partagé avec les profils, sans poll. La correction de fond est un
  contrat groupé — consignée §13.2, même famille que le N+1 d'équipe déjà
  consigné par F2.
- **La sémantique `is_managed` est à RATIFIER** (§7) : aucune définition
  produit de « géré » au niveau établissement n'existait ; v2 (membership OU
  identité revendiquée rattachée) est cohérente avec toutes les surfaces
  livrées mais reste une décision de contrat prise en aval. Le profil salon
  (F2) n'affiche, lui, AUCUN état de gestion — écart de cohérence
  inter-surfaces consigné, à arbitrer (badge sur /shop ou retrait partout).
- **Le langage visuel de la carte n'est pas ratifié** (P1 le déclare non
  tranché) : marqueurs uniformes accent, pas de cluster, popup minimal —
  et 246 Ko gzip de maplibre payés pour cet onglet (M8). À faire valider ou
  retirer par la revue produit ; le chunk est paresseux, l'entrée consumer
  n'en paie rien.
- **« Zones voisines » sur une recherche par VILLE vide** : non construit —
  il n'existe aucun géocodage des villes (§13.4). L'élargissement
  progressif n'existe que autour d'un point.
- **Le cas « client récurrent » de l'accueil n'est pas couvert en e2e** :
  aucune donnée de démonstration de rendez-vous n'existe (en créer aurait
  écrit des rendez-vous opérationnels en production). Couvert par les
  unités des sélecteurs purs (futur seulement, statuts stricts, null
  honnête) et la revue de code ; à exercer quand F4 livrera son jeu de
  démonstration de réservations.
- **Un filtre = une entrée d'historique** (M7) : voulu — la spec F3 exige
  que le retour arrière défasse l'état de recherche ; le coût (retours
  multiples pour quitter) est déclaré, arbitrage UX ouvert.
- **`p_country` non câblé** (§1) — aucune surface de choix de pays.
- **Playwright WebKit** — bibliothèques système absentes, root requis
  (BLOCKERS §2, inchangé).
- **La sonde `x3_anon_surface.sh --strict` était 100 % verte après MES
  migrations** (17 h 05) ; en fin de journée elle signale 1 écart de
  contrat : `get_public_booking_capability`, la RPC du lot F4 appliquée en
  parallèle sur la même base (migration `20260907221000_f4_…`) — son
  inscription à la ligne de base appartient à F4. Le dump `SCHEMA.sql` de
  cette branche exclut délibérément les objets F4 (ils appartiennent à ses
  commits).

## 13. Ce qui manque pour qu'un client trouve son barber en trois gestes

Le parcours F3 : ouvrir → chercher (ou « autour de moi ») → taper un
résultat. Trois gestes jusqu'au profil — mais pas jusqu'à la CHAISE :

1. **Le tunnel de réservation (F4)** — le quatrième geste est aujourd'hui
   « NotBuilt ». Quand il existera : réévaluer le Book direct sur la rangée
   de résultat (décision §11.2) pour que « trois gestes » devienne
   littéral : chercher → taper → réserver.
2. **Une lecture groupée de disponibilité** — « peut servir dans les 60
   minutes par CRÉNEAU » est inprouvable en liste (20 lieux = 20 appels
   d'état, et aucun contrat de créneaux groupé). Un
   `search_…(p_available_within_minutes)` ou une colonne d'état dans la
   recherche rendrait le filtre complet et supprimerait le N+1 d'états
   (même famille que le N+1 d'équipe consigné par F2 §11).
3. **La taxonomie de styles** (§3) — tant qu'elle n'existe pas, « burst
   fade » ne trouve que les services qui portent ce nom.
4. **Le géocodage des villes** — sans lui, pas de « zones voisines » pour
   une recherche par ville vide, et pas de centrage carte sur une ville
   tapée.
5. **La formule du score FadeUp** (décision fondateur, MASTER_SPEC §23) —
   le point de branchement l'attend (§2).
6. **L'imagerie des rangées** — le contrat de recherche ne porte aucune
   photo d'établissement ; chaque rangée montre le cadre « pas encore de
   photo ». Honnête, mais la découverte sociale-first vendra mieux avec de
   vraies images (même chantier que la couverture de profil, F2 §13.3).
7. **Le pays** : `p_country` attend une surface de choix de pays (§1).

---

**Aucune fusion n'a été effectuée. Fin du rapport.**
