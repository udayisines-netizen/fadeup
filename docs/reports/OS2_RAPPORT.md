# OS-2 — Rapport final : l'OS pro (file, catalogue, équipe, clients)

Branche `os2/operations` (worktree dédié, depuis `rebuild/social-first-v2` à
`585ddc2`), 2026-09-11. Contrat de design en vigueur :
`docs/design/P1PRO_DESIGN_CONTRACT.md`, non rediscuté. Quatre surfaces
livrées : `/dashboard/queue/settings`, `/dashboard/catalog`,
`/dashboard/clients` (+ `/dashboard/clients/:customerId`) et
`/dashboard/team`.

<!-- SECTION CAPTURES — remplie en fin de lot, après vérification -->

---
## 1. Les notes privées — qui y accède, comment la trace est posée, comment un droit d'accès s'exerce

### Ce qui existait, et pourquoi je ne l'ai pas repris

`customers.notes` existe depuis août : une case de texte libre, sans auteur,
sans date, lisible par tout membre de l'organisation ET par
`private.is_platform_admin()` (fondateur + admin, pas le support ni le
modérateur). **Zéro ligne en production**, et le seul écrivain dans le code
est `src/lib/queries/customers.ts`, un module hérité que rien n'importe.

Une case unique ne permet ni de savoir qui a écrit quoi, ni de répondre
honnêtement à un droit d'accès, ni de tracer une consultation. OS-2 crée donc
`public.customer_notes` : **une note = une ligne, un auteur, une date**.

La colonne héritée n'est pas supprimée — rien n'est détruit — mais elle
devient **inécrivable** : le trigger `customers_reject_legacy_notes` refuse
toute valeur non vide en nommant le motif
(`fadeup_customer_notes_refusal=legacy_column`). Sans ce refus, la frontière
d'audit posée ici aurait eu une porte dérobée : il aurait suffi d'écrire dans
l'ancienne case pour sortir du champ de la trace. Une écriture à `NULL` passe
toujours (c'est ce dont l'effacement de compte de B5 a besoin).

### Qui accède, exactement

| Accès | Chemin | Tracé ? |
|---|---|---|
| **L'équipe du salon** (owner, manager, réceptionniste, barber) | `list_customer_notes` / `add_customer_note` / `update_customer_note` / `delete_customer_note` | non — ce sont ses notes |
| **Fondateur, admin, support, modérateur** | `list_customer_notes` seulement, LECTURE seule | **oui, à chaque appel** |
| **Commercial (`platform_sales`), stagiaire (`platform_intern`)** | aucun — 42501 | sans objet |
| **Le client lui-même** | `get_my_customer_notes()` | non — c'est sa donnée |
| Tout le reste | 42501 | |

Le droit interne est **neuf** : `customer_notes.read`, inséré dans
`platform_permissions` et accordé à quatre rôles seulement. Les commerciaux
et les stagiaires n'y figurent pas : ils n'ont pas le CRM client et aucun
besoin métier. C'est testé aux deux étages — `verify_os2.sql` N2a/N2b en SQL,
et la campagne Playwright en HTTP réel avec les comptes `qa-plat1-sales` et
`qa-plat1-intern`.

**Aucun rôle plateforme n'apparaît dans la policy RLS.** C'est délibéré : une
policy ne peut pas écrire une trace. Si `is_platform_admin()` figurait dans
`customer_notes_select`, un fondateur lirait les notes par PostgREST sans
qu'aucune ligne d'audit ne soit posée. Le chemin interne est donc UNE RPC, et
une seule.

### La trace

