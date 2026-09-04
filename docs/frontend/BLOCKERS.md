# Blocages infra constatés en P1b (2026-09-04)

Deux blocages hors périmètre frontend, constatés et vérifiés pendant P1b.
Ils ne sont PAS contournables côté code applicatif ; les écrans concernés
sont livrés et affichent des erreurs traduites en attendant.

> **État au 2026-09-04, après B1.** Le blocage n°3
> (`get_public_service_state` en 405) est **RÉSOLU** — voir sa section, qui
> conserve le diagnostic parce qu'il documente une classe d'erreur, pas un
> incident. Les blocages n°1 (SMTP) et n°2 (WebKit) restent ouverts : B1 était
> un chantier base de données et n'y a pas touché. B1 a par ailleurs ouvert
> deux nouveaux points, n°4 et n°5.

---

## 1. Envoi d'e-mails GoTrue — **BLOQUANT POUR P2**

**Symptôme.** Tout envoi d'e-mail d'authentification échoue : lien magique
(`POST /auth/v1/otp`), réinitialisation de mot de passe
(`resetPasswordForEmail`). GoTrue répond `500 unexpected_failure`
(« Error sending magic link email »).

**Cause exacte** (logs `fadeup-supabase-auth`, test de bout en bout du
2026-09-04) :

```
dial tcp: lookup supabase-mail on 127.0.0.11:53: server misbehaving
```

`infra/supabase/.env` pointe `SMTP_HOST=supabase-mail` / `SMTP_PORT=2500` —
**le conteneur `supabase-mail` n'existe pas** (absent de `docker ps`). C'est
le serveur de test du stack Supabase par défaut, jamais déployé ici. De
plus `SMTP_SENDER_NAME=fake_sender` : même en relançant ce conteneur, ce
serait une boîte de test, pas une délivrance réelle.

**Ce qui fonctionne malgré tout.** `ENABLE_EMAIL_AUTOCONFIRM=true` :
inscription, connexion et déconnexion par mot de passe fonctionnent sans
e-mail (vérifié e2e). Les écrans `/auth/magic`, `/auth/otp`, `/auth/forgot`
sont construits, testés, et remontent l'échec TRADUIT
(`v2:auth.errors.emailSendFailed`), jamais le texte brut.

**Impact.** L'inscription ultra-légère dans le flux de réservation
(lien magique / OTP — exigence P2) n'a AUCUN canal d'envoi. **P2 est bloqué
tant que ce point n'est pas réparé.**

**Remédiation** (infra, décision fondateur pour le fournisseur) :
1. Provisionner un vrai fournisseur SMTP (ou, pour le dev local, déployer
   un conteneur Mailpit/Inbucket et le nommer `supabase-mail` sur le réseau
   du compose Supabase).
2. Renseigner `SMTP_HOST/PORT/USER/PASS/SMTP_SENDER_NAME/SMTP_ADMIN_EMAIL`
   avec des valeurs réelles dans `infra/supabase/.env`, puis recréer le
   conteneur `fadeup-supabase-auth`.
3. Ajouter les hôtes de dev à `GOTRUE_MAILER_EXTERNAL_HOSTS` (GoTrue ignore
   aujourd'hui les `Host`/`X-Forwarded-Host` locaux — avertissement dans
   les logs) et vérifier `SITE_URL`/`ADDITIONAL_REDIRECT_URLS`
   (actuellement `https://fade-up.com` uniquement : les liens des e-mails
   ne reviendront jamais vers un environnement local).
4. Re-vérifier de bout en bout : `POST /auth/v1/otp` → 200, e-mail reçu,
   lien → `/auth/callback` → session ; code à 6 chiffres → `/auth/otp`.

---

## 2. E2E WebKit — non exécutable sur cet hôte

**Symptôme.** `playwright install webkit` télécharge le binaire
(`~/.cache/ms-playwright/webkit-2336`) mais tout lancement échoue :
« Host system is missing dependencies to run browsers ».

