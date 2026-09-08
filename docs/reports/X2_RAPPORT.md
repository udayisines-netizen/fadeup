# FadeUp — Rapport final X2 : conformité RGPD avant publication

Branche `x2/gdpr`, créée depuis `rebuild/social-first-v2`.

**DÉCLARATION EN TÊTE.** Le prompt annonçait « migration possible mais pas
attendue » ; il en a fallu **trois** (l'information n'avait aucun support en
base), appliquées en production en rôle `postgres` après bac d'essai fidèle,
retours arrière prouvés ACL comparées (diff vide), sauvegarde préalable
`/opt/fadeup/backups/pre-x2-20260908-063529.dump`. **Aucune fusion.
`/platform` intact, preuve au §8. Aucun e-mail envoyé à une adresse réelle
de professionnel — aucun e-mail envoyé du tout (§6).**

La revue indépendante (`opus-reviewer`, exigée par le CLAUDE.md) a rendu un
verdict initial **ne passe pas** : 1 bloquant, 4 majeurs. Les 4 majeurs sont
corrigés et re-prouvés (§10) ; le bloquant est une action fondateur (DNS/
boîte de réception) consignée comme LE verrou restant (§12).

---

## 1. La page d'information

**`https://fade-up.com/professionals-data`** — publique, sans
authentification (e2e : jamais de redirection `/auth`), indexable
(`robots.txt` autorise, entrée sitemap ajoutée), FR/EN, chunk paresseux.

