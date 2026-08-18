#!/bin/sh
# FadeUp booking scheduler loop.
#
# One job: call public.run_booking_maintenance() on a fixed interval so
# unanswered booking requests expire and release their slot, whether or not
# anybody has the app open.
#
# Deliberately boring. No application runtime, no dependency tree to patch —
# a postgres client image, a shell loop and one SQL call. The interesting
# logic (batching, locking, idempotency) lives in the database function, where
# it can be tested by the VERIFY suite.

set -eu

INTERVAL="${SCHEDULER_INTERVAL_SECONDS:-60}"
HEARTBEAT=/tmp/last-tick

# Fail fast and loudly rather than looping silently against nothing.
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"

echo "fadeup-scheduler: starting, interval ${INTERVAL}s, host ${PGHOST}, user ${PGUSER}"

# A tick must never outlive its interval, or a stalled connection would stack
# ticks up behind each other.
export PGCONNECT_TIMEOUT=10

while true; do
  # `|| true` around the whole tick on purpose: a database restart or a brief
  # network blip must not kill the scheduler. It logs, waits, and tries again —
  # the maintenance function is idempotent, so a missed tick costs nothing but
  # a minute of latency.
  if output=$(psql -v ON_ERROR_STOP=1 -At \
        -c "set statement_timeout = '30s'; select public.run_booking_maintenance();" 2>&1); then
    date +%s > "$HEARTBEAT"
    # Only say something when something happened. A quiet log is a readable log,
    # and this runs 1,440 times a day.
    if [ "$output" != "0" ]; then
      echo "$(date -u +%FT%TZ) fadeup-scheduler: expired ${output} booking request(s)"
    fi
  else
    echo "$(date -u +%FT%TZ) fadeup-scheduler: tick failed: ${output}" >&2
  fi

  sleep "$INTERVAL"
done
