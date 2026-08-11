/**
 * Shared enum/type mirrors for the Prospect Worker V2 schema — see
 * db/migrations/20260811150100_prospect_acquisition_schema.sql and
 * 20260811150200_prospect_job_queue.sql for the source of truth. This is
 * FadeUp's OWN sales/growth data (no organization_id anywhere), gated to
 * platform staff only — see that migration's header comment.
 */

export type ProspectType = 'barbershop' | 'independent_barber'

export const PROSPECT_TYPES: readonly ProspectType[] = ['barbershop', 'independent_barber']

export type ProspectEntityKind = 'independent' | 'group_parent' | 'group_location'

export type ProspectPipelineStage =
  | 'discovered'
  | 'enriched'
  | 'qualified'
  | 'selected'
  | 'contacted'
  | 'replied'
  | 'demo'
  | 'trial'
  | 'customer'
  | 'lost'

export const PROSPECT_PIPELINE_STAGES: readonly ProspectPipelineStage[] = [
  'discovered',
  'enriched',
  'qualified',
  'selected',
  'contacted',
  'replied',
  'demo',
  'trial',
  'customer',
  'lost',
]

export type ProspectScoreBucket = 'LOW' | 'MEDIUM' | 'HIGH' | 'HOT'

export const PROSPECT_SCORE_BUCKETS: readonly ProspectScoreBucket[] = ['LOW', 'MEDIUM', 'HIGH', 'HOT']

export type ProspectSocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'twitter' | 'youtube' | 'linkedin' | 'other'

export type ProspectDuplicateStatus = 'pending' | 'confirmed_duplicate' | 'confirmed_distinct'

export type ProspectSuppressionScope = 'prospect' | 'phone' | 'email' | 'domain' | 'instagram_handle'

export const PROSPECT_SUPPRESSION_SCOPES: readonly ProspectSuppressionScope[] = [
  'prospect',
  'phone',
  'email',
  'domain',
  'instagram_handle',
]

export type ProspectOutreachChannel = 'email' | 'phone' | 'sms' | 'instagram_dm' | 'in_person' | 'other'

export const PROSPECT_OUTREACH_CHANNELS: readonly ProspectOutreachChannel[] = [
  'email',
  'phone',
  'sms',
  'instagram_dm',
  'in_person',
  'other',
]

export type ProspectOutreachDirection = 'outbound' | 'inbound'

export type ProspectJobType = 'discovery' | 'enrichment' | 'dedup_scan' | 'scoring' | 'website_crawl' | 'instagram_enrich'

export const PROSPECT_JOB_TYPES: readonly ProspectJobType[] = [
  'discovery',
  'enrichment',
  'dedup_scan',
  'scoring',
  'website_crawl',
  'instagram_enrich',
]

export type ProspectJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'cancelled'

export const PROSPECT_JOB_STATUSES: readonly ProspectJobStatus[] = [
  'queued',
  'running',
  'retry',
  'completed',
  'failed',
  'cancelled',
]

/** A job is still "in flight" — used to decide whether to keep polling. */
export const ACTIVE_JOB_STATUSES: readonly ProspectJobStatus[] = ['queued', 'running', 'retry']

export type ProspectJobSourceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** The 6 seeded source keys — see prospect_sources seed rows in the schema migration. */
export type ProspectSourceKey = 'osm' | 'geoapify' | 'sirene' | 'google_places' | 'website' | 'instagram'

export const PROSPECT_SOURCE_KEYS: readonly ProspectSourceKey[] = [
  'osm',
  'geoapify',
  'sirene',
  'google_places',
  'website',
  'instagram',
]

export interface ScoreFactor {
  factor: string
  points: number
  maxPoints: number
  explanation: string
}

/**
 * prospect_scores.factors is stored as snake_case jsonb
 * ([{factor, points, max_points, explanation}, ...]) — normalized here to
 * camelCase for the rest of the app, tolerant of either key shape since the
 * Worker is a separate codebase we don't control the exact serialization of.
 */
export function normalizeScoreFactors(raw: unknown): ScoreFactor[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      factor: typeof item.factor === 'string' ? item.factor : 'Unknown factor',
      points: typeof item.points === 'number' ? item.points : 0,
      maxPoints: typeof item.maxPoints === 'number' ? item.maxPoints : typeof item.max_points === 'number' ? item.max_points : 0,
      explanation: typeof item.explanation === 'string' ? item.explanation : '',
    }))
}
