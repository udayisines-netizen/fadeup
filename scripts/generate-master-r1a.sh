#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
#
# A sibling of the LOT C/D/E generators, deliberately NOT a modification of
# them: those lots are already deployed and their MASTER files must keep
# generating byte-for-byte what the operator applied. Same contract, same
# safety assertions, different migration list.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix is
# needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-r1a.sh
#   scripts/generate-master-r1a.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql"

# Only R1A. No R1B social schema, no Worker V2 schema, no base FadeUp schema.
#
# The gap at 100700 is deliberate and permanent. It was reserved for a finding
# the independent security review then DISPROVED; the slot is not reused, so
# the numbering keeps matching the review record.
MIGRATIONS=(
  "20260825100000_customer_link_ownership.sql"
  "20260825100100_appointment_completion_integrity.sql"
  "20260825100200_queue_service_integrity.sql"
  "20260825100300_appointment_history_durability.sql"
  "20260825100400_attribution_provenance.sql"
  "20260825100500_customer_identity_binding.sql"
  "20260825100600_integrity_indexes.sql"
  "20260825100800_passport_persistence.sql"
  "20260825100900_internal_least_privilege.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R1A, data integrity & security foundation
-- Generated 2026-08-25. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r1a.sh
-- Verify in sync:   scripts/generate-master-r1a.sh --check
--
-- WHAT THIS IS
--
--   R1A closes the integrity and identity defects that R1B's social layer
--   would otherwise build on top of. It adds NO social feature: no
--   professionals, no follows, no verified-client, no claim flow, no external
--   profiles. Those are R1B and are deliberately not here.
--
--   The order matters. A "verified client" badge means "this person was
--   actually served by this professional." Today that claim cannot be
--   supported, because:
--
--     * an anonymous booking could be adopted by whoever typed the victim's
--       phone number into a customer row first;
--     * any staff member could PATCH an appointment straight to `completed`,
--       with no completion time recorded at all;
--     * queue timestamps arrived from the client and were stored unchecked,
--       backwards, backdated;
--     * removing a barber row silently removed every appointment that
--       professional had ever served;
--     * a shop could repoint a customer record at a different account.
--
--   Every one of those was REPRODUCED on a disposable replay of production
--   before the corresponding migration was written. Building reputation on
--   that substrate would have made the badge a lie.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. REMOVING A BARBER IS NOW DEACTIVATION, NOT ROW REMOVAL.
--      appointments.barber_id becomes ON DELETE RESTRICT, so removing a
--      professional who has any appointment now fails loudly with 23503
--      instead of destroying revenue history. The supported path is
--      public.offboard_barber(uuid), which makes them unbookable and removes
--      them from public surfaces. THIS IS THE ONLY BEHAVIOUR CHANGE A SHOP
--      CAN NOTICE.
--
--      Account erasure stays possible: staff_profiles.user_id becomes NULLABLE
--      with ON DELETE SET NULL, so erasing an account DETACHES the person from
--      the roster record rather than cascading away the shop's business
--      records. Erasing an identity and destroying a business's history are
--      different operations, and only the first is the user's to demand.
--
--   B. APPOINTMENT STATUS NOW HAS A TRANSITION GUARD WITH NO ROLE BYPASS.
--      It is a SEPARATE trigger, not folded into
--      restrict_appointment_self_update() — that function opens by exempting
--      owner/manager/receptionist, so anything folded in would inherit the
--      exemption and leave the larger, manager-side forgery path open.
--      The legal set is docs/v2/R1A_TRANSITION_MATRIX.md, derived by reading
--      every status writer in db/migrations. Two edges would have been missed
--      by writing the guard from intuition, and breaking either would have
--      broken a live subsystem: the customer reschedule (confirmed -> pending)
--      and the bulk no-show sweep (confirmed -> no_show, no decided_at).
--
--   C. NO HISTORICAL DATA IS FABRICATED. completed_at is backfilled ONLY from
--      decided_at, and only where complete_appointment() actually wrote both.
--      It is never inferred from starts_at: a scheduled start is when an
--      appointment was DUE to begin, not evidence that it happened. Rows whose
--      completion time is genuinely unknown stay NULL, and the migration
--      RAISE NOTICEs how many. Unknown is recorded as unknown.
--
--   D. SEVERAL COLUMNS ARE NOW SERVER-OWNED, VIA A TABLE-LEVEL REVOKE.
--      A column-level REVOKE cannot subtract from a table-level grant — it is
--      a silent no-op, confirmed with has_column_privilege(). So each
--      protected column required revoking the privilege at TABLE level and
--      re-granting every other column explicitly. That is a wider blast radius
--      than it looks: it changes exactly what PostgREST may write. The
--      companion VERIFY asserts the resulting matrix column by column rather
--      than assuming it.
--
--   E. TWO RPCs ARE REPRODUCED VERBATIM WITH EXACTLY TWO LINES CHANGED EACH
--      (book_public_appointment, join_public_queue), because CREATE OR REPLACE
--      needs the whole body. The diff was checked mechanically, not by eye.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Removing a barber who has history now returns 23503. Shops that removed
--      staff that way must use offboard_barber() instead. Nothing in the
--      FadeUp web app does this today — it toggles is_bookable — but RLS, not
--      the frontend, is the boundary, and RLS permitted it.
--   2. An anonymous booking or queue join whose phone/email matches an
--      ACCOUNT-OWNED customer row is now left unlinked instead of adopting it.
--      Matching against UNOWNED rows — the walk-in recognition path — is
--      unchanged.
--   3. Illegal status transitions now raise 22023 for every caller, including
--      owner, manager and service_role.
--   4. Client-supplied queue timestamps are ignored; the server stamps them.
--      The columns stay writable, so the existing web client keeps working.
--   5. Fade Passports can no longer be removed by their owner.
--   6. professional_applications.internal_note is no longer SELECTable by
--      authenticated, and the acquisition worker can no longer read
--      email_outbox.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Creates no table, removes no table, removes no column, truncates
--     nothing.
--   * Rewrites data in exactly one place: the completed_at backfill described
--     in (C), which only ever copies decided_at.
--   * Does not touch the GiST exclusion constraints that decide booking races.
--   * Contains no R1B / social objects.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
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
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R1A) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R1A) is OUT OF SYNC. Run scripts/generate-master-r1a.sh" >&2
  diff "$OUTPUT" "$TMP" | head -40 >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/supabase"
