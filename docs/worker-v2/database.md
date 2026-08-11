# Prospect Worker V2 — database

## Migrations

- `20260811150000_prospect_acquisition_extensions.sql` — `pg_trgm`,
  `unaccent`, `cube`, `earthdistance`.
- `20260811150100_prospect_acquisition_schema.sql` — the `prospect_worker`
  role, all enums, `prospects` + every satellite table (locations,
  contacts, social_profiles, source_records, scores, events, tags,
  duplicates, notes, outreach, suppressions), `prospect_sources` (seeded
  with the 6 sources), RLS, and the sync triggers (score→prospect cache,
  suppression→do_not_contact, status-change→event log,
  duplicate-status-change→reviewer stamp).
- `20260811150200_prospect_job_queue.sql` — `prospect_jobs`,
  `prospect_job_sources`, `api_usage`, `api_source_limits`,
  `api_source_health`, and every job-queue/quota-guard function
  (`private.claim_next_prospect_job`, `extend_prospect_job_lease`,
  `complete_prospect_job`, `fail_prospect_job`,
  `public.recover_stale_prospect_job_leases`,
  `private.record_api_usage`, `private.is_prospect_source_paused`,
  `public.create_prospect_discovery_job`, `public.cancel_prospect_job`,
  `public.set_prospect_source_enabled`, `public.set_prospect_source_paused`).

All three are idempotent (re-run confirmed with a second apply — no
errors, `NOTICE ... skipping` only) and were applied to the live
`fadeup-supabase-db` container during this build.

## Why this schema has no `organization_id`

CLAUDE.md's tenant-isolation rules govern FadeUp's *product* (barbershop)
data. `prospects` and everything under it is FadeUp's OWN sales/growth
data about businesses that are not (yet) FadeUp customers — there is no
tenant to scope it to. Every table is instead gated to FadeUp platform
staff only (`public.platform_members` — see
`20260810130000_platform_roles.sql`), never anon, never an ordinary
barbershop/customer authenticated user.

## Two write paths

1. **`prospect_worker`** — a dedicated, non-superuser, non-BYPASSRLS
   Postgres role the Worker process connects to DIRECTLY (not
   PostgREST — job claiming needs `FOR UPDATE SKIP LOCKED`, which the
   REST layer cannot express). Every table it can touch has an explicit
   `to prospect_worker using (true) with check (true)` policy — auditable
   the same way every other access path in this schema is (named
   policies, never a blanket bypass). Its login password is set (or
   rotated) by `infra/worker/bootstrap-worker-db.sh` from
   `infra/worker/.env.worker`, never in a migration file. `postgres` is
   granted membership in `prospect_worker` so ops/test tooling can
   `SET ROLE prospect_worker` to impersonate it (needed since `postgres`
   is NOT superuser in this self-hosted setup — confirmed via
   `pg_roles.rolsuper = false`).
2. **FadeUp platform staff**, via the ordinary Supabase client —
   `private.is_platform_admin()` / `private.has_platform_role()`, same
   helpers used throughout `/platform`. Read access: any platform role.
   Direct writes (notes, tags, outreach, suppression, duplicate
   resolution, source config): platform_owner/platform_admin only.

## Job queue mechanics

`claim_next_prospect_job(worker_id, lease_seconds)`:

```sql
select * from public.prospect_jobs
where status in ('queued','retry') and scheduled_at <= now()
order by priority desc, scheduled_at
for update skip locked
limit 1;
-- then UPDATE ... set status='running', worker_id=..., lease_until=..., attempts=attempts+1
```

`SKIP LOCKED` means N concurrent claimers each get a DIFFERENT row (or
none) — verified for real with 6 parallel `psql` processes claiming
against 5 queued jobs: 5 distinct workers got 5 distinct jobs, the 6th got
`null`, zero double-claims.

`fail_prospect_job(id, worker_id, error, retryable, next_attempt_at)`:
retryable + `attempts < max_attempts` → `retry` (rescheduled to
`next_attempt_at`, computed by the Worker's backoff-with-jitter — see
architecture.md); otherwise → `failed` immediately, **even with attempts
remaining**, for non-retryable errors (bad credentials/bad request) — this
is enforced in the SQL function itself, not just the Worker, so it holds
regardless of which Worker process calls it.

`recover_stale_prospect_job_leases()`: any `running` job whose
`lease_until` has passed goes back to `retry` (or `failed`, if out of
attempts) — verified: a forced-stale lease was recovered exactly once (1
row), and calling recovery again immediately was a genuine no-op (0 rows).

## Deduplication

Priority order (`private.is_prospect_value_suppressed` +
`src/dedupe/candidates.ts`'s `findHighConfidenceMatch`), first hit wins,
safe to auto-link (no human review needed):

1. Exact source external ID (`prospect_source_records.source_id` +
   `external_id`).
2. SIRET (stored as a `sirene`-source `external_id`).
3. Normalized phone (E.164).
4. Normalized website domain.
5. Exact social handle.

If none match, a **fuzzy** check runs (`findFuzzyCandidates`): normalized
name similarity (`pg_trgm`, `extensions.similarity()`, threshold 0.45)
combined with geographic proximity (`extensions.earth_distance()` ≤ 150m
— **not** `earth_box()`'s cube-containment operator, which requires an
explicit `cube`↔`earth` cast not worth the complexity at this scale).
Every fuzzy hit becomes a `prospect_duplicates` row with `status='pending'`
for a human to review — **never auto-merged**. The unordered-pair unique
index (`least/greatest(prospect_id, duplicate_of_prospect_id)`) means a
(B,A) insert after an (A,B) insert is correctly rejected as the same
candidacy.

## Scoring

Append-only `prospect_scores`, synced to `prospects.current_score` /
`current_score_bucket` by trigger. 13 deterministic factors summing to
exactly 100 max points (0-39 LOW, 40-69 MEDIUM, 70-84 HIGH, 85-100 HOT) —
see `apps/prospect-worker-v2/src/scoring/score.ts` and its test suite for
the exact factor list/weights. No AI.

## Verification

`db/tests/verify_prospect_worker_v2.sql` — 22 numbered sections covering
RLS default-deny (anon, ordinary tenant user), platform_support
read-only vs platform_owner/admin write, job creation fan-out (including
disabled sources recorded as "skipped" not omitted), claim/no-double-claim,
provenance insert, score/event/suppression/duplicate-review sync triggers,
suppression blocking re-discovery, quota guard auto-pause at a configured
daily limit, manual pause/resume, retryable-vs-terminal `fail_prospect_job`,
stale lease recovery (including the genuine-no-op second call),
worker-identity-checked `complete_prospect_job`, and confirmation that
`prospect_worker` has zero access to tenant tables (`organizations`,
`appointments`) — no grant, no policy, RLS default-deny holds. Every
"expect ERROR" case runs in its own `begin/rollback` block. Full pass
confirmed, cleanup confirmed (0 remaining fixture rows).

Real cross-connection concurrency (not just the SQL script) was verified
separately with 6 parallel `psql` processes — see above.
