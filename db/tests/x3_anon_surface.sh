#!/usr/bin/env bash
# FadeUp — X3 : suite de tests de la surface publique, en rôle anonyme RÉEL
# (HTTP à travers Kong), puis en rôle authentifié SANS AUCUN DROIT.
#
# POURQUOI. F1b (rapport §12.3) l'a dit : ses tests psql simulaient toujours
# une session — c'est le client anonyme réel qui a montré le trou. probe_
# public_rpcs.sh vérifie que les lectures publiques répondent 200 ; un 200 ne
# dit rien de l'autorisation. Cette suite vérifie l'ENVERS : ce qui ne doit
# pas être lisible ne l'est pas, ce qui ne doit pas être écrit ne l'est pas,
# une ressource d'autrui est refusée avec le bon motif.
#
# CE QU'ELLE COUVRE
#   1. CONTRAT DE SURFACE : la liste des RPC exécutables par anon est
#      comparée à l'allowlist consacrée ci-dessous. Toute RPC qui devient
#      anon-exécutable sans être ajoutée ICI fait échouer la suite.
#   2. Lectures publiques : délégué à probe_public_rpcs.sh (déjà le contrat).
#   3. BALAYAGE TABLES en anon : GET sur chaque table de public — aucune ne
#      doit rendre de lignes (les lectures publiques passent par des RPC
#      SECURITY DEFINER). 401 (pas de SELECT) et 200-vide (RLS) sont bons.
#   4. BALAYAGE ÉCRITURES en anon : POST/PATCH/DELETE sur chaque table —
#      rien ne doit atterrir. 400/401/404 sont des refus ; un PATCH/DELETE
#      2xx doit prouver « 0 ligne » (Prefer: return=representation).
#   5. RESSOURCE D'AUTRUI en anon : les RPC de file refusent un uuid inconnu
#      avec un motif NOMMÉ (fadeup_queue_refusal=...), jamais un succès.
#   6. Les mêmes balayages en AUTHENTIFIÉ SANS DROIT : un compte jetable est
#      créé (SQL), connecté (GoTrue), balayé, puis SUPPRIMÉ — seule écriture
#      de la suite, retirée à la fin (motif mémoire QA établi).
#
# Usage :
#   db/tests/x3_anon_surface.sh            # rapport humain
#   db/tests/x3_anon_surface.sh --strict   # exit 1 au moindre écart
#
# La suite est SANS DANGER pour les données : elle n'écrit que des tentatives
# qui doivent échouer, et le compte jetable qu'elle retire elle-même.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${FADEUP_SUPABASE_ENV:-$REPO_ROOT/infra/supabase/.env}"
[[ -r "$ENV_FILE" ]] || ENV_FILE="/opt/fadeup/infra/supabase/.env"
STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

ANON_KEY="$(sed -n 's/^ANON_KEY=//p' "$ENV_FILE" | head -1 | tr -d '\r"')"
KONG_PORT="${X3_KONG_PORT:-$(docker port fadeup-supabase-kong 8000/tcp 2>/dev/null | head -1 | sed 's/.*://')}"
KONG_PORT="${KONG_PORT:-18100}"
BASE="http://127.0.0.1:${KONG_PORT}"
DB="docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres -X -A -t -q -c"

fail=0
note() { printf '%s\n' "$*"; }
bad()  { printf 'ECHEC  %s\n' "$*"; fail=$((fail + 1)); }
ok()   { printf 'ok     %s\n' "$*"; }

# ============================================================================
# 1. CONTRAT DE SURFACE — RPC exécutables par anon (consacré par X3,
#    2026-09-07). Chaque entrée est là parce qu'un écran public l'appelle ou
#    parce qu'elle est volontairement publique. En ajouter une = décision.
# ============================================================================
ALLOWED_ANON_RPCS="apply_appointment_no_show_rule
book_public_appointment
change_queue_entry_barber
create_professional_interest_request
get_billing_catalog
get_feed
get_invitation_by_token
get_organization_posts
get_professional_posts
get_professional_posts_by_id
get_public_available_slots
get_public_barber
get_public_booking_alternatives
get_public_currencies
get_public_organization
get_public_organization_follower_count
get_public_professional
get_public_professional_by_handle
get_public_professional_workplace
get_public_queue_status
get_public_reputation
get_public_reviews
get_public_service_state
get_queue_entry_tracking
get_shared_passport
join_public_queue
leave_public_queue
list_public_barber_services
list_public_barbers
list_public_location_hours
list_public_locations
list_public_organization_barbers
list_public_queues
list_public_services
normalize_phone_number
search_public_organizations
search_public_professionals
suggested_currency_for_country
suggested_timezone_for_country
track_analytics_event
unsubscribe_prospect_outreach"

