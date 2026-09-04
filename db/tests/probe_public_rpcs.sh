#!/usr/bin/env bash
# FadeUp — B1: HTTP probe of every public read RPC, as the front-end calls it.
#
# WHY HTTP AND NOT psql. get_public_service_state worked in psql for the whole
# of P1a and still answered 405 to every browser: PostgREST runs a STABLE
# function inside a READ ONLY transaction, and psql does not. A read contract
# that is only ever verified in psql is not verified at all.
#
# Usage:
#   db/tests/probe_public_rpcs.sh              # human table
#   db/tests/probe_public_rpcs.sh --strict     # exit 1 if any probe is not 200
#
# Reads KONG_HTTP_PORT and ANON_KEY from infra/supabase/.env. The key is never
# printed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${FADEUP_SUPABASE_ENV:-$REPO_ROOT/infra/supabase/.env}"

STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

if [[ ! -r "$ENV_FILE" ]]; then
  echo "cannot read $ENV_FILE" >&2
  exit 2
fi

ANON_KEY="$(sed -n 's/^ANON_KEY=//p' "$ENV_FILE" | head -1 | tr -d '\r"')"

# KONG_HTTP_PORT in .env is the port INSIDE the container (8000). What a
# browser — and this probe — reaches is the published host port, so ask Docker
# rather than the env file. The env value would send every request to a port
# nothing listens on and report a connection failure as if it were the API.
KONG_PORT="${B1_KONG_PORT:-$(docker port fadeup-supabase-kong 8000/tcp 2>/dev/null | head -1 | sed 's/.*://')}"
KONG_PORT="${KONG_PORT:-18100}"
BASE="http://127.0.0.1:${KONG_PORT}/rest/v1/rpc"

if [[ -z "$ANON_KEY" ]]; then
  echo "ANON_KEY not found in $ENV_FILE" >&2
  exit 2
fi

# Real rows from the P1c demonstration set. Deliberately NOT invented ids: a
# probe against a nonexistent row cannot tell "the function is broken" from
# "the function correctly found nothing".
ORG_SLUG="${B1_PROBE_ORG_SLUG:-demo-maison-kais}"
LOCATION_ID="${B1_PROBE_LOCATION_ID:-de300101-0000-4000-8000-000000000001}"
BARBER_ID="${B1_PROBE_BARBER_ID:-de300601-0000-4000-8000-000000000001}"
SERVICE_ID="${B1_PROBE_SERVICE_ID:-de300301-0000-4000-8000-000000000001}"
ORG_ID="${B1_PROBE_ORG_ID:-de300001-0000-4000-8000-000000000001}"
PROFESSIONAL_ID="${B1_PROBE_PROFESSIONAL_ID:-de300401-0000-4000-8000-000000000001}"
HANDLE="${B1_PROBE_HANDLE:-demo.kais.bellamine}"
TODAY="$(date +%F)"

fail=0
printf '%-38s %-6s %-9s %s\n' 'RPC' 'CODE' 'ROWS' 'BODY (first 110 chars)'
printf '%-38s %-6s %-9s %s\n' '--------------------------------------' '------' '---------' '----------------------------------'

probe() {
  local name="$1" payload="$2"
  local body code rows
  body="$(curl -s -m 20 -w $'\n%{http_code}' \
    -X POST "${BASE}/${name}" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$payload")"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"

  if [[ "$body" == \[* ]]; then
    rows="$(printf '%s' "$body" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo '?')"
  else
    rows='-'
  fi

  printf '%-38s %-6s %-9s %s\n' "$name" "$code" "$rows" "$(printf '%s' "$body" | tr -d '\n' | cut -c1-110)"
  [[ "$code" != "200" ]] && fail=$((fail + 1))
  return 0
}

probe get_public_organization            "{\"p_slug\":\"${ORG_SLUG}\"}"
probe list_public_locations              "{\"p_organization_slug\":\"${ORG_SLUG}\"}"
probe list_public_services               "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_location_id\":\"${LOCATION_ID}\"}"
probe list_public_barbers                "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_location_id\":\"${LOCATION_ID}\",\"p_service_id\":\"${SERVICE_ID}\"}"
probe list_public_organization_barbers   "{\"p_organization_slug\":\"${ORG_SLUG}\"}"
probe list_public_barber_services        "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_barber_id\":\"${BARBER_ID}\"}"
probe get_public_barber                  "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_barber_id\":\"${BARBER_ID}\"}"
probe get_public_professional            "{\"p_professional_id\":\"${PROFESSIONAL_ID}\"}"
probe get_public_professional_by_handle  "{\"p_handle\":\"${HANDLE}\"}"
# get_public_external_professional was DROPPED by B1 chantier 1 — it asked for
# `unclaimed AND is_public`, a combination the R1B CHECK forbade, so it returned
# zero rows for every input it ever received. Its contract now lives inside
# get_public_professional / _by_handle, which carry claim_state.
probe get_public_available_slots         "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_location_id\":\"${LOCATION_ID}\",\"p_barber_id\":\"${BARBER_ID}\",\"p_service_id\":\"${SERVICE_ID}\",\"p_date\":\"${TODAY}\"}"
probe get_public_service_state           "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_location_id\":\"${LOCATION_ID}\"}"
probe get_public_queue_status            "{\"p_organization_slug\":\"${ORG_SLUG}\",\"p_location_id\":\"${LOCATION_ID}\"}"
probe get_public_currencies              "{\"p_organization_ids\":[\"${ORG_ID}\"]}"
probe search_public_organizations        '{"p_city":"Paris"}'
probe search_public_professionals        '{}'

echo
if [[ "$fail" -eq 0 ]]; then
  echo "ALL PUBLIC READ RPCs: 200"
else
  echo "NON-200 RESPONSES: ${fail}"
fi

if [[ "$STRICT" -eq 1 && "$fail" -ne 0 ]]; then
  exit 1
fi
exit 0
