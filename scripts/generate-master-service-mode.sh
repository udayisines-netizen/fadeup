#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql
#
# A sibling of the LOT C/D/E, R1A, R1B and R2 generators, deliberately NOT a
# modification of any of them: those lots are already deployed or already
# validated, and their MASTER files must keep generating byte-for-byte what the
# operator applied. Same contract, same shape, different migration list — and a
# different set of forbidden statements, because this lot's risk is neither a
# leaked table nor a fabricated price. It is an ENFORCEMENT GUARD THAT SILENTLY
# ISN'T THERE, and a mode change that quietly cancels a customer.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix is
# needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-service-mode.sh
#   scripts/generate-master-service-mode.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql"

# Only the Service Mode lot. No R1A, no R1B, no R2, no Worker V2, no base
# schema. This lot assumes R1A/R1B/R2 have already been applied — it consumes
# R2's private.org_has_capability directly — and the first migration would fail
# to compile against a database that lacks them.
MIGRATIONS=(
  "20260826120000_service_mode_foundation.sql"
  "20260826120100_barber_service_mode_override.sql"
  "20260826120200_service_mode_overrides.sql"
  "20260826120300_effective_service_mode.sql"
  "20260826120400_service_mode_controls.sql"
  "20260826120500_service_mode_enforcement.sql"
  "20260826120600_service_mode_contracts.sql"
  "20260826120700_service_mode_privilege_hardening.sql"
)

