#!/usr/bin/env bash
# FadeUp — Prospect Worker V2: database role bootstrap
#
# Sets (or rotates) the login password for the `prospect_worker` Postgres
# role from infra/worker/.env.worker's DB_PASSWORD. The role itself, and
# every grant/RLS policy scoping what it can touch, is created by
# db/migrations/20260811150100_prospect_acquisition_schema.sql — this
# script's ONLY job is the password, which deliberately does not belong in
# a version-controlled SQL migration.
#
# Never prints DB_PASSWORD (or any other .env.worker value). Safe to
# re-run — rotates the password to whatever is currently in .env.worker.
#
# Usage:
#   ./infra/worker/bootstrap-worker-db.sh
#
# Requires: the FadeUp Supabase Postgres container running (fadeup-supabase-db
# by default — override with SUPABASE_DB_CONTAINER).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.worker"
CONTAINER="${SUPABASE_DB_CONTAINER:-fadeup-supabase-db}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "error: ${ENV_FILE} not found. Copy .env.worker.example and fill it in first." >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  # Last matching, non-comment line wins — matches normal .env semantics.
  grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d '=' -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

DB_USER="$(read_env_value DB_USER)"
DB_PASSWORD="$(read_env_value DB_PASSWORD)"

if [ -z "${DB_USER}" ] || [ -z "${DB_PASSWORD}" ]; then
  echo "error: DB_USER and DB_PASSWORD must both be set in ${ENV_FILE}" >&2
  exit 1
fi

if [ "${DB_USER}" != "prospect_worker" ]; then
  echo "error: this script only bootstraps the 'prospect_worker' role — DB_USER in ${ENV_FILE} is '${DB_USER}'" >&2
  exit 1
fi

if ! docker inspect "${CONTAINER}" >/dev/null 2>&1; then
  echo "error: container '${CONTAINER}' not found. Is the FadeUp Supabase stack running?" >&2
  exit 1
fi

if ! docker exec "${CONTAINER}" psql -U postgres -d postgres -tAc \
    "select 1 from pg_roles where rolname = 'prospect_worker'" | grep -q 1; then
  echo "error: role 'prospect_worker' does not exist yet — run the prospect_acquisition_schema migration first." >&2
  exit 1
fi

# Password passed over STDIN as part of the SQL text, never as a docker
# exec / psql command-line argument (which would be visible in `ps aux`
# / docker's own process table). Single quotes in the password are
# escaped by doubling, the standard SQL string-literal escape.
ESCAPED_PASSWORD="${DB_PASSWORD//\'/\'\'}"

docker exec -i "${CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
alter role prospect_worker with password '${ESCAPED_PASSWORD}';
SQL

echo "prospect_worker password set from ${ENV_FILE}. (Not printed.)"
