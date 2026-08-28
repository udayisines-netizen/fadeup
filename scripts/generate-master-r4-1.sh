#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
#
# MASTER is DERIVED from db/migrations, never hand-edited.
#
# THE RISKS THIS LOT'S ASSERTIONS ARE ABOUT
#
# R4.1 is small, and its characteristic failure is the opposite of R4's. R4
# could have created something dangerous; R4.1 changes an existing guarantee,
# and the ways that goes wrong are:
#
#   A. THE TIGHTENING DOES NOT BITE. The gate still counts distinct source
#      rows, OSM + Geoapify still reads as two independent observers, and a
#      business seen once by OpenStreetMap and again by a service that
#      redistributes OpenStreetMap still mints a durable public identity.
#      No symptom, no error, no way to notice.
#
#   B. THE TIGHTENING BITES EVERYTHING. Every prospect becomes ineligible, the
#      publication queue empties, and acquisition silently stops producing
#      supply. Also no error.
#
#   C. PLANITY BECOMES AN IDENTITY SOURCE. If the planity source were seeded as
#      a trust anchor, or if the enrichment path wrote prospect_source_records,
#      a business's own link to its own booking page would count as independent
#      corroboration of its own existence.
#
#   D. THE FILE TOUCHES PRODUCT DATA. It is allowed to delete stale cached
#      VERDICTS and nothing else.
#
# Usage:
#   scripts/generate-master-r4-1.sh
#   scripts/generate-master-r4-1.sh --check

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql"

# R4.1 requires R4: it replaces publication_block_reason, which R4 created.
MIGRATIONS=(
  "20260828110000_planity_booking_status_and_source_independence.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY" "$CODE_ONLY.nobody"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R4.1, Planity booking status and source independence
-- Generated 2026-08-28. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r4-1.sh
-- Verify in sync:   scripts/generate-master-r4-1.sh --check
--
-- WHAT THIS IS
--
--   Two changes, and the second matters more than the first.
--
--   1. BOOKING STATUS. booking_provider_observations gains `booking_status`
--      (ACTIVE / LISTED_ONLY / UNKNOWN) and the detection-method enum gains
--      `provider_public_page`. Until now every provider detection came from
--      the BUSINESS's own website, where the only observable fact is "this
--      site links to Planity". Reading the provider's own public page makes a
--      second, different fact observable: whether the listing is actually
--      bookable. UNKNOWN is the default and every existing row keeps it,
--      because a link cannot know.
--
--   2. SOURCE INDEPENDENCE. public.publication_block_reason requires "two
--      independent sources, or one verified registry", and implemented that as
--      count(distinct source_id) — which assumes every source row is an
--      independent observer. That assumption has been false since the
--      acquisition schema shipped: Geoapify's places data is substantially
--      derived from OpenStreetMap, so a prospect seen by OSM and by Geoapify
--      has been seen ONCE and reported twice, and under the old rule that
--      cleared the evidence bar and minted a durable public identity.
--
--      prospect_sources gains `independence_group`. Sources sharing a group
--      count once. A source with no group is its own group, so every existing
--      source keeps its current meaning unless explicitly grouped.
--
--   THIS LOT REQUIRES R4. It replaces publication_block_reason, which R4
--   created, and every other branch of that function is carried forward
--   verbatim — diffing the two should show exactly one changed clause.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. THIS TIGHTENS THE PUBLICATION GATE, ON PURPOSE.
--      A prospect known only from OSM + Geoapify was eligible before this file
--      and is refused after it with `insufficient_source_evidence`. That was
--      the correct answer both times; the gate simply could not express it.
--      Expect the "Ready to publish" queue to shrink. A third, independent
--      source — Google Places, Sirene, the business's own website — restores
--      eligibility, because the rule counts observers rather than blacklisting
--      a provider.
--
--   B. STALE ELIGIBLE VERDICTS ARE DELETED, NOT RECOMPUTED.
--      Every cached ELIGIBLE verdict predating this file may now be wrong in
--      the dangerous direction. The live gate would still refuse the
--      publication, so nothing unsafe can happen — but an operator would be
--      looking at a candidate that cannot be published, which is exactly the
--      "the operator is lied to" failure R4 built the cache discipline around.
--      The rows are deleted; the Worker's publication_evaluation sweep prefers
--      never-evaluated prospects, so they are re-derived on the next pass and
--      the queue is briefly EMPTY instead of briefly WRONG.
--
--      This is the only DML against existing data in the file, and it touches
--      a cache, never a fact.
--
--   C. PLANITY IS REGISTERED AS A SOURCE BUT CANNOT PUBLISH ANYTHING.
--      It is not an identity trust anchor, it has its own independence group,
--      and the enrichment job writes no prospect_source_records at all — the
--      page is reached by following a link the business published about
--      itself, so it is the same evidence chain as `website`, one hop longer.
--      The source row exists so the quota guard and api_source_health work.
--
--   D. NOTHING IS BACKFILLED AND NOTHING IS FETCHED.
--      Applying this file makes no network request and evaluates no prospect.
--      Every existing observation keeps booking_status = 'UNKNOWN' until a
--      planity_enrichment job actually reads a page.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No discovery, no search, no URL enumeration, no bulk crawl. No new table.
--   No change to the R4 publication gate's other ten reasons, its trigger, its
--   grants or its privilege posture. No outreach. No scoring rule.
--
-- SAFETY
--   * Runs inside a single transaction.
--   * Creates no table, removes no table, removes no column, truncates nothing.
--   * The only DELETE targets prospect_publication_eligibility, a cache.
--   * Mints no professional identity and writes no prospect_professionals row.
--   * Adds no anon grant and no anon policy.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
--
--   Then run, and confirm zero FAIL rows in each:
--     supabase/VERIFY_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
--     supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--     supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
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
-- Applied. The publication queue will be briefly empty: stale ELIGIBLE verdicts
-- were deleted and the Worker's publication_evaluation sweep re-derives them.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R4.1) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R4.1) is OUT OF SYNC. Run scripts/generate-master-r4-1.sh" >&2
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

# R4.1 creates NO table. Anything here means scope leaked.
if grep -iqE '^[[:space:]]*create[[:space:]]+table' "$CODE_ONLY"; then
  echo '!! MASTER creates a table — R4.1 adds columns and a source row, nothing more' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK D — THE ONLY DELETE MAY TARGET THE CACHE, AND NOTHING ELSE.
# ---------------------------------------------------------------------------
offending_deletes="$(grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" \
  | grep -viE 'delete[[:space:]]+from[[:space:]]+public\.prospect_publication_eligibility' || true)"
