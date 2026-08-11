export type ProspectJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'cancelled'

export type ProspectJobType = 'discovery' | 'enrichment' | 'dedup_scan' | 'scoring' | 'website_crawl' | 'instagram_enrich'

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
