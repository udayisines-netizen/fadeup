# Prospect Worker V2 — architecture

## Purpose

Prospect Worker V2 discovers, enriches, deduplicates, and deterministically
scores barbershop/independent-barber sales prospects for FadeUp's Platform
Owner Control Center. It is FadeUp's own growth/sales tooling — it has no
`organization_id` anywhere and is completely separate from FadeUp's tenant
(barbershop) product.

## Components

```
apps/prospect-worker-v2/     Node 22 + TypeScript worker process
infra/worker/                Docker Compose service, DB bootstrap script, env
db/migrations/2026081115*    Schema + job queue + RPCs (see database.md)
apps/web (/platform/acquisition)   Platform Owner UI (Search, Prospects, Jobs, ...)
```

The Worker is a **standalone Node process**, not a Supabase Edge Function
and not reachable via PostgREST. It connects to Postgres **directly** (via
`pg`, not the Supabase client) as a dedicated, non-superuser role
(`prospect_worker`) — see database.md for why.

## Job queue (PostgreSQL, no Redis)

`public.prospect_jobs` is the durable queue. Claiming uses:

```sql
select * from private.claim_next_prospect_job(worker_id, lease_seconds);
```

which does `SELECT ... FOR UPDATE SKIP LOCKED` internally — multiple
Worker processes/lanes can poll concurrently without blocking each other
or double-claiming a row (verified with real concurrent `psql` sessions,
see database.md's verification section).

States: `queued → running → (completed | retry → running... | failed | cancelled)`.

A job holds a **lease** (`lease_until`) while running. The Worker extends
its own lease periodically for long jobs (`private.extend_prospect_job_lease`).
If a Worker process dies mid-job, the lease expires and
`public.recover_stale_prospect_job_leases()` — called opportunistically by
every Worker at the top of its poll loop and on a 60s timer, since this
environment has no `pg_cron` (see database.md) — puts the job back into
`retry` (or `failed`, if `attempts >= max_attempts`).

Each `apps/prospect-worker-v2/src/worker.ts` process runs
`WORKER_CONCURRENCY` independent polling "lanes", each claiming and
processing one job at a time.

## Job types and the discovery waterfall

`job_type`: `discovery | enrichment | dedup_scan | scoring | website_crawl | instagram_enrich`.

A **discovery** job (`src/jobs/discovery.ts`) is the main flow:

1. Resolve the country-specific bulk-source order (France: OSM → Geoapify
   → Sirene; elsewhere: OSM → Geoapify — see sources.md).
2. For each bulk source, if enabled/configured/not-paused: fetch raw
   candidates, normalize each (name/phone/domain/email/address — see
   normalize/), check for a high-confidence dedup match, and either link
   into an existing prospect or insert a new one + record provenance.
   **A failed source does not fail the job** — every other source still
   runs, and the failure is recorded on that job's `prospect_job_sources`
   row.
3. Run a **Google Places enrichment pass** — only for candidates that
   already cleared the free sources with decent confidence, never a bulk
   sweep (Google quota discipline).
4. Run **website enrichment** for any candidate with a website URL.
5. Run **Instagram enrichment** (official Graph API only) for any
   candidate with a discovered handle, if configured.
6. Score every prospect the job touched (`src/scoring/score.ts`).

`enrichment` / `website_crawl` / `instagram_enrich` jobs re-run the same
enrichment passes against an EXISTING set of prospects (e.g. "re-crawl
every prospect without a website on record"). `dedup_scan` sweeps
recently-created prospects for fuzzy duplicate candidates against the
whole table. `scoring` recomputes stale scores.

## Retry engine

`src/retry.ts` classifies every failure:

- **Never retried** (goes straight to `failed`): 401/403 (invalid
  credentials/permission), 400/404/422 (bad request).
- **Retried** (exponential backoff + full jitter, bounded by
  `max_attempts`): 429, 5xx, timeouts, network errors, and anything
  unclassified (safety default — bounded by `max_attempts` regardless).

## Quota guard

`src/quota.ts` / `private.is_prospect_source_paused()` /
`private.record_api_usage()` (SQL, see database.md) track per-source
daily/monthly request counts and auto-pause a source the instant it would
exceed its configured budget (`api_source_limits`) — **one provider
hitting quota pauses only that provider**, never the whole Worker.

## Deployment

See operations.md for start/stop/logs/deploy. Summary: a single Docker
container (`fadeup-prospect-worker-v2`) on the existing
`fadeup-supabase_default` Docker network, no public port, a heartbeat-file
based `HEALTHCHECK` (this is a background worker, not an HTTP server).
