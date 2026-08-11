import type { DbPool } from './db.js'

/**
 * Quota guard: the Worker MUST call `isSourcePaused` before every provider
 * request and `recordApiUsage` after every one (success or failure). Both
 * are thin wrappers over `private.*` SQL functions
 * (db/migrations/20260811150200_prospect_job_queue.sql) — the actual
 * budget bookkeeping (daily/monthly counters, lazy rollover, is_paused)
 * lives in the database so it is correct across multiple Worker processes
 * sharing one Postgres instance, not just within a single process.
 */

export async function isSourcePaused(pool: DbPool, sourceKey: string): Promise<boolean> {
  const result = await pool.query<{ is_prospect_source_paused: boolean }>('select private.is_prospect_source_paused($1)', [sourceKey])
  return result.rows[0]?.is_prospect_source_paused ?? true
}

export interface RecordApiUsageInput {
  sourceKey: string
  jobId: string | null
  endpoint: string
  success: boolean
  statusCode?: number
  latencyMs: number
  error?: string
}

export async function recordApiUsage(pool: DbPool, input: RecordApiUsageInput): Promise<void> {
  await pool.query('select private.record_api_usage($1, $2, $3, $4, $5, $6, $7)', [
    input.sourceKey,
    input.jobId,
    input.endpoint,
    input.success,
    input.statusCode ?? null,
    input.latencyMs,
    input.error ?? null,
  ])
}

/** Wraps a single provider call: pause-check, timing, and usage recording — every adapter request should go through this rather than calling fetch directly. */
export async function withQuotaGuard<T>(
  pool: DbPool,
  opts: { sourceKey: string; jobId: string | null; endpoint: string },
  fn: () => Promise<{ value: T; statusCode?: number }>,
): Promise<T> {
  if (await isSourcePaused(pool, opts.sourceKey)) {
    throw new SourcePausedError(opts.sourceKey)
  }

  const startedAt = Date.now()
  try {
    const { value, statusCode } = await fn()
    await recordApiUsage(pool, {
      sourceKey: opts.sourceKey,
      jobId: opts.jobId,
      endpoint: opts.endpoint,
      success: true,
      statusCode,
      latencyMs: Date.now() - startedAt,
    })
    return value
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : undefined
    await recordApiUsage(pool, {
      sourceKey: opts.sourceKey,
      jobId: opts.jobId,
      endpoint: opts.endpoint,
      success: false,
      statusCode,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export class SourcePausedError extends Error {
  constructor(public readonly sourceKey: string) {
    super(`source "${sourceKey}" is paused (manual pause or quota exhausted) — skipping`)
    this.name = 'SourcePausedError'
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
