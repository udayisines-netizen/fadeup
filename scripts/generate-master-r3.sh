#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
#
# A sibling of the LOT C/D/E, R1A, R1B, R2 and Service Mode generators, and
# deliberately NOT a modification of any of them: those lots are already
# deployed or already validated, and their MASTER files must keep generating
# byte-for-byte what the operator applied.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix is
# needed, it goes in the migration and MASTER is regenerated.
#
# THE RISK THIS LOT'S ASSERTIONS ARE ABOUT
#
# Every previous lot's generator guards against ITS characteristic failure — a
# leaked table, a fabricated price, an enforcement guard that silently is not
# there. R3's characteristic failures are different and there are three:
#
#   A. THE ANALYTICS LOG BECOMES CLIENT-READABLE OR CLIENT-WRITABLE. One
#      stray GRANT and every tenant can read every other tenant's behaviour,
#      or forge their own numbers. Asserted below by forbidding any grant of
#      analytics_events to anon/authenticated in the generated artefact.
#
#   B. THE INSTALL INVENTS HISTORY. A backfill that manufactured events for
#      appointments completed before instrumentation would put fabricated
#      evidence into the one table whose whole value is that it is evidence,
#      with no honest occurred_at, actor or commercial snapshot. Asserted below
#      by requiring that the generated file, with function bodies stripped,
#      contains no INSERT INTO analytics_events — i.e. applying it writes no
#      events, even though the emitter it installs obviously contains one.
#
#   C. ANALYTICS BECOMES ABLE TO BREAK THE PRODUCT. Every trigger on a
#      business table must call the NON-FATAL emitter. A trigger that called
#      the strict one would let a malformed event refuse a customer's booking.
#
# Usage:
#   scripts/generate-master-r3.sh
#   scripts/generate-master-r3.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql"

# Only the R3 lot. No R1A, no R1B, no R2, no Service Mode, no base schema. R3
# consumes R1A's completion/queue transition guards, R1B's professional
# identity and claims, R2's private.effective_plan_key and the Service Mode
# lot's admission rules, and the first migration would fail to compile against
# a database that lacks them.
MIGRATIONS=(
  "20260827120000_analytics_event_foundation.sql"
  "20260827120100_analytics_event_taxonomy.sql"
  "20260827120200_analytics_ingestion.sql"
  "20260827120300_analytics_business_events.sql"
  "20260827120400_analytics_query_contracts.sql"
  "20260827120500_analytics_privilege_hardening.sql"
)

