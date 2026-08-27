#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
#
# A sibling of the LOT C/D/E, R1A, R1B, R2, Service Mode and R3 generators, and
# deliberately NOT a modification of any of them: those lots are already
# deployed or already validated, and their MASTER files must keep generating
# byte-for-byte what the operator applied.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix is
# needed, it goes in the migration and MASTER is regenerated.
#
# THE RISKS THIS LOT'S ASSERTIONS ARE ABOUT
#
# Every previous lot's generator guards against ITS characteristic failure — a
# leaked table, a fabricated price, an invented analytics history. R4's are
# different and there are four:
#
#   A. THE GATE IS NOT ACTUALLY INSTALLED. Everything else in this lot is
#      decoration without one BEFORE INSERT trigger on prospect_professionals.
#      A dropped migration or a silent `cat` failure produces a file that
#      installs eleven block reasons nothing ever calls, and nothing else would
#      notice — the functions would all exist, the queue would render, and
#      publication would simply never be refused.
#
#   B. THE INSTALL PUBLISHES SOMETHING. This lot creates the machinery for
#      minting durable, claimable, public-facing identities for real businesses.
#      A migration that also USED it — even once, even "just for the eligible
#      ones" — would mint identities as a side effect of a schema upgrade, with
#      no operator ever looking at one. Asserted below by requiring that the
#      generated file, with function bodies stripped, calls no minting function
#      and inserts into prospect_professionals nowhere.
#
#   C. THE WORKER GAINS THE ABILITY TO PUBLISH. R4's division of labour is that
#      the machine evaluates evidence and a human decides. One GRANT reverses
#      that, and the reversal would look entirely reasonable in review.
#
#   D. THE GATE BECOMES CLIENT-REACHABLE. publication_block_reason is a
#      SECURITY DEFINER oracle: given a prospect id it will say whether FadeUp
#      holds a record of that business, whether it is suppressed, and whether it
#      has converted to a paying customer. Reachable by anon, that is an
#      enumeration endpoint.
#
# Usage:
#   scripts/generate-master-r4.sh
#   scripts/generate-master-r4.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql"

# Only the R4 lot. No R1A, R1B, R2, Service Mode, R3 or Worker V2 acquisition
# schema. R4 consumes R1B's create_external_professional and professionals,
# R3's private.try_emit_analytics_event and taxonomy, and the Worker V2
# acquisition schema's prospects/sources/suppressions/duplicates — and the
# first migration would fail to compile against a database that lacks them.
MIGRATIONS=(
  "20260828100000_prospect_publication_eligibility.sql"
  "20260828100100_external_profile_publication.sql"
  "20260828100200_acquisition_analytics_events.sql"
  "20260828100300_r4_privilege_hardening.sql"
)

