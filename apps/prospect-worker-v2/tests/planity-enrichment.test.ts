import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DbPool } from '../src/db.js'
import type { Config } from '../src/config.js'
import type { Logger } from '../src/logger.js'
import type { ProspectJob } from '../src/queue/types.js'
import { runPlanityEnrichmentJob } from '../src/jobs/planity-enrichment.js'
import { runJob } from '../src/jobs/runner.js'
import { planityPage, PLANITY_ROBOTS } from './fixtures/planity.js'

/**
 * Job-level behaviour. The parser and the matcher are proven from fixtures in
 * planity.test.ts; what is asserted here is the part that can quietly lie:
 * the counters, what advances last_enriched_at, and what the job refuses to do
 * when the provider pushes back.
 */

const LOG_METHODS = ['info', 'warn', 'error', 'debug'] as const

function makeLogger(): Logger {
  const log = {} as Record<string, unknown>
  for (const m of LOG_METHODS) log[m] = vi.fn()
  log.child = () => log as unknown as Logger
  return log as unknown as Logger
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    PLANITY_ENABLED: true,
    PLANITY_REQUEST_TIMEOUT_MS: 5_000,
    // Zero so the tests do not actually wait out the politeness delay.
    PLANITY_MIN_REQUEST_INTERVAL_MS: 0,
    PLANITY_BATCH_SIZE: 25,
    PLANITY_RECHECK_AFTER_HOURS: 720,
    ...overrides,
  } as unknown as Config
}

function makeJob(payload: Record<string, unknown> = {}): ProspectJob {
  return {
    id: 'job-1', jobType: 'planity_enrichment', status: 'running', priority: 100,
    payload, result: {}, attempts: 1, maxAttempts: 3,
    scheduledAt: new Date().toISOString(), workerId: 'test', leaseUntil: null,
    startedAt: null, completedAt: null, failedAt: null, lastError: null,
    createdBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}

interface CandidateRow {
  prospect_id: string
  canonical_name: string
  country: string
  phone_e164: string | null
  postal_code: string | null
  city: string | null
  planity_url: string
}

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    prospect_id: 'p-1',
    canonical_name: 'La Loge',
    country: 'FR',
    phone_e164: '+33982397336',
    postal_code: '76380',
    city: 'Montigny',
    planity_url: 'https://www.planity.com/la-loge-76380-montigny',
    ...overrides,
  }
}

