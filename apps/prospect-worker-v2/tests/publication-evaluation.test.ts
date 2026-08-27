import { describe, expect, it, vi } from 'vitest'
import type { DbPool } from '../src/db.js'
import type { Logger } from '../src/logger.js'
import type { ProspectJob } from '../src/queue/types.js'
import { runPublicationEvaluationJob } from '../src/jobs/publication-evaluation.js'
import { runJob } from '../src/jobs/runner.js'

/**
 * These tests pin the two properties that make the publication stage safe, and
 * they are deliberately about what the Worker does NOT do:
 *
 *   1. it never calls a publishing function, on any code path;
 *   2. it never re-implements the eligibility rules, so there is exactly one
 *      answer to "may this be published" and the database owns it.
 *
 * The gate itself — every block reason, the trigger that cannot be bypassed —
 * is proven in SQL by VERIFY_R4, against a real database. Asserting rules here
 * would be asserting a mock.
 */

const NOISY_LOG_METHODS = ['info', 'warn', 'error', 'debug'] as const

function makeLogger(): Logger {
  const log = {} as Record<string, unknown>
  for (const method of NOISY_LOG_METHODS) log[method] = vi.fn()
  log.child = () => log as unknown as Logger
  return log as unknown as Logger
}

function makeJob(payload: Record<string, unknown>): ProspectJob {
  return {
    id: 'job-1',
    jobType: 'publication_evaluation',
    status: 'running',
    priority: 100,
    payload,
    result: {},
    attempts: 1,
    maxAttempts: 3,
    scheduledAt: new Date().toISOString(),
    workerId: 'test',
    leaseUntil: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    lastError: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

interface EvalRow {
  prospect_id: string
  is_eligible: boolean
  block_reason: string | null
}

function makePool(rows: EvalRow[]) {
  const sql: string[] = []
  const params: unknown[][] = []
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      sql.push(text)
      params.push(values ?? [])
      return { rows, rowCount: rows.length }
    }),
  } as unknown as DbPool
  return { pool, sql, params }
}

describe('publication_evaluation — the Worker evaluates and never publishes', () => {
  it('uses the SQL sweep, not a re-implementation of the rules', async () => {
    const { pool, sql } = makePool([
      { prospect_id: 'p1', is_eligible: true, block_reason: null },
    ])

    await runPublicationEvaluationJob(pool, makeJob({}), makeLogger())

    expect(sql).toHaveLength(1)
    expect(sql[0]).toContain('sweep_prospect_publication_eligibility')
  })

  it('never issues a publishing statement, whichever mode it runs in', async () => {
    for (const payload of [{}, { prospectIds: ['p1'] }, { limit: 250 }]) {
      const { pool, sql } = makePool([])
      await runPublicationEvaluationJob(pool, makeJob(payload), makeLogger())

      const everything = sql.join('\n')
      expect(everything).not.toContain('publish_external_professional')
      expect(everything).not.toContain('create_external_professional')
      expect(everything).not.toContain('prospect_professionals')
    }
  })

  it('routes an explicit id list through the targeted refresh', async () => {
    const { pool, sql, params } = makePool([
      { prospect_id: 'p1', is_eligible: false, block_reason: 'unresolved_duplicate' },
    ])

    await runPublicationEvaluationJob(pool, makeJob({ prospectIds: ['p1', 'p2'] }), makeLogger())

    expect(sql[0]).toContain('refresh_prospect_publication_eligibility')
    expect(params[0]?.[0]).toEqual(['p1', 'p2'])
  })

  it('reports blocked prospects by reason rather than as a bare total', async () => {
    const { pool } = makePool([
      { prospect_id: 'a', is_eligible: true, block_reason: null },
      { prospect_id: 'b', is_eligible: false, block_reason: 'insufficient_source_evidence' },
      { prospect_id: 'c', is_eligible: false, block_reason: 'insufficient_source_evidence' },
      { prospect_id: 'd', is_eligible: false, block_reason: 'unresolved_duplicate' },
    ])

    const result = await runPublicationEvaluationJob(pool, makeJob({}), makeLogger())

    expect(result).toMatchObject({
      evaluated: 4,
      eligible: 1,
      blocked: 3,
      skippedMissing: 0,
      blockReasons: {
        insufficient_source_evidence: 2,
        unresolved_duplicate: 1,
      },
    })
  })

  it('counts ids that no longer resolve to a prospect instead of failing the batch', async () => {
    // The SQL joins against prospects, so a deleted id simply returns no row.
    // A prospect deleted between enqueue and claim is ordinary churn; failing
    // the whole job over one would turn it into an operator alert.
    const { pool } = makePool([
      { prospect_id: 'alive', is_eligible: true, block_reason: null },
    ])

    const result = await runPublicationEvaluationJob(
      pool,
      makeJob({ prospectIds: ['alive', 'deleted-1', 'deleted-2'] }),
      makeLogger(),
    )

    expect(result.evaluated).toBe(1)
    expect(result.skippedMissing).toBe(2)
  })

  it('reports no skips for a short sweep, because a short sweep is not a skip', async () => {
    const { pool } = makePool([
      { prospect_id: 'a', is_eligible: true, block_reason: null },
    ])

    const result = await runPublicationEvaluationJob(pool, makeJob({ limit: 500 }), makeLogger())

    expect(result.evaluated).toBe(1)
    expect(result.skippedMissing).toBe(0)
  })
})

describe('publication_evaluation — the batch bound the SQL function enforces', () => {
  // public.sweep_prospect_publication_eligibility raises 22023 outside 1..1000.
  // Clamping here means an operator typo is a smaller batch, not a failed job;
  // the SQL cap remains the actual guarantee.
  it.each([
    { requested: undefined, expected: 100 },
    { requested: 0, expected: 1 },
    { requested: -5, expected: 1 },
    { requested: 50, expected: 50 },
    { requested: 1000, expected: 1000 },
    { requested: 99_999, expected: 1000 },
    { requested: 12.7, expected: 12 },
    { requested: Number.NaN, expected: 100 },
  ])('clamps limit $requested to $expected', async ({ requested, expected }) => {
    const { pool, params } = makePool([])
    const payload = requested === undefined ? {} : { limit: requested }

    await runPublicationEvaluationJob(pool, makeJob(payload), makeLogger())

    expect(params[0]?.[0]).toBe(expected)
  })

  it('truncates an oversized explicit id list to the same cap', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `p${i}`)
    const { pool, params } = makePool([])

    await runPublicationEvaluationJob(pool, makeJob({ prospectIds: ids }), makeLogger())

    expect((params[0]?.[0] as string[]).length).toBe(1000)
  })
})

describe('runJob dispatch', () => {
  it('routes publication_evaluation to its handler', async () => {
    const { pool, sql } = makePool([])

    const result = await runJob(
      {
        pool,
        config: {} as never,
        sources: new Map(),
        modelCache: {} as never,
        log: makeLogger(),
      },
      makeJob({}),
    )

    expect(sql[0]).toContain('sweep_prospect_publication_eligibility')
    expect(result).toMatchObject({ evaluated: 0, eligible: 0, blocked: 0 })
  })
})
