#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql
#
# MASTER is DERIVED from db/migrations, never hand-edited.
#
# THE RISKS THIS LOT'S ASSERTIONS ARE ABOUT
#
# R5 is an experience lot, and its two migrations are read-shaped. That is
# exactly why the risks are easy to miss: nothing here looks dangerous.
#
#   A. THE ROW SET WIDENS. search_public_professionals is anon-callable and
#      SECURITY DEFINER, and R5 rewrites its entire 300-line body to add three
#      columns to the projection. A WHERE clause dropped in that rewrite would
#      publish shops that never opted into the marketplace, or locations their
#      owner deactivated. There would be no error and no symptom — just more
#      results than there should be, which looks like success.
#
#   B. TWO OVERLOADS SURVIVE. The new signature adds a trailing defaulted
#      parameter. If the DROP of the 13-argument version does not happen, both
#      exist, every 13-argument call becomes ambiguous, and the marketplace
#      fails at runtime for every visitor rather than at deploy.
#
#   C. THE DASHBOARD LAYOUT STOPS BELONGING TO THE SHOP. §24 is a statement
#      about the primary key: keyed on organization_id ALONE, a per-member
#      layout cannot exist. A user column in that key, or a SELECT policy
#      scoped to auth.uid(), would satisfy "the dashboard can be rearranged"
#      and silently fail the requirement.
#
#   D. THE TENANT ANCHOR BECOMES WRITABLE. With an UPDATE grant on
#      organization_id, an authorized manager of shop A could move their layout
#      row to shop B.
#
#   E. THE FILE TOUCHES EXISTING DATA. R5 adds a table and replaces a function.
#      It has no business writing a single row of anything that already exists.
#
# Usage:
#   scripts/generate-master-r5.sh
#   scripts/generate-master-r5.sh --check

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql"

# Order matters only in that both are independent; neither depends on the other.
MIGRATIONS=(
  "20260828120000_marketplace_map_and_sort.sql"
  "20260828120100_organization_dashboard_layout.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R5, Design System & Experience Foundation
-- Generated 2026-08-28. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r5.sh
-- Verify in sync:   scripts/generate-master-r5.sh --check
--
-- WHAT THIS IS
--
--   Two read-shaped changes. Neither adds a product concept.
--
--   1. THE MARKETPLACE SEARCH GAINS COORDINATES, A TIMEZONE AND A SORT.
--      search_public_professionals already ACCEPTED a latitude and longitude
--      and computed distance_km from them, and returned neither — so a map
--      fed from a result set had nothing to plot. It also carried `timezone`
--      internally (the open-now and queue-window subqueries both depend on it)
--      and dropped it at the final SELECT, so every card that wanted to print
--      a time in the shop's own hours needed a second round trip first.
--
--      A trailing `p_sort text default 'recommended'` is added. Sorting has to
--      happen server-side because the function is paged: "cheapest first" over
--      a distance-ordered page of twenty-four is the cheapest of the nearest,
--      which is a different and misleading answer.
--
--   2. THE PRO DASHBOARD LAYOUT BECOMES A SHOP-OWNED ROW.
--      organization_dashboard_layouts, keyed on organization_id ALONE. Read by
--      any member of the shop, written by owner/manager through RLS.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. NO NEW ROW BECOMES PUBLIC.
--      Exposing latitude and longitude discloses nothing that was not already
--      disclosed: every row this function returns already carried
--      address_line1, city, postal_code and country for an ACTIVE location of
--      a MARKETPLACE_VISIBLE organization. A shop that published its street
--      address has published where it is. Every WHERE clause is carried
--      forward unchanged, and VERIFY R5.9 proves it by flipping
--      marketplace_visible off and asserting the shop disappears.
--
--   B. EXISTING CALLERS KEEP WORKING — BUT POSTGREST MUST BE TOLD.
--      p_sort is trailing and defaulted, so a 13-argument call still resolves
--      and still gets the pre-R5 ordering. PostgREST, however, caches the
--      schema: until it is reloaded it will keep advertising the old signature
--      and reject the new named argument. The reload is at the bottom of this
--      file and is NOT optional. Wave 1 learned this the same way.
--
--   C. `recommended` IS NOT A SCORE.
--      It is the existing ordering, byte for byte — rows with a distance
--      first, then by distance, then alphabetically — and it is also the
--      fallback for any value this function does not recognise, so a stale
--      client asking for a sort that does not exist gets results rather than
--      an error. Ranking belongs to a later backend lot.
--
--   D. NOTHING IS BACKFILLED AND NO SHOP GETS A LAYOUT.
--      organization_dashboard_layouts starts empty. A shop with no row sees
--      the product default; a row appears only when an owner or manager
--      rearranges something.
--
--   E. ONE `private.` FUNCTION IS GRANTED TO `authenticated`, ON PURPOSE.
--      A CHECK constraint that calls a function is evaluated as the WRITING
--      role, not as the table owner. Revoking valid_dashboard_module_keys from
--      authenticated — the house style for everything in private — does not
--      harden the constraint, it makes every INSERT by a real user fail with
--      "permission denied for function". It reads no table and takes no
--      session state.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No change to any RLS policy on any existing table. No new grant to anon.
--   No change to the R4 publication gate, service mode, entitlements, or the
--   analytics event engine. No column removed from any contract. No product
--   data written, updated or deleted.
--
-- SAFETY
--   * Runs inside a single transaction.
--   * Creates one table, removes no table, removes no column, truncates nothing.
--   * Contains no DELETE and no UPDATE of any kind.
--   * Adds no anon grant beyond the EXECUTE the search function already had.
--   * Every object it touches on live is owned by `postgres`, so it applies as
--     postgres — checked before deploying, because R4.1's first attempt failed
--     on ownership of an object a clean replay had never seen.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql
--
--   Then run, and confirm no FAILED assertion in each:
--     supabase/VERIFY_R5_EXPERIENCE_FOUNDATION_2026_08_28.sql
--     supabase/VERIFY_CUSTOMER_API_FREEZE_2026_08_27.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

HEADER

  for migration in "${MIGRATIONS[@]}"; do
    printf -- '-- ============================================================================\n'
    printf -- '-- BEGIN db/migrations/%s\n' "$migration"
    printf -- '-- ============================================================================\n\n'
    # The migrations carry their own begin/commit. Stripped here so the whole
    # MASTER is ONE transaction: two transactions would let the first land and
    # the second fail, leaving live with a rewritten search function and no
    # dashboard table — a state no test has ever exercised.
    sed -e '/^begin;$/d' -e '/^commit;$/d' "$REPO_ROOT/db/migrations/$migration"
    printf '\n\n'
    printf -- '-- ============================================================================\n'
    printf -- '-- END db/migrations/%s\n' "$migration"
    printf -- '-- ============================================================================\n\n'
  done

  cat <<'FOOTER'
commit;

-- ============================================================================
-- POSTGREST SCHEMA RELOAD — NOT OPTIONAL.
--
-- search_public_professionals changed BOTH its return shape and its argument
-- list. PostgREST answers from a cached schema, so until it reloads it keeps
-- advertising the 13-argument version and rejects the new named argument the
-- web client sends. The marketplace would go blank for every visitor while the
-- database itself was perfectly healthy.
--
-- Outside the transaction on purpose: NOTIFY inside a transaction is deferred
-- to commit, and if the commit fails there is nothing to reload anyway.
-- ============================================================================
notify pgrst, 'reload schema';

-- ============================================================================
-- Applied. Nothing was backfilled: organization_dashboard_layouts is empty and
-- every shop sees the product-default dashboard order until someone with
-- owner or manager role rearranges it.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R5) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R5) is OUT OF SYNC. Run scripts/generate-master-r5.sh" >&2
  diff "$OUTPUT" "$TMP" | head -40 >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/supabase"
