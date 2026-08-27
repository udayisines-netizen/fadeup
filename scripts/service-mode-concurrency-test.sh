#!/usr/bin/env bash
# FadeUp — SERVICE MODE: TRUE parallel admission/mode races.
#
# WHY THIS EXISTS SEPARATELY FROM VERIFY
#
#   VERIFY_SERVICE_MODE runs in ONE session. When it switches an establishment
#   to reservation_only and the next queue insert is refused, the refusal is
#   correct but it is SERIALIZED contention — the guard read a row its own
#   session had already committed. That proves the guard is wired up. It proves
#   nothing about the interesting failure:
#
#     Transaction A reads the mode and sees `hybrid`.
#     Transaction B changes the mode to `reservation_only` and COMMITS.
#     Transaction A then commits a walk-in that the shop has already stopped
#     accepting.
#
#   Nothing in a single session can produce that interleaving, and nothing in
#   React can prevent it. It is prevented by a lock: every admission takes
#   FOR SHARE on the establishment's location_service_settings row before it
#   reads the mode, and every mode change takes FOR UPDATE on the same row. The
#   share lock is held until commit, so the mode change cannot slip in between
#   A's read and A's commit. This script is what proves that discipline holds
#   when N genuinely simultaneous connections attack it.
#
# WHAT "COHERENT" MEANS HERE, AND WHY THE ASSERTIONS ARE SHAPED AS THEY ARE
#
#   For the mode-vs-admission races there is no cap, so "exactly one survived"
#   is not the invariant — ANY split of the racers is legitimate, because both
#   serial orders (all admissions then the change, or the change then all
#   refusals) are valid outcomes. Asserting a particular split would be
#   asserting a scheduling accident.
#
#   What must be true is narrower and checkable:
#
#     a) NO racer dies of a deadlock or a serialization failure. Mixing shared
#        and exclusive locks is exactly how deadlocks get introduced, and this
#        design claims there are none because no transaction ever upgrades a
#        share lock to an exclusive one. 40P01 or 40001 anywhere is a FAIL.
#     b) NO racer dies of an unexpected error. The only legitimate outcomes are
#        ALLOWED and 42501 (refused by mode/entitlement/queue_open).
#     c) The mode change ACTUALLY LANDED — it is not acceptable for contention
#        to have silently lost it.
#     d) AFTER the dust settles, a FRESH admission agrees with the final state.
#        This is the decisive one: it proves nothing leaked past the change,
#        and that the post-race world is the one the mode says it is.
#
#   For the OVERRIDE races the invariant IS countable, and it is the sharpest
#   assertion in this file: N simultaneous writers aiming at the same target
#   must leave EXACTLY ONE active override. Two would make the effective mode
#   genuinely ambiguous, and no precedence rule could rescue it — they sit at
#   the same precedence level.
#
#   It never touches the live database: it builds its own throwaway container
#   from the same image, replays db/migrations, and removes itself on exit.
#
# Usage:
#   scripts/service-mode-concurrency-test.sh            # 8 racers per scenario
#   RACERS=24 scripts/service-mode-concurrency-test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RACERS="${RACERS:-8}"
FAILURES=0
CONTAINER=""
RESULTS=""

cleanup() {
  [[ -n "$RESULTS" ]] && rm -rf "$RESULTS"
  [[ -n "$CONTAINER" ]] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  return 0
}
trap cleanup EXIT

RESULTS="$(mktemp -d)"

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
echo "==> racing against $CONTAINER with RACERS=$RACERS"

psql_run() {
  docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql_quiet() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -At "$@"
}

ORG='0d000000-0000-4000-8000-000000000001'
LOC='0d000000-0000-4000-8000-000000000002'
BARBER='0d000000-0000-4000-8000-000000000003'
SERVICE='0d000000-0000-4000-8000-000000000004'
OWNER='0d000000-0000-4000-8000-00000000000f'

