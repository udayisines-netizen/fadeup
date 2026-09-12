# FADEUP — Rapport final M1c-a : Google, notifications, hors-ligne

**Branche** `m1ca/auth-push`, worktree dédié `~/worktrees/m1ca`, créée depuis
`rebuild/social-first-v2`. **Aucune fusion effectuée.** `apps/web` n'a **aucun
fichier modifié**, `/platform` est intact.

**Migration en production** : oui, deux fichiers, procédure complète en §6.
Elle est déclarée ici, en tête, comme le lot l'exige.

---

## 1. L'avertissement qui doit passer avant tout : la règle 4.8

**La règle 4.8 de l'App Store impose Sign in with Apple dès qu'une application
propose une connexion tierce comme Google.** FadeUp propose Google. L'absence de
Sign in with Apple vaut **rejet**, pas remarque.

Sign in with Apple exige un Services ID et une clé de signature générés depuis
le compte développeur Apple. Le fondateur n'a pas de licence. **Rien n'a donc
été commencé côté Apple** — ni Sign in with Apple, ni liens universels, ni
publication — conformément à la consigne.

**Conséquence, écrite noir sur blanc : l'application n'est PAS publiable avant
M1c-b.** Ce n'est pas un problème aujourd'hui, c'en serait un le jour où
quelqu'un croirait pouvoir soumettre. Trois choses manquent avant soumission :

1. la licence développeur Apple (99 €/an) ;
2. Sign in with Apple, côté console Apple ET côté application ;
3. les liens universels (identifiant d'équipe + fichier d'association servi par
   `apps/web`).

Un quatrième verrou, indépendant d'Apple, est apparu en cours de lot et il est
plus contraignant qu'attendu : **les notifications push ne peuvent pas être
testées du tout sans licence** (§4).

---

## 2. Google

### 2.1 Ce qui existe réellement — mesuré, pas supposé

Le conteneur d'authentification de production a été interrogé directement :

```
GOTRUE_EXTERNAL_GOOGLE_ENABLED   = true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID = 226403590077-mfrf31afk6c7s5jquijimkltc72lk7hk.apps.googleusercontent.com
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI = https://fade-up.com/auth/v1/callback
GOTRUE_URI_ALLOW_LIST            = https://fade-up.com/**,http://localhost:5173/**
GOTRUE_EXTERNAL_APPLE_ENABLED    = false   (CLIENT_ID vide)
```

Google **fonctionne déjà** en production : quatre comptes portent une identité
Google (§2.3). C'est une configuration **web**, et c'est là que le prompt et la
réalité divergent — pour le mieux.

### 2.2 Un identifiant client iOS n'est PAS nécessaire pour le parcours de M1b

M1b a construit la connexion Google avec `signInWithOAuth` + navigateur système
(`expo-web-browser`), retour par lien profond. Dans ce parcours, **l'échange du
code contre des jetons se fait dans GoTrue, côté serveur, avec l'identifiant et
le secret WEB**. L'application n'a jamais l'identifiant client entre les mains.
Un identifiant de type iOS n'est requis que pour l'autre parcours — le SDK
natif Google (`@react-native-google-signin` + `signInWithIdToken`), que M1b
avait laissé en option (rapport M1b §12.3).

**Le verrou réel est ailleurs, et il est prouvé.** GoTrue n'accepte de renvoyer
des jetons que vers une URL de sa liste blanche ; hors liste, il retombe
silencieusement sur `SITE_URL`. Sonde, sur la production :

```
GET /auth/v1/verify?token=bogus&type=magiclink&redirect_to=fadeup://auth/callback
  -> 303 Location: https://fade-up.com#error=...            (RABATTU sur SITE_URL)

GET /auth/v1/verify?token=bogus&type=magiclink&redirect_to=https://fade-up.com/auth/callback
  -> 303 Location: https://fade-up.com/auth/callback#error=...   (respecté)
```

**Le lien profond de l'application n'est pas dans la liste blanche.** La
connexion Google de M1b ne peut donc PAS revenir dans l'application : le
navigateur atterrit sur le site, l'application n'obtient jamais son code, et
`openAuthSessionAsync` ne rend jamais `success`. Aucun message d'erreur : c'est
exactement le genre de panne qu'on découvre avec le premier vrai utilisateur.

### 2.3 Le rapprochement d'identités : mesuré en production

La question du prompt — un client inscrit par code e-mail qui revient par
Google se retrouve-t-il avec deux comptes ? — a une réponse **factuelle**, lue
dans la base de production :

```
users_email_partial_key = UNIQUE (email) WHERE is_sso_user = false
```

Un second compte portant la même adresse est **impossible au niveau du schéma**.
Le risque « deux comptes pour la même adresse » n'existe pas.

Et le rapprochement n'est pas une hypothèse : **il a déjà eu lieu deux fois**.

```
compte 768d5d58 : email+google | identités créées 2026-08-09 06:42 puis 2026-08-27 16:12
compte 7a647d6a : email+google | identités créées 2026-08-09 06:39 puis 2026-08-18 17:56
```

Deux comptes créés par e-mail en août se sont vu **rattacher** une identité
Google des semaines plus tard, **sous le même `user_id`**. GoTrue v2.189 relie
l'identité Google au compte existant quand l'adresse correspond (Google renvoie
toujours une adresse vérifiée pour ses propres comptes). 258 comptes, 4 avec
Google, 2 avec les deux identités.

**Comportement retenu** : on s'appuie sur ce rapprochement, on n'en construit
pas un second. Côté FadeUp, rien n'avait besoin d'être ajouté et rien ne l'a
été : `customer_profiles` est clé sur `user_id` (la synchro d'onboarding de M1b
fait un upsert), et la liaison client↔réservation de R1A se fait par adresse —
même compte, même adresse, même fiche.

**Ce que GoTrue ne fait pas, et que personne ne peut faire automatiquement** :
si le client utilise une adresse Google DIFFÉRENTE de celle de son code e-mail,
il obtient deux comptes distincts, et c'est correct — ce sont deux identités
sans rien qui les relie. Fusionner demanderait un parcours explicite « relier
mon compte », que le MASTER_SPEC ne définit pas. **Hors périmètre, déclaré.**

