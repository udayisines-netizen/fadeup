#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_LOTS_A_A5_B_2026_08_18.sql
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
#   scripts/generate-master-lots-a-a5-b.sh
#   scripts/generate-master-lots-a-a5-b.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_LOTS_A_A5_B_2026_08_18.sql"

# Only this run's migrations. No Worker V2 schema, no base FadeUp schema.
MIGRATIONS=(
  "20260818200000_organization_creation_hardening.sql"
  "20260818210000_identity_and_access_resolution.sql"
  "20260818220000_business_profile_and_onboarding.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: LOT A + LOT A.5 + LOT B
-- Generated 2026-08-18. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-lots-a-a5-b.sh
-- Verify in sync:   scripts/generate-master-lots-a-a5-b.sh --check
--
-- WHAT THIS IS
--   The ordered, effective SQL required to upgrade the CURRENT FadeUp
--   database with ONLY this run's changes:
--
--     LOT A    Close the organization-creation authorization bypass
--              (SEC-01): revoke the client INSERT grant, remove the
--              permissive INSERT policy, and add a BEFORE INSERT guard so
--              organizations can only be created through
--              create_organization() or review_professional_application().
--
--     LOT A.5  Universal identity. Google and Apple become authentication
--              methods for every FadeUp user type. Almost all of that is
--              GoTrue configuration and frontend wiring; the database part
--              is (a) making profile creation survive OAuth metadata,
--              including a Sign in with Apple that supplies no name at all,
--              and (b) get_my_access(), the ONE authoritative post-auth
--              access resolver. No table mirrors auth.identities: a second
--              identity store would be a second, weaker source of truth.
--
--     LOT B    Business identity columns (business_type, currency,
--              country_code), one authoritative onboarding-readiness
--              evaluator, idempotent onboarding RPCs, a server-side
--              publication gate, and an approval flow that finally stops
--              discarding the address the applicant already gave us.
--
--   It is a byte-for-byte concatenation of these version-controlled
--   migrations, which remain the source of truth:
--     db/migrations/20260818200000_organization_creation_hardening.sql
--     db/migrations/20260818210000_identity_and_access_resolution.sql
--     db/migrations/20260818220000_business_profile_and_onboarding.sql
--
--   No fix exists only here. If something must change, change the
--   migration and regenerate.
--
-- WHAT THIS IS NOT
--   It does not create the base FadeUp schema, and it contains no Worker V2
--   / acquisition schema whatsoever. It assumes the existing database
--   already has: the `private` and `extensions` schemas, public.organizations
--   / memberships / locations / services / barbers / staff_profiles and
--   their RLS, public.professional_applications and
--   review_professional_application(), public.platform_members and the
--   private.is_platform_admin() / has_org_role() / is_org_member() helpers,
--   and public.set_organization_marketplace_visible().
--
-- BEHAVIOUR CHANGES AN OPERATOR SHOULD EXPECT
--   1. A direct client INSERT into public.organizations now fails. Nothing
--      in the application does this (verified: the frontend only reads
--      organizations and updates marketplace_visible), and both legitimate
--      creation RPCs are updated in the same transaction.
--   2. Setting organizations.marketplace_visible = true now requires
--      get_organization_readiness().ready_to_publish. ALREADY-published
--      organizations are unaffected — the gate only fires on the false ->
--      true transition, and unpublishing is never blocked. An existing
--      published-but-incomplete organization keeps its visibility until
--      someone unpublishes it, at which point it must be completed to
--      publish again.
--   3. Approving a professional application now also creates the first
--      location from the application's address and seeds business_type,
--      country_code and currency. Previously approved organizations are not
--      retroactively changed.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back. There is no partially-upgraded state.
--   * Contains no DROP TABLE, no TRUNCATE, no DROP FUNCTION ... CASCADE,
--     no DROP TYPE ... CASCADE, no mass DELETE, and never disables row
--     level security.
--   * Idempotent: every object is created IF NOT EXISTS, via CREATE OR
--     REPLACE, or inside a guarded DO block, so re-running is safe.
--   * The one policy removal (organizations_insert) is the entire point of
--     LOT A and REMOVES access rather than granting it.
--
-- HOW TO APPLY
--   Review first, then run against the target database as a role that can
--   create objects in `public` and `private` (postgres in the self-hosted
--   Supabase stack):
--
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_LOTS_A_A5_B_2026_08_18.sql
--
--   Then run the companion verification script and confirm zero
--   unexpected FAIL rows:
--
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql
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
--   supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql
-- and confirm 0 unexpected FAIL rows.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (LOTS A/A.5/B) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (LOTS A/A.5/B) is OUT OF SYNC. Run scripts/generate-master-lots-a-a5-b.sh" >&2
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
