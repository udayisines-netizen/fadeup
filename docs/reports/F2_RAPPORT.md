# FadeUp — Rapport final F2 : profils publics barber et salon

Branche `f2/public-profiles`, créée depuis `rebuild/social-first-v2`.

**DÉCLARATION EN TÊTE (exigée par F2 §1)** : le prompt annonçait « aucune
migration attendue » ; l'inspection du contrat a révélé qu'elle était
nécessaire. **Une migration additive** (trois RPC de lecture publiques) a été
appliquée en production, après sauvegarde et retour arrière testé sur
restauration fidèle — procédure complète au §6. **Aucune fusion. `/platform`
intact, preuve au §8.**

---

## 1. Les deux hiérarchies telles qu'implémentées

### `/pro/:handle` — profil barber

Ordre du MASTER_SPEC §9, tenu : **média et avatar** (MediaFrame paysage +
Avatar XL — un profil sans photo est la norme du scrapé, l'état « pas encore
de photo » est de première classe) → **identité** (h1) → **état revendiqué**
(ClaimBadge) → **handle et accroche** (mono + headline) → **« Travaille chez
[Salon] »** cliquable vers `/shop/:slug` → **localisation** (adresse, ou la
zone qui « se dit » — jamais un point) → **RÉSERVER** (vert plein, encre,
barre collante) → **Suivre** (secondaire, même barre) → **signaux
opérationnels réels** (StateBadge dérivé de `get_public_service_state` + « n
personnes en file » cliquable vers `/q/:slug` quand la file accepte) →
**portfolio** (grille B4, pagination par curseur, tranche de 30) →
**services** (rangées à filet fin, durée et prix en mono) → **preuve
sociale** (cinq métriques) → **avis**.