`list_customer_notes` est `VOLATILE` — jamais `STABLE` — précisément parce
qu'elle écrit. Quand l'appelant porte `customer_notes.read` **et n'est pas
membre du salon**, elle insère dans `public.platform_audit_log` (le journal
de PLAT-1, pas un second journal — le motif existait, je l'ai repris) :

```
action       = 'customer_notes_read'
target_type  = 'customers'
target_id    = <le client consulté>
metadata     = { organization_id, note_count, support_session_id }
```

`support_session_id` relie la consultation à une éventuelle session de « vue
en tant que » de PLAT-1. `note_count` est écrit **même à zéro** : une
consultation d'une fiche vide est une consultation, et la tentative compte
autant que le résultat (assertion N3d).

Une lecture par l'équipe n'écrit rien (N3a, N3b) : tracer un barber qui
relit sa propre note n'apporte rien et noierait le signal.

### Le durcissement qui n'était pas prévu

En cours de lot, la session B5 a relevé que `customer_notes` portait
SELECT/INSERT/UPDATE/DELETE pour `authenticated`. C'était mon `grant`
explicite, et il n'y avait pas de fuite : les quatre policies RLS
gouvernaient. Mais **PostgREST exposait alors `/rest/v1/customer_notes` avec
filtre libre** — un seul GET aurait suffi à un membre du salon pour aspirer
toutes les notes de l'organisation. La RLS ne l'interdit pas (l'équipe a le
droit de lire), sauf qu'une lecture en masse n'est pas une consultation de
fiche, et c'est la RPC qui porte la trace.

J'ai donc **révoqué tout privilège de table** pour `authenticated` et `anon`.
Les policies restent en seconde couche ; le seul chemin réel sont les cinq
RPC `SECURITY DEFINER`. Vérifié en SQL (`has_table_privilege` = faux, N4c/N4d)
et en HTTP réel (le GET PostgREST répond ≥ 400, même au propriétaire du
salon).

### Le droit d'accès RGPD

`public.get_my_customer_notes()` rend **au sujet lui-même** tout ce que les
salons ont écrit sur lui, tous salons confondus, résolu par
`customers.user_id = auth.uid()` : organisation, corps, auteur, dates. La
donnée est donc extractible sans intervention humaine, ce que l'énoncé
demandait au minimum ; l'écran client viendra plus tard.

La session B5 (effacement de compte, branche parallèle) délègue son
`export_my_data()` à cette RPC **telle quelle** plutôt que de relire la table
— convenu entre nous, pour que FadeUp ne donne pas deux réponses à une seule
question RGPD. Son effacement supprime explicitement les notes du sujet
(la fiche `customers` survivant anonymisée, la cascade ne joue pas).

Un appel anonyme est REFUSÉ plutôt que de rendre une liste vide : sans le
garde nul explicite, la jointure `c.user_id = NULL` aurait rendu 200 et zéro
ligne, c'est-à-dire « rien n'est écrit sur vous » — une réponse fausse à une
question de droit.

---

## 2. Le prix réservé — la garde serveur, et ce qu'elle répond à un barber

La décision du fondateur : « catalogue par un barber, oui, mais pas les
prix ». L'énoncé précise le point qui compte : **refuser, pas ignorer**.

La garde est `private.assert_catalog_author(p_organization_id, p_price_cents)`,
partagée par toutes les écritures du catalogue :

- owner / manager : tout, prix compris ;
- **barber : tout SAUF le prix** ;
- réceptionniste : rien (décision prise seule, §10).

Quand un barber envoie un prix :

```
ERROR:  a barber may edit a service but never its price
ERRCODE: 42501
DETAIL:  fadeup_service_refusal=price_forbidden_for_role
HINT:    Le prix est réservé au propriétaire et au manager.
         Renvoyez la demande sans le champ prix.
```

Trois propriétés vérifiées :

1. **Le refus porte sur la PRÉSENCE du champ, pas sur sa différence avec la
   valeur courante.** Un barber qui renvoie le prix actuel est refusé lui
   aussi (C1f, et en HTTP réel dans la campagne). Autrement la garde aurait
   dépendu d'une lecture concurrente : deux requêtes simultanées, l'une
   changeant le prix, et le « même prix » du barber serait devenu un prix
   différent au moment de l'écriture.
2. **Rien n'est écrit.** Après le refus, `price_cents` vaut toujours 2500
   (C1e).
3. **Le champ n'est pas ignoré en silence** — le barber ne peut pas croire
   que son tarif est passé.

Côté interface, le champ prix **n'est pas rendu du tout** pour un barber
(P1PRO §0bis : capacité absente = non rendue, jamais grisée avec un cadenas),
et le module `api/` n'envoie alors pas la clé `p_price_cents`.

### Le problème que la décision créait, et comment il est résolu

`services.price_cents` est `NOT NULL` depuis l'origine. Un barber qui crée un
service ne peut donc, littéralement, pas en créer un — sauf à relâcher la
contrainte et à répandre le `null` dans la réservation, la facturation et les
surfaces publiques.

OS-2 ajoute plutôt `services.price_pending` : un service créé par un barber
naît `is_active = false`, `price_pending = true`, `price_cents = 0`. Il est
donc **invisible du public exactement comme n'importe quel service
désactivé** — aucune surface publique ne change, vérifié : `list_public_services`
ne le rend pas — et l'écran pro l'affiche « Prix à définir », ce qui est vrai.
Le propriétaire fixe le prix, `set_service_price` retire `price_pending` et
active le service. Une contrainte de base (`services_pending_price_not_active`)
interdit qu'un service sans prix soit actif : la loi est en base, pas
seulement dans la RPC.

---

## 3. L'équipe — le chemin d'invitation, l'expiration, le sort d'un barber retiré

### Le chemin d'invitation : aucun second système

La chaîne existait déjà, entière : `invitations` → trigger
`notify_new_invitation` → ligne dans `public.email_outbox` avec le gabarit
`team_invitation` (fr + en, déjà en base) → distributeur B2, qui ajoute le
jeton sous sa propre connexion privilégiée. **OS-2 n'ajoute rien à la chaîne
d'envoi.** Il ajoute `public.invite_team_member`, la RPC qui crée la ligne
proprement, et corrige au passage un défaut hérité : le jeton était fabriqué
**dans le navigateur** (`src/lib/invitation-token.ts`, chemin d'avant la
purge). Un secret d'invitation se fabrique côté serveur —
`encode(extensions.gen_random_bytes(32), 'hex')`, 64 caractères, vérifié par
assertion.

Le jeton n'est **jamais rendu** à l'appelant : ni par `invite_team_member`,
ni par `list_team_invitations`. Il ne vit que dans l'e-mail.

### L'expiration : sept jours, usage unique — et pourquoi

Sept jours est le défaut déjà en base (`invitations.expires_at`). OS-2 le
**confirme** plutôt que de le changer, pour deux raisons :

- **Assez long** pour couvrir un week-end plus un jour férié — le cas réel
  du barber qui commence un lundi et lit ses mails le mardi suivant.
- **Assez court** pour qu'une boîte mail compromise six mois plus tard ne
  soit pas une porte d'entrée dans un salon.

**Usage unique** : `accept_invitation` refuse un jeton déjà accepté
(`accepted_at`), révoqué, ou expiré. L'invitation n'est donc **pas
réutilisable** — c'est la réponse à la question laissée ouverte par l'énoncé.

**Renvoyer révoque.** `invite_team_member` appelé deux fois sur la même
adresse révoque l'invitation précédente et en émet une neuve (jeton neuf,
échéance neuve), et rend `replaced_previous = true`. Conséquence voulue : un
lien fuité devient inoffensif au premier renvoi. Cela satisfait aussi l'index
unique partiel `invitations_pending_unique (organization_id, email)`, qui
aurait fait échouer une seconde insertion.

