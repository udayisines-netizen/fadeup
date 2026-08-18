#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_LOT_C_BOOKING_LOOP_2026_08_19.sql
#
# A sibling of scripts/generate-master-sql.sh, deliberately NOT a
# modification of it: that script builds the Worker V2 MASTER, and Worker V2
# is feature frozen. Same contract, same safety assertions, different
# migration list.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix
# is needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-lot-c.sh
#   scripts/generate-master-lot-c.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_LOT_C_BOOKING_LOOP_2026_08_19.sql"

# Only this run's migrations. No Worker V2 schema, no base FadeUp schema.
MIGRATIONS=(
  "20260819100000_booking_loop.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: LOT C, close the booking loop
-- Generated 2026-08-19. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-lot-c.sh
-- Verify in sync:   scripts/generate-master-lot-c.sh --check
--
-- WHAT THIS IS
--   The ordered, effective SQL that turns FadeUp's correct-but-open-loop
--   booking engine into a complete workflow:
--
--     * a decision window on every booking request, derived from ONE
--       authoritative value (organizations.booking_request_ttl_minutes) by a
--       trigger, so no client can set or recompute it;
--     * accept / decline / cancel / reschedule as row-locked, state-guarded,
--       SECURITY DEFINER transitions — never a client status PATCH;
--     * an expiry sweep that runs on a schedule, so an unanswered request
--       stops holding a barber's slot even when nobody has the app open;
--     * a product notification domain for customers and professionals, with
--       every intent written in the SAME transaction as the decision;
--     * team invitation delivery, closing a loop that previously ended with
--       an owner copying a link by hand;
--     * Realtime on appointments, notifications and memberships.
--
--   It is a byte-for-byte concatenation of one version-controlled migration,
--   which remains the source of truth:
--     db/migrations/20260819100000_booking_loop.sql
--
--   No fix exists only here. If something must change, change the migration
--   and regenerate.
--
-- THE ONE DECISION AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   LOT C adds NO new appointment_status values. Terminal states ride on
--   status='cancelled' plus a new `resolution` column.
--
--   That is not a shortcut, it is the safety property. Slot occupancy is
--   decided solely by the exclusion constraints' predicate:
--
--       WHERE (status <> ALL (ARRAY['cancelled', 'no_show']))
--
--   A new status would be invisible to it — so `declined` would hold the slot
--   exactly as `pending` did — and teaching it a new value means DROP + ADD on
--   FadeUp's only double-booking guard: an ACCESS EXCLUSIVE lock, a full
--   re-validation, and a window with no guard at all. Resolving to `cancelled`
--   frees the slot through the constraint we never touch.
--
--   VERIFY asserts the predicate is unchanged.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Existing `pending` appointments gain an expires_at the first time they
--      are updated, and any pending row older than the organization's TTL will
--      be expired by the first scheduler tick — releasing slots that have been
--      held indefinitely. That is the bug being fixed; review the pending set
--      before enabling the scheduler if any are genuinely still wanted.
--   2. cancel_my_appointment now also records a resolution and notifies the
--      shop. Authorization is unchanged.
--   3. Creating an invitation now queues an email. Delivery still depends on
--      SMTP, which is a separate external dependency.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Contains no DROP TABLE, no TRUNCATE, no DROP ... CASCADE, no mass
--     DELETE, and never disables row level security.
--   * Does not touch the GiST exclusion constraints.
--   * Idempotent: every object is created IF NOT EXISTS, via CREATE OR
--     REPLACE, or inside a guarded DO block.
--   * Creates the fadeup_scheduler role NOLOGIN with no password — the
--     operator sets one when deploying infra/scheduler.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_LOT_C_BOOKING_LOOP_2026_08_19.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_LOT_C_BOOKING_LOOP_2026_08_19.sql
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
--   supabase/VERIFY_LOT_C_BOOKING_LOOP_2026_08_19.sql
-- and confirm 0 unexpected FAIL rows.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (LOT C) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (LOT C) is OUT OF SYNC. Run scripts/generate-master-lot-c.sh" >&2
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
