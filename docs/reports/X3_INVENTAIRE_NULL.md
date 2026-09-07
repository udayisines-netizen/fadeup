# X3 — Inventaire exhaustif du motif NULL (annexe du rapport)

108 fonctions utilisant `auth.uid()` (état du dump `pre-x3-20260907-140110`),
chacune lue intégralement ; verdict AVANT correctifs X3. Les 343 policies RLS
ont été auditées séparément (§5). Les fonctions marquées ♦ ont été modifiées
par `20260907170000_x3_null_guard_fixes.sql`.

Légende des motifs sûrs :
- **is-null** : rejet `if auth.uid() is null then raise` en tête ;
- **exists** : garde déléguée à un helper `private.*` en `exists(...)` —
  rend false, jamais NULL ;
- **where** : filtre `where col = auth.uid()` + `if not found`/0 ligne —
  échoue-fermé ;
- **coalesce/distinct** : comparaison NULL-sûre explicite.

## 1. Fonctions 001–027

| Fonction | SEC | Verdict | Motif |
|---|---|---|---|
| private.analytics_trigger_actor | INV | SÛRE | branches NULL explicites, ACL postgres seul |
| private.assert_billing_owner | DEF | SÛRE | is-null + exists |
| private.assert_organization_creation_authorized ♦ | DEF | DOUTEUSE→durcie | échappatoire `uid NULL ⇒ passe` (fail-open volontaire) |
| private.assert_service_mode_authority | DEF | SÛRE | not-found + is-distinct-from + exists, raise final |
| private.can_view_post | DEF | SÛRE | exists |
| private.can_view_review_photo_path | DEF | SÛRE | prédicat NULL ⇒ ligne exclue |
| private.has_org_role | DEF | SÛRE | exists |
| private.has_platform_role | DEF | SÛRE | exists |
| private.is_org_barber | DEF | SÛRE | exists |
| private.is_org_member | DEF | SÛRE | exists |
| private.is_own_barber | DEF | SÛRE | exists |
| private.is_own_professional | DEF | SÛRE | exists |
| private.is_platform_admin | DEF | SÛRE | exists |
| private.is_platform_owner | DEF | SÛRE | exists |
| private.log_prospect_status_change (trg) | DEF | SÛRE | is-distinct-from |
| private.outreach_templates_stamp_approval (trg) | DEF | SÛRE | coalesce + is-distinct-from |
| private.professional_posts_page | DEF | SÛRE | délègue à can_view_post (exists) — ACL PUBLIC implicite révoquée par 172000 |
| private.prospect_duplicates_stamp_review (trg) | DEF | SÛRE | is-distinct-from |
| private.queue_entry_client_access | DEF | SÛRE | coalesce (LE correctif F1b) |
| public.accept_invitation | DEF | SÛRE | is-null + not-found + email NOT NULL |
| public.accept_platform_invitation | DEF | SÛRE | is-null + traitement explicite du nullable |
| public.assign_commercial_plan | DEF | SÛRE | is-null + exists |
| public.book_public_appointment ♦ | DEF | SÛRE (durcie) | anon voulu ; garde `p_starts_at is null` ajoutée (fermeture aval accidentelle avant) |
| public.cancel_appointment_as_business | DEF | SÛRE | not-found + exists |
| public.cancel_my_appointment | DEF | SÛRE | where |
| public.change_queue_entry_barber | DEF | SÛRE | helpers coalesce/exists, is-not-distinct-from |
| public.claim_platform_owner_bootstrap | DEF | SÛRE | is-null + not-found |

## 2. Fonctions 028–054