cp "$TMP" "$OUTPUT"
echo "wrote $OUTPUT ($(wc -l < "$OUTPUT") lines)"

# Safety assertions on the generated file. SQL comments are stripped first —
# otherwise the header above, which *describes* the forbidden statements, would
# trip its own check.
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

if grep -iE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivqE 'where'; then
  echo '!! MASTER contains a DELETE with no WHERE clause on the same line' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivE 'where' | head -5 >&2
  fail=1
fi

# R1A is integrity only. If a social table has crept in, the lot boundary the
# whole plan rests on has been broken and this must not ship as R1A.
if grep -iqE '^[[:space:]]*create[[:space:]]+table' "$CODE_ONLY"; then
  echo '!! MASTER creates a table — R1A adds no table; that is R1B' >&2
  grep -inE '^[[:space:]]*create[[:space:]]+table' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if grep -iqE '(professional_profiles|professional_follows|verified_client|profile_claims|external_profiles)' "$CODE_ONLY"; then
  echo '!! MASTER references R1B social objects — it must not' >&2
  fail=1
fi

# Every migration in the list must actually appear, or a silent cat failure
# would produce a MASTER that is quietly missing a fix.
for migration in "${MIGRATIONS[@]}"; do
  if ! grep -qF "BEGIN db/migrations/$migration" "$OUTPUT"; then
    echo "!! MASTER is missing $migration" >&2
    fail=1
  fi
done

if ! grep -qE '^commit;' "$CODE_ONLY"; then
  echo '!! MASTER has no COMMIT' >&2
  fail=1
fi

[[ "$fail" -eq 1 ]] && exit 1

echo 'safety checks passed: no DROP TABLE / TRUNCATE / DROP COLUMN / DROP ... CASCADE / RLS disable / unbounded DELETE; no new tables; no R1B objects; all 9 migrations present; transaction closed'
