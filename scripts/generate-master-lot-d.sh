#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql
#
# A sibling of scripts/generate-master-lot-c.sh, deliberately NOT a
# modification of it: LOT C is already deployed, and its MASTER must keep
# generating byte-for-byte what the operator applied. Same contract, same
# safety assertions, different migration list.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix
# is needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-lot-d.sh
#   scripts/generate-master-lot-d.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql"

# Only this run's migrations. No Worker V2 schema, no base FadeUp schema.
MIGRATIONS=(
  "20260819200000_professional_workspace.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: LOT D, the professional workspace
-- Generated 2026-08-19. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-lot-d.sh
-- Verify in sync:   scripts/generate-master-lot-d.sh --check
--
-- WHAT THIS IS
--   LOT D is mostly a frontend lot. This file is the small, deliberate part
--   of it that the database genuinely could not already express:
--
--     * SPLIT SHIFTS. barber_working_hours and location_hours allowed exactly
--       one interval per day, so the midday closure most salons actually work
--       could not be represented at all. Each gains an OPTIONAL second
--       interval, and the availability engine intersects the professional's
--       windows with the location's.
--     * TIME BLOCKS. There was no way to say "busy 12:00-13:00" — the only
--       tool was an exception that REPLACES the whole day. public.time_blocks
--       is a first-class range, deliberately not a fake appointment.
--     * ONE slot algorithm. get_available_slots and get_public_available_slots
--       carried the same maths in two copies that had already drifted (the
--       past-time trim existed in only one). The computation moves to
--       private.compute_available_slots; both wrappers keep their own,
--       unchanged validation and trust boundary.
--     * CONTROLLED completion and no-show, replacing a raw client status
--       PATCH that permitted any transition, including backwards.
--     * ONE range-bounded, pre-joined calendar read, replacing a client-side
--       join across separately-fetched service and professional lists.
--
--   It is a byte-for-byte concatenation of one version-controlled migration,
--   which remains the source of truth:
--     db/migrations/20260819200000_professional_workspace.sql
--
--   No fix exists only here. If something must change, change the migration
--   and regenerate.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   1. Split shifts are an optional SECOND interval on the existing row, not
--      many rows per day. Many rows would be cleaner in the abstract but is
--      not additive: it would require dropping unique (barber_id, day_of_week)
--      and rewriting apply_weekly_hours' on-conflict upsert and every reader.
--      A NULL second interval behaves exactly as today.
--
--   2. Time blocks are enforced by a TRIGGER on appointments, not inside each
--      RPC. book_public_appointment, reschedule_appointment and staff-side
--      inserts are three doors into the same table; one rule at the data layer
--      is the only version no path can route around. The trigger stands down
--      when a row's time and professional are unchanged, so a block laid over
--      an already-booked hour never prevents that appointment from being
--      confirmed, completed or cancelled.
--
--   3. NO new appointment_status values, exactly as in LOT C. `completed` and
--      `no_show` already existed; this adds guarded transitions to them. The
--      GiST exclusion predicate is not touched.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. get_available_slots (the STAFF slot lookup) now excludes times already
--      in the past. It previously did not — staff were offered 09:00 at noon.
--      This is the drift the shared helper removes.
--   2. Any booking overlapping a time block is refused from the moment the
--      first block is created. No blocks exist until someone creates one, so
--      applying this file alone changes nothing for existing bookings.
--   3. Marking an appointment completed or no-show should move to the new
--      RPCs. The old direct PATCH still works where RLS allows it; it simply
--      stops being the only option.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Contains no DROP TABLE, no TRUNCATE, no DROP ... CASCADE, no mass
--     DELETE, and never disables row level security.
--   * Does not touch the GiST exclusion constraints.
--   * Adds only nullable columns, so no table rewrite and no default
--     backfill on barber_working_hours or location_hours.
--   * Idempotent: every object is created IF NOT EXISTS, via CREATE OR
--     REPLACE, or inside a guarded DO block.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql
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
--   supabase/VERIFY_LOT_D_PROFESSIONAL_WORKSPACE_2026_08_19.sql
-- and confirm 0 unexpected FAIL rows (expected: 61 PASS / 0 FAIL / 5 INFO).
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (LOT D) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (LOT D) is OUT OF SYNC. Run scripts/generate-master-lot-d.sh" >&2
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
