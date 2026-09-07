# FadeUp — Rapport final B3 : monétisation

Branche `b3/monetization`, appliqué en production le 2026-09-07.
**Tout en mode test Stripe. Aucune fusion. Aucun objet en mode réel.**

---

## 1. Catalogue — correspondance base ↔ Stripe

Vérifiée ligne à ligne (`verify_b3.sql`, contrôle « un prix Stripe actif par
plan et intervalle, au montant du catalogue » : PASS ; rejeu du script de
synchronisation : `0 créé(s)`).

| Plan (base) | Mensuel HT | Annuel HT (généré = 10 ×) | Produit Stripe | Prix mensuel | Prix annuel |
|---|---|---|---|---|---|
| solo | 19,00 € | 190,00 € | `fadeup_solo` | `price_1UCr35…i7hG` | `price_1UCr35…B48s` |
| salon_essential | 29,00 € | 290,00 € | `fadeup_salon_essential` | `price_1UCr3K…IkSN` | `price_1UCr3L…PNww` |
| salon_pro | 49,00 € | 490,00 € | `fadeup_salon_pro` | `price_1UCr3M…YS0l` | `price_1UCr3N…0Nnw` |
| salon_business | 79,00 € | 790,00 € | `fadeup_salon_business` | `price_1UCr3O…dycP` | `price_1UCr3P…i2a1` |
| multi_growth | 99,00 € | 990,00 € | `fadeup_multi_growth` | `price_1UCr3R…yaiT` | `price_1UCr3R…988H` |
| multi_pro | 149,00 € | 1 490,00 € | `fadeup_multi_pro` | `price_1UCr3T…qYDC` | `price_1UCr3U…dm1M` |
| multi_scale | 249,00 € | 2 490,00 € | `fadeup_multi_scale` | `price_1UCr3V…elVe` | `price_1UCr3W…bNuc` |

`free` n'a pas d'objet Stripe : on ne facture pas 0 €.

**TVA.** Stripe Tax est **actif** sur le compte de test (vérifié :
`/v1/tax/settings` → `status: active`, siège FR). Tous les prix sont créés
`tax_behavior=exclusive` (HT) ; le Checkout est créé avec
`automatic_tax` + `tax_id_collection` — le numéro de TVA intracommunautaire
est collecté quand le client en a un (case « I'm purchasing as a business »
visible sur la capture du Checkout) et enregistré dans
`organization_billing.tax_id_type/value` au retour du webhook
`checkout.session.completed`. Factures générées par Stripe, accessibles au
portail.

**Immuabilité des prix.** `billing_stripe_prices` est un HISTORIQUE : un
changement de tarif crée un prix et archive l'ancien (index « un seul actif
par plan/intervalle/mode ») ; les abonnements en cours restent sur l'ancien
prix jusqu'à migration explicite. Le prix annuel n'est pas saisissable :
`annual_price_minor` est une colonne **générée** (`price_minor ×
annual_months_charged`), il ne peut pas diverger.

**Synchronisation idempotente trois fois** : par l'état en base, par les
identifiants produits déterministes (`fadeup_<plan>`), par `Idempotency-Key`
Stripe dérivée du contenu — la preuve la plus nette : la synchronisation de
production a récupéré exactement les mêmes `price_…` que celle du bac
d'essai, via les clés d'idempotence, zéro doublon.

## 2. Essai de 14 jours

