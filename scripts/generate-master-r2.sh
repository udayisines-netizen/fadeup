#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
#
# A sibling of the LOT C/D/E, R1A and R1B generators, deliberately NOT a
# modification of them: those lots are already deployed or already validated and
# their MASTER files must keep generating byte-for-byte what the operator
# applied. Same contract, same safety assertions, different migration list — and
# a DIFFERENT set of forbidden statements, because R2's risk is not a leaked
# table but a leaked PRIVILEGE and a fabricated price.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix is
# needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-r2.sh
#   scripts/generate-master-r2.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql"

# Only R2. No R1A, no R1B, no Worker V2, no base FadeUp schema. R2 assumes R1A
# and R1B have already been applied and ASSERTS it at the top of the first
# migration rather than relying on this list's ordering.
MIGRATIONS=(
  "20260826110000_commercial_plan_catalog.sql"
  "20260826110100_organization_commercial_state.sql"
  "20260826110200_commercial_state_backfill.sql"
  "20260826110300_entitlement_resolution.sql"
  "20260826110400_establishment_capacity_enforcement.sql"
  "20260826110500_operational_professional_capacity.sql"
  "20260826110600_plan_assignment_controls.sql"
  "20260826110700_r2_privilege_hardening.sql"
)

# Exactly the tables R2 is allowed to create. A CREATE TABLE for anything else
# means scope has leaked — most plausibly a subscription_seat / billed-location
# table, which the R0 draft proposed and which the authoritative pricing model
# explicitly forbids, or a Stripe mirror, which is a later lot entirely.
ALLOWED_TABLES=(
  "public.commercial_plans"
  "public.commercial_capabilities"
  "public.plan_capabilities"
  "public.organization_commercial_state"
  "public.commercial_plan_changes"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R2, the pricing and entitlements foundation
-- Generated 2026-08-26. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r2.sh
-- Verify in sync:   scripts/generate-master-r2.sh --check
--
-- WHAT THIS IS
--
--   R2 is the commercial model the product never had. Before it, plans, prices
--   and packaging existed only in TypeScript, one screen contradicted another,
--   and no trigger or policy could ask what an organization had paid for.
--
--   It adds five tables and the enforcement that makes them mean something:
--
--     commercial_plans                 the eight canonical plans and their caps
--     commercial_capabilities          the 30 real product capabilities
--     plan_capabilities                the one canonical plan/capability matrix
--     organization_commercial_state    one row per organization: what is in
--                                      force, and why
--     commercial_plan_changes          append-only commercial history
--
--   R2 REQUIRES R1A AND R1B. The first migration asserts it — professionals,
--   barbers.professional_id and appointments.completed_at must all be present —
--   and refuses to install otherwise.
--
-- THE PRICING, WHICH THIS FILE IS THE AUTHORITY FOR
--
--     free              EUR   0     1 establishment,  1 professional
--     solo              EUR  19     1 establishment,  1 professional
--     salon_essential   EUR  29     1 establishment,  team included
--     salon_pro         EUR  49     1 establishment,  team included  RECOMMENDED
--     salon_business    EUR  79     1 establishment,  team included
--     multi_growth      EUR  99     2 establishments, team included
--     multi_pro         EUR 149     5 establishments, team included  RECOMMENDED
--     multi_scale       EUR 249    10 establishments, team included
--
--   Every price is the TOTAL monthly price of the WHOLE plan. multi_pro is
--   EUR 149 for up to five establishments, not EUR 149 x 5. There is no
--   per-barber, per-seat, per-user or per-location amount anywhere, and
--   20260826110700 asserts the absence of any column a price could be
--   multiplied by.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. NO CLIENT CAN GRANT ITSELF A PLAN.
--      anon and authenticated hold SELECT and nothing else on every commercial
--      table, and no INSERT/UPDATE/DELETE policy exists on any of them. A
--      PATCH setting plan_key = 'multi_scale' has no statement to make. The
--      only writer is public.assign_commercial_plan(), which requires platform
--      admin and appends an immutable audit row.
--
--   B. EXISTING ORGANIZATIONS ARE BACKFILLED WITHOUT INVENTING A PAYMENT.
--      Each gets the CHEAPEST plan whose capacity already covers the shape it
--      has, stamped entitlement_source = 'early_access' with provider NULL.
--      No tier is inferred from usage; nothing claims money changed hands.
--      A one-location, one-professional organization lands on `solo`, and the
--      next barber it hires will be refused until its plan is changed. That is
--      the intended commercial behaviour, and it is the single most visible
--      consequence of applying this file.
--
--   C. CAPS ARE ENFORCED BY TRIGGERS, NOT BY POLICIES.
--      Locations are created by a direct PostgREST insert, so before R2 a
--      single-salon shop could create its eleventh address from a browser
--      console. The cap is a BEFORE INSERT trigger, which fires for
--      service_role and postgres too — an RLS `with check` would have held for
--      the browser and evaporated everywhere else.
--
--   D. THE CAPS ARE RACE-FREE, AND THE MUTEX IS A REAL ROW.
--      Every capacity check takes SELECT ... FOR UPDATE on the organization's
--      single commercial-state row before counting, so two concurrent "add
--      location" or "add barber" requests cannot both pass on the same stale
--      count. Counting alone would not have been enough.
--
--   E. A DOWNGRADE FAILS; IT NEVER DELETES.
--      multi_scale with eight establishments cannot become multi_growth. The
--      change is refused with an explanation. Nothing is deactivated, archived
--      or hidden to make a plan fit — the organization deactivates what it no
--      longer operates first, deliberately, and then changes plan.
--
--   F. CANCELLING IS NOT A DOWNGRADE.
--      status = canceled resolves to free capacity while the assigned plan
--      stays visible. A five-location group that cancels keeps all five and can
--      create no sixth. If cancelling were treated as a downgrade, an
--      organization that stopped paying could never be cancelled.
--
--   G. FREE IS A LEGITIMATE STATE, NOT AN ERROR.
--      Not an expiry, not a failed trial, not a lapsed subscription. It is
--      network presence: be findable, show your services and hours, keep your
--      Fade Passport. No booking, no customers, no team, no queue.
--
--   H. R2 IS NOT BILLING. There is no Stripe, no checkout, no webhook, no price
--      id and no payment method in this file. Three opaque provider_* columns
--      exist so a later billing lot needs no schema change, and R2 leaves all
--      three NULL everywhere.
--
-- WHAT R2 DELIBERATELY DOES NOT DO
--
--   It does not gate booking, the queue, customer records or retention at the
--   database boundary. Those capabilities resolve through the same resolver and
--   the UI consumes it, but switching hard enforcement on would silently remove
--   working behaviour from organizations that have been using it throughout
--   early access. That is a product decision with its own migration, not a
--   side effect of installing a price list.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Writes data in one place: the commercial-state backfill, which is
--     INSERT-only and idempotent.
--   * Touches no R1A or R1B object, and re-asserts their column protections.
--   * Adds no anon RLS policy. The count stays at zero, and 20260826110700
--     asserts it globally.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--
--   R1A's and R1B's verifications must still pass unchanged:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
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
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in all three.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R2) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R2) is OUT OF SYNC. Run scripts/generate-master-r2.sh" >&2
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

