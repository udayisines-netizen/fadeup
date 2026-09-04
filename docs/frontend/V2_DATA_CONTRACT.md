# V2 Data Contract

Établi par P1a le 2026-09-04, contre `db-audit/SCHEMA.sql` (dump du 2026-09-03,
108 tables, 186 fonctions, 58 enums, 307 policies RLS) et la base de production
live (`fadeup-supabase-db`, lectures seules). Types générés :
`apps/web/src/shared/lib/database.types.ts` (9 011 lignes, via le générateur
postgres-meta du conteneur `fadeup-supabase-meta` — la CLI Supabase moderne
exige Docker-in-Docker pour `gen types --db-url` et échoue ici ; même
générateur, même sortie).

> **Mis à jour le 2026-09-04 après B1** (`b1/public-read-integrity`). Le
> schéma live porte désormais **108 tables, 189 fonctions, 59 enums, 302
> policies RLS, 0 table sans RLS**. Les lignes touchées par B1 sont marquées
> **B1** ci-dessous. Les décomptes de l'en-tête d'origine (186 fonctions, 58
> enums, 307 policies) datent du dump du 2026-09-03 ; l'écart de policies
> (307 → 302) est antérieur à B1, qui n'a créé aucune table et donc aucune
> policy.

Inventaire : **35 RPC de lecture** (`get_/list_/search_`), **94 fonctions
d'écriture/trigger** hors préfixes internes, **148 `SECURITY DEFINER`**.
Règle : une fonction `SECURITY DEFINER` exposée à `anon`/`authenticated` est
l'API ; tout le reste est interne. **Chercher la RPC avant d'écrire une
requête** — `.from('appointments')` là où `get_my_appointments()` existe est
un bug.

---

## 1. Surface d'API

Légende : SD = SECURITY DEFINER ; auth = session requise ; écrans = consommateurs P2–P5.

### Lecture — public / anonyme

| RPC | Signature (résumé) | Retour | SD | Auth | Écran(s) |
|---|---|---|---|---|---|
| `search_public_professionals` **B1** | 14 params, tous optionnels (voir V6) | TABLE **30** col. : + `location_kind`, `service_area_center_latitude/longitude`, `service_area_radius_km`, `covers_search_point` | ✓ | non | P2 Recherche, Accueil |
| `search_public_organizations` **B1** | pays/ville/texte/geo/rayon/pagination | TABLE **18** col. : + `location_kind`, `service_area_radius_km`, `covers_search_point` | ✓ | non | P2 Recherche (variante orgs) |
| `get_public_organization` | `p_slug` | id, name, slug, currency, country_code | ✓ | non | P2 Profil salon |
| `list_public_locations` **B1** | `p_organization_slug` | `kind` + adresse **ou** zone (centre + rayon) + timezone | ✓ | non | P2 Profil salon, Réservation |
| `list_public_services` | slug, location | services + catégorie + durée + prix | ✓ | non | P2 Profil salon, Réservation |
| `list_public_barbers` | slug, location, service | barbers aptes au service | ✓ | non | P2 Réservation (choix barber) |
| `list_public_organization_barbers` | slug | équipe complète publique | ✓ | non | P2 Profil salon (équipe) |
| `list_public_barber_services` | slug, barber | services d'un barber | ✓ | non | P2 Profil barber |
| `get_public_barber` | slug, barber | identité + bio + avatar + location | ✓ | non | P2 Profil barber |
| `get_public_professional` **B1** | professional_id | identité + **`claim_state`** + `is_claimed` + `follower_count`. Sert revendiqué **et** non revendiqué | ✓ | non | P2 Profil barber, profil non revendiqué |
| `get_public_professional_by_handle` **B1** | handle | idem, même forme | ✓ | non | P2 Profil par handle |
| ~~`get_public_external_professional`~~ | — | **SUPPRIMÉE par B1** : elle exigeait `unclaimed AND is_public`, combinaison que la contrainte R1B interdisait — elle n'a jamais pu renvoyer une ligne. Son contrat vit dans les deux RPC ci-dessus | — | — | — |
| `get_public_available_slots` | slug, location, barber, service, date, pas | slots réels (start/end) | ✓ | non | P2 Réservation (heure) |
| `get_public_service_state` **B1** | slug, location, barber? | mode effectif, `booking_accepting_new_entries`, `queue_accepting_new_entries`. **Répondait 405 à tout appelant avant B1** ; ne contient plus aucune écriture | ✓ | non | P2 Profils, Réservation, File |
| `get_public_queue_status` | slug, location | entrées file (prénom, position) | ✓ | non | P2 File publique |
| `get_public_currencies` | org_ids[] | devise par org | ✓ | non | P2 cartes de résultat |
| `get_shared_passport` | token | champs Passport partagés | ✓ | non | P2 Passport partagé |
| `get_invitation_by_token` | token | invitation équipe | ✓ | non | P3 Acceptation invitation |

### Lecture — client authentifié

| RPC | Retour | SD | Écran(s) |
|---|---|---|---|
| `get_my_access` | rôles/portes disponibles (platform, pro, customer, application) | ✓ | Routeur d'entrée, gardes |
| `get_my_appointments` | rendez-vous du client (statut, résolution, `expires_at`) | ✓ | P2 Réservations, Accueil |
| `get_my_queue_status` | file active du client (position) | ✓ | P2 File active, Accueil |
| `get_my_favorites` | favoris | ✓ | P2 Compte/Accueil |
| `list_my_followed_professionals` / `list_my_followed_organizations` | follows | ✓ | P2 Accueil (profils suivis), Compte |
| `get_my_professional_application` | candidature pro | ✓ | P3 Onboarding |