# Exactly the tables this lot is allowed to create. A CREATE TABLE for anything
# else means scope has leaked — most plausibly a "published identities" mirror,
# which would be a second source of truth for something prospect_professionals
# already answers, or an outreach/campaign table, which belongs to R17.
ALLOWED_TABLES=(
  "public.prospect_publication_eligibility"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY" "$CODE_ONLY.nobody"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R4, the Worker core and acquisition engine
-- Generated 2026-08-28. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r4.sh
-- Verify in sync:   scripts/generate-master-r4.sh --check
--
-- WHAT THIS IS
--
--   Constitution §5.1 states the acquisition pipeline as:
--
--     SOURCE -> SOURCE OBSERVATION -> NORMALIZED CANDIDATE -> CANONICAL
--     PROSPECT -> PUBLIC ELIGIBILITY -> EXTERNAL UNCLAIMED PROFILE -> CLAIM
--     -> CLAIMED PROFESSIONAL / BUSINESS
--
--   Everything before PUBLIC ELIGIBILITY has shipped and is production quality:
--   the Worker's sources, normalizers, identity resolution, enrichment and
--   scoring. Everything after it shipped in R1B: create_external_professional
--   mints an unclaimed identity, professional_claims lets a real person take it
--   over.
--
--   PUBLIC ELIGIBILITY itself did not exist anywhere. Nothing decided WHICH
--   canonical prospects deserve a durable FadeUp identity, which meant the only
--   thing standing between a single scrape and a permanent public-facing name
--   was that no code had called the RPC yet. That is not a safe default; it is
--   an unexercised one.
--
--   This file adds one table, one column, one view, five functions, three
--   triggers and one rewritten CHECK constraint:
--
--     prospect_publication_eligibility   the CACHED verdict, for the operator
--                                        review queue
--     publication_block_reason           the LIVE gate: eleven reasons, first
--                                        hit wins, NULL means publishable
--     publish_external_professional      the operator's front door
--     prospect_publication_queue         a narrow read projection for /platform
--     prospect_sources.is_identity_trust_anchor
--
--   plus the two acquisition analytics contracts R3 documented and deliberately
--   left deferred, now wired.
--
--   THIS LOT REQUIRES R1B, R3 AND THE WORKER V2 ACQUISITION SCHEMA.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. THE GATE GUARDS THE DOOR; IT DOES NOT AUDIT THE BUILDING.
--      The trigger fires on INSERT. Identities that already exist are NOT
--      re-validated, and most of them would fail if they were — nothing
--      previously required two independent sources. That is deliberate: people
--      may already have claimed those identities, and retroactively
--      invalidating a claimed profile would be a far worse error than having
--      published it. The companion SEED proves this with a pre-existing
--      single-source identity that survives the upgrade untouched.
--
--   B. THIS FILE PUBLISHES NOTHING. It installs the machinery for minting
--      external identities and mints zero. Every publication is an explicit
--      platform-administrator decision through publish_external_professional,
--      written to platform_audit_log with the name as published. The generator
--      asserts that applying this file creates no linkage row.
--
--   C. THE WORKER EVALUATES; A HUMAN DECIDES. prospect_worker gets EXECUTE on
--      the gate and the sweep, and is explicitly REVOKED from
--      publish_external_professional — asserted inside the migration itself, so
--      a later lot that wants a bounded auto-publish lane has to remove an
--      assertion somebody wrote down on purpose.
--
--   D. THE CACHE IS NOT THE GUARANTEE. prospect_publication_eligibility is a
--      refreshed copy for listing; the BEFORE INSERT trigger consults the LIVE
--      function. A stale cache can mislead an operator about what is available
--      to review; it can never permit a publication the live gate would refuse.
--
--   E. THE ELEVEN REASONS ARE EVIDENCE-BASED, NOT SCORE-BASED. Not one of them
--      consults fadeup_fit_score or migration_potential. "Is this a real
--      business we can name correctly" and "is this a good sales lead" are
--      different questions, and publication asks only the first.
--
--   F. NOTHING IS BACKFILLED. No prospect is evaluated by this file; the cache
--      fills from the Worker's first sweep forward, exactly as R3's funnels
--      fill from application forward.
--
--   G. THE ACQUISITION FUNNEL GAINS ITS HEAD. prospect_discovered and
--      prospect_enriched move from `deferred` to `wired`. They are emitted by
--      AFTER triggers on tables the Worker already writes — NOT by granting the
--      Worker access to the analytics emitter, which R3 §11.3 refused on the
--      grounds that a scraping worker is the highest-risk credential in the
--      system. That refusal stands.
--
--   H. ONE CORRECTION TO A CLOSED LOT. R1B created a platform-staff SELECT
--      policy on prospect_professionals and revoked ALL from authenticated,
--      including SELECT. Postgres checks the grant before any policy, so that
--      policy has never been reachable. R4 grants SELECT on three columns
--      (prospect_id, professional_id, created_at) so the policy can run;
--      match_confidence and matching_rule stay ungranted.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No auto-publication of any kind. No fuzzy matching, no auto-merge, no
--   manual eligibility override. No change to the Worker's discovery,
--   enrichment, dedupe, scoring or outreach pipeline — that machinery is
--   untouched. No campaign entity. No new pricing, plan or capability. No SMS.
--   No cron and no scheduled job. No mobile application.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Mints no professional identity and writes no prospect_professionals row.
--   * Changes no existing row except prospect_sources.is_identity_trust_anchor
--     on the single `sirene` row, from the column's own default.
--   * Adds no anon RLS policy and no anon grant.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--
--   The earlier lots' verifications must still pass:
--     supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--     supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_ORGANIZATION_FOLLOWS_2026_08_27.sql
--     supabase/VERIFY_CUSTOMER_API_FREEZE_2026_08_27.sql
--     supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--     supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
--
--   NOTE: R4 required fixture corrections in three earlier suites — R1B's mint
--   fixtures now provision real provenance, R3's deferred-contract count became
--   an invariant, and R1A's public-table allow-list names the new table. Those
--   are corrections to tests, not relaxations of guarantees; each is commented
--   in place.
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
--   supabase/VERIFY_R4_WORKER_ACQUISITION_ENGINE_2026_08_28.sql
--   supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--   supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--   supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- and confirm 0 FAIL rows in all seven.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R4) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R4) is OUT OF SYNC. Run scripts/generate-master-r4.sh" >&2
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
check_forbidden '^[[:space:]]*delete[[:space:]]+from' 'DELETE'