# Exactly the tables this lot is allowed to create. A CREATE TABLE for anything
# else means scope has leaked — most plausibly a rollup/aggregate table, which
# would be the start of the BI dashboard §18 defers, or a per-tenant analytics
# projection, which would be a second source of truth.
ALLOWED_TABLES=(
  "public.analytics_events"
  "public.analytics_event_definitions"
  "public.analytics_ingestion_rejections"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY" "$CODE_ONLY.nobody"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: the R3 analytics and event engine
-- Generated 2026-08-27. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r3.sh
-- Verify in sync:   scripts/generate-master-r3.sh --check
--
-- WHAT THIS IS
--
--   Before this file, FadeUp measured nothing. Not "measured badly" — there
--   was no PostHog, no GA, no Segment, no Sentry, no sendBeacon and no fetch
--   to any third-party host anywhere in the browser bundle. Every number about
--   the product was a hand-written SQL query against operational tables.
--
--   It adds four enums, three tables and the machinery that makes them mean
--   something:
--
--     analytics_events               the canonical APPEND-ONLY event log
--     analytics_event_definitions    the taxonomy, as data: 40 event contracts
--                                    across seven families, each versioned and
--                                    marked wired or deferred
--     analytics_ingestion_rejections why events were refused
--
--   Plus one client RPC, one internal emitter, one non-fatal wrapper, thirteen
--   AFTER triggers on existing business tables, four read contracts and a
--   retention primitive.
--
--   THIS LOT REQUIRES R1A, R1B, R2 AND SERVICE MODE. It composes R1A's
--   completion and queue transition guards (without which the timestamps it
--   records would be browser-supplied and worthless), R1B's durable
--   professional identity and claim lifecycle, and R2's
--   private.effective_plan_key. It changes no price, no plan, no capability
--   packaging and no identity semantics.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. NOTHING IS BACKFILLED, AND THAT IS THE POINT.
--      A shop with four hundred completed appointments from before this file
--      has ZERO analytics events after it. There is no honest occurred_at for
--      a service delivered last March, no honest actor, and no honest record
--      of which plan was in force. Manufacturing those would put fabricated
--      evidence into the one table whose entire value is that it is evidence.
--      The generator asserts that applying this file writes no events.
--
--      Consequence: every funnel starts empty and fills from the moment of
--      application. That is a real cost and it is the correct one.
--
--   B. ANALYTICS CANNOT REFUSE A CUSTOMER'S ACTION.
--      Every one of the thirteen triggers calls
--      private.try_emit_analytics_event, which wraps emission in a
--      subtransaction. A malformed event, a missing taxonomy row or a
--      constraint violation rolls back the EVENT and nothing else; the follow,
--      the booking, the completion and the claim all still commit. The failure
--      is recorded in analytics_ingestion_rejections instead of reaching the
--      customer. The companion VERIFY proves this by deliberately breaking
--      emission and asserting the Follow still succeeds.
--
--   C. THE EVENT LOG IS UNREACHABLE BY CLIENTS, BY CONSTRUCTION.
--      RLS is enabled AND forced on analytics_events, there is NO permissive
--      policy, and anon and authenticated hold no privilege on it whatsoever.
--      PostgREST cannot expose a table the client roles have no grant on, so
--      there is no policy to get subtly wrong. Reads go through four
--      SECURITY DEFINER contracts that authorize their own callers; writes go
--      through one client RPC that has no actor parameter at all.
--
--   D. CLICK IS NOT CONVERSION.
--      Every conversion event — appointment created/completed/cancelled, queue
--      joined/completed, follow, favorite, claim approved — originates from a
--      database state transition, not from a button. A tap that fails to
--      change state produces no event. The browser can emit only the ten
--      INTENT events, and the emission wall in the ingestion layer refuses any
--      attempt to send a business fact from a web origin.
--
--   E. HISTORICAL COMMERCIAL TERMS ARE FROZEN AT EMIT TIME.
--      plan_key and commercial_family are snapshotted onto each event, never
--      joined at read time. A service completed on salon_pro still reports as
--      salon_pro after the shop upgrades, downgrades or cancels.
--
--   F. ONE REAL PROFESSIONAL IS ONE CONVERSION, HOWEVER MANY SOURCES FOUND
--      THEM. external_profile_created hangs off prospect_professionals — the
--      unified prospect-to-identity linkage, unique per prospect — and the
--      platform funnel counts DISTINCT professional identities rather than
--      approval events. Multi-source discovery cannot inflate the count at
--      either end.
--
--   G. NO PARTITIONING, DELIBERATELY. The Postgres guidance bundled with this
--      repository puts the threshold at 100M rows and FadeUp has not emitted
--      one event yet. The design stays partition-COMPATIBLE — no inbound FKs,
--      append-only, occurred_at on every row, BRIN rather than a clustered
--      B-tree on time — so converting later is a data move, not a redesign.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No dashboard and no BI surface. No Worker V2, no crawling, no scraping, no
--   outreach, no campaign execution. No mobile application. No Marketplace
--   redesign. No CRM. No billing. No new pricing and no change to R2's plan
--   matrix. No SMS. No cron and no scheduled job of any kind. No third-party
--   analytics SDK and no request to any external host.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Writes no analytics row: no backfill, no fabricated history.
--   * Changes no existing table's data. The only DML is the taxonomy seed.
--   * Alters no existing function, RPC or policy belonging to R1A, R1B, R2 or
--     Service Mode.
--   * Adds no anon RLS policy. The database's count stays at zero.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--
--   The earlier lots' verifications must still pass unchanged:
--     supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--     supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_ORGANIZATION_FOLLOWS_2026_08_27.sql
--     supabase/VERIFY_CUSTOMER_API_FREEZE_2026_08_27.sql
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
--   supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--   supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in all five.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R3) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R3) is OUT OF SYNC. Run scripts/generate-master-r3.sh" >&2
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

# Only this lot's three tables.
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

# RISK A — THE LOG MUST NOT BECOME CLIENT-REACHABLE.
#
# One GRANT is the difference between "no tenant can read another tenant's
# behaviour" and "every tenant can". It would produce no error, no failing
# page and no symptom of any kind.
if grep -iqE 'grant[^;]*on[^;]*analytics_events[^;]*to[^;]*(anon|authenticated|public)' "$CODE_ONLY"; then
  echo '!! MASTER grants a client role privilege on analytics_events' >&2
  grep -inE 'grant[^;]*on[^;]*analytics_events[^;]*to' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if grep -iqE 'create[[:space:]]+policy[^;]*on[[:space:]]+public\.analytics_events' "$CODE_ONLY"; then
  echo '!! MASTER creates an RLS policy on analytics_events — the posture is "unreachable", not "selectively readable"' >&2
  fail=1
fi

# RISK B — NO FABRICATED HISTORY.
#
# The taxonomy seed is the only DML this lot performs. An INSERT into the event
# log at MIGRATION level would mean a backfill: events with an invented
# occurred_at, no real actor and no real commercial snapshot, indistinguishable
# afterwards from events that actually happened.
#
# The emitter's own INSERT lives inside a $$-quoted function body and is the
# entire point of the lot, so function bodies are stripped before this check.
# Checking the raw file would flag the emitter and make the assertion useless;
# checking with the bodies removed asks the question that actually matters —
# "does applying this file write any events?" — and the answer must be no.
awk '
  /(^|[^a-zA-Z_])as[[:space:]]*\$\$/ { inbody = 1 }
  inbody == 0 { print }
  /^\$\$;?[[:space:]]*$/ { inbody = 0 }