La capacité de plan est vérifiée **à l'invitation**, pas à l'acceptation
(`private.assert_professional_capacity`) : un salon qui n'a plus de siège
l'apprend en invitant, pas au moment où l'invité clique et se fait refouler.

### Le sort d'un barber retiré

`public.remove_team_member(p_membership_id, p_reassign_to_barber_id)` touche
trois couches sur quatre, et **jamais la quatrième** :

| Couche | Ce qu'il advient |
|---|---|
| `memberships` (l'accès) | **supprimé** — la personne n'entre plus dans l'espace pro |
| `barbers` (le lien d'emploi) | **fermé** : `is_bookable = false`, `queue_enabled = false`. La ligne RESTE — l'historique s'y accroche |
| `staff_profiles` (le profil interne) | `is_active = false`, `is_public = false` |
| `professionals` (**l'identité portable**) | **INTOUCHÉ** — handle, abonnés, portfolio, historique public |

C'est la loi produit de MASTER_SPEC §9, et c'est vérifié deux fois : en SQL
(T4f) et en HTTP réel dans la campagne (le `professional_id` existe toujours
après le retrait).

**Les rendez-vous à venir** sont réassignés à un barber désigné
(MASTER_SPEC §14). Sans désignation, la RPC **REFUSE** en donnant le nombre :

```
ERROR:   this barber still has 3 upcoming appointment(s); name a replacement
DETAIL:  fadeup_team_refusal=has_future_appointments count=3
HINT:    Choisissez le barber qui les reprend, ou annulez-les d'abord
         depuis l'agenda.
```

On ne laisse pas un client devant un fauteuil vide, et on n'annule pas dans
le dos du salon. Si le remplaçant est déjà pris sur l'un des créneaux, la
contrainte d'exclusion parle et la RPC refuse en le disant
(`reassign_conflict`) plutôt que de forcer un chevauchement.

**La file en cours** suit : les personnes en attente passent au remplaçant
s'il tient une file, sinon retombent dans la file générale de
l'établissement (`barber_id = null`). Elles ne sont jamais jetées, et chaque
déplacement est écrit dans `queue_entry_moves` (kind `staff_move`).

**Les clients** n'ont rien à subir : `customer_professional_relationships`
est indexé par `professional_id`, pas par le lien d'emploi. Les relations
suivent la personne et restent lisibles par le salon pour son historique.
Rien à faire, et c'est délibéré.

Trois refus supplémentaires : on ne se retire pas soi-même (`self_removal`),
seul un owner retire un owner (`owner_role_forbidden`), une organisation
garde au moins un owner (`last_owner`).

### Une faille d'escalade corrigée en passant

En construisant l'écran, j'ai trouvé que `memberships_update` et
`memberships_delete` laissaient un **manager** modifier et supprimer la ligne
d'un **owner** : le `WITH CHECK` n'interdisait que d'ATTRIBUER le rôle owner,
jamais de le RETIRER. Un manager pouvait donc rétrograder son propriétaire,
ou le sortir du salon, par un simple PATCH PostgREST.

Les deux policies gagnent la condition manquante sur l'ANCIEN rôle
(migration `20260911110300`). Vérifié T5a/T5b : sous `set local role
authenticated` avec les claims d'un manager, l'UPDATE et le DELETE sur la
ligne owner ne touchent plus rien. Corrigé ici parce que l'écran équipe
s'appuie dessus — c'est le seul endroit du produit où le geste est offert.

### L'interrupteur « voit le revenu »

OS-1 §12.3 l'avait laissé dans le popover d'équipe de l'agenda et demandait
qu'il rejoigne l'écran Équipe. C'est fait : `set_membership_revenue_visibility`
(RPC préexistante, OWNER seul) est exposée sur la ligne d'un **barber**
uniquement — les autres rôles voient le revenu par leur rôle, l'exception
n'a pas de sens pour eux.

---

## 4. Le catalogue — archivage, affectation, effet sur l'estimation

### Archiver, jamais supprimer

`services.archived_at` distingue trois états que `is_active = false`
confondait : **archivé** (retiré du catalogue, historique conservé),
**brouillon** (`price_pending`, en attente d'un prix), **inactif** (en
pause). La RPC de liste rend un `status` explicite parmi
`active | draft | inactive | archived` — l'interface ne le devine pas.

`delete_service` **refuse dès qu'un historique existe** et nomme ce qu'elle
a trouvé :

```
DETAIL: fadeup_service_refusal=has_history appointments=1 queue=0 samples=0 posts=0
HINT:   Archivez le service : un rendez-vous passé doit garder sa prestation.
```

Le trou qu'elle ferme : la clé étrangère des rendez-vous était déjà en
`ON DELETE RESTRICT`, mais **les entrées de file sont en `SET NULL` et les
mesures de durée en `CASCADE`**. Supprimer un service utilisé seulement en
walk-in aurait donc effacé en silence tout ce que FadeUp avait appris de sa
durée réelle, et détaché des passages de file de leur prestation. Un service
réellement neuf, lui, se supprime (C4f).

### L'affectation

`set_service_barbers(p_service_id, p_barber_ids)` **remplace** la liste
(owner/manager). Une liste vide signifie « toute l'équipe le réalise », parce
que c'est ce que `barber_services` vide veut dire côté disponibilité — et
l'interface le DIT au lieu de laisser croire à une erreur.

### L'effet d'une durée déclarée sur l'estimation

`private.estimated_service_duration_minutes` (F1b) mélange le déclaré et
l'observé avec un poids `(n-4)/16` : 100 % déclaré sous 5 mesures, 50/50 vers
12, 100 % observé à partir de 20. Jusqu'ici, rien ne le disait au
professionnel.

`list_organization_services` rend donc `observed_minutes`, `sample_count` et
un `declared_weight_percent` calculé, et l'écran en fait une phrase sous le
champ durée :

- 0 à 4 mesures → « Aucune prestation n'a encore été mesurée : le client voit
  exactement la durée que vous annoncez ici. »
- 5 à 19 mesures → « FadeUp a mesuré 12 prestations : ce que le client voit
  vient à 50 % de votre durée annoncée, le reste de la moyenne observée. »
- 20 et plus → « le client voit désormais la moyenne observée, pas la durée
  annoncée. »
- écart > 50 % avec au moins 5 mesures → l'avertissement de plafonnement,
  avec les deux causes possibles nommées (durée annoncée fausse, ou
  « Terminé » marqué en retard).

**Rien n'est affiché quand rien n'est mesuré** : `observed_minutes` nul
produit l'absence, pas un zéro (C6d).

---

## 5. Les clients non revenus — comment je les identifie

La donnée existait ; il suffisait de la lire à l'envers.

**Ce qui compte comme prestation.** `private.customer_visit_stats` est la
définition UNIQUE, partagée par la liste et la fiche : l'union des
rendez-vous `completed` et des passages de file `completed`, par client.
Compter les deux est la seule façon honnête — un salon qui travaille surtout
en walk-in aurait sinon des clients à zéro prestation.

**Le cycle de retour** est celui du client, pas celui du salon :

```
intervalle_moyen = (dernière − première) / (nombre − 1)     [≥ 3 prestations]
retour_attendu   = dernière + intervalle_moyen
en_retard        = jours_depuis_la_dernière > 1,75 × intervalle_moyen
                   ET jours_depuis_la_dernière ≥ 30
```

**Trois prestations** parce qu'en dessous il n'y a pas d'intervalle à
observer. Un client d'une seule visite n'a **ni cycle ni retard** : la RPC
rend `null`, pas une moyenne de salon plaquée sur lui (R3c, et la campagne
HTTP le revérifie). Le seuil de 30 jours évite qu'un client hebdomadaire
soit signalé « non revenu » au onzième jour.

**Où ça se voit.** Le segment `lapsed` de `list_organization_customers`, et
sur l'écran clients un bloc d'appel en ambre — « 4 réguliers ne sont pas
revenus à temps » — qui **ne se rend pas quand le compte est zéro**, avec
l'action qui bascule sur le segment. Chaque rangée porte le retard en jours.

**« Client vérifié » n'est pas « client du salon ».** Loi produit
(PRODUCT_CONSTITUTION §3.2, MASTER_SPEC §9) : un client vérifié est un FAIT —
une prestation délivrée à une personne qui a une identité FadeUp — et il se
lit dans `customer_professional_relationships`, jamais dans un abonnement ni
dans un compteur de visites. Un habitué sans compte reste un vrai client du
salon et n'est PAS « vérifié ». Les deux nombres sont rendus séparément et ne
sont jamais agrégés (R2c, R2e).

**La minimisation.** Les deux RPC sont bornées à UNE organisation et exigent
`private.is_org_member`. Aucune n'accepte de filtre inter-organisation, la
fiche d'un client d'un autre salon est refusée du même refus qu'un client
inexistant — pas d'oracle d'existence (R1a, R1b, R1c, et la campagne HTTP).

---

## 6. Migrations — liste et résultat du test de retour arrière

Sauvegarde préalable : `/opt/fadeup/backups/pre-os2-20260911-173341.dump`
(3,5 Mo, `pg_dump -Fc`).

Bac d'essai : `db/tests/b3_restore_sandbox.sh`, restauration **fidèle** (sans
`--no-owner`, en `supabase_admin`), 0 erreur `pg_restore`, propriétaires
conservés (104 objets `postgres`, 39 `supabase_admin`), 18 rôles reproduits.

| Migration | Rôle | Contenu | Retour arrière |
|---|---|---|---|
| `20260911110000_os2_customer_notes` | postgres | table `customer_notes` + 4 policies + trigger de cohérence ; condamnation de `customers.notes` ; droit `customer_notes.read` ; 5 RPC | **exécuté**, table et droit retirés, colonne héritée redevenue écrivable |
| `20260911110100_os2_service_catalog` | postgres | `services.archived_at`, `services.price_pending`, contrainte, 9 RPC | **exécuté**, colonnes et contrainte retirées |
| `20260911110200_os2_queue_thresholds` | postgres | `set_location_queue_thresholds` | **exécuté** |
| `20260911110300_os2_team` | postgres | 2 policies `memberships` resserrées + 5 RPC | **exécuté**, policies restaurées **identiques** (diff textuel vide sur `pg_policies`) |
| `20260911110400_os2_crm` | postgres | `private.customer_visit_stats` + 3 RPC | **exécuté** |

**Tous les cinq tournent en `postgres`** : OS-2 ne redéfinit aucun objet
appartenant à `supabase_admin` (propriétaires vérifiés avant écriture,
DB_OWNERSHIP §3 règle 2). Les 27 objets neufs appartiennent tous à
`postgres`, vérifié.

**ACL comparées** (`db/tests/x3_acl_snapshot.sql`) :

- après l'aller : **91 ajouts, 0 suppression, 0 ligne `anon`**. Les ajouts
  sont exclusivement les `grant execute` explicites des RPC neuves
  (`authenticated`, plus `postgres`/`service_role` par l'ACL par défaut) et
  les privilèges de `customer_notes` pour `postgres`/`service_role`. Aucun
  privilège pour `authenticated` sur cette table — voir §1.
- après le retour : **diff VIDE** avec l'état d'origine.
- aucun objet résiduel : table, colonnes, droit et 27 fonctions absents.

**Contrat de surface anonyme** : `db/tests/x3_anon_surface.sh --strict`
répond « 44 RPC anon-exécutables, aucune dérive ». **Aucune RPC d'OS-2 n'est
appelable en `anon`**, l'allowlist du script n'avait donc pas à être
modifiée — et ce n'est pas un oubli mais une vérification, les trois lots
précédents s'étant fait prendre.

**Le motif nul** (X3) : chaque garde des 27 fonctions évalue une EXISTENCE
(`private.is_org_member`, `has_org_role`, `platform_can`) ou compare une
variable déjà testée `is null`. Aucun `if not (colonne = auth.uid())`, dont
la valeur `NULL` ne lève pas. Les sept RPC d'entrée refusent explicitement
un appelant anonyme (assertions Z1a–Z1g), y compris
`get_my_customer_notes()`, où rendre une liste vide aurait été une réponse
fausse à une question de droit.
