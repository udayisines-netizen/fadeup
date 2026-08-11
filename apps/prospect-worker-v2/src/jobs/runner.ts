import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { SourceAdapter } from '../sources/registry.js'
import type { ProspectJob } from '../queue/types.js'
import { runDiscoveryJob } from './discovery.js'
import { runEnrichmentJob } from './enrichment.js'
import { runDedupScanJob } from './dedup-scan.js'
import { runScoringJob } from './scoring.js'

/** Dispatches a claimed job to its handler by job_type. Every handler returns a plain JSON-serializable result object, stored verbatim in prospect_jobs.result. */
export async function runJob(pool: DbPool, job: ProspectJob, sources: Map<string, SourceAdapter>, log: Logger): Promise<Record<string, unknown>> {
  switch (job.jobType) {
    case 'discovery':
      return { ...(await runDiscoveryJob(pool, job, sources, log)) }
    case 'enrichment':
    case 'website_crawl':
    case 'instagram_enrich':
      return { ...(await runEnrichmentJob(pool, job, sources, log)) }
    case 'dedup_scan':
      return { ...(await runDedupScanJob(pool, job, log)) }
    case 'scoring':
      return { ...(await runScoringJob(pool, job, log)) }
    default: {
      const exhaustive: never = job.jobType
      throw new Error(`unknown job_type: ${String(exhaustive)}`)
    }
  }
}