# ---------------------------------------------------------------------------
# Fixtures, plus the scaffolding functions the racers call.
#
# The helpers exist in the DATABASE rather than in bash because each racer is a
# separate connection: a pg_temp function would not be visible to any of them.
# They report ALLOWED or the SQLSTATE, so a racer never fails the shell and the
# outcome of every single attempt is countable afterwards.
#
# The plan is raised to multi_scale BEFORE the location is created: a new
# organization starts on `free`, which covers one establishment and, more to the
# point, packages neither `booking` nor `walkIns` — every racer would be refused
# on entitlement and the mode race would never be exercised at all.
# ---------------------------------------------------------------------------
echo "==> seeding fixtures"
psql_run -q <<SQL
set client_min_messages = warning;

insert into auth.users (id, email) values ('$OWNER', 'race.owner@concurrency.invalid')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('$ORG', 'Race Shop', 'race-shop') on conflict (id) do nothing;

select private.ensure_organization_commercial_state('$ORG');
update public.organization_commercial_state
   set plan_key = 'multi_scale', status = 'active'
 where organization_id = '$ORG';

insert into public.locations (id, organization_id, name, timezone, is_active)
values ('$LOC', '$ORG', 'Race Main', 'UTC', true) on conflict (id) do nothing;

insert into public.memberships (organization_id, user_id, role)
values ('$ORG', '$OWNER', 'owner')
on conflict (organization_id, user_id) do update set role = excluded.role;

insert into public.staff_profiles (id, organization_id, user_id, location_id, display_name, is_public, is_active)
values ('0d000000-0000-4000-8000-000000000005', '$ORG', '$OWNER', '$LOC', 'Race Barber', true, true)
on conflict (organization_id, user_id) do update
  set id = excluded.id, location_id = excluded.location_id;

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('$BARBER', '$ORG', '0d000000-0000-4000-8000-000000000005', true)
on conflict (id) do nothing;

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values ('$SERVICE', '$ORG', 'Race Coupe', 30, 3000, true) on conflict (id) do nothing;

insert into public.service_locations (organization_id, service_id, location_id)
values ('$ORG', '$SERVICE', '$LOC') on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id)
values ('$ORG', '$BARBER', '$SERVICE') on conflict do nothing;

-- Test scaffolding. Created here, in a container that is destroyed on exit;
-- never part of a migration and never present in production.
create or replace function public.test_try_queue(p_barber uuid)
returns text language plpgsql as \$fn\$
begin
  insert into public.queue_entries (organization_id, location_id, barber_id, customer_name)
  values ('$ORG', '$LOC', p_barber, 'racer');
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
\$fn\$;

-- Each booking takes a distinct slot from a sequence. Without that the LOT 8
-- GiST exclusion constraint would refuse the second racer as an OVERLAP (23P01)
-- — a real constraint doing its job, which would be miscounted here as a
-- service-mode refusal and would hide whatever the guard actually did.
create sequence if not exists public.test_slot_seq;

create or replace function public.test_try_book(p_barber uuid)
returns text language plpgsql as \$fn\$
declare v_at timestamptz;
begin
  v_at := now() + interval '60 days' + (nextval('public.test_slot_seq') * interval '3 hours');
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at)
  values ('$ORG', '$LOC', p_barber, '$SERVICE', 'racer', v_at, v_at + interval '30 minutes');
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
\$fn\$;

-- Impersonation for the writers, which go through the AUTHORIZING RPCs rather
-- than through a direct update — so these races exercise the real mutex the
-- real product takes, not a shortcut.
create or replace function public.test_set_override(p_scope text, p_barber uuid, p_mode text)
returns text language plpgsql as \$fn\$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '$OWNER', true);
  perform public.set_service_mode_temporary_override(
    p_scope::public.service_mode_scope, '$LOC', p_mode::public.service_mode,
    now() + interval '1 hour', p_barber);
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
\$fn\$;

create or replace function public.test_set_mode(p_mode text)
returns text language plpgsql as \$fn\$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '$OWNER', true);
  perform public.set_location_service_mode('$LOC', p_mode::public.service_mode);
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
\$fn\$;

create or replace function public.test_set_queue_open(p_open boolean)
returns text language plpgsql as \$fn\$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '$OWNER', true);
  perform public.set_location_queue_open('$LOC', p_open);
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
\$fn\$;