**Cause exacte.** Bibliothèques système absentes : `libgtk-4`,
`libgraphene`, `libevent-2.1`, la pile GStreamer (`libgstallocators`,
`libgstapp`, `libgstaudio`, `libgstvideo`, `libgstgl`, …), `libflite` et
ses voix, entre autres. Leur installation (`npx playwright install-deps
webkit` ou apt) **exige root**, indisponible pour l'utilisateur `fadeup`
(`sudo` refusé).

**État livré.** `playwright.config.ts` définit les quatre projets ; les
deux projets WebKit (390 px et 1440 px) sont conditionnés à
`P1B_WEBKIT=1` pour que `npm run e2e` reste déterministe sur cet hôte.
Chromium 390/1440 couvre aujourd'hui les 39 scénarios.

**Remédiation.**
1. Avec un accès root : `sudo npx playwright install-deps webkit`
   (ou installer la liste apt équivalente), une seule fois par hôte.
2. Puis : `P1B_WEBKIT=1 npm run e2e` — les specs existantes tournent
   telles quelles sur les quatre projets ; aucune modification de code
   n'est nécessaire.

---

## 3. ~~`get_public_service_state` — cassée via l'API pour TOUT appelant~~ — **RÉSOLU par B1 (2026-09-04)**

**Correctif livré** : `db/migrations/20260904160100_b1_service_state_read_only.sql`.
Le `perform private.ensure_location_service_settings(...)` a été **retiré des
deux lectures** — `get_public_service_state` et `get_service_mode_state`, qui
portaient le même défaut — et remplacé par
`private.location_service_settings_effective()`, jumelle en lecture seule qui
renvoie la même valeur de compatibilité (`hybrid`, file ouverte) sans écrire.
La fonction reste `STABLE`, ce qui est correct pour une lecture : passer en
`VOLATILE` aurait fait disparaître le 405 en laissant une écriture sur le
chemin de tout profil public.

**Preuve** : `db/tests/probe_public_rpcs.sh --strict` — les 15 RPC publiques
répondent **200** en rôle `anon` via Kong, dont
`get_public_service_state` avec un corps exploitable. Ce script est le test de
non-régression : il échoue si l'une d'elles cesse de répondre 200.

Le diagnostic ci-dessous est conservé : il décrit une classe d'erreur que
n'importe quelle future RPC publique peut reproduire.

### Diagnostic d'origine (P1c)

**Symptôme.** `POST /rest/v1/rpc/get_public_service_state` → **405** avec
`25006 cannot execute INSERT in a read-only transaction`, pour anon comme
pour authenticated, y compris sur `side-agency` (donc indépendant du seed
de démonstration).

