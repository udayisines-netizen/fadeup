import type { DbPool } from '../db.js'
import type { ProspectJob } from './types.js'

interface JobRow {
  id: string
  job_type: string
  status: string
  priority: number
  payload: Record<string, unknown>
  result: Record<string, unknown>
  attempts: number
  max_attempts: number
  scheduled_at: string
  worker_id: string | null
  lease_until: string | null
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  last_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function mapJob(row: JobRow): ProspectJob {
  return {
    id: row.id,
    jobType: row.job_type as ProspectJob['jobType'],
    status: row.status as ProspectJob['status'],
    priority: row.priority,
    payload: row.payload,
    result: row.result,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    workerId: row.worker_id,
    leaseUntil: row.lease_until,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * All of these are thin wrappers around the `private.*` SQL functions in
 * db/migrations/20260811150200_prospect_job_queue.sql — the atomicity
 * (FOR UPDATE SKIP LOCKED, the retryable-vs-terminal decision, the
 * worker_id ownership check on complete/fail) lives in the database, not
 * here, so it holds regardless of how many Worker processes call it
 * concurrently. This module is a typed, testable seam over that SQL, not
 * a second copy of its logic.
 */

export async function claimNextJob(pool: DbPool, workerId: string, leaseSeconds: number): Promise<ProspectJob | null> {
  const result = await pool.query<JobRow>('select * from private.claim_next_prospect_job($1, $2)', [workerId, leaseSeconds])
  const row = result.rows[0]
  if (!row || row.id === null) return null
  return mapJob(row)
}

export async function extendLease(pool: DbPool, jobId: string, workerId: string, leaseSeconds: number): Promise<ProspectJob | null> {
  const result = await pool.query<JobRow>('select * from private.extend_prospect_job_lease($1, $2, $3)', [jobId, workerId, leaseSeconds])
  const row = result.rows[0]
  if (!row || row.id === null) return null
  return mapJob(row)
}

export async function completeJob(pool: DbPool, jobId: string, workerId: string, result: Record<string, unknown>): Promise<ProspectJob | null> {
  const res = await pool.query<JobRow>('select * from private.complete_prospect_job($1, $2, $3)', [jobId, workerId, JSON.stringify(result)])
  const row = res.rows[0]
  if (!row || row.id === null) return null
  return mapJob(row)
}

export async function failJob(
  pool: DbPool,
  jobId: string,
  workerId: string,
  error: string,
  retryable: boolean,
  nextAttemptAt?: Date,
): Promise<ProspectJob | null> {
  const res = await pool.query<JobRow>('select * from private.fail_prospect_job($1, $2, $3, $4, $5)', [
    jobId,
    workerId,
    error,
    retryable,
    nextAttemptAt ?? null,
  ])
  const row = res.rows[0]
  if (!row || row.id === null) return null
  return mapJob(row)
}

export async function recoverStaleLeases(pool: DbPool): Promise<number> {
  const result = await pool.query<{ recover_stale_prospect_job_leases: number }>('select public.recover_stale_prospect_job_leases()')
  return result.rows[0]?.recover_stale_prospect_job_leases ?? 0
}