### 2.4 Le parcours reprend où il en était

Structurel depuis M1b, et inchangé : `AuthSheet` se pose **par-dessus** l'écran
courant, la session arrive sans aucune navigation, `onAuthed` rejoue
l'intention. Un client qui choisit son créneau, se connecte, revient sur son
récapitulatif avec son créneau intact — parce qu'il n'a jamais quitté l'écran.
Le code e-mail reste disponible : Google s'ajoute, ne remplace pas.

### 2.5 Ce que le fondateur doit faire, précisément

**(a) Une ligne d'exploitation, obligatoire avant le premier build** —
`infra/supabase/.env`, ligne 163 :

```
ADDITIONAL_REDIRECT_URLS=https://fade-up.com/**,http://localhost:5173/**,fadeup://**
```

puis recréer le seul conteneur d'authentification :

```
cd /opt/fadeup/infra/supabase
docker compose -f docker-compose.yml -f docker-compose.fadeup-auth.yml \
               -f docker-compose.fadeup-oauth.yml up -d --no-deps auth
```

**Pourquoi ce lot ne l'a PAS fait** : le changement n'apporte rien avant
qu'un build installable existe (donc avant la licence Apple), et il élargit
aujourd'hui la surface de redirection d'une authentification de production. Le
gain est nul maintenant, le risque non nul : il attend M1c-b, et la sonde du
§2.2 le vérifiera en une commande.

**Ne pas ajouter `exp://**`** en production, même pour tester dans Expo Go :
cela autoriserait l'envoi de jetons de session vers n'importe quel serveur de
développement Expo, sur n'importe quelle machine. Si un test Expo Go est
nécessaire, il se fait sur une pile de développement séparée.

