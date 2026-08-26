#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
#
# A sibling of the LOT C/D/E and R1A generators, deliberately NOT a
# modification of them: those lots are already deployed (or, for R1A, already
# validated) and their MASTER files must keep generating byte-for-byte what the
# operator applied. Same contract, same safety assertions, different migration
# list — and a DIFFERENT set of forbidden statements, because R1A adds no table
# and R1B is almost entirely new tables.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix is
# needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-r1b.sh
#   scripts/generate-master-r1b.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql"

# Only R1B. No R1A integrity migrations, no Worker V2 schema, no base FadeUp
# schema. R1B assumes R1A has already been applied and ASSERTS it at the top of
# the first migration rather than relying on this list's ordering.
MIGRATIONS=(
  "20260826100000_professional_identity.sql"
  "20260826100100_barber_professional_linkage.sql"
  "20260826100200_professional_identity_backfill.sql"
  "20260826100300_social_graph_follows.sql"
  "20260826100400_customer_professional_relationships.sql"
  "20260826100500_fade_passport_identity.sql"
  "20260826100600_fade_passport_backfill.sql"
  "20260826100700_acquisition_professional_linkage.sql"
  "20260826100800_professional_claims.sql"
  "20260826100900_public_projections.sql"
  "20260826101000_r1b_privilege_hardening.sql"
)

# Exactly the tables R1B is allowed to create. A CREATE TABLE for anything else
# means scope has leaked — most plausibly a public customer profile or a
# showcase, both of which are R6/R7 and both of which carry consent semantics
# this lot deliberately did not design.
ALLOWED_TABLES=(
  "public.professionals"
  "public.professional_follows"
  "public.customer_professional_relationships"
  "public.prospect_professionals"
  "public.professional_claims"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R1B, the Social-First identity and relationship foundation
-- Generated 2026-08-26. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r1b.sh
-- Verify in sync:   scripts/generate-master-r1b.sh --check
--
-- WHAT THIS IS
--
--   R1B is the durable data model the social product is built on. It is NOT
--   the social frontend: no feed, no messaging, no follower UI, no public
--   launch of Worker-discovered profiles. Those are R6/R7/R10 and are
--   deliberately absent.
--
--   It adds five tables, three columns, and a set of controlled write paths:
--
--     professionals                          a barber's identity, independent
--                                            of any shop they happen to work at
--     barbers.professional_id                the roster points at the identity
--     professional_follows                   the follow graph, with a durable
--                                            explicit-unfollow tombstone
--     customer_professional_relationships    services that actually happened
--     customer_passports.passport_number     the Passport becomes automatic
--     professional_claims                    taking control of an identity
--     prospect_professionals                 acquisition provenance, one-way
--
--   R1B REQUIRES R1A. The first migration asserts it — completed_at, the
--   appointment transition guard, booked_by_user_id and the non-cascading
--   barber FK must all be present — and refuses to install otherwise. That is
--   not ceremony: a durable identity built over deletable appointment history
--   and forgeable completion state would be theatre.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. EXPLICIT UNFOLLOW BEATS AUTOMATION, PERMANENTLY.
--      Auto-follow is ON CONFLICT DO NOTHING with no DO UPDATE branch
--      anywhere. It can only ever CREATE an edge, so no later booking can
--      reverse a customer's deliberate unfollow. Only the customer's own
--      manual follow can.
--
--   B. AUTO-FOLLOW USES booked_by_user_id AND NOTHING ELSE.
--      Not customers.user_id, which R1A demoted from evidence because it was
--      squattable and staff-settable. An anonymous booking, a kiosk walk-in
--      and a receptionist-typed appointment therefore produce NO follow. That
--      is lossy by design; the alternative is fabricating a relationship for
--      someone who never acted.
--
--   C. UNCLAIMED PROFILES CANNOT BE PUBLISHED, AND THE SCHEMA SAYS SO.
--      check (not is_public or claim_state = 'claimed'). R10 turns publication
--      on by removing that one clause, deliberately. Until then the unclaimed
--      public projection is correct and returns zero rows for every input.
--
--   D. AN UNCLAIMED PROFILE CANNOT IMPLY OPERATIONAL STATE, STRUCTURALLY.
--      All operational data — availability, services, hours, appointments,
--      queue entries — hangs off barbers/organizations and never off the
--      identity. An unclaimed professional has no barbers row, so there is no
--      column in which a fabricated wait time could be stored. The claimed and
--      unclaimed projections have DIFFERENT RETURNS TABLE shapes so a future
--      column cannot silently join the unclaimed contract.
--
--   E. EVERY REGISTERED CUSTOMER GETS A PASSPORT, AUTOMATICALLY.
--      Issued on customer_profiles insert and backfilled for everyone who
--      already exists. The number is 80 bits of CSPRNG, non-sequential, and
--      frozen — it is an IDENTIFIER, never an authenticator. The credential
--      remains the revocable hashed share token.
--
--   F. NEW TABLES SHIP WITH PRIVILEGES REVOKED, NOT MERELY WITH RLS.
--      Supabase default privileges grant anon and authenticated EVERYTHING on
--      any new table in public. Every R1B table revokes at creation, and
--      20260826101000 re-asserts the entire matrix and FAILS the migration if
--      any of it is wrong.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Creating a barbers row now also mints (or links) a professional
--      identity. No API changes; the trigger derives it.
--   2. barbers.professional_id is not writable by any client, and INSERT was
--      revoked at table level then re-granted per column. Anything writing
--      barbers must send only the columns it always sent.
--   3. Confirming an appointment for a signed-in booker now creates a follow
--      edge. Completing one now writes a relationship row.
--   4. Every customer_profiles insert now issues a Passport.
--   5. customer_passports gains two NOT NULL server-owned columns. The
--      existing PostgREST upsert is unaffected — user_id remains
--      UPDATE-grantable, which R1A recorded as load-bearing.
--   6. Deleting a professional identity that backs a roster row raises 23503.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Removes no table, removes no column, truncates nothing.
--   * Writes data in three places, all additive: the professional identity
--     backfill, the Passport backfill, and relationship rows created by new
--     triggers going forward. No existing row's meaning is rewritten.
--   * Does not touch the GiST exclusion constraints that decide booking races.
--   * Adds no anon RLS policy. The count stays at zero, and 20260826101000
--     asserts it.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--
--   R1A's verification must still pass unchanged:
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
-- Applied. Next steps: run
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in both.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R1B) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R1B) is OUT OF SYNC. Run scripts/generate-master-r1b.sh" >&2
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