# R2 adds no anon policy. The database has had zero since it shipped, R1B
# asserts it, and the commercial model has no anonymous surface at all: the
# marketing pricing page renders the application's compiled catalogue. A
# `to anon` on a policy is the one-line mistake that would turn tenant-private
# commercial state into an open table.
if grep -iE -A3 'create[[:space:]]+policy' "$CODE_ONLY" | grep -iqE '^\s*to\s+.*\banon\b'; then
  echo '!! MASTER creates a policy granted to anon — R2 must add none' >&2
  fail=1
fi

# R2 deletes nothing at all, WHERE clause or not. A downgrade that removes an
# establishment to fit a plan is the single most damaging thing this lot could
# do, and it would look exactly like one small DELETE.
if grep -iqE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY"; then
  echo '!! MASTER contains a DELETE — R2 must never remove a row to satisfy a plan' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# Exactly the right tables. An unexpected CREATE TABLE means scope leaked.
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

# R1A and R1B objects must not be redefined here. R2 is additive on top of both,
# and a MASTER that quietly reissued one of their guards would make the lots
# impossible to roll back independently.
if grep -iqE 'create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+public\.(enforce_appointment_transition|enforce_queue_transition|guard_customers_identity|offboard_barber|book_public_appointment|join_public_queue|assign_barber_professional|guard_professional_identity|ensure_customer_passport|submit_professional_claim|review_professional_claim)\b' "$CODE_ONLY"; then
  echo '!! MASTER redefines an R1A/R1B function — R2 must be additive on top of both' >&2
  fail=1
fi

# NO BILLING PROVIDER. R2 is explicitly not the billing lot, and the single
# easiest way for that boundary to erode is for a provider name to appear in a
# migration "just to have the column ready". The provider_* columns are
# deliberately opaque text and must stay that way.
if grep -iqE '\bstripe\b|checkout_session|paymentintent|price_id|\bwebhook\b' "$CODE_ONLY"; then
  echo '!! MASTER references a billing provider — R2 must remain provider-agnostic' >&2
  grep -inE '\bstripe\b|checkout_session|paymentintent|price_id|\bwebhook\b' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# NO PER-SEAT PRICING, ASSERTED IN THE TEXT AS WELL AS IN THE SCHEMA.
# 20260826110700 checks the column names in the live catalogue; this checks that
# nobody wrote the arithmetic anywhere, in a column name or otherwise.
if grep -iqE 'price_minor[[:space:]]*\*|\*[[:space:]]*price_minor|per_seat|seat_count|per_barber|per_location_price' "$CODE_ONLY"; then
  echo '!! MASTER multiplies a price or names a per-seat concept — FadeUp prices are plan totals' >&2
  grep -inE 'price_minor[[:space:]]*\*|\*[[:space:]]*price_minor|per_seat|seat_count|per_barber|per_location_price' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# The eight canonical plan keys must all be present, at the canonical price.
# A MASTER that silently dropped a plan, or shipped a price nobody agreed to,
# is the one failure this generator exists to make impossible to miss.
EXPECTED_PLANS=(
  "free|0"
  "solo|1900"
  "salon_essential|2900"
  "salon_pro|4900"
  "salon_business|7900"
  "multi_growth|9900"
  "multi_pro|14900"
  "multi_scale|24900"
)
for entry in "${EXPECTED_PLANS[@]}"; do
  key="${entry%%|*}"
  price="${entry##*|}"
  if ! grep -qF "'$key'" "$CODE_ONLY"; then
    echo "!! MASTER is missing the plan $key" >&2
    fail=1
  fi
  # The seed row is the one line that carries both the key and its price.
  if ! grep -qE "'${key}'.*[^0-9]${price}[^0-9]" "$CODE_ONLY"; then
    echo "!! MASTER does not price $key at $price minor units" >&2
    fail=1
  fi
done

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

echo "safety checks passed: no DROP TABLE / TRUNCATE / DROP COLUMN / DROP ... CASCADE / RLS disable / DELETE of any kind; no anon policy; no billing provider; no price multiplication; exactly ${#ALLOWED_TABLES[@]} expected tables; all 8 canonical plans at their canonical prices; no R1A/R1B redefinition; all ${#MIGRATIONS[@]} migrations present; transaction closed"
