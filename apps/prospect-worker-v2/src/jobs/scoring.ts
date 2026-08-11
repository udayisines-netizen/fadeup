import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { ProspectJob } from '../queue/types.js'
import { scoreProspect } from './discovery.js'

export interface ScoringJobResult {
  prospectsScored: number
}

/** Recomputes scores for every prospect whose current_score is stale relative to their latest prospect_scores row, or for an explicit list of prospect_ids in the job payload. Deterministic — same inputs always produce the same score/factors (see src/scoring/score.ts). */
export async function runScoringJob(pool: DbPool, job: ProspectJob, log: Logger): Promise<ScoringJobResult> {
  const payload = job.payload as { prospectIds?: string[] }

  let ids: string[]
  if (payload.prospectIds && payload.prospectIds.length > 0) {
    ids = payload.prospectIds
  } else {
    const result = await pool.query<{ id: string }>(
      `select id from public.prospects
       where current_score is null
          or updated_at > coalesce((select max(scored_at) from public.prospect_scores where prospect_id = prospects.id), 'epoch'::timestamptz)
       limit 500`,
    )
    ids = result.rows.map((r) => r.id)
  }

  for (const id of ids) {
    await scoreProspect(pool, id)
  }

  log.info('scoring job complete', { prospects_scored: ids.length })
  return { prospectsScored: ids.length }
}