### Lecture — pro authentifié (org-scopée)

| RPC | Retour | SD | Écran(s) |
|---|---|---|---|
| `get_booking_requests` | demandes `pending` (+ contact client, `expires_at`) | ✓ | P3 Demandes |
| `get_calendar_appointments` | agenda fenêtré, filtrable location/barber, prix service | ✓ | P3 Agenda, TODAY |
| `get_available_slots` | slots côté staff | ✓ | P3 Réservation manuelle |
| `get_service_mode_state` | modes par location/barber | ✓ | P3 TODAY/QUEUE, réglages |
| `get_organization_entitlements` | **1 ligne** : plan, famille, statut, plafonds/usages, `live_capabilities text[]`, `packaged_capabilities text[]` | ✓ | Shell pro (gating), P3 Billing |
| `my_organization_has_capability` | booléen par capacité | ✓ | Gating ponctuel |
| `get_organization_readiness` **B1** | check-list de publication. Ajoute `has_service_area` ; `ready_to_publish` accepte **adresse OU zone de service** ; `missing_requirements` renvoie `location_address_or_service_area` (remplace `location_address`) | ✓ | P3 Onboarding |
| `get_organization_analytics_summary` | fenêtré `p_from/p_to` : vues, funnel booking/queue, follows, clients uniques/récurrents, taux de conversion | ✓ | P3 Insights |
| `get_organization_retention_cohort` | cohortes retour 30/60/90 j | ✓ | P3 Rétention |
| `get_professional_analytics_summary` | stats du professionnel | ✓ | P3 Insights barber |

### Lecture — platform

`get_platform_analytics_funnel` (funnel `discovered → claim → activated → paid`) — P5. Les
lectures `prospect_*`/`outreach_*`/`ml_*` restent hors périmètre frontend (non-goal §19), sauf `/platform`.

### Écriture — client (anonyme ou authentifié)

| RPC | Effet | SD | Auth | Écran(s) |
|---|---|---|---|---|
| `book_public_appointment` | crée un rendez-vous **`confirmed`** (voir V1) ; retourne `id, starts_at, ends_at, status, claim_token` | ✓ | non (token de revendication si anonyme) | P2 Réservation |
| `redeem_appointment_claim` | rattache un rendez-vous anonyme au compte | ✓ | oui | P2 post-inscription |
| `cancel_my_appointment` | annulation client | ✓ | oui | P2 Réservations |
| `reschedule_appointment` | report ; un report client repasse la ligne en `pending` (matrice de transition) | ✓ | oui | P2 Réservations |
| `join_public_queue` **B1** | rejoint la file. **Exige le jeton QR de l'établissement et des coordonnées dans la géofence** (150 m par défaut, réglable par salon). Refus nommés via `DETAIL: fadeup_queue_refusal=<code>` — voir V8 | ✓ | non | P2 File |
| `follow_professional` / `unfollow_professional` | graphe social pro (tombstone durable) | ✓ | oui | P2 Profils |
| `follow_organization` / `unfollow_organization` | graphe social org | ✓ | oui | P2 Profil salon |
| `favorite_shop` / `remove_favorite` | favoris | ✓ | oui | P2 Profils |
| `create_passport_share` / `revoke_passport_share` | partage Passport à TTL | ✓ | oui | P2 Passport |
| `track_analytics_event` | seul canal analytics client | ✓ | mixte | transversal |
| `submit_professional_claim` / `withdraw_professional_claim` | revendication de profil | ✓ | oui | P2/P3 Revendication |
| `submit_professional_application` | candidature pro | ✓ | oui | P3 Onboarding |
| `mark_notification_read` / `mark_all_notifications_read` | notifications | ✓ | oui | P2 Activité |

### Écriture — pro

`confirm_booking_request`, `decline_booking_request`, `cancel_appointment_as_business`,
`complete_appointment`, `mark_appointment_no_show`, `set_appointment_blocked_range`,
`set_location_service_mode`, `set_barber_service_mode_override`,
`set_service_mode_temporary_override`, `clear_service_mode_temporary_override`,
`set_location_queue_open`, `set_organization_marketplace_visible`,
`create_organization`, `complete_organization_onboarding`, `save_business_profile`,
`apply_starter_services`, `apply_weekly_hours`, `accept_invitation`,
`revoke_invitation`, `offboard_barber`, `assign_barber_professional` — toutes SD,
toutes org-scopées par `private.can_manage_*`/RLS. Écrans P3.

### Écriture — platform

