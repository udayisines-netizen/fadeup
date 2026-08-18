#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_WORKER_V2_ACQUISITION_2026_08_18.sql
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees the spec's rule that "no special fix may exist only in
# MASTER": this script concatenates the exact migration files, in
# filename order, inside a single transaction. If a fix is needed, it goes
# in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-sql.sh
#   scripts/generate-master-sql.sh --check    # verify MASTER matches the migrations

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_WORKER_V2_ACQUISITION_2026_08_18.sql"

# The Worker V2 / Platform acquisition migrations, in apply order. Only
# these — MASTER must contain ONLY the acquisition changes, never the rest
# of the FadeUp schema.
MIGRATIONS=(
  "20260818100000_prospect_competitor_intelligence.sql"
  "20260818100100_prospect_outreach_whatsapp_ml.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: Worker V2 / Platform Acquisition Intelligence
-- Generated 2026-08-18. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-sql.sh
-- Verify in sync:   scripts/generate-master-sql.sh --check
--
-- WHAT THIS IS
--   The ordered, effective SQL required to upgrade the CURRENT FadeUp
--   database with ONLY the Worker V2 / Platform acquisition changes:
--   competitor intelligence, the prospect feature store, dual scoring,
--   segmentation, locale resolution, the adaptive search planner,
--   approved-template outreach, the WhatsApp Business Cloud API surface,
--   A/B experimentation, and the machine-learning registry.
--
--   It is a byte-for-byte concatenation of these version-controlled
--   migrations, which remain the source of truth:
--     db/migrations/20260818100000_prospect_competitor_intelligence.sql
--     db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql
--
--   No fix exists only here. If something must change, change the
--   migration and regenerate.
--
-- WHAT THIS IS NOT
--   It does not create the base FadeUp schema. It assumes the existing
--   database already has: the `private` and `extensions` schemas,
--   public.set_updated_at(), public.platform_members and the
--   private.is_platform_admin()/has_platform_role() helpers, the
--   prospect_worker role, and the prospect_* tables from
--   20260811150100 / 20260811150200.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back. There is no partially-upgraded state.
--   * Contains no DROP TABLE, no TRUNCATE, no DROP FUNCTION ... CASCADE,
--     no mass DELETE, and never disables row level security.
--   * Idempotent: every object is created IF NOT EXISTS or via a guarded
--     DO block, so re-running is safe.
--   * The one DROP CONSTRAINT is prospect_jobs_job_type_check, replaced
--     in the same statement block by a SUPERSET that still admits every
--     previously-valid value — no existing row can be invalidated.
--
-- HOW TO APPLY
--   Review first, then run against the target database as a role that can
--   create objects in `public` and `private` (postgres in the self-hosted
--   Supabase stack):
--
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_WORKER_V2_ACQUISITION_2026_08_18.sql
--
--   Then run the companion verification script and confirm zero
--   unexpected FAIL rows:
--
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
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
--   supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- and confirm 0 unexpected FAIL rows.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER is OUT OF SYNC with db/migrations. Run scripts/generate-master-sql.sh" >&2
  diff "$OUTPUT" "$TMP" | head -40 >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/supabase"
cp "$TMP" "$OUTPUT"
echo "wrote $OUTPUT ($(wc -l < "$OUTPUT") lines)"

# Safety assertions on the generated file. Not decoration: this is the
# mechanical check that a destructive statement can never reach MASTER
# through a migration edit.
#
# SQL comments are stripped first — otherwise the header above, which
# *describes* the forbidden statements, would trip its own check.
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT
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

# An unbounded DELETE: a DELETE line with no WHERE on the same line. Every
# legitimate DELETE in these migrations is single-line and filtered.
if grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivq 'where'; then
  : # no matches at all
fi
if grep -iE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivqE 'where'; then
  echo '!! MASTER contains a DELETE with no WHERE clause on the same line' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivE 'where' | head -5 >&2
  fail=1
fi

# The transaction must actually be closed, or a failed apply would leave
# the session in an open transaction.
if ! grep -qE '^commit;' "$CODE_ONLY"; then
  echo '!! MASTER has no COMMIT' >&2
  fail=1
fi

if [[ "$fail" -eq 1 ]]; then
  exit 1
fi

echo 'safety checks passed: no DROP TABLE / TRUNCATE / DROP ... CASCADE / RLS disable / unbounded DELETE; transaction closed'
