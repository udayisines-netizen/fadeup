#!/usr/bin/env bash
# FadeUp — generates supabase/MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
#
# A sibling of the LOT C/D/E generators, deliberately NOT a modification of
# them: those lots are already deployed and their MASTER files must keep
# generating byte-for-byte what the operator applied. Same contract, same
# safety assertions, different migration list.
#
# MASTER is DERIVED from db/migrations, never hand-edited. That is what
# guarantees no fix can exist only in MASTER: this concatenates the exact
# migration files, in filename order, inside a single transaction. If a fix
# is needed, it goes in the migration and MASTER is regenerated.
#
# Usage:
#   scripts/generate-master-r1.sh
#   scripts/generate-master-r1.sh --check    # verify it matches

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/supabase/MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql"

# Only R1's migrations. No base FadeUp schema, no Worker V2 schema.
MIGRATIONS=(
  "20260824100000_professional_identity.sql"
  "20260824100100_professional_identity_backfill.sql"
  "20260824100200_attribution_provenance.sql"
  "20260824100300_social_graph_follows.sql"
  "20260824100400_customer_professional_relationships.sql"
  "20260824100500_customer_public_profiles.sql"
  "20260824100600_professional_client_showcases.sql"
  "20260824100700_fade_passport_identity.sql"
  "20260824100800_fade_passport_backfill.sql"
  "20260824100900_external_professional_claims.sql"
  "20260824101000_public_projections.sql"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

TMP="$(mktemp)"
CODE_ONLY="$(mktemp)"
trap 'rm -f "$TMP" "$CODE_ONLY"' EXIT

{
  cat <<'HEADER'
-- ============================================================================
-- FadeUp — MASTER: R1, social-first and acquisition domain foundation
-- Generated 2026-08-24. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r1.sh
-- Verify in sync:   scripts/generate-master-r1.sh --check
--
-- WHAT THIS IS
--
--   The first lot of the Social-First V2 rebuild allowed to change the domain
--   model. It establishes six new tables and extends four existing ones. It
--   drops nothing, rewrites nothing, and deletes no row.
--
--   1. PROFESSIONAL IDENTITY BECOMES DURABLE.
--
--      Until now a professional's public identity WAS `barbers.id` — a row
--      scoped to one organization and cascade-deleted with it. A barber
--      changing shop got a new identity, so followers, verified clients and
--      social proof would have been orphaned; and an externally discovered
--      professional could not have an identity at all.
--
--      `professionals` is org-independent and outlives membership. `barbers`
--      keeps its own id, so every public route (/s/:slug/barbers/:id) and
--      every existing foreign key is untouched — it merely gains a pointer.
--
--   2. ONE TABLE SERVES CLAIMED AND EXTERNAL IDENTITIES.
--
--      user_id null = an unclaimed profile Worker discovered. This is what
--      makes external profiles safe: all operational data (availability,
--      services, hours, appointments, queue) hangs off barbers/organizations,
--      never off professionals. An unclaimed professional has no barbers row,
--      so it is STRUCTURALLY IMPOSSIBLE for it to imply a bookable slot, a
--      live queue or a wait time. The guarantee is the absence of the
--      modelling, not a filter applied later.
--
--   3. FOLLOW AND VERIFIED CLIENT ARE SEPARATE, WITH SEPARATE EVIDENCE.
--
--      A follow is created by intent. A verified client is created by
--      COMPLETED service. Neither is ever derived from the other. A confirmed
--      booking may auto-follow; it is never evidence that a haircut happened.
--
--   4. AN EXPLICIT UNFOLLOW IS PERMANENT.
--
--      professional_follows.has_explicit_unfollow is sticky intent. A later
--      booking cannot silently re-follow someone the customer removed.
--
--   5. PUBLISHING A CLIENT REQUIRES THAT CLIENT'S CONSENT.
--
--      "Already cutting X" needs four independent facts: a genuine completed
--      relationship, the customer's approval, the customer's profile being
--      public, and — for the tick — live verification. The professional may
--      only ever ASK.
--
--   6. EVERY REGISTERED CUSTOMER NOW HAS A FADE PASSPORT.
--
--      customer_passports already existed and already enforced one per
--      account; it was simply never issued automatically and had no stable
--      identifier. Both are fixed here. No new table was created for it.
--
-- THE DECISION AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. WHY appointments AND queue_entries GAIN booked_by_user_id.
--
--      Attributing social facts through appointments.customer_id ->
--      customers.user_id is EXPLOITABLE, and the exploit is a descendant of
--      the one 20260813160000_claim_scope_fix.sql already removed.
--      link_customer_from_contact_info() attaches a booking to the CRM row it
--      matches from the CALLER-TYPED phone, then email. So an unauthenticated
--      caller who types a victim's phone number would have caused a follow
--      edge in the victim's name, and — once the shop marked it completed —
--      verified-client status with a barber the victim never met.
--
--      booked_by_user_id is stamped ONLY from auth.uid(), inside
--      book_public_appointment and join_public_queue. Anonymous bookings and
--      staff-created rows carry NULL and attribute to nobody.
--
--      CONSEQUENCE, STATED PLAINLY: a staff-created appointment and an
--      anonymous walk-in do NOT establish verified-client status, even when
--      genuinely completed, because FadeUp cannot prove which account
--      received that service. This is deliberate. It is also what stops a
--      shop inflating its own verified-client count by typing strangers'
--      phone numbers.
--
--   B. WHAT THIS DOES NOT DO. There is no plan, price, subscription or
--      entitlement column anywhere. claim_state answers "who controls this
--      identity", never "what have they paid for". A claimed profile is Free.
--
-- BEHAVIOUR CHANGES TO EXPECT
--   1. Creating a customer_profiles row now also issues a Fade Passport.
--   2. A signed-in customer's confirmed booking auto-follows that
--      professional, unless they have previously unfollowed them.
--   3. Completing an appointment or queue visit records a relationship.
--   4. book_public_appointment and join_public_queue keep identical
--      signatures and return shapes; they stamp one extra column.
--   5. No UI changes. R1 ships no frontend.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back.
--   * Adds no NOT NULL column to an existing table, so no table is rewritten.
--   * Drops no table, no column, no policy and no function.
--   * Deletes no row. The only UPDATEs are the two idempotent backfills.
--   * Every new table is created with RLS enabled AND forced.
--   * The barbers foreign key is added NOT VALID and validated separately, so
--     it never scans barbers under SHARE ROW EXCLUSIVE.
--   * All three new triggers on appointments/queue_entries are AFTER triggers
--     that contain their own errors: an ordinary failure inside them is logged
--     as a warning and discarded rather than rolling back the booking or the
--     queue completion. The one class they do not contain is a cancellation
--     (statement_timeout / pg_cancel_backend), which PL/pgSQL's OTHERS
--     deliberately excludes and which must abort the statement. Each trigger
--     does two index probes and one upsert.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
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
--   supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
-- and confirm 0 FAIL rows. The PASS count depends on the database it ran
-- against: a fresh database skips the backfill section, a database that
-- actually had pre-R1 rows exercises it. What must always hold is FAIL = 0.
-- ============================================================================
FOOTER
} > "$TMP"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "MASTER (R1) is in sync with db/migrations."
    exit 0
  fi
  echo "MASTER (R1) is OUT OF SYNC. Run scripts/generate-master-r1.sh" >&2
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
check_forbidden 'alter[[:space:]]+table.*drop[[:space:]]+column' 'DROP COLUMN'
check_forbidden 'drop[[:space:]]+function.*cascade' 'DROP FUNCTION ... CASCADE'
check_forbidden 'drop[[:space:]]+type.*cascade' 'DROP TYPE ... CASCADE'
check_forbidden 'disable[[:space:]]+row[[:space:]]+level[[:space:]]+security' 'RLS disable'
check_forbidden '^[[:space:]]*drop[[:space:]]+schema' 'DROP SCHEMA'

if grep -iE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivqE 'where'; then
  echo '!! MASTER contains a DELETE with no WHERE clause on the same line' >&2
  grep -inE '^[[:space:]]*delete[[:space:]]+from' "$CODE_ONLY" | grep -ivE 'where' | head -5 >&2
  fail=1
fi

# R1 legitimately REFERENCES public.prospects — professionals.prospect_id is
# the Worker provenance link, and create_external_professional reads it. What
# it must never do is MODIFY the Worker estate: the acquisition pipeline
# (sources, observations, matches, duplicates, outreach, ML) is out of scope
# for this lot and belongs to R4/R10/R17.
if grep -iqE '^[[:space:]]*(create|alter|drop)[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?(public\.)?(prospect|outreach_|whatsapp_|ml_)' "$CODE_ONLY"; then
  echo '!! MASTER creates or alters a Worker V2 table — R1 must only reference them' >&2
  grep -inE '^[[:space:]]*(create|alter|drop)[[:space:]]+table.*(prospect|outreach_|whatsapp_|ml_)' "$CODE_ONLY" | head -5 >&2
  fail=1
fi

# R1 must not introduce pricing/entitlements — that is R2's lot.
if grep -iqE '(stripe|subscription|entitlement)' "$CODE_ONLY"; then
  echo '!! MASTER references pricing/subscription concepts — those belong to R2' >&2
  fail=1
fi

# R1 must not introduce SMS anywhere.
if grep -iqE '(twilio|[^a-z_]sms[^a-z_])' "$CODE_ONLY"; then
  echo '!! MASTER references SMS — FadeUp does not do SMS' >&2
  fail=1
fi

# Every new table must ship with RLS enabled AND forced.
for t in professionals professional_follows customer_professional_relationships \
         customer_public_profiles professional_client_showcases professional_profile_claims; do
  if ! grep -qE "alter table public\.$t enable row level security" "$CODE_ONLY"; then
    echo "!! MASTER does not enable RLS on $t" >&2
    fail=1
  fi
  if ! grep -qE "alter table public\.$t force row level security" "$CODE_ONLY"; then
    echo "!! MASTER does not FORCE RLS on $t" >&2
    fail=1
  fi
done

if ! grep -qE '^commit;' "$CODE_ONLY"; then
  echo '!! MASTER has no COMMIT' >&2
  fail=1
fi

if [[ "$fail" -eq 1 ]]; then
  echo '!! refusing to leave an unsafe MASTER in place' >&2
  exit 1
fi

echo "safety assertions passed"
