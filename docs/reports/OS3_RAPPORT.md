# FadeUp — Rapport final OS-3 : insights, notifications, billing

Branche `os3/growth`, worktree `~/worktrees/os3`, appliqué en production le
2026-09-12. **Tout en mode test Stripe. Aucune fusion.**

Le dernier tiers de l'OS pro. OS-1 a livré l'agenda, OS-2 la file, le
catalogue, l'équipe et les clients. OS-3 ouvre les trois écrans que la base
attendait : **les insights** (R3 était construit, aucun écran ne l'affichait),
**les sollicitations par modèles** (rien n'existait), **l'abonnement** (B3 était
construit, aucun écran ne l'exposait).

---

## 1. Les insights

### Quel chiffre domine

**Les réservations reçues VIA FADEUP sur la période.** Pas le revenu.

Le revenu domine déjà l'accueil (P1PRO §9) et le patron le connaît. Ce que le
salon ne peut lire nulle part ailleurs, c'est ce que la plateforme lui a
APPORTÉ — et c'est le chiffre nommé par le prompt comme celui qui empêche une
résiliation. Il est en `text-fu-3xl` (390 px) / `text-fu-4xl` (1440 px), Geist
Mono, `tabular-nums` ; le test e2e mesure la police ET la taille, et vérifie
que le bloc de revenu est **strictement plus petit**.

Le discriminant d'origine est `appointments.created_by` : NULL quand la ligne
vient du tunnel public, le membre du comptoir quand elle vient de
`create_appointment_as_business`. C'est le seul marqueur d'origine que la table
porte, et l'écran rend les deux séparément (« Réservations reçues via FadeUp »
et « Saisies au comptoir ») — jamais additionnés.

Secondaires du bloc dominant : clients distincts, vues de profil, nouveaux
abonnés, prestations terminées, saisies au comptoir. Puis quatre blocs :
revenu, demandes, clients, durées. **Aucune grille de douze cartes** — cinq
blocs de premier niveau, de tailles différentes, le test compte.

### Ce que voit chaque rôle

| | owner / manager | barber avec le droit | barber sans le droit | réceptionniste |
|---|---|---|---|---|
| Réservations reçues, vues, abonnés, prestations | ✓ | ✓ | ✓ | ✓ |
| Revenu calculé, panier moyen, coût des absences | ✓ | ✓ | **absent du DOM** | **absent du DOM** |
| Clients non revenus, durées observées | ✓ | ✓ | ✓ | ✓ |

Le masquage est **serveur** : `get_organization_insights` rend
`revenue_cents`, `average_ticket_cents`, `no_show_cost_cents` et
`previous_revenue_cents` à **NULL — jamais zéro** — quand
`private.can_view_revenue` est faux (réglage OS-1,
`memberships.can_view_revenue`). Le composant n'a pas le nombre ; il ne rend
donc même pas l'emplacement du bloc (P1PRO §8 : « un rôle qui ne voit pas un
chiffre ne voit pas non plus son emplacement vide »).

Prouvé deux fois : par HTTP réel (le barber reçoit `revenue_visible: false` et
quatre NULL ; le patron l'ouvre, la RPC change de réponse ; un barber ne peut
pas se l'ouvrir lui-même — 403) et dans le navigateur (aucun motif `\d…€` ni
`EUR` dans tout le `<main>`, aux deux largeurs).

**La garde d'entrée est `private.is_org_member`, pas owner/manager.** Le
contrat R3 (`get_organization_analytics_summary`) exige owner/manager : y
brancher l'écran aurait rendu un 42501 à un barber au lieu d'une page sans
revenu. C'est pour cela qu'OS-3 écrit sa propre RPC plutôt que de réutiliser
celle de R3 — avec deux autres raisons, écrites en tête de la migration :

1. **La base de calcul.** R3 compte des ÉVÉNEMENTS (forward-only depuis sa
   migration, et B5 dé-identifie ses acteurs à l'effacement d'un compte) ;
   `private.customer_visit_stats` compte des LIGNES (tout l'historique). Un
   écran qui mélange les deux affiche deux totaux différents du même nombre.
   OS-3 choisit UNE base par chiffre : l'ÉTAT partout, l'ÉVÉNEMENT pour les
   seules vues de profil, que rien d'autre ne porte.
2. **Le revenu n'existait nulle part.** Zéro `sum(price_cents)` dans toutes
   les migrations (vérifié). La somme monte en base, avec la garde d'OS-1.

### Comment l'absence de données est rendue

Trois absences distinctes, trois traitements :

- **Organisation sans activité connue** (`first_activity_at` NULL) : état vide
  honnête — une phrase qui dit ce que l'écran montrera, une action réelle
  (« Partager mon profil »). **Aucun chiffre, aucun graphique vide.** Le test
  le prouve sur une organisation QA RÉELLEMENT vide (zéro rendez-vous, zéro
  file), à qui on donne un membership propriétaire temporaire — aucune
  organisation n'est créée, et le test vérifie même qu'aucun « 0 » n'apparaît
  dans le bloc.
- **Vrai zéro de période** : il s'affiche. Zéro vue de profil sur trente
  jours est une information.
- **Tendance impossible** : rien. `comparison_available` est décidé EN BASE —
  il exige une fenêtre d'au moins sept jours ET une activité qui commence
  AVANT la fenêtre de comparaison. Côté écran, `trendFor` refuse en plus les
  cas que seul le couple de valeurs révèle : deux zéros ne composent pas une
  tendance, une valeur absente n'est pas une chute, et une base à zéro rend la
  DIRECTION sans pourcentage (« Aucune sur la période précédente ») — une
  division par zéro ne devient jamais « +100 % ».
- **Vues de profil sous-comptées** : si la fenêtre commence avant
  l'instrumentation R3, l'écran écrit « Vues mesurées depuis le … » plutôt que
  de présenter un sous-total comme un total.
- **Durées** : sous cinq mesures, « Pas encore assez de prestations mesurées
  pour comparer une durée ». Cinq est exactement le seuil auquel l'estimateur
  de F1b commence lui-même à mélanger l'observé au déclaré.

### Les durées annoncées contre les observées

« Vous annoncez 30 min ; la moyenne observée est de 27 min sur 34
prestations. » — la phrase du prompt, à la granularité de la PRESTATION.

`get_service_duration_insights` (F1b) existe et n'est pas touchée : elle rend
une ligne par (barber, prestation), ce qu'il faut pour régler un fauteuil.
OS-3 ajoute `get_organization_duration_gaps`, qui lit la MÊME
`private.observed_service_duration` à l'étage LIEU. Agréger côté client les
lignes par barber aurait été une moyenne de moyennes pondérées — un chiffre
faux. Une prestation sans mesure est **absente**, pas à zéro (testé).

### Les clients non revenus

Le calcul d'OS-2 à l'identique (1,75 × l'intervalle observé du client ET au
moins 30 jours, à partir de trois prestations). Bloc d'appel ambre, **rendu
seulement quand le compte est non nul**, avec deux sorties : l'écran clients,
et — c'est le lien que le prompt demandait — **« Leur écrire »**, qui ouvre les
sollicitations.

---

## 2. Les quatre modèles

Le professionnel **choisit un modèle** et remplit quelques champs. Le corps du
message vit dans `email_templates` (fr + en), en base, comme tous les e-mails
de FadeUp. **Il ne rédige pas l'e-mail ; il le paramètre.**

| Modèle | Champs | Audience (serveur) |
|---|---|---|
| **Clients non revenus** | seuil en jours (14–365, défaut 60) + accroche | ≥ 3 prestations ET `jours_depuis_la_dernière ≥ seuil` |
| **Créneaux libres demain** | prestation + accroche | ≥ 2 prestations |
| **Promotion ponctuelle** | offre (80 car.) + date de fin + accroche | tous les clients du salon |
| **Rappel de fidélité** | accroche seule | cadence DÉCLARÉE dépassée |

**L'accroche n'est pas un message libre** : 160 caractères, **une seule
ligne**, **aucune URL**, **aucun jeton de gabarit**. Les quatre refus sont
nommés en base (`private.assert_campaign_text`) et reflétés à l'écran dès que
le champ porte quelque chose. L'interdiction des liens n'est pas une
coquetterie : le seul lien d'une sollicitation est celui du profil du salon,
posé par le gabarit — laisser passer une URL libre ferait de FadeUp un relais
d'hameçonnage sur la réputation d'un domaine d'envoi partagé par tous les
salons.

**Aucun nombre annoncé qui n'existe pas.** « Créneaux libres demain » compte
les HEURES distinctes réellement proposables demain, via la même
`get_available_slots` que le tunnel client, tous fauteuils réservables
confondus (deux barbers libres à 10:00 = une heure à proposer, pas deux). Si
demain est fermé ou complet, l'envoi est **refusé** avec
`fadeup_campaign_refusal=no_free_slot` — testé en fermant le lieu.

**Aucune cadence inventée.** Le rappel de fidélité lit
`customer_profiles.haircut_frequency` (M1a) : weekly → 7 j, every_2_weeks →
14, every_3_weeks → 21, monthly → 30. **`less_often` et `depends` ne portent
AUCUNE cadence** et ne reçoivent donc pas de rappel — leur prêter 60 ou 90
jours aurait été exactement la donnée fabriquée que FadeUp s'interdit. Ils
restent atteignables par les trois autres modèles. Testé : sur une
organisation dont aucun client n'a déclaré de cadence, l'envoi est refusé
(`no_recipient`) plutôt que d'arroser tout le monde.

### La preuve qu'un pro n'atteint QUE ses clients

Trois barrières superposées, et la troisième est celle qui compte :

1. **Le rôle** : `private.has_org_role(owner, manager)` en tête des quatre
   RPC. Un barber, un réceptionniste et un étranger reçoivent le même 403
   (testé par RPC directe, avec de vrais jetons GoTrue).
2. **La structure** : `public.customers` est PAR ORGANISATION. Une adresse
   d'un autre salon n'est pas atteignable, et aucun paramètre des RPC ne
   permet de viser une autre organisation.
3. **Le FAIT** : au moins UNE prestation réellement délivrée par CE salon
   (`private.customer_visit_stats`, la définition d'OS-2). Une fiche saisie au
   comptoir sans aucune prestation n'est pas un client, c'est un contact.

Testé de bout en bout : viser une autre organisation → 403 nommé ; et dans un
envoi LÉGITIME, le client de l'autre salon **n'est pas** dans
`notification_campaign_recipients` alors que le client en retard y est.

**ÉCART ASSUMÉ, DÉCLARÉ.** Le prompt demande de vérifier sur
`customer_professional_relationships`. Cette table n'enregistre que les
clients qui ont un COMPTE FadeUp (`customer_user_id` non nul, R1A) ; OS-2 §5 a
établi qu'un habitué sans compte est un VRAI client du salon, simplement pas
« vérifié ». Exiger la ligne de relation aurait donc interdit au salon
d'écrire à la majorité de ses clients réels.
`private.customer_visit_stats` est le SUR-ENSEMBLE exact — « une prestation
délivrée par ce salon » — dont la relation est le cas « avec compte ». Les
deux nombres sont rendus séparément (`verified_count` dans l'aperçu) et
jamais agrégés.

### Les garde-fous

**`do_not_contact` : il n'existait pas pour les clients.** Le prompt dit
« B2 a construit `do_not_contact` — utilise-le ». Vérifié : le
`do_not_contact` de B2 vit sur `public.prospects`, une AUTRE population — des
professionnels démarchés par FadeUp — et sur
`prospect_outreach_eligibility`. Rien n'existait côté clients de salon. OS-3
crée donc `customers.do_not_contact` + `customers.marketing_unsubscribe_token`
en reprenant exactement la forme de B2 (jeton de 32 hexadécimaux, RPC anonyme
qui répond TOUJOURS vrai pour ne pas servir d'oracle d'existence). C'est une
constatation, pas un contournement.

**Le désabonnement est définitif ET GLOBAL** : il lève le drapeau sur TOUTES
les fiches qui partagent l'adresse, dans toutes les organisations, et retire
les sollicitations déjà en file pour cette adresse. Un client qui clique « ne
plus recevoir » ne demande pas « sauf les neuf autres salons » — c'est aussi
ce que la loi produit implique quand le prompt écrit « si dix barbers
écrivent, le client reçoit dix messages ». Le transactionnel n'est **jamais**
touché : le filtre porte sur le flux, et la page de confirmation le dit
(« vos confirmations de réservation, rappels et changements d'horaire
continuent d'arriver »). Testé : une adresse partagée par deux organisations,
deux drapeaux levés d'un clic ; la ligne en file passe à `failed` ; un jeton
inventé reçoit la même réponse.

**Les heures calmes se PROGRAMMENT, elles ne s'annulent pas.** B2 les applique
en sautant le tick (`continue`) ; X2 en écrivant `email_outbox.next_attempt_at`
à la prochaine heure permise. C'est la seconde forme qui convient ici : une
campagne est un geste ponctuel, si l'on « sautait », personne ne repasserait.
`private.marketing_next_attempt_at` re-signe la fenêtre de B2 —
**08:00–21:00, heure locale du LIEU**, repli sur Europe/Paris et jamais sur
UTC — et `email_dispatch_batch` ne ramasse que ce qui est dû, donc écrire la
date EST le report. Testé sur des instants déterministes (21h30 → 08:00 le
lendemain ; 04h30 → 08:00 le même jour ; 14h00 → immédiat), et vérifié que
chaque ligne d'envoi porte l'instant programmé de sa campagne. L'aperçu
l'annonce au professionnel avant qu'il n'appuie.

**~2 sollicitations par semaine et par PERSONNE, tous salons confondus**
(MASTER_SPEC §13). Rien n'existait : `email_outbox` n'a ni destinataire
étranger ni catégorie, et le seul mécanisme de comptage de la base est un
`dedupe_key LIKE 'préfixe:%'`. Le compte se fait donc sur
`notification_campaign_recipients`, la seule table où une sollicitation
marketing est à la fois identifiée comme telle ET rattachée à une adresse —
sans borne d'organisation, c'est le point.

**Aucun système d'envoi parallèle.** Une campagne écrit des lignes
`email_outbox` et rien d'autre : même table, même
`private.email_dispatch_batch`, même clé Resend, même réconciliation. La
campagne n'est qu'un objet de TRAÇABILITÉ posé à côté. Testé : le nombre de
lignes `email_outbox` du bon flux, du bon gabarit et de la bonne clé
d'idempotence est **égal** au nombre de destinataires.

**Chaque envoi est tracé** : `notification_campaigns` porte l'organisation, le
modèle, l'accroche, les paramètres, le mois de comptage figé, le nombre de
destinataires, de différés, d'exclus, l'instant programmé et `created_by`.
`notification_campaign_recipients` porte chaque destinataire et sa ligne
d'envoi.

### Ce que voit le professionnel

Le compteur du mois DOMINE l'écran (« Envois restants ce mois-ci »), avec en
dessous « 1 sur 50 utilisés — plan Pro ». Puis les quatre modèles. Puis
l'historique, dense, avec le **RÉSULTAT** de chaque campagne : destinataires,
**ouvertures** (`email_outbox.opened_at`, alimenté par le webhook Resend de
X2) et **combien ont réservé ensuite** (une réservation ou un passage de file
créé dans les 30 jours par un destinataire). Ce dernier nombre n'est pas une
attribution causale et l'interface ne le prétend pas.

L'aperçu, avant l'envoi, lit la MÊME fonction d'audience que l'envoi — le
professionnel ne peut pas voir « 14 destinataires » et n'en voir partir que 9 —
et dit pourquoi les autres ne sont pas joignables : sans adresse, désabonnés,
déjà sollicités deux fois cette semaine. Une ligne d'exclusion à zéro n'est
pas rendue.

---

## 3. Le plafond

**Décision du fondateur** : Free 3 · Solo 10 · Essential 20 · Pro 50 ·
Business 100 · Multi illimité.

### Où il vit

**`public.commercial_plans.monthly_campaign_allowance integer`**, NULL =
illimité (même convention que `max_operational_professionals`). Un plafond se
règle par un UPDATE d'une ligne ; **aucun nombre n'est écrit dans le code**, et
le test e2e lit les huit valeurs en base pour les comparer à la décision.

Trois emplacements étaient possibles ; deux sont refusés pour des raisons
vérifiées :

1. **Une nouvelle capacité** dans `commercial_capabilities` +
   `plan_capabilities`. REFUSÉ : le catalogue de capacités est sous DOUBLE
   source de vérité — `apps/web/src/lib/commerce/plans.ts` porte les mêmes 37
   clés et `catalog.test.ts` compare les deux ensembles en PARSANT la
   migration R2. Ajouter une clé en base sans toucher le module TypeScript
   ferait dériver les deux catalogues **en silence** (le test ne lit pas ma
   migration) ; les accorder obligerait à modifier un module partagé avec
   `/platform`, surface de production sur laquelle PLAT-3 travaille en
   parallèle et que le prompt interdit de toucher.
2. **Une colonne numérique sur `plan_capabilities`.** REFUSÉ pour la même
   raison, plus une autre : `get_organization_entitlements` rend
   `live_capabilities text[]`, un tableau plat. Un plafond n'y entre pas sans
   changer la forme d'un contrat que R2 a posé et que `RequireCapability`
   consomme.
3. **Une colonne sur `commercial_plans`.** RETENU : c'est exactement le
   précédent des deux seuls plafonds numériques que FadeUp a déjà —
   `max_establishments` et `max_operational_professionals` — qui ne passent
   pas par le mécanisme de capacités mais par des colonnes dédiées du plan,
   lues à travers `private.effective_plan_key`.

### Comment il est appliqué

`private.campaign_monthly_allowance` passe par `private.effective_plan_key` —
le seul point de jonction où un essai de 14 jours surclasse le plan assigné.
Un salon en essai a donc le plafond de son essai, ce qui est le but d'un essai.

`send_notification_campaign` compte les campagnes du **mois calendaire**
(`period_month`, figé à l'écriture : recalculer le mois à la lecture ferait
glisser une campagne du 31 au 1er) et refuse au-delà, avec
`fadeup_campaign_refusal=allowance_reached`. **L'interface l'annonce AVANT ; la
base le refuse QUAND MÊME** — un refus d'interface n'est pas une
autorisation. Testé par RPC directe : l'envoi est refusé 400 avec son motif,
et **aucune campagne** n'est laissée en base.

Une campagne **sans destinataire joignable est annulée** et ne consomme pas le
plafond (testé : le compte de campagnes est inchangé).

### Ce que voit un pro au plafond

Le bloc du compteur passe en ambre, dit « Plafond du mois atteint », puis
**« Le plan Pro ouvre 50 envois par mois »** — le plan disponible le MOINS
CHER qui apporte strictement plus, calculé en base — et propose « Voir les
plans » (au propriétaire seulement, qui seul peut changer de plan). S'il n'y a
pas de plan supérieur : « Le compteur se remet à zéro le 1er du mois
prochain ».

**Ce n'est pas un mur** : les quatre modèles restent visibles, la feuille
s'ouvre, l'aperçu s'affiche, et c'est le bouton d'envoi qui est désactivé avec
son motif écrit. Testé aux deux largeurs.

### La question ouverte d'OS-2 §12.1, tranchée

« La rétention devient-elle une capacité payante ? » — **NON : elle devient une
capacité MÉTRÉE.** Le fondateur a donné trois envois au plan Free, donc l'écran
se rend à tout plan et c'est le compteur, pas l'absence de capacité, qui
borne. Les six capacités `retention` restent `planned` et ne conditionnent
rien. Aucun gating de `free`, `solo` ni `salon_essential` n'a changé.

---

## 4. Le billing

### Ce qui est exposé

- **L'état** : plan, situation en une phrase (Free / essai en cours avec jours
  restants / essai terminé / actif mensuel ou annuel / résiliation programmée
  / clos / paiement échoué), prochaine échéance ou fin d'abonnement,
  établissements actifs, et le changement déjà programmé s'il y en a un.
- **L'essai de 14 jours**, sans carte, jamais relançable : le bouton
  disparaît dès qu'une ligne d'essai existe (testé : l'essai démarre depuis
  l'écran, `ends_at - started_at` = 14 jours exactement, **zéro objet
  Stripe**, et le bouton a disparu au rechargement).
- **La grille tarifaire RÉELLE**, lue par `get_billing_catalog` — jamais un
  prix codé en dur. Bascule mensuel/annuel. L'annuel est **LU** en base
  (`annual_price_minor` est une colonne générée) : 49,00 € → 490,00 € avec
  « 2 mois offerts », testé à l'écran.
- **Souscrire / changer de plan** : le même bouton, deux chemins — Checkout
  hébergé s'il n'y a pas encore d'abonnement, `request_plan_change` sinon.
  L'écran ne DÉCIDE rien : il affiche la `decision` que la base rend
  (« immédiat, au prorata » ou « à la fin de la période en cours »).
- **Le portail Stripe** pour le moyen de paiement et les factures.
- **La grâce de sept jours**, en tête d'écran quand elle est ouverte.
- **Les paliers multi-établissements** : bornes affichées, palier courant
  nommé, et au-delà du dernier palier un **devis** — jamais un blocage.
- **Le retour de Checkout** : `?checkout=success` est reconnu, annoncé
  (« votre abonnement s'active dans un instant, le temps que Stripe nous
  confirme » — les webhooks passent par le scheduler) et l'état est rafraîchi.

**Le moyen de paiement et les factures n'existent PAS en base, et OS-3 n'en
fabrique pas.** Ils vivent chez Stripe ; le portail client est le seul endroit
où les lire. L'écran le DIT, en une ligne, plutôt que d'afficher une carte
inventée.

**La grâce de sept jours, sans dramatiser** : « Un paiement n'est pas passé.
Il vous reste 5 jours pour le régler », la date en mono ambre, puis **« Rien
n'est coupé d'ici là : vos fonctions payantes restent ouvertes »** (c'est la
vérité : `effective_plan_key` ne dégrade que sur `canceled`), et un seul
bouton : « Mettre à jour le moyen de paiement ». La situation « grâce » passe
AVANT « actif » dans l'ordre d'affichage — dire « actif » serait vrai mais
tairait la seule chose à faire. Un `past_due` sans `grace_until` (la passe de
facturation n'a pas encore tourné) **ne fabrique pas de date** : il montre
l'état. Testé à l'écran aux deux largeurs, sur un vrai `past_due` en base.

### La garde propriétaire

**Ce n'est pas une décision d'écran.** `organization_billing` et
`organization_trials` ont une RLS `owner`-seulement, et chaque RPC d'écriture
commence par `private.assert_not_in_support_view` puis
`private.assert_billing_owner` (B3). L'entrée de navigation « Abonnement » est
conditionnée `roles: ['owner']` ; par URL directe, l'écran rend une phrase et
une sortie — pas un cadenas.

Prouvé par HTTP réel, en promouvant temporairement le compte barber au rôle
**manager** : il lit **zéro ligne** de `organization_billing` et
`organization_trials`, et `request_billing_quote` comme
`start_organization_trial` lui répondent 403. Le propriétaire, lui, lit sa
ligne.

**En vue empruntée, aucun accès au paiement** : `assert_not_in_support_view`
est la PREMIÈRE instruction de chaque RPC de paiement (garde PLAT-1, posée par
B3, non modifiée). Le refus porte
`fadeup_support_view_refusal=payment_forbidden`, et l'écran sait le nommer.

### La preuve qu'aucun objet réel n'a été créé

Vérifié par assertion e2e, à chaque campagne :

```
private.billing_livemode()                                   = false
billing_stripe_prices   where livemode                       = 0
billing_stripe_products where livemode                       = 0
organization_billing    where livemode                       = 0
stripe_webhook_events   where livemode and status <> 'rejected' = 0
```

Et le script de nettoyage **refuse de tourner** si la clé ne commence pas par
`sk_test_`.

### Le cycle complet, prouvé EN VIVANT (mode test)

Preuves archivées dans `docs/reports/artifacts/os3/stripe/` (journal
`cycle.txt`, webhooks `webhooks.txt`, capture du Checkout hébergé rempli) :

1. `checkout` par la fonction Edge `stripe-billing`, avec un vrai jeton GoTrue
   du propriétaire → session `cs_test_…`.
2. Checkout hébergé complété par navigateur automatisé, carte 4242 →
   redirection `https://fade-up.com/pro/billing?checkout=success`.
3. **Webhooks réels** reçus et traités : `checkout.session.completed`,
   `customer.subscription.created/updated`, `invoice.paid` → `active /
   salon_essential / month / livemode=false`.
4. `change_plan salon_pro month` → **`immediate`** (montée proratisée).
5. `change_plan salon_pro year` → **`immediate`** (passage à l'annuel) ; état
   appliqué après webhooks : `active / salon_pro / year`.
6. `change_plan salon_essential month` → **`scheduled`** au 2027-09-12, la fin
   de la période ANNUELLE — la règle de B3 (« un remboursement prorata
   d'annuel est une porte à l'abus »).
7. `portal` → URL `https://billing.stripe.com/p/session?secret=test_…`.
8. `cancel` → `cancel_at_period_end`, puis suppression de l'abonnement côté
   Stripe → `customer.subscription.deleted` → retour au Free.

**Capture de l'écran sur cet état réel** :
`apps/web/e2e/os3/captures/billing-subscribed-{390,1440}.png`.

---

## 5. Migrations

Sauvegarde préalable : **`/opt/fadeup/backups/pre-os3-20260912-164953.dump`**
(4,3 Mo, `pg_dump -Fc`, TOC vérifiée — 4 624 entrées), prise avant toute
migration.

Bac d'essai : `db/tests/b3_restore_sandbox.sh`, restauration **fidèle** (sans
`--no-owner`, en `supabase_admin`) : **0 erreur `pg_restore`**, propriétaires
conservés, 143 tables portant une ACL explicite, 18 rôles reproduits. Journal
complet du cycle : `docs/reports/artifacts/os3/migration-cycle.txt`.

| Migration | Rôle | Contenu | Retour arrière |
|---|---|---|---|
| `20260912100000_os3_insights` | postgres | `private.insights_window`, `private.organization_delivered_in_window`, `get_organization_insights`, `get_organization_duration_gaps` | **exécuté**, les 4 fonctions retirées |
| `20260912100100_os3_marketing_stream_label` | postgres | l'étiquette `marketing` de l'enum `email_stream`, **hors transaction** | **exécuté** — l'étiquette SURVIT, voir ci-dessous |
| `20260912100200_os3_campaign_quota` | postgres | `commercial_plans.monthly_campaign_allowance` + contrainte + les six valeurs du fondateur, `private.campaign_monthly_allowance` | **exécuté**, colonne, contrainte et fonction retirées |
| `20260912100300_os3_campaigns` | postgres | flux `marketing` + 8 gabarits (4 modèles × fr/en), `customers.do_not_contact` + `marketing_unsubscribe_token` + 2 index, enum `notification_campaign_kind`, 2 tables (RLS activée ET forcée, 4 index), 5 fonctions privées, 5 RPC publiques | **exécuté**, tout retiré, `email_outbox` du flux marketing purgé d'abord |

**Les quatre tournent en `postgres`** : OS-3 ne redéfinit aucun objet
appartenant à `supabase_admin` (propriétaires vérifiés AVANT écriture —
`customers`, `commercial_plans`, `email_streams`, `email_templates`,
`email_outbox` appartiennent tous à `postgres`). Les 17 objets neufs
appartiennent tous à `postgres`, vérifié dans le bac d'essai.

**Pourquoi la migration 100100 est seule au monde.** `alter type … add value`
ne peut pas être suivi, dans la MÊME transaction, d'un usage de la valeur
ajoutée : Postgres refuse (« unsafe use of new value of enum type »). La
migration qui insère la ligne `email_streams` du flux marketing doit donc être
une autre transaction. D'où ce fichier d'une ligne utile, sans `begin`, avec
`if not exists` pour être rejouable.

**Écart de retour arrière, assumé et nommé.** Postgres ne sait pas retirer une
étiquette d'un enum. Le retour de `20260912100300` retire la LIGNE
`email_streams` et les huit gabarits ; **l'étiquette `marketing` survit,
inutilisée**. La retirer exigerait de recréer `public.email_stream` et de
réécrire les trois colonnes qui en dépendent (`email_outbox.stream`,
`email_templates.stream`, `email_streams.stream`) plus le type de retour de
`private.render_email_template` — une opération bien plus dangereuse que
l'étiquette morte qu'elle supprimerait. Le fichier
`down/20260912100100_…down.sql` le déclare **et le vérifie** : il refuse si une
ligne d'outbox ou la ligne de flux existent encore.

**ACL comparées** (`db/tests/x3_acl_snapshot.sql`) :

- bac d'essai, après l'aller : **64 ajouts, 0 suppression**. Exclusivement les
  `grant execute` explicites des RPC neuves (`authenticated`, plus
  `postgres`/`service_role` par l'ACL par défaut) et les privilèges des deux
  tables neuves pour `postgres`/`service_role`.
- **une seule ligne `anon`** : `unsubscribe_customer_marketing`. Aucune autre.
- après le retour arrière : **diff VIDE** contre l'état d'origine. Aucun objet
  résiduel — seule l'étiquette d'enum, déclarée.
- **production, avant/après** (`acl-prod-before.txt`, `acl-prod-after.txt`) :
  **64 ajouts, 0 suppression, une seule ligne `anon`** — identique au bac
  d'essai.

**Le motif nul (X3).** Chaque garde des 17 fonctions évalue une EXISTENCE
(`private.is_org_member`, `private.has_org_role`,
`private.can_view_revenue`) ou compare une variable déjà testée `is null`.
L'organisation est testée `is null` AVANT la garde dans chacune des cinq RPC
publiques d'entrée — compter sur le fait que `has_org_role(null, …)` rend faux
serait exactement le raisonnement que X3 interdit. « Pas membre », « pas à
moi » et « n'existe pas » reçoivent le même refus, dans les insights comme
dans les campagnes.

**Contrat de surface anonyme** : `unsubscribe_customer_marketing` **ajoutée à
l'allowlist de `x3_anon_surface.sh`** — et **vérifié qu'elle n'y était pas
déjà** (seule `unsubscribe_prospect_outreach`, la jumelle B2 côté prospects, y
figurait). Le contrat passe de 45 à 46. Motif écrit dans le script : le
destinataire d'un e-mail n'a pas de session, c'est l'exigence même de RFC 8058
dont l'en-tête est POSTé par le client mail lui-même ; et la RPC répond
TOUJOURS `{unsubscribed: true}` — jeton valide, inconnu ou inventé : la même
réponse, donc aucun oracle d'existence, et elle n'expose ni nom, ni adresse,
ni organisation.

### Le SQL déterministe

`db/tests/verify_os3.sql` — une transaction, des assertions qui lèvent,
`rollback` final : **22 groupes d'assertions**, verts dans le bac d'essai
**et** rejoués sur la PRODUCTION en transaction annulée
(`docs/reports/artifacts/os3/verify-os3-prod.txt`) :

`I1` garde des insights (anonyme, étranger, organisation nulle : même refus) ·
`I2` revenu NULL pour un barber sans droit, ouvert par le réglage d'OS-1,
jamais pour un réceptionniste · `I3` FadeUp contre comptoir, demandes reçues et
converties, revenu = somme des prestations terminées · `I4` aucune tendance sur
trois jours · `I5` absences et leur coût, soumis au même droit · `I6`
organisation sans historique : `first_activity_at` nul, vrai zéro · `I7`
prestation mesurée rendue, non mesurée ABSENTE, lieu d'autrui refusé ·
`Q1` les six plafonds du fondateur en base · `Q2` compteur, reste, plan
supérieur, barber refusé · `Q3` au plafond, refus nommé et aucune campagne
fantôme · `C1` les quatre modèles partent, par `email_outbox` uniquement ·
`C2` barber, réceptionniste et étranger refusés ; client d'ailleurs jamais
destinataire · `C3` `do_not_contact` exclu, désabonnement global, file vidée,
transactionnel intact, jeton inconnu sans oracle · `C4` heures calmes
programmées · `C5` deux sollicitations en sept jours excluent la troisième ·
`C6` les cinq refus de l'accroche · `C7` période de promotion invalide ·
`C8` créneaux libres : service manquant, service étranger, aucun créneau ·
`C9` la trace (auteur, mois figé, historique) · `C10` campagne sans
destinataire : pas de plafond consommé · `Z0` motif nul sur les cinq RPC ·
`Z1` ACL : anon n'exécute rien sauf le désabonnement, aucune fonction privée
exposée, RLS activée ET forcée, aucune écriture pour `authenticated`.

---

## 6. Validation

| Porte | Commande | Résultat |
|---|---|---|
| TypeScript | `npm run typecheck` (`tsc -b --noEmit` + `tsc -p tsconfig.v2.json --noEmit`) | **0** |
| Lint | `npm run lint` (oxlint + eslint `--max-warnings 0` + garde de palette) | **0** |
| Unitaires | `npx vitest run` | **107 fichiers, 985 tests verts** (+65 par OS-3) |
| Build | `npm run build` | **OK** |
| Graphe d'entrée | `scripts/check-entry-graph.mjs` (dans `build`) | **231,5 Ko ≤ 240 Ko**, aucune famille interdite — les trois surfaces neuves restent paresseuses |
| SQL déterministe | `db/tests/verify_os3.sql` (bac d'essai fidèle + production en rollback) | **22 groupes verts** |
| Aller/retour migrations | `db/tests/b3_restore_sandbox.sh` | 4 aller + 4 retour, **diff ACL vide** |
| RPC publiques | `db/tests/probe_public_rpcs.sh --strict` | **ALL PUBLIC READ RPCs: 200** |
| Surface anonyme | `db/tests/x3_anon_surface.sh --strict` | **1 écart, non imputable à OS-3** (3 RPC de M1c-a et PLAT-3) — voir §10.1 ; l'ajout d'OS-3 est au contrat, sans doublon |
| e2e du lot | `E2E_PORT=4670 npx playwright test e2e/os3` | **37 passés, 15 ignorés** (les contrats serveur ne tournent qu'une fois) |
| Campagne complète | `E2E_PORT=4670 npx playwright test`, sur l'arbre LIVRÉ | **334 passés, 2 rouges, 40 ignorés, 10 non exécutés** — les 2 rouges sont UN test × 2 largeurs, non imputable à OS-3 (§10.9) |
| Cascade levée | `npx playwright test e2e/f4 --grep-invert "inscription légère"` | **20 passés, 0 rouge** — les 10 non exécutés étaient bien la cascade `mode: 'serial'`, pas des tests cassés en silence |
| axe | `@axe-core/playwright` sur insights (patron, barber, vide), sollicitations (normal, au plafond), abonnement (normal, grâce), désabonnement — aux deux largeurs | **aucune violation `serious` ni `critical`** |
| Console | surveillée sur chaque écran, aux deux largeurs | **aucune erreur** |

### Les tests d'OS-3

**Vitest — 65 tests neufs**, tous sur de la logique PURE, miroir des gardes
SQL :

- `pro-insights/lib/insights.test.ts` (20) : `trendFor` (comparaison refusée,
  deux zéros, valeur absente, base nulle → direction sans pourcentage,
  arrondi, revenu masqué ≠ chute), `conversionRate`, `durationVerdict` (le cas
  **« pas assez de données »** est un VERDICT, pas une absence), `hasMoney`
  (zéro ≠ null), `hasNoHistory`, `viewsArePartial`, `windowBounds`.
- `pro-notifications/lib/campaigns.test.ts` (22) : les quatre modèles et leurs
  champs, `validateCampaignText` (vide, trop long à la borne exacte,
  multiligne, trois formes de lien, jeton de gabarit, vraie accroche
  accentuée), `remainingSends` / `atCap` (illimité = null, jamais de négatif),
  `clampThreshold`, `parseCampaignRefusal`, `suppressionLines`, `canSend`,
  `promotionBounds`.
- `pro-billing/lib/billing.test.ts` (23) : `daysUntil`, `billingSituation`
  (la grâce prime sur « actif », `past_due` sans date ne fabrique rien, une
  grâce échue ne masque plus l'état réel, résiliation programmée avant
  « actif »), `canStartTrial` (jamais relançable, quel que soit l'état de
  l'essai), `plansFor` / `tierFor` / `needsQuote` (2-3, 4-6, 7-15, devis
  au-delà), `priceFor` / `annualMonthsFree` / `intervalAvailable` (l'annuel est
  LU, jamais recalculé), `parseBillingRefusal`.

**Playwright — 26 tests, 52 exécutions** sur les deux projets (390 et 1440),
en deux fichiers :

- `e2e/os3/contracts.spec.ts` — **les vérités serveur par HTTP réel à travers
  Kong**, sans DOM, exécuté une seule fois (les écritures ne doivent pas être
  rejouées par le second navigateur) : le plafond en base aux six valeurs du
  fondateur, le revenu NULL d'un barber et le réglage owner-seul, les trois
  refus identiques des insights, l'absence de tendance sur trois jours, un pro
  qui n'écrit qu'à ses clients (et les lignes `email_outbox` qui le prouvent),
  `do_not_contact` et le désabonnement global, les heures calmes sur des
  instants déterministes, le compteur qui s'incrémente puis le refus au
  plafond, les cinq refus de l'accroche, les trois refus des créneaux libres,
  le rappel de fidélité sans cadence inventée, le billing refusé à un manager
  (lecture ET écriture), la grille tarifaire et l'annuel lus en base, l'absence
  totale de mode réel, et les deux tables neuves muettes pour `anon`.
- `e2e/os3/operations.spec.ts` — **les trois écrans dans le navigateur**, aux
  deux largeurs, avec axe et surveillance de la console à chaque écran :
  insights (chiffre dominant mesuré en police et en taille, revenu secondaire,
  aucun débordement), insights vus par un barber sans droit (aucun montant
  dans le DOM), état vide sur une organisation réellement vide, les quatre
  modèles avec aperçu réel et envoi qui incrémente le compteur, l'écran au
  plafond qui explique sans murer, un barber qui n'a ni l'entrée de nav ni
  l'écran, l'abonnement avec sa grille réelle et son annuel, la grâce de sept
  jours, l'essai de 14 jours démarré depuis l'écran, la redirection
  `/pro/billing` qui préserve sa chaîne de requête, et la page publique de
  désabonnement.

**20 captures**, vérifiées présentes avant d'être annoncées, dans
`apps/web/e2e/os3/captures/` : `insights-owner-{390,1440}`,
`insights-barber-{390,1440}`, `insights-empty-{390,1440}`,
`campaigns-owner-{390,1440}`, `campaigns-capped-{390,1440}`,
`billing-owner-{390,1440}`, `billing-grace-{390,1440}`,
`billing-trial-{390,1440}`, `billing-subscribed-{390,1440}`,
`unsubscribe-{390,1440}`.

### La fenêtre de minuit

Méthode d'OS-2 §12.10 / B5 reprise, pas recréée : la fixture ouvre le lieu
**00:00–23:59 les sept jours**, donc « demain » n'est jamais un jour de
fermeture et le modèle « créneaux libres demain » ne dépend pas de l'heure à
laquelle la campagne tourne. Le seul test qui parle de « demain » calcule le
jour dans le fuseau RÉEL du lieu, lu en base — pas dans un fuseau imposé par
le test (voir l'erreur §9.1).

---

## 7. `/platform` — intact, avec la preuve

**Preuve 1 — le diff.** Aucun fichier de la console interne n'est touché.
Énumération complète des 11 fichiers modifiés et des 9 fichiers/dossiers
neufs :

```
M apps/web/src/app/routes.tsx                    3 routes pro + 2 routes publiques
M apps/web/src/app/shells/ProShell.tsx           2 entrées de nav + le champ `roles`
M apps/web/src/shared/data/keys.ts               8 clés de requête pro
M apps/web/src/shared/data/organization.ts       4 champs de capacité sur ProEntitlements
M apps/web/src/shared/i18n/locales/{fr,en}/nav.json    1 libellé
M apps/web/src/shared/i18n/locales/{fr,en}/pro.json    3 sections neuves
M apps/web/src/shared/lib/database.types.ts      régénéré (généré)
M apps/web/src/shared/ui/icons.ts                +1 icône (IconBilling)
M db/tests/x3_anon_surface.sh                    +1 entrée au contrat
?? apps/web/src/features/pro-{insights,notifications,billing}/
?? apps/web/e2e/os3/
?? db/migrations/20260912100{0,1,2,3}00_os3_*.sql + 4 down
?? db/tests/verify_os3.sql
?? docs/reports/artifacts/os3/
?? infra/supabase/volumes/functions/unsubscribe-customer/
```

**Rien sous `src/pages/platform-*`, `src/components/platform/`,
`src/routes/platform-*`, `src/lib/queries/platform-*` ni `src/lib/commerce/`.**
`shared/ui/icons.ts` est le module d'icônes V2 — vérifié : aucun fichier de
`/platform` ne l'importe. **`apps/mobile` n'est pas touché** (aucune entrée au
diff).

**Preuve 2 — la route répond.** `GET https://fade-up.com/platform` → **200**,
`GET https://fade-up.com/` → **200**, après l'application des migrations.

**Preuve 3 — les lectures publiques.** `probe_public_rpcs.sh --strict` →
**ALL PUBLIC READ RPCs: 200**, dont `search_public_organizations` qui rend la
marketplace (`docs/reports/artifacts/os3/probe-public-rpcs-after.txt`).

**Preuve 4 — les campagnes e2e de `/platform`.** `e2e/plat1` et `e2e/plat2`
sont **verts** dans la campagne complète de 334 tests (§6) : le seul rouge de
la campagne est `e2e/f4`, et sa cause est mesurée hors code (§10.9).

---

## 8. Git

Branche **`os3/growth`**, créée depuis `rebuild/social-first-v2` (`3a2939f`).
Commits et push : voir la fin de ce rapport (il est commité avec eux).

**Aucune fusion effectuée.** Aucun `git add .`, aucun `git add -A`, aucun
`git reset --hard`, aucun `git clean`, aucun `docker prune`.

Un fichier de déploiement vit hors du dépôt et a été copié dans la production :
`infra/supabase/volumes/functions/unsubscribe-customer/index.ts` →
`/opt/fadeup/infra/supabase/volumes/functions/`. Byte-identique au fichier
commité. Vérifié en vivant à travers Kong : `GET` → **303** vers
`/unsubscribe/salon/<jeton>`, `POST` → **200 `{"unsubscribed":true}`**,
`PUT` → **405**.

---

## 9. Décisions prises seules, et erreurs commises

### Décisions

1. **Le chiffre dominant des insights est la contribution de FadeUp, pas le
   revenu** (§1). Le revenu domine déjà l'accueil ; ce que le salon ne peut
   lire nulle part ailleurs est ce que la plateforme lui apporte.
2. **Le plafond vit sur `commercial_plans`, pas dans la matrice de capacités**
   (§3), avec les deux refus motivés.
3. **Les sollicitations ne sont pas gatées par capacité, mais métrées** — la
   réponse à OS-2 §12.1 (§3).
4. **L'audience exige une prestation délivrée par CE salon**, sur-ensemble de
   `customer_professional_relationships` (§2, écart déclaré).
5. **Le désabonnement est global à toutes les organisations** (§2).
6. **`less_often` et `depends` ne reçoivent pas de rappel de fidélité** (§2).
7. **Un troisième flux d'e-mail** (`marketing`) plutôt que de faire passer les
   offres d'un salon par le flux `prospecting`, qui écrit AUX professionnels
   depuis `pro@` : deux réputations d'envoi et deux populations dans un seul
   flux. Adresse `salons@contact.fade-up.com` — le seul domaine vérifié chez
   Resend (BLOCKERS n°6).
8. **Le nom du salon est dans le SUJET et le corps**, pas dans l'expéditeur :
   `email_streams.from_name` est par FLUX, pas par message, et la base n'a pas
   de domaine d'envoi par salon. Le client doit savoir dès le sujet qui lui
   écrit — c'est aussi ce qui rend le désabonnement compréhensible.
9. **Une fonction Edge `unsubscribe-customer`**, jumelle de celle de X2 plutôt
   qu'un aiguillage dans une seule : un jeton de prospect et un jeton de client
   n'ont pas le même espace de noms, et un jeton inconnu ne doit JAMAIS être
   essayé sur les deux tables — ce serait l'oracle d'existence que les deux
   RPC évitent. Page humaine sur `/unsubscribe/salon/:token` pour ne pas
   heurter `/unsubscribe/:token` (X2, prospects).
10. **Une route `/pro/billing`** qui redirige vers `/dashboard/billing` en
    **préservant la chaîne de requête**. Ce chemin circule déjà : les relances
    de grâce de B3 le mettent dans leur corps et les URL de retour par défaut
    de la fonction Edge pointent dessus, alors qu'aucune route ne l'a jamais
    servi — un professionnel qui cliquait dans son e-mail d'échec de paiement
    tombait sur « pas encore construit ». Corrigé côté route plutôt que côté
    gabarit, parce que les e-mails déjà envoyés portent l'ancien lien pour
    toujours.
11. **Un champ `roles` sur `ProNavItem`** : `requiresManage` inclut le
    réceptionniste, alors que l'abonnement est au propriétaire seul et les
    sollicitations au propriétaire ou au manager. L'entrée reflète la garde
    serveur, elle ne la remplace pas.
12. **`ProEntitlements` gagne les quatre champs de capacité** que
    `get_organization_entitlements` rend déjà (R2) : l'écran d'abonnement a
    besoin du nombre d'établissements ACTIFS, qui est serveur
    (`private.org_active_establishments`) et ne doit pas être compté à
    l'écran.
13. **`--fu-text-tertiary` n'est pas utilisable pour du texte.** À 0,4
    d'opacité il donne ~3,4:1 sur `--fu-surface`, sous le 4,5:1 de l'AA pour
    du 12 px. Découvert par axe, corrigé en `--fu-text-secondary` (6,55:1)
    partout. **Défaut de tokens à remonter** : le token existe et rien
    n'empêche le prochain lot de refaire l'erreur.
14. **Le plan assigné de l'organisation QA n'est pas touché par la fixture** ;
    c'est son ESSAI qui lui donne ses capacités, comme le fait déjà le harnais
    d'OS-2. Conséquence de l'erreur §9.2.
15. **L'état commercial de l'organisation QA a été restauré avec
    `session_replication_role = replica`** — la garde de capacité de R2 refuse
    de remettre un plan `free` à une organisation qui rassemble trois
    professionnels, et c'était pourtant son état d'origine. Geste chirurgical,
    déclaré, sur une organisation de test.
16. **Le plafond du plan Pro est abaissé EN BASE puis restauré** par les deux
    tests de plafond, plutôt que de basculer l'organisation sur `free` (refusé
    par R2). C'est d'ailleurs la meilleure preuve que le plafond vit en base :
    aucun code ne le porte.

### Erreurs commises, déclarées

1. **La fixture forçait `locations.timezone = 'Europe/Paris'` sans le
   restaurer.** Le fuseau de l'organisation partagée était `UTC`. Trois suites
   d'autres lots — `os1/agenda`, `f4`, `p1pro` — sont tombées ensuite sur un
   décalage de deux heures, et j'ai d'abord cru à un défaut préexistant.
   **Cause : moi.** Corrigé à la source (le harnais LIT le fuseau, comme ceux
   d'OS-1 et OS-2 ; les assertions d'heures calmes passent un fuseau
   EXPLICITE à la fonction SQL et n'ont jamais eu besoin de celui du lieu),
   production remise à `UTC`, et `e2e/os1` re-vert.
2. **La fixture écrivait `organization_commercial_state.plan_key='salon_pro'`
   et tentait de restaurer l'original.** Cette restauration est REFUSÉE par la
   garde de capacité de R2 (« cannot move to free: it covers 1 operational
   professional and this organization rosters 3 ») : elle n'a donc jamais eu
   lieu, et l'organisation partagée est restée sur `salon_pro`. `e2e/p1pro`,
   dont un test s'appelle « le monde Free (essai expiré) », a commencé à
   recevoir `confirmed` là où il attendait `pending`. **Cause : moi.** Corrigé
   à la source (§9.14), production remise à `free / active / early_access`
   (§9.15), et `e2e/p1pro` re-vert : **15/15**.
3. **Le test de démarrage d'essai supprimait la ligne d'essai HORS de son
   `try`.** Une erreur au milieu laissait l'organisation partagée sans essai,
   donc sans la capacité `booking`, donc toute campagne suivante s'effondrait
   sur une erreur de trigger illisible. **Cause : moi.** Corrigé :
   `ensureActiveTrial()` recrée la ligne si elle manque et est appelée par la
   fixture ET par la neutralisation ; la fixture vérifie en plus la capacité
   `booking` et le dit clairement si elle manque.
4. **La feuille de campagne n'affichait ses refus qu'à la soumission** — or le
   bouton d'envoi est désactivé tant que le formulaire est invalide, et un
   bouton désactivé n'appelle pas son `onClick`. Le professionnel voyait un
   bouton mort sans motif. Corrigé : le refus s'affiche dès que le champ porte
   quelque chose. Attrapé par le test e2e, pas par la relecture.
5. **La clé `pro.billing.scheduled` n'avait pas son `{{plan}}`** : le nom du
   plan du changement programmé était silencieusement perdu, et l'écran
   affichait « Changement programmé vers 12 sept. 2027 ». Attrapé en
   REGARDANT une capture, pas par une garde — `v2-keys-exist` vérifie qu'une
   clé utilisée existe, pas qu'elle consomme ses interpolations. Corrigé.
6. **Deux e-mails marketing de test sont réellement partis chez Resend**
   (acceptés, `200` avec un identifiant), vers des adresses
   `qa-os3-…@fadeup.test` — un domaine réservé sans MX, donc rebond sans
   conséquence et aucune personne réelle atteinte (précédent B3 §12.7). La
   fixture VÉRIFIE désormais qu'aucune adresse hors `@fadeup.test` ne traîne
   dans l'organisation avant d'autoriser un envoi, et refuse de démarrer
   sinon. **Le quota d'envoi quotidien Resend est épuisé** (`550 You have
   reached your daily email sending quota`, mesuré sur GoTrue) : c'était déjà
   le cas d'après trois rapports antérieurs, mais **je ne peux pas exclure que
   mes deux envois aient été les deux derniers de la journée**.
7. **Le premier jet de `private.campaign_audience` utilisait un `on conflict`
   avec liste de colonnes** dans `send_notification_campaign`, où
   `campaign_id` est aussi un paramètre de sortie de la fonction : Postgres
   refuse l'ambiguïté. Attrapé par `verify_os3.sql` au premier passage,
   corrigé (la table n'a qu'une contrainte unique, la cible est sans
   équivoque).

---

## 10. Cases non cochées, et pourquoi

1. **`x3_anon_surface.sh --strict` : 1 écart, non imputable à OS-3.** TROIS
   RPC sont devenues `anon`-exécutables en production sans figurer à
   l'allowlist : **`register_push_device`**, **`revoke_push_device`** et
   **`get_public_platform_settings`**. Aucune n'a de migration dans ce dépôt,
   sur aucune branche visible : les deux premières viennent du lot **M1c-a**
   (notifications push mobiles), la troisième de **PLAT-3** — les deux lots qui
   tournent en parallèle depuis leurs propres worktrees, et auxquels le prompt
   m'interdit de toucher. Les trois sont apparues PENDANT ce lot : le contrat
   était vert au démarrage (mesuré avant la première migration d'OS-3), puis
   `register_push_device`/`revoke_push_device` sont apparues, puis
   `get_public_platform_settings`.

   **Je ne les ajoute pas à l'allowlist** : le contrat de surface est une
   DÉCISION, et c'est au lot qui ouvre une RPC à l'anonyme de la motiver — un
   doublon fait échouer le test aussi sûrement qu'un manque, et c'est
   exactement le piège que le prompt m'ordonne d'éviter pour MON ajout.
   L'ajout d'OS-3 (`unsubscribe_customer_marketing`) est, lui, en place et
   n'apparaît pas dans la dérive.

   Les 18 autres contrôles de la suite sont verts, dont le balayage des 143
   tables en anonyme ET en authentifié sans droit. Journal :
   `docs/reports/artifacts/os3/x3-anon-surface.txt`.
2. **Les relances de grâce J+1 / J+3 / J+6 ne sont pas prouvées en vivant.**
   Il faudrait sept jours réels ou des test clocks Stripe. B3 l'avait déjà
   déclaré ; OS-3 n'ajoute rien sur ce point et se contente d'AFFICHER la
   grâce, ce qui est prouvé à l'écran.
3. **La réception en boîte d'une sollicitation n'est pas observable.** Pas de
   MX de réception, quota Resend épuisé, clé restreinte à l'envoi (BLOCKERS
   n°7, X2). Ce qui est prouvé : la ligne `email_outbox` écrite avec le bon
   gabarit, le bon flux, la bonne clé d'idempotence et le bon instant
   programmé ; et que Resend accepte l'appel.
4. **Les ouvertures affichées ne sont pas prouvées en vivant.** Elles lisent
   `email_outbox.opened_at`, alimenté par le webhook Resend de X2 — dont la
   passe `run_email_feedback_maintenance()` **n'est pas appelée par
   `infra/scheduler/tick.sh`** (constaté, hors périmètre OS-3 : ce défaut
   appartient à X2, dont les migrations ne sont même pas sur cette branche).
   Tant qu'elle n'est pas branchée, la colonne reste nulle et l'écran affiche
   honnêtement 0 ouverture.
5. **Le jeton de désabonnement n'est pas posé sur les fiches antérieures.** Il
   l'est à la PREMIÈRE sollicitation (la colonne a un défaut volatile, donc
   les fiches existantes en ont reçu un au moment de la migration ; celles
   créées par un chemin qui ne le remplit pas en reçoivent un à l'envoi).
6. **Le multi-établissements n'est pas prouvé à l'écran sur une organisation
   réellement multi.** La logique (paliers, palier courant, devis au-delà de
   quinze) est testée unitairement contre le catalogue réel et la grille est
   lue en base ; aucune organisation QA n'a plus d'un établissement actif, et
   en créer une sortait du périmètre. B3 avait prouvé le refus-zéro sur seize
   établissements côté base.
7. **axe n'a tourné que sur les sept écrans/états d'OS-3**, pas sur toute
   l'application.
8. **WebKit reste indisponible** sur cet hôte (bibliothèques système
   manquantes, `playwright install-deps` exige root — blocage P1b n°2).
9. **`e2e/f4` reste rouge sur un test**, et ce n'est pas OS-3 : l'inscription
   légère du tunnel attend un code à 6 chiffres envoyé par GoTrue, et GoTrue
   répond `500 Error sending magic link email` avec, dans ses journaux,
   `550 You have reached your daily email sending quota`. Mesuré directement
   sur `/auth/v1/otp` (compte sonde créé puis supprimé). Voir §9.6 pour ce que
   je ne peux pas exclure.

### Les questions d'OS-2 §12 qu'OS-3 touche

- **§12.1 (la rétention est-elle payante ?)** : **tranchée** — métrée, pas
  gatée (§3).
- **§12.2 (le prix de l'historique)** : **non tranchée**, et OS-3 la rend plus
  visible : le revenu des insights suit le tarif COURANT du catalogue, une
  hausse réécrit le passé. L'interface le nomme « revenu calculé » et la
  migration le dit. Un instantané de prix sur la ligne de rendez-vous reste la
  décision à prendre.
- **§12.9 (la durée observée agrège tous les établissements)** :
  `get_organization_duration_gaps` rend une ligne PAR ÉTABLISSEMENT et nomme
  le lieu, donc l'écran d'insights ne mélange plus. `list_organization_services`
  (écran Catalogue) garde son agrégation tous-établissements : hors périmètre.
- **§12.10 (les fixtures de minuit)** : la méthode est reprise (§6) ; les deux
  fixtures fautives de `f4` et `p1pro` ne sont pas corrigées — hors périmètre,
  et §10.9 montre que le rouge de `f4` a aujourd'hui une autre cause.

---

## 11. Ce qui manque pour qu'un salon paie son premier abonnement

Le tunnel FONCTIONNE : je l'ai parcouru en entier en mode test, depuis l'écran
jusqu'aux webhooks (§4). Ce qui manque est **hors code**, et n'a pas bougé
depuis B3 §14 :

1. **La décision du fondateur de passer en mode réel**, puis : clés
   `sk_live_`, endpoint webhook de mode réel et son secret,
   `private.billing_livemode()` → `true` (une ligne de migration), garde-fous
   des scripts adaptés, re-synchronisation du catalogue en réel.
2. **CGV, mentions légales, politique de remboursement : rien n'existe.** Le
   Checkout devrait exiger leur acceptation (`consent_collection`). C'est le
   blocage le plus dur — encaisser sans CGV n'est pas une question technique.
3. **Stripe Tax en mode réel** : enregistrements fiscaux (seuils OSS/UE) à
   configurer, régime (micro-entreprise ↔ TVA) à vérifier avec un comptable.
4. **Compte Stripe réel activé (KYC)** et nom de facturation propre : le
   compte de test s'appelle « ISUB PAYMENTS », et c'est ce que verrait le
   client.
5. **E-mails de facturation Stripe** (reçus, échecs) : expéditeur et branding
   à configurer dans le dashboard.
6. **Rotation des clés de test** (B3 §12.1, toujours recommandée).

Et, propre à OS-3, **avant la première sollicitation réelle** :

7. **Le quota Resend.** Il est épuisé aujourd'hui, et une campagne à 200
   clients en demanderait 200 d'un coup. Un plan payant Resend (ou un second
   expéditeur) est un prérequis, pas une optimisation.
8. **`salons@contact.fade-up.com` doit être vérifié** chez Resend comme
   expéditeur. Le domaine `contact.fade-up.com` l'est ; la sous-adresse n'a
   jamais servi.
9. **`run_email_feedback_maintenance()` doit être branchée dans
   `infra/scheduler/tick.sh`** (§10.4), sans quoi les ouvertures, les rebonds
   et les plaintes restent invisibles — et un salon qui envoie sans voir ses
   rebonds brûle la réputation du domaine de tous les autres.
10. **Une décision produit sur le volume** : le plafond compte des CAMPAGNES,
    pas des e-mails. Free 3 campagnes × 300 clients = 900 e-mails/mois par
    salon gratuit. Si ce n'est pas l'intention, le plafond doit devenir un
    nombre d'ENVOIS — c'est un `UPDATE` de sémantique dans une seule fonction,
    mais c'est une décision de prix.

---

## 12. Organisations de test — documentées et neutralisées

Une seule : **`qa-f1b-shared`** (`1542ea38-…`), l'organisation partagée des
campagnes pro. **Aucune organisation n'a été créée.**

Tout ce que la campagne écrit est marqué avant création — clients
« QA OS3 … » avec des adresses `qa-os3-…@fadeup.test`, rendez-vous notés
`qa-os3` — et retiré par `neutralize()` : destinataires, campagnes, lignes
`email_outbox` du flux marketing, échantillons de durée, notifications,
rendez-vous, clients, `do_not_contact`, droits de revenu, demandes de devis, et
le plafond du plan Pro remis à 50. La ligne d'essai existe toujours à la
sortie.

Un membership propriétaire TEMPORAIRE est posé sur une organisation QA vide
pour le test d'état vide, et retiré dans un `finally`.

**Vérifié après la dernière campagne** : 0 campagne, 0 client `QA OS3`,
0 ligne `email_outbox` marketing, plafond du plan Pro = 50, plan assigné
`free / active / early_access`, essai actif, fuseau `UTC`, 0 compte
`qa-os3…` dans `auth.users`.

**Traces volontairement conservées** (mode test, déclarées) : les 9 lignes de
`stripe_webhook_events` du cycle vivant, et deux lignes de l'historique
append-only `commercial_plan_changes`. La ligne `organization_billing` a été
SUPPRIMÉE et l'état commercial restauré, parce que l'organisation est partagée
avec les campagnes d'OS-1, OS-2, F1b, P1PRO et PLAT-2, qui dépendent de ses
capacités.

---

## 13. R5R — ce que ce lot ne prétend pas

OS-3 est une livraison **technique** : les trois écrans sont conformes au
contrat P1PRO (blocs, un chiffre dominant, Geist Mono pour les nombres, encre
sur vert, zéro ombre, capacité absente non rendue, états vides honnêtes), et
la campagne le mesure. **La porte d'approbation produit/design reste ouverte** :
rien ici n'est validé visuellement par le fondateur, et les 20 captures sont
là pour qu'il puisse le faire.