**Cause exacte.** La fonction est déclarée `STABLE` mais exécute
`perform private.ensure_location_service_settings(p_location_id)` — un
INSERT (même `on conflict do nothing`, c'est une écriture). PostgREST
exécute les fonctions STABLE en transaction lecture seule → refus
systématique. En psql (P1a) elle fonctionnait, d'où la découverte tardive.

**Impact.** L'état de service public (mode effectif, Réserver/File) est
INDISPONIBLE côté front. **Bloquant P2** : profils publics, tunnel de
réservation et file en dépendent. Les études /demo affichent `partial-data`
et désactivent Réserver tant que l'état est inconnu — jamais un état inventé.
`get_service_mode_state` (staff) partage probablement le même motif ensure —
à vérifier au même moment.

**Remédiation** (backend, hors périmètre P1c — aucune modification de schéma
autorisée) : soit déclarer la fonction `VOLATILE` (PostgREST l'exécutera en
lecture-écriture), soit sortir le `ensure_…` de la lecture (le déplacer vers
les écritures qui créent la location). Re-tester ensuite en anon via Kong.

---

## 4. `TRUNCATE` accordé à `anon` et `authenticated` sur presque toute la base — **constaté en B1 (2026-09-04)**

**Symptôme.** Mesuré sur la base de production, avant correction :

```
begin; set local role anon; truncate public.queue_entries;
TRUNCATE TABLE
```

**Cause exacte.** `TRUNCATE` n'est **pas soumis à RLS**. Les politiques ne
sont jamais consultées. Le privilège vient d'un `grant` de table, et il est
généralisé :

| Rôle | `TRUNCATE` / `TRIGGER` / `REFERENCES` |
|---|---|
| `anon` | **54 tables** |
| `authenticated` | **87 tables** |

`SELECT`, `INSERT`, `UPDATE` et `DELETE` restent correctement filtrés par RLS
— un `insert` anonyme dans `locations` est refusé par
`new row violates row-level security policy`, vérifié. C'est `TRUNCATE` qui
passe à travers, et lui seul.

**Exploitabilité réelle.** PostgREST n'expose aucun verbe `TRUNCATE`, donc ce
n'est pas une porte ouverte depuis l'application. C'est un privilège latent —
et « l'API ne propose pas ce verbe » n'est pas un modèle d'autorisation.

**Ce que B1 a corrigé** : les quatre tables de son périmètre, dans
`db/migrations/20260904160600_b1_anon_privilege_hardening.sql`. `anon` ne
détient plus rien sur `locations`, `queue_entries`, `professionals` et
`location_service_settings` ; `authenticated` y garde exactement les quatre
verbes pour lesquels des politiques RLS existent et perd `TRUNCATE`,
`TRIGGER`, `REFERENCES`.

**Ce qui reste** : les 83 autres tables. Un balayage global mérite son propre
lot, son propre script de retour arrière et sa propre campagne de tests — pas
un passage clandestin dans un prompt sur les lectures publiques. **À traiter
avant toute ouverture publique du produit.**

---

## 5. Les scripts `db/tests/verify_*.sql` hérités polluent la base sur laquelle on les lance — **constaté en B1 (2026-09-04)**

**Symptôme.** B1 a lancé la suite `verify_*.sql` existante contre la base de
**production** pour établir une ligne de base avant/après. Plusieurs de ces
scripts **committent** leurs fixtures puis tentent de les supprimer, et la
suppression est refusée :

```
ERROR: commercial_plan_changes is append-only: DELETE is not permitted
```

Leur nettoyage échoue donc et les fixtures restent. 31 organisations, 27
lieux, 30 profils staff, 13 identités professionnelles, 4 clients et 5
prospects ont été créés ainsi. Une seule a atteint le public :
`wave1-boundary-a`, créée `marketplace_visible = true`, qui est apparue comme
dixième résultat de `search_public_professionals()`.

**C'était une erreur de B1**, pas un défaut de la base : `verify_b1.sql` est
écrit pour faire `rollback` précisément pour cette raison, et les scripts plus
anciens auraient dû être exécutés contre la base de restauration uniquement.

**Remédiation appliquée** : `db/seeds/b1_fixture_residue_cleanup.sql` —
`marketplace_visible = false`, lieux désactivés, organisations renommées selon
la convention `ZZ dead …` déjà présente, prospects fictifs passés en
`do_not_contact`. La marketplace publique est revenue à ses 9 lignes
légitimes, vérifié. **Les lignes ne peuvent pas être supprimées** :
`commercial_plan_changes` est append-only et son trigger l'énonce — « no role
exemption, on purpose ». B1 n'affaiblit pas cette garantie pour ranger
derrière lui.

**Ce qui reste à faire** : réécrire les scripts hérités sur le modèle de
`verify_b1.sql` (une transaction, un `rollback`), ou leur interdire
explicitement toute base autre qu'une base jetable. En attendant : **ne jamais
lancer `db/tests/verify_*.sql` — sauf `verify_b1.sql` — contre la production.**
