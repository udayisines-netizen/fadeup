# Blocages infra constatés en P1b (2026-09-04)

Deux blocages hors périmètre frontend, constatés et vérifiés pendant P1b.
Ils ne sont PAS contournables côté code applicatif ; les écrans concernés
sont livrés et affichent des erreurs traduites en attendant.

> **État au 2026-09-04, après B2.** Blocages n°1 (SMTP) et n°3
> (`get_public_service_state`) **RÉSOLUS**. Restent ouverts : n°2 (WebKit),
> n°4 (`TRUNCATE`, réduit de 4 tables par B1 puis d'une par B2, il en reste
> 82), n°5 (scripts `verify_*` hérités). B2 ajoute n°6, la séparation des
> domaines d'envoi, et n°7, la clé Resend restreinte à l'envoi.
>
> **Mise à jour B4 (2026-09-07)** sur le n°4 : les 9 tables sociales de B4
> naissent durcies (`anon` : rien ; `authenticated` : jamais
> TRUNCATE/TRIGGER/REFERENCES/MAINTAIN), et B4 a trouvé puis retiré le même
> motif sur **`storage.objects` et `storage.buckets`** — `anon` y détenait
> `arwdDxtm`, TRUNCATE compris, c'est-à-dire le pouvoir de vider les
> métadonnées de tous les fichiers du produit
> (`db/migrations/20260907120150_b4_storage_grant_hardening.sql`, à appliquer
> en `supabase_admin` : le grantor est `supabase_storage_admin` et un REVOKE
> par `postgres` est un no-op silencieux). Les 82 tables public restent à
> balayer dans le lot de durcissement dédié.
> **Mise à jour B3 (2026-09-07).** Le blocage Billing du V2_DATA_CONTRACT
> (« catalogue ≠ spec + zéro Stripe ») est **RÉSOLU** : catalogue Stripe
> synchronisé en mode test, essai 14 jours, souscription/portail/changements
> de plan, webhooks + grâce 7 j, paliers multi-établissements. B3 ajoute
> n°8 (passage en mode réel Stripe — décision fondateur) et n°9 (redéfinition
> des fonctions possédées par `supabase_admin`).

---

## 1. ~~Envoi d'e-mails GoTrue~~ — **RÉSOLU par B2 (2026-09-04)**

**Correctif** : GoTrue est configuré en SMTP sur Resend
(`smtp.resend.com:587`, utilisateur `resend`, expéditeur
`FadeUp <bonjour@contact.fade-up.com>`), et le conteneur
`fadeup-supabase-auth` porte bien ces valeurs — vérifié dans son
environnement, pas seulement dans `.env`.

**Preuve mesurée** :

```
POST /auth/v1/otp  ->  HTTP 200   (durée 1,79 s = l'aller-retour SMTP réel)
audit GoTrue       ->  user_recovery_requested
```

L'échec d'origine était un `500 unexpected_failure` immédiat sur
`lookup supabase-mail ... server misbehaving`. Une réponse 200 après un
aller-retour de 1,8 s est une poignée de main SMTP qui a abouti.

**Envoi applicatif également livré** : `email_outbox` avait une machine
d'état complète depuis R1A et **aucun expéditeur** — 15 messages y
attendaient. B2 branche pg_net + le vault sur l'API Resend. Preuve de bout en
bout sur la base de production : `status = sent`,
`provider_message_id = 242894b7-bf65-4d32-8b2a-03680d72dfbd`.

**Ce qui n'est pas prouvé et ne peut pas l'être ici** : la RÉCEPTION en boîte.
Voir le point n°7 — la clé API est restreinte à l'envoi, donc l'état de
délivrance n'est pas interrogeable. Le fondateur confirme en ouvrant sa boîte.

**`SITE_URL` — traité, pas contourné.** `GOTRUE_SITE_URL` reste
`https://fade-up.com` et `GOTRUE_URI_ALLOW_LIST` contient déjà
`http://localhost:5173/**`. Pour tester en local, passer `redirect_to` vers
une origine autorisée ; **ne pas** ajouter d'hôte local à
`GOTRUE_MAILER_EXTERNAL_HOSTS`, qui laisserait un en-tête `Host` forgé
détourner un lien magique. L'avertissement « external host ... not added »
dans les logs est donc le comportement voulu.

