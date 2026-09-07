# FadeUp — Rapport final F4 : réservation et « demande envoyée »

Branche `f4/booking`, créée depuis `rebuild/social-first-v2`.

**DÉCLARATION EN TÊTE** : le prompt annonçait « une migration possible mais
pas attendue » ; il en a fallu **deux**, appliquées en production après
sauvegarde et retour arrière prouvé sur restauration fidèle (§7) — l'une
parce que F4 exige des refus lus sur un CODE que la base n'émettait pas,
l'autre parce que le récapitulatif doit annoncer AVANT le geste si le client
confirme ou envoie une demande. **Aucune fusion. `/platform` intact, preuve
au §9.** La campagne e2e complète a tourné sur un serveur dédié (port 4620)
parce que le port 4610 était occupé par le serveur du lot F3, actif en
parallèle — détail au §8.

---

## 1. Les trois chemins, tels que l'interface les distingue

### Chemin nominal — l'organisation a la capacité `booking`

`/book/:slug` : Service → Barber (sauté s'il arrive prérempli d'un profil
barber) → Date et heure → Récapitulatif. Le récapitulatif lit
`get_public_booking_capability` (RPC F4, §7) et le CTA dit **« Confirmer la
réservation »**. La réponse de `book_public_appointment` porte
`is_request=false` → l'écran **Confirmé** : coche `celebrateSuccess` (LE
moment orchestré du produit, P1c), récapitulatif, « Voir mes réservations ».
Brièvement, sans confettis.

### Chemin d'acquisition — l'organisation n'a pas la capacité

MÊME tunnel, mêmes créneaux réels (une demande retient son créneau —
contrainte d'exclusion, B2). Deux différences, toutes deux annoncées :

- le CTA du récapitulatif dit **« Envoyer la demande »**, avec la note « Ce
  salon confirme chaque demande lui-même » — le client sait qu'il envoie une
  demande AVANT le geste (F4 §3), pas seulement après ;
- la réponse porte `is_request=true` + `expires_at` → l'écran **« Demande
  envoyée »** : badge « En attente de confirmation », « le professionnel est
  prévenu, vous serez averti dès qu'il répond », échéance réelle et compte à
  rebours, récapitulatif, « Chercher une alternative » en registre
  secondaire. Aucune célébration, ton ni triomphal ni inquiétant.

**`is_request` et `expires_at` sont LUS de la RPC, jamais déduits d'un
enum** — le composant `BookingOutcome` ne connaît que ces deux champs, et le
commentaire du fichier cite la loi.

**La porte du tunnel a dû changer pour que ce chemin existe.** Constat en
cours de lot : `get_public_service_state.booking_accepting_new_entries`
(B1) exige la capacité commerciale via `private.booking_admission_allowed` —
donc TOUTE organisation gratuite était annoncée « réservation fermée », le
CTA des profils F2 restait désactivé, et la boucle d'acquisition que B2 a
construite était **inatteignable depuis toutes les surfaces**. Décision
(frontend seul, aucune RPC modifiée) : la porte du CTA et du tunnel est
`mode_allows_booking` — le MODE reste seul opposable aux demandes, exactement
la sémantique que B2 a donnée à `enforce_booking_service_mode` ; la capacité
ne décide que confirmed vs pending. `search_public_professionals` et son
« disponible maintenant » (surface F3) ne sont pas touchés. Deux assertions
e2e F2 mises à jour en conséquence (§11.1).

### Le troisième cas — le profil non revendiqué

Le CTA dominant d'un profil non revendiqué (une fois la résolution de
rattachement TERMINÉE — la leçon F2 du CTA qui ment pendant le chargement
est conservée) devient **« Demander un créneau »** → `/request/:handle`,
l'écran que B2 réclamait en conclusion. Il dit ce qu'il est : « {{nom}}
n'est pas encore sur FadeUp. Vous manifestez votre intérêt : il sera
prévenu, et libre de répondre. » Le champ horaire est étiqueté « Votre
préférence — pas un créneau garanti », borné à +90 jours (la garde B2), et
l'écran de confirmation répète : « aucun créneau n'est retenu », avec
l'échéance d'expiration. `create_professional_interest_request` est appelée —
**c'était la RPC B2 sans aucun appelant frontend**. Le refus `do_not_contact`
(`profile_withdrawn`) a son message honnête : « Ce professionnel a demandé à
ne pas être contacté via FadeUp. »

