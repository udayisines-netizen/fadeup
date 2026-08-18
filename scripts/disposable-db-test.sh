#!/usr/bin/env bash
# FadeUp — disposable PostgreSQL migration + VERIFY harness.
#
# Spins up a THROWAWAY container from the same image the live stack runs
# (supabase/postgres), replays db/migrations/ in filename order, then
# optionally applies a MASTER file and runs a VERIFY script.
#
# It never touches the live fadeup-supabase-db container, never touches any
# Jasmean OS resource, and removes its own container on exit.
#
# Usage:
#   scripts/disposable-db-test.sh                       # migrations only
#   scripts/disposable-db-test.sh --master FILE         # + apply MASTER on a base built WITHOUT the new migrations
#   scripts/disposable-db-test.sh --verify FILE         # + run VERIFY
#   scripts/disposable-db-test.sh --keep                # leave the container running for inspection

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="fadeup-disposable-pgtest-$$"
IMAGE="${DISPOSABLE_PG_IMAGE:-supabase/postgres:17.6.1.136}"
PGPASSWORD_VALUE="disposable_$(date +%s)"

MASTER_FILE=""
VERIFY_FILE=""
KEEP=0
# When set, migrations dated on/after this prefix are SKIPPED during the
# base replay — used to prove MASTER can upgrade the CURRENT production
# schema on its own.
SKIP_FROM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --master) MASTER_FILE="$2"; shift 2 ;;
    --verify) VERIFY_FILE="$2"; shift 2 ;;
    --skip-from) SKIP_FROM="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cleanup() {
  if [[ "$KEEP" -eq 0 ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  else
    echo "container kept: $CONTAINER"
  fi
}
trap cleanup EXIT

echo "==> starting disposable postgres ($IMAGE) as $CONTAINER"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD_VALUE" \
  -e POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

# The supabase/postgres entrypoint initialises, then RESTARTS the server
# before the real startup. A single successful pg_isready is therefore not
# enough — require a run of consecutive successes so we do not start
# replaying migrations into a server that is about to shut down.
echo -n "==> waiting for stable readiness"
stable=0
for _ in $(seq 1 180); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    stable=$((stable + 1))
  else
    stable=0
  fi
  if [[ "$stable" -ge 8 ]]; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done
if [[ "$stable" -lt 8 ]]; then
  echo " FAILED — postgres never became stably ready" >&2
  docker logs --tail 40 "$CONTAINER" >&2
  exit 1
fi

psql_run() {
  docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

# The supabase/postgres image ALREADY ships the roles (anon, authenticated,
# service_role, supabase_auth_admin), the auth schema, auth.users and
# auth.uid() — verified by probing the image, not assumed. This step only
# fills the small gaps db/migrations relies on and that the image leaves to
# the running stack.
echo "==> bootstrapping supabase-compatible prerequisites"
psql_run -q <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to postgres, anon, authenticated, service_role;
grant select, insert on auth.users to postgres;

-- The migrations create SECURITY DEFINER functions owned by postgres that
-- read auth.users; without this the definer cannot see the table.
grant select on all tables in schema auth to postgres;

SQL

# storage.buckets/objects + storage.foldername() are created by the
# supabase-storage SERVICE at runtime, not by the base image and not by
# db/migrations — but 20260813140000_fade_passport.sql (an EXISTING,
# unrelated migration) references them. Stand up a shape-compatible minimum
# so the full chain replays. The storage schema is owned by supabase_admin,
# which `postgres` is not a member of, so this one block connects as that
# role. Disposable-container scaffolding only — never part of a migration.
echo "==> bootstrapping storage scaffolding"
docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $fn$
  select string_to_array(name, '/');
$fn$;

-- The fade_passport migration seeds a bucket and creates RLS policies on
-- storage.objects; creating a policy requires table ownership, which in
-- the live stack the storage service already arranges.
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;

grant usage on schema storage to postgres, anon, authenticated, service_role;
grant create on schema storage to postgres;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
SQL

echo "==> replaying db/migrations"
applied=0
skipped=0
for migration in "$REPO_ROOT"/db/migrations/*.sql; do
  name="$(basename "$migration")"
  if [[ -n "$SKIP_FROM" && "$name" > "$SKIP_FROM" ]] || [[ -n "$SKIP_FROM" && "$name" == "$SKIP_FROM" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  if ! docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$migration"; then
    echo "!! FAILED: $name" >&2
    exit 1
  fi
  applied=$((applied + 1))
done
echo "==> applied $applied migrations (skipped $skipped)"

if [[ -n "$MASTER_FILE" ]]; then
  echo "==> applying MASTER: $MASTER_FILE"
  if ! docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$REPO_ROOT/$MASTER_FILE"; then
    echo "!! MASTER FAILED — transaction did not commit" >&2
    exit 1
  fi
  echo "==> MASTER committed"
fi

if [[ -n "$VERIFY_FILE" ]]; then
  echo "==> running VERIFY: $VERIFY_FILE"
  # ON_ERROR_STOP is deliberately OFF here: VERIFY reports FAIL rows, it
  # does not abort. A genuine SQL error still surfaces in the output.
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -q < "$REPO_ROOT/$VERIFY_FILE" \
    | tee /tmp/fadeup-verify-output.txt
  echo
  echo "==> VERIFY summary"
  pass=$(grep -c '| PASS' /tmp/fadeup-verify-output.txt || true)
  fail=$(grep -c '| FAIL' /tmp/fadeup-verify-output.txt || true)
  info=$(grep -c '| INFO' /tmp/fadeup-verify-output.txt || true)
  echo "PASS=$pass FAIL=$fail INFO=$info"
  if [[ "$fail" -gt 0 ]]; then
    echo "!! VERIFY reported $fail FAIL row(s)" >&2
    exit 1
  fi
fi

echo "==> done"