`review_professional_application`, `review_professional_claim`,
`assign_commercial_plan`, `create_platform_invitation`,
`start/end_platform_support_session`, `publish_external_professional`
(**B1** : publie réellement — elle créait l'identité sans jamais la rendre
visible), `withdraw_external_professional` (**B1**, nouvelle : dépublie une
identité non revendiquée et l'audite ; refuse sur une identité revendiquée),
`create_external_professional`, plus la famille prospect/outreach. Écrans P5.

Côté Pro, **B1** ajoute `get_location_queue_check_in` (jeton QR + trois seuils
de file, owner/manager/réceptionniste) et
`regenerate_location_queue_check_in_token` (owner/manager : invalide toutes les
copies imprimées). Écran P3 « imprimer le QR de la file » — à construire.

### Maintenance (jamais appelées par le front)

`expire_pending_appointments` / `run_booking_maintenance` (conteneur
`fadeup-scheduler`, rôle dédié à EXECUTE unique), `apply_appointment_no_show_rule`,
`recover_stale_prospect_job_leases`, triggers `enforce_*`, `guard_*`, `handle_*`,
`analytics_*`, `set_updated_at`, `stamp_passport_identity`, auto-follow.

---

## 2. Cartographie écran → source

Statuts : OK = tout branché ; PARTIEL = fonctionne avec états vides honnêtes ou
écart documenté ; BLOQUÉ = aucune source, jamais comblé par une invention.

### P2 — Consumer

| Écran | RPC principale | RPC secondaires | Realtime | Statut |
|---|---|---|---|---|
| Accueil | `get_my_appointments`, `get_my_queue_status` | `list_my_followed_professionals`, `search_public_professionals` (près de vous), `get_my_favorites` | notifications | **OK** |
| Recherche / Marketplace | `search_public_professionals` (**B1 : le défaut est désormais correct**, V6) | `get_public_currencies` | — | **OK** |
| Profil salon | `get_public_organization` | `list_public_locations/services/organization_barbers`, `get_public_service_state`, `get_public_queue_status`, follows org | queue (poll public) | **OK** |
| Profil barber | `get_public_barber` | `get_public_professional`, `list_public_barber_services`, `get_public_service_state` | — | **PARTIEL** — pas de portfolio (pas de tables posts), pas d'avis |
| Profil non revendiqué | `get_public_professional` / `_by_handle` (**B1**) | — | — | **PARTIEL** — la publication d'un profil non revendiqué fonctionne et `claim_state` est exposé (B1) ; le tunnel de demande `pending` n'existe toujours pas (V1, → B2) |
| Réservation (flow) | `get_public_available_slots`, `book_public_appointment` | `list_public_services/barbers`, `get_public_service_state` | — | **OK** (confirmation immédiate uniquement) |
| Écran « demande envoyée » (pending) | — | — | — | **BLOQUÉ** — aucune RPC ne crée de `pending` à la réservation (V1) |
| Réservations | `get_my_appointments` | `cancel_my_appointment`, `reschedule_appointment` | notifications INSERT | **OK** |
| File active | `get_my_queue_status` | `get_public_queue_status`, `join_public_queue` | `queue_entries` (authentifié) / poll | **OK** — B1 livre la preuve de présence : l'écran doit lire le QR et demander la position, et savoir afficher les huit motifs de refus (V8) |
| Fade Passport | `.from('customer_passports')` (RLS owner) | `create/revoke_passport_share`, `get_shared_passport` | — | **OK** |
| Compte | `.from('profiles')`, `.from('customer_profiles')` (RLS own) | follows, favorites | — | **OK** |
| Activité / notifications | `.from('notifications')` (RLS own) | `mark_*_read` | `notifications` INSERT | **OK** |
| Dépôt d'avis | — | — | — | **BLOQUÉ** — aucune table, aucune RPC (V8) |
| Auth légère dans le flux | Supabase Auth (magic link/OTP) + `redeem_appointment_claim` | `get_my_access` | — | **OK** |

### P3 — Pro

| Écran | RPC principale | RPC secondaires | Realtime | Statut |
|---|---|---|---|---|
| TODAY / NOW / NEXT / QUEUE | `get_calendar_appointments` | `get_service_mode_state`, queue org (`.from('queue_entries')` RLS), `complete_appointment`, `mark_appointment_no_show` | `appointments`, `queue_entries` | **OK** |
| Agenda (jour/semaine) | `get_calendar_appointments` | `reschedule_appointment`, `set_appointment_blocked_range`, `get_available_slots` | `appointments`, `time_blocks` | **OK** |
| Demandes | `get_booking_requests` | `confirm_booking_request`, `decline_booking_request` | `appointments` | **OK** (mais flux vide tant que rien ne crée de `pending` hors reports — V1) |
| File pro | `.from('queue_entries')` org (RLS) | `set_location_queue_open`, modes | `queue_entries` | **OK** |
| Catalogue | `.from('services')` etc. (RLS org) | `apply_starter_services` | — | **OK** |
| Équipe | `.from('staff_profiles')`, `.from('memberships')` | invitations, `offboard_barber` | `memberships` | **OK** |
| CRM | `.from('customers')` (RLS org) | `link_customer_from_contact_info` | — | **OK** (pas de « total dépensé » — aucun montant encaissé, par design) |
| Insights | `get_organization_analytics_summary` | `get_professional_analytics_summary`, `get_organization_retention_cohort` | — | **OK** |
| Rétention | `get_organization_retention_cohort` | `.from('customer_memberships')` | — | **PARTIEL** — pas de campagnes/promotions en base |
| Billing | `get_organization_entitlements` | `.from('commercial_plans')` (SELECT authenticated) | — | **BLOQUÉ** — catalogue live ≠ spec (V5) + aucune intégration Stripe en base (0 occurrence) |
| Réglages / modes | `get_service_mode_state` | `set_*_service_mode*` | `location_service_settings`, `service_mode_overrides` | **OK** |
| Onboarding pro | `get_organization_readiness` | `create_organization`, `complete_organization_onboarding`, `apply_weekly_hours`, `apply_starter_services` | — | **OK** |
| Éditeur de profil public | `save_business_profile`, `.from('staff_profiles')` | `set_organization_marketplace_visible` | — | **OK** |
| Revendication (côté pro) | `submit_professional_claim` | `get_my_professional_application` | — | **PARTIEL** — première demande offerte non implémentée (V2) |

### P4 — Social & avis

| Écran | RPC principale | RPC secondaires | Realtime | Statut |
|---|---|---|---|---|
| Publication (composer) | — | — | — | **BLOQUÉ** — tables `posts/post_media/post_services/post_likes` absentes (MASTER_SPEC §18) |
| Portfolio sur profils | — | — | — | **BLOQUÉ** — idem |
| Viewer de post + like | — | — | — | **BLOQUÉ** — idem |
| Follows (gestion) | `list_my_followed_*`, `unfollow_*` | — | — | **OK** |
| Avis (dépôt, réponse pro, signalement) | — | — | — | **BLOQUÉ** — domaine entier à créer (V8) |
| Réputation agrégée | — | — | — | **BLOQUÉ** — dépend des avis |

### P5 — Platform

| Écran | RPC principale | Statut |
|---|---|---|
| Console existante (35 pages : acquisition, outreach, data science, applications, orgs, équipe, audit) | déjà branchée (`lib/queries/*` conservés à la purge) | **OK** |
| Funnel d'acquisition | `get_platform_analytics_funnel` | **OK** |
| Arbitrage claims concurrents | `review_professional_claim` | **OK** |
| Promotions de lancement | — | **BLOQUÉ** — aucune table de promotion/remise |
| Réglages globaux produit (limites réservation, capacité file…) | — | **BLOQUÉ** — valeurs en colonnes org (`booking_request_ttl_minutes`) mais pas de table de réglages plateforme |
| Retrait marketplace (72 h) | `set_organization_marketplace_visible` | **PARTIEL** — pas de workflow de demande datée |

---

## 3. Enums métier

| Enum | Valeurs | Signification UI | État visuel |
|---|---|---|---|
| `appointment_status` | pending, confirmed, completed, cancelled, no_show | demande en attente / confirmé / terminé / annulé / absent | attente = ambre (pro), confirmé = vert, terminé = neutre, annulé/no-show = rouge (pro uniquement) |
| `appointment_resolution` | declined, expired, cancelled_by_customer, cancelled_by_business, rescheduled | pourquoi l'état terminal | texte secondaire, jamais une couleur seule |
| `queue_status` | waiting, called, in_service, completed, cancelled, no_show | position → appelé → au fauteuil | called = moment de marque (vert interaction) |
| `service_mode` | hybrid, reservation_only, queue_only, unavailable | ce que le profil accepte | pilote l'affichage des CTA Réserver / File |
| `follow_state` | following, unfollowed | tombstone durable | bouton Suivre/Suivi |
| `professional_claim_state` | unclaimed, claimed | profil revendiqué ou non | badge « non revendiqué » explicite, jamais fabriqué |
| `professional_claim_status` | pending, approved, rejected, withdrawn | cycle de revendication | P3/P5 |
| `notification_type` | booking_request_created, booking_confirmed, booking_declined, booking_expired, booking_cancelled, booking_rescheduled, team_invitation | catégories d'activité | icône par type |
| `commercial_family` | free, independent, salon, multi_salon | famille de plan | P3 Billing (⚠ V5) |
| `commercial_status` | active, past_due, canceled | santé de l'abonnement | past_due = avertissement |
| `entitlement_source` | early_access, platform_grant, billing | d'où vient le plan | badge discret P3/P5 |
| `membership_role` | owner, manager, receptionist, barber | rôles pro | gating UI (jamais autorité) |
| `professional_application_status` | pending_review, approved, rejected | candidature | P3 Onboarding |
| `waitlist_status` | waiting, notified, booked, cancelled, expired | V1+ (waitlist) | non exposé au lancement |
| `business_type` | solo_professional, barbershop, hair_salon, mixed_salon, multi_location | **interne — ne jamais afficher** ; seul `marketplace_supply_type` (independent/barbershop) est public | — |
| `customer_style_preference` | fade, taper, crop, buzz, afro, curly, long, beard_focus, other | préférences Passport | libellés localisés |

## 4. Realtime

Publication `supabase_realtime` (constatée) :

| Table | Événement | Clés à invalider | Écran |
|---|---|---|---|
| `appointments` | INSERT/UPDATE | agenda pro fenêtré, demandes, TODAY | P3 Agenda, Demandes, TODAY |
| `queue_entries` | INSERT/UPDATE | file org, statut file client | P3 QUEUE, P2 File active |
| `notifications` | INSERT | notifications, badge, `get_my_appointments` | P2 Activité, Réservations |
| `location_service_settings` | UPDATE | état de mode | P2 profils / P3 réglages |
| `service_mode_overrides` | INSERT/UPDATE | état de mode | idem |
| `time_blocks` | INSERT/UPDATE/DELETE | agenda | P3 Agenda |
| `memberships` | INSERT/UPDATE | équipe, accès | P3 Équipe, gardes |

Surfaces anonymes : `anon` n'a aucun SELECT ⇒ pas de Postgres Changes ; le
poll (6 s file publique, 120 s état de service) reste le contrat, comme
l'implémentation conservée (`lib/realtime.ts`) le documente. Rappels
architecture : invalidation de clés, jamais confiance au payload ; écriture
directe de cache réservée à la file ; fallback poll obligatoire.

## 5. Vérifications V1 à V8

### V1 — Le tunnel `pending` — **ÉCART MAJEUR : non implémenté à la création**

`book_public_appointment` insère **inconditionnellement en `confirmed`** :

```sql
-- CONFIRMED, not pending. Everything above has already established that the
-- shop works this time, at this place, for this service, with this
-- professional — there is no further question for a human to answer.
insert into public.appointments ( … status … )
values ( … 'confirmed' … )
```

1. **Condition de sortie en `pending`** : aucune. Aucune branche conditionnelle
   n'existe ; le commentaire du type le confirme :
   `COMMENT ON TYPE appointment_status IS 'pending: reserved for a future
   online booking-request flow (LOT 9) …'`. La seule voie vers `pending` est le
   report client (`enforce_appointment_transition` :
   `if v_from = 'confirmed' and v_to = 'pending' … only through a customer
   reschedule`, flag `fadeup.appointment_reschedule` posé par
   `reschedule_appointment`).
2. **Dépendance plan/revendication** : aucune. `enforce_booking_service_mode`
   vérifie la capacité commerciale `booking` (`private.assert_org_capability`)
   et le mode de service — un profil Free/non revendiqué sans capacité
   `booking` est simplement **refusé**, pas mis en attente.
3. **`expires_at`** : correctement plafonné —
   ```sql
   new.expires_at := now() + make_interval(mins => coalesce(v_ttl, 1440));
   new.expires_at := least(new.expires_at, new.starts_at);
   ```
   (`set_appointment_request_expiry`, TTL par org
   `booking_request_ttl_minutes` défaut 1440, bornes 15 min–14 j). La demande
   pour ce soir 18 h ne peut pas expirer demain. ✓ spec.
4. **Sweep** : pas de `pg_cron` (`cron.job` inexistant, `15_cron.txt` :
   « no pg_cron »). `expire_pending_appointments` est appelé par le conteneur
   **`fadeup-scheduler`** (boucle shell → `run_booking_maintenance`, rôle
   `fadeup_scheduler` avec EXECUTE sur cette seule fonction). Le conteneur
   tourne (healthcheck heartbeat).
5. **Retour** : `TABLE(id, starts_at, ends_at, status, claim_token)` —
   `claim_token` (64 hex, hashé en base, 72 h) seulement pour un anonyme.

**Conclusion** : l'aval du tunnel (TTL, expiration, confirm/decline,
notifications `booking_request_created/confirmed/declined/expired`) est
construit et correct ; **l'amont n'existe pas** — rien ne crée de `pending`
vers un profil Free ou non revendiqué, et un profil non revendiqué n'est même
pas réservable (pas d'organisation/location/services). La boucle d'acquisition
décrite par MASTER_SPEC §3 (« la demande en attente est l'argument de vente »)
n'a pas de support. **Bloquant pour l'écran « demande envoyée » de P2 et pour
l'e-mail prospect.** Recommandation : contrat backend dédié (hors P1) — voie
de demande vers profils non revendiqués sortant en `pending` + e-mail.

### V2 — Première demande offerte — **MANQUANT CONFIRMÉ**

```
grep -niP 'free_(request|booking|accept)|first_(request|booking)|trial_booking|grace' SCHEMA.sql
→ 455: 'first_booking'   (enum outreach_event_type — jalon de tracking, pas une règle)
→ 2090/2097: v_grace_minutes (règle no-show, sans rapport)
```

`confirm_booking_request` (extrait ci-dessous) ne consulte ni plan ni compteur
de gratuité : verrou, autorisation `private.can_manage_appointments`,
idempotence, course accept-vs-expire, puis `status='confirmed'`. Aucun mur
payant, aucun crédit gratuit.

```sql
if not (select private.can_manage_appointments(v_appointment.organization_id)) then
  raise exception 'not authorized to manage this booking' …
if v_appointment.status = 'confirmed' then return v_appointment; -- idempotent
if v_appointment.expires_at is not null and v_appointment.expires_at <= now() then
  raise exception 'this request has expired' …
update public.appointments set status = 'confirmed', decided_at = now(), decided_by = (select auth.uid()) …
```

**Conclusion** : « une demande acceptée gratuitement après revendication »
n'existe nulle part. Écart majeur, même prompt backend que V1.

### V3 — Auto-follow contre désabonnement — **CONFORME, PAS DE BUG**

Les deux triggers délèguent à `private.auto_follow_professional` :

```sql
-- DO NOTHING, and there is deliberately no DO UPDATE branch. This is the
-- single clause that makes an explicit unfollow permanent …
insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at)
values (p_follower_user_id, v_professional_id, 'following', 'auto', now())
on conflict (follower_user_id, professional_id) do nothing;
```

Et `unfollow_professional` pose un **tombstone durable** :

```sql
-- The INSERT branch is what makes an unfollow durable even when no edge
-- exists yet: it lays the tombstone that a later auto-follow will collide with.
values (v_user_id, p_professional_id, 'unfollowed', 'manual', null, now())
on conflict … do update set state = 'unfollowed', …
    unfollowed_at = coalesce(public.professional_follows.unfollowed_at, now());
```

Un désabonnement explicite tient ; une nouvelle réservation ne re-force jamais
le follow. Bonus conforme : l'auto-follow ne vise que `claim_state='claimed'`.
Détail : `appointments_auto_follow` se déclenche sur **confirmed** (création),
`queue_entries_auto_follow` sur **completed** — asymétrie volontaire acceptable.

### V4 — Passport automatique — **CONFORME**

```sql
CREATE TRIGGER customer_profiles_issue_passport AFTER INSERT ON public.customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.customer_profiles_issue_passport();
-- COMMENT: 'Becoming a FadeUp customer IS having a Fade Passport (Constitution §2.2)
--  — there is no "Get Passport" action to take.'
```

`private.ensure_customer_passport` : `insert … on conflict (user_id) do nothing`
(idempotent, concurrent-safe). Numéro serveur-généré (80 bits), gelé par
`guard_passport_identity`. La contradiction notée par MASTER_SPEC §20 est
**déjà résolue en base** — la langue produit ne doit jamais dire « Créez votre
Fade Passport ». Nuance : l'émission suit la création de `customer_profiles`
(l'onboarding client), pas la création du compte auth brut — acceptable, à
énoncer tel quel dans l'UI.

### V5 — Plans et capacités — **ÉCART BLOQUANT pour P3 Billing**

Catalogue live (`commercial_plans`, 2026-09-04) :

```
free            | free        | Free      |     0 € | 1 étab. | 1 pro
solo            | independent | Solo      | 19,00 € | 1 étab. | 1 pro
salon_essential | salon       | Essential | 29,00 € | 1 étab. |
salon_pro       | salon       | Pro       | 49,00 € | 1 étab. |  (recommandé ✓)
salon_business  | salon       | Business  | 79,00 € | 1 étab. |
multi_growth    | multi_salon | Growth    | 99,00 € | 2 étab. |
multi_pro       | multi_salon | Pro       |149,00 € | 5 étab. |  (recommandé)
multi_scale     | multi_salon | Scale     |249,00 € | 10 étab.|
```

Spec attendue : Free 0 / Independent **20** / Shop Essential **35** /
Shop Pro 49 / Shop Scale **69**, par établissement, annuel = 10 mois, essai
14 j sans carte, « pas de sixième plan ».

Écarts : **prix** (19≠20, 29≠35, 79≠69), **noms/codes** (`salon_business` vs
« Shop Scale »), **famille `multi_salon` entière** (3 plans par *organisation*
multi-établissements, contraire à « chaque location porte son abonnement »),
**aucun support d'annuel** (pas de `billing_interval` sur les plans, prix
mensuel unique), **aucun mécanisme d'essai 14 j** (seul un statut `trial` de
pipeline prospect existe), **zéro intégration Stripe** (0 occurrence dans le
schéma). Cohérences : Free = 0 € forcé par contrainte ; Independent = 1 pro
forcé ; Shop Pro recommandé ✓ ; per-établissement (jamais par fauteuil) ✓.

**Forme du retour `get_organization_entitlements`** : une seule ligne SQL
(pas de JSON) — plan assigné + `effective_plan_key`, plafonds/usages
(`max/used_establishments`, `max/used_operational_professionals`), et deux
tableaux : `live_capabilities` (capacités livrées, à utiliser pour le gating)
et `packaged_capabilities` (promesse commerciale). Le shell pro (P1b) se
branche sur `live_capabilities` + `my_organization_has_capability`.

### V6 — Offre marketplace — **RESTRICTION POSSIBLE, DÉFAUT DANGEREUX**

La RPC unionne deux CTE : `shop_base` (organisations×locations, ce qui inclut
les Independents puisqu'un indépendant EST une organisation
`solo_professional`) et `barber_base` (staff individuels). Test live :

```
select entity_type, … from search_public_professionals();
shop   | Side Agency | … | barbershop
barber | Side Agency | Barber Test | barbershop      ← staff en résultat autonome
```

**CORRIGÉ PAR B1 (2026-09-04).** Le défaut, `NULL`, la chaîne vide et toute
valeur non reconnue signifient désormais **`'shop'`** — exactement Independent
+ Barbershop. Un front qui oublie le paramètre ne peut plus enfreindre la loi
produit du §2. Deux valeurs explicites restent disponibles : `'barber'` (les
barbers salariés seuls) et `'all'` (l'union, l'ancien comportement, à demander
par son nom). Une valeur inconnue retombe sur la réponse la plus étroite, à
l'inverse de `p_sort` dont l'inconnu retombe sur le défaut le plus large —
parce que le mode de défaillance de l'un est un tri surprenant et celui de
l'autre est la publication d'une offre que FadeUp ne vend pas.

Appelants inspectés avant de trancher : `features/demo/api/discovery.ts`
(passe `'shop'`, inchangé) ; `lib/queries/marketplace.ts` (passe `null`
explicitement — module sans importeur depuis la purge R5R, son comportement
passe de faux à juste) ; **`/platform` n'appelle ni cette RPC ni
`search_public_organizations`** ; le worker non plus.
Le mapping `marketplace_supply_type` est en base, énuméré valeur par valeur,
inconnu ⇒ NULL (jamais le cas commun) — le front n'expose jamais `business_type`.

**B1 ajoute la géographie des zones de service.** `location_kind` vaut
`physical_address` ou `service_area`. Sur une adresse, `latitude/longitude`
portent l'établissement et les colonnes `service_area_*` sont NULL ; sur une
zone c'est l'inverse — `latitude/longitude` sont **NULL, aucune adresse n'est
inventée** (contrainte `locations_service_area_has_no_address`) — et la zone
est décrite par `service_area_center_latitude/longitude` +
`service_area_radius_km`. `distance_km` mesure jusqu'à l'adresse ou jusqu'au
**centre de la zone** ; `covers_search_point` vaut `true` quand la zone du
professionnel atteint le client, `NULL` s'il n'y a pas de zone ou pas de point
de recherche. Le filtre `p_radius_km` garde une ligne dont la zone couvre le
point **même si son centre est plus loin** (MASTER_SPEC §8).

Paramètres (tous optionnels) : `p_country` (égalité), `p_city` (ilike préfixe,
unaccent), `p_query` (nom org/ville/nom barber), `p_service_query` (nom de
service actif), `p_latitude/p_longitude` (active `distance_km`),
`p_radius_km`, `p_min/max_price_cents` (sur « à partir de » ; NULL passe),
`p_open_now_only` (défaut false), `p_entity_type` ('shop'|'barber'|NULL),
`p_limit` 20 / `p_offset` 0, `p_sort` ∈ {recommended (défaut+fallback),
nearest, price} — inconnus-en-dernier soigné (`nulls last` sur distance et
prix). `queue_waiting_count` borné à aujourd'hui dans le fuseau du lieu,
et par barber pour une ligne barber. `total_count` fenêtré exact.

### V7 — Contrainte de langue — **CONFORME, 10 valeurs**

```sql
CONSTRAINT profiles_locale_valid CHECK (locale IS NULL OR locale = ANY
  (ARRAY['en','fr','es','de','it','pt','ar','zh-CN','ja','ru']))
```

FR et EN sont autorisés ✓. Le sélecteur de lancement n'expose que `fr`/`en` ;
les huit autres valeurs restent légales en base (moteur international
préservé, RTL `ar` compris). `profiles.theme` ∈ {light, dark, system}.

### V8 — Systèmes absents — **CONFIRMÉ ABSENTS (3/3)**

```
grep -ciP 'create table public\.(reviews|ratings)'      → 0
grep -ciP 'wallet|pkpass|apple_pass|google_pass'         → 0
grep -ciP 'geofence|qr_code|check_?in_radius'            → 0
```

- **Avis natifs** : rien. À créer par le prompt P4 (tables `reviews` +
  agrégation réputation, conventions §18 de MASTER_SPEC).
- **Passes Wallet** : rien. Prompt dédié post-P2 (dépend du Passport, déjà en base).
- **QR + géofence de file** : ~~rien~~ — **LIVRÉ PAR B1 (2026-09-04)**.
  `locations.queue_check_in_token` (32 hex, unique, régénérable par
  owner/manager) porte le QR affiché en salon ;
  `location_service_settings` porte les trois seuils, réglables par
  établissement : `queue_geofence_meters` (150), `queue_call_grace_minutes`
  (5, **stocké et exposé, pas encore balayé** — aucun sweep ne passe une
  entrée appelée en absente), `queue_capacity_per_barber` (20, appliqué à la
  porte publique seulement — un réceptionniste qui ajoute un walk-in au
  comptoir n'est pas bloqué). La vérification de distance est **serveur** :
  appeler l'API directement ne contourne rien.

  **Limite honnête, à ne pas maquiller côté produit** : la géolocalisation
  d'un navigateur est falsifiable et un QR affiché en salon peut être
  photographié. Ce mécanisme réduit l'abus opportuniste ; il ne le supprime
  pas. Rien en aval ne doit traiter une entrée en file comme la preuve qu'une
  personne était physiquement présente.

  **Cas mobile tranché** : une location `service_area` n'a aucun point
  physique, donc aucune géofence honnête. **La file n'est pas disponible sur
  une zone de service** — `queue_accepting_new_entries` vaut `false` et
  `join_public_queue` refuse par `service_area_has_no_queue`. Le mode
  `queue_only` reste représentable sur une telle location mais n'admet
  personne : interdire la valeur aurait exigé des triggers de cohérence sur
  deux tables et aurait fait échouer une simple conversion de location.

  **Les huit motifs de refus**, distinguables par `DETAIL:
  fadeup_queue_refusal=<code>` (PostgREST le remonte dans `details`) :
  `service_area_has_no_queue`, `invalid_check_in_token`,
  `location_not_geolocated` (l'établissement n'a pas publié ses coordonnées —
  à corriger côté salon, pas côté client), `position_required`, `too_far`,
  `queue_closed`, `queue_full`, `already_in_queue`. **P2 branche sur le code,
  jamais sur le texte.**
- Absents aussi, constatés au passage : tables de posts sociaux (P4),
  promotions plateforme (P5), Stripe (P3).

## 6. Écarts spec ↔ base

| Écart | Gravité | Prompt concerné | Recommandation |
|---|---|---|---|
| Tunnel `pending` d'acquisition inexistant à la création (V1) | **bloquant** (pour la boucle d'acquisition, écran « demande envoyée », e-mails prospect) | backend dédié avant P2 | RPC de demande vers profils Free/non revendiqués sortant en `pending` ; l'aval existe déjà |
| Première demande offerte non implémentée (V2) | majeur | même prompt backend | compteur/crédit au niveau org + garde dans `confirm_booking_request` |
| Catalogue de plans ≠ spec : prix, noms, famille multi_salon, pas d'annuel, pas d'essai 14 j (V5) | **bloquant** (P3 Billing) | P3 + décision fondateur | trancher : la spec (0/20/35/49/69, par établissement) ou le catalogue — puis migrer les données, jamais coder en dur |
| Stripe absent de la base (V5) | **bloquant** (P3 Billing self-service) | P3/backend | tables d'abonnement + webhooks avant tout écran Billing |
| ~~`search_public_professionals` retourne les staff par défaut (V6)~~ | ~~majeur~~ | **RÉSOLU — B1** | défaut inversé en base ; `'all'` est l'opt-in nommé |
| ~~`join_public_queue` sans QR ni géofence (V8)~~ | ~~majeur~~ | **RÉSOLU — B1** | QR d'établissement + géofence serveur, seuils réglables, 8 motifs de refus nommés |
| ~~Profils non revendiqués impubliables (contrainte `professionals_publication_eligibility`)~~ | ~~critique~~ | **RÉSOLU — B1** | contrainte resserrée sur le nom seul + garde `professionals_guard_publication` exigeant une ancre de corroboration pour un non revendiqué |
| ~~`get_public_service_state` en 405 pour tout appelant~~ | ~~critique~~ | **RÉSOLU — B1** | l'écriture est sortie des deux lectures STABLE |
| ~~Aucun modèle de zone de service (professionnel mobile)~~ | ~~majeur~~ | **RÉSOLU — B1** | `locations.kind` + centre/rayon, readiness accepte les deux, recherche géographique par couverture |
| `TRUNCATE` accordé à `anon` (54 tables) et `authenticated` (87), hors RLS | **majeur** | lot de durcissement dédié | B1 a traité ses 4 tables ; les 83 autres restent. Voir BLOCKERS.md §4 |
| Aucune organisation ne détient la capacité `booking` : toutes sont en `free` | **bloquant** (P2 réservation) | B2 / décision fondateur | c'est le tunnel `pending` (V1) qui doit répondre à ce cas, pas un refus sec |
| Avis absents (V8) | majeur (assumé — « à créer entièrement ») | P4 | domaine `reviews` selon MASTER_SPEC §10/§18 |
| Posts sociaux absents | majeur (assumé) | P4 | `posts/post_media/post_services/post_likes`, pas de `post_comments` |
| Wallet/pkpass absent (V8) | mineur (post-lancement possible) | prompt dédié | — |
| Promotions plateforme absentes | mineur | P5 | table + activation datée, « aucune remise codée en dur » |
| Réglages produit globaux (5 résa simultanées, 20/barber, 5 min d'appel) absents en table plateforme | mineur | P5 | table de réglages plateforme surchargeable par salon |
| `profiles.locale` accepte 10 langues mais le lancement n'en livre 2 | mineur (aucun) | P1b i18n | sélecteur limité à fr/en, moteur inchangé |
| Onglet Feed : P1a §2.3 impose 5 onglets avec Feed, MASTER_SPEC §20 tranche 4 onglets sans Feed | contradiction documentaire | **décision fondateur avant P1b** | non tranché ici (P1a ne construit pas la nav) |

## 7. Fonctionnalités backend sans écran prévu

- `search_public_organizations` — redondante avec `search…professionals(p_entity_type='shop')` ; à consommer ou déprécier.
- `organization_dashboard_layouts` + `private.valid_dashboard_module_keys` — persistance d'ordre de modules du dashboard R5 rejeté ; dormante, ne pas reverter (décision R5R0 §13), re-scoper quand P3 recompose le dashboard.
- `waitlist_entries` + `waitlist_status` — la waitlist est V1+ ; la base est prête, aucun écran au lancement.
- `customer_memberships` (abonnements/fidélité salon) — partiellement couvert par P3 Rétention ; le côté client (« mes abonnements ») n'a pas d'écran défini.
- `booking_availability_status`, `booking_provider_observations` — intelligence Worker sur les fournisseurs de réservation ; lecture `/platform` seulement.
- `appointment_claim_tokens` / `redeem_appointment_claim` — le rattachement post-inscription doit être explicitement intégré au flux d'auth légère de P2 (facile à oublier).
- `get_invitation_by_token` / `accept_platform_invitation` — portes d'invitation ; écrans P3/P5 à ne pas omettre.
- Champ `profiles.theme` — un réglage thème existe en base ; le produit consumer est clair d'abord : décider si on l'expose.

## 8. Systèmes à créer

1. **Tunnel de demande d'acquisition** (V1+V2) : demande `pending` vers profils Free/non revendiqués, e-mails prospect (3 touches max, e-mail uniquement), première acceptation offerte, exposition minimale des données personnelles avant vérification. L'aval (TTL, sweep scheduler, confirm/decline, notifications) existe.
2. **Avis** (P4) : `reviews` 1–5 + commentaire facultatif, lien au rendez-vous `completed`, rattachement barber **et** org, réponse publique, signalement, fenêtre 30 j, agrégation de réputation. Conventions : contraintes `<table>_<règle>`, `set_updated_at`, `check_<table>_consistency`, accès public par `get_public_*`, RLS forcée.
3. **Publications sociales** (P4) : `posts`, `post_media` (≤10, vidéo ≤60 s), `post_services`, `post_likes` ; bucket `post-media` non public à URL signées (modèle `passport-photos`). Pas de commentaires, pas de hashtags.
4. **Présence physique en file** (avant P2 file) : QR du salon + géofence 150 m dans `join_public_queue`.
5. **Billing réel** (P3) : réconciliation du catalogue avec la décision tarifaire, annuel 10/12, essai 14 j sans carte, intégration Stripe (webhooks → `organization_commercial_state`, `entitlement_source='billing'`).
6. **Wallet/pkpass** (post-P2) : passes Apple/Google adossées au Passport.
7. **Promotions de lancement** (P5) : table pilotée depuis `/platform`, datée, jamais codée en dur.