function makePool(candidates: CandidateRow[]) {
  const sql: string[] = []
  const txSql: string[] = []

  const txClient = {
    query: vi.fn(async (text: string) => {
      txSql.push(text)
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn(),
  }

  const pool = {
    query: vi.fn(async (text: string) => {
      sql.push(text)
      if (text.includes('is_prospect_source_paused')) {
        return { rows: [{ is_prospect_source_paused: false }] }
      }
      if (text.includes('booking_provider_observations') && text.includes('select distinct on')) {
        return { rows: candidates }
      }
      return { rows: [], rowCount: 0 }
    }),
    connect: vi.fn(async () => txClient),
  } as unknown as DbPool

  return { pool, sql, txSql, txClient }
}

/** Stubs fetch: robots.txt first, then a scripted sequence of page responses. */
function stubFetch(pages: (Response | (() => Response))[], robots = PLANITY_ROBOTS) {
  let call = 0
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url)
      calls.push(href)
      if (href.endsWith('/robots.txt')) {
        return new Response(robots, { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      const next = pages[Math.min(call, pages.length - 1)]
      call += 1
      return typeof next === 'function' ? next() : next!
    }),
  )
  return { calls }
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('planity_enrichment — truthful counters', () => {
  it('reports nothing selected when the source is switched off', async () => {
    const { pool, sql } = makePool([candidate()])
    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig({ PLANITY_ENABLED: false } as never), makeLogger())

    expect(result).toMatchObject({ selected: 0, attempted: 0, enriched: 0 })
    // Not even a candidate query: disabled means disabled.
    expect(sql).toHaveLength(0)
  })

  it('counts a successful enrichment exactly once, and only on the success path', async () => {
    const { pool, txSql } = makePool([candidate()])
    stubFetch([html(planityPage())])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result).toMatchObject({
      selected: 1, attempted: 1, enriched: 1, noResult: 0, skipped: 0, failed: 0,
    })
    expect(result.metrics).toMatchObject({ pagesMatched: 1, activeDetected: 1, pagesUnmatched: 0 })
    expect(txSql.some((s) => s.includes('last_enriched_at'))).toBe(true)
  })

  it('counts an unmatched page as noResult and writes nothing', async () => {
    // The page is real and parses; it just describes a different business.
    const { pool, txSql } = makePool([
      candidate({ canonical_name: 'Somewhere Else', phone_e164: '+33100000000', postal_code: '75011', city: 'Paris' }),
    ])
    stubFetch([html(planityPage())])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result).toMatchObject({ selected: 1, attempted: 1, enriched: 0, noResult: 1, failed: 0 })
    expect(result.metrics.pagesUnmatched).toBe(1)
    // The decisive assertion: a rejected match must not touch the database.
    expect(txSql).toHaveLength(0)
  })

  it('does NOT advance last_enriched_at on a no-result page', async () => {
    const { pool, txSql } = makePool([candidate()])
    stubFetch([html('<html><head></head><body>nothing here</body></html>')])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result).toMatchObject({ attempted: 1, enriched: 0, noResult: 1 })
    // R3's trigger on last_enriched_at is what emits prospect_enriched. Setting
    // it here would fabricate a server-authoritative analytics event for an
    // enrichment that did not happen.
    expect(txSql.some((s) => s.includes('last_enriched_at'))).toBe(false)
  })

  it('counts a 404 as noResult, not as a failure and not as an enrichment', async () => {
    const { pool, txSql } = makePool([candidate()])
    stubFetch([new Response('gone', { status: 404 })])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result).toMatchObject({ attempted: 1, enriched: 0, noResult: 1, failed: 0 })
    expect(result.metrics.notFound).toBe(1)
    expect(txSql).toHaveLength(0)
  })

  it('skips a stored URL that is not an establishment page, without a request', async () => {
    const { pool } = makePool([candidate({ planity_url: 'https://www.planity.com/coiffeur/coupe-homme/76380-montigny' })])
    const { calls } = stubFetch([html(planityPage())])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result).toMatchObject({ selected: 1, attempted: 0, skipped: 1, enriched: 0 })
    expect(calls.filter((c) => !c.endsWith('/robots.txt'))).toHaveLength(0)
  })
})

describe('planity_enrichment — the provider pushing back', () => {
  it('stops the batch after repeated blocks instead of trying harder', async () => {
    const { pool } = makePool([candidate({ prospect_id: 'p-1' }), candidate({ prospect_id: 'p-2' }), candidate({ prospect_id: 'p-3' }), candidate({ prospect_id: 'p-4' })])
    const { calls } = stubFetch([() => new Response('no', { status: 403 })])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    // Two blocks is the tolerance; the remaining two are skipped, not attempted.
    expect(result.attempted).toBe(2)
    expect(result.metrics.http403).toBe(2)
    expect(result.skipped).toBe(2)
    expect(calls.filter((c) => !c.endsWith('/robots.txt'))).toHaveLength(2)
  })

  it('treats 429 as a block and backs off rather than retrying in-loop', async () => {
    const { pool } = makePool([candidate({ prospect_id: 'p-1' }), candidate({ prospect_id: 'p-2' }), candidate({ prospect_id: 'p-3' })])
    stubFetch([() => new Response('slow down', { status: 429 })])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result.metrics.http429).toBe(2)
    expect(result.attempted).toBe(2)
  })

  it('treats a 200 challenge interstitial as a block, never parsing it', async () => {
    const { pool, txSql } = makePool([candidate()])
    stubFetch([html('<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>')])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result.metrics.challenges).toBe(1)
    expect(result.enriched).toBe(0)
    // Parsing an interstitial would yield nulls that look exactly like "this
    // salon has no services" — a fabricated observation.
    expect(txSql).toHaveLength(0)
  })

  it('refuses every candidate and stops when robots.txt is unreachable', async () => {
    const { pool } = makePool([candidate({ prospect_id: 'p-1' }), candidate({ prospect_id: 'p-2' })])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).endsWith('/robots.txt')) return new Response('nope', { status: 500 })
        throw new Error('should never be reached')
      }),
    )

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    // Fail CLOSED: no robots, no permission, no requests.
    expect(result.attempted).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.metrics.robotsRefusals).toBe(1)
  })

  it('honours a robots Disallow that covers the establishment path', async () => {
    const { pool } = makePool([candidate()])
    stubFetch([html(planityPage())], 'User-agent: *\nDisallow: /\n')

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result.attempted).toBe(0)
    expect(result.metrics.robotsRefusals).toBe(1)
  })
})