### Diagnostic d'origine (P1b)

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

## 4. ~~`TRUNCATE` accordé à `anon` et `authenticated` sur presque toute la base~~ — **RÉSOLU par X3 (2026-09-07)**

**Résolution X3.** `TRUNCATE`, `TRIGGER`, `REFERENCES` et `MAINTAIN` retirés à
`anon` et `authenticated` sur TOUTES les tables de `public` et `storage`
(migration `20260907171000`, appliquée en `supabase_admin` — le superuser
révoque en tant que propriétaire, atteignant les trois concédants sans
no-op ; `storage.buckets_analytics`, oubliée de B4, alignée lecture seule).
Les ACL PAR DÉFAUT sont durcies aussi (`20260907173000`) : une table neuve ne
renaît plus avec ces verbes, une fonction neuve de `public` ne naît plus
exécutable par `anon`/`authenticated`/`PUBLIC` — **toute migration créant une
RPC cliente doit désormais écrire ses `grant execute` explicites**
(doctrine : `docs/frontend/DB_OWNERSHIP.md`). Vérifié : `verify_x3.sql`
(24 assertions, prod + restauration fidèle), retour arrière prouvé ACL
comparées, `db/tests/x3_anon_surface.sh --strict` vert. Texte d'origine
conservé ci-dessous pour l'histoire.

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


---

## 6. Séparation des flux d'envoi — **UN SEUL DOMAINE VÉRIFIÉ** (constaté en B2, 2026-09-04)

> **Mise à jour X2 (2026-09-08).** Toujours un seul domaine vérifié — la
> re-sonde X2 n'a pas pu conclure (429 : quota quotidien Resend épuisé par
> les campagnes de test du jour, voir §14.3). La préparation est COMPLÈTE :
> les actions DNS exactes du fondateur et la bascule en une ligne sont
> documentées dans `docs/frontend/EMAIL_DELIVERABILITY.md` §2. Le risque
> reste entier tant que ce n'est pas fait, et X2 recommande de NE PAS donner
> l'ordre de publier les prospects avant cette vérification : le premier
> envoi en masse concentrerait ses rebonds sur le domaine des liens magiques.

**Ce que la spec demande.** B2 §3 : deux domaines d'envoi distincts,
transactionnel et prospection, pour qu'une réputation abîmée par du démarchage
à froid ne fasse pas tomber les liens magiques.

