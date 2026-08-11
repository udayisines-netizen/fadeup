/**
 * Common adapter contract every discovery/enrichment source implements.
 * The waterfall/job runner code (src/jobs/discovery.ts) depends only on
 * this interface — it never branches on which concrete source it's
 * talking to, so adding a 7th source later means writing one new file
 * that implements this shape, not touching the job runner.
 */

export interface DiscoveryQuery {
  country: string
  city?: string
  latitude?: number
  longitude?: number
  radiusKm?: number
  entityType?: 'barbershop' | 'independent_barber' | 'both'
  keywords?: string[]
  maxCandidates?: number
  /** Used only by the website adapter — a known URL to crawl/enrich, rather than a bulk area search. Every other adapter ignores this field. */
  websiteUrl?: string
  /** Used only by the instagram adapter — a known handle to enrich via the official Graph API. Every other adapter ignores this field. */
  instagramHandle?: string
}

/** One raw hit from a source, BEFORE normalization/canonicalization. Deliberately loose/optional — different sources surface different fields, and prospect_source_records.raw_payload keeps the untouched original alongside this. */
export interface RawCandidate {
  externalId: string
  externalType: string
  sourceUrl?: string
  name?: string
  category?: string
  addressLine?: string
  city?: string
  postalCode?: string
  region?: string
  country?: string
  latitude?: number
  longitude?: number
  phone?: string
  email?: string
  websiteUrl?: string
  instagramHandle?: string
  facebookUrl?: string
  tiktokHandle?: string
  confidence: number
  rawPayload: Record<string, unknown>
}

export interface SourceAdapterContext {
  jobId: string | null
  logger: import('../logger.js').Logger
}

export interface SourceAdapter {
  readonly key: string
  readonly displayName: string
  /** True if this adapter has what it needs to run (an API key, etc) — independent of the DB's is_enabled toggle, which the job runner checks separately. */
  isConfigured(): boolean
  discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]>
}