cp "$TMP" "$OUTPUT"
echo "wrote $OUTPUT ($(wc -l < "$OUTPUT") lines)"

grep -v '^\s*--' "$OUTPUT" > "$CODE_ONLY"

fail=0
check_forbidden() {
  local pattern="$1" description="$2"
  if grep -iqE "$pattern" "$CODE_ONLY"; then
    echo "!! MASTER contains a forbidden statement: $description" >&2
    grep -inE "$pattern" "$CODE_ONLY" | head -5 >&2
    fail=1
  fi
}

check_forbidden '^[[:space:]]*drop[[:space:]]+table' 'DROP TABLE'
check_forbidden '^[[:space:]]*truncate' 'TRUNCATE'
check_forbidden 'drop[[:space:]]+function.*cascade' 'DROP FUNCTION ... CASCADE'
check_forbidden 'drop[[:space:]]+type.*cascade' 'DROP TYPE ... CASCADE'
check_forbidden 'disable[[:space:]]+row[[:space:]]+level[[:space:]]+security' 'RLS disable'
check_forbidden '^[[:space:]]*drop[[:space:]]+schema' 'DROP SCHEMA'
check_forbidden 'drop[[:space:]]+column' 'DROP COLUMN'

# ---------------------------------------------------------------------------
# RISK E — R5 MUST NOT TOUCH A SINGLE EXISTING ROW.
#
# It replaces a function and creates a table. Any DML at all against existing
# data means scope leaked out of an experience lot into the product's records.
# ---------------------------------------------------------------------------
check_forbidden '^[[:space:]]*delete[[:space:]]+from' 'a DELETE (R5 writes no data at all)'
check_forbidden '^[[:space:]]*update[[:space:]]+public\.' 'an UPDATE of an existing table'
check_forbidden '^[[:space:]]*insert[[:space:]]+into' 'an INSERT (R5 seeds nothing)'

# Exactly one table, and it is the one this lot is about.
table_count="$(grep -icE '^[[:space:]]*create[[:space:]]+table' "$CODE_ONLY" || true)"
if [[ "$table_count" -ne 1 ]]; then
  echo "!! MASTER creates $table_count tables — R5 creates exactly one" >&2
  fail=1
fi
if ! grep -iqE 'create[[:space:]]+table[[:space:]]+if[[:space:]]+not[[:space:]]+exists[[:space:]]+public\.organization_dashboard_layouts' "$CODE_ONLY"; then
  echo '!! MASTER does not create organization_dashboard_layouts' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK B — THE OLD OVERLOAD MUST BE DROPPED, OR EVERY CALL BECOMES AMBIGUOUS.
