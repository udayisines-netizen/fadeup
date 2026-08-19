#!/usr/bin/env bash
# FadeUp — LOT E: TRUE parallel booking race.
#
# WHY THIS EXISTS SEPARATELY FROM VERIFY
#
#   A VERIFY script runs in one session. When it books a slot and then books
#   it again, the second call sees the first one's row already committed —
#   that proves the constraint refuses a duplicate, but it is SERIALIZED
#   contention, not a race. The interesting failure mode of auto-confirm is
#   two people tapping "Book" in the same second, on different connections,
#   before either row is visible to the other.
#
#   So this fires N genuinely simultaneous psql connections at ONE slot and
#   counts how many appointments exist afterwards. The answer must be 1.
#
#   It never touches the live database: it builds its own throwaway container
#   from the same image, replays db/migrations, and removes itself on exit.
#
# Usage:
#   scripts/lot-e-concurrency-test.sh            # 8 racers per scenario
#   RACERS=24 scripts/lot-e-concurrency-test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RACERS="${RACERS:-8}"
FAILURES=0
CONTAINER=""

cleanup() { [[ -n "$CONTAINER" ]] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Reuses the main harness rather than re-deriving its bootstrap. That harness
# already knows the exact supabase-compatible prerequisites and storage
# scaffolding db/migrations needs; a second copy here drifted within minutes
# of being written, which is precisely the failure this avoids.
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

echo "==> seeding one bookable shop"
psql_run -q <<'SQL' >/dev/null
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-0000000000ff',
        'authenticated', 'authenticated', 'race-owner@fadeup.test', 'x', '{}'::jsonb,
        '{"full_name":"Race Owner"}'::jsonb, now(), now());

create table if not exists public._race_ids (k text primary key, v uuid);

do $$
declare v_row record; v_org uuid; v_loc uuid; v_barber uuid; v_svc uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"0e000000-0000-4000-8000-0000000000ff","role":"authenticated"}', false);
  perform set_config('request.jwt.claim.sub', '0e000000-0000-4000-8000-0000000000ff', false);
  set local role authenticated;

  select * into v_row from public.complete_organization_onboarding('Race Shop', 'race-shop', 'Main', 'Europe/Paris');
  v_org := v_row.organization_id; v_loc := v_row.location_id;
  perform public.save_business_profile(v_org, 'barbershop'::public.business_type, 'EUR', 'FR');
  v_barber := public.ensure_owner_professional(v_org, v_loc, 'Race Pro', 'Barber');
  perform public.apply_starter_services(v_org, v_loc,
    '[{"name":"Coupe","duration_minutes":30,"price_cents":2500}]'::jsonb, v_barber);
  perform public.apply_weekly_hours(v_org, v_loc, v_barber,
    (select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', '08:00', 'close_time', '20:00'))
     from generate_series(0, 6) d));
  perform public.complete_onboarding(v_org, true);
  select s.id into v_svc from public.services s where s.organization_id = v_org limit 1;

  reset role;
  insert into public._race_ids (k, v) values ('loc', v_loc), ('barber', v_barber), ('svc', v_svc), ('org', v_org);
end $$;
SQL

LOC=$(psql_quiet -c "select v from public._race_ids where k='loc'")
BARBER=$(psql_quiet -c "select v from public._race_ids where k='barber'")
SVC=$(psql_quiet -c "select v from public._race_ids where k='svc'")
ORG=$(psql_quiet -c "select v from public._race_ids where k='org'")

# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------