ACTUAL="$($DB "
  select p.proname from pg_proc p
  cross join lateral aclexplode(p.proacl) a
  where p.pronamespace='public'::regnamespace and a.privilege_type='EXECUTE'
    and a.grantee::regrole::text='anon' and p.prorettype<>'trigger'::regtype
  group by p.proname order by 1;")"
DIFF="$(diff <(printf '%s\n' "$ALLOWED_ANON_RPCS" | sort) <(printf '%s\n' "$ACTUAL" | sort) || true)"
if [[ -n "$DIFF" ]]; then
  bad "contrat de surface anon : dérive détectée"
  printf '%s\n' "$DIFF" | sed 's/^/       /'
else
  ok "contrat de surface : $(printf '%s\n' "$ACTUAL" | wc -l) RPC anon-exécutables, aucune dérive"
fi

# ============================================================================
# 2. Lectures publiques (le contrat existant).
# ============================================================================
if FADEUP_SUPABASE_ENV="$ENV_FILE" bash "$REPO_ROOT/db/tests/probe_public_rpcs.sh" --strict >/dev/null 2>&1; then
  ok "probe_public_rpcs.sh --strict : toutes les lectures publiques en 200"
else
  bad "probe_public_rpcs.sh --strict échoue"
fi

# ============================================================================
# Boîte à outils HTTP
# ============================================================================
req() { # méthode chemin token corps → « CODE|corps »
  local method="$1" path="$2" token="$3" body="${4:-}"
  local args=(-s -o /tmp/x3resp.$$ -w '%{http_code}' -X "$method"
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token"
    -H "Content-Type: application/json" -H "Prefer: return=representation")
  [[ -n "$body" ]] && args+=(-d "$body")
  local code
  code="$(curl "${args[@]}" "$BASE$path")"
  printf '%s|%s' "$code" "$(head -c 300 /tmp/x3resp.$$ 2>/dev/null || true)"
}

TABLES="$($DB "select tablename from pg_tables where schemaname='public' order by 1;")"
RANDOM_UUID="00000000-dead-4bad-8bad-000000000000"

sweep_reads() { # token étiquette allow_rows(liste de tables autorisées à rendre des lignes)
  local token="$1" label="$2" allow="$3" t res code body rows
  local viol=0
  for t in $TABLES; do
    res="$(req GET "/rest/v1/${t}?limit=1" "$token")"
    code="${res%%|*}"; body="${res#*|}"
    if [[ "$code" == 2* ]]; then
      rows="$(printf '%s' "$body" | grep -c '"' || true)"
      if [[ "$body" != "[]" && -n "$body" ]]; then
        if ! grep -qx "$t" <<<"$allow"; then
          bad "$label : $t rend des lignes ($(printf '%s' "$body" | head -c 80)…)"
          viol=1
        fi
      fi
    elif [[ "$code" != 401 && "$code" != 403 && "$code" != 404 && "$code" != 406 ]]; then
      bad "$label : $t répond $code (inattendu)"
      viol=1
    fi
  done
  [[ "$viol" -eq 0 ]] && ok "$label : $(printf '%s\n' $TABLES | wc -l) tables, aucune ligne interdite lisible"
}