create or replace function public.test_set_barber_mode(p_mode text)
returns text language plpgsql as \$fn\$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '$OWNER', true);
  perform public.set_barber_service_mode_override('$BARBER',
    case when p_mode is null then null else p_mode::public.service_mode end);
  return 'ALLOWED';
exception when others then
  return sqlstate;
end;
\$fn\$;
SQL

# ---------------------------------------------------------------------------
# Reset the establishment to a known open state between scenarios.
# ---------------------------------------------------------------------------
reset_state() {
  psql_run -q <<SQL
set client_min_messages = warning;
update public.location_service_settings
   set default_service_mode = 'hybrid', queue_open = true where location_id = '$LOC';
update public.barbers set service_mode_override = null where id = '$BARBER';
update public.service_mode_overrides set cleared_at = now()
 where location_id = '$LOC' and cleared_at is null;
delete from public.queue_entries where organization_id = '$ORG';
delete from public.appointments where organization_id = '$ORG';
SQL
}

# ---------------------------------------------------------------------------
# The core assertion for a mode-vs-admission race.
#
#   $1 label
#   $2 the SQL each racer runs (returns ALLOWED or a SQLSTATE)
#   $3 the SQL the single mode-changer runs
#   $4 the expected final effective mode (or QUEUE_CLOSED for a queue_open race)
#   $5 the SQL for a FRESH post-race admission attempt, which MUST be refused
# ---------------------------------------------------------------------------
race_mode_vs_admission() {
  local label="$1" racer_sql="$2" changer_sql="$3" expected="$4" fresh_sql="$5"
  local dir="$RESULTS/$RANDOM$RANDOM"
  mkdir -p "$dir"
  local pids=()

  # The mode change is fired FIRST so it is never systematically last, but with
  # no synchronisation at all — every process starts within the same few
  # milliseconds and the kernel decides the rest. That is the point.
  ( psql_quiet -c "select $changer_sql" > "$dir/changer" 2>&1 ) &
  pids+=("$!")
  for i in $(seq 1 "$RACERS"); do
    ( psql_quiet -c "select $racer_sql" > "$dir/racer.$i" 2>&1 ) &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p" || true; done

  local allowed=0 refused=0 other=0 deadlock=0
  local out
  for i in $(seq 1 "$RACERS"); do
    out="$(cat "$dir/racer.$i" 2>/dev/null || echo MISSING)"
    case "$out" in
      ALLOWED) allowed=$((allowed + 1)) ;;
      42501)   refused=$((refused + 1)) ;;
      40P01|40001) deadlock=$((deadlock + 1)); other=$((other + 1)) ;;
      *)       other=$((other + 1)); echo "      unexpected racer outcome: $out" >&2 ;;
    esac
  done

  local changer_out; changer_out="$(cat "$dir/changer" 2>/dev/null || echo MISSING)"
  local final_mode; final_mode="$(psql_quiet -c "select mode from private.effective_service_mode('$LOC', '$BARBER')")"
  local final_open; final_open="$(psql_quiet -c "select queue_open from public.location_service_settings where location_id = '$LOC'")"
  local fresh;      fresh="$(psql_quiet -c "select $fresh_sql")"

  echo "    $label"
  echo "      $RACERS racers -> allowed=$allowed refused=$refused other=$other | changer=$changer_out | final mode=$final_mode queue_open=$final_open | fresh attempt=$fresh"

  local ok=1

  # (a) no deadlock, ever. Mixed share/exclusive locking is exactly how one
  #     gets introduced, and this design claims there is none.
  if [[ "$deadlock" -ne 0 ]]; then
    echo "      FAIL  $deadlock racer(s) deadlocked or hit a serialization failure" >&2; ok=0
  fi
  # (b) only ALLOWED or 42501 are legitimate outcomes.
  if [[ "$other" -ne 0 ]]; then
    echo "      FAIL  $other racer(s) failed for a reason that is neither admission nor refusal" >&2; ok=0
  fi
  # (c) the mode change must actually have landed.
  if [[ "$changer_out" != "ALLOWED" ]]; then
    echo "      FAIL  the mode change itself did not commit: $changer_out" >&2; ok=0
  fi
  if [[ "$expected" == "QUEUE_CLOSED" ]]; then
    if [[ "$final_open" != "f" ]]; then
      echo "      FAIL  queue_open should be false after the race, is '$final_open'" >&2; ok=0
    fi
  elif [[ "$final_mode" != "$expected" ]]; then
    echo "      FAIL  final effective mode should be '$expected', is '$final_mode'" >&2; ok=0
  fi
  # (d) THE DECISIVE ONE. Once the change has committed, nothing may get past
  #     it — if an admission can still succeed now, the guard is not enforcing
  #     the state the database says it is in.
  if [[ "$fresh" != "42501" ]]; then
    echo "      FAIL  a FRESH admission after the race returned '$fresh', expected 42501" >&2; ok=0
  fi

  if [[ "$ok" -eq 1 ]]; then
    echo "      PASS  coherent: every outcome is a legal serialization, and the post-race state is enforced"
  else
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# The countable assertion: N writers, one target, EXACTLY ONE active override.
# ---------------------------------------------------------------------------
race_overrides() {
  local label="$1" scope="$2" barber_arg="$3"
  local dir="$RESULTS/$RANDOM$RANDOM"
  mkdir -p "$dir"
  local pids=()
  local mode

  for i in $(seq 1 "$RACERS"); do
    # Racers ask for DIFFERENT modes, so "exactly one survived" also tells us
    # which writer won rather than merely that the rows collapsed.
    case $((i % 4)) in
      0) mode='hybrid' ;;
      1) mode='reservation_only' ;;
      2) mode='queue_only' ;;
      *) mode='unavailable' ;;
    esac
    ( psql_quiet -c "select public.test_set_override('$scope', $barber_arg, '$mode')" > "$dir/racer.$i" 2>&1 ) &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p" || true; done

  local allowed=0 other=0 deadlock=0 out
  for i in $(seq 1 "$RACERS"); do
    out="$(cat "$dir/racer.$i" 2>/dev/null || echo MISSING)"
    case "$out" in
      ALLOWED) allowed=$((allowed + 1)) ;;
      40P01|40001) deadlock=$((deadlock + 1)); other=$((other + 1)) ;;
      *) other=$((other + 1)); echo "      unexpected override outcome: $out" >&2 ;;
    esac
  done

  local active
  if [[ "$scope" == "barber" ]]; then
    active="$(psql_quiet -c "select count(*) from public.service_mode_overrides where scope = 'barber' and barber_id = '$BARBER' and cleared_at is null")"
  else
    active="$(psql_quiet -c "select count(*) from public.service_mode_overrides where scope = 'location' and location_id = '$LOC' and cleared_at is null")"
  fi
  local history
  history="$(psql_quiet -c "select count(*) from public.service_mode_overrides where location_id = '$LOC' and scope = '$scope'")"

  echo "    $label"
  echo "      $RACERS racers -> committed=$allowed other=$other | ACTIVE overrides=$active | rows kept as history=$history"

  local ok=1
  if [[ "$deadlock" -ne 0 ]]; then
    echo "      FAIL  $deadlock racer(s) deadlocked" >&2; ok=0
  fi
  if [[ "$other" -ne 0 ]]; then
    echo "      FAIL  $other racer(s) failed unexpectedly — the supersede-then-insert should never surface a unique violation" >&2; ok=0
  fi
  if [[ "$active" != "1" ]]; then
    echo "      FAIL  $active active overrides survived; exactly 1 is the whole invariant" >&2; ok=0
  fi
  # Superseded rows are kept, never deleted: the history is the audit trail.
  if [[ "$history" -lt "$RACERS" ]]; then
    echo "      FAIL  only $history rows kept from $RACERS writers — superseded overrides must survive as history" >&2; ok=0
  fi
  if [[ "$ok" -eq 1 ]]; then
    echo "      PASS  exactly one active override, last writer wins, every superseded row kept"
  else
    FAILURES=$((FAILURES + 1))
  fi
}

