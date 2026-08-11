# Prospect Worker V2 — operations

## Start

```bash
cd /opt/fadeup
cp infra/worker/.env.worker.example infra/worker/.env.worker   # first time only
# fill in infra/worker/.env.worker (DB_PASSWORD at minimum — see below)
./infra/worker/bootstrap-worker-db.sh                          # sets the prospect_worker DB password
docker compose -f infra/worker/docker-compose.yml up -d --build
```

The compose file joins the EXISTING `fadeup-supabase_default` network
(created by `infra/supabase/docker-compose.yml`) as `external: true` — it
does not create or manage that network, and never touches any Jasmean OS
network/container.

## Stop / restart

```bash
docker compose -f infra/worker/docker-compose.yml down     # stop (no -v — never discard volumes)
docker compose -f infra/worker/docker-compose.yml restart
```

## Logs

```bash
docker compose -f infra/worker/docker-compose.yml logs -f
# or
docker logs -f fadeup-prospect-worker-v2
```

Logs are structured JSON, one line per event (see
`apps/prospect-worker-v2/src/logger.ts`) — safe to ship as-is to a log
aggregator. Every line includes `worker_id`; job-scoped lines also include
`job_id`/`job_type`/`lane`.

## Creating a job

Via the Platform Owner UI: `/platform/acquisition/search`.

Via the CLI (inside the container, or `npm run cli --` locally against a
reachable DB):

```bash
docker exec fadeup-prospect-worker-v2 node dist/cli.js job create discovery \
  --payload '{"country":"FR","city":"Paris","latitude":48.8566,"longitude":2.3522,"radiusKm":3,"maxCandidates":20}' \
  --sources osm,geoapify

docker exec fadeup-prospect-worker-v2 node dist/cli.js job status <job-id>
```

(The CLI's `job create` inserts directly as the `prospect_worker` role —
not the `create_prospect_discovery_job` RPC, which is gated to
platform_owner/admin via PostgREST and isn't reachable from a direct
`psql`-style connection. Same tables, same shape, just a different write
path appropriate for local/dev tooling.)

## Source testing (opt-in, makes REAL requests — never run in CI/unit tests)

```bash
docker exec fadeup-prospect-worker-v2 node dist/cli.js sources list
docker exec fadeup-prospect-worker-v2 node dist/cli.js source test osm --lat 48.8566 --lon 2.3522 --radius 1
docker exec fadeup-prospect-worker-v2 node dist/cli.js source test geoapify --lat 48.8566 --lon 2.3522 --radius 3
docker exec fadeup-prospect-worker-v2 node dist/cli.js source test sirene --city Paris
docker exec fadeup-prospect-worker-v2 node dist/cli.js source test google_places --city Paris --max-candidates 3
```

Never prints an API key/token. A source with no credentials configured
prints "not configured — skipping" rather than erroring.

**Worked example from this build** (real live Overpass API, no key
needed): `source test osm --lat 48.8566 --lon 2.3522 --radius 1` returned
5 real Paris hairdressers/barbershops. A `job create discovery` with the
same params was then claimed and processed end-to-end by the running
Worker container: 5 candidates found, 3 new prospects created, 2 linked
to prospects from an earlier run (exact-source-external-id match), 0
errors, each scored deterministically (21/100 LOW or 46/100 MEDIUM
depending on which signals — phone, category match — were present in the
OSM tags).

## Quota management

`/platform/acquisition/sources` (enable/disable a source, view health,
manually pause/resume) and `/platform/acquisition/api-usage` (per-source
request counts, success rate, recent call log). See api-quotas.md for the
budget-guard mechanics.

## Failed-job recovery

Jobs are recovered automatically — `public.recover_stale_prospect_job_leases()`
runs on the Worker's own 60s timer (no `pg_cron` in this environment, see
database.md) and at the top of every poll cycle. A job that exhausted
`max_attempts` sits in `status='failed'` with `last_error` set — visible
on `/platform/acquisition/jobs`, re-triggerable by creating a fresh job
with the same payload (there is no "retry this exact job" button in V1;
failed jobs are diagnostic records, not resubmitted automatically, since a
failure that exhausted retries usually needs a human to look at
`last_error` first).

## Key rotation

Rotate `infra/worker/.env.worker`'s `DB_PASSWORD` (or any provider API
key), then:

```bash
./infra/worker/bootstrap-worker-db.sh          # only needed if DB_PASSWORD changed
docker compose -f infra/worker/docker-compose.yml up -d --build
```

The container picks up the new `.env.worker` on restart (`env_file:` is
read at container start, not live-reloaded).

## Health

`docker ps` shows `(healthy)`/`(unhealthy)` — backed by a heartbeat file
(`/tmp/prospect-worker-heartbeat`, written every poll cycle by every lane)
checked by `dist/healthcheck.js`, since this is a background worker with
no HTTP endpoint to probe. "Unhealthy" means no poll loop has touched the
file in the last 3 poll intervals — almost always a DB connectivity
problem; check logs first.

## Backups

The Worker's data lives in the same `fadeup-supabase-db` Postgres instance
as every other FadeUp table — it is covered by whatever backup strategy
already exists for that database (see the main repo's production
infrastructure docs, if/when a LOT 25-equivalent backup runbook exists for
the core product). No separate backup mechanism was introduced for this
schema.