# Only this lot's one table.
while read -r line; do
  table="$(echo "$line" | sed -E 's/.*create table (if not exists )?([a-z_]+\.[a-z_]+).*/\2/I')"
  allowed=0
  for t in "${ALLOWED_TABLES[@]}"; do
    [[ "$table" == "$t" ]] && allowed=1
  done
  if [[ "$allowed" -eq 0 ]]; then
    echo "!! MASTER creates a table outside this lot's scope: $table" >&2
    fail=1
  fi
done < <(grep -iE '^[[:space:]]*create table' "$CODE_ONLY" || true)

# ---------------------------------------------------------------------------
# RISK A — THE GATE MUST ACTUALLY BE INSTALLED.
#
# Without this trigger the eleven block reasons are a library nothing calls.
# The functions would all exist, the operator queue would render, and
# publication would simply never be refused — a failure with no symptom.
# ---------------------------------------------------------------------------
for trigger in \
  "create trigger prospect_professionals_enforce_publication_gate" \
  "create trigger prospect_source_records_analytics" \
  "create trigger prospects_enrichment_analytics"; do
  if ! grep -iqF "$trigger" "$CODE_ONLY"; then
    echo "!! MASTER is missing a required trigger: $trigger" >&2
    fail=1
  fi
done

# And it must be a BEFORE trigger. An AFTER INSERT trigger that raised would
# also refuse the row, but it would run after every constraint and after any
# other AFTER trigger — including R3's external_profile_created emitter, which
# would then have counted a publication that did not happen.
if ! grep -izqE 'create trigger prospect_professionals_enforce_publication_gate[[:space:]]+before[[:space:]]+insert' "$CODE_ONLY"; then
  echo '!! MASTER installs the publication gate as something other than BEFORE INSERT' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK B — THE INSTALL MUST PUBLISH NOTHING.
#
# The minting call lives inside publish_external_professional's body and is the
# point of the lot, so function bodies are stripped before this check. Checking
# the raw file would flag the function and make the assertion useless; checking
# with bodies removed asks the question that actually matters — "does applying
# this file mint any identity?" — and the answer must be no.
# ---------------------------------------------------------------------------
awk '
  /(^|[^a-zA-Z_])as[[:space:]]*\$\$/ { inbody = 1 }
  inbody == 0 { print }
  /^\$\$;?[[:space:]]*$/ { inbody = 0 }
' "$CODE_ONLY" > "$CODE_ONLY.nobody"

if grep -iqE 'insert[[:space:]]+into[[:space:]]+public\.(prospect_professionals|professionals)' "$CODE_ONLY.nobody"; then
  echo '!! MASTER mints an identity at migration level — R4 publishes NOTHING, a human decides' >&2
  grep -inE 'insert[[:space:]]+into[[:space:]]+public\.(prospect_professionals|professionals)' "$CODE_ONLY.nobody" | head -5 >&2
  fail=1
fi

if grep -iqE '(select|perform)[^;]*(create_external_professional|publish_external_professional)' "$CODE_ONLY.nobody"; then
  echo '!! MASTER calls a minting function at migration level' >&2
  fail=1
fi

# Nor may it evaluate. A migration-level sweep would be harmless but would make
# "the cache fills from the first sweep forward" untrue, and the next person to
# read the docs would be reading a lie.
if grep -iqE '(select|perform)[^;]*(sweep_prospect_publication_eligibility|refresh_prospect_publication_eligibility)' "$CODE_ONLY.nobody"; then
  echo '!! MASTER evaluates eligibility at migration level — nothing is backfilled' >&2
  fail=1