Écart de forme, pas d'ordre : RÉSERVER/Suivre vivent dans la
StickyActionBar — toujours visibles, donc toujours « avant le contenu » à
l'écran. C'est la lecture que P1c avait déjà retenue pour cette hiérarchie
(l'action prime sur la position DOM), et le seul moyen d'avoir le CTA
dominant présent pendant tout le défilement.

**Le cas indépendant est traité** : `marketplace_supply_type='independent'`
(mapping B1, jamais `business_type`) supprime la ligne « Travaille chez » —
sa page fusionne profil pro et profil public ; services, lieu et état
viennent de sa propre organisation solo. Vérifié sur `demo.fadel`.

### `/shop/:slug` — profil salon

**Imagerie du lieu** (cadre honnête — aucun contrat de photo de lieu
n'existe, voir §5) → **identité** → **note SEULEMENT si réelle** (aucun
rendu quand `rating_average` est null) → **adresse et état d'ouverture**
(ou la zone de service, sans adresse) → **RÉSERVER** → **Suivre** →
**Services** (groupés par catégorie réelle) → **Équipe** → **file en direct
F1b** (`QueueList` réutilisé + lien évident vers `/q/:slug`, seulement quand
la file accepte) → **Réalisations** (posts du lieu, B4) → **Avis** →
**Horaires** (semaine + ouvert/fermé maintenant, fuseau du lieu).

Écart déclaré : « à propos » (§4 « Horaires et à propos ») n'est **pas
rendu** — aucune colonne de description d'organisation n'existe en base.
Rien n'a été inventé pour le remplir ; manque consigné au §5.

## 2. Les cinq métriques

`SocialProof` (shared/ui) rend TOUJOURS les cinq `MetricValue` de P1b, dans
l'ordre Followers / Verified Clients / Rating / Reviews / Likes — cinq
icônes différentes (testé : les cinq SVG sont distincts), notation compacte
pour Followers, mono tabulaire pour Rating et Verified Clients, sans
agrégation possible par construction.

État par état, sur les deux profils :

| Métrique | Source | État vide |
|---|---|---|
| Followers | `follower_count` (by_handle, B1) / `get_public_organization_follower_count` (F2) | un compte réel — 0 est un FAIT du graphe, affiché 0 |
| Verified Clients | **aucun contrat public** | « — » |
| Rating | `get_public_reputation.rating_average` | null → « — » (et la section Avis dit « Pas encore d'avis ») |
| Reviews | `get_public_reputation.rating_count` | un compte réel — 0 affiché 0 |
| Likes | **aucun contrat public agrégé** (sommer les pages chargées serait un total partiel mensonger) | « — » |

La distinction tenue : un zéro COMPTÉ (followers, reviews — la base répond
« zéro ligne ») s'affiche ; une donnée SANS CONTRAT s'affiche « — ». Aucun
chiffre n'est fabriqué ; e2e le prouve sur le profil non revendiqué vide.

## 3. Non revendiqué

Le traitement : ClaimBadge neutre P1b (« Pas encore géré sur FadeUp » —
aucun rouge, aucune icône, testé jusqu'à la couleur calculée), une phrase
transparente (« Ce profil a été créé à partir de sources publiques.
{{name}} ne le gère pas encore sur FadeUp. »), et **rien de fabriqué** : pas
d'employeur affiché (le lien staff↔identité n'est public qu'après
revendication — décision B1, reprise par la RPC F2 qui rend zéro ligne),
pas de services, pas de réservation. Le CTA RÉSERVER reste présent
(hiérarchie) mais désactivé avec la note « La réservation ouvrira quand ce
professionnel aura rejoint FadeUp » — ni erreur, ni capacité inventée.
Suivre reste actif (moteur d'acquisition, MASTER_SPEC §5).

**Le chemin de revendication** : « Ce profil vous appartient ? C'est moi »
sous l'en-tête ouvre une feuille — sans session, elle mène à
`/auth/login?redirect=<profil>` et ramène ; avec session, un champ de
preuve libre et `submit_professional_claim` (B1). Succès et échec ont leurs
états ; la copie dit que la revendication est gratuite et vérifiée par
l'équipe.

## 4. États de service — le CTA dit la réalité

`deriveProfileCta` (shared/lib/serviceState, testé unitairement) étend le
mappage F1 aux profils — les deux features le partagent, comme `waitTime` :

| État `get_public_service_state` | CTA |
|---|---|
| `booking_accepting_new_entries` | **RÉSERVER actif** (vert plein, encre) → `/book/:slug?l&b` |
| file seule acceptante | le CTA devient **« Rejoindre la file »** → `/q/:slug?l=` — l'alternative réelle, le pont F1 |
| rien d'ouvert | RÉSERVER désactivé + « La réservation en ligne est fermée pour le moment » — le profil reste ENTIER (Suivre, portfolio, services, avis accessibles — e2e) |
| RPC en échec | désactivé + « L'état n'a pas pu être vérifié » — JAMAIS un état inventé (motif P1c `partial-data`) |
| chaîne de résolution EN COURS (handle → rattachement → lieu → état) | le CTA **charge** (Button `loading`, largeur et couleur conservées), aucune note, aucun badge — ni panne ni fermeture affirmée pendant un chargement. Ajouté après la revue indépendante (§11) qui a mesuré la fenêtre mensongère |
| rattachement résolu mais aucun lieu actif (`staff_profiles.location_id` nullable, org sans lieu) | repli sur le premier lieu actif de l'organisation ; s'il n'y en a AUCUN : « fermé » — un fait, plus jamais un « données partielles » à vie |
| mode temporaire (`mode_expires_at` futur) | la note ajoute « État temporaire, jusqu'à HH:MM » via `DateTime` — l'heure du LIEU ; une échéance déjà passée vue par le poll n'est pas affichée |

Poll à 30 s (décision F1 conservée : la bascule du pro doit se voir sans
rafraîchir). Par-barber : l'état est demandé avec `p_barber_id` sur le
profil barber, et PAR MEMBRE sur l'équipe du salon (sans poll — le bouton
« Réserver » d'un membre n'apparaît que si SON état accepte, overrides
individuels compris).

Destination du CTA : le tunnel de réservation est un lot ultérieur —
`/book/:slug` rend l'EmptyState « NotBuilt » du codebase qui nomme son lot
et ramène au profil. Décision au §11.

## 5. Ce qu'il a fallu trancher faute de réponse dans le contrat de handoff

1. **Résolution handle → lieu de travail : AUCUN contrat n'existait.**
   `get_public_professional_by_handle` rend l'identité portable seule ;
   `get_public_barber` exige (slug, barber_id) qu'un lien partagé ne porte
   pas. « Travaille chez », RÉSERVER et les services étaient
   inconstructibles depuis une URL partageable. Tranché : migration (§6),
   pas une supposition.
2. **Horaires publics : pas de contrat non plus** — `location_hours` est
   sous RLS membres, `anon` reçoit zéro ligne, et le §4 exige « semaine
   plus état ouvert ou fermé ». Même réponse (§6).
3. **Abonnés d'un salon : pas de contrat** — « Abonnés : public » (§9) et le
   côté professionnel l'a depuis B1. Même réponse (§6).
4. **Imagerie du lieu** : aucune source (ni photo d'organisation, ni photo
   de lieu en base). Le cadre reste honnêtement vide. Utiliser la première
   réalisation comme couverture aurait été une décision produit prise à la
   place du fondateur — non prise.
5. **« À propos » du salon** : aucune colonne de description. Section omise.
6. **Destination de RÉSERVER quand la réservation accepte** : le tunnel
   n'existe pas encore (P2/F-suivant). Retenu : la convention NotBuilt du
   codebase (écran qui nomme son lot, action de retour), plutôt qu'un CTA
   menti (désactivé alors que la capacité existe) ou une feuille inventée.
7. **Vignettes du portfolio non cliquables** : le viewer de post est P4 ;
   une vignette cliquable vers rien serait un cul-de-sac.
8. **Zéros comptés vs données absentes** dans les métriques (§2).
9. **Multi-lieux** : un sélecteur de lieu en rangées apparaît quand
   l'organisation a plusieurs lieux actifs (aucune en démo — non couvert
   par e2e, dit ici).
10. **Barre collante au-dessus de la nav basse** (`bottom-14` sous 768 px) —
    reprise telle quelle de la leçon F1 §10.2.

## 6. Migration — la procédure suivie

`db/migrations/20260907200000_f2_public_profile_contracts.sql` + down.
**Purement additive** : trois fonctions `SECURITY DEFINER STABLE` neuves,
aucune table, aucune colonne, aucune fonction existante modifiée.

1. `get_public_professional_workplace(p_professional_id)` — la résolution
   inverse. Miroir exact de la frontière B1 : prédicats de
   `get_public_barber` (`is_bookable`, `is_active`, `is_public` staff +
   `is_public` identité) ET `claim_state='claimed'` — un profil non
   revendiqué ne publie pas d'employeur. `marketplace_supply_type` copié
   du CASE authoritatif de la recherche (énuméré, inconnu → NULL).
2. `list_public_location_hours(slug, location_id)` — la semaine brute d'un
   lieu ACTIF (les deux intervalles) ; le front calcule « ouvert
   maintenant » dans `locations.timezone`. La recherche publiait déjà
   `is_open_now` dérivé de ces lignes.
3. `get_public_organization_follower_count(organization_id)` — jumelle
   plafonnée à 10 000 de `private.professional_follower_count` (B1), sur
   `is_following` (le booléen que porte `organization_follows`).

**Le seed de démonstration** (`db/seeds/f2_demo_profile_fixtures.sql`,
idempotent, données uniquement) fait quatre choses : il rattache 4 barbers
démo à leur identité `demo.*` ; il en revendique 2 (Kaïs, Fadel) — en posant
l'ÉTAT FINAL du cycle de claim via le GUC `fadeup.professional_claim_write`,
c'est-à-dire **en contournant le garde**, pas en passant par
`submit → review` (dit tel quel, corrigé après la revue qui a relevé ma
formulation trop flatteuse « vrai cycle de vie ») ; il publie 2 identités non
revendiquées (ancre = rattachement) ; et il donne au salon vitrine
`demo-maison-kais` un plan ACCORDÉ (`salon_essential`,
`entitlement_source='early_access'` — le mécanisme du seed B1, aucun objet
Stripe), tracé au journal append-only, avec sa file ouverte — sans quoi
aucune organisation de la base n'acceptait ni réservation ni file, et l'état
ACTIF du CTA n'aurait jamais existé sur données réelles.

Les 2 comptes auth porteurs des revendications (`qa-f2-kais@fadeup.test`,
`qa-f2-fadel@fadeup.test`) sont **verrouillés** : mot de passe aléatoire jeté
à la création. Ma première version portait un mot de passe EN CLAIR dans le
fichier — erreur relevée par la revue, corrigée : mots de passe tournés en
production, secret retiré du dépôt (§11).

Procédure (leçons F1/F1b appliquées) : sauvegarde
`/opt/fadeup/backups/pre-f2-20260907-141103.dump` (pg_dump -Fc, 2,7 Mo) →
bac d'essai fidèle (`b3_restore_sandbox.sh`, pg_restore SANS --no-owner,
0 erreur, 97 objets `postgres` / 39 `supabase_admin`) → ligne de base
fonctions+ACL → up → **exercice fonctionnel** (workplace revendiqué = 1
ligne, non revendiqué = 0 ; horaires = 7 lignes ; compteur ; et le test de
la classe d'erreur B1 : les trois RPC en rôle `anon` dans une transaction
LECTURE SEULE) → down → **diff fonctions+ACL vide** au retour exact à la
ligne de base → re-up (rejouabilité) → application en production en rôle
`postgres` (propriétaire des lectures publiques). ACL calquées sur
l'existant : `revoke all from public` + `grant execute to anon,
authenticated, service_role` — **explicites**, donc déjà conformes au
durcissement X3 appliqué le même jour (coordination directe avec la session
X3 ; sa sonde et la mienne sont repassées vertes après son application).

`database.types.ts` régénéré (postgres-meta, diff purement additif : 27
lignes) ; `db-audit/SCHEMA.sql` re-dumpé (mêmes options que le précédent —
`--schema-only --no-owner -n public` — diff additif : les 3 fonctions).

## 7. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (tsc -b + tsconfig.v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **0 erreur** |
| `npm run test` (Vitest) | **634/634, 71 fichiers** — dont le mappage des états (loading/unknown/bookable/queue-only/closed, échéance passée ignorée, isError prime sur isLoading), les horaires (fuseau du lieu, coupure du midi, null honnête, semaine TOUJOURS à 7 jours), ProfileCtaBar (neuf cas, chargement sans note compris), SocialProof (cinq distinctes, « — » sans zéro fabriqué) |
| `npm run e2e` (Chromium 390 et 1440) | **125 passés, 1 sauté préexistant, 0 échec, 0 flaky** (campagne ISOLÉE, 14,6 min) — F2 : 21 scénarios × 2 largeurs, dont le Book ACTIF cliqué jusqu'à sa destination, le bouton membre réservable, la section file + pont /q ; non-régression p1b + F1 (22/22) + F1b comprise. Une première campagne avait 2 échecs F1b : collision avec la campagne simultanée de la session X3 sur l'organisation partagée — cause prouvée des deux côtés (F1b isolée : 22/22), consignée au §11 |
| axe-core | **aucune violation sérieuse ou critique** — 4 profils (barber revendiqué, barber non revendiqué, salon, salon zone de service) × 2 largeurs |
| Chunk d'entrée consumer | **≈ 85,5 Ko gzip** (index 29,2 + vendor-react 56,4) — budget 180 Ko tenu ; pages profil en chunks paresseux (4,8 et 4,6 Ko gzip, jamais dans l'entrée) |
| `grep -rnE '\b(left\|right):' src/features/professional-profile src/features/organization-profile` | **vide** |
| `probe_public_rpcs.sh --strict` | **26 RPC publiques, toutes 200** (les 3 de F2 ajoutées à la sonde) — re-vérifié APRÈS le durcissement X3 |
| Métadonnées de partage | titre/description/og:title/og:description/og:url posés à l'exécution, vérifiés navigateur ; og:image seulement quand l'avatar existe. **Limite structurelle déclarée** : BLOCKERS §13 (SPA sans SSR — les dérouleurs sans JS ne voient que l'index statique) |
| Vérification navigateur réelle | **17 pages × 3 largeurs** (390/430/1440 — les 9 pages de profil + un échantillon des surfaces du rayon du correctif cn.ts : accueil, auth, /q ouvert et zone de service, /demo, /dev/ui) : **zéro erreur console, zéro requête en échec** sur toutes, sauf l'avertissement React préexistant de /dev/ui (§12) ; captures inspectées (hiérarchies, Book actif encre-sur-vert, pastille ouvert/fermé à côté de l'adresse, badge neutre, zone de service sans adresse, files réelles, portfolio avec média signé réel) |
| WebKit | non exécutable sur cet hôte (BLOCKERS §2, inchangé) — projets prêts derrière `P1B_WEBKIT=1` |

Le pipeline portfolio a été vérifié de bout en bout CONTRE LA VRAIE CHAÎNE
B4 : un post réel créé par le compte revendiqué de démonstration (2 médias
JPEG téléversés dans le bucket privé `post-media`), signé par l'ANONYME via
l'API Storage, rendu dans la grille (naturalWidth vérifié). Détail appris :
le bucket n'accepte que jpeg/webp/avif/mp4 — un PNG est refusé 415.

## 8. `/platform` intact — preuve

- `git diff --name-only $(git merge-base HEAD rebuild/social-first-v2)` :
  **zéro** fichier sous `src/pages/`, `src/routes/`, `src/components/`,
  `src/lib/` (surfaces legacy).
- Production : `GET http://127.0.0.1:15180/platform/login → 200`.
- La migration n'ajoute que des lectures ; aucun chemin `/platform` ne les
  appelle. Le seed ne touche que les identités/barbers du jeu `demo-*`.
