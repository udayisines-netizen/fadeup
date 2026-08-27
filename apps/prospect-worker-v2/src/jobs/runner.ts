import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'
import type { SourceAdapter } from '../sources/registry.js'
import type { ProspectJob } from '../queue/types.js'
import type { ModelCache } from '../ml/inference.js'
import { runDiscoveryJob } from './discovery.js'
import { runEnrichmentJob } from './enrichment.js'
import { runDedupScanJob } from './dedup-scan.js'
import { runScoringJob } from './scoring.js'
import { runWebsiteEnrichmentJob } from './website-enrichment.js'
import { runFeatureComputationJob } from './feature-computation.js'
import { runOutreachPreparationJob } from './outreach-preparation.js'
import { runWhatsAppSendJob } from './whatsapp-send.js'
import { runSearchPlanJob } from './search-plan.js'
import { runPublicationEvaluationJob } from './publication-evaluation.js'

export interface JobContext {
  pool: DbPool
  config: Config
  sources: Map<string, SourceAdapter>
  modelCache: ModelCache
  log: Logger
}

/** Dispatches a claimed job to its handler by job_type. Every handler returns a plain JSON-serializable result object, stored verbatim in prospect_jobs.result. */
export async function runJob(ctx: JobContext, job: ProspectJob): Promise<Record<string, unknown>> {
  const { pool, config, sources, modelCache, log } = ctx

  switch (job.jobType) {
    case 'discovery':
      return { ...(await runDiscoveryJob(pool, job, sources, log)) }

    case 'enrichment':
    case 'instagram_enrich':
      return { ...(await runEnrichmentJob(pool, job, sources, log)) }

    // The original 'website_crawl' type now runs the hardened,
    // SSRF-guarded crawler + competitor detection rather than the older
    // single-page adapter path. Existing queued jobs of this type keep
    // working; they just get the better implementation.
    case 'website_crawl':
    case 'website_enrichment':
      return { ...(await runWebsiteEnrichmentJob(pool, job, config, log)) }

    case 'dedup_scan':
    case 'identity_resolution':
      return { ...(await runDedupScanJob(pool, job, log)) }

    case 'scoring':
      return { ...(await runScoringJob(pool, job, log)) }

    // Feature computation, scoring, segmentation, locale and data quality
    // all read the same prospect snapshot, so they are one handler — see
    // the comment at the top of feature-computation.ts.
    case 'feature_computation':
    case 'fit_scoring':
    case 'segmentation':
    case 'locale_resolution':
    case 'data_quality':
      return { ...(await runFeatureComputationJob(pool, job, log)) }

    case 'search_plan':
      return { ...(await runSearchPlanJob(pool, job, sources, log)) }

    case 'competitor_detection':
      return { ...(await runWebsiteEnrichmentJob(pool, job, config, log)) }

    case 'outreach_preparation':
      return { ...(await runOutreachPreparationJob(pool, job, config, modelCache, log)) }

    case 'whatsapp_send':
      return { ...(await runWhatsAppSendJob(pool, job, config, log)) }

    case 'ml_prediction':
      // Predictions are produced inline during outreach preparation, where
      // the candidate template set is known. A standalone prediction job
      // would have nothing to rank.
      return { skipped: true, reason: 'ml predictions are produced during outreach_preparation' }

    case 'outcome_processing':
      return { ...(await runOutcomeProcessingJob(pool, log)) }

    // Evaluates publication eligibility; never publishes. The operator's
    // decision path is public.publish_external_professional, which the
    // prospect_worker role has no EXECUTE grant on by design.
    case 'publication_evaluation':
      return { ...(await runPublicationEvaluationJob(pool, job, log)) }

    default: {
      const exhaustive: never = job.jobType
      throw new Error(`unknown job_type: ${String(exhaustive)}`)
    }
  }
}

/**
 * Reconciles outreach outcomes with conversion state.
 *
 * The link the spec requires (§43/§70): when a prospect FadeUp contacted
 * later claims/activates, the recipient row must reflect that, so the
 * funnel measures activation and revenue rather than replies.
 */
async function runOutcomeProcessingJob(pool: DbPool, log: Logger): Promise<Record<string, unknown>> {
  // Any contacted prospect that has since become a FadeUp organization is
  // marked activated, and the event is recorded once.
  const activated = await pool.query<{ recipient_id: string; prospect_id: string }>(
    `update public.outreach_recipients r
     set state = 'activated', converted_at = coalesce(r.converted_at, now())
     from public.prospects p
     where p.id = r.prospect_id
       and p.converted_organization_id is not null
       and r.state in ('sent', 'delivered', 'read', 'replied', 'positive_reply', 'claimed')
     returning r.id as recipient_id, r.prospect_id`,
  )

  for (const row of activated.rows) {
    await pool.query(
      `insert into public.outreach_events (recipient_id, prospect_id, event_type, metadata)
       values ($1, $2, 'activated', $3)`,
      [row.recipient_id, row.prospect_id, JSON.stringify({ source: 'outcome_processing' })],
    )
  }

  // Stale webhook envelopes that were stored but never processed (e.g. the
  // process died mid-batch) are surfaced rather than silently lost.
  const unprocessed = await pool.query<{ count: string }>(
    `select count(*) from public.whatsapp_webhook_events
     where not processed and received_at < now() - interval '10 minutes'`,
  )

  const result = {
    activated: activated.rowCount ?? 0,
    unprocessedWebhookEvents: Number(unprocessed.rows[0]?.count ?? 0),
  }

  if (result.activated > 0 || result.unprocessedWebhookEvents > 0) {
    log.info('outcome_processing: reconciled', result)
  }

  return result
}
