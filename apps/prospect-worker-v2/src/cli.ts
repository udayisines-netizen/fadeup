#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { getPool, closePool } from './db.js'
import { buildSourceRegistry } from './sources/registry.js'
import type { DiscoveryQuery } from './sources/types.js'

/**
 * Developer CLI — `npm run cli -- <command> ...`. Every "source test"
 * command makes a REAL request against the live provider (opt-in, never
 * run as part of `npm test`/CI — see spec: "real API tests must be
 * opt-in"). Never prints an API key/token, only pass/fail + a candidate
 * count.
 */

const HELP = `
FadeUp Prospect Worker V2 — developer CLI

Usage:
  npm run cli -- source test <osm|geoapify|sirene|google_places|website|instagram> [options]
  npm run cli -- job create <discovery|enrichment|dedup_scan|scoring|publication_evaluation|planity_enrichment> --payload '<json>' [--priority N] [--sources osm,geoapify]
  npm run cli -- job status <job-id>
  npm run cli -- sources list

publication_evaluation refreshes the operator's publication review queue. It
EVALUATES only — minting an external identity is public.publish_external_
professional, which this worker's role has no EXECUTE grant on. Payloads:
  '{}'                          sweep 100 least-recently-evaluated prospects
  '{"limit":500}'               sweep a larger batch (hard cap 1000)
  '{"prospectIds":["<uuid>"]}'  re-evaluate specific prospects
Pass --sources to a non-discovery job to avoid a meaningless source fan-out.

planity_enrichment reads the PUBLIC Planity establishment page of prospects
whose own website already links to one, to learn whether they are actually
bookable there. It discovers nothing, searches nothing, and publishes nothing.
  '{}'                          up to PLANITY_BATCH_SIZE candidates due a check
  '{"limit":5}'                 a small, conservative batch
  '{"prospectIds":["<uuid>"]}'  re-check specific prospects, ignoring freshness
Set PLANITY_ENABLED=false to switch the source off without a deploy.

Options for "source test":
  --country FR        (default: config DEFAULT_COUNTRY)
  --city Paris
  --lat 48.8566 --lon 2.3522
  --radius 5           (km)
  --website-url https://example.com   (website adapter only)
  --instagram-handle somehandle        (instagram adapter only)
`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const [command, subcommand, ...rest] = args

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP)
    return
  }

  const config = loadConfig()

  if (command === 'source' && subcommand === 'test') {
    await runSourceTest(rest, config)
    return
  }

  if (command === 'job' && subcommand === 'create') {
    await runJobCreate(rest, config)
    return
  }

  if (command === 'job' && subcommand === 'status') {
    await runJobStatus(rest, config)
    return
  }

  if (command === 'sources' && subcommand === 'list') {
    await runSourcesList(config)
    return
  }

  process.stderr.write(`Unknown command: ${command} ${subcommand ?? ''}\n${HELP}`)
  process.exitCode = 1
}