- La recherche publique de production garde ses lignes légitimes (sonde §7 —
  le seed ne publie AUCUNE organisation nouvelle : `marketplace_visible`
  n'a pas été touché).

## 9. Organisations de test — le compte exact

- **F2 ne crée AUCUNE organisation.** Il enrichit le jeu de démonstration
  B1 existant (§6) : 4 rattachements, 2 revendications (garde levé par GUC,
  déclaré), 2 publications non revendiquées, 1 plan accordé au salon
  vitrine + file ouverte.
- **2 comptes auth créés puis VERROUILLÉS** : `qa-f2-kais@fadeup.test` et
  `qa-f2-fadel@fadeup.test` (la contrainte
  `professionals_claim_state_matches_user` exige un compte réel). Mot de
  passe aléatoire inconnu de tous ; réinitialisable par l'API admin GoTrue
  si un lot futur en a besoin. Aucune surface publique ne les expose.
- **1 post de démonstration** (2 médias JPEG dans le bucket privé
  `post-media`) publié par le compte Kaïs avant verrouillage — le portfolio
  de la fiche démo et la preuve de bout en bout du §7.
- Ces fixtures sont du CONTENU DÉMO durable (comme `marketplace_demo.sql`
  de B1), pas des résidus : elles ne sont pas neutralisées, elles SONT le
  jeu de démonstration des profils. La campagne e2e F1 historique ajoute
  ses organisations `qa-f1-*` neutralisées par son afterAll (comportement
  connu, BLOCKERS §12.2) : **39 organisations `qa-f1-*` au total après les
  campagnes de la journée (F2 et X3 confondues), 39/39 neutralisées « ZZ
  dead », zéro visible en marketplace** (vérifié).

## 10. Git

- Branche `f2/public-profiles`, créée depuis `rebuild/social-first-v2`,
  poussée. **Aucune fusion.** Aucun `git add .`/`-A`, aucun `reset --hard`,
  aucun `clean`, aucun `docker prune`.
- Commits : base de données (migration + seed + sonde + types + dump) ;
  socle partagé (mappage, horaires, CTA bar, preuve sociale, PostGrid,
  ReviewList, useDocumentMeta, déplacement QueueList, correctif
  tailwind-merge) ; les deux pages + routes ; e2e ; documentation + rapport.

## 11. Décisions prises seul — et toute erreur commise, déclarée

### La revue indépendante, et ce qu'elle a changé

Conformément au CLAUDE.md, une revue `opus-reviewer` indépendante a relu le
lot complet (elle a relancé typecheck/lint/tests/build, sondé les 26 RPC et
conduit les deux profils dans un vrai Chromium, réseau bridé). Son verdict
initial : **ne passe pas** — trois bloquants, tous corrigés avant ce rapport :

1. **Le CTA mentait pendant le chargement** : `deriveProfileCta` confondait
   « pas encore de réponse » et « échec », et la note « rejoindra FadeUp »
   s'affichait sur un profil REVENDIQUÉ tant que le rattachement n'était pas
   résolu — mesuré à plusieurs secondes sur réseau mobile bridé. Corrigé :
   état `loading` distinct (CTA qui charge, aucune affirmation), note non
   revendiqué conditionnée à la résolution TERMINÉE + `claim_state`, repli
   de lieu pour un `staff_profiles.location_id` NULL (sinon « données
   partielles » à vie). Testé unitairement et en e2e (« jamais la note
   “n'a pas pu être vérifié” sur un état connu »).
2. **Le mot de passe des comptes QA en clair au dépôt** : corrigé (rotation
   en production vers un aléa jeté, secret retiré du fichier, en-tête du
   seed réécrit — y compris la formulation malhonnête « vrai cycle de
   vie » au sujet du garde de claim, remplacée par la vérité : GUC levé).
3. **Ce rapport n'était pas commité et portait des gabarits** : corrigé —
   les chiffres du §7 sont ceux des exécutions finales, et le rapport est
   poussé avant affichage.

Ses points majeurs, traités : l'état ouvert/fermé est remonté À CÔTÉ de
l'adresse (position 4 du §9 — il vivait 1 100 px plus bas) ; le chemin de
conversion est désormais EXERCÉ en e2e contre la base réelle (plan accordé
au salon vitrine : Book actif cliqué jusqu'à sa destination, bouton membre
réservable cliqué, section file + `QueueList` + pont `/q` — voir §7) ; le
balayage visuel a été étendu à 17 pages × 3 largeurs pour couvrir le rayon
du correctif `cn.ts`. Traités aussi : semaine d'horaires TOUJOURS à 7 jours
(« non renseigné » ≠ « fermé »), fuseau de repli = appareil (plus de
`Europe/Paris` codé en dur), invalidation de follow ciblée, feuille de
revendication remise à neuf à la réouverture, fabrique de clé manquante,
clés i18n mortes retirées. Non traités, à dessein : le N+1 de l'équipe
(2 RPC/membre — la vraie réponse est une colonne `handle` dans
`list_public_organization_barbers` et une lecture groupée d'admission,
c'est-à-dire une évolution de contrat consignée pour un lot base) ; le
salon ne peut pas lier la page publique de son propre barber NON revendiqué
(conséquence directe de la frontière B1, arbitrage produit à prendre) ; le
cadre de couverture vide en tête de chaque profil (décision assumée §5.4,
à faire arbitrer).

### Décisions

1. **LA décision lourde : la migration** (§6) — le prompt disait « aucune
   attendue », l'inspection a prouvé le contraire pour trois contrats. J'ai
   suivi la lettre du §1 (sauvegarde, retour arrière prouvé, déclaration en
   tête) plutôt que de livrer un profil sans employeur, sans horaires et
   sans abonnés côté salon.
2. **Le seed de démonstration** : publier 4 identités du jeu démo B1 (et
   créer 2 comptes auth) SANS quoi aucun `/pro/:handle` de la base entière
   n'était résoluble — mesuré : 59 identités, zéro publique. C'est une
   écriture de données de démonstration en production, assumée et
   documentée (§9), dans l'esprit « travaille sur les organisations de
   démonstration existantes ».
3. **Frontière du non revendiqué** : la RPC workplace ne rend RIEN pour un
   non revendiqué (miroir B1). Conséquence : sa page n'affiche ni salon ni
   services — préférée à l'alternative (publier le rattachement scrapé)
   qui aurait fait dire au profil une affiliation jamais confirmée.
4. **« Réserver » par membre d'équipe en registre SECONDAIRE** : le vert
   plein est réservé AU CTA dominant, un par surface (P1 §9) — huit boutons
   verts dans une liste d'équipe auraient dilué la loi.
5. **`/book/:slug` NotBuilt** (§5.6) et **vignettes non cliquables** (§5.7).
6. **Correctif transverse tailwind-merge/Button** (voir erreurs — c'est un
   correctif de primitive partagée, hors périmètre strict, mais la loi
   « encre sur vert » de MON écran en dépendait ; blast radius minimal :
   l'échelle `text-fu-*` enseignée à twMerge + indice `color:`).
7. **Poll de l'état à 30 s, états membres sans poll** (§4).

### Erreurs commises, déclarées

0. **Les deux bloquants de la revue étaient MES erreurs** : la fenêtre de
   chargement mensongère du CTA (une violation de la loi §2, sur la surface
   qui la porte le plus) et le mot de passe en clair au dépôt. Corrigées et
   re-testées, mais elles ont existé — détail ci-dessus.
1. **Une campagne e2e en collision avec celle de la session X3** : nos deux
   campagnes complètes ont tourné SIMULTANÉMENT (14:55–15:26) sur le même
   serveur dev et la même organisation partagée `qa-f1b-shared` — 2 échecs
   F1b de chaque côté, tous expliqués par la contention (X3 a rejoué F1b
   isolément : 22/22 ; ma campagne finale isolée fait foi au §7). Règle
   consignée des deux côtés : une seule campagne e2e à la fois sur
   l'organisation partagée.
3. **Un post créé pointant vers des médias inexistants** : mon premier
   upload de médias de démonstration était en PNG — refusé 415 par le
   bucket (allowlist jpeg/webp/avif/mp4) — mais j'ai lancé `create_post`
   sans vérifier les uploads : un post public a existé quelques minutes
   avec deux chemins morts (rendu : cadres « média manquant », honnêtes par
   construction). Corrigé en re-téléversant en JPEG et en repointant les
   deux lignes `post_media`. Leçon : vérifier chaque étape d'une chaîne
   avant de déclencher la suivante.
4. **Balayage QA initial défectueux** : mes premières captures étaient
   BLANCHES (le serveur dev exécute encore son graphe de modules après
   `networkidle`) et mon premier script épuisait le renderer Chromium
   (contexte unique + captures pleine page en série sur 2 cœurs —
   `ERR_INSUFFICIENT_RESOURCES`). Si j'avais « validé » sur ces captures,
   la vérification navigateur aurait été du théâtre. Corrigé (attente du
   CONTENU, un contexte par page) et re-passé : 27 combinaisons propres.
5. **Clé de test `.env.local` absente du worktree neuf** — recréée depuis
   l'environnement de production (leçon F1 §10.4.6 toujours valable : celle
   de `/opt/fadeup` reste périmée, hors de mon périmètre d'écriture).

### Découverte transverse, corrigée : le CTA primaire perdait son encre

Le test ProfileCtaBar a attrapé un défaut LATENT de P1b : `tailwind-merge`
ne connaît pas l'échelle `text-fu-*`, la classe comme une COULEUR, et
laissait `text-fu-base` (taille, posée après) écraser
`text-[var(--fu-accent-fg)]` — tout Button `primary`/`destructive` perdait
sa couleur d'encre et héritait de l'ambiante. Correct par accident en thème
clair (l'ambiante EST l'encre) ; **blanc sur vert en thème sombre** —
l'interdit exact du §17. Corrigé à la racine (échelle enseignée à twMerge
dans `cn.ts` + indice `color:` dans Button), testé, et vérifié sans
régression sur toute la suite.

## 12. Cases non cochées, avec la raison exacte

- **« Métadonnées Open Graph correctes » — cochée pour le navigateur et les
  robots exécutant JS, PAS pour les dérouleurs sans JS** (WhatsApp,
  iMessage, Slack) : structurellement hors de portée d'une SPA sans SSR
  (non-goal MASTER_SPEC §22). BLOCKERS §13 — pré-rendu au bord à décider
  avec le fondateur. « Un lien collé dans WhatsApp » n'aura pas son aperçu
  riche tant que ce n'est pas tranché.
- **Le cas /pro d'un professionnel REVENDIQUÉ en zone de service** n'est pas
  exercé en e2e : le seul mobile du jeu démo (`demo.sofian.cuts`) est non
  revendiqué — son test d'absence d'adresse prouve la frontière B1 (aucun
  lieu public), pas la branche zone-de-service du composant, et le test le
  dit en commentaire. La branche est couverte côté salon
  (`/shop/demo-sofian-cuts`) et en revue de code.
- **Playwright WebKit** — bibliothèques système absentes, root requis
  (BLOCKERS §2, inchangé).
- **Multi-lieux** : sélecteur construit, aucune organisation publique
  multi-lieux pour l'exercer (dit au §5.9).
- Cochées TARDIVEMENT, après la revue (dites pour l'exactitude) : « Book en
  vert plein, état réel » à l'état ACTIF et « Files affichées via QueueList »
  n'étaient couvertes que par les unitaires — le plan accordé au salon
  vitrine (§6) les a rendues réelles et exercées en e2e.
- **Défaut préexistant constaté, hors périmètre, non corrigé** : `/dev/ui`
  (galerie DEV, absente du build de production) émet un avertissement React
  de clés dupliquées — antérieur à F2 (aucun composant F2 n'y est rendu),
  consigné ici plutôt que corrigé en contrebande.

## 13. Ce qui manque pour qu'un professionnel découvrant sa page ait envie de la revendiquer

1. **Ses vrais chiffres, visibles** : « 47 personnes ont vu votre profil ce
   mois-ci, 3 ont tenté de réserver » — les RPC d'analytics existent
   (`get_professional_analytics_summary`) mais rien ne montre au visiteur
   non revendiqué CE QU'IL PERD. C'est « le levier commercial de premier
   plan » du MASTER_SPEC §5, et il n'a pas d'écran.
2. **La demande en attente comme argument** : le tunnel
   `create_professional_interest_request` (B2) n'a pas encore son écran
   côté client — quand il l'aura, « un client veut réserver chez vous »
   sera la première chose que le professionnel verra après revendication.
3. **Un profil qui donne déjà envie** : photo de couverture (aucun contrat
   d'imagerie de lieu/profil scrapé — le Worker collecte-t-il des photos
   avec droits ? décision fondateur), et quelques réalisations pré-remplies
   quand la provenance le permet.
4. **L'aperçu riche dans WhatsApp** (BLOCKERS §13) : c'est précisément par
   des liens partagés que les professionnels découvriront leur page.
5. **Après le « C'est moi »** : la suite du parcours (suivi de la demande,
   e-mail, onboarding immédiat post-approbation) vit dans P3/P5 — le
   visiteur qui revendique aujourd'hui reçoit « notre équipe vous répond
   par e-mail », ce qui est honnête mais froid.

---

**Aucune fusion n'a été effectuée. Fin du rapport.**