**(b) Rien à créer chez Google pour le parcours actuel.** L'identifiant web
existant suffit. Vérifier seulement, dans la console Google Cloud > API et
services > Identifiants > le client web `226403590077-mfrf31af…`, que
`https://fade-up.com/auth/v1/callback` figure bien dans les URI de redirection
autorisés (c'est déjà le cas, puisque Google fonctionne sur le web).

**(c) Si et seulement si le parcours natif est choisi en M1c-b** (invite Google
intégrée, sans passage par le navigateur) : créer dans la console Google Cloud
un **client OAuth de type iOS**, avec l'identifiant de bundle
**`com.fadeup.app`** — posé dans `app.json` pendant ce lot, avec le paquet
Android au même nom. Un client iOS n'a **pas** de secret. L'application
enverrait alors le jeton d'identité à `signInWithIdToken`, et GoTrue devrait
connaître cet `audience`. **Recommandation : garder le parcours navigateur**,
qui fonctionne avec les identifiants existants et n'ajoute aucune dépendance.

---

## 3. Les notifications

### 3.1 Le modèle d'envoi : celui de `email_outbox`, répliqué

B2 avait construit un expéditeur **dans la base** : une file durable
(`email_outbox`), un rendu par gabarit et par langue (`email_templates` +
`private.render_email_template`), deux passes séparées — dépêche puis
réconciliation — et l'idempotence portée par un **index unique partiel** sur
`dedupe_key`. Ce motif gère déjà tout ce que le push exige : ne pas envoyer deux
fois, survivre à un redémarrage au milieu d'un lot, respecter les heures calmes,
garder une trace de ce qui est parti et de ce que le fournisseur a répondu.

Le lot le **réplique** plutôt que d'inventer un second système :

| e-mail (B2) | push (M1c-a) |
| --- | --- |
| `email_outbox` | `push_outbox` — une ligne = un envoi à **un appareil** |
| `email_templates` | `push_templates` — titre + corps, par gabarit et par langue |
| `email_streams` | *(rien)* — un seul transport : Expo |
| `private.email_dispatch_batch` | `private.push_dispatch_batch` |
| `private.email_reconcile_batch` | `private.push_reconcile_batch` |
| `public.run_email_delivery()` | `public.run_push_maintenance()` |

Les seules différences sont celles du **canal**, pas de l'architecture :

- un destinataire a **plusieurs appareils** : `push_devices` s'interpose, et une
  ligne d'outbox vise un appareil, pas une personne ;
- un jeton **meurt** (application désinstallée, appareil réinitialisé) : le
  fournisseur le dit et la réconciliation **retire** le jeton ;
- Expo répond **en deux temps** : un *ticket* immédiat (« le message est chez
  Expo ») puis un *reçu* (« voilà ce qu'APNs en a fait »). C'est dans le reçu
  que `DeviceNotRegistered` apparaît le plus souvent, d'où une **troisième
  passe** (`push_receipt_request_batch` / `push_receipt_resolve_batch`) et la
  table `push_receipt_requests` — une requête de reçus porte jusqu'à cent
  tickets, elle ne peut donc pas être suivie sur une ligne d'outbox.

Le tick est un **appel psql séparé** dans `infra/scheduler/tick.sh`, comme le
balayage de grâce F1b : les six travaux historiques partagent une instruction,
donc un domaine en panne les fait tomber ensemble. Une panne d'Expo ne doit pas
retarder une confirmation de réservation, et réciproquement.

### 3.2 Les quatre événements

| Événement | Déclencheur | Urgent ? | Catégorie |
| --- | --- | --- | --- |
| **C'est ton tour** | **trigger** `queue_entries_notify_called` sur `queue_entries` | oui | `queue_call` |
| Demande acceptée / refusée | `private.emit_booking_notification` (inchangé pour ses appelants) | oui | `booking_response` |
| Rappel avant rendez-vous | `private.enqueue_appointment_reminders` (nouveau), 2 h avant | oui¹ | `appointment_reminder` |
| Nouveau post d'un suivi | `private.enqueue_post_pushes`, diffusion différée | non | `social_post` |

¹ Le rappel choisit son heure (deux heures avant un rendez-vous), il n'a pas
besoin qu'on la lui impose après coup.

**Pourquoi l'appel de file est un TRIGGER et pas un appel dans une RPC** :
appeler un client est un `UPDATE queue_entries SET status='called'` direct,
gouverné par RLS et par les triggers de transition — la face pro web le fait
ainsi (F1/OS-2), et il y a plusieurs écrivains (web pro, plateforme, outils à
venir). Il n'existe aucune fonction unique à instrumenter. Le trigger les couvre
tous, aujourd'hui et demain.

**Le cas anonyme, qui est le cas majoritaire.** Rejoindre une file n'exige pas
de compte (F1 : consulter est libre, rejoindre exige le QR et la position). Un
appareil peut donc s'enregistrer **contre l'entrée de file qu'il suit**
(`push_devices.queue_entry_id`). Ce n'est pas une porte nouvelle : dans le
contrat F1 existant, `get_queue_entry_tracking(entry_id)` répond **en anonyme**
à qui détient l'identifiant d'entrée — position, échéance, nom du barber.
Détenir l'identifiant EST la preuve de possession de la place ; l'accepter ici
n'expose aucune information d'une classe nouvelle. Le serveur exige en plus que
l'entrée soit **vivante**, et renvoie le même refus pour une entrée inconnue ou
terminée (une réponse distincte permettrait de les énumérer).

**Le rappel de B2 a enfin un déclencheur.** Le gabarit `booking_reminder`
existait en base depuis le 4 septembre et **rien ne l'appelait**. Il part
maintenant deux heures avant le rendez-vous, une seule fois, sur les
réservations **confirmées** uniquement — une demande en attente n'est pas un
rendez-vous, et lui envoyer un rappel serait une promesse fabriquée.
L'idempotence ne coûte aucun registre supplémentaire : la présence de la ligne
`<rendez-vous>:booking_reminder:customer` dans `email_outbox` EST la marque.

### 3.3 Le moment de la permission

**Jamais à l'ouverture.** Sur iOS, un refus est définitif : le système ne repose
jamais la question, et l'application ne peut plus qu'envoyer le client dans les
Réglages. Demander avant qu'il sache ce que FadeUp fait, c'est échanger la
valeur de tout le canal contre rien.

La question est posée **juste après avoir rejoint une file**, et nulle part
ailleurs. La décision vit dans un module pur (`decidePermissionMoment`, 6 tests) :
la seule porte est `justJoinedQueue`, l'état système prime sur la mémoire de
l'application (une application réinstallée a oublié ; iOS, non), et la question
n'est jamais posée deux fois.

Le texte de la feuille dit **ce que le client y gagne** :

> **On vous prévient quand c'est votre tour**
> Rangez votre téléphone. On vous appelle dès que le salon est prêt pour vous —
> vous n'avez plus à surveiller l'écran.
> *Rien d'autre : ni offres, ni actualités. Vous choisirez le reste dans votre
> compte.*

**Un refus ne retire rien** : l'écran de suivi garde son comportement de M1b
(il reste éveillé, la position se rafraîchit), et l'application reste pleinement
utilisable. Dans le compte, l'état « refusé par le système » est **dit**, avec
le seul geste qui marche (ouvrir les Réglages) — plutôt que quatre interrupteurs
qui mentent (capture `53`… voir §7.3 : c'est l'état que rend la campagne).

### 3.4 Préférences par catégorie, et ce qu'elles gouvernent

`notification_push_preferences` : une ligne par compte, quatre interrupteurs,
défauts `queue_call`/`booking_response`/`appointment_reminder` actifs et
`social_post` **opt-in**. L'absence de ligne **vaut les défauts** : aucun
backfill, et un compte créé après ce lot se comporte comme un compte créé avant.

MASTER_SPEC §13 exclut le transactionnel des préférences. Le lot tranche
autrement, et l'assume : **ces interrupteurs ne gouvernent que le PUSH**. Couper
l'appel de file fait taire l'écran verrouillé ; **la notification in-app et
l'e-mail transactionnel partent quoi qu'il arrive**. L'information n'est jamais
retenue — seule la sonnerie l'est. iOS ne propose au client qu'un tout-ou-rien ;
une préférence par catégorie est strictement meilleure que ce tout-ou-rien, et
l'écran l'explique en une phrase.

**Une garde structurelle** : la catégorie est lue sur le **gabarit**, pas sur
l'appelant. Un émetteur ne peut donc pas déguiser un post en appel de file pour
contourner une préférence ou les heures calmes. Le test le vérifie.

### 3.5 Heures calmes

**08:00–21:00 dans le fuseau du lieu concerné**, c'est-à-dire **la fenêtre
exacte** que B2 applique à la prospection (`enqueue_prospect_outreach`). Une
seconde politique d'heures calmes serait une divergence, pas un choix.

Appliquées **par différé, pas par annulation** : un nouveau post reste
intéressant à 8 h du matin. `queue_call` passe **à toute heure** — le client est
dans le salon, debout.

**Ce que le lot n'invente pas** : le fuseau du destinataire. `profiles` ne porte
pas de pays, et il n'existe aucun contrat de fuseau client. Les heures calmes
sont donc évaluées dans le fuseau du **lieu** (`locations.timezone`, renseigné
sur les 152 lieux de production), à défaut `Europe/Paris` — le marché de
lancement, comme `private.prospect_timezone`. **Approximation déclarée** : un
client français en voyage au Japon recevra un post à une heure locale
inattendue. Un repli sur UTC serait pire ; inventer un fuseau client serait une
donnée fabriquée.

### 3.6 La trace

`push_outbox` **est** la trace, et elle répond aux quatre questions : **quoi**
(`category`, `type`, `template_key`, `title`, `body`), **à qui** (`device_id`,
`user_id`, dénormalisé pour survivre à une révocation ou à un effacement RGPD),
**quand** (`created_at`, `dispatched_at`, `sent_at`), **avec quel résultat**
(`status`, `provider_ticket_id`, `last_error`). Les jetons morts restent
visibles : `push_devices.revoked_at` + `revoked_reason`, jamais un DELETE.

Aucune de ces tables n'est lisible par un client : RLS activée **et forcée**,
une seule policy de lecture pour l'administration de plateforme, verbes clients
révoqués — le régime exact d'`email_outbox`.

---

## 4. Ce qui n'a pas pu être testé, et pourquoi

### 4.1 Le verrou, plus dur qu'annoncé

Le prompt prévoyait « Expo Go a ses limites ». La documentation Expo est plus
nette que cela :

> « In SDK 53 and later, **Expo Go does not support push notifications
> functionality**, so to test push you should use a development build. »

Nous sommes en SDK 57. **Le push distant n'existe pas dans Expo Go**, ni sur
iOS ni sur Android. Un build de développement exige une signature, donc un
profil de provisionnement, donc la licence Apple. Il s'y ajoute une clé APNs,
qui vient du même compte.

Un second verrou, **indépendant d'Apple** : `getExpoPushTokenAsync` exige un
identifiant de projet Expo (`extra.eas.projectId`). Il n'existe pas. Le compte
Expo est **gratuit** et n'a rien à voir avec Apple — c'est un `eas init` à faire
par le fondateur, listé en §12.

**Conséquence** : aucun jeton d'appareil ne peut être obtenu aujourd'hui, donc
aucune notification ne peut arriver sur un téléphone. Ce n'est pas simulé, ce
n'est pas contourné, et rien dans l'application ne prétend le contraire.

### 4.2 Ce qui a été testé quand même — et c'est beaucoup

**Le transport, contre le VRAI fournisseur, depuis la base de production.** Une
sonde `net.http_post` vers l'API push d'Expo avec un jeton volontairement
invalide :

```
code=200
{"data":[{"status":"error",
          "message":"\"ExponentPushToken[m1ca-probe-invalid]\" is not a valid Expo push token",
          "details":{"error":"DeviceNotRegistered","expoPushToken":"…"}}]}
```

(`docs/reports/artifacts/m1ca/expo_probe_production.txt`)

Cela prouve trois choses : la base de production **atteint** Expo par pg_net ;
la forme de la réponse est **exactement** celle que la réconciliation lit
(`data->0`, `details->>'error'`) ; et un jeton mort est bien signalé comme
`DeviceNotRegistered`. Il ne manque que le dernier saut, APNs → téléphone.

**La machine complète, sur restauration fidèle de la production puis en
production** : 69 contrôles, 69 PASS (§7.1), dont la dépêche, la réconciliation
d'un ticket `ok`, la révocation d'un jeton sur `DeviceNotRegistered` **au ticket
ET au reçu**, le non-réessai d'un jeton mort, le non-envoi à un appareil
révoqué. Les réponses du fournisseur y sont **synthétisées** dans
`net._http_response` : c'est la seule façon d'éprouver la réconciliation sans
appareil, et le fichier de test le dit en tête.

### 4.3 La liste exacte de ce qui reste à vérifier en M1c-b

1. **Obtention d'un jeton** `ExponentPushToken[…]` sur un iPhone réel, dans un
   build de développement, après `eas init`.
2. **Arrivée** des quatre notifications sur un téléphone **verrouillé** — c'est
   la seule vérification qui ferme vraiment l'appel de file.
3. **Le rendu système** : titre, corps, `interruptionLevel: time-sensitive`
   pour l'appel de file (posé dans la dépêche, jamais vu à l'œuvre).
4. **Le routage au toucher**, y compris application tuée
   (`getLastNotificationResponseAsync`) — la logique est pure et testée, le
   liant `expo-router` ne l'est pas.
5. **L'invite système de permission** elle-même, et le fait qu'un refus ne
   revienne jamais.
6. **La révocation d'un jeton mort de bout en bout** : désinstaller
   l'application, envoyer, vérifier que le reçu retire le jeton.
7. **Le multi-appareils réel** : deux téléphones, un compte, deux arrivées.
8. **L'e-mail de rappel** : le quota Resend quotidien est épuisé en production
   (défaut M1b, toujours ouvert) — la ligne d'outbox part, l'e-mail non.

---

## 5. Le hors-ligne

**Ce qui s'affiche** : les réservations à venir et l'historique, plus les
demandes d'intérêt. Ce sont des faits stables.

**Ce qui est masqué** : la **position dans la file**, sans condition. Et pas
seulement « non rafraîchie » : la garde est explicite
(`deriveBookingsConnectivity → showQueue: false`), parce que le cache mémoire de
TanStack Query garde la dernière position reçue et l'aurait affichée. Un chiffre
vieux de dix minutes envoie un client au salon alors qu'il a déjà été appelé et
manqué : il perd sa place, et c'est nous qui le lui aurons fait perdre.

**Comment la persistance est bornée** : une **liste blanche par préfixe de clé**
(`shared/data/persistence.ts`), pas un cache général — un cache général est
exactement ce que la décision du fondateur interdit. Trois préfixes seulement :

```
bookings/list                 mes réservations et mon historique
bookings/interest-requests    mes demandes d'intérêt
passport                      RÉSERVÉ — la place du Fade Passport (prompt §4)
```

Tout le reste disparaît à la fermeture : file, créneaux, barbers, alternatives,
découverte, fil. Une clé **inconnue n'est pas persistée** : l'oubli va dans le
sens de la sûreté. Neuf tests l'éprouvent sur les **vraies** clés du produit, de
sorte qu'un lot qui renommerait une clé fera échouer la suite.

**La place du Passport est prévue, pas simulée** : le préfixe est dans la liste
blanche et commenté ; aucune donnée de Passport n'est inventée. Une carte qu'on
présente au comptoir n'a aucun intérêt si elle exige du réseau.

**Ce qui est DIT** : « Hors connexion — dernière mise à jour à 17:47. Votre
position dans la file n'est pas affichée : elle change en permanence. » Une
donnée sans âge affiché est une donnée qui se fait passer pour fraîche. Si
l'heure est inconnue, une seconde formulation le dit — jamais « à --:-- ».

**La reprise** : automatique et déjà en place depuis M1a/M1b — `onlineManager`
de TanStack Query est alimenté par NetInfo, `refetchOnReconnect` est posé, et le
retour au premier plan déclenche un refocus. Le client n'a rien à faire. La
persistance ajoutée par ce lot n'y change rien : au retour du réseau, la donnée
persistée est immédiatement remplacée par la donnée fraîche.

**Un défaut corrigé en chemin** : le bandeau hors connexion se pose en absolu
par-dessus l'écran (choix M1b, imposé par react-native-screens) et **mangeait le
titre** de l'onglet Réservations — invisible en M1b, où l'écran hors ligne était
un bloc centré. Constaté à la capture, corrigé par une réserve de place.

---

## 6. La migration, et la procédure suivie

Deux fichiers, appliqués **en production** :

```
db/migrations/20260912100000_m1ca_push_notification_types.sql
db/migrations/20260912100100_m1ca_push_delivery.sql
db/migrations/down/20260912100000_m1ca_push_notification_types.down.sql
db/migrations/down/20260912100100_m1ca_push_delivery.down.sql
db/tests/verify_m1ca.sql
```

**Pourquoi une migration était nécessaire** : enregistrer un jeton d'appareil,
tenir des préférences par catégorie et tracer un envoi n'existaient nulle part.
M1b avait livré des préférences **locales à l'appareil** en disant qu'aucun
contrat serveur n'existait. Il existe.

### Procédure, dans l'ordre

1. **Sauvegarde** : `pg_dump -Fc` complet de la production en `supabase_admin`,
   avant toute écriture → `/opt/fadeup/backups/pre-m1ca-20260912-170719.dump`
   (4,3 Mo).
2. **Bac d'essai sur restauration FIDÈLE** : `db/tests/b3_restore_sandbox.sh`
   (conteneur jetable, même image, `pg_restore` **sans** `--no-owner`, en
   `supabase_admin`) — 18 rôles reproduits, 0 erreur de restauration,
   propriétaires conservés (110 objets `postgres`, 39 `supabase_admin`).
3. **Application en `postgres`, et non en `supabase_admin`** : c'est le
   propriétaire des objets comparables (`email_outbox`, `run_email_delivery`,
   `queue_entries`). Une première passe en `supabase_admin` a été **défaite et
   rejouée** pour cette raison : `supabase_admin` est superutilisateur, et des
   fonctions `security definer` possédées par un superutilisateur auraient
   masqué tout privilège manquant (leçon B5).
4. **Retour arrière testé sur le bac** : `up → down → up`, puis comparaison de
   `pg_dump -s` d'avant et d'après. **Diff de 5 lignes**, toutes attendues : les
   trois étiquettes d'enum ajoutées à `notification_type`. Artefact :
   `docs/reports/artifacts/m1ca/rollback_diff_T0_vs_T2.txt`.
5. **Suite de vérification sur le bac** : 69 PASS, 0 FAIL.
6. **Application en production**, même ordre, 0 erreur.
7. **Suite de vérification en production** : 69 PASS, 0 FAIL, **rien de
   commité** (transaction + rollback final). Artefacts
   `verify_m1ca_sandbox.txt` et `verify_m1ca_production.txt`.
8. **`grant execute` explicites** : `register_push_device` et
   `revoke_push_device` à `anon` + `authenticated` ;
   `get_my_notification_preferences` et `set_my_notification_preference` à
   `authenticated` **seul** ; `run_push_maintenance` à `fadeup_scheduler`
   **seul**. Aucune fonction `private` du lot n'est exécutable par un rôle
   client. Vérifié sous les rôles réels, pas en `postgres` (leçon B5).
9. **Tick vérifié sous le rôle du scheduler** en production :
   `set role fadeup_scheduler; select … from public.run_push_maintenance();`
   → `0|0|0|0|0|0`. Le grant est bon, et le tick est inerte tant qu'aucun
   appareil n'est enregistré.
10. **Résidus** : aucun. Contrôlé après la suite — 0 organisation `m1ca%`,
    0 compte `qa_m1ca%`, 0 `push_devices`, 0 `push_outbox`, 10 gabarits (les
    données du lot, voulues).

### Ce que le retour arrière ne peut pas défaire

**PostgreSQL ne sait pas retirer une valeur d'un enum.** Les trois étiquettes
ajoutées à `notification_type` (`queue_called`, `booking_reminder`,
`post_published`) survivent au retour arrière. Elles sont **inertes** : plus
aucune fonction ne les produit, aucune contrainte ne les exige. Le fichier de
retour arrière le dit et ne fait pas semblant (même constat qu'en F1b pour
`queue_grace_removed`).

Le retour arrière est **atomique** (une seule transaction) et **restaure
`private.emit_booking_notification` à l'octet près** — corps repris de
`pg_get_functiondef` sur la production, commentaires compris. C'est la seule
pièce du lot qui **modifie** un objet existant, donc la seule dont le retour
arrière ne se réduit pas à un `DROP`.

### Le tick n'est PAS encore branché en production

`infra/scheduler/tick.sh` est **monté depuis le dépôt principal**
(`/opt/fadeup/infra/scheduler/tick.sh`), et **aucune fusion n'a lieu ici**. Le
push ne partira donc qu'après fusion **et** recréation du conteneur
`fadeup-scheduler`. C'est l'état sûr : aucun appareil n'est enregistré, donc il
n'y a rien à envoyer. À faire après fusion :

```
docker compose -f infra/scheduler/docker-compose.yml up -d --force-recreate
```

---

## 7. Validation

### 7.1 Base

| Contrôle | Résultat |
| --- | --- |
| `verify_m1ca.sql` sur restauration fidèle | **69 PASS / 0 FAIL** |
| `verify_m1ca.sql` en production | **69 PASS / 0 FAIL**, rien de commité |
| Retour arrière `up → down → up` | schéma identique **à 3 étiquettes d'enum près** |
| Sonde réelle API Expo depuis la production | 200, forme de réponse conforme |
| Tick sous `fadeup_scheduler` en production | `0|0|0|0|0|0` |

Les chantiers de la suite : jetons (10 contrôles), préférences (4), événements
(9), heures calmes (4), gabarits (3), rappel (6), **nouveau post (6)**,
transport (11), privilèges (8), RLS (3). Les heures calmes sont éprouvées **sans coder aucune heure** : le
test cherche un fuseau actuellement en heure calme et un fuseau actuellement en
journée, puis vérifie les deux comportements — il donne donc le même verdict à
3 h du matin et à midi.

### 7.2 Mobile

| Contrôle | Résultat |
| --- | --- |
| `tsc --noEmit` | **0 erreur** |
| `vitest run` | **202 tests / 25 fichiers**, tous verts (163 en M1b, +39) |
| `expo lint` | **0 erreur**, 6 avertissements **préexistants** (fichiers copiés du web, `i18n/index.ts`) |
| `npm run check:drift` | **vert** — avant ET après (§8) |
| `expo export --platform ios` | bundle Hermes **5,9 Mo**, 0 erreur |
| `expo export --platform web` | 0 erreur (véhicule de QA) |

Tests neufs : `permissionMoment` (9), `pushAvailability` (8), `notificationRoute`
(6), `connectivity` (7), `persistence` (9), `mobileCatalog` (3, garde anti-clé
i18n brute).

### 7.3 Vérification visuelle

**Expo Go sur iPhone réel : NON FAIT — aucun appareil iOS n'est accessible à
cette session.** C'est la même limite qu'en M1a et M1b, et elle est
irréductible ici. Substitut, identique au leur : rendu **web** du même code
(react-native-web), Chromium 390 px, **données de production réelles**, FR et
EN.

Six captures, dans `docs/reports/artifacts/m1ca/` — **vérifiées présentes sur
le disque avant d'écrire cette ligne** :

| Capture | Ce qu'elle montre |
| --- | --- |
| `50-account-notifications-fr-390.png` / `-en-` | Les quatre catégories, **lues en base** par `get_my_notification_preferences`, et l'état « refusé par le système » avec son unique geste utile |
| `51-bookings-online-fr-390.png` / `-en-` | Réservations en ligne : à venir + historique |
| `52-bookings-offline-fr-390.png` / `-en-` | **Hors connexion** : bandeau, mention « dernière mise à jour à 17:47 », à venir et historique lisibles, **aucune position de file** |

**0 erreur de console, 0 requête en échec** sur toutes les passes.

Deux honnêtetés sur cette campagne :

1. **L'état capturé du compte est « refusé par le système »**, parce que
   Chromium refuse les notifications par défaut. C'est un état **réel** du
   produit — celui d'un client qui a dit non une fois — et c'est le seul que le
   harnais puisse rendre : permission **accordée**, le chemin push du rendu web
   (service worker, clé VAPID) ne rend jamais la main et la passe se bloque.
   Mesuré deux fois, puis assumé et commenté dans le script. La cible du lot est
   iOS, où le chemin est natif — et désormais **borné à dix secondes** (§10.3).
2. **La feuille de permission n'a pas de capture.** Elle ne s'ouvre qu'après
   avoir **réellement rejoint une file**, ce qui écrirait une entrée de file en
   production et déclencherait relation client et suivi automatique. Le lot a
   refusé d'écrire de la donnée opérationnelle pour une image. Sa logique
   d'ouverture est testée (9 tests), son texte est dans les deux catalogues,
   son rendu est à vérifier en M1c-b.

Fixtures de la campagne : un compte jetable, une fiche client et deux
rendez-vous, insérés **triggers désactivés** (`session_replication_role =
replica`) pour ne PAS mettre en file un vrai e-mail de confirmation vers une
adresse inexistante — puis **supprimés**, preuve au §10.5. Scripts versionnés :
`apps/mobile/e2e/m1ca/{fixtures.sql,captures.mjs,cleanup.sql}`.

### 7.4 Non-régression web

| Contrôle | Résultat |
| --- | --- |
| `apps/web` — fichiers modifiés par la branche | **0** (`git diff rebuild/social-first-v2...HEAD -- apps/web` vide) |
| `apps/web` `npm run typecheck` | **0 erreur** |
| `apps/web` `npm test` | **920 tests passés / 1 ignoré**, 104 fichiers, exit 0 |
| `apps/web` `npm run build` | **vert**, 230,7 Ko JS+CSS (budget 240 Ko), `check-entry-graph` conforme |

Les trois ont été lancés dans le worktree, via un lien vers les `node_modules`
du dépôt principal — même commit, même verrou de dépendances, donc mêmes
résultats. Le fait structurant reste que **la branche ne modifie aucun fichier
web** : le diff le prouve directement.

---

## 8. `check:drift`, `apps/web` et `/platform`

**Avant le lot : ROUGE.** Dix dérives, exactement le piège que M1b avait
signalé. Les fusions OS-1, OS-2 et PLAT-2 avaient ajouté, **après M1b**, des
clés de requête (`proKeys` : agenda, catalogue, CRM, équipe), deux motifs de
refus (`force_not_allowed`, `force_reason_required`) et des sections i18n
(agenda, réglages de file, affiches QR) dans `apps/web`.

Ce sont des **ajouts purs** : les copies verbatim du mobile ont été remises à
l'identique et `poster.json` copié pour la première fois. Aucune de ces sections
n'est montée dans le bundle i18n du mobile (pas de surface pro ni d'affiche côté
client) : la copie sert la parité que la garde exige, pas un écran. Premier
commit du lot, avant toute autre chose.

