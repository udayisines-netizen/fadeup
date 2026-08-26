#!/usr/bin/env bash
# FadeUp — R2: TRUE parallel capacity races.
#
# WHY THIS EXISTS SEPARATELY FROM VERIFY
#
#   VERIFY_R2 runs in ONE session. When it creates the third location on a
#   two-establishment plan and gets refused, the refusal is correct but it is
#   SERIALIZED contention — the trigger counted a row its own session had
#   already committed. That proves the cap is checked. It proves nothing about
#   the interesting failure: two managers pressing "add location" in the same
#   second, on different connections, each counting 2 before either row is
#   visible to the other, and both passing.
#
#   Counting is not enough; the count has to be serialised. R2 serialises it by
#   taking SELECT ... FOR UPDATE on the organization's single commercial-state
#   row before counting. This script is what proves that lock does its job:
#   it fires N genuinely simultaneous connections at one cap and counts what
#   survived.
#
#   It never touches the live database: it builds its own throwaway container
#   from the same image, replays db/migrations, and removes itself on exit.
#
# Usage:
#   scripts/r2-concurrency-test.sh            # 8 racers per scenario
#   RACERS=24 scripts/r2-concurrency-test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RACERS="${RACERS:-8}"
FAILURES=0
CONTAINER=""

cleanup() { [[ -n "$CONTAINER" ]] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Reuses the main harness rather than re-deriving its bootstrap. That harness
# already knows the exact supabase-compatible prerequisites and storage
# scaffolding db/migrations needs; a second copy of that logic drifts.
echo "==> building a throwaway database via scripts/disposable-db-test.sh --keep"
HARNESS_LOG="$(mktemp)"
"$REPO_ROOT/scripts/disposable-db-test.sh" --keep > "$HARNESS_LOG" 2>&1 || {
  echo "!! harness failed to build the database" >&2; tail -20 "$HARNESS_LOG" >&2; exit 1
}
CONTAINER="$(grep -oP 'container kept: \K\S+' "$HARNESS_LOG" | tail -1)"
rm -f "$HARNESS_LOG"
[[ -z "$CONTAINER" ]] && { echo "!! could not determine the container name" >&2; exit 1; }
echo "==> racing against $CONTAINER"

psql_run() {
  docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql_quiet() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -At "$@"
}

ORG='0c000000-0000-4000-8000-000000000001'
ADMIN='0c000000-0000-4000-8000-0000000000f2'

echo "==> seeding one organization and one platform admin"
psql_run -q <<'SQL' >/dev/null
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '0c000000-0000-4000-8000-0000000000f1',
   'authenticated', 'authenticated', 'race-owner@fadeup.test', 'x', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '0c000000-0000-4000-8000-0000000000f2',
   'authenticated', 'authenticated', 'race-admin@fadeup.test', 'x', '{}', '{}', now(), now());

insert into public.platform_members (user_id, role, note)
values ('0c000000-0000-4000-8000-0000000000f2', 'platform_admin', 'R2 concurrency test');

do $$
begin
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (id, name, slug)
  values ('0c000000-0000-4000-8000-000000000001', 'Race Shop', 'r2-race-shop');
end $$;

insert into public.memberships (organization_id, user_id, role)
values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000f1', 'owner');
SQL

reset_org() {
  local plan="$1"
  psql_run -q >/dev/null <<SQL
-- Deactivate rather than delete: the cap counts ACTIVE rows, and R2's whole
-- posture is that nothing is removed to make a plan fit.
update public.locations set is_active = false where organization_id = '$ORG';
update public.staff_profiles set is_active = false where organization_id = '$ORG';
update public.organization_commercial_state
set plan_key = '$plan', status = 'active', entitlement_source = 'platform_grant'
where organization_id = '$ORG';
SQL
}

# Brings the organization to `n` active locations WITHOUT racing, so the race
# below starts exactly one row below the cap.
fill_locations() {
  local n="$1"
  [[ "$n" -eq 0 ]] && return 0
  psql_run -q >/dev/null <<SQL
insert into public.locations (organization_id, name, timezone, is_active)
select '$ORG', 'Prefill ' || g, 'UTC', true from generate_series(1, $n) g;
SQL
}

# Fires $RACERS simultaneous attempts to create ONE MORE active location.
race_locations() {
  local label="$1" cap="$2"
  local pids=() i p actual
  for i in $(seq 1 "$RACERS"); do
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -c \
      "insert into public.locations (organization_id, name, timezone, is_active)
       values ('$ORG', 'Racer $i', 'UTC', true);" >/dev/null 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || true; done

  actual="$(psql_quiet -c "select count(*) from public.locations where organization_id = '$ORG' and is_active;")"
  if [[ "$actual" == "$cap" ]]; then
    echo "    PASS  $label — $RACERS simultaneous attempts, $actual active (cap $cap)"
  else
    echo "    FAIL  $label — $RACERS simultaneous attempts left $actual active, cap is $cap" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

echo
echo "==> SCENARIO 1: multi_growth (cap 2), already at 2, $RACERS racers for a 3rd"
reset_org multi_growth
fill_locations 2
race_locations "multi_growth refuses every concurrent 3rd establishment" 2

echo
echo "==> SCENARIO 2: multi_pro (cap 5), already at 5, $RACERS racers for a 6th"
reset_org multi_pro
fill_locations 5
race_locations "multi_pro refuses every concurrent 6th establishment" 5

echo
echo "==> SCENARIO 3: multi_scale (cap 10), already at 10, $RACERS racers for an 11th"
reset_org multi_scale
fill_locations 10
race_locations "multi_scale refuses every concurrent 11th establishment" 10

echo
echo "==> SCENARIO 4: salon_pro (cap 1), empty, $RACERS racers for the FIRST location"
# The sharpest establishment race: nobody has won yet, so every racer counts 0
# and every racer believes it may proceed. Exactly one must survive.
reset_org salon_pro
race_locations "salon_pro admits exactly ONE of $RACERS simultaneous first establishments" 1

echo
echo "==> SCENARIO 5: solo (cap 1 professional), empty roster, $RACERS racers"
reset_org solo
psql_run -q >/dev/null <<SQL
insert into public.locations (organization_id, name, timezone, is_active)
values ('$ORG', 'Solo Chair', 'UTC', true);

-- One staff profile per racer, all active, none rostered yet. Every racer then
-- tries to turn its OWN profile into an operational professional at the same
-- instant, so no two racers contend on the same row — only on the CAP.
insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_active, is_public)
select '$ORG', null,
       (select id from public.locations where organization_id = '$ORG' and is_active limit 1),
       'Racer Pro ' || g, true, true