| Fonction | SEC | Verdict | Motif |
|---|---|---|---|
| public.classify_outreach_reply | DEF | SÛRE | exists |
| public.clear_service_mode_temporary_override | DEF | SÛRE | assert fail-closed |
| public.complete_appointment | DEF | SÛRE | exists (2 branches) |
| public.complete_marketplace_withdrawal | DEF | SÛRE | is-null + exists |
| public.complete_organization_onboarding | DEF | SÛRE | is-null puis délègue à create_organization |
| public.confirm_booking_request | DEF | SÛRE | exists |
| public.create_external_professional | DEF | SÛRE | exists + session_user (jamais NULL) |
| public.create_organization | DEF | DOUTEUSE→laissée | `v_status` NULL traverse la garde de candidature — VOULU (self-serve = chemin d'installation normal) |
| public.create_passport_share | DEF | SÛRE | is-null + exists + coalesce |
| public.create_platform_invitation | DEF | SÛRE | énumération exhaustive + NOT NULL colonne |
| public.create_post | DEF | SÛRE | is-null + else raise |
| public.create_professional_interest_request ♦ | DEF | DOUTEUSE→durcie | horodatage NULL traversait les gardes temporelles (rattrapé par NOT NULL) — rejet nommé ajouté |
| public.create_prospect_discovery_job | DEF | SÛRE | exists (admin seul) |
| public.decline_booking_request | DEF | SÛRE | exists |
| public.end_platform_support_session | DEF | SÛRE | where |
| public.ensure_owner_professional | DEF | SÛRE | is-null + exists |
| public.favorite_shop | DEF | SÛRE | is-null |
| public.follow_organization | DEF | SÛRE | is-null + raise sur slug NULL |
| public.follow_professional | DEF | SÛRE | is-null + exists |
| public.get_feed | DEF | SÛRE | uid NULL restreint (public seulement), n'élargit pas |
| public.get_my_access | DEF | SÛRE | `where uid is not null` |
| public.get_my_appointments | DEF | SÛRE | where |
| public.get_my_favorites | DEF | SÛRE | where |
| public.get_my_interest_requests | DEF | SÛRE | where + is-not-null |
| public.get_my_professional_application | DEF | SÛRE | where |
| public.get_my_queue_status | DEF | SÛRE | where |
| public.get_organization_entitlements | DEF | SÛRE | is-null + exists (anti-énumération) |

## 3. Fonctions 055–081

| Fonction | SEC | Verdict | Motif |
|---|---|---|---|
| public.get_organization_posts | DEF | SÛRE | can_view_post (exists) |
| public.get_service_mode_state | DEF | SÛRE | exists ⇒ résultat vide |
| public.guard_customers_identity ♦ (trg) | DEF | DOUTEUSE→durcie | échappatoire uid NULL |
| public.guard_marketplace_publication ♦ (trg) | DEF | DOUTEUSE→durcie | échappatoire uid NULL |
| public.guard_professional_application_update ♦ (trg) | DEF | DOUTEUSE→durcie | échappatoire uid NULL (cascade FK préservée) |
| public.handle_new_organization (trg) | DEF | SÛRE | chemin NULL n'accorde rien |
| public.join_public_queue | DEF | SÛRE | token NOT NULL, distance NULL lève, coalesce |
| public.like_post | DEF | SÛRE | is-null + exists |
| public.list_my_followed_organizations | DEF | SÛRE | is-null + where |
| public.list_my_followed_professionals | DEF | SÛRE | where |
| public.mark_all_notifications_read | INV | SÛRE | where (+RLS) |
| public.mark_all_platform_notifications_read | INV | SÛRE | where (+RLS) |
| public.mark_appointment_no_show | DEF | SÛRE | exists (2 branches) |
| public.mark_notification_read | INV | SÛRE | where (+RLS) |
| public.mark_platform_notification_read | INV | SÛRE | where (+RLS) |
| public.moderate_review | DEF | SÛRE | exists |
| public.move_queue_entry | DEF | SÛRE | exists (corrigée en F1b, tient) |
| public.my_organization_has_capability | DEF | SÛRE | conjonctions non-NULL |
| public.override_prospect_locale | DEF | SÛRE | exists ; NULL = effacement voulu |
| public.promote_ml_model | DEF | SÛRE | exists + rejet NULL explicite |
| public.publish_external_professional | DEF | SÛRE | is-null + exists |
| public.redeem_appointment_claim | DEF | SÛRE | is-null + consommation atomique |
| public.refresh_prospect_publication_eligibility | DEF | SÛRE | exists + session_user |
| public.reissue_platform_owner_bootstrap_token | DEF | SÛRE | exists |
| public.remove_favorite | DEF | SÛRE | is-null + where |
| public.reply_to_review | DEF | SÛRE | exists (2 branches) |
| public.report_review | DEF | SÛRE | is-null |

## 4. Fonctions 082–108

| Fonction | SEC | Verdict | Motif |
|---|---|---|---|
| public.request_billing_quote | DEF | SÛRE | assert_billing_owner (is-null + exists) |
| public.request_marketplace_withdrawal | DEF | SÛRE | is-null + exists |
| public.reschedule_appointment ♦ | DEF | **VULNÉRABLE→corrigée** | `customer_id NULL IN (ensemble non vide)` = NULL ⇒ garde franchie — coalesce(false) posé |
| public.resolve_review_report | DEF | SÛRE | exists + not-found |
| public.review_professional_application | DEF | SÛRE | is-null + exists |
| public.review_professional_claim | DEF | SÛRE | is-null + exists |
| public.revoke_passport_share | DEF | SÛRE | where |
| public.revoke_platform_invitation | DEF | SÛRE | exists |
| public.set_barber_service_mode_override | DEF | SÛRE | assert fail-closed |
| public.set_location_queue_open | DEF | SÛRE | rejet NULL param + assert |
| public.set_location_service_mode | DEF | SÛRE | rejet NULL param + assert |
| public.set_organization_marketplace_visible | DEF | SÛRE | `v_role is null` testé en premier |
| public.set_outreach_campaign_status | DEF | SÛRE | exists + NOT NULL |
| public.set_service_mode_temporary_override | DEF | SÛRE | rejet NULL params + assert |
| public.start_organization_trial | DEF | SÛRE | is-null + exists + distinct + coalesce (modèle) |
| public.start_platform_support_session | DEF | SÛRE | exists |
| public.submit_professional_application | DEF | SÛRE | is-null |
| public.submit_professional_claim | DEF | SÛRE | is-null + NULL=refus explicite |
| public.submit_review | DEF | SÛRE | is-null + is-distinct-from |
| public.suppress_prospect_outreach | DEF | SÛRE | exists |
| public.sweep_prospect_publication_eligibility | DEF | SÛRE | exists + session_user |
| public.track_analytics_event | DEF | SÛRE | anonyme voulu, gardes exists/found |
| public.unfollow_organization | DEF | SÛRE | is-null + where |
| public.unfollow_professional | DEF | SÛRE | is-null + exists |
| public.unlike_post | DEF | SÛRE | where (0 ligne) |
| public.withdraw_external_professional | DEF | SÛRE | is-null + exists + not-found |
| public.withdraw_professional_claim | DEF | SÛRE | is-null + where |

Les 14 fonctions trigger `private.*` restantes de l'ensemble des 108
(assert_experiment_exposure_limits, assert_whatsapp_sendable,
booking_provider_observations_maintain_current, cancel_outreach_on_conversion,
prospect_fit_scores_maintain_current, prospect_scores_sync_prospect,
prospect_search_partitions_enforce_limits, prospect_suppressions_sync_prospect,
prospects_sync_booking_provider, prospects_sync_fit_scores,
whatsapp_accounts_reject_secrets, apply_reputation_delta, notify_social,
is_prospect_value_suppressed) : SÛRES — gardes `is distinct from`/exists ou
pas de garde d'autorisation (mécanique interne), appelées exclusivement
depuis des SECURITY DEFINER ; leur EXECUTE PUBLIC implicite est révoqué par
`20260907172000`.

## 5. Policies RLS (343)

- **49/49 policies utilisant `uid()` échouent-fermé** face à uid NULL (en
  RLS, un prédicat NULL refuse la ligne ; toutes les branches OR reposent
  sur des helpers `exists`). Vérifié motif par motif ET dynamiquement
  (`set local role` + claims simulés, transaction annulée).
- Balayage des 343 : isolation tenant A/B confirmée en dynamique ;
  **2 défauts réels trouvés et corrigés** (staff_profiles_insert
  tautologique — exploit prouvé — et staff_profiles UPDATE sans contrôle de
  `user_id`, couvert par le trigger neuf) ; **3 resserrements** appliqués
  (post_likes_select_all, queue_entry_moves_select,
  service_duration_samples_select) ; 1 observation non traitée
  (memberships_delete dernier-owner, X3_RAPPORT §12.3).

## 6. Bilan

108 fonctions : **101 sûres**, 1 vulnérable (corrigée), 6 douteuses
(4 durcies, 2 examinées et laissées avec justification). 343 policies :
338 saines, 2 corrigées, 3 resserrées. Le test qui manquait — anonyme réel
via HTTP — existe désormais : `db/tests/x3_anon_surface.sh`.