if [[ -n "$offending_deletes" ]]; then
  echo '!! MASTER deletes from something other than the eligibility cache' >&2
  echo "$offending_deletes" | head -5 >&2
  fail=1
fi

# Existing rows may be UPDATEd only in the two catalogue tables.
offending_updates="$(grep -inE '^[[:space:]]*update[[:space:]]+public\.' "$CODE_ONLY" \
  | grep -viE 'update[[:space:]]+public\.prospect_sources\b' || true)"
if [[ -n "$offending_updates" ]]; then
  echo '!! MASTER updates a table outside prospect_sources' >&2
  echo "$offending_updates" | head -5 >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK A — THE TIGHTENING MUST ACTUALLY BE IN THE FILE.
#
# If the gate still counts distinct source_id, everything else here is
# decoration and the bug this lot exists to close stays open.
# ---------------------------------------------------------------------------
if ! grep -iqE 'count\(distinct coalesce\(ps\.independence_group, ps\.key\)\)' "$CODE_ONLY"; then
  echo '!! MASTER does not make the gate count independence groups — the tightening is missing' >&2
  fail=1
fi

if grep -iqE 'count\(distinct psr\.source_id\)' "$CODE_ONLY"; then
  echo '!! MASTER still counts distinct source rows somewhere — the old rule survived' >&2
  fail=1
fi

if ! grep -iqE "independence_group = 'openstreetmap'" "$CODE_ONLY"; then
  echo '!! MASTER does not group Geoapify with OpenStreetMap' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK C — PLANITY MUST NOT BECOME AN IDENTITY SOURCE.
# ---------------------------------------------------------------------------
if grep -izqE "insert into public\.prospect_sources[^;]*'planity'[^;]*is_identity_trust_anchor[^;]*true" "$CODE_ONLY"; then
  echo '!! MASTER seeds planity as an identity trust anchor' >&2
  fail=1
fi

if grep -iqE 'insert[[:space:]]+into[[:space:]]+public\.prospect_source_records' "$CODE_ONLY"; then
  echo '!! MASTER writes prospect_source_records — Planity evidence must never count toward publication' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# THE R4 GATE'S OTHER GUARANTEES MUST SURVIVE.
# ---------------------------------------------------------------------------
if grep -iqE 'drop[[:space:]]+trigger[^;]*prospect_professionals_enforce_publication_gate' "$CODE_ONLY"; then
  echo '!! MASTER drops the publication gate trigger' >&2
  fail=1
fi

if grep -iqE 'grant[^;]*publish_external_professional[^;]*to[^;]*prospect_worker' "$CODE_ONLY"; then
  echo '!! MASTER lets the worker publish' >&2
  fail=1
fi

if grep -iqE 'grant[^;]*to[^;]*\banon\b' "$CODE_ONLY"; then
  echo '!! MASTER grants something to anon' >&2
  grep -inE 'grant[^;]*to[^;]*anon' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# The replaced gate must still pin its search_path.
if ! grep -izqE 'create or replace function public\.publication_block_reason[^$]*set search_path' "$CODE_ONLY"; then
  echo '!! MASTER replaces publication_block_reason without pinning search_path' >&2
  fail=1
fi

# NO NETWORK, NO SCHEDULER.
if grep -iqE 'cron\.schedule|pg_cron|create[[:space:]]+extension[^;]*(cron|http)' "$CODE_ONLY"; then
  echo '!! MASTER installs a scheduler or an HTTP extension' >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "!! MASTER (R4.1) failed its safety assertions" >&2
  exit 1
fi

echo "MASTER (R4.1) passed all safety assertions."