Neuf sections : qui est responsable (FadeUp + contact) · pourquoi la fiche
existe (finalité, base légale : intérêt légitime 6(1)(f), et le rappel que
rien n'y est inventé) · ce qu'elle contient (catégories de données) · d'où
viennent les données (catégories de sources ; **la source exacte, tracée en
base, est communiquée sur demande** — aucun contrat public ne l'expose par
fiche, dit au §11) · qui y a accès (destinataires, transferts hors UE —
ajouté après revue, 14(1)(e)(f)) · combien de temps (y compris la
conservation de la liste d'opposition après retrait — ajouté après revue) ·
vos droits (accès, rectification, effacement, limitation, opposition,
CNIL) · les e-mails possibles et leur désabonnement · **le formulaire de
retrait** (ancre `#withdraw`, celle des e-mails).

**Comment on l'atteint** : un lien discret « Pourquoi cette fiche existe, et
vos droits » sous l'explication « créé à partir de sources publiques » de
chaque profil `/pro/:handle` **non revendiqué** (condition `isUnclaimed`
existante — le lien est ABSENT d'un profil revendiqué, testé e2e dans les
deux sens) ; depuis l'e-mail d'information (`?pro=<handle>&t=<jeton>`) ;
et directement. C'est aussi la « mesure appropriée » de l'article 14(5)(b)
pour les prospects sans adresse.

**Le formulaire ne dépublie rien** : B2 avait argumenté qu'un retrait public
direct permettrait à n'importe qui de faire disparaître n'importe quel
commerce, et cette raison tient. Le formulaire ENREGISTRE une demande dans
le circuit B2 (`marketplace_withdrawal_requests`) via la RPC anon
`submit_marketplace_withdrawal_request` : l'opérateur vérifie l'identité,
valide, `complete_marketplace_withdrawal` exécute — dépublication +
`do_not_contact` + demandes d'intérêt closes — sous l'engagement des 72 h.
Canaux tracés : `public_form` (non vérifié) et `email_link` (le jeton de
l'e-mail prouve le contrôle de la boîte). Refus nommés :
`professional_is_claimed` (un revendiqué se gère depuis son compte),
`profile_not_published` (revue : rien à retirer, pas d'échéance factice),
`invalid_email`. Idempotent : une seule demande en cours par fiche, la
re-soumission rend la même échéance. Une demande entrée par le canal
OPÉRATEUR n'est jamais révélée au formulaire public (revue) : il reçoit
l'engagement générique.

## 2. L'e-mail d'information

**Distinct de la prospection, et il ne vend rien.** Gabarit
`external_profile_published`, FR et EN, texte brut et HTML, dans
`email_templates` (système B2, aucun second système d'envoi). Contenu :
votre fiche vient d'être publiée, pourquoi (article 14 nommé), ce qu'elle
contient, voir la fiche, vos droits et la source exacte (bouton vers la
page), **retirer la fiche** (72 h nommées), ne plus recevoir d'e-mails.
Une seule phrase mentionne la revendication (« si vous préférez gérer cette
fiche vous-même ») — c'est le chemin de rectification, sans « gratuit et
immédiat », sans bénéfice vanté.

**La preuve qu'il ne vend rien** : `verify_x2.sql` échoue si
sujet+texte+HTML contiennent un mot de
`abonnement|subscription|tarif(s)|pricing|prix|price|offre|offer|essai|trial|promo(tion)|remise|discount|réserver|réservation|booking|book|payant|payment|paiement`
— testé sur les deux locales, plus le rendu réel par
`private.render_email_template` (payload complet, aucun placeholder
orphelin, garde 22023 de B2).

**Déclenchement : à la publication, pas à la première demande.**
`publish_external_professional` appelle
`private.enqueue_publication_information` dans **ses deux branches** — la
branche neuve ET la branche idempotente qui republie aussi (l'oublier
aurait raté l'auto-réparation B1). Idempotent par
`dedupe_key = publication_notice:<professional_id>` : un professionnel est
informé UNE fois, un double-clic ou une republication n'envoie rien.
Après revue, la fonction porte **toutes les gardes de contact de B2**
(`do_not_contact`, suppression prospect, adresse supprimée → pas d'e-mail,
trace `public_page_only`) et les **heures calmes** 08:00–21:00 locales
(`next_attempt_at` posé au prochain matin — la publication n'attend pas,
l'e-mail si).

**La trace** : `professional_information_notices` — une ligne par
(professionnel, canal) : quand, à quelle adresse, par quel canal ; le
RÉSULTAT se lit en joignant `email_outbox` (status, `sent_at`,
`provider_message_id`, puis `delivered_at`/`bounced_at` du webhook), jamais
dupliqué. Lecture réservée platform-admin. Le retour arrière REFUSE de
détruire ces traces si elles existent (garde forçable, revue §mineur 8).

## 3. Le cas sans e-mail

`enqueue_prospect_outreach` de B2 avait rencontré ce mur (zéro envoi sur un
prospect sans adresse). Ici : **la publication reste possible** — testé, la
fonction publie et enregistre une trace `channel = 'public_page_only'` qui
PROUVE que le cas a été vu, pas oublié. L'article 14(5)(b) prévoit
exactement cela : quand l'information directe demande un effort
disproportionné, une mesure appropriée la remplace — une information
publiquement accessible. C'est le rôle de la page : atteignable depuis la
fiche elle-même (le seul endroit où la personne se découvrira), indexable,
avec le retrait à un formulaire de distance.

## 4. Le webhook Resend

**Point d'entrée** : `https://fade-up.com/functions/v1/resend-webhook` —
fonction Edge sur le modèle exact du stripe-webhook B3 : trois gestes,
signature → validation de forme → INSERT, tout le traitement en SQL.

**Signature** : Svix (le signataire de Resend) — HMAC-SHA256 sur
`svix-id.svix-timestamp.corps brut`, clé = base64-décodé du secret
`whsec_`, comparaison à temps constant, tolérance 5 minutes,
multi-signatures de rotation. Vérifiée AVANT toute écriture ; falsifiée,
absente, périmée ou corps altéré → 401, rien en base (testé sur conteneur
edge-runtime jetable avec signatures calculées en face, et la revue a
rejoué le vecteur de test officiel Svix : MATCH). **Sans secret configuré,
tout est rejeté (fail closed)** — vérifié en production : la fonction est
déployée INERTE, 401 sur tout, zéro ligne écrite, en attendant que le
fondateur crée le point de terminaison (§5).

**Idempotence** : clé primaire = identifiant Svix de l'événement
(`resend_webhook_events.event_id`), insertion `ignore-duplicates` — un
rejeu Resend est un non-événement (testé : rejeu → une ligne, zéro
retraitement). Le journal garde tous les événements reçus, statut par
statut (`queued/processed/skipped/failed`), lecture platform-admin.

**Effet d'un rebond** : la passe scheduler `run_email_feedback_maintenance`
(appel psql SÉPARÉ dans tick.sh, même règle de rayon d'explosion que F1b)
applique : `email.delivered`/`opened` → horodatages sur `email_outbox` (la
machine d'état B2 reste intacte — `sent` garde son sens) ;
**rebond PERMANENT ou plainte → adresse inscrite dans
`prospect_suppressions` (scope `email`, normalisée en minuscules) +
`do_not_contact` sur les prospects porteurs** — l'adresse ne sera plus
jamais sollicitée, et `publication_block_reason` interdit déjà la
republication. Un rebond transitoire est horodaté, jamais supprimé. Après
revue : horodatage défensif (un `created_at` malformé ne perd plus
l'événement) et reprise des `failed` tant que `attempts < 5` (un deadlock
ne perd plus un rebond dur). Le tout : verify_x2, 59/59 en production
(rollback).

## 5. La séparation des flux

**Prêt** : les deux flux restent modélisés (`email_streams`), chaque gabarit
porte le sien, l'e-mail d'information part sur `prospecting` (c'est une
question de RÉPUTATION, pas de contenu : ses destinataires n'ont rien
demandé), les en-têtes `List-Unsubscribe`/`-Post` s'appliquent à la seule
prospection, et la bascule coûte UN UPDATE.

**Ce que le fondateur doit faire** — documenté pas à pas dans
`docs/frontend/EMAIL_DELIVERABILITY.md` : §2 ajouter `pro.fade-up.com`
chez Resend, créer les enregistrements DNS que Resend génère (TXT de
vérification, DKIM, SPF du sous-domaine d'envoi, DMARC recommandé),
attendre *Verified*, puis
`update email_streams set from_address='pro@pro.fade-up.com' where stream='prospecting';` ;
§3 créer le webhook Resend (URL, événements, secret dans
`infra/supabase/.env`, `docker compose up -d functions`, preuve) ; §6 la
**réception** (voir §12 — le bloquant de la revue).

**Le risque, pas masqué** : un seul domaine vérifié aujourd'hui. La
re-sonde X2 n'a pas pu conclure — 429, quota quotidien épuisé (§11.3) ; la
dernière mesure fiable reste le 403 de B2. Tant que le second domaine
n'est pas vérifié, prospection et liens magiques partagent leur
réputation, et X2 recommande de **ne pas donner l'ordre de publier avant**
(BLOCKERS §6 mis à jour).

## 6. E-mails envoyés pendant le développement

**Zéro.** Dans le détail :
- tous les tests SQL (verify, 59 assertions) tournent en transaction
  ROLLBACK — leurs mises en file n'ont jamais existé ;
- la campagne e2e X2 n'envoie rien (le retrait n'émet pas d'e-mail) ;
- les tests du webhook n'écrivent que des événements (nettoyés,
  `resend_webhook_events` = 0 en prod) ;
- deux SONDES de domaine (chantier 4) ont tenté un envoi vers
  `qa-x2-probe@fadeup.test` (adresse morte, TLD réservé) — les deux
  refusées `429 quota` par Resend : **rien n'est parti** ;
- vérifié en fin de lot : aucune ligne `external_profile_published` dans
  `email_outbox`, aucune notice, aucune demande de retrait résiduelle.

Les 196 messages `queued` et 238 `sent` du jour vers `@fadeup.test`
appartiennent aux campagnes des lots parallèles, pas à X2 — mais ils ont
épuisé le quota Resend (§11.3).

## 7. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (tsc -b + tsconfig.v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint + garde palette) | **0 erreur** (avertissements préexistants inchangés) |
| `npm run test` (Vitest) | **695/695, 80 fichiers** (base 687 + 8 X2 : parseurs de référence et de refus) |
| `verify_x2.sql` | **59/59** — bac d'essai fidèle ET production (rollback) ; up idempotent rejoué, downs appliqués, **diff ACL avant/après down : VIDE** |
| `npm run e2e` (campagne complète, isolée des autres lots) | **228 passés, 3 échecs, 2 flaky, 1 sauté, 10 non exécutés (40,4 min)** — les 3 échecs analysés au §11.2 : 1 collision avec ma propre édition en cours de campagne (spec x2 rejouée après stabilisation : **14/14**), 2 = quota Resend épuisé (F4 OTP, cause mesurée dans GoTrue : `550 daily quota`, hors X2) ; les 10 « non exécutés » = la suite du fichier F4 en mode serial |
| axe (`@axe-core/playwright`) | **aucune violation sérieuse ou critique** — pages information et désabonnement × 2 largeurs |
| `probe_public_rpcs.sh --strict` | **toutes 200** (la RPC d'écriture X2 ne se sonde pas — doctrine F1b, commentée dans la sonde) |
| `x3_anon_surface.sh --strict` | **TOUT PASSE** — `submit_marketplace_withdrawal_request` consacrée dans l'allowlist ; une lacune de la suite corrigée en la nommant (§11.1.d) |
| Webhook (conteneur jetable + prod) | falsifiée/absente/périmée/corps altéré → **401, rien en base** ; valide → 200 ; rejeu → **1 ligne, 0 retraitement** ; rebond dur → `do_not_contact` **vérifié en base** ; prod : 401 fail-closed, scheduler healthy |
| One-Click (prod) | GET → 303 page humaine · POST → 200 · PUT → 405 · sans jeton → 400 |
| Vérification navigateur réelle | 5 pages × 3 largeurs (390/430/1440) : **zéro erreur console, zéro requête en échec** (seul l'avertissement dev `HydrateFallback`, préexistant sur toutes les pages) ; captures inspectées |
| Chunks | pages legal en chunks paresseux ; entrée consumer ≈ 101 Ko gzip (index 44,6 + vendor-react 56,4), budget 180 Ko tenu |
| WebKit | non exécutable sur cet hôte (BLOCKERS §2, inchangé) |

## 8. `/platform` intact — preuve

- `git diff --name-only $(git merge-base HEAD rebuild/social-first-v2)` :
  **zéro** fichier sous `apps/web/src/{pages,routes,components,lib}` (les
  surfaces legacy) — seul `shared/lib/database.types.ts` (régénéré,
  purement additif : 0 suppression, vérifié ligne à ligne).
- Production : `GET http://127.0.0.1:15180/platform/login → 200`.
- Les migrations n'altèrent aucun contrat que `/platform` consomme :
  `publish_external_professional` garde sa signature et ses retours ;
  `request/complete/list_marketplace_withdrawal_requests` inchangées ; tout
  le reste est additif.

## 9. Git

- Branche `x2/gdpr` depuis `rebuild/social-first-v2`, **7 commits, poussés**
  (`origin/x2/gdpr`). **Aucune fusion.** Aucun `git add .`/`-A`, aucun
  `reset --hard`, aucun `clean`, aucun `docker prune`.
- Commits : db (migrations + verify + sondes + types + dump) · infra
  (webhook + compose + tick.sh, puis le fichier de fonction avec son
  exception .gitignore — voir §10 erreurs) · feat (pages + i18n + lien) ·
  e2e · fix (durcissements de la revue) · docs (BLOCKERS +
  EMAIL_DELIVERABILITY + ce rapport).
- **Copies de déploiement non commitées dans `/opt/fadeup`** (motif B3,
  byte-identiques aux fichiers commités — vérifié au diff) :
  `docker-compose.yml`, `tick.sh`, `volumes/functions/resend-webhook/`,
  `volumes/functions/unsubscribe/` ; elles se résorberont à la fusion.

## 10. Décisions prises seules — et toute erreur commise, déclarée

### La revue indépendante, et ce qu'elle a changé

Verdict initial : **ne passe pas** — 1 bloquant, 4 majeurs, 13 mineurs.
Corrigés avant ce rapport (migration `20260908150000`, re-prouvée bac +
prod 59/59) :

1. **M1** — l'e-mail d'information partait SANS les gardes de contact de
   B2 : un re-clic Publier sur un profil public dont le prospect s'était
   désabonné mettait en file un e-mail vers l'adresse qui a dit non
   (prouvé par la revue en rollback). Corrigé (gardes complètes →
   `public_page_only`) + testé (scénario exact reconstruit dans verify).
   Et la garde de non-republication que j'avais écrite divergeait du garde
   authoritatif (elle ignorait `suppressed_email`) : les deux branches
   partagent désormais UNE définition (`publication_block_reason`).
2. **M2** — le formulaire acceptait une fiche non publiée (échéance 72 h
   factice chez l'opérateur), ma garde de volume « 200/24 h » était
   mathématiquement inatteignable (l'index « une pending par
   professionnel » plafonne bien avant) et, globale, aurait fermé le canal
   d'opposition aux personnes légitimes — RETIRÉE en le disant ; et
   `already_pending` révélait l'existence d'une demande opérateur.
   Corrigés, testés.
3. **M3** — un événement webhook passé `failed` était perdu POUR TOUJOURS
   (rien ne relisait ce statut) et un `created_at` malformé levait.
   Corrigés (reprise `attempts < 5`, cast défensif), testés.
4. **M4** — le One-Click RFC 8058 : l'en-tête pointait une SPA qui ne
   traite pas le POST machine. Fonction Edge `unsubscribe` livrée et
   prouvée en prod (§4, §7) ; BLOCKERS §14.1 passé RÉSOLU.
5. Mineurs traités : sections destinataires/transferts + durée réelle
   (14(1)(e)(f)) ; état d'erreur du préremplissage (fiche retirée
   entre-temps) ; focus sur la confirmation ; `on conflict` sur la branche
   de course ; down qui refuse de détruire les preuves de conformité ;
   locator e2e scopé. Non traités, à dessein : locale par pays (un
   germanophone suisse recevra du français — repli B2 documenté), liste de
   mots interdits sans `revendiquer` (c'est le chemin de RECTIFICATION,
   une phrase sèche — assumé, dit ici), le sitemap périmé (hors périmètre,
   BLOCKERS §14.4).
6. **Le bloquant B1 de la revue n'est PAS corrigeable en code** :
   `bonjour@contact.fade-up.com` ne peut pas RECEVOIR (domaine sans MX —
   mesuré). J'ai choisi de NE PAS remplacer l'adresse par une autre dont
   j'ignore si la boîte existe : ç'aurait été troquer un défaut mesuré
   contre un défaut espéré. Documenté comme LE verrou (§12, BLOCKERS
   §14.5, EMAIL_DELIVERABILITY §6).

### Décisions

1. **Le formulaire public enregistre une DEMANDE, il ne retire pas** — la
   réconciliation entre le prompt (« formulaire de retrait branché sur le
   chemin de B2 ») et l'interdit écrit de B2 (pas de retrait public
   direct). Le jeton de l'e-mail (`email_link`) donne à l'opérateur la
   preuve du contrôle de boîte sans RIEN automatiser.
2. **Le flux de l'e-mail d'information = `prospecting`** : question de
   réputation, pas de contenu — ses destinataires n'ont rien demandé, ses
   rebonds ne doivent jamais toucher le domaine des liens magiques.
3. **Deux corrections non demandées, sur le chemin du lot, déclarées** :
   `profile_url` des e-mails B2 pointait `/p/…` (404 — la route est
   `/pro/:handle`), et la branche idempotente de publication pouvait
   republier un profil retiré d'un clic. Un lot RGPD qui laisse ces deux
   défauts n'a pas fait son travail.
4. **Une notice par professionnel, pour toujours** (dedupe) : l'article 14
   s'exécute une fois ; une republication n'est pas une re-collecte.
5. **Locale de la notice** : pays FR/BE/LU/MC/CH → fr, sinon en (le rendu
   B2 replie vers fr de toute façon).
6. **`post_likes` ajouté à l'allowlist X3** (§11.1.d) — une politique B4
   voulue (« likes publics »), pas une régression.
7. **Le down du lot refuse de détruire les preuves** (notices + demandes) —
   garde forçable pour les bacs d'essai.

### Erreurs commises, déclarées

1. **Les 4 majeurs de la revue étaient MES défauts** — le plus grave : M1,
   un e-mail possible vers une adresse désabonnée, la violation exacte de
   la promesse « le désabonnement est définitif » de B2, sur le lot chargé
   de la conformité. Corrigés et re-testés, mais ils ont existé.
2. **J'ai édité la page pendant la campagne e2e complète** (le serveur dev
   sert à chaud) : le spec x2 chargé au départ attendait 8 sections, la
   page en rendait 9 → 1 échec desktop fabriqué par moi. Repéré, prédit
   avant le verdict, spec rejouée isolément : 14/14. Leçon : geler les
   surfaces sous test pendant une campagne.
3. **Un `git commit --amend` mal ciblé** a brièvement réécrit le commit
   e2e avec le message infra (rien n'était poussé) — historique refait
   proprement en deux commits, déclaré ici.
4. **Ma garde de volume initiale était du théâtre** (inatteignable, et
   nuisible si atteinte) — voir M2.
5. La sonde de domaine du chantier 4 a tenté DEUX envois réels (vers une
   adresse morte `@fadeup.test`) sans vérifier d'abord le quota — refusés
   429, aucun envoi, mais l'ordre des opérations était le mauvais.

## 11. Cases non cochées / constats, avec la raison exacte

### 11.1 Écarts assumés
- **a. « Mentions de l'article 14 »** : structure complète et texte de
  travail posés (y compris destinataires et transferts, après revue) ; les
  mentions DÉFINITIVES relèvent de l'avocat (périmètre §6 du prompt). La
  durée de conservation reste qualitative (« tant que la fiche est
  publiée ») — une durée chiffrée est une décision juridique.
- **b. « Source exacte »** : la provenance est tracée en base
  (`prospect_source_records`) mais aucun contrat public ne l'expose par
  fiche — la page dit « sur demande ». L'exposer par fiche est une
  évolution de contrat à décider (et le canal de demande dépend du verrou
  §12.1).
- **c. BLOCKERS « §8 »** : le prompt demandait §6, §7, §8 — le §8 du
  fichier est le passage Stripe en mode réel, sans rapport avec X2 ; j'ai
  mis à jour §6 et §7 et créé le §14 (les restes X2, cinq points) plutôt
  que de toucher un blocage étranger.
- **d. `x3_anon_surface`** : la suite a viré au rouge EN COURS DE LOT sur
  `post_likes` — un like créé à 07:52 par la campagne M1b
  (`delivered@resend.dev`, post de démo d1de) a révélé que l'allowlist
  couvrait `posts`/`post_media` (politique `can_view_post`) mais pas
  `post_likes`, qui porte LA MÊME politique voulue (« likes publics »,
  MASTER §2). Corrigé dans la suite, en le nommant. Ce n'est pas une
  régression X2 : aucun objet social n'a été touché.
- **e. Vitest 695/695 mais la suite legal a échoué UNE fois entre deux de
  mes commits** (test du code `rate_limited` retiré par le durcissement) —
  corrigé dans la foulée, état final vert.

### 11.2 La campagne e2e complète — les 3 échecs, un par un
- `x2 desktop « structure complète »` : **ma collision** (§10, erreur 2) —
  spec rejouée isolément : 14/14.
- `f4 « inscription légère OTP » ×2 projets` (+ 10 « non exécutés » = la
  suite du fichier serial) : **quota Resend épuisé** — GoTrue journalise
  `550 You have reached your daily email sending quota` à 07:17. C'est le
  SEUL test du produit qui exige un envoi réel ; il repassera quand le
  quota sera réinitialisé/relevé. Hors périmètre X2, mais consigné
  (BLOCKERS §14.3) parce que c'est la démonstration involontaire du risque
  que ce lot couvre : ce jour-là, un client réel n'aurait pas reçu son
  lien magique.
- 2 flaky (retry vert) : `f4 grille de créneaux`, `p1b /dev/ui` — motifs
  connus des lots précédents, machine à 2 cœurs sous charge.

### 11.3 Constats d'environnement
- **Quota quotidien Resend épuisé par les campagnes de test** (429 sur
  toute tentative, y compris mes deux sondes) : 238 acceptés + 196 en file
  vers `@fadeup.test` le même jour, par les lots parallèles. Chaque envoi
  `.test` consomme du quota pour rien. BLOCKERS §14.3, décision fondateur.
- **WebKit** : toujours non exécutable (BLOCKERS §2).
- **`apps/mobile` non touchée** (M1b y travaille en parallèle) : à la
  fusion, copier `database.types.ts` et les catalogues
  `locales/{fr,en}` (dont `legal.json`) côté mobile, sinon la garde
  anti-dérive M1a échoue — BLOCKERS §14.2.
- **SPA sans SSR** : la page d'information n'est lisible des robots qui
  exécutent JS (BLOCKERS §13, préexistant) — la « mesure appropriée »
  14(5)(b) vaut pleinement pour les humains, partiellement pour les
  crawlers.

## 12. Ce qui reste avant que le fondateur puisse donner l'ordre de publier

**Dépend du fondateur, pas du code :**
1. **LE VERROU : une boîte qui REÇOIT** (revue X2, BLOCKERS §14.5) —
   `bonjour@contact.fade-up.com` est affichée partout (page article 14,
   reply_to des deux flux) et ne peut pas recevoir (pas de MX). Créer la
   réception, prouver par un e-mail entrant réel
   (EMAIL_DELIVERABILITY §6). Publier sans ça, c'est inviter les
   professionnels à écrire dans le vide.
2. **Vérifier `pro.fade-up.com` chez Resend** + la bascule en un UPDATE
   (§5) — sinon les rebonds de la première campagne toucheront le domaine
   des liens magiques.
3. **Activer le webhook Resend** (créer le point de terminaison, poser le
   secret, recréer le conteneur — EMAIL_DELIVERABILITY §3) — sans lui, pas
   de détection de rebonds/plaintes sur un domaine neuf.
4. **Relever le palier Resend** (le quota gratuit s'épuise en une matinée
   de tests — §11.3).
5. **L'avis juridique attendu** (prompt §6) : mentions définitives de la
   page et de l'e-mail, identité légale du responsable de traitement
   (aujourd'hui « FadeUp » tout court), durée de conservation chiffrée.
   Le registre des traitements (document d'entreprise).
6. La revue recommande — et je souscris — de **tester UNE publication
   réelle d'abord** : un prospect, l'e-mail reçu (vraie boîte du
   fondateur), le lien de retrait cliqué, la demande visible côté
   /platform, le retrait exécuté sous 72 h. Le circuit entier, une fois,
   avant vingt-trois.

**Côté code, prêt** : l'information part à la publication (deux branches,
gardes de contact, heures calmes, trace), la page et le retrait tournent,
le webhook attend son secret, le One-Click fonctionne, la non-republication
est garantie par le garde authoritatif, et `verify_x2.sql` (59 assertions)
rejouera tout ça à chaque évolution.

---

**Aucune fusion n'a été effectuée. Fin du rapport.**