fi

# And the front door must still exist: a stripped-bodies check that passed
# because the lot forgot to create the publisher would be a false reassurance.
if ! grep -iqE 'create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+public\.publish_external_professional' "$CODE_ONLY"; then
  echo '!! MASTER contains no publish_external_professional — the operator has no door' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK C — THE WORKER MUST NOT GAIN THE ABILITY TO PUBLISH.
# ---------------------------------------------------------------------------
if grep -iqE 'grant[^;]*execute[^;]*publish_external_professional[^;]*to[^;]*prospect_worker' "$CODE_ONLY"; then
  echo '!! MASTER grants the acquisition worker EXECUTE on publish_external_professional' >&2
  fail=1
fi

if grep -iqE 'grant[^;]*(insert|update|delete)[^;]*prospect_publication_eligibility[^;]*to[^;]*prospect_worker' "$CODE_ONLY"; then
  echo '!! MASTER lets the worker write the eligibility cache directly — one writer only, the refresh RPC' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# RISK D — THE GATE MUST NOT BECOME AN ANON-REACHABLE ORACLE.
# ---------------------------------------------------------------------------
if grep -iqE 'grant[^;]*(publication_block_reason|refresh_prospect_publication_eligibility|sweep_prospect_publication_eligibility|publish_external_professional|prospect_publication_eligibility|prospect_publication_queue)[^;]*to[^;]*\banon\b' "$CODE_ONLY"; then
  echo '!! MASTER grants anon access to the publication gate — that is an enumeration oracle for FadeUp'"'"'s prospect list' >&2
  grep -inE 'grant[^;]*to[^;]*anon' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if grep -iqE 'create[[:space:]]+policy[^;]*on[[:space:]]+public\.prospect_publication_eligibility[^;]*to[^;]*\banon\b' "$CODE_ONLY"; then
  echo '!! MASTER creates an anon policy on the eligibility cache' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# THE ACQUISITION EVENT CONTRACTS MUST BE WIRED.
#
# A deferred definition cannot emit a single row, so a lot that created both
# triggers but forgot the taxonomy update would produce an empty funnel head
# that reports zero rather than failing.
# ---------------------------------------------------------------------------
for event in prospect_discovered prospect_enriched; do
  if ! grep -izqE "update public\.analytics_event_definitions[^;]*status = 'wired'[^;]*event_name = '$event'" "$CODE_ONLY"; then
    echo "!! MASTER does not wire the $event contract" >&2
    fail=1
  fi
done

# The triggers must call the NON-FATAL emitter. A call to the strict one would
# let a malformed event abort a discovery — R3 §11.4 applied to R4's new path,
# and it would look completely reasonable in review.
if grep -iqE 'perform private\.emit_analytics_event' "$CODE_ONLY"; then
  echo '!! MASTER has a trigger calling the STRICT emitter — a malformed event could then abort a scrape' >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# NO EXISTING ACQUISITION DATA IS REWRITTEN.
#
# The one permitted UPDATE is the trust-anchor flag on the single `sirene`
# source row. Anything else — a status normalisation, a name cleanup, a
# do_not_contact reset — would silently damage a pipeline that has been running.
# ---------------------------------------------------------------------------
offenders="$(grep -inE '^[[:space:]]*update[[:space:]]+public\.' "$CODE_ONLY.nobody" \
  | grep -viE 'update[[:space:]]+public\.(prospect_sources|analytics_event_definitions)\b' || true)"
if [[ -n "$offenders" ]]; then
  echo '!! MASTER updates an existing table outside the two it is allowed to touch' >&2
  echo "$offenders" | head -5 >&2
  fail=1
fi

# NO SCHEDULER. The Worker's own queue schedules the evaluation sweep; a
# pg_cron entry here would be a second, invisible scheduler.
if grep -iqE 'cron\.schedule|pg_cron|create[[:space:]]+extension[^;]*cron' "$CODE_ONLY"; then
  echo '!! MASTER installs a scheduled job — the Worker queue is the scheduler' >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "!! MASTER (R4) failed its safety assertions" >&2
  exit 1
fi

echo "MASTER (R4) passed all safety assertions."
