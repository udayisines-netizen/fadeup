# FadeUp — Délivrabilité e-mail : ce qui est prêt, ce que le fondateur doit faire

Écrit par X2 (2026-09-08). Deux chantiers attendent une action qui n'appartient
qu'au fondateur : la **séparation des domaines d'envoi** (BLOCKERS §6) et
l'**activation du webhook Resend** (BLOCKERS §7). Tout le code des deux côtés
est construit, testé et déployé inerte — chaque activation est une
manipulation de tableau de bord plus une ligne.

---

## 1. État des lieux (mesuré)

| Quoi | État | Mesure |
|---|---|---|
| Domaine `contact.fade-up.com` | vérifié chez Resend | envois acceptés depuis B2 |
| Domaine `pro.fade-up.com` | **non vérifié** (dernière mesure fiable : B2, 2026-09-04 → 403 « domain is not verified ») | la sonde X2 du 2026-09-08 n'a pas pu conclure : **429 quota quotidien épuisé** (voir §4) |
| Webhook Resend | **construit, déployé, INERTE** | `POST https://fade-up.com/functions/v1/resend-webhook` → 401 tant que le secret n'existe pas (fail closed, vérifié en production) |
| Retour de délivrabilité | aucun tant que le webhook n'est pas activé | `email_outbox.status = 'sent'` signifie « Resend a accepté », rien de plus |

## 2. Séparer les deux flux d'envoi (BLOCKERS §6)

**Pourquoi.** Transactionnel (liens magiques, confirmations, rappels) et
prospection (relances aux professionnels non revendiqués, e-mail d'information
RGPD) partagent aujourd'hui `contact.fade-up.com`. La réputation se calcule
par domaine : une vague de plaintes sur une campagne de prospection dégrade la
délivrance des liens magiques — **un client qui ne reçoit pas son lien magique
est un client perdu**, à cause d'e-mails qui ne le concernaient pas.

**Ce qui est déjà prêt (B2 + X2).** Les deux flux sont modélisés
(`public.email_streams` : `transactional` / `prospecting`), chaque gabarit
porte son flux, l'e-mail d'information X2 part sur `prospecting`, et les
en-têtes `List-Unsubscribe` ne s'appliquent qu'à la prospection. Le modèle a
été construit pour que la bascule coûte **un UPDATE**.

**Actions fondateur, dans l'ordre :**

1. Tableau de bord Resend → *Domains* → *Add Domain* → `pro.fade-up.com`.
2. Chez le registrar de `fade-up.com`, créer les enregistrements DNS que
   Resend affiche pour ce domaine (les valeurs exactes sont générées par
   Resend au moment de l'ajout — ne pas les inventer d'après ce document) :
   - l'enregistrement **TXT de vérification** du domaine ;
   - les **CNAME/TXT DKIM** (généralement `resend._domainkey.pro.fade-up.com`) ;
   - le **TXT SPF** sur le sous-domaine d'envoi que Resend indique
     (`send.pro.fade-up.com` chez Resend par défaut, avec son MX associé).
3. Recommandé : un enregistrement **DMARC** sur `fade-up.com` s'il n'existe
   pas encore (`_dmarc.fade-up.com`, par exemple `v=DMARC1; p=none; rua=…`
   pour commencer en observation).
4. Attendre le statut *Verified* dans Resend, puis en base, UNE ligne :

   ```sql
   update public.email_streams
   set from_address = 'pro@pro.fade-up.com'
   where stream = 'prospecting';
   ```

5. Preuve : `db/tests/verify_b2.sql` reste vert, et un envoi de prospection
   de test (adresse `@fadeup.test`) part avec le nouveau `from`.

**Tant que ce n'est pas fait** : les adresses distinctes (`bonjour@` / `pro@`)
n'aident en rien la réputation, qui est PARTAGÉE. Le risque documenté de
BLOCKERS §6 reste entier, et l'ordre de publier les prospects l'aggraverait
(premier envoi en masse vers des adresses non vérifiées = rebonds concentrés
sur le domaine des liens magiques). **Recommandation X2 : ne pas donner
l'ordre de publier avant la vérification du second domaine ET l'activation du
webhook ci-dessous.**

## 3. Activer le webhook Resend (BLOCKERS §7)

**Pourquoi.** La clé API est restreinte à l'envoi (voulu) : sans webhook,
FadeUp ne voit ni les rebonds ni les plaintes. Sur un domaine d'envoi neuf, ce
sont exactement les signaux qui protègent la réputation — et une adresse qui
rebondit dur ne doit plus jamais être sollicitée (c'est maintenant automatique
dès que les événements arrivent).

**Ce qui est déjà construit et prouvé (X2).**

- Fonction Edge `resend-webhook` (déployée) : vérifie la signature Svix
  (HMAC-SHA256, comparaison à temps constant, tolérance 5 min), insère
  l'événement brut dans `public.resend_webhook_events` (clé primaire =
  identifiant Svix → idempotence), répond 200. Signature absente/fausse →
  401, **rien n'est écrit**. Sans secret configuré : tout est rejeté.
