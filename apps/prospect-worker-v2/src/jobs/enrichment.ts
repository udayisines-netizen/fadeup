import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { SourceAdapter } from '../sources/registry.js'
import type { ProspectJob } from '../queue/types.js'
import { runEnrichmentPass, scoreProspect } from './discovery.js'

export interface EnrichmentJobResult {
  prospectsProcessed: number
}

/**
 * Standalone enrichment/website_crawl/instagram_enrich job types — unlike
 * discovery's built-in enrichment pass (which only touches prospects the
 * SAME job just created), this re-runs enrichment against an EXISTING set
 * of prospects on demand, e.g. "re-crawl every prospect whose website
 * enrichment is older than 30 days" or "try Instagram enrichment again
 * now that credentials were configured."
 */
export async function runEnrichmentJob(
  pool: DbPool,
  job: ProspectJob,
  sources: Map<string, SourceAdapter>,
  log: Logger,
): Promise<EnrichmentJobResult> {
  const payload = job.payload as { prospectIds?: string[]; limit?: number }
  const limit = Math.min(payload.limit ?? 200, 1000)

  const sourceKey = job.jobType === 'website_crawl' ? 'website' : job.jobType === 'instagram_enrich' ? 'instagram' : null

  const ids = payload.prospectIds ?? (await selectCandidateProspectIds(pool, job.jobType, limit))

  if (sourceKey) {
    await runEnrichmentPass(pool, job, sources, sourceKey, ids, log, async (ctx) => {
      if (sourceKey === 'website') {
        if (!ctx.websiteUrl) return null
        return { country: 'FR', websiteUrl: ctx.websiteUrl }
      }
      if (!ctx.instagramHandle) return null
      return { country: 'FR', instagramHandle: ctx.instagramHandle }
    })
  } else {
    // Generic 'enrichment' job type: run both website and instagram passes.
    await runEnrichmentPass(pool, job, sources, 'website', ids, log, async (ctx) => (ctx.websiteUrl ? { country: 'FR', websiteUrl: ctx.websiteUrl } : null))
    await runEnrichmentPass(pool, job, sources, 'instagram', ids, log, async (ctx) =>
      ctx.instagramHandle ? { country: 'FR', instagramHandle: ctx.instagramHandle } : null,
    )
  }

  for (const id of new Set(ids)) {
    await scoreProspect(pool, id)
  }

  log.info('enrichment job complete', { job_type: job.jobType, prospects_processed: ids.length })
  return { prospectsProcessed: ids.length }
}

async function selectCandidateProspectIds(pool: DbPool, jobType: string, limit: number): Promise<string[]> {
  const missingClause = jobType === 'instagram_enrich' ? `not exists (select 1 from public.prospect_social_profiles sp where sp.prospect_id = p.id and sp.platform = 'instagram')` : `p.website_url is null`

  const result = await pool.query<{ id: string }>(
    `select p.id from public.prospects p
     where not p.do_not_contact and (${missingClause})
     order by p.created_at desc
     limit $1`,
    [limit],
  )
  return result.rows.map((r) => r.id)
}