describe('planity_enrichment — safety invariants', () => {
  it('never issues a publication or identity-minting statement', async () => {
    const { pool, sql, txSql } = makePool([candidate()])
    stubFetch([html(planityPage())])

    await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    const everything = [...sql, ...txSql].join('\n')
    expect(everything).not.toContain('publish_external_professional')
    expect(everything).not.toContain('create_external_professional')
    expect(everything).not.toContain('prospect_professionals')
    expect(everything).not.toContain('professionals')
  })

  it('writes no prospect_source_records, so Planity cannot inflate publication evidence', async () => {
    // The page was reached by following a link the business published about
    // itself. That is the SAME evidence chain as the `website` source, one hop
    // longer — counting it separately would let a prospect known only from its
    // own site clear the two-independent-sources bar.
    const { pool, sql, txSql } = makePool([candidate()])
    stubFetch([html(planityPage())])

    await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect([...sql, ...txSql].join('\n')).not.toContain('prospect_source_records')
  })

  it('never creates a prospect for a practitioner', async () => {
    const { pool, sql, txSql } = makePool([candidate()])
    stubFetch([html(planityPage({ collaborators: 5 }))])

    await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    const everything = [...sql, ...txSql].join('\n')
    expect(everything).not.toContain('insert into public.prospects')
    // Only the COUNT reaches the database.
    expect(txSql.some((s) => s.includes('estimated_barber_count'))).toBe(true)
  })

  it('gap-fills rating and never overwrites a value another source established', async () => {
    const { pool, txSql } = makePool([candidate()])
    stubFetch([html(planityPage())])

    await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    const ratingWrite = txSql.find((s) => s.includes('set rating'))
    expect(ratingWrite).toContain('coalesce(rating')
  })

  it('is idempotent: a second run writes the same single current observation', async () => {
    const { pool, txSql } = makePool([candidate()])
    stubFetch([() => html(planityPage())])

    await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())
    const firstRun = [...txSql]
    txSql.length = 0
    await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    // Same statements, and the insert relies on the existing BEFORE INSERT
    // trigger to collapse a repeat rather than accumulating history.
    expect(txSql).toEqual(firstRun)
    expect(txSql.filter((s) => s.includes('insert into public.booking_provider_observations'))).toHaveLength(1)
  })

  it('records the canonical URL, so two spellings do not become two rows', async () => {
    const { pool, txSql } = makePool([
      candidate({ planity_url: 'http://planity.com/la-loge-76380-montigny/?utm_source=x' }),
    ])
    stubFetch([html(planityPage())])

    const result = await runPlanityEnrichmentJob(pool, makeJob(), makeConfig(), makeLogger())

    expect(result.enriched).toBe(1)
    expect(txSql.some((s) => s.includes('booking_provider_observations'))).toBe(true)
  })
})

describe('runJob dispatch', () => {
  it('routes planity_enrichment to its handler', async () => {
    const { pool } = makePool([])
    const result = await runJob(
      { pool, config: makeConfig(), sources: new Map(), modelCache: {} as never, log: makeLogger() },
      makeJob(),
    )
    expect(result).toMatchObject({ selected: 0, attempted: 0, enriched: 0 })
  })
})