**Ce qui est mesuré** (sonde contre l'API Resend, 2026-09-04) :

| Domaine | Réponse |
|---|---|
| `contact.fade-up.com` | accepté, identifiant retourné |
| `pro.fade-up.com` | **403** « domain is not verified » |
| `fade-up.com` | non sondé (le 403 ci-dessus suffit à établir le point) |

**Le risque, en clair.** Aujourd'hui les relances de prospection et les liens
magiques partent du même domaine. Une vague de plaintes sur les premières
dégrade la délivrabilité des seconds. **Un client qui ne reçoit pas son lien
magique est un client perdu**, et il l'est à cause d'e-mails qui ne le
concernaient pas.

**Ce que B2 a fait en attendant.** Les deux flux sont modélisés
(`public.email_streams`), avec des adresses distinctes — `bonjour@` et `pro@`
— et des en-têtes `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) sur
la seule prospection. Des adresses distinctes aident le destinataire et le
routage des réponses ; elles n'aident **en rien** la réputation, qui se
calcule par domaine.

**Remédiation** (DNS, décision fondateur) :
1. ajouter et vérifier un second domaine chez Resend, par exemple
   `pro.fade-up.com` : enregistrements SPF, DKIM et DMARC ;
2. puis, en base, une seule ligne :
   `update public.email_streams set from_address = 'pro@pro.fade-up.com' where stream = 'prospecting';`

Aucune migration n'est nécessaire : le modèle a été construit pour que ce jour
coûte un `UPDATE`.

---

## 7. Clé API Resend restreinte à l'envoi — **la délivrance n'est pas observable** (constaté en B2, 2026-09-04)

> **Mise à jour X2 (2026-09-08) — l'option 1 (webhook) est CONSTRUITE,
> déployée INERTE.** Fonction Edge `resend-webhook` (signature Svix vérifiée
> à temps constant AVANT toute écriture, 401 fail-closed sans secret —
> vérifié en production), journal idempotent `resend_webhook_events` (PK =
> id Svix), traitement SQL cadencé par le scheduler
> (`run_email_feedback_maintenance`) : delivered/opened → horodatages
> d'`email_outbox` ; **rebond permanent ou plainte → adresse supprimée +
> `do_not_contact`**. verify_x2.sql couvre le tout (51 assertions). Reste
> UNE action fondateur : créer le point de terminaison chez Resend et poser
> le secret — procédure exacte dans `docs/frontend/EMAIL_DELIVERABILITY.md`
> §3. Tant que ce n'est pas fait, la délivrance reste inobservable.

**Symptôme.** `GET /domains` et `GET /emails/{id}` répondent :

```
401 {"name":"restricted_api_key","message":"This API key is restricted to only send emails"}
```

**Conséquence.** `POST /emails` fonctionne — c'est ce qui compte — mais FadeUp
ne peut pas relire l'état d'un message. `email_outbox.status = 'sent'`
signifie donc exactement « **Resend a accepté le message** », et rien de plus :
ni délivré, ni ouvert, ni rebondi. La colonne `provider_message_id` permet de
retrouver le message dans le tableau de bord Resend, à la main.

**Ce que cela empêche** : détecter automatiquement une adresse invalide, un
rebond dur, une plainte pour spam. Sur un domaine d'envoi neuf, ce sont
précisément les signaux qu'il faudrait surveiller.

**Remédiation**, au choix :
1. un webhook Resend (`email.delivered`, `email.bounced`, `email.complained`)
   vers une Edge Function qui met à jour `email_outbox` — c'est la voie
   propre, et elle ne demande pas d'élargir la clé ;
2. une clé à accès complet, qui rendrait `GET /emails/{id}` interrogeable
   depuis le tick de réconciliation. Plus simple, moins bon : une clé plus
   large vit alors dans le vault d'une base applicative.

**Recommandation : l'option 1.** La sonde de rebond est ce qui protège la
réputation partagée décrite au point n°6.
---

## 8. Stripe en mode TEST — le passage en mode réel est une décision du fondateur (B3, 2026-09-07)

**Tout B3 est construit et prouvé en mode test Stripe** : catalogue (produits
`fadeup_*`, prix mensuels et annuels), webhook endpoint
(`https://fade-up.com/functions/v1/stripe-webhook`), portail client, tunnel de
souscription complet (carte 4242, TVA Stripe Tax active). Aucun objet n'existe
en mode réel.

**Ce que le passage en mode réel demandera** (jamais une étape automatisée) :
clés réelles dans `infra/supabase/.env` (le script de synchronisation REFUSE
toute clé non `sk_test_` tant que `private.billing_livemode()` rend `false`),
migration d'une ligne pour basculer `private.billing_livemode()` à `true`,
re-exécution de `db/seeds/b3_configure_stripe.sh` et
`db/seeds/b3_sync_stripe_catalog.sh` (adaptés au garde-fou), un webhook
endpoint de mode réel avec son propre secret, et surtout : CGV, mentions
légales, politique de remboursement — rien de tout cela n'existe.

## 9. Fonctions possédées par `supabase_admin` — **TRANCHÉ par X3 (2026-09-07)** : doctrine écrite, pas d'uniformisation

**Résolution X3.** Le « à trancher une fois, proprement » est fait :
`docs/frontend/DB_OWNERSHIP.md` fixe la doctrine (rôle d'application par
défaut `postgres` ; vérification du `proowner` avant toute redéfinition ;
migration entière en `supabase_admin` quand elle touche un objet
`supabase_admin` ou des grants `storage.*`). L'uniformisation de propriété
est REFUSÉE, argumentée (transférer 42 fonctions SECURITY DEFINER d'un
superuser vers un non-superuser changerait leur sémantique d'exécution).
Texte d'origine ci-dessous.

42 fonctions de `public`/`private` appartiennent à `supabase_admin` (héritage
des lots MASTER appliqués sous ce rôle), dont `get_organization_readiness` et
`complete_onboarding`. Une migration appliquée en tant que `postgres` ne peut
ni les redéfinir ni même les commenter — le bac d'essai fidèle de B3 l'a
refusé, exactement comme il devait.

Conséquence pour B3 : le démarrage d'essai n'a PAS pu être inséré dans
`complete_onboarding` ; il passe par le balayage `run_trial_maintenance`
(latence ≤ 60 s) et par la RPC `start_organization_trial`. Conséquence
générale : tout lot futur qui doit toucher ces 42 fonctions devra soit
s'appliquer en `supabase_admin`, soit faire précéder la migration d'un
`ALTER FUNCTION ... OWNER TO postgres` décidé et tracé. À trancher une fois,
proprement, plutôt que lot par lot.

---

## 10. ~~`private.queue_stage` non accordée à `authenticated`~~ — **RÉSOLU par F1 (2026-09-07)**

**Symptôme.** Toute transition d'une entrée de file via l'API répondait
`403 — permission denied for function queue_stage` : appeler, marquer
absent, marquer terminé étaient impossibles pour TOUS les rôles. Le trigger
`enforce_queue_transition` (SECURITY INVOKER, sans exemption de rôle —
voulu) appelle `private.queue_stage()`, et B1 avait accordé EXECUTE à
`authenticated` sur ses jumelles (`has_org_role`, `is_own_barber`) mais pas
sur elle. Latent depuis B1 : F1 est le premier écran à exercer ce chemin.

**Correctif** : `db/migrations/20260907050000_f1_queue_stage_execute_grant.sql`
(GRANT EXECUTE à `authenticated`, appliqué en `postgres` — le grantor doit
être le propriétaire, leçon B4). Retour arrière testé sur restauration
fidèle (`pre-f1-20260907-034902.dump`, up/down vérifiés ACL à l'appui).
Sans échec de transition silencieux désormais : l'écran pro remonte un toast.

## 11. ~~La face client de la file — deux contrats manquants~~ — **RÉSOLUS par F1b (2026-09-07)**

1. **Quitter la file — LIVRÉ** : `leave_public_queue(p_entry_id uuid)`
   (migration `20260907154000`), exactement sur le modèle proposé — l'uuid
   d'entrée fait capacité pour l'anonyme (modèle claim_token B2), la session
   fait foi pour une entrée de compte (`booked_by_user_id`, avec le
   `coalesce` anti-NULL : un anonyme muni de l'uuid ne peut PAS agir sur une
   entrée de compte — défaut attrapé par l'e2e F1b et couvert par
   `verify_f1b.sql`). `waiting` et `called` → `cancelled` uniquement ; refus
   nommés `fadeup_queue_refusal=entry_not_found | not_entry_owner |
   entry_already_closed | entry_in_service`.
2. **Compte à rebours côté client — LIVRÉ** : `get_queue_entry_tracking`
   expose `called_deadline_at` (échéance ABSOLUE UTC calculée serveur) sur
   la propre entrée seulement — jamais la durée de grâce brute. F1b ajoute
   aussi le balayage de grâce (`run_queue_grace_maintenance`, désactivé par
   défaut, activable par salon), la trace `auto_marked_no_show_at`, et la
   passe scheduler dédiée dans `infra/scheduler/tick.sh` — **le tick.sh de
   production ne l'exécutera qu'à la fusion** ; d'ici là la fonction existe
   en base et ne fait rien (aucun salon ne l'a activée).

## 12. Restes F1b, constatés en F1b (2026-09-07)

1. **Pas de choix de service au join public** : `join_public_queue` accepte
   `p_service_id` mais l'écran client ne le demande pas (décision F1 : coût
   d'interaction minimal). Conséquence honnête : une entrée sans service n'a
   pas de durée estimable — l'estimation F1b affiche alors RIEN pour cette
   file (repli « rien », loi produit). Le jour où le join demandera le
   service (une ligne de plus dans la feuille), l'estimation s'allumera
   partout ; la collecte, elle, tourne déjà (file + rendez-vous).
2. **La suite e2e F1 historique crée 2 organisations `qa-f1-*` par
   campagne complète** (une par projet Chromium — son premier test EST le
   parcours d'installation, qui exige un compte neuf). F1b, elle, réutilise
   UNE organisation partagée `qa-f1b-shared` (+1 compte barber). Réécrire le
   test d'installation F1 pour borner l'accumulation est un chantier de
   suite de tests à part.

## 13. Nouveaux invariants X3, constatés en X3 (2026-09-07)

1. **Les grants d'une RPC neuve sont explicites, ou elle est morte.** Depuis
   `20260907173000`, une fonction neuve de `public` naît sans EXECUTE
   `anon`/`authenticated`/`PUBLIC`. Le lot F2 (en vol pendant X3, prévenu et
   synchronisé en direct) écrivait déjà ses grants explicitement ; tout lot
   suivant doit faire pareil. L'oubli = 401 immédiat, listé par
   `db/tests/x3_anon_surface.sh --strict` (contrat de surface anon : 41 RPC
   consacrées) et par `probe_public_rpcs.sh --strict`.
2. **`anon` garde des INSERT/UPDATE/DELETE latents sur ~40 tables** (RLS les
   neutralise — aucune policy anon en écriture n'existe ; mesuré 0 ligne
   atteignable par le balayage HTTP). Hors périmètre X3 (le prompt préservait
   les quatre verbes RLS-gouvernés) ; un futur lot peut réduire au strict
   nécessaire, table par table. Idem le grant `anon` EXECUTE sans objet sur
   `apply_appointment_no_show_rule` (INVOKER : 0 ligne modifiable en anon).
3. **`pg_default_acl` des SÉQUENCES** : `anon`/`authenticated` reçoivent
   encore `rwU` par défaut sur les séquences neuves de `public`/`storage`
   (aucune n'existe aujourd'hui avec ces grants). Non traité — signalé.
## 13. Open Graph par profil — invisible aux dérouleurs de liens sans JavaScript (constaté en F2, 2026-09-07)

**Symptôme.** Les profils publics F2 posent titre, description et image Open
Graph à l'exécution (`useDocumentMeta`) — vérifié dans le navigateur. Mais un
dérouleur de lien qui n'exécute pas JavaScript (WhatsApp, iMessage, Slack,
la plupart des bots) ne lit QUE les balises statiques d'`index.html`, qui
restent génériques (et portent un domaine `fadeup.example` d'attente).

**Cause exacte.** L'application est une SPA sans rendu serveur — et la
migration Next.js/SSR est un NON-GOAL explicite (MASTER_SPEC §22). Aucun code
applicatif ne peut changer ce qu'un client HTTP sans JS reçoit.

**Impact.** « Un lien collé dans WhatsApp doit donner envie de cliquer »
(F2 §5) n'est atteignable aujourd'hui que pour les rares agents qui exécutent
JS. Le partage fonctionne, l'aperçu riche par profil, non.

**Remédiation** (infra, hors périmètre F2) : un pré-rendu ciblé au bord —
par exemple Nginx qui route les user-agents de dérouleurs vers un petit
service qui interroge `get_public_professional_by_handle` /
`get_public_organization` et rend un HTML minimal aux bonnes balises, ou une
pré-génération statique des routes `/pro/*` et `/shop/*` connues. À décider
avec le fondateur ; toucher à Nginx de production n'était pas dans le
périmètre F2.

## 14. Restes X2, constatés en X2 (2026-09-08)

1. ~~**Le désabonnement en un clic (RFC 8058) ne fonctionne que pour un
   humain.**~~ — **RÉSOLU par X2 même (2026-09-08), après revue.** B2 posait
   `List-Unsubscribe-Post` avec pour cible `/unsubscribe/:token`, une route
   qui n'existait pas (404 SPA) et qui, une fois créée, ne pouvait pas
   recevoir le POST machine. X2 livre la fonction Edge `unsubscribe`
   (`/functions/v1/unsubscribe/<token>` : GET → 303 vers la page humaine à
   confirmation ; POST One-Click → RPC `unsubscribe_prospect_outreach`) et
   les payloads d'e-mails (prospection B2 + information X2) pointent
   désormais cette URL. Prouvé en production : GET 303, POST 200, PUT 405,
   sans jeton 400. Les e-mails DÉJÀ partis portent l'ancienne URL de page —
   elle reste servie (chemin humain), seul leur One-Click machine restera
   muet.
2. **`apps/mobile` doit être synchronisée À LA FUSION de X2.** La garde
   anti-dérive M1a (`apps/mobile/scripts/check-shared-drift.mjs`) exige des
   copies verbatim de `database.types.ts` (régénéré par X2 : +130 lignes
   additives) et des catalogues `shared/i18n/locales/{fr,en}` (X2 ajoute
   `legal.json`). X2 n'a PAS touché `apps/mobile` (M1b y travaille en
   parallèle) : au premier `check:drift` après fusion, copier ces fichiers
   côté mobile.
3. **Le quota quotidien Resend s'épuise en campagnes de test** (constaté le
   2026-09-08 : 429 sur toute tentative d'envoi, 238 messages `@fadeup.test`
   acceptés le même jour + 196 en file au moment du constat). Un TLD `.test`
   ne délivre jamais : chaque envoi de test consomme du quota pour rien, et
   **un lien magique réel demandé ce jour-là échoue**. Ce n'est plus une
   prédiction : la campagne e2e complète du 2026-09-08 07:17 l'a MESURÉ —
   `gomail: could not send email 1: 550 You have reached your daily email
   sending quota` dans les logs GoTrue, test F4 « inscription légère OTP »
   en échec sur les deux projets (le seul e2e qui exige un VRAI envoi).
   Décision fondateur : palier Resend payant avant toute campagne réelle, et
   discipline de test (bac sans envoi, ou adresses `@resend.dev` qui ne
   comptent pas comme du trafic réel) — voir
   `docs/frontend/EMAIL_DELIVERABILITY.md` §4.
4. **`apps/web/public/sitemap.xml` est périmé** : il liste `/features`,
   `/pricing`, `/pro/login`… qui n'existent plus, et n'a pas les routes
   publiques réelles. X2 y a seulement ajouté `/professionals-data`
   (l'indexabilité de cette page est une exigence article 14(5)(b)) ; la
   réécriture du fichier est un chantier SEO à part.
5. **`bonjour@contact.fade-up.com` ne peut pas RECEVOIR de courrier** —
   trouvé par la revue indépendante X2, et c'est LE verrou restant avant
   l'ordre de publier. `contact.fade-up.com` n'a ni MX ni A (mesuré :
   `dig MX contact.fade-up.com` vide ; l'apex `fade-up.com` a bien des MX
   ionos). Le domaine sait envoyer (DKIM Resend), pas recevoir. Or cette
   adresse est le contact du responsable de traitement sur la page article
   14, le canal « source exacte sur demande » (art. 14(2)(f)), le repli des
   messages d'erreur du formulaire, et le `reply_to` des DEUX flux
   (`email_streams`). Un professionnel qui exerce son droit d'accès écrit à
   une boîte qui rebondit. Remédiation (fondateur, DNS/boîte) :
   `docs/frontend/EMAIL_DELIVERABILITY.md` §6 — créer la réception (MX sur
   `contact.` ou bascule des textes vers une adresse de l'apex qui reçoit),
   puis PROUVER par un envoi entrant réel.
