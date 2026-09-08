# FadeUp — Données de test : convention

Écrit par X3 (2026-09-07). B1 a laissé 31 organisations de test, F1 en a
laissé 33, F1b 1, R5R-1a 7 — toutes indélébiles. Ce document dit comment un
lot crée des données de test, comment il les marque, pourquoi la suppression
est impossible, et comment ne plus grossir le tas.

## 1. L'état exact (production, 2026-09-07)

Au début de X3 : 81 organisations en base, dont **72 mortes de test** et
9 légitimes. Après les campagnes e2e de fin de lot (X3 et F2) : **85 dont
76 mortes** — +2 `qa-f1-*` par campagne complète, le motif connu §12.2 de
BLOCKERS. Détail au début du lot :

| Origine | Compte | Marquage |
|---|---|---|
| B1 (verify_* hérités lancés en prod) | 31 | `name` = « ZZ dead B1 verify fixture (undeletable…) », slugs variés (`wave1-*`, `jacks-barbers-*`, …) |
| R5R-1a (fixtures marketplace) | 7 | slug `zz-dead-r5r1a-fixture-*` |
| F1 (e2e installation, 2/campagne) | 33 | slug `qa-f1-*`, `name` = « ZZ dead QA F1 … » |
| F1b (org partagée réutilisable) | 1 | slug `qa-f1b-shared`, « ZZ dead QA F1b Shared » |

Plus **84 comptes** `auth.users` en `*@fadeup.test`. Toutes les organisations
mortes sont `marketplace_visible = false` et n'atteignent aucune surface
publique (revérifié par la suite `x3_anon_surface.sh` : la recherche publique
rend exactement ses 9 organisations légitimes).

## 2. Pourquoi la suppression est impossible — et doit le rester

`DELETE FROM organizations` cascade vers des tables d'HISTORIQUE APPEND-ONLY
(`commercial_plan_changes`, `service_mode_changes`, journaux analytics…)
protégées par des triggers `reject_*_mutation`. Ces triggers sont la garantie
d'intégrité du produit — un historique commercial qui peut s'effacer n'est
pas un historique. On ne les contourne pas pour du confort de QA ; on
neutralise (renommage « ZZ dead … », `marketplace_visible = false`,
membres retirés) et on ne touche plus.

## 3. La convention, désormais

**Règle 1 — d'abord, ne rien écrire du tout.** Le mode d'or est la
transaction annulée : `verify_x3.sql` et `verify_f1b.sql` créent orgs,
comptes, rendez-vous, files… en UNE transaction terminée par `ROLLBACK`.
Rien n'entre dans les journaux append-only (annulés avec le reste). Tout
test SQL déterministe DOIT suivre ce modèle, et tourner de préférence sur le
bac d'essai fidèle (`b3_restore_sandbox.sh`), pas en production.

**Règle 2 — quand l'HTTP réel exige d'écrire (e2e navigateur), marquer AVANT
de créer.** Préfixe obligatoire : slug `qa-<lot>-…`, e-mails
`qa-<lot>-…@fadeup.test`, noms « ZZ dead QA <LOT> … » dès la création (pas
après la campagne : un crash au milieu laisserait des lignes non marquées).
Le préfixe `zz`/« ZZ dead » les relègue en fin de tri ; `@fadeup.test` ne
délivre jamais.

**Règle 2b — une seule campagne e2e à la fois sur `qa-f1b-shared`.** Les
tests F1b mutent l'état de l'organisation partagée (join/leave/move,
activation de file) : deux campagnes simultanées se cassent mutuellement —
mesuré le 2026-09-07 quand les campagnes X3 et F2 ont tourné en même temps
(2 échecs de chaque côté, 100 % vert en isolé). Convenu entre lots,
consigné des deux côtés.

**Règle 3 — réutiliser, ne pas accumuler.** Le modèle F1b : UNE organisation
partagée (`qa-f1b-shared`), réactivée puis neutralisée à chaque campagne,
plutôt qu'une organisation neuve par run. Tout nouveau besoin e2e commence
par « est-ce que `qa-f1b-shared` (+ un compte barber) suffit ? ». La suite F1
historique, qui crée 2 organisations par campagne (son premier test EST
l'installation), reste l'exception connue — BLOCKERS §12.2, à réécrire un
jour comme chantier de suite de tests.

**Règle 4 — neutraliser en fin de campagne.** Une organisation e2e qui a
servi est laissée : `marketplace_visible = false`, nom préfixé « ZZ dead »,
file fermée, essai non converti. Les comptes `auth.users` de pure
authentification (pas d'organisation) peuvent, eux, être supprimés — le
pattern mémoire « créer/supprimer dans la même transaction » reste valable
pour les balayages authentifiés.

**Règle 5 — jamais la suite `verify_*.sql` héritée contre la production**
(BLOCKERS §5). C'est elle qui a fait les 31 de B1.

## 4. Peut-on créer des données de test qui n'entrent pas du tout dans les journaux ?

Examiné par X3, tranché ainsi :

- **Transaction + rollback** (règle 1) le fait déjà, parfaitement, pour tout
  ce qui n'a pas besoin de traverser HTTP. C'est la réponse par défaut.
- **Exempter les lignes `qa-*` des journaux append-only** (un `WHEN` sur le
  préfixe dans les triggers d'historique) est REFUSÉ : un trigger d'intégrité
  qui a des exceptions n'est plus une garantie — et un attaquant nommerait
  son organisation `qa-…`.
- **Un schéma séparé** pour les fixtures ne marche pas : l'intérêt d'un e2e
  est précisément de traverser les vraies tables, RLS et triggers compris.

Donc : rollback quand c'est possible, marquage + réutilisation + 
neutralisation quand ça ne l'est pas. Le tas de 72 ne DOIT plus grossir que
de zéro (suites SQL) ou d'un multiple connu et documenté (e2e F1, 2 par
campagne complète, jusqu'à sa réécriture).

## 5. Imagerie de démonstration (D1, 2026-09-07)

D1 a posé des IMAGES sur le jeu de démonstration `demo-*` (aucune
organisation nouvelle, aucune donnée opérationnelle). Provenance : dérivés
(recadrages) des deux générations Artlist déjà payées du 2026-08-31 —
aucune ne représente un professionnel réel ni un salon existant.

| Quoi | Où | Marquage | Retrait |
|---|---|---|---|
| 8 bannières d'établissement | `apps/web/public/demo-media/banners/<slug>.jpg` + registre `src/shared/lib/demoMedia.ts` (slugs `demo-*` uniquement) | chemin `/demo-media/`, slug `demo-*` | supprimer le dossier + le module |
| 2 portraits (`demo.kais.bellamine`, `demo.moussa.diakite`) | `public/demo-media/avatars/` + `professionals.avatar_url`/`staff_profiles.avatar_url` | handle `demo.*`, chemin `/demo-media/` | `update … set avatar_url = null where handle like 'demo.%'` |
| 5 posts portfolio (7 médias JPEG) | `posts`/`post_media` + bucket `post-media/d1-demo/` | UUID préfixe hex `d1de`, caption « — démo FadeUp », préfixe `d1-demo/` | `delete from posts where id::text like 'd1de%'` + objets `d1-demo/*` |

Seed idempotent : `db/seeds/d1_demo_media.sql` (rôle `postgres`).
Seuls DEUX visages distincts existent dans les sources : les autres
identités `demo.*` gardent volontairement le monogramme — donner le même
visage à deux personnes différentes serait un mensonge visuel.