**Après le lot : VERT.** `Logique partagée : aucune dérive avec apps/web.`

**`apps/web` intact** : zéro fichier modifié, prouvé par le diff de branche.
**`/platform` intact** : aucun fichier de `apps/web/src/features/platform*` ni
de route `/platform` n'est touché — même preuve, c'est du web.

---

## 9. Git

- **Branche** `m1ca/auth-push`, créée depuis `rebuild/social-first-v2` (3a2939f).
- **Commits**, dans l'ordre :
  1. `chore(m1ca): resynchronise la logique partagee avec apps/web`
  2. `feat(m1ca): le push, sur le motif exact de email_outbox`
  3. `feat(m1ca): permission au bon moment, preferences en base, hors-ligne borne`
  4. `docs(m1ca): rapport final`
  5. `fix(m1ca): la derniere notification touchee ne doit pas rejouer au demarrage`
  6. `fix(m1ca): la diffusion d'un post est bornee, et enfin testee`
- **Poussée** : oui (§12 pour le détail de l'état).
- **Aucune fusion n'a été effectuée.** Aucun `git add .`, aucun `git add -A`,
  aucun `git reset --hard`, aucun `git clean -fd`, aucun `docker prune`.

---

## 10. Décisions prises seules, et erreurs commises

### 10.1 Décisions

1. **Le push réplique `email_outbox` plutôt que de l'étendre.** Une colonne
   `channel` sur `email_outbox` aurait mélangé deux transports aux échecs
   différents (une adresse invalide se corrige, un jeton mort se retire) et deux
   cardinalités (une adresse par personne, N appareils). Deux tables sœurs, une
   architecture.
2. **Les préférences gouvernent le push et RIEN d'autre**, transactionnel
   compris — divergence assumée avec la lettre de MASTER_SPEC §13, motivée au
   §3.4. L'information n'est jamais retenue.
3. **La catégorie est lue sur le gabarit**, pas sur l'appelant : un émetteur ne
   peut pas contourner une préférence ni les heures calmes.
4. **Heures calmes 08:00–21:00**, la fenêtre de B2 à l'identique, plutôt qu'une
   fenêtre « de nuit » inventée pour le push.
5. **L'appel de file est un trigger**, pas un appel dans une RPC (§3.2).
6. **Un appareil anonyme peut être joint pour l'appel de sa file**, contre
   l'identifiant d'entrée — justifié par le contrat F1 existant (§3.2).
7. **La diffusion d'un post est BORNÉE à 500 insertions par tick**, et le
   budget ne compte que les insertions réelles : au tick suivant, les abonnés
   déjà servis ne coûtent rien, donc la diffusion avance au lieu de repartir
   en boucle. Le registre de fin n'est posé qu'une fois le tour achevé. Sans
   cette borne, un salon à dix mille abonnés tiendrait le tick.
8. **Trois passes de transport** (dépêche, tickets, reçus) plutôt que deux : sans
   les reçus, un jeton mort resterait en base indéfiniment, et l'exigence
   « un jeton devenu invalide doit être retiré » ne serait pas tenue.
9. **La liste blanche de persistance hors ligne est explicite**, et refuse par
   défaut (§5).
10. **L'identifiant de bundle `com.fadeup.app`** posé dans `app.json` (iOS et
   Android) — demandé en cours de lot par le fondateur.
