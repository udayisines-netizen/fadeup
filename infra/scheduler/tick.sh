#!/bin/sh
# FadeUp booking scheduler loop.
#
# Three jobs now, on the same fixed interval:
#
#   run_booking_maintenance()      expire unanswered booking requests so the
#                                  slot is released, whether or not anybody has
#                                  the app open.
#   run_acquisition_maintenance()  expire unanswered INTEREST requests (the
#                                  unclaimed-profile funnel B2 added) and queue
#                                  the prospect follow-ups that are due.
#   run_email_delivery()           reconcile the previous tick's sends and
#                                  dispatch new ones through Resend.
#
# They are three calls and not one on purpose: a Resend outage must not stop
# slots being released, and a slow expiry sweep must not delay a confirmation
# email. Each is independently idempotent, so a tick that dies between two of
# them costs a minute, never a duplicate.
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

# statement_timeout goes on the CONNECTION, not in the query. Sending
# `set statement_timeout = ...; select ...` makes psql return TWO results —
# the literal string "SET" and then the count — so the output is "SET\n0" and
# every parse of it is wrong. Found on the first live tick, which logged
# "expired SET / 0 booking request(s)" and would have logged on all 1,440
# ticks a day.
export PGOPTIONS='-c statement_timeout=30s'

while true; do
  # `|| true` around the whole tick on purpose: a database restart or a brief
  # network blip must not kill the scheduler. It logs, waits, and tries again —
  # the maintenance function is idempotent, so a missed tick costs nothing but
  # a minute of latency.
  # One statement, three calls, one row out. Sending them as a single query
  # keeps the tick to a single round trip and — more importantly — makes the
  # parsing unambiguous: psql -At returns exactly one line of pipe-separated
  # counters, whatever the values. The earlier bug in this file was born of a
  # command that returned two results and a parse that assumed one.
  #
  # The column names come from each function's RETURNS TABLE, NOT from the
  # function name: run_booking_maintenance() returns a column called
  # expired_requests. Writing b.run_booking_maintenance failed on the first
  # live tick after B2 — loudly, in the log, because this loop reports its
  # errors instead of swallowing them.
  if output=$(psql -v ON_ERROR_STOP=1 -At \
        -c "select b.expired_requests || '|' || a.expired_requests || '|' || a.outreach_queued || '|' || e.dispatched || '|' || e.reconciled
            from public.run_booking_maintenance() b,
                 public.run_acquisition_maintenance() a,
                 public.run_email_delivery() e;" 2>&1); then
    date +%s > "$HEARTBEAT"
    # Only say something when something happened. A quiet log is a readable log,
    # and this runs 1,440 times a day.
    if [ "$output" != "0|0|0|0|0" ]; then
      echo "$(date -u +%FT%TZ) fadeup-scheduler: bookings_expired|interest_expired|outreach_queued|emails_sent|emails_reconciled = ${output}"
    fi
  else
    echo "$(date -u +%FT%TZ) fadeup-scheduler: tick failed: ${output}" >&2
  fi

  sleep "$INTERVAL"
done