# R1B adds no anon policy. The database has had zero since it shipped and the
# public contract is projections, not table reads. A `to anon` on a policy is
# the one-line mistake that would quietly turn a curated contract into an open
# table, so it is caught here as well as asserted at migration time.
if grep -iE -A3 'create[[:space:]]+policy' "$CODE_ONLY" | grep -iqE '^\s*to\s+.*\banon\b'; then
  echo '!! MASTER creates a policy granted to anon — R1B must add none' >&2
  fail=1
fi

if grep -iE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivqE 'where'; then
  echo '!! MASTER contains a DELETE with no WHERE clause on the same line' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivE 'where' | head -5 >&2
  fail=1
fi

# R1B creates tables — unlike R1A, which creates none — so the check is that it
# creates exactly the RIGHT ones. An unexpected CREATE TABLE means scope leaked.
while read -r created; do
  [[ -z "$created" ]] && continue
  allowed=0
  for t in "${ALLOWED_TABLES[@]}"; do
    [[ "$created" == "$t" ]] && allowed=1
  done
  if [[ "$allowed" -eq 0 ]]; then
    echo "!! MASTER creates an unexpected table: $created" >&2
    fail=1
  fi
done < <(grep -ioE '^[[:space:]]*create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?[a-z_]+\.[a-z_]+' "$CODE_ONLY" \
         | grep -oE '[a-z_]+\.[a-z_]+$' | sort -u)

for t in "${ALLOWED_TABLES[@]}"; do
  if ! grep -iqE "create[[:space:]]+table[[:space:]]+if[[:space:]]+not[[:space:]]+exists[[:space:]]+${t//./\\.}" "$CODE_ONLY"; then
    echo "!! MASTER is missing the table $t" >&2
    fail=1
  fi
done

# R1A objects must not be redefined here. R1B is additive on top of R1A, and a
# MASTER that quietly reissued an R1A guard would make the two lots impossible
# to roll back independently — which is the entire reason R1 was split.
if grep -iqE 'create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+public\.(enforce_appointment_transition|enforce_queue_transition|guard_customers_identity|offboard_barber|book_public_appointment|join_public_queue)\b' "$CODE_ONLY"; then
  echo '!! MASTER redefines an R1A function — R1B must be additive on top of R1A' >&2
  fail=1
fi

# Scope guards: these are the R6/R7/R10/R2 objects most likely to creep in.
if grep -iqE '(customer_public_profiles|professional_client_showcases|verified_client|entitlement|subscription_plan)' "$CODE_ONLY"; then
  echo '!! MASTER references out-of-scope objects (R2/R6/R7) — it must not' >&2
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

echo "safety checks passed: no DROP TABLE / TRUNCATE / DROP COLUMN / DROP ... CASCADE / RLS disable / unbounded DELETE; no anon policy; exactly ${#ALLOWED_TABLES[@]} expected tables; no R1A redefinition; no out-of-scope objects; all ${#MIGRATIONS[@]} migrations present; transaction closed"