# ===========================================================================
echo
echo "==> SCENARIO 1: location -> reservation_only, racing $RACERS queue joins"
reset_state
race_mode_vs_admission \
  "a shop stopping walk-ins while $RACERS people try to join" \
  "public.test_try_queue('$BARBER')" \
  "public.test_set_mode('reservation_only')" \
  "reservation_only" \
  "public.test_try_queue('$BARBER')"

echo
echo "==> SCENARIO 2: location -> queue_only, racing $RACERS bookings"
reset_state
race_mode_vs_admission \
  "a shop stopping reservations while $RACERS people try to book" \
  "public.test_try_book('$BARBER')" \
  "public.test_set_mode('queue_only')" \
  "queue_only" \
  "public.test_try_book('$BARBER')"

echo
echo "==> SCENARIO 3: barber -> unavailable, racing $RACERS bookings"
reset_state
race_mode_vs_admission \
  "a barber going unavailable while $RACERS people try to book them" \
  "public.test_try_book('$BARBER')" \
  "public.test_set_barber_mode('unavailable')" \
  "unavailable" \
  "public.test_try_book('$BARBER')"

echo
echo "==> SCENARIO 4: barber -> unavailable, racing $RACERS queue joins"
reset_state
race_mode_vs_admission \
  "a barber going unavailable while $RACERS people try to queue for them" \
  "public.test_try_queue('$BARBER')" \
  "public.test_set_barber_mode('unavailable')" \
  "unavailable" \
  "public.test_try_queue('$BARBER')"