from generate_series(1, $RACERS) g;
SQL

pids=()
while read -r sp; do
  [[ -z "$sp" ]] && continue
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -c \
    "insert into public.barbers (organization_id, staff_profile_id, is_bookable)
     values ('$ORG', '$sp', true);" >/dev/null 2>&1 &
  pids+=($!)
done < <(psql_quiet -c "select id from public.staff_profiles where organization_id = '$ORG' and is_active and display_name like 'Racer Pro %';")
for p in "${pids[@]}"; do wait "$p" || true; done

actual="$(psql_quiet -c "select count(*) from public.barbers b join public.staff_profiles sp on sp.id = b.staff_profile_id where b.organization_id = '$ORG' and sp.is_active;")"
if [[ "$actual" == "1" ]]; then
  echo "    PASS  solo admits exactly ONE of $RACERS simultaneous professionals — $actual active"
else
  echo "    FAIL  solo ended with $actual active operational professionals; the cap is 1" >&2
  FAILURES=$((FAILURES + 1))
fi

# Losing the race must not destroy anything. A refused roster insert leaves the
# durable professional model exactly as it was.
identities="$(psql_quiet -c "select count(*) from public.professionals;")"
echo "    INFO  professional identities in the database after the race: $identities"

echo
echo "==> SCENARIO 6: a DOWNGRADE racing $RACERS location creations"
# The dangerous interleaving: the plan shrinks to 2 while other connections are
# still creating establishments against the old capacity. Whichever order the
# lock grants, the end state must satisfy the plan it ended on — never a
# 10-establishment organization sitting on a 2-establishment plan.
reset_org multi_scale
fill_locations 2

pids=()
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -c \
  "set request.jwt.claims = '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}';
   set request.jwt.claim.sub = '$ADMIN';
   select public.assign_commercial_plan('$ORG', 'multi_growth');" >/dev/null 2>&1 &
pids+=($!)
for i in $(seq 1 "$RACERS"); do
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -c \
    "insert into public.locations (organization_id, name, timezone, is_active)
     values ('$ORG', 'Downgrade Racer $i', 'UTC', true);" >/dev/null 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done

final_plan="$(psql_quiet -c "select plan_key from public.organization_commercial_state where organization_id = '$ORG';")"
final_active="$(psql_quiet -c "select count(*) from public.locations where organization_id = '$ORG' and is_active;")"
cap="$(psql_quiet -c "select max_establishments from public.commercial_plans where plan_key = '$final_plan';")"

if [[ "$final_active" -le "$cap" ]]; then
  echo "    PASS  ended on $final_plan with $final_active active establishments (cap $cap) — consistent"
else
  echo "    FAIL  ended on $final_plan with $final_active active establishments, cap is $cap" >&2
  FAILURES=$((FAILURES + 1))
fi

echo
echo "==> SCENARIO 7: 8 simultaneous plan assignments"
# Several admins changing the plan at the same instant must leave ONE coherent
# answer and an audit row per applied change — never a half-applied state where
# the state row says one thing and the trail says another.
reset_org salon_essential
before="$(psql_quiet -c "select count(*) from public.commercial_plan_changes where organization_id = '$ORG';")"

pids=()
for plan in salon_pro salon_business salon_pro salon_business salon_pro salon_business salon_pro salon_business; do
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -c \
    "set request.jwt.claims = '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}';
     set request.jwt.claim.sub = '$ADMIN';
     select public.assign_commercial_plan('$ORG', '$plan');" >/dev/null 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done

rows="$(psql_quiet -c "select count(*) from public.organization_commercial_state where organization_id = '$ORG';")"
plan_now="$(psql_quiet -c "select plan_key from public.organization_commercial_state where organization_id = '$ORG';")"
after="$(psql_quiet -c "select count(*) from public.commercial_plan_changes where organization_id = '$ORG';")"
applied=$((after - before))

if [[ "$rows" == "1" && -n "$plan_now" && "$applied" -ge 1 ]]; then
  echo "    PASS  exactly 1 commercial-state row, final plan $plan_now, $applied audit row(s) appended"
else
  echo "    FAIL  $rows commercial-state row(s), final plan '$plan_now', $applied audit row(s)" >&2
  FAILURES=$((FAILURES + 1))
fi

# Nothing may be destroyed by any of the above.
locs_total="$(psql_quiet -c "select count(*) from public.locations where organization_id = '$ORG';")"
echo "    INFO  locations still present (active or not) after every race: $locs_total"

echo
if [[ "$FAILURES" -gt 0 ]]; then
  echo "!! $FAILURES concurrency scenario(s) FAILED" >&2
  exit 1
fi
echo "==> all concurrency scenarios passed with $RACERS racers"