' "$CODE_ONLY" > "$CODE_ONLY.nobody"

if grep -iqE 'insert[[:space:]]+into[[:space:]]+public\.analytics_events' "$CODE_ONLY.nobody"; then
  echo '!! MASTER inserts into analytics_events at migration level — R3 backfills NOTHING, and fabricated history is worse than no history' >&2
  grep -inE 'insert[[:space:]]+into[[:space:]]+public\.analytics_events' "$CODE_ONLY.nobody" | head -5 >&2
  fail=1
fi

# And the emitter must still exist: a stripped-bodies check that passed because
# the lot forgot to create the emitter at all would be a false reassurance.
if ! grep -iqE 'insert[[:space:]]+into[[:space:]]+public\.analytics_events' "$CODE_ONLY"; then
  echo '!! MASTER contains no INSERT into analytics_events anywhere — the emitter is missing' >&2
  fail=1
fi

# RISK C — ANALYTICS MUST NOT BE ABLE TO REFUSE A BUSINESS ACTION.
#
# Every trigger on a business table calls the NON-FATAL wrapper. A call to the
# strict emitter from a trigger would let a malformed event abort a booking,
# and it would look completely reasonable in review.
if grep -nE 'perform private\.emit_analytics_event' "$CODE_ONLY" \
   | grep -qv 'track_analytics_event'; then
  # The client RPC is allowed to call the strict emitter — a browser that sends
  # a malformed event should learn that it did. Triggers are not.
  offenders="$(awk '/create or replace function public\.analytics_/,/^\$\$;/' "$CODE_ONLY" \
    | grep -cE 'private\.emit_analytics_event' || true)"
  if [[ "${offenders:-0}" -gt 0 ]]; then
    echo '!! MASTER has a business-table trigger calling the STRICT emitter — analytics could then refuse a booking' >&2
    fail=1
  fi
fi

# THE INSTRUMENTATION MUST BE PRESENT. Everything else in this lot is worthless
# if the triggers are not created: an analytics engine nothing emits into is an
# empty table with excellent documentation. A dropped migration or a silent
# `cat` failure produces exactly that, and nothing else would notice.
for trigger in \
  "create trigger organization_follows_analytics" \
  "create trigger professional_follows_analytics" \
  "create trigger customer_favorites_analytics" \
  "create trigger appointments_analytics_insert" \
  "create trigger appointments_analytics_update" \
  "create trigger queue_entries_analytics_insert" \
  "create trigger queue_entries_analytics_update" \
  "create trigger customer_passports_analytics" \
  "create trigger customer_professional_relationships_analytics" \
  "create trigger prospect_professionals_analytics" \
  "create trigger professional_claims_analytics_insert" \
  "create trigger professional_claims_analytics_update" \
  "create trigger commercial_plan_changes_analytics"; do
  if ! grep -iqF "$trigger" "$CODE_ONLY"; then
    echo "!! MASTER is missing an instrumentation trigger: $trigger" >&2
    fail=1
  fi
done

# The append-only guards. Without them "append-only" is a comment.
for guard in \
  "create trigger analytics_events_reject_update" \
  "create trigger analytics_events_reject_delete"; do
  if ! grep -iqF "$guard" "$CODE_ONLY"; then
    echo "!! MASTER is missing an append-only guard: $guard" >&2
    fail=1
  fi
done

# NO SCHEDULER. §25 keeps automation out of R3, and the shape it would take is
# a pg_cron entry for the retention purge.
if grep -iqE 'cron\.schedule|pg_cron|create[[:space:]]+extension[^;]*cron' "$CODE_ONLY"; then
  echo '!! MASTER installs a scheduled job — R3 provides the retention primitive, not a policy' >&2
  fail=1
fi

# NO EXISTING BUSINESS TABLE IS MUTATED. R3 observes; it does not change the
# product. An UPDATE against appointments or queue_entries here would mean
# instrumentation had started editing the thing it measures.
if grep -iqE '^[[:space:]]*update[[:space:]]+public\.(appointments|queue_entries|organization_follows|professional_follows|customer_favorites|organizations)\b' "$CODE_ONLY"; then
  echo '!! MASTER mutates a business table — analytics observes, it does not edit' >&2
  grep -inE '^[[:space:]]*update[[:space:]]+public\.(appointments|queue_entries|organization_follows|professional_follows|customer_favorites|organizations)\b' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "!! MASTER (R3) failed its safety assertions" >&2
  exit 1
fi

echo "MASTER (R3) passed all safety assertions."