echo
echo "==> SCENARIO 5: queue_open -> false, racing $RACERS queue joins"
# The runtime state, raced independently of the mode — which stays `hybrid`
# throughout, so this proves queue_open alone is decisive.
reset_state
race_mode_vs_admission \
  "the desk closing the line while $RACERS people try to join" \
  "public.test_try_queue('$BARBER')" \
  "public.test_set_queue_open(false)" \
  "QUEUE_CLOSED" \
  "public.test_try_queue('$BARBER')"

echo
echo "==> SCENARIO 6: $RACERS simultaneous BARBER temporary overrides"
reset_state
race_overrides "$RACERS writers on ONE barber's override" "barber" "'$BARBER'"

echo
echo "==> SCENARIO 7: $RACERS simultaneous LOCATION temporary overrides"
reset_state
race_overrides "$RACERS writers on ONE establishment's override" "location" "null"

echo
echo "==> SCENARIO 8: LOCATION and BARBER temporary overrides racing each other"
# Both scopes written at once, through the same establishment mutex. Each target
# must end with exactly one active row, and precedence must still resolve
# deterministically to the barber-scoped one.
reset_state
dir="$RESULTS/mixed"
mkdir -p "$dir"
pids=()
for i in $(seq 1 "$RACERS"); do
  ( psql_quiet -c "select public.test_set_override('location', null, 'queue_only')" > "$dir/loc.$i" 2>&1 ) &
  pids+=("$!")
  ( psql_quiet -c "select public.test_set_override('barber', '$BARBER', 'unavailable')" > "$dir/bar.$i" 2>&1 ) &
  pids+=("$!")
done
for p in "${pids[@]}"; do wait "$p" || true; done

active_loc="$(psql_quiet -c "select count(*) from public.service_mode_overrides where scope = 'location' and location_id = '$LOC' and cleared_at is null")"
active_bar="$(psql_quiet -c "select count(*) from public.service_mode_overrides where scope = 'barber' and barber_id = '$BARBER' and cleared_at is null")"
resolved_mode="$(psql_quiet -c "select mode from private.effective_service_mode('$LOC', '$BARBER')")"
resolved_src="$(psql_quiet -c "select source from private.effective_service_mode('$LOC', '$BARBER')")"
mixed_bad=0
for i in $(seq 1 "$RACERS"); do
  [[ "$(cat "$dir/loc.$i")" == "ALLOWED" ]] || mixed_bad=$((mixed_bad + 1))
  [[ "$(cat "$dir/bar.$i")" == "ALLOWED" ]] || mixed_bad=$((mixed_bad + 1))
done