## 2. La preuve qu'aucun écran ne dit « Réservé » sur une demande

Trois verrous, du plus profond au plus extérieur :

1. **Vitest, garde de langue** (`noBookedWording.test.tsx`) — le MÊME motif
   que `verify_b2.sql` §4 (`\m(réservé|reserve|booked|confirmé|confirmed)\M`,
   porté en JS avec bornes Unicode) appliqué à : (a) le **texte RENDU** de
   l'écran « Demande envoyée » monté en fr ET en en ; (b) toutes les sections
   de copie des surfaces de demande (`booking.request`, `booking.interest`,
   `booking.interestRefusal`, libellés « demande » de /bookings, badge
   `states.booking.pendingRequest`). Le motif laisse passer « Réserver »
   (l'infinitif du geste) et « la demande n'a pas été confirmée à temps »
   (la phrase EXIGÉE par la spec) — il échoue sur « Réservé », « Booked »,
   « Confirmed », testé dans les deux sens.
2. **e2e** — après une vraie demande sur une organisation gratuite, le texte
   rendu de l'écran « demande envoyée » ET de la section « Demandes en
   attente » de /bookings passent le même motif, dans un vrai Chromium.
3. **Construction** — `StateBadge pending-request` (P1b) dit « En attente de
   confirmation » ; aucun composant de demande n'importe la copie du chemin
   confirmé.

## 3. L'échéance

- **Calculée en base, jamais côté client** : `set_appointment_request_expiry`
  = `least(now() + TTL organisation [24 h par défaut], starts_at)`. Le front
  lit `expires_at`, point. Preuve vivante pendant la QA : une demande pour
  demain 9 h 45 affichait « Réponse attendue avant le 8 sept, 9 h 45 » —
  plafonnée à l'heure demandée, pas +24 h.
- **Affichée deux fois** : la date-heure absolue (`DateTime`, fuseau du
  lieu) et le temps restant (« Expire dans 13 h 45 min », mono tabulaire,
  tick `useNow` 30 s). La garde anti-négatif est testée : une échéance passée
  rend `null`, jamais « -3 min ».
- **Quand elle passe** : l'écran bascule sur « La demande n'a pas été
  confirmée à temps » + « Personne n'a répondu avant l'échéance. Vous n'avez
  rien à vous reprocher — et le salon non plus » (ni no-show ni refus, F4
  §3), et « Chercher une alternative » passe en CTA primaire. Côté base, le
  balayage `expire_pending_appointments` (scheduler B2) pose
  `resolution='expired'` ; /bookings affiche alors la ligne en historique
  avec la même phrase.

## 4. Les alternatives

`get_public_booking_alternatives` (B2), appelée depuis l'écran expiré et
depuis une demande expirée de /bookings : exclusion de l'organisation
d'origine, `p_service_query` = nom du service demandé. La géolocalisation
n'est demandée **qu'au geste** « Trier par distance autour de moi »
(MASTER_SPEC §8), jamais à l'ouverture ; refus → « les résultats ne sont pas
triés par distance », sans blocage.

**`accepts_immediate_booking` vaut `false` presque partout, et l'écran le
respecte** : le CTA d'une alternative dit « Réserver » SEULEMENT quand le
champ est vrai ; sinon il dit **« Envoyer une demande »** — les deux mènent
au même tunnel, qui produira l'issue réelle. Personne n'est envoyé vers une
seconde attente sous une promesse de réservation. Prix « à partir de » via
`get_public_currencies` (devise réelle de chaque organisation), état vide
honnête avec action (« Explorer la recherche »).

## 5. L'inscription légère, et le sort du `claim_token`

**Chemin retenu : le motif OTP de F1b, dans le récapitulatif, sans quitter
le tunnel.** Sans session : nom + e-mail → `signInWithOtp` (B2 a rendu
l'envoi réel) → six cases OTP sur le même écran → `verifyOtp` pose la
session dans le même onglet → la réservation part immédiatement. L'URL du
tunnel porte tout le contexte (`s`, `b`, `d`, `t`) : rien n'est perdu, rien
n'est redemandé. **Pas de réservation anonyme** : l'e-mail est requis, le
formulaire ne part jamais sans session.

Prouvé de bout en bout en e2e avec un VRAI code : l'OTP du dernier envoi
GoTrue est relu par l'API admin (`generate_link`), tapé dans l'interface, et
la demande créée appartient bien au compte né dans le flux
(`booked_by_user_id`).

**Le `claim_token` n'est plus nécessaire sur ce chemin** : l'authentification
précède toujours l'appel, la ligne naît possédée. Il reste émis par la RPC
pour un appelant anonyme (API directe, futurs kiosques) et
`redeem_appointment_claim` reste en base — rien n'est retiré, mais aucune
surface F4 ne l'appelle. À réévaluer si un chemin anonyme réapparaît.

## 6. Les motifs de refus et leurs messages

La base n'émettait pour la réservation que des exceptions à texte libre —
or F4 §4 exige le motif « lu sur le code, jamais sur le texte » (le motif
F1, que B2 avait déjà appliqué à la demande d'intérêt). Migration
`20260907220000` : `DETAIL fadeup_booking_refusal=<code>` sur chaque refus
des chemins client, sans changer un message ni un errcode.

**16 codes de réservation**, 16 messages fr/en distincts et actionnables
(unicité testée) : `missing_name`, `missing_contact`, `missing_time`,
`past_time`, `unknown_organization`, `location_unavailable`,
`service_unavailable`, `barber_unavailable`, `outside_hours`,
`too_many_future_bookings` (« Vous avez déjà 5 réservations à venir — c'est
le maximum. Annulez-en une pour libérer une place. »),
`service_mode_closed`, `appointment_not_found`, `no_longer_cancellable`,
`not_authorized`, `no_longer_reschedulable`, `slot_conflict`.

Deux refus n'ont pas de DETAIL, à dessein, et se lisent sur leur **SQLSTATE**
(un code aussi) : `23P01` (contrainte d'exclusion GiST — l'arbitre de course
serveur) et `22023` nu (`check_appointment_time_blocks`, possédée par
`supabase_admin` — y toucher aurait forcé toute la migration sous ce rôle
pour un seul detail). Les deux → `slot_conflict` : « Ce créneau vient d'être
pris. Choisissez-en un autre — rien n'a été envoyé. » Le tunnel revient alors
à l'étape créneau et re-lit la liste ; **aucun état optimiste** n'a existé
(prouvé en e2e par une vraie course : réservation API pendant que le client
relit son récapitulatif).

**7 codes d'intérêt** (B2, enfin branchés) : `no_contact_channel`,
`missing_time`, `past_time`, `too_far_ahead`, `profile_not_public`,
`professional_is_claimed` (« réservez un vrai créneau depuis son profil »),
`profile_withdrawn`.

## 7. Les migrations, avec la procédure et les grants explicites

Sauvegarde AVANT tout : `/opt/fadeup/backups/pre-f4-20260907-170123.dump`
(pg_dump -Fc, 2,7 Mo).

| Migration | Contenu | Rôle | Down testé |
|---|---|---|---|
| `20260907220000_f4_booking_refusal_codes` | DETAIL codés sur `book_public_appointment`, `cancel_my_appointment`, `reschedule_appointment`, `enforce_booking_service_mode` + **plafond de 5 réservations futures par compte** (MASTER_SPEC §6 ; la table de réglages plateforme n'existe pas — constante commentée dans la fonction, « réglable depuis /platform » reste à construire, §12). L'anonyme n'est pas comptable — et l'interface ne réserve plus en anonyme | `postgres` (les 4 `proowner` vérifiés — doctrine DB_OWNERSHIP §2) | ✓ retour aux définitions EXACTES capturées (diff vide), ACL identiques, re-up rejouable |
| `20260907221000_f4_public_booking_capability` | `get_public_booking_capability(slug)` — même sémantique et même nom de champ que `accepts_immediate_booking` des alternatives B2. `revoke all from public` + **`grant execute to anon, authenticated, service_role` EXPLICITES** (invariant X3 règle 4) | `postgres` | ✓ drop propre |

Procédure : bac d'essai fidèle (`b3_restore_sandbox.sh`, pg_restore SANS
`--no-owner`, 97 objets `postgres` / 39 `supabase_admin`, 0 erreur) → up →
`verify_f4.sql` (transaction + ROLLBACK, modèle verify_b1 : les 7 refus
directs codés en A1, pending/échéance plafonnée/jeton en A2, confirmed avec
capacité en A3, **6e réservation du compte refusée et anonyme non compté**
en A4, `service_mode_closed` en A5, codes cancel/reschedule en A6 — TOUT
PASSE) → down → diff des définitions ET des ACL **vides** → re-up →
verify re-PASSE → application en production. La RPC neuve est ajoutée à
l'allowlist de `x3_anon_surface.sh` et à `probe_public_rpcs.sh` **dans le
même commit** (le contrat de surface X3 échoue sinon).

`database.types.ts` et `db-audit/SCHEMA.sql` régénérés — instantanés de la
production, qui incluent au passage `is_managed` ajouté par le lot F3 en vol
(précédent F2/B3 : l'instantané dit la prod, pas la branche).

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (tsc -b + tsconfig.v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **0 erreur** |
| `npm run test` (Vitest) | **657/657, 75 fichiers** — dont les 23 tests F4 : 16+7 refus à messages fr/en distincts, garde anti-négatif et fenêtre de 12 h, fusion « premier disponible » (l'union réelle, l'horaire choisit le barber, rien fabriqué), moments de journée dans le fuseau du LIEU, et LA garde de langue (§2) |
| Campagne e2e (Chromium 390 et 1440) | Campagne complète (p1b + F1 + F1b + F2 + F4) : **148 scénarios — 142 passés, 1 sauté préexistant, 4 échecs F2 ATTENDUS** (les assertions décrivant l'ancienne porte capacité, mises à jour — §11.1.3) **et 1 flaky F4** dont la cause racine a été corrigée (le message de conflit vivait sur un écran démonté — il s'affiche désormais sur l'étape créneau) — 29,2 min. Puis re-passe INTÉGRALE des deux suites touchées par ces correctifs (F2 + F4, les deux largeurs) : **64/64, 0 flaky, 13,9 min**. F4 : 11 scénarios × 2 largeurs, dont l'OTP réel de bout en bout. p1b, F1 et F1b : verts dans la campagne, intouchés ensuite |
| axe-core | aucune violation sérieuse ou critique — étape service, créneaux, récapitulatif, /bookings, demande d'intérêt (×2 largeurs) |
| Chunk d'entrée consumer | **≈ 90,7 Ko gzip** (index 35,1 + vendor-react 55,6) — budget 180 Ko tenu ; tunnel, /bookings et demande d'intérêt en chunks paresseux |
| `grep -rnE '\b(left\|right):' src/features/booking` | **vide** (et aucun framer-motion) |
| `probe_public_rpcs.sh --strict` | **27 RPC publiques, toutes 200** (la 27ᵉ est `get_public_booking_capability`) |
| `x3_anon_surface.sh --strict` | **TOUT PASSE** (allowlist mise à jour avec la RPC F4) |
| Vérification navigateur réelle | Tunnel conduit en vrai Chromium à 390 et 1440 sur les DEUX chemins + demande d'intérêt + /bookings : zéro erreur console, zéro requête en échec ; captures inspectées (récapitulatif restructuré après une première passe qui tronquait les titres — §11.2 ; échéance plafonnée constatée à l'écran ; encre-sur-vert vérifié au style calculé) |
| WebKit | non exécutable sur cet hôte (BLOCKERS §2, inchangé) |

## 9. `/platform` intact — preuve

- `git diff --name-only $(git merge-base HEAD rebuild/social-first-v2)` :
  **zéro** fichier sous `src/pages/`, `src/routes/`, `src/components/`,
  `src/lib/` (surfaces legacy).
- Production : `GET http://127.0.0.1:15180/platform/login → 200` (avant et
  après les migrations et la campagne).
- Les migrations ne touchent que des chemins client (4 redéfinitions
  `postgres` + 1 lecture neuve) ; aucun chemin `/platform` ne les appelle.
- Aucune organisation créée (§10) ; la marketplace publique garde ses
  lignes légitimes.

## 10. Organisations et données de test — le compte exact

- **F4 ne crée AUCUNE organisation.** Les deux chemins du tunnel s'exercent
  sur le jeu de démonstration durable (demo-maison-kais : plan accordé,
  demo-atelier-fadel : Free) et la demande d'intérêt sur
  demo.moussa.diakite (sans prospect rattaché : aucune relance e-mail ne
  part).
- **1 compte client QA réutilisable** : `qa-f4-customer@fadeup.test` (aucune
  organisation — réutilisable sans neutralisation, QA_DATA règle 3). Les
  comptes OTP jetables (`qa-f4-otp-…@fadeup.test`) sont **supprimés** en fin
  de test (purs comptes d'authentification, convention QA_DATA règle 4).
- Les rendez-vous QA sont marqués AVANT création (e-mails
  `qa-f4-…@fadeup.test`) et **annulés en fin de campagne** (lignes
  `cancelled` historisées — l'append-only ne permet rien d'autre, et c'est
  très bien). Les demandes d'intérêt QA passent en `withdrawn`.
- La suite F1 historique, exécutée en non-régression, ajoute ses 2
  organisations `qa-f1-*` neutralisées par campagne complète — comportement
  connu et documenté (BLOCKERS §12.2), hors de mon pouvoir sans réécrire sa
  fixture.

## 11. Décisions prises seul — et toute erreur commise, déclarée

### 11.1 Décisions

1. **Les deux migrations** (§7) — la lettre du prompt (« le motif est lu sur
   le code ») était inapplicable sans la première ; la loi « le client doit
   savoir qu'il envoie une demande » l'était sans la seconde. Procédure
   complète suivie, déclaration en tête.
2. **Le plafond de 5 réservations futures vit dans la migration des codes**
   — la case d'acceptation « le refus pour trop de réservations est
   compréhensible » était infaisable sans la garde, qui n'existait nulle
   part. Compté par compte (`booked_by_user_id`), l'anonyme n'est pas
   comptable ; « réglable depuis /platform » attend la table de réglages
   plateforme (V2_DATA_CONTRACT : BLOQUÉ) et la constante est commentée en
   tête de fonction pour ce jour-là.
3. **LA décision lourde : la porte du tunnel est le MODE** (§1). Elle change
   le comportement de surfaces F2 (le CTA d'une organisation gratuite
   devient actif — c'est le but du lot) ; deux assertions e2e F2 mises à
   jour, dites ici : « Atelier Fadel Free → CTA désactivé » devient « CTA
   actif → tunnel » et « non revendiqué → Book désactivé » devient « CTA
   “Demander un créneau” actif ». Le badge opérationnel des profils dit
   « Réservable » sur une organisation gratuite — défendable (on peut y
   engager une réservation) mais dit ici : si le fondateur veut un badge
   distinct « reçoit les demandes », c'est un ajout de vocabulaire P1.
4. **La demande d'intérêt est une route** (`/request/:handle`) plutôt qu'une
   feuille dans le profil : une feature n'importe pas une autre feature
   (P1 §17), et B2 la décrivait comme UN écran. Le profil y mène par le CTA
   dominant.
5. **Auth d'abord, jamais de réservation anonyme** — donc `claim_token`
   inutilisé par l'interface (§5), conservé en base.
6. **Annulation tardive** : la base n'a aucune notion de « tardive » ; la
   fenêtre de 12 h vit côté client (`isLateCancellation`, testée) et
   l'avertissement est montré AVANT le geste. L'historisation est dérivable
   (`decided_at` vs `starts_at`) — aucune colonne inventée.
7. **« Premier professionnel disponible »** = union des créneaux réels de
   chaque barber apte (N lectures de la même RPC, fusion pure testée :
   l'horaire choisi désigne le barber qui l'offre réellement, le premier de
   la liste en cas d'égalité). Aucun modèle, aucune invention.
8. **e2e sur les organisations de démonstration** plutôt que
   `qa-f1b-shared` : zéro organisation nouvelle, et l'organisation partagée
   reste à sa seule campagne F1b (règle 2b).
9. **Campagne complète sur le port 4620** : le 4610 (baseURL du config) était
   occupé par le serveur du lot F3 en itération active. Config miroir
   (mêmes projets, mêmes timeouts), même base, serveurs séparés — plutôt que
   tuer le serveur d'une session vivante ou attendre indéfiniment. La
   collision F2×X3 documentée portait sur l'organisation partagée F1b, que
   F3 ne touche pas.
10. **Nettoyage des demandes d'intérêt en `withdrawn` par SQL** : aucune RPC
    client de retrait n'existe (manque consigné au §13).
11. **Le tunnel reste une colonne focalisée (`max-w-xl`) à 1440 px** — le
    motif « checkout » : une décision à la fois, zéro distraction (BOOKING_UX
    « Speed beats spectacle »). Le « desktop composé » de P1 §5 vise les
    surfaces de comparaison (recherche, profils) ; si la revue produit veut
    un récapitulatif en rail latéral, c'est une itération de composition,
    pas d'architecture.

### 11.2 Erreurs commises, déclarées

1. **Trois défauts visuels/UX attrapés par la vérification navigateur, pas
   par moi à l'écriture** : titres de rangées tronqués sur le récapitulatif
   390 px (« Ser… ») → rangées restructurées (valeur en titre, libellé en
   sous-titre) ; compte à rebours tronqué dans les rangées /bookings → ligne
   dédiée ; la validation NATIVE du navigateur court-circuitait mes messages
   d'erreur traduits → `noValidate`, validation custom seule. Si j'avais
   « validé » sur le code seul, les trois seraient en production.
2. **verify_f4 premier passage** : fixtures sans `organization_id` sur
   `service_locations`/`barber_services`/`location_hours` — attrapé par le
   bac d'essai fidèle (le trigger de cohérence a refusé), corrigé.
3. **Un test unitaire affirmait un faux** : j'attendais « soir » pour
   23 h UTC à Paris — c'est 1 h du matin (UTC+2). Le test a été corrigé, pas
   le code, et le cas Paris/Tokyo est maintenant explicite.
4. Deux assertions e2e mal écrites au premier passage (cast `boolean::text`
   = `true` pas `t` ; requête de report sans filtre d'organisation) —
   corrigées, campagne repassée.
5. **Le message de conflit de créneau était structurellement flaky** : posé
   sur le récapitulatif à l'instant où le retour à l'étape créneau le
   démontait — visible seulement par une course de rendu, et c'est la
   campagne qui l'a montré (1 flaky). Corrigé : le refus s'affiche là où le
   client atterrit, effacé au choix suivant ; re-passé 0 flaky.
6. La garde de langue importait l'instance i18n LEGACY depuis une feature —
   interdit par le lint de frontières, attrapé au dernier passage de lint
   (mes passes précédentes dataient d'avant le fichier). Corrigé
   (`getI18n()` de react-i18next).
7. **Ma première campagne complète a démarré pendant que la session F3
   lançait la sienne** — exactement la collision contre laquelle la consigne
   mettait en garde. À la détection (3 minutes), j'ai arrêté MA campagne,
   attendu la fin de la leur, balayé mes restes (aucun), et relancé isolé.
   La campagne qui fait foi est l'isolée.

## 12. Cases non cochées, avec la raison exacte

- **« Réglable depuis `/platform` » (plafond de réservations)** — la table
  de réglages plateforme n'existe pas (V2_DATA_CONTRACT §2 P5 : BLOQUÉ).
  Le défaut de 5 est appliqué et commenté ; le réglage attend ce chantier.
- **Le refus « trop de réservations » n'est pas exercé en e2e navigateur**
  — il faudrait 5 réservations réelles par campagne. Prouvé
  déterministiquement par `verify_f4.sql` A4 (6e refusée avec code, anonyme
  non compté) et le message est couvert par les tests de refus.
- **Non-régression F3** — les scénarios F3 n'existent pas dans ce worktree
  (lot parallèle non fusionné) ; sa seule trace en base (`is_managed`) est
  dans mes instantanés. F1, F1b, F2 (et p1b) sont dans ma campagne.
- **WebKit** — bibliothèques système absentes, root requis (BLOCKERS §2).
- **Rappels ~24 h / ~2 h avant rendez-vous** (MASTER_SPEC §6) — hors
  périmètre F4 (aucun écran) ; les gabarits B2 existent, le déclencheur
  scheduler reste à câbler. Dit ici pour éviter un faux « fait ».

## 13. Ce qui manque pour qu'un client réserve chez un vrai salon demain matin

1. **Fusionner et déployer** : la production sert le build F1 — tunnel,
   demande envoyée, /bookings et demande d'intérêt n'existent que sur cette
   branche (avec F2/F3 à fusionner aussi).
2. **L'écran pro des demandes** : `get_booking_requests` /
   `confirm_booking_request` n'ont AUCUNE surface V2 — un salon gratuit
   reçoit la demande par e-mail mais ne peut ni la voir ni l'accepter dans
   l'interface reconstruite. C'est le premier écran de P3 à faire, sinon la
   boucle s'arrête au moment exact où elle devient de l'argent.
3. **De la vraie offre** : neuf organisations de démonstration ne sont pas
   un marché. Le Worker peut publier des profils non revendiqués — la
   demande d'intérêt les attend désormais, et l'e-mail « un client souhaite
   réserver chez vous » part (B2). Il manque la décision fondateur de
   publier.
4. **La délivrabilité observée** (BLOCKERS §6/§7) : second domaine d'envoi
   et sonde de rebond — un client qui ne reçoit pas son code OTP est un
   client perdu au milieu du tunnel.
5. **Un retrait de demande d'intérêt côté client** (RPC manquante — le
   client ne peut pas retirer sa demande d'intérêt depuis /bookings, elle
   expire seule).
6. **Les rappels avant rendez-vous** (§12) et l'aperçu riche des liens
   partagés (BLOCKERS §13) — les deux nourrissent le retour et l'arrivée.

---

## Git

Branche `f4/booking`, créée depuis `rebuild/social-first-v2`, **poussée**.
**Aucune fusion n'a été effectuée.** Aucun `git add .`/`-A`, aucun
`reset --hard`, aucun `clean`, aucun `docker prune`. Commits :

| Commit | Contenu |
|---|---|
| `e5910b2` | base — 2 migrations + downs + verify_f4 + sondes + instantanés |
| `bc00554` | socle — porte MODE, interestTo, clés Query, i18n booking, routes |
| `9ef555f` | feature — tunnel, outcome, intérêt, /bookings, unitaires |
| `f7c699e` | e2e F4 + mises à jour F2 + rapport |

**Fin du rapport.**
