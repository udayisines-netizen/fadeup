# Prospect Worker V2 — API quotas

## Tracking

Every provider request goes through `withQuotaGuard()`
(`apps/prospect-worker-v2/src/quota.ts`), which:

1. Checks `private.is_prospect_source_paused(source_key)` BEFORE the
   request — manual pause OR today's/this month's configured budget
   already reached.
2. Times the request.
3. Calls `private.record_api_usage(...)` after — always, success or
   failure — which appends one row to `public.api_usage` (per-call log)
   and updates the rolling `public.api_source_health` aggregate
   (requests today/this month, success/failure/rate-limited counts,
   average latency, last request/success/failure timestamps, last error).

`requests_today`/`requests_this_month` reset **lazily**: the first call
after a day/month rollover resets the counter to 1 rather than
incrementing a stale one — no `pg_cron` needed for this (see
database.md).

## Budgets

`public.api_source_limits` (one row per source, editable by
platform_owner/admin from `/platform/acquisition/sources`):

| source | max/minute | max/day | max/month |
|---|---|---|---|
| google_places | 20 | 1000 | 10000 |
| geoapify | 5 | 3000 | 90000 |
| sirene | 10 | 5000 | — |
| instagram | 10 | 500 | 10000 |
| osm, website | — | — | — |

These are starting defaults, not hard-coded — change them per-provider
via the Sources UI as real usage patterns emerge. OSM/website have no
configured limit by default (OSM's public Overpass instance has its own
server-side throttling; a self-hosted/paid instance would warrant adding
one here).

## One provider hitting quota pauses only that provider

`private.is_prospect_source_paused()` is checked per-source, per-request
— if `geoapify` hits its daily limit mid-job, `osm`/`sirene`/others in the
same job are unaffected. The job runner records the paused source's
`prospect_job_sources` row as `skipped` and continues.

## Manual pause

`public.set_prospect_source_paused(key, paused, reason)` — platform_owner/
admin only, from the Sources UI. Useful for a known provider-side
maintenance window or to deliberately conserve quota ahead of a big
planned discovery run.

## Rate limits (per-minute) are NOT yet enforced server-side

`api_source_limits.max_requests_per_minute` is configured but the current
quota guard (`is_prospect_source_paused`) only checks day/month counters,
not a sliding per-minute window — the config values in `.env.worker`
(`GOOGLE_MAX_REQUESTS_PER_MINUTE`, `GEOAPIFY_MAX_REQUESTS_PER_SECOND`,
`OVERPASS_MAX_CONCURRENT_REQUESTS`, `INSEE_MAX_CONCURRENT_REQUESTS`) are
loaded into `src/config.ts` but not yet wired into a token-bucket/
concurrency limiter in the adapters themselves. **Known gap**: for V1,
`WORKER_CONCURRENCY` (default from `.env.worker`) plus each adapter's own
per-call behavior (e.g. `WebsiteAdapter`'s per-domain 3s minimum interval)
is the only rate limiting in effect. A real per-minute/per-second token
bucket per source is a reasonable near-term follow-up before running
large-scale discovery jobs against paid APIs.