# ---------------------------------------------------------------------------
if ! grep -izqE 'drop function if exists public\.search_public_professionals\([^)]*integer,[[:space:]]*integer[[:space:]]*\)' "$CODE_ONLY"; then
  echo '!! MASTER does not drop the 13-argument search_public_professionals' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK A — THE ROW SET MUST NOT WIDEN.
#
# The rewrite carries 300 lines of body forward by hand. These are the clauses
# that decide who is visible at all; losing one is the whole risk.
# ---------------------------------------------------------------------------
for clause in \
  'o\.marketplace_visible' \
  'l\.is_active' \
  'b\.is_bookable' \
  'sp\.is_active' \
  'sp\.is_public'
do
  count="$(grep -cE "$clause" "$CODE_ONLY" || true)"
  if [[ "$count" -lt 1 ]]; then
    echo "!! MASTER lost the visibility clause: $clause" >&2
    fail=1
  fi
done

# marketplace_visible must gate BOTH branches — shops and barbers.
mv_count="$(grep -cE 'o\.marketplace_visible' "$CODE_ONLY" || true)"
if [[ "$mv_count" -lt 2 ]]; then
  echo "!! MASTER gates marketplace_visible on only $mv_count branch(es) — both shop_base and barber_base need it" >&2
  fail=1
fi

# The claimed-identity rule the Customer API Freeze depends on.
if ! grep -iqE "claim_state = 'claimed'" "$CODE_ONLY"; then
  echo '!! MASTER stopped restricting professional_id to CLAIMED identities' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK C — THE LAYOUT MUST BELONG TO THE SHOP, NOT TO A PERSON.
# ---------------------------------------------------------------------------
if ! grep -izqE 'organization_id uuid primary key' "$CODE_ONLY"; then
  echo '!! MASTER does not key the dashboard layout on organization_id alone' >&2
  fail=1
fi
if grep -izqE 'organization_dashboard_layouts[^;]*primary key[^;]*user_id' "$CODE_ONLY"; then
  echo '!! MASTER puts a user in the dashboard layout key — the layout is the SHOP'"'"'s' >&2
  fail=1
fi
if ! grep -iqE 'force row level security' "$CODE_ONLY"; then
  echo '!! MASTER does not FORCE RLS on the new table' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK D — THE TENANT ANCHOR MUST NOT BE UPDATE-GRANTABLE.
# ---------------------------------------------------------------------------
if grep -iqE 'grant update[[:space:]]*\([^)]*organization_id' "$CODE_ONLY"; then
  echo '!! MASTER grants UPDATE on organization_id — a layout could cross tenants' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# NOTHING NEW REACHES anon EXCEPT THE SEARCH FUNCTION IT ALREADY REACHED.
# ---------------------------------------------------------------------------
anon_grants="$(grep -inE 'grant[^;]*to[^;]*\banon\b' "$CODE_ONLY" \
  | grep -viE 'search_public_professionals' || true)"
if [[ -n "$anon_grants" ]]; then
  echo '!! MASTER grants something new to anon' >&2
  echo "$anon_grants" | head -5 >&2
  fail=1
fi

# Every SECURITY DEFINER function must pin its search_path.
definer_count="$(grep -ciE 'security definer' "$CODE_ONLY" || true)"
searchpath_count="$(grep -ciE "set search_path" "$CODE_ONLY" || true)"
if [[ "$searchpath_count" -lt "$definer_count" ]]; then
  echo "!! MASTER has $definer_count SECURITY DEFINER function(s) but only $searchpath_count pinned search_path" >&2
  fail=1
fi

# NO NETWORK, NO SCHEDULER.
check_forbidden 'cron\.schedule|pg_cron|create[[:space:]]+extension[^;]*(cron|http)' 'a scheduler or HTTP extension'

# ---------------------------------------------------------------------------
# ONE TRANSACTION, AND THE POSTGREST RELOAD MUST SURVIVE OUTSIDE IT.
# ---------------------------------------------------------------------------
begins="$(grep -cE '^begin;' "$CODE_ONLY" || true)"
commits="$(grep -cE '^commit;' "$CODE_ONLY" || true)"
if [[ "$begins" -ne 1 || "$commits" -ne 1 ]]; then
  echo "!! MASTER is not exactly one transaction (begin=$begins commit=$commits)" >&2
  fail=1
fi
if ! grep -qE "^notify pgrst, 'reload schema';" "$CODE_ONLY"; then
  echo '!! MASTER does not reload the PostgREST schema — the live marketplace would go blank' >&2
  fail=1
fi
if [[ "$(grep -n "^notify pgrst" "$CODE_ONLY" | cut -d: -f1)" -lt "$(grep -n '^commit;' "$CODE_ONLY" | cut -d: -f1)" ]]; then
  echo '!! MASTER reloads PostgREST before committing' >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "MASTER (R5) FAILED its safety checks." >&2
  exit 1
fi

echo "MASTER (R5) passed all safety checks."