echo "    $((RACERS * 2)) writers across BOTH scopes at once"
echo "      active location overrides=$active_loc | active barber overrides=$active_bar | resolved=$resolved_mode via $resolved_src | failed writers=$mixed_bad"
if [[ "$active_loc" == "1" && "$active_bar" == "1" && "$resolved_mode" == "unavailable" \
      && "$resolved_src" == "barber_temporary_override" && "$mixed_bad" -eq 0 ]]; then
  echo "      PASS  one active override per scope, and precedence still resolves to the barber"
else
  echo "      FAIL  the two scopes did not settle deterministically" >&2
  FAILURES=$((FAILURES + 1))
fi

echo
echo "==> SCENARIO 9: the EXPIRY BOUNDARY racing $RACERS admissions"
# An override that lapses on its own writes no row and emits no event. The
# resolver decides expiry by reading the clock, so admissions fired across the
# boundary must each be judged by the mode in force at their own instant — some
# refused, some admitted, none crashing — and once the boundary has passed a
# fresh admission must be ADMITTED without anyone having cleared anything.
reset_state
psql_run -q <<SQL
set client_min_messages = warning;
insert into public.service_mode_overrides (organization_id, scope, location_id, mode, starts_at, expires_at)
values ('$ORG', 'location', '$LOC', 'unavailable', now() - interval '1 minute', now() + interval '2 seconds');
SQL

dir="$RESULTS/expiry"
mkdir -p "$dir"
pids=()
for i in $(seq 1 "$RACERS"); do
  ( sleep "0.$((RANDOM % 4))"; psql_quiet -c "select public.test_try_book('$BARBER')" > "$dir/r.$i" 2>&1 ) &
  pids+=("$!")
done
for p in "${pids[@]}"; do wait "$p" || true; done

exp_allowed=0; exp_refused=0; exp_other=0
for i in $(seq 1 "$RACERS"); do
  case "$(cat "$dir/r.$i" 2>/dev/null)" in
    ALLOWED) exp_allowed=$((exp_allowed + 1)) ;;
    42501)   exp_refused=$((exp_refused + 1)) ;;
    *)       exp_other=$((exp_other + 1)) ;;
  esac
done

sleep 3
after_mode="$(psql_quiet -c "select mode from private.effective_service_mode('$LOC', '$BARBER')")"
after_src="$(psql_quiet -c "select source from private.effective_service_mode('$LOC', '$BARBER')")"
after_try="$(psql_quiet -c "select public.test_try_book('$BARBER')")"
still_uncleared="$(psql_quiet -c "select count(*) from public.service_mode_overrides where location_id = '$LOC' and cleared_at is null")"

echo "    $RACERS admissions fired across a 2-second expiry boundary"
echo "      allowed=$exp_allowed refused=$exp_refused other=$exp_other | after expiry: mode=$after_mode via $after_src, fresh booking=$after_try, uncleared rows still present=$still_uncleared"
if [[ "$exp_other" -eq 0 && "$after_mode" == "hybrid" && "$after_src" == "location_default" \
      && "$after_try" == "ALLOWED" && "$still_uncleared" == "1" ]]; then
  echo "      PASS  expiry is decided by the resolver alone — no cron, no sweep, and the lapsed row is still on disk"
else
  echo "      FAIL  the expiry boundary did not resolve cleanly" >&2
  FAILURES=$((FAILURES + 1))
fi

# ---------------------------------------------------------------------------
echo
echo "==> checking the server log for deadlocks across every scenario"
# A deadlock that both parties retried out of would not show up in any racer's
# exit status, but it WOULD be logged. This is the belt to the braces above.
if docker logs "$CONTAINER" 2>&1 | grep -qi 'deadlock detected'; then
  echo "    FAIL  the server log records a deadlock" >&2
  docker logs "$CONTAINER" 2>&1 | grep -i 'deadlock detected' | head -5 >&2
  FAILURES=$((FAILURES + 1))
else
  echo "    PASS  no deadlock was detected by the server at any point"
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "==> ALL SERVICE MODE CONCURRENCY SCENARIOS PASSED (RACERS=$RACERS)"
  exit 0
fi
echo "==> $FAILURES SERVICE MODE CONCURRENCY SCENARIO(S) FAILED (RACERS=$RACERS)" >&2
exit 1