11. **La liste blanche de redirection GoTrue n'a PAS été modifiée** en
    production : aucun gain avant le premier build, surface de redirection
    élargie tout de suite (§2.5). Documenté comme une ligne à appliquer en
    M1c-b.
12. **`database.types.ts` n'a pas été régénéré.** C'est une copie **verbatim**
    du fichier du web sous la garde anti-dérive : le régénérer pour le mobile
    seul rendrait `check:drift` rouge, et le régénérer des deux côtés toucherait
    `apps/web`, interdit ici. À la place, `features/notifications/api/pushClient.ts`
    déclare localement les quatre RPC du lot et fait **un** cast, entièrement
    typé aux appels. **Dette déclarée** : un lot propriétaire d'`apps/web` doit
    régénérer les types des deux côtés, après quoi ce fichier disparaît.
13. **Les préférences locales de M1b ont été supprimées** (`account/prefs.ts`,
    `prefs.test.ts`, `useNotifPrefs.ts`) au profit du contrat serveur. Elles
    n'activaient rien et le disaient ; aucune donnée n'est perdue (l'application
    n'est pas publiée).
14. **Aucun `exp://**` en production** : cela autoriserait l'envoi de jetons de
    session vers n'importe quel serveur de développement Expo (§2.5).

### 10.2 Erreurs commises, déclarées

1. **Migration d'abord appliquée en `supabase_admin`** sur le bac d'essai. Le
   propriétaire correct est `postgres` (celui d'`email_outbox`). Défait par le
   retour arrière, rejoué en `postgres`. Une migration de production appliquée
   par un superutilisateur aurait masqué tout privilège manquant.
2. **Premier retour arrière cassé** : le corps de fonction repris de
   `pg_get_functiondef` n'a pas de `;` final, et le fichier échouait à
   mi-parcours — donc **non atomique** : les fonctions étaient déjà supprimées
   quand l'erreur est survenue. Corrigé, et le retour arrière est désormais
   **une seule transaction**. Découvert au bac d'essai, jamais joué en
   production.
3. **Premier jet du schéma de types élargi écrit en `interface`.** TypeScript
   n'accorde de signature d'index implicite qu'aux **alias de type** : en
   `interface`, le schéma ne satisfaisait pas `GenericSchema`, supabase-js
   résolvait `Args` à `never`, et chaque appel échouait sur « not assignable to
   parameter of type 'undefined' ». Une ligne de correctif, commentée sur place.
4. **Fuseau du post cherché via `barbers.location_id`**, colonne qui n'existe
   pas (`barbers` porte `organization_id` + `staff_profile_id`). Corrigé avant
   toute application.
5. **UUID de fixtures non hexadécimaux** (`m1ca…` contient `m`) : la suite de
   vérification a échoué à sa première exécution. Corrigé.
6. **Première campagne de captures sortie sur l'écran d'onboarding** : la
   fixture de stockage n'avait pas la forme qu'attend `readOnboarding`
   (`completedAt` manquant). Aucune capture fausse n'a été livrée.
7. **Deux passes de captures bloquées** en tentant de rendre l'état
   « permission accordée » dans le navigateur. Cause identifiée (chemin push du
   rendu web), conséquence utile : une **borne de dix secondes** ajoutée à
   l'obtention du jeton, qui protège aussi l'application réelle (§10.3).

### 10.3 Deux défauts trouvés en relisant, et corrigés

1. **`getExpoPushTokenAsync` fait un appel réseau** aux serveurs d'Expo, et la
   documentation le dit. Sans borne, un réseau qui répond mal laisse le geste du
   client sans réponse — constaté au harnais de QA. Borne à dix secondes, échec
   classé `network`, message honnête au client. Test ajouté.
2. **La dernière notification touchée PERSISTE** côté Expo jusqu'à ce qu'on
   l'efface (c'est la raison d'être de
   `clearLastNotificationResponseAsync`). Le branchement racine la lisait à
   chaque montage : **chaque démarrage à froid aurait rejoué la dernière
   notification** et détourné la navigation vers un écran que le client n'a pas
   demandé. Elle est maintenant effacée aussitôt traitée, et l'appel déprécié
   (`getLastNotificationResponseAsync`) remplacé par la version courante.

### 10.4 Défauts de production toujours ouverts (hors périmètre)

Repris de M1a/M1b, non traités ici :

1. **Quota Resend quotidien épuisé** : l'OTP e-mail ne boucle pas en production,
   et l'e-mail de rappel que ce lot déclenche ne partira pas davantage. Le lot
   en tient compte : la campagne de QA se connecte par mot de passe de fixture.
2. **Clé anon périmée dans le bundle de `fade-up.com`** : `apps/web` doit être
   redéployé. La clé courante d'`infra/supabase/.env` répond 200 — vérifié en
   cours de lot.
3. `list_my_followed_organizations` ne renvoie toujours que l'identifiant.
4. **`apps/web/src/lib/queries/notifications.ts` est du code mort** (aucun
   consommateur) et son union de types ne connaît ni les types sociaux de B4,
   ni celui de F1b, ni les trois de ce lot. Sans risque d'exécution — le
   composant rend `row.title`, pas une clé i18n — mais la cloche du web reste
   à câbler, et il faudra alors compléter l'union. Constaté, non corrigé :
   c'est du web.
5. **Le dépôt principal `/opt/fadeup` porte des modifications non commitées**
   d'autres lots (dont `infra/scheduler/tick.sh` côté X2). Ce lot n'y a pas
   touché ; sa propre version de `tick.sh` vit dans la branche. **La fusion
   devra réconcilier les deux ajouts** — ils sont indépendants (X2 ajoute
   `run_email_feedback_maintenance`, M1c-a ajoute `run_push_maintenance`), mais
   ils touchent les mêmes lignes.

### 10.5 Preuve d'absence de résidus

Après la suite de vérification et après la campagne de captures, en production :

```
orgs QA restantes: 0      comptes qa_m1ca%: 0     push_devices: 0
push_outbox: 0            notifications QA: 0     push_templates: 10
```

`push_templates: 10` est voulu : cinq gabarits × deux langues, les données du
lot.

---

## 11. Cases non cochées, avec la raison exacte

- **« L'application se lance dans Expo Go sur un iPhone réel »** — NON :
  aucun appareil iOS accessible à cette session. Substitut : export iOS Hermes
  vert + rendu web. Identique à M1a et M1b.
- **« Vérification manuelle dans Expo Go, documentée écran par écran »** —
  NON, même cause. Six captures du rendu web FR/EN sont livrées à la place.
- **« Notifications réelles de bout en bout »** — IMPOSSIBLE :
  Expo Go n'a plus le push distant depuis le SDK 53, et un build de
  développement exige la licence Apple (§4).
- **« Connexion Google fonctionnelle »** — PARTIEL. Le mécanisme est en place
  et le rapprochement d'identités est prouvé en production, mais le retour dans
  l'application est **bloqué par la liste blanche de redirection** de GoTrue —
  mesuré, documenté, une ligne d'exploitation à appliquer en M1c-b (§2.5).
- **Feuille de permission capturée** — NON : sa seule ouverture exige de
  rejoindre réellement une file, donc d'écrire de la donnée opérationnelle en
  production pour une image. Refusé.

---

## 12. Ce que M1c-b devra faire, dans l'ordre

1. **Prendre la licence développeur Apple** (99 €/an) et créer un compte **Expo**
   (gratuit) ; `eas init` dans `apps/mobile` pour obtenir `extra.eas.projectId`.
   Sans ce dernier, aucun jeton push n'est obtenable — et ce point ne dépend pas
   d'Apple.
2. **Ajouter `fadeup://**`** à `ADDITIONAL_REDIRECT_URLS` et recréer le
   conteneur d'authentification (§2.5), puis rejouer la sonde du §2.2.
3. **Sign in with Apple** : Services ID + clé, `GOTRUE_EXTERNAL_APPLE_*`,
   `expo-apple-authentication`. **Sans lui, la règle 4.8 fait rejeter
   l'application** dès lors que Google est proposé.
4. **Clé APNs** et build de développement signé ; installation sur un iPhone
   réel.
5. **Dérouler les huit vérifications du §4.3**, dans cet ordre : jeton, arrivée
   sur téléphone verrouillé, rendu système, routage au toucher, invite de
   permission, révocation d'un jeton mort, multi-appareils, e-mail de rappel.
6. **Fusionner, puis recréer le conteneur `fadeup-scheduler`** pour que le tick
   du push tourne (§6), en réconciliant l'ajout X2 de `tick.sh`.
7. **Liens universels** : identifiant d'équipe, `apple-app-site-association`
   servi par `apps/web`, `associatedDomains` dans `app.json`.
8. **Régénérer `database.types.ts` des deux côtés** et supprimer la déclaration
   locale de `pushClient.ts` (§10.1-12).
9. **Traiter le quota Resend** avant de compter sur l'e-mail de rappel.
10. **Publication** : seulement après 3, 5 et 7.

---

**Gate R5R rappelé** : ce lot passe la vérification technique accessible à cette
session (base éprouvée sur restauration fidèle puis en production, retour
arrière prouvé, typecheck, 202 tests, lint, drift, export iOS, six captures
propres, non-régression web). Le lancement sur appareil réel, l'arrivée des
notifications et la validation produit restent au fondateur. **Aucune fusion n'a
été effectuée. Fin du rapport.**
