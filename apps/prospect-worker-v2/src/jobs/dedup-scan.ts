import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { ProspectJob } from '../queue/types.js'
import { findFuzzyCandidates, recordDuplicateCandidate } from '../dedupe/candidates.js'

export interface DedupScanJobResult {
  prospectsScanned: number
  candidatesFound: number
}

/**
 * Sweeps recently-touched prospects for fuzzy duplicate candidates against
 * the rest of the table — covers the case where two prospects were
 * created far apart in time (different discovery jobs, possibly weeks
 * apart) and so never got a chance to be compared against each other
 * during a single discovery run's per-candidate check.
 */
export async function runDedupScanJob(pool: DbPool, job: ProspectJob, log: Logger): Promise<DedupScanJobResult> {
  const payload = job.payload as { sinceHours?: number; limit?: number }
  const sinceHours = payload.sinceHours ?? 24
  const limit = Math.min(payload.limit ?? 200, 1000)

  const result = await pool.query<{ id: string; canonical_name: string; latitude: number | null; longitude: number | null }>(
    `select p.id, p.canonical_name, pl.latitude, pl.longitude
     from public.prospects p
     join public.prospect_locations pl on pl.prospect_id = p.id and pl.is_primary
     where p.created_at > now() - make_interval(hours => $1)
     order by p.created_at desc
     limit $2`,
    [sinceHours, limit],
  )

  let candidatesFound = 0
  for (const row of result.rows) {
    const fuzzy = await findFuzzyCandidates(pool, row.id, row.canonical_name, row.latitude, row.longitude)
    for (const candidate of fuzzy) {
      await recordDuplicateCandidate(pool, row.id, candidate)
      candidatesFound++
    }
  }

  log.info('dedup scan complete', { prospects_scanned: result.rows.length, candidates_found: candidatesFound })
  return { prospectsScanned: result.rows.length, candidatesFound }
}
