#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
#
# A sibling of the LOT C/D generators, deliberately NOT a modification of
# them: those lots are already deployed and their MASTER files must keep
# generating byte-for-byte what the operator applied. Same contract, same
# safety assertions, different migration list.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix
# is needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-lot-e.sh
#   scripts/generate-master-lot-e.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql"

# Only this run's migrations. No Worker V2 schema, no base FadeUp schema.
MIGRATIONS=(
  "20260819210000_booking_auto_confirm.sql"
  "20260819220000_currency_exposure.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: LOT E, booking auto-confirm + currency exposure
-- Generated 2026-08-19. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-lot-e.sh
-- Verify in sync:   scripts/generate-master-lot-e.sh --check
--
-- WHAT THIS IS
--
--   TWO changes, both small, both consequential.
--
--   1. A NORMAL BOOKING IS NOW CONFIRMED IMMEDIATELY.
--
--      LOT C built a request/approval loop because slots were being held by
--      rows nobody could answer. That fixed the bug and also made every
--      ordinary booking wait for a human. But the business already answered:
--      opening hours, working hours, split shifts, blocked time, services,
--      durations, buffers and eligibility ARE the answer. A shop that
--      publishes 10:00 as available has said yes to 10:00.
--
--      So book_public_appointment now creates status=confirmed, and a
--      customer rescheduling into another genuinely available slot STAYS
--      confirmed instead of dropping back to pending.
--
--   2. THE BUSINESS'S CURRENCY NOW REACHES THE BROWSER.
--
--      organizations.currency has been correct since LOT B and was returned by
--      no read path at all, so the frontend carried five copies of a
--      hardcoded-USD formatter. Every service price in FadeUp rendered in
--      dollars: a Paris salon charging 25 € showed its own customers "$25.00".
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. CONCURRENCY IS UNCHANGED, because it never depended on the approval
--      step. The race is decided by the GiST exclusion constraint, whose
--      predicate covers pending and confirmed identically:
--
--          WHERE (status <> ALL (ARRAY['cancelled', 'no_show']))
--
--      Two visitors racing one slot produced exactly one appointment before
--      and produce exactly one now. The constraint is not touched.
--      scripts/lot-e-concurrency-test.sh proves this with real simultaneous
--      connections, not by reasoning.
--
--   B. HISTORICAL PENDING ROWS ARE NOT MIGRATED. They were created under a
--      promise that a human would answer; silently confirming them would give
--      customers appointments nobody agreed to. They keep their semantics and
--      the sweep keeps expiring them. `pending` remains a real, supported
--      state for legacy rows and for any future approval-required workflow.
--
--   C. RESCHEDULE GAINED A CHECK IT NEVER HAD. reschedule_appointment
--      validated no opening hours at all — survivable only because a customer
--      move became a request a human reviewed. With no human in the normal
--      path that would have allowed a booking at three in the morning, so the
--      window check moved into private.slot_is_within_hours and BOTH booking
--      and reschedule now use it.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. New public bookings appear as CONFIRMED, not in /app/requests.
--   2. The business is notified "New booking" and the customer "Booking
--      confirmed" — never a request-then-confirmation pair for one booking.
--   3. Prices render in each shop's own currency. Shops whose currency was
--      never set fall back to EUR; check organizations.currency for any shop
--      trading outside the euro area before announcing this to them.
--   4. get_my_appointments and get_calendar_appointments gain columns. Both
--      are consumed only by the FadeUp web app, which is deployed together
--      with this.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Adds no column, rewrites no data, changes no policy, drops no table.
--   * Does not touch the GiST exclusion constraints.
--   * The DROP FUNCTION statements are shape changes to four read functions,
--     each recreated immediately afterwards in the same transaction.
--   * Contains no Worker V2 objects.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

HEADER

  for migration in "${MIGRATIONS[@]}"; do
    printf -- '-- ============================================================================\n'
    printf -- '-- BEGIN db/migrations/%s\n' "$migration"
    printf -- '-- ============================================================================\n\n'
    cat "$REPO_ROOT/db/migrations/$migration"
    printf '\n\n'
    printf -- '-- ============================================================================\n'
    printf -- '-- END db/migrations/%s\n' "$migration"
    printf -- '-- ============================================================================\n\n'
  done

  cat <<'FOOTER'
commit;

-- ============================================================================
-- Applied. Next step: run
--   supabase/VERIFY_LOT_E_GLOBALIZATION_AUTOCONFIRM_2026_08_19.sql
-- and confirm 0 unexpected FAIL rows (expected: 59 PASS / 0 FAIL / 6 INFO).
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (LOT E) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (LOT E) is OUT OF SYNC. Run scripts/generate-master-lot-e.sh" >&2
  diff "$OUTPUT" "$TMP" | head -40 >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/supabase"
cp "$TMP" "$OUTPUT"
echo "wrote $OUTPUT ($(wc -l < "$OUTPUT") lines)"

# Safety assertions on the generated file. SQL comments are stripped first —
# otherwise the header above, which *describes* the forbidden statements,
# would trip its own check.
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

if grep -iE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivqE 'where'; then
  echo '!! MASTER contains a DELETE with no WHERE clause on the same line' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivE 'where' | head -5 >&2
  fail=1
fi

# This run must never carry Worker V2 schema.
if grep -iqE '(prospect_|outreach_|whatsapp_|ml_)' "$CODE_ONLY"; then
  echo '!! MASTER references Worker V2 / acquisition objects — it must not' >&2
  fail=1
fi

if ! grep -qE '^commit;' "$CODE_ONLY"; then
  echo '!! MASTER has no COMMIT' >&2
  fail=1
fi

[[ "$fail" -eq 1 ]] && exit 1

echo 'safety checks passed: no DROP TABLE / TRUNCATE / DROP ... CASCADE / RLS disable / unbounded DELETE; no Worker V2 objects; transaction closed'