async function runSourceTest(argv: string[], config: ReturnType<typeof loadConfig>): Promise<void> {
  const sourceKey = argv[0]
  if (!sourceKey) {
    process.stderr.write('Usage: source test <key> [options]\n')
    process.exitCode = 1
    return
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      country: { type: 'string' },
      city: { type: 'string' },
      lat: { type: 'string' },
      lon: { type: 'string' },
      radius: { type: 'string' },
      'website-url': { type: 'string' },
      'instagram-handle': { type: 'string' },
      'max-candidates': { type: 'string' },
    },
  })

  const sources = buildSourceRegistry(config)
  const adapter = sources.get(sourceKey)
  if (!adapter) {
    process.stderr.write(`Unknown source key: ${sourceKey}. Known: ${Array.from(sources.keys()).join(', ')}\n`)
    process.exitCode = 1
    return
  }

  if (!adapter.isConfigured()) {
    process.stdout.write(`[${sourceKey}] not configured — missing required credential in infra/worker/.env.worker. Skipping (this is expected, not an error).\n`)
    return
  }

  const query: DiscoveryQuery = {
    country: values.country ?? config.DEFAULT_COUNTRY,
    city: values.city,
    latitude: values.lat ? Number(values.lat) : undefined,
    longitude: values.lon ? Number(values.lon) : undefined,
    radiusKm: values.radius ? Number(values.radius) : undefined,
    websiteUrl: values['website-url'],
    instagramHandle: values['instagram-handle'],
    maxCandidates: values['max-candidates'] ? Number(values['max-candidates']) : 5,
  }

  process.stdout.write(`[${sourceKey}] running live query: ${JSON.stringify({ ...query })}\n`)

  try {
    const results = await adapter.discover(query, { jobId: null, logger: logger.child({ cli: true, source: sourceKey }) })
    process.stdout.write(`[${sourceKey}] OK — ${results.length} candidate(s):\n`)
    for (const r of results.slice(0, 10)) {
      process.stdout.write(`  - ${r.name ?? '(no name)'} | ${r.externalType}:${r.externalId} | confidence=${r.confidence}\n`)
    }
  } catch (error) {
    process.stderr.write(`[${sourceKey}] FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

async function runJobCreate(argv: string[], config: ReturnType<typeof loadConfig>): Promise<void> {
  const jobType = argv[0]
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      payload: { type: 'string' },
      priority: { type: 'string' },
      sources: { type: 'string' },
    },
  })

  if (!jobType || !values.payload) {
    process.stderr.write("Usage: job create <type> --payload '<json>' [--priority N] [--sources osm,geoapify]\n")
    process.exitCode = 1
    return
  }

  // Direct INSERT as prospect_worker, NOT the public.create_prospect_discovery_job
  // RPC — that RPC is deliberately gated to platform_owner/platform_admin
  // via PostgREST (see db/migrations/20260811150200_prospect_job_queue.sql),
  // which this CLI's direct psql connection as prospect_worker is not. The
  // CLI uses prospect_worker's own legitimate direct-write grant on
  // prospect_jobs/prospect_job_sources instead (same tables, same shape,
  // just a different — equally real — write path for local/dev use).
  const pool = getPool(config)
  try {
    const jobResult = await pool.query<{ id: string; status: string }>(
      `insert into public.prospect_jobs (job_type, payload, priority)
       values ($1, $2, $3)
       returning id, status`,
      [jobType, values.payload, values.priority ? Number(values.priority) : 100],
    )
    const job = jobResult.rows[0]
    if (!job) throw new Error('insert returned no row')

    const sourceKeys = values.sources ? values.sources.split(',') : null
    await pool.query(
      `insert into public.prospect_job_sources (job_id, source_id, status)
       select $1, id, case when is_enabled then 'pending' else 'skipped' end::public.prospect_job_source_status
       from public.prospect_sources
       where $2::text[] is null or key = any($2::text[])`,
      [job.id, sourceKeys],
    )

    process.stdout.write(`Created job ${job.id} (status: ${job.status})\n`)
  } finally {
    await closePool()
  }
}

async function runJobStatus(argv: string[], config: ReturnType<typeof loadConfig>): Promise<void> {
  const jobId = argv[0]
  if (!jobId) {
    process.stderr.write('Usage: job status <job-id>\n')
    process.exitCode = 1
    return
  }

  const pool = getPool(config)
  try {
    const result = await pool.query('select job_type, status, attempts, max_attempts, last_error, result from public.prospect_jobs where id = $1', [jobId])
    if (result.rows.length === 0) {
      process.stdout.write('Job not found.\n')
      return
    }
    process.stdout.write(JSON.stringify(result.rows[0], null, 2) + '\n')
  } finally {
    await closePool()
  }
}

async function runSourcesList(config: ReturnType<typeof loadConfig>): Promise<void> {
  const sources = buildSourceRegistry(config)
  for (const [key, adapter] of sources) {
    process.stdout.write(`${key.padEnd(16)} ${adapter.displayName.padEnd(32)} configured=${adapter.isConfigured()}\n`)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`CLI error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