race() {
  local label="$1" sql="$2" expected_winners="$3" count_sql="$4"
  local outdir; outdir="$(mktemp -d)"

  echo
  echo "--- $label ($RACERS simultaneous connections)"

  # SYNCHRONIZED INSIDE POSTGRES, not by the shell.
  #
  # A shell FIFO gate deadlocks: several concurrent opens on one FIFO pair up
  # unpredictably, and one writer can satisfy several readers. Worse, it only
  # releases the shell — each racer still has to establish a connection
  # afterwards, so they arrive milliseconds apart anyway.
  #
  # Instead every racer connects, warms up, and then sleeps until the SAME
  # wall-clock instant before firing. By then all connections are established
  # and all plans are parsed, so the statements genuinely contend.
  local fire_at
  fire_at="$(psql_quiet -c "select to_char(clock_timestamp() + interval '6 seconds', 'YYYY-MM-DD HH24:MI:SS.MS')")"

  for i in $(seq 1 "$RACERS"); do
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -At \
      -c "select pg_sleep(greatest(0, extract(epoch from (timestamp '$fire_at' - clock_timestamp()))));" \
      -c "$sql" > "$outdir/$i.out" 2> "$outdir/$i.err" &
  done
  wait

  local winners; winners=$(psql_quiet -c "$count_sql")
  local refused; refused=$(cat "$outdir"/*.err 2>/dev/null | grep -ci "exclusion\|conflict\|unavailable\|duplicate" || true)
  local other; other=$(cat "$outdir"/*.err 2>/dev/null | grep -ci "ERROR" || true)

  if [[ "$winners" == "$expected_winners" ]]; then
    echo "PASS  winners=$winners (expected $expected_winners) · losers refused by the constraint=$refused · total errors=$other"
  else
    echo "FAIL  winners=$winners (expected $expected_winners)"
    cat "$outdir"/*.err 2>/dev/null | sort | uniq -c | head -5
    FAILURES=$((FAILURES + 1))
  fi
  rm -rf "$outdir"
}

TARGET="(date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days' + interval '10 hours') at time zone 'Europe/Paris'"

# 1. Anonymous public bookings, all at the same slot.
race "1. anonymous public booking, same slot" \
  "set role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',false); select id from public.book_public_appointment('race-shop','$LOC','$BARBER','$SVC',$TARGET,'Racer','+33600000000','race@fadeup.test',null);" \
  "1" \
  "select count(*) from public.appointments where status <> 'cancelled' and starts_at = $TARGET"

# 2. Staff-side direct inserts racing the same slot.
TARGET2="(date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days' + interval '12 hours') at time zone 'Europe/Paris'"
race "2. staff-side inserts, same slot" \
  "insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, status) values ('$ORG','$LOC','$BARBER','$SVC','Staff Racer', $TARGET2, $TARGET2 + interval '30 minutes', 0, 0, 'confirmed');" \
  "1" \
  "select count(*) from public.appointments where status <> 'cancelled' and starts_at = $TARGET2"

# 3. Many appointments racing a reschedule INTO one free slot.
echo
echo "==> seeding $RACERS confirmed appointments for the reschedule race"
psql_quiet -c "
do \$\$
declare i integer;
begin
  for i in 1..$RACERS loop
    insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, status)
    values ('$ORG','$LOC','$BARBER','$SVC','Mover '||i,
            (date_trunc('day', now() at time zone 'Europe/Paris') + interval '8 days' + make_interval(hours => 8, mins => (i-1)*30)) at time zone 'Europe/Paris',
            (date_trunc('day', now() at time zone 'Europe/Paris') + interval '8 days' + make_interval(hours => 8, mins => (i-1)*30 + 30)) at time zone 'Europe/Paris',
            0, 0, 'confirmed');
  end loop;
end \$\$;" >/dev/null

TARGET3="(date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days' + interval '14 hours') at time zone 'Europe/Paris'"
# Authenticated as the shop owner: reschedule_appointment refuses an
# unauthenticated caller, which is correct and is asserted in VERIFY. What is
# being raced here is the DESTINATION, not the authorization.
race "3. reschedule race — many appointments, one destination" \
  "select set_config('request.jwt.claims','{\"sub\":\"0e000000-0000-4000-8000-0000000000ff\",\"role\":\"authenticated\"}',false); select set_config('request.jwt.claim.sub','0e000000-0000-4000-8000-0000000000ff',false); set role authenticated; select public.reschedule_appointment((select id from public.appointments where customer_name like 'Mover %' and starts_at > now() order by random() limit 1), $TARGET3);" \
  "1" \
  "select count(*) from public.appointments where status <> 'cancelled' and starts_at = $TARGET3"

# 4. A blocked hour must refuse EVERY racer.
echo
echo "==> blocking 16:00-17:00 for the professional"
psql_quiet -c "insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason) values ('$ORG','$LOC','$BARBER', (date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days' + interval '16 hours') at time zone 'Europe/Paris', (date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days' + interval '17 hours') at time zone 'Europe/Paris', 'Blocked');" >/dev/null

TARGET4="(date_trunc('day', now() at time zone 'Europe/Paris') + interval '7 days' + interval '16 hours') at time zone 'Europe/Paris'"
race "4. blocked time — every racer must lose" \
  "set role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',false); select id from public.book_public_appointment('race-shop','$LOC','$BARBER','$SVC',$TARGET4,'Racer','+33600000000','race@fadeup.test',null);" \
  "0" \
  "select count(*) from public.appointments where status <> 'cancelled' and starts_at = $TARGET4"

echo
echo "============================================================"
if [[ "$FAILURES" -eq 0 ]]; then
  echo "LOT E CONCURRENCY: PASS — every scenario produced exactly the expected number of winners"
else
  echo "LOT E CONCURRENCY: $FAILURES scenario(s) FAILED"
  exit 1
fi