- Traitement en SQL (`run_email_feedback_maintenance`, cadencé par le
  scheduler, passe séparée) : `email.delivered`/`email.opened` → horodatages
  sur `email_outbox` ; **rebond permanent ou plainte → adresse supprimée
  (`prospect_suppressions` scope `email`) + `do_not_contact` sur le
  prospect**. Rebond transitoire : horodaté, jamais supprimé.
- Testé : signature falsifiée rejetée (rien en base), rejeu sans double
  effet, rebond dur → `do_not_contact` vérifié en base (verify_x2.sql,
  51 assertions, + test conteneur réel).

**Actions fondateur, dans l'ordre :**

1. Tableau de bord Resend → *Webhooks* → *Add Webhook* →
   URL : `https://fade-up.com/functions/v1/resend-webhook`.
   Événements : `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained` (et `email.opened` si souhaité —
   l'ouverture est un signal faible et traqué, il peut rester désactivé).
2. Copier le **signing secret** (`whsec_…`) affiché par Resend, l'ajouter à
   `/opt/fadeup/infra/supabase/.env` :

   ```
   RESEND_WEBHOOK_SECRET=whsec_…
   ```

3. Recréer le conteneur des fonctions (le compose X2 référence déjà la
   variable) :

   ```bash
   cd /opt/fadeup/infra/supabase && docker compose up -d functions
   ```

4. Preuve : dans Resend, envoyer un événement de test sur le webhook → il
   doit répondre 200, et la ligne apparaît :

   ```sql
   select event_id, event_type, status from public.resend_webhook_events
   order by received_at desc limit 5;
   ```

   Un `POST` sans signature doit continuer de répondre 401.

## 4. Constat du 2026-09-08 : le quota quotidien Resend s'épuise en test

La sonde de domaine X2 a reçu `429 — You have reached your daily email
sending quota` : les campagnes de test du jour (238 messages accEPTés vers
`@fadeup.test` acceptés + 196 en file) ont consommé le quota quotidien du compte.
Conséquence réelle : **un lien magique demandé aujourd'hui échouerait**
(GoTrue passe par le même compte Resend). À décider par le fondateur :
passer le compte Resend sur un palier payant avant toute campagne réelle,
et/ou réserver les campagnes e2e massives à un bac sans envoi. Les adresses
`@fadeup.test` ne délivrent jamais (TLD réservé) — chaque envoi de test
consomme du quota pour rien.

## 5. Le désabonnement One-Click (RFC 8058) — livré, rien à activer

La fonction Edge `unsubscribe` est en production :
`https://fade-up.com/functions/v1/unsubscribe/<token>` — GET → redirection
vers la page humaine `/unsubscribe/<token>` (confirmation explicite, aucun
état changé par un GET : les scanners d'e-mails suivent les liens) ; POST
machine (l'en-tête `List-Unsubscribe-Post` des clients mail) → désabonnement
immédiat via la RPC B2, anti-énumération préservée. Les payloads des e-mails
de prospection et d'information pointent cette URL depuis la migration
`20260908150000`. Prouvé en production : GET 303, POST 200, PUT 405.

## 6. La RÉCEPTION — le verrou trouvé par la revue X2 (action fondateur)

**`bonjour@contact.fade-up.com` ne peut pas recevoir de courrier** :
`contact.fade-up.com` n'a ni enregistrement MX ni A (mesuré au dig le
2026-09-08) — le domaine est configuré pour ENVOYER via Resend, pas pour
recevoir. L'apex `fade-up.com`, lui, a des MX (ionos).

Pourquoi c'est LE verrou : cette adresse est le contact du responsable de
traitement sur la page article 14, le canal « source exacte sur demande »
(art. 14(2)(f)), le repli d'erreur du formulaire de retrait, et le
`reply_to` des deux flux d'envoi. Publier des prospects en invitant leurs
destinataires à écrire à une boîte qui rebondit serait pire que ne rien
mettre.

**Actions fondateur, au choix :**

1. créer la boîte `bonjour@fade-up.com` (ou équivalente) chez ionos, poser
   un alias/renvoi, puis remplacer l'adresse dans
   `apps/web/src/shared/i18n/locales/{fr,en}/legal.json` et dans
   `email_streams.reply_to` (deux UPDATE) ; ou
2. poser un MX sur `contact.fade-up.com` vers la messagerie existante et y
   créer/router `bonjour@` et `pro@`.

**Dans les deux cas, la preuve est un e-mail entrant réel, reçu et lu.**
X2 n'a pas changé l'adresse lui-même : afficher une adresse différente sans
savoir si sa boîte existe aurait remplacé un défaut mesuré par un défaut
espéré.

## 7. Rappel — ce que l'activation NE déclenche pas

Activer le webhook et vérifier le domaine ne publie aucun prospect et
n'envoie aucun e-mail : l'ordre de publier reste une décision du fondateur
(X2 §6 — il attend un avis juridique), et l'e-mail d'information ne part
qu'à la publication d'un profil, une seule fois par professionnel.
