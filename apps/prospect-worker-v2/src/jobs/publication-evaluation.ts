import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { ProspectJob } from '../queue/types.js'

/**
 * Keeps public.prospect_publication_eligibility current.
 *
 * THE WORKER EVALUATES. IT DOES NOT PUBLISH.
 *
 * This handler is the Worker's entire involvement in the publication stage of
 * the acquisition pipeline. It refreshes a cache; a platform administrator
 * makes the decision through public.publish_external_professional, which the
 * Worker has no EXECUTE grant on and which R4's hardening migration asserts it
 * cannot acquire by accident.
 *
 * That division is deliberate rather than incidental. Minting an external
 * identity is durable, publicly-facing and claimable, and Constitution §5.3
 * prefers an unresolved candidate to a resolution taken on insufficient
 * confidence. A batch job that published everything passing a threshold would
 * be exactly that resolution, taken thousands of times, with nobody looking.
 *
 * WHY THE SWEEP RE-EVALUATES BLOCKED PROSPECTS TOO
 *
 * The interesting transitions are almost all blocked -> eligible: a duplicate
 * candidate gets reviewed, a second source lands on a prospect that only OSM
 * had seen, a crawl finds the website that satisfies the corroboration rule.
 * None of those events touch the eligibility row, so if the sweep only looked
 * at unevaluated prospects the queue would fill once and then go quiet while
 * real candidates piled up behind stale verdicts.
 *
 * ALL OF THE LOGIC LIVES IN SQL
 *
 * The gate is public.publication_block_reason and the batch driver is
 * public.sweep_prospect_publication_eligibility. This file does not re-derive
 * either, and deliberately holds no copy of the rules: a second implementation
 * in TypeScript would be a second answer to "may this be published", and the
 * one that matters is the one the BEFORE INSERT trigger consults.
 */

export interface PublicationEvaluationJobResult {
  evaluated: number
  eligible: number
  blocked: number
  /** Targeted mode only: requested ids that no longer resolve to a prospect. Always 0 for a sweep. */
  skippedMissing: number
  /** Blocked counts by reason, so a run that evaluates 500 and publishes none says WHY. */
  blockReasons: Record<string, number>
}

interface EvaluationRow {
  prospect_id: string
  is_eligible: boolean
  block_reason: string | null
}

/** Matches the hard cap in public.sweep_prospect_publication_eligibility, which raises 22023 outside it. */
const MAX_BATCH = 1000
const DEFAULT_BATCH = 100

export async function runPublicationEvaluationJob(
  pool: DbPool,
  job: ProspectJob,
  log: Logger,
): Promise<PublicationEvaluationJobResult> {
  const payload = job.payload as { prospectIds?: string[]; limit?: number }

  let rows: EvaluationRow[]

  // Only meaningful in targeted mode: the count of requested ids that no longer
  // resolve to a prospect. In sweep mode the driver returns what exists, so a
  // short batch is not a skip and reporting one would invent a problem.
  let targetedRequested: number | null = null

  if (payload.prospectIds && payload.prospectIds.length > 0) {
    // Targeted mode: re-evaluate exactly these, used when something upstream
    // knows it changed the answer — a duplicate resolution, a suppression, a
    // fresh crawl. Capped like the sweep so a payload cannot become a table
    // scan of function calls.
    const ids = payload.prospectIds.slice(0, MAX_BATCH)
    targetedRequested = ids.length

    // The inner join against prospects is load-bearing, not defensive tidiness:
    // refresh_prospect_publication_eligibility raises 42704 for an id that no
    // longer exists, and a prospect deleted between this job being enqueued and
    // being claimed is ordinary. Without the join one stale id would fail the
    // whole batch, retry, fail identically, and eventually park the job as
    // `failed` — turning routine churn into an operator alert. Skipped ids are
    // counted and reported rather than silently dropped.
    const result = await pool.query<EvaluationRow>(
      `select r.prospect_id, r.is_eligible, r.block_reason
       from unnest($1::uuid[]) as t(id)
       join public.prospects p on p.id = t.id,
       lateral public.refresh_prospect_publication_eligibility(p.id) as r`,
      [ids],
    )
    rows = result.rows
  } else {
    // Sweep mode: least recently evaluated first, never-evaluated first of all.
    const limit = clampBatch(payload.limit)
    const result = await pool.query<EvaluationRow>(
      'select prospect_id, is_eligible, block_reason from public.sweep_prospect_publication_eligibility($1)',
      [limit],
    )
    rows = result.rows
  }

  const blockReasons: Record<string, number> = {}
  let eligible = 0

  for (const row of rows) {
    if (row.is_eligible) {
      eligible += 1
      continue
    }
    // `unknown` cannot occur — the table's check constraint makes
    // is_eligible = (block_reason is null) unrepresentable otherwise — but a
    // count that silently vanished would be worse than one labelled honestly.
    const reason = row.block_reason ?? 'unknown'
    blockReasons[reason] = (blockReasons[reason] ?? 0) + 1
  }

  const result: PublicationEvaluationJobResult = {
    evaluated: rows.length,
    eligible,
    blocked: rows.length - eligible,
    skippedMissing: targetedRequested === null ? 0 : targetedRequested - rows.length,
    blockReasons,
  }

  log.info('publication_evaluation complete', { ...result })
  return result
}

function clampBatch(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_BATCH
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  if (floored > MAX_BATCH) return MAX_BATCH
  return floored
}