# Exactly the tables this lot is allowed to create. A CREATE TABLE for anything
# else means scope has leaked — most plausibly a recurring-schedule table, which
# §12 explicitly defers, or a per-organization service mode, which would force
# every salon in a multi-salon group to operate identically.
ALLOWED_TABLES=(
  "public.location_service_settings"
  "public.service_mode_overrides"
  "public.service_mode_changes"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: the Service Mode foundation
-- Generated 2026-08-26. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-service-mode.sh
-- Verify in sync:   scripts/generate-master-service-mode.sh --check
--
-- WHAT THIS IS
--
--   FadeUp sells two operating channels — reservations and a live walk-in
--   queue — and until this file the product had no way to SAY which of them a
--   shop is currently running. Both were unconditionally open, everywhere,
--   always.
--
--   It adds one enum, three tables and the enforcement that makes them mean
--   something:
--
--     service_mode                 hybrid / reservation_only / queue_only /
--                                  unavailable
--     location_service_settings    per-ESTABLISHMENT default mode + queue_open,
--                                  and the mutex the whole feature serialises on
--     barbers.service_mode_override  one nullable column: NULL = inherit
--     service_mode_overrides       temporary exceptions, location or barber
--     service_mode_changes         append-only "who changed what, and when"
--
--   THIS LOT REQUIRES R1A, R1B AND R2. It composes R2's
--   private.org_has_capability rather than reimplementing any commercial logic,
--   and it changes no price, no plan and no capability packaging.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. THIS FILE CLOSES A REAL ENTITLEMENT BYPASS, AND THAT IS ITS MOST
--      VISIBLE CONSEQUENCE.
--      R2 built private.org_has_capability and wired it into capacity triggers
--      and the plan-assignment RPC — but NOT into booking or queue admission.
--      Searching every migration for a caller finds only R2's own assertion
--      lists. R2's own MASTER header says so, and says the fix "is a product
--      decision with its own migration". This is that migration.
--
--      After applying, a new appointment requires the `booking` capability and
--      a new queue entry requires `walkIns` OR `liveQueue`. The `free` plan has
--      none of the three and can therefore do neither.
--
--      This breaks NO operating organization today: R2's backfill
--      (20260826110200) assigns `free` only to an organization with zero active
--      locations AND zero active professionals, and both admission paths
--      already require a valid active location. Every organization that can
--      currently take a booking is on `solo` or better, and every one of those
--      plans includes `booking`.
--
--   B. EVERY EXISTING ESTABLISHMENT IS BACKFILLED TO `hybrid`, QUEUE OPEN.
--      That is exactly how all of them behave today, so the backfill changes
--      no current behaviour. Every barber gets NULL — inherit — and NOT a copy
--      of the establishment's mode: copying it would turn a live inheritance
--      edge into a snapshot and make the establishment default useless.
--
--      Inactive locations are backfilled too, deliberately, so that
--      reactivating one does not silently change its service mode.
--
--   C. MODE GOVERNS NEW ADMISSIONS ONLY. NOTHING IS EVER CANCELLED.
--      The guards are BEFORE INSERT and fire on INSERT alone. Switching an
--      establishment to reservation_only with three people in the queue leaves
--      three people in the queue, and they are still served. Switching to
--      queue_only leaves tomorrow's eight appointments intact and still
--      confirmable, completable and cancellable. There is no code path in this
--      file that deletes or cancels anything — the generator asserts the
--      absence of DELETE and of any UPDATE that sets a cancelled status.
--
--   D. queue_open IS A SEPARATE FACT AND STAYS ONE.
--      It did not exist before this lot (verified: no runtime queue state in
--      any of the 89 preceding migrations; the marketplace's `is_open_now` is
--      computed from location_hours, which is opening hours). Every combination
--      is legitimate and representable, including reservation_only with the
--      queue open — where the mode still refuses new joins. Changing the mode
--      never mutates queue_open, and vice versa.
--
--   E. ENFORCEMENT IS A TRIGGER, SO IT BINDS service_role AND postgres TOO.
--      There are four ways to create an appointment and three to create a queue
--      entry, including a direct PostgREST insert by staff and BYPASSRLS roles.
--      An RLS `with check` would have held for the browser and evaporated for
--      exactly the privileged paths. There is NO bypass GUC, NO session
--      variable and NO role exemption; a restore that must exceed current mode
--      is `pg_restore --disable-triggers`, which is explicit and auditable.
--
--   F. THE RACE IS CLOSED WITH A SHARED/EXCLUSIVE PAIR ON A REAL ROW.
--      Mode changes take FOR UPDATE on the establishment's
--      location_service_settings row; admissions take FOR SHARE on the same
--      row. Admissions run concurrently with each other; a mode change waits
--      for those in flight and then blocks new ones. Under READ COMMITTED a
--      blocked row lock re-reads the row when granted, so an admission that
--      queues behind a mode change sees the NEW mode — there is no window in
--      which a stale admission commits after the change won.
--
--   G. EXPIRY NEEDS NO CRON, NO WORKER AND NO OPEN BROWSER.
--      A temporary override stops applying the instant expires_at <= now(),
--      decided by the resolver reading the row. Rows are never deleted on
--      expiry, so the history survives. There is no scheduled job to install
--      and none to forget to install.
--
--   H. MODE IS OPERATIONAL STATE, SO IT LIVES ON THE PLACEMENT.
--      The persistent override is a column on public.barbers, NOT on the
--      durable public.professionals identity R1B built. A professional will
--      work in more than one establishment and their mode can differ at each;
--      a column on the identity could hold only one answer, and would make
--      durable identity mutable operational state.
--
--   I. PER ESTABLISHMENT, NEVER PER ORGANIZATION.
--      location_service_settings is keyed on location_id. A multi-salon group
--      changes one salon at a time, and one salon going queue_only says nothing
--      about the others.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No recurring weekly schedules (no rule editor, no scheduler, no schedule
--   engine) — the model leaves room for them and this lot does not build them.
--   No mobile application, no Expo, no React Native. No Stripe, no billing, no
--   checkout. No new pricing and no change to R2's plan matrix. No SMS. No
--   automatic mode inferred from queue length or staff count.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Cancels nothing: no appointment and no queue entry changes status.
--   * Writes data in exactly one place — the location_service_settings
--     backfill, which is INSERT ... ON CONFLICT DO NOTHING and idempotent.
--   * Fabricates no temporary override and no history row.
--   * Adds no anon RLS policy. The database's count stays at zero.
--   * Touches no R1A, R1B or R2 object, and re-asserts R1B's protection of
--     barbers.professional_id.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--
--   R1A's, R1B's and R2's verifications must still pass unchanged:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
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
--   supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in all four.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (Service Mode) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (Service Mode) is OUT OF SYNC. Run scripts/generate-master-service-mode.sh" >&2
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

# THE CENTRAL PRODUCT INVARIANT OF THIS LOT, ASSERTED IN THE ARTEFACT.
#
# Changing a service mode must never cancel a customer. The failure would not
# look like a bug — it would look like a helpful tidy-up ("switching to
# reservation_only? let's clear the queue") and it would destroy commitments a
# shop had made. So the generated file must contain no DELETE at all, and no
# UPDATE against the two tables that hold commitments.
if grep -iqE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY"; then
  echo '!! MASTER contains a DELETE — a mode change must never remove a commitment' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if grep -iqE "update[[:space:]]+public\.(appointments|queue_entries)\b" "$CODE_ONLY"; then
  echo '!! MASTER updates appointments or queue_entries — mode governs NEW admissions only' >&2
  grep -inE "update[[:space:]]+public\.(appointments|queue_entries)\b" "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if grep -iqE "'(cancelled|canceled|no_show)'" "$CODE_ONLY"; then
  echo '!! MASTER names a cancelling status — this lot must never cancel anything' >&2
  grep -inE "'(cancelled|canceled|no_show)'" "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# NO BYPASS. §34 forbids a generic escape hatch, and the shape it would take is
# a GUC read with current_setting() — exactly how the existing reschedule path
# marks itself. A service-mode guard that honoured one would be decorative.
if grep -iqE 'current_setting[[:space:]]*\(|set_config[[:space:]]*\(' "$CODE_ONLY"; then
  echo '!! MASTER reads or writes a GUC — service-mode enforcement must have no bypass flag' >&2
  grep -inE 'current_setting[[:space:]]*\(|set_config[[:space:]]*\(' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

if grep -iqE 'skip_service_mode|bypass_service_mode|force_admission' "$CODE_ONLY"; then
  echo '!! MASTER names a service-mode bypass' >&2
  fail=1
fi

# THE GUARDS MUST BE PRESENT. Everything else in this lot is worthless if the
# two triggers are not created — a service mode nothing enforces is a UI
# preference. A silent `cat` failure or a dropped migration produces exactly
# this, and nothing else in the pipeline would notice.
for guard in \
  "create trigger appointments_enforce_service_mode" \
  "create trigger queue_entries_enforce_service_mode"; do
  if ! grep -iqF "$guard" "$CODE_ONLY"; then
    echo "!! MASTER is missing an enforcement trigger: $guard" >&2
    fail=1
  fi
done

if ! grep -iqE 'before[[:space:]]+insert[[:space:]]+on[[:space:]]+public\.appointments' "$CODE_ONLY" \
   || ! grep -iqE 'before[[:space:]]+insert[[:space:]]+on[[:space:]]+public\.queue_entries' "$CODE_ONLY"; then
  echo '!! MASTER does not attach a BEFORE INSERT guard to both admission tables' >&2
  fail=1
fi

# The guards must fire on INSERT ONLY. A trigger widened to UPDATE would break
# every existing appointment's lifecycle the moment an establishment went
# queue_only — completion, cancellation and check-in would all start failing.
if grep -iqE 'before[[:space:]]+insert[[:space:]]+or[[:space:]]+update[[:space:]]+on[[:space:]]+public\.(appointments|queue_entries)' "$CODE_ONLY"; then
  echo '!! MASTER attaches a service-mode guard to UPDATE — mode governs NEW admissions only' >&2
  fail=1
fi

# THE ENTITLEMENT COMPOSITION, which is the other half of §16. R2's helper must
# be consulted by name; reimplementing the commercial question here — or
# dropping it — is the failure this asserts against.
if ! grep -qF 'org_has_capability' "$CODE_ONLY" && ! grep -qF 'assert_org_capability' "$CODE_ONLY"; then
  echo '!! MASTER never consults the R2 capability helper — the entitlement bypass would remain open' >&2
  fail=1
fi

# NO PLAN NAMES. Composing R2 means asking org_has_capability, never branching
# on a plan key. A literal plan name here would be commercial logic duplicated
# outside the lot that owns it, and would drift the first time pricing moves.
if grep -iqE "'(free|solo|salon_essential|salon_pro|salon_business|multi_growth|multi_pro|multi_scale)'" "$CODE_ONLY"; then
  echo '!! MASTER branches on a plan key — compose R2 capabilities instead' >&2
  grep -inE "'(free|solo|salon_essential|salon_pro|salon_business|multi_growth|multi_pro|multi_scale)'" "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# NO PRICING. This lot changes none, and the way that erodes is a "helpful"
# price or capability row added alongside a capability check.
if grep -iqE 'price_minor|commercial_plans|plan_capabilities|\bstripe\b' "$CODE_ONLY"; then
  echo '!! MASTER touches the pricing catalogue — this lot changes no pricing' >&2
  grep -inE 'price_minor|commercial_plans|plan_capabilities|\bstripe\b' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# NO RECURRING SCHEDULES. §12 defers them explicitly, and the model is designed
# to make them possible later — which is precisely why someone might add "just
# the table" now.
if grep -iqE 'recurring|weekly_schedule|schedule_rule|pg_cron|day_of_week' "$CODE_ONLY"; then
  echo '!! MASTER contains recurring-schedule machinery — deferred by §12' >&2
  grep -inE 'recurring|weekly_schedule|schedule_rule|pg_cron|day_of_week' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# NO ORGANIZATION-WIDE SERVICE MODE. A multi-salon group must never be forced
# to operate every salon identically; the single easiest way to break that is a
# column on organizations.
if grep -iqE 'alter[[:space:]]+table[[:space:]]+public\.organizations' "$CODE_ONLY"; then
  echo '!! MASTER alters public.organizations — service mode is per ESTABLISHMENT' >&2
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

# Every new table must be RLS-enabled AND forced. ENABLE alone leaves the table
# OWNER — postgres, which is what every definer function runs as — bypassing
# every policy.
for t in "${ALLOWED_TABLES[@]}"; do
  if ! grep -iqE "alter[[:space:]]+table[[:space:]]+${t//./\\.}[[:space:]]+enable[[:space:]]+row[[:space:]]+level[[:space:]]+security" "$CODE_ONLY"; then
    echo "!! MASTER does not ENABLE RLS on $t" >&2
    fail=1
  fi
  if ! grep -iqE "alter[[:space:]]+table[[:space:]]+${t//./\\.}[[:space:]]+force[[:space:]]+row[[:space:]]+level[[:space:]]+security" "$CODE_ONLY"; then
    echo "!! MASTER does not FORCE RLS on $t" >&2
    fail=1
  fi
done

# No anon policy. The database has had zero since it shipped; R1B and R2 both
# assert it. The customer read is a curated SECURITY DEFINER projection, so
# there is no reason for one to appear here, and `to anon` on a policy is the
# one-line mistake that would expose raw override rows and turn
# location_service_settings into an existence oracle for every location id.
if grep -iE -A3 'create[[:space:]]+policy' "$CODE_ONLY" | grep -iqE '^\s*to\s+.*\banon\b'; then
  echo '!! MASTER creates a policy granted to anon — this lot must add none' >&2
  fail=1
fi

# Exactly ONE function may be granted to anon: the customer contract.
while read -r granted; do
  [[ -z "$granted" ]] && continue
  if [[ "$granted" != *"get_public_service_state"* ]]; then
    echo "!! MASTER grants an unexpected function to anon: $granted" >&2
    fail=1
  fi
done < <(grep -iE '^[[:space:]]*grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function' "$CODE_ONLY" \
         | grep -iE '\banon\b' || true)

if ! grep -iqE 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+public\.get_public_service_state.*anon' "$CODE_ONLY"; then
  echo '!! MASTER does not grant the customer contract to anon — the CTA would silently vanish' >&2
  fail=1
fi

# R1A/R1B/R2 objects must not be redefined here. This lot is additive on top of
# all three, and a MASTER that quietly reissued one of their guards would make
# the lots impossible to roll back independently.
if grep -iqE 'create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+(public|private)\.(enforce_appointment_transition|enforce_queue_transition|guard_customers_identity|offboard_barber|book_public_appointment|join_public_queue|reschedule_appointment|assign_barber_professional|guard_professional_identity|ensure_customer_passport|submit_professional_claim|review_professional_claim|org_has_capability|assert_org_capability|effective_plan_key|assign_commercial_plan|enforce_establishment_capacity|enforce_barber_capacity)\b' "$CODE_ONLY"; then
  echo '!! MASTER redefines an R1A/R1B/R2 function — this lot must be additive on top of all three' >&2
  grep -inE 'create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+(public|private)\.(book_public_appointment|join_public_queue|org_has_capability|assert_org_capability)\b' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# The four canonical modes, all present, spelled exactly. A MASTER that shipped
# three of them — or a translated label as an enum value — is the failure this
# makes impossible to miss.
for mode in hybrid reservation_only queue_only unavailable; do
  if ! grep -qF "'$mode'" "$CODE_ONLY"; then
    echo "!! MASTER is missing the service mode $mode" >&2
    fail=1
  fi
done

if ! grep -iqE "create[[:space:]]+type[[:space:]]+public\.service_mode[[:space:]]+as[[:space:]]+enum" "$CODE_ONLY"; then
  echo '!! MASTER does not create the public.service_mode enum' >&2
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

echo "safety checks passed: no DROP TABLE / TRUNCATE / DROP COLUMN / DROP ... CASCADE / RLS disable; no DELETE and no write to appointments or queue_entries of any kind; no cancelling status; no GUC and no bypass flag; both BEFORE INSERT guards present and INSERT-only; R2 capability composed without naming a plan; no pricing, no recurring schedules, no organization-wide mode; exactly ${#ALLOWED_TABLES[@]} expected tables, all RLS enabled+forced; no anon policy and exactly one anon-callable function; all four canonical modes; no R1A/R1B/R2 redefinition; all ${#MIGRATIONS[@]} migrations present; transaction closed"