sweep_writes() { # token étiquette
  local token="$1" label="$2" t res code body viol=0
  for t in $TABLES; do
    # POST vide : doit être refusé (401 anon / 403 authed / 400 contrainte
    # SEULEMENT si le privilège aurait suffi — on le compte comme écart, car
    # aucune table ne doit être insérable directement par ces rôles).
    res="$(req POST "/rest/v1/${t}" "$token" '{}')"
    code="${res%%|*}"; body="${res#*|}"
    if [[ "$code" == 2* ]]; then
      bad "$label : POST $t a ATTERRI ($code) — $(printf '%s' "$body" | head -c 100)"
      viol=1
    fi
    # PATCH/DELETE filtrés sur un uuid impossible : un refus de privilège
    # (401/403/404) ou un 2xx PROUVANT zéro ligne ([]).
    res="$(req PATCH "/rest/v1/${t}?id=eq.${RANDOM_UUID}" "$token" '{"updated_at":"2020-01-01T00:00:00Z"}')"
    code="${res%%|*}"; body="${res#*|}"
    if [[ "$code" == 2* && "$body" != "[]" && -n "$body" ]]; then
      bad "$label : PATCH $t a modifié des lignes — $body"
      viol=1
    fi
    res="$(req DELETE "/rest/v1/${t}?id=eq.${RANDOM_UUID}" "$token")"
    code="${res%%|*}"; body="${res#*|}"
    if [[ "$code" == 2* && "$body" != "[]" && -n "$body" ]]; then
      bad "$label : DELETE $t a supprimé des lignes — $body"
      viol=1
    fi
  done
  [[ "$viol" -eq 0 ]] && ok "$label : POST/PATCH/DELETE — rien n'atterrit sur les $(printf '%s\n' $TABLES | wc -l) tables"
}

refusal() { # token rpc corps motif_attendu étiquette
  local token="$1" rpc="$2" body="$3" want="$4" label="$5" res code resp
  res="$(req POST "/rest/v1/rpc/${rpc}" "$token" "$body")"
  code="${res%%|*}"; resp="${res#*|}"
  if [[ "$code" == 2* ]]; then
    bad "$label : ${rpc} a RÉUSSI ($code) au lieu de refuser — $resp"
  elif [[ -n "$want" && "$resp" != *"$want"* ]]; then
    bad "$label : ${rpc} refuse ($code) mais sans le motif « $want » — $(printf '%s' "$resp" | head -c 120)"
  else
    ok "$label : ${rpc} → $code, motif conforme"
  fi
}

# ============================================================================
# 3-5. ANONYME RÉEL
# ============================================================================
note ""
note "=== rôle anonyme réel (jeton anon, via Kong) ==="
sweep_reads  "$ANON_KEY" "anon lecture tables" ""
sweep_writes "$ANON_KEY" "anon écriture tables"

# Ressource d'autrui / inconnue : refus NOMMÉS, pas de demi-succès.
refusal "$ANON_KEY" leave_public_queue        "{\"p_entry_id\":\"$RANDOM_UUID\"}" "entry_not_found" "anon tiers"
refusal "$ANON_KEY" get_queue_entry_tracking  "{\"p_entry_id\":\"$RANDOM_UUID\"}" ""               "anon tiers"
refusal "$ANON_KEY" change_queue_entry_barber "{\"p_entry_id\":\"$RANDOM_UUID\",\"p_to_barber_id\":null}" "entry_not_found" "anon tiers"
# RPC réservées : pas d'EXECUTE anon — 401/404 attendu, jamais 2xx.
refusal "$ANON_KEY" move_queue_entry          "{\"p_entry_id\":\"$RANDOM_UUID\",\"p_to_barber_id\":null}" "" "anon réservé"
refusal "$ANON_KEY" reschedule_appointment    "{\"p_appointment_id\":\"$RANDOM_UUID\",\"p_starts_at\":\"2030-01-01T10:00:00Z\"}" "" "anon réservé"
refusal "$ANON_KEY" get_my_access             "{}" "" "anon réservé"

