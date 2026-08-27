export type ProspectJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'cancelled'

/**
 * Mirrors the prospect_jobs.job_type CHECK constraint. The first six are
 * the original V2 types; the rest were added by
 * db/migrations/20260818100000_prospect_competitor_intelligence.sql for
 * the acquisition-intelligence and outreach pipeline.
 */
export type ProspectJobType =
  | 'discovery'
  | 'enrichment'
  | 'dedup_scan'
  | 'scoring'
  | 'website_crawl'
  | 'instagram_enrich'
  | 'search_plan'
  | 'identity_resolution'
  | 'competitor_detection'
  | 'website_enrichment'
  | 'feature_computation'
  | 'fit_scoring'
  | 'segmentation'
  | 'locale_resolution'
  | 'data_quality'
  | 'ml_prediction'
  | 'outreach_preparation'
  | 'whatsapp_send'
  | 'outcome_processing'
  // R4 (20260828100100): refreshes public.prospect_publication_eligibility so
  // the operator's publication review queue stays current. Evaluates only —
  // publishing is public.publish_external_professional, which this worker's
  // role deliberately has no EXECUTE grant on.
  | 'publication_evaluation'

export interface ProspectJob {
  id: string
  jobType: ProspectJobType
  status: ProspectJobStatus
  priority: number
  payload: Record<string, unknown>
  result: Record<string, unknown>
  attempts: number
  maxAttempts: number
  scheduledAt: string
  workerId: string | null
  leaseUntil: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  lastError: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface DiscoveryJobPayload {
  country: string
  city?: string
  latitude?: number
  longitude?: number
  radiusKm?: number
  entityType?: 'barbershop' | 'independent_barber' | 'both'
  keywords?: string[]
  maxCandidates?: number
  minQualificationScore?: number
}