- **Déclencheur exact** : `ready_to_publish` vrai (jumelle
  `private.org_ready_to_publish`, confrontée à `get_organization_readiness`
  par verify_b3) + plan effectif `free` + jamais d'essai + un propriétaire.
  Démarrage automatique par la passe dédiée `run_trial_maintenance` (≤ 60 s
  après la fin d'onboarding), ou immédiat par `start_organization_trial`
  (propriétaire). **Sans carte bancaire** — aucune table Stripe touchée,
  vérifié.
- **Niveau accordé** : `salon_pro` (Shop Pro) ; `solo` pour un
  `solo_professional` ; palier `multi_salon` couvrant pour une organisation
  déjà multi-établissements (décision prise seule, voir §12).
- **Unique par organisation** : clé primaire = `organization_id`, la ligne ne
  se supprime jamais ; relance refusée, testé après expiration.
- **Rappels** J-3 (`trial_ending_soon`) et J-1 (`trial_ending_final`) dans
  `email_outbox`, idempotents par `dedupe_key`, fr/en.
- **Échéance** : retour au Free implicite (l'essai échu cesse de surclasser),
  aucune donnée touchée, profil publié — vérifié.
- **Organisations d'avant B3** : PAS de démarrage automatique rétroactif
  (seuil daté 2026-09-07 dans le balayage, assumé et commenté) — vérifié en
  prod : 0 essai auto-démarré. Elles passent par la RPC.

**Preuve de bout en bout du tunnel** (verify_b3, 59/59 PASS, rejoué sur la
production en transaction rollback) : `pending` avant → essai →
`book_public_appointment` = **`confirmed`** sans qu'une ligne de B2 ne
change → `accepts_immediate_booking` = **true** → expiration → `pending` à
nouveau. Et la même bascule prouvée EN VIVANT via l'abonnement (§3).

## 3. Abonnement

- **Checkout, pas Payment Element** : il livre TVA, SCA/3DS, échecs de carte,
  moyens locaux et factures pour zéro ligne à maintenir ; rien au MASTER_SPEC
  ne justifie de payer le coût du pixel-perfect sur un écran de facturation.
- **Portail client configuré** (`bpc_1UCrLn…`) : moyen de paiement, factures,
  résiliation **en fin de période**, adresse/TVA modifiables.
- **Garde propriétaire, infranchissable** : `private.assert_billing_owner`
  en tête de CHAQUE RPC (`prepare_billing_checkout`, `prepare_billing_portal`,
  `request_plan_change`, `request_billing_cancellation`,
  `request_billing_quote`) — la fonction Edge ne décide rien, elle transmet le
  jeton de l'appelant à ces RPC. Un manager est refusé par le même code SQL
  qu'il passe par l'app, par la fonction Edge ou par PostgREST directement —
  cinq refus testés + RLS : un manager lit **zéro** ligne de
  `organization_billing`, `organization_trials`, `stripe_webhook_events`.
- **Changements de plan** : montée **immédiate** avec proratisation
  (`proration_behavior=create_prorations`) ; descente **à la fin de la
  période** (programmée en base, transmise à Stripe par le scheduler,
  `proration_behavior=none`) ; descente infaisable **refusée avec motif**
  (« it covers N professional(s)… » + hint) sans toucher les données —
  les trois cas testés.
- **Résiliation** : `cancel_at_period_end` ; retour au Free en fin de
  période ; profil, réputation, relations, historique conservés (le retour au
  Free est `status='canceled'` sur le plan assigné, jamais un plan_key
  `free` — c'est aussi ce qui respecte la garde de capacité R2 pour les
  multi-établissements).

**Souscription prouvée de bout en bout, en vivant, sur la production (mode
test)** : session Checkout créée via la fonction Edge (garde propriétaire
franchie par un vrai JWT), page hébergée complétée avec la carte 4242 par
navigateur automatisé, redirection `checkout=success`, **webhooks réels**
reçus (`checkout.session.completed`, `customer.subscription.created/updated`,
`invoice.paid`), état appliqué : `salon_pro / active / billing / stripe`,
période au 2026-10-07 — puis **réservation publique anonyme = `confirmed`**,
puis résiliation via l'Edge, suppression de l'abonnement,
`customer.subscription.deleted` reçu, retour au Free, et **réservation =
`pending`** avec échéance 24 h. Le cycle complet, sur les vrais tuyaux.

## 4. Webhooks

- **Point d'entrée** : fonction Edge `stripe-webhook`
  (`https://fade-up.com/functions/v1/stripe-webhook`). Retenue contre une
  route scheduler parce que le scheduler n'a aucun écouteur HTTP — c'est un
  psql en boucle — et l'Edge runtime existe déjà (aucun runtime ajouté). La
  fonction est volontairement bête : signature, mode, INSERT, 200. Toute la
  logique vit en SQL, où verify_b3 la teste.
- **Signature vérifiée AVANT toute écriture** — décision importante : un
  événement forgé stocké-puis-rejeté squatterait la clé d'idempotence du VRAI
  événement portant le même id. HMAC-SHA256 sur `t.corps`, comparaison à
  temps constant, tolérance 5 min. **Preuves live** : signature falsifiée →
  `400 invalid signature`, **rien en base** ; absence de signature → 400 ;
  GET → 405 ; événement correctement signé → `200 {received:true}` en
  **244 ms** (exigence < 2 s), traité au tick suivant.
- **Sept événements traités** (`checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.trial_will_end` — ce
  dernier journalisé sans effet : l'essai FadeUp vit en base, sans essai
  Stripe). Deuxième barrière de mode : un événement `livemode` est `rejected`
  par la base tant que `private.billing_livemode()` rend false — testé.
- **Idempotence** : clé primaire = identifiant d'événement Stripe. Rejeu du
  même id → une ligne, un effet (compte de `commercial_plan_changes`
  inchangé) — testé en SQL et en HTTP live.
- **Journal** : `stripe_webhook_events` garde charge utile brute, statut,
  erreur, tentatives, horodatages — 10 événements réels y sont déjà, dont
  2 échecs proprement motivés (organisation fictive du test de pipeline).
- **Échec de paiement** : `invoice.payment_failed` → **7 jours de grâce**
  comptés du premier échec (pas de remise à zéro), capacités conservées
  (`past_due` ne dégrade pas), e-mail immédiat (J0) puis relances **J+1,
  J+3, J+6** idempotentes ; à l'échéance : retour au Free + résiliation de
  l'abonnement Stripe (pg_net). Côté Stripe, les Smart Retries restent
  actifs sur la carte — regardé avant de réécrire : Stripe porte les
  re-tentatives de paiement, FadeUp porte ses e-mails et son échéance.

## 5. Annuel

Dix mois payés, douze servis : `annual_months_charged = 10`,
`annual_price_minor` **générée**. Prix annuels Stripe créés pour tous les
plans payants, `multi_salon` compris (tableau §1 ; `pro` = 490 €/an).
Bascules — la recommandation du prompt, adoptée : **mensuel → annuel
immédiat avec proratisation** ; **annuel → mensuel à l'échéance annuelle
seulement** (un remboursement prorata d'annuel est une porte à l'abus :
prendre les deux mois offerts puis se faire rembourser). Testé :
`salon_pro month → year` = `immediate` ; l'inverse = `scheduled` à
l'échéance.

## 6. Multi-établissements

- **Paliers en base, paramétrables** : `min/max_establishments` =
  2-3 (99 €), 4-6 (149 €), 7-15 (249 €). Élargir un palier est un UPDATE.
- **Au-delà de 15 : sur devis** — `billing_quote_requests`, ouverte
  automatiquement par le balayage (une seule ouverte par organisation) ou par
  le propriétaire (`request_billing_quote`). Jamais un blocage : testé avec
  16 établissements actifs.
- **Niveau Pro sur tous les établissements** : `feature_tier_plan_key`
  (`salon_pro` pour growth/pro, `salon_business` conservé pour scale, qui
  l'avait déjà — la règle est un plancher) + `sync_plan_feature_tier`,
  recopie **additive**. Ouvrir le niveau Scale un jour = un UPDATE + un
  appel, pas une réécriture.
- **Bascule** : la garde de capacité R2 apprend à ne JAMAIS bloquer un
  établissement au-delà du palier pour la famille `multi_salon` (testé : le
  4e établissement d'un `multi_growth` passe) ; la passe dédiée
  `run_establishment_tier_maintenance` détecte, programme le palier couvrant
  pour la **période suivante** (jamais rétroactif, la période en cours reste
  au tarif payé — vérifié), et **annonce par e-mail avant de facturer**
  (`tier_switch_notice`, date + montant, une seule fois par bascule). Le
  scheduler transmet le changement à Stripe à l'échéance.
- Les plans à établissement unique gardent le refus R2 avec son hint : passer
  de 1 à 2 établissements est un changement de famille de plan, pas une
  bascule de palier.

## 7. Migrations et retours arrière

| Migration | Rejeu | Retour arrière (sur restauration fidèle) |
|---|---|---|
| `20260907010000_b3_billing_catalog` | idempotent ✓ | ✓ |
| `20260907011000_b3_trial` | idempotent ✓ | ✓ |
| `20260907012000_b3_subscription_lifecycle` | idempotent ✓ | ✓ |
| `20260907013000_b3_plan_change_and_tiers` | idempotent ✓ | ✓ |

Testés par `db/tests/b3_restore_sandbox.sh` : restauration **fidèle**
(`pg_restore -U supabase_admin`, sans `--no-owner`, rôles du cluster
reproduits, propriétaires conservés — 80 objets `postgres` / 39
`supabase_admin`, 113 tables avec ACL). Les quatre up puis les quatre down en
ordre inverse : **diff de schéma nul** contre la base d'avant (seul l'alea
`\restrict` de pg_dump diffère). La fidélité a payé, deux fois (§12).
RLS **activée et forcée** sur les six tables créées, vérifié
structurellement par verify_b3.

## 8. Sauvegarde

`/opt/fadeup/backups/pre-b3-20260907-005805.dump` — 2,2 Mo, TOC vérifiée
(3 669 entrées), prise avant toute migration, et c'est elle qui a servi aux
deux bacs d'essai.

## 9. `/platform`

**Intact.** Aucun fichier frontend touché hors `database.types.ts`
(régénéré, `tsc --noEmit` vert). Preuves : `GET /platform` → 200 avant et
après ; `probe_public_rpcs.sh --strict` → **15/15** avant et après ; les
**9 organisations** de la marketplace identiques au diff près
(`marketplace-baseline.txt` = `marketplace-after.txt`).

## 10. Écrans débloqués

**Débloqués** : P3 Billing complet — grille tarifaire réelle
(`get_billing_catalog` : prix, annuel, bornes, capacités, prix Stripe),
état d'abonnement (`organization_billing` RLS owner), bandeau essai
(`organization_trials`), souscription (Edge `checkout` → URL), portail,
changement de plan avec motifs de refus exploitables, résiliation, devis.
L'onboarding peut appeler `start_organization_trial` à la fin du parcours
pour un démarrage sans latence.

**Restent bloqués** (inchangés par B3) : P2 e2e WebKit (n°2), avis /
publications / Wallet (P4), promotions (P5), second domaine d'envoi (n°6),
sonde de délivrance Resend (n°7).

## 11. Git

Branche `b3/monetization`, 3 commits, **poussés**
(`origin/b3/monetization`) : `3e10daa` (migrations), `df57904` (outillage),
`74759da` (schéma/types/docs + fonctions Edge). **Aucune fusion effectuée.**
Le worktree `/opt/fadeup` (branche `rebuild/social-first-v2`) porte les
copies de déploiement non commitées de `docker-compose.yml`, `tick.sh`,
`stripe-webhook/`, `stripe-billing/` et `.gitignore` — byte-identiques aux
fichiers commités sur la branche ; elles se résorberont à l'avance rapide du
fondateur.

## 12. Décisions prises seules, et erreurs commises

Décisions :
1. **Niveau d'essai d'une organisation déjà multi-établissements** = palier
   `multi_salon` couvrant (un essai `salon_pro` la plafonnerait à un
   établissement pendant l'essai — l'inverse de ce qu'un essai doit prouver).
2. **Pas de démarrage d'essai rétroactif** pour les organisations d'avant B3
   (leurs quatorze jours auraient brûlé à leur insu) ; seuil daté en dur dans
   le balayage, RPC propriétaire pour elles.
3. **Le déclencheur d'essai n'est pas dans `complete_onboarding`** : la
   fonction appartient à `supabase_admin` et le bac d'essai fidèle a refusé
   la redéfinition (à raison). Balayage ≤ 60 s + RPC explicite à la place —
   documenté BLOCKERS n°9.
4. **`stripe_billing_interval`** plutôt que `billing_interval` : un enum de ce
   nom existait déjà (`membership_plans`, weekly/monthly/yearly), intouché.
5. Les appels Stripe du scheduler passent leurs paramètres **en query string**
   (pg_net ne poste que du JSON, que Stripe refuse en corps) — vérifié accepté
   par l'API avant d'être écrit.
6. `enforce_establishment_capacity` ne libère que la famille `multi_salon` ;
   les plans mono-établissement gardent le refus R2 (changement de famille ≠
   bascule de palier).
7. Le test E2E vivant a utilisé `side-agency` (organisation de démonstration)
   avec un propriétaire QA temporaire, nettoyé ensuite ; il en reste des
   traces **légitimes et voulues** : `organization_billing` (client
   `cus_VDIC…`, abonnement résilié), l'historique append-only
   `commercial_plan_changes` (5 lignes billing), et le journal
   `stripe_webhook_events` (10 événements). Deux e-mails transactionnels de
   test sont partis vers des adresses `@example.test` (rebond sans
   conséquence) et l'accusé de demande vers le propriétaire réel de
   side-agency.

Erreurs, déclarées :
1. **Un debug `bash -x` a affiché la clé de test et le secret de webhook dans
   la sortie de MA session de travail** (jamais dans un fichier, un log de
   conteneur ni git — le test de fuite est vert). Clés de mode test
   uniquement ; par prudence, une rotation des clés de test + re-exécution de
   `b3_configure_stripe.sh` est recommandée, cinq minutes.
2. Premier passage de verify_b3 : deux contrôles mal écrits (verdicts écrits
   sous le rôle `authenticated`, essai déjà expiré avant le test de
   conversion) — corrigés, 59/59 ensuite.
3. Le bac d'essai a d'abord créé la base restaurée possédée par
   `supabase_admin` → faux `permission denied for schema public` ; corrigé
   (possédée par `postgres`, comme la production), et c'est ce correctif qui
   a ensuite fait attraper au bac d'essai le vrai piège `supabase_admin` des
   fonctions.
4. Constaté au passage et corrigé : une ligne de commentaire corrompue
   (`B#`) dans `/opt/fadeup/infra/supabase/.env`, antérieure à B3, qui
   cassait tout `source` du fichier.

## 13. Cases non cochées

- **« Relances J+1/J+3/J+6 pendant la grâce » — prouvées en SQL (verify),
  pas en vivant** : il faudrait 7 jours réels ou des test clocks Stripe. Le
  mécanisme (fenêtres + dedupe) est testé contre la production en rollback.
- **Réception en boîte des e-mails B3** : toujours non observable (BLOCKERS
  n°7, clé Resend restreinte à l'envoi) — hors périmètre B3.
- **Bascule de palier facturée sur une vraie période Stripe** : la détection,
  la programmation, l'annonce et la transmission sont testées ; la facture au
  nouveau montant tombera à la première échéance réelle d'un abonné multi —
  aucune ne peut exister avant le mode réel.
- Tout le reste des critères d'acceptation du prompt est coché.

## 14. Avant de facturer un vrai client

1. **Décision fondateur** de passage en mode réel, puis : clés `sk_live_`,
   endpoint webhook de mode réel + son secret, `private.billing_livemode()`
   → `true` (migration d'une ligne), garde-fous des scripts adaptés,
   re-synchronisation du catalogue en réel.
2. **CGV, mentions légales, politique de remboursement** — rien n'existe.
   Le Checkout devrait exiger leur acceptation (`consent_collection`).
3. Stripe Tax en mode réel : enregistrements fiscaux (seuils OSS/UE) à
   configurer dans le dashboard ; vérifier le régime (micro-entreprise ↔
   TVA) avec un comptable.
4. Compte Stripe réel activé (KYC), nom de facturation propre (le compte de
   test s'appelle « ISUB PAYMENTS » — c'est ce que verrait le client).
5. E-mails de facturation Stripe (reçus, échecs) : configurer l'expéditeur
   et le branding du dashboard.
6. Rotation des clés de test (voir §12), et sonde de délivrance Resend
   (BLOCKERS n°7) pour que les relances de grâce soient observables.
7. Frontend P3 Billing (hors périmètre B3) — les contrats sont prêts.
8. Décision sur BLOCKERS n°9 (fonctions `supabase_admin`) avant le prochain
   lot qui devra les toucher.