# ============================================================================
# 6. AUTHENTIFIÉ SANS DROIT (compte jetable, créé puis supprimé)
# ============================================================================
note ""
note "=== rôle authentifié sans aucun droit ==="
QA_ID="e3a00000-0000-4000-8000-$(date +%s | tail -c 11 | tr -d '\n')00"
QA_EMAIL="qa-x3-norights-$(date +%s)@fadeup.test"
QA_PW="x3-Surface-$(date +%s)"
$DB "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
       email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
     values ('$QA_ID','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       '$QA_EMAIL', crypt('$QA_PW', gen_salt('bf')), now(),
       now(), now(),
       '{\"provider\":\"email\",\"providers\":[\"email\"]}','{}','','','','','','','','');
     insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(),'$QA_ID','$QA_ID',
       jsonb_build_object('sub','$QA_ID','email','$QA_EMAIL'),'email', now(), now(), now());" >/dev/null

cleanup_user() { $DB "delete from auth.users where id = '$QA_ID';" >/dev/null || true; }
trap cleanup_user EXIT

TOKEN_RESP="$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$QA_EMAIL\",\"password\":\"$QA_PW\"}")"
USER_JWT="$(printf '%s' "$TOKEN_RESP" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
if [[ -z "$USER_JWT" ]]; then
  bad "connexion GoTrue du compte jetable impossible : $(printf '%s' "$TOKEN_RESP" | head -c 160)"
else
  ok "compte jetable connecté ($QA_EMAIL)"
  # Tables que ce rôle PEUT légitimement lire : catalogues commerciaux
  # (policies using(true) to authenticated, par conception), et ses PROPRES
  # lignes d'identité (policies « col = auth.uid() » : le balayage vérifie la
  # présence de lignes, pas leur appartenance — celle-ci est garantie par la
  # policy elle-même, auditée au chantier 1).
  ALLOW_AUTHED_ROWS="billing_stripe_prices
billing_stripe_products
commercial_capabilities
commercial_plans
plan_capabilities
membership_plans
review_reputation
profiles
customer_profiles
customer_passports"
  sweep_reads  "$USER_JWT" "authed-sans-droit lecture tables" "$ALLOW_AUTHED_ROWS"
  sweep_writes "$USER_JWT" "authed-sans-droit écriture tables"

  # Ressource d'autrui, en authentifié : l'organisation de démonstration.
  DEMO_ORG="de300001-0000-4000-8000-000000000001"
  refusal "$USER_JWT" get_organization_entitlements "{\"p_organization_id\":\"$DEMO_ORG\"}" "" "authed tiers"
  refusal "$USER_JWT" assign_commercial_plan "{\"p_organization_id\":\"$DEMO_ORG\",\"p_plan_key\":\"solo\"}" "" "authed tiers"
  refusal "$USER_JWT" start_organization_trial "{\"p_organization_id\":\"$DEMO_ORG\"}" "" "authed tiers"
  refusal "$USER_JWT" move_queue_entry "{\"p_entry_id\":\"$RANDOM_UUID\",\"p_to_barber_id\":null}" "" "authed tiers"
  refusal "$USER_JWT" reschedule_appointment "{\"p_appointment_id\":\"$RANDOM_UUID\",\"p_starts_at\":\"2030-01-01T10:00:00Z\"}" "" "authed tiers"
  # PATCH direct d'une ressource RÉELLE d'autrui : 2xx-vide obligatoire.
  res="$(req PATCH "/rest/v1/organizations?id=eq.${DEMO_ORG}" "$USER_JWT" '{"name":"pwned"}')"
  code="${res%%|*}"; body="${res#*|}"
  if [[ "$code" == 2* && "$body" == "[]" ]]; then
    ok "authed tiers : PATCH organizations (org réelle) → $code, 0 ligne"
  elif [[ "$code" == 401 || "$code" == 403 || "$code" == 404 ]]; then
    ok "authed tiers : PATCH organizations (org réelle) → $code"
  else
    bad "authed tiers : PATCH organizations → $code — $body"
  fi
fi

cleanup_user
trap - EXIT
$DB "select 'compte jetable restant: ' || count(*) from auth.users where id = '$QA_ID';" | sed 's/^/       /'

note ""
if [[ "$fail" -eq 0 ]]; then
  note "X3 SURFACE ANONYME : TOUT PASSE"
else
  note "X3 SURFACE ANONYME : $fail écart(s)"
  [[ "$STRICT" -eq 1 ]] && exit 1
fi
