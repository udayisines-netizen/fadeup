import type { Tribool } from './tribool.js'
import { fromObservation } from './tribool.js'
import type { CrawlResult } from '../crawler/crawl.js'
import type { CompetitorDetection } from '../competitors/detect.js'

/**
 * Barber-specific feature engineering.
 *
 * Every feature carries value + evidence + observation time + confidence
 * (spec §16), and every boolean-ish feature is a Tribool so a failed
 * enrichment produces UNKNOWN rather than a fabricated FALSE (spec §17).
 *
 * The rule this module exists to enforce: a feature may only be FALSE if
 * we actually looked and did not find it. `crawl.succeeded` is therefore
 * threaded into every website-derived feature.
 */

export type FeatureValue =
  | { kind: 'bool'; value: Tribool }
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; value: string }

export interface ComputedFeature {
  key: string
  value: FeatureValue
  evidenceSource: string
  evidence: Record<string, unknown>
  confidence: number | null
  observedAt: Date
}

export const FEATURE_VERSION = 'v1'

export interface FeatureInput {
  prospect: {
    id: string
    type: 'barbershop' | 'independent_barber'
    country: string
    city: string | null
    rating: number | null
    reviewCount: number | null
    estimatedBarberCount: number | null
    hasPhone: boolean
    hasEmail: boolean
    websiteUrl: string | null
  }
  /** Null when no website enrichment has ever been attempted for this prospect. */
  crawl: CrawlResult | null
  competitorDetections: CompetitorDetection[]
  socialProfiles: { platform: string; handle: string | null; isBusinessAccount: boolean | null }[]
  sourceCount: number
  /** Number of distinct locations recorded for this prospect. */
  locationCount: number
}

export function computeFeatures(input: FeatureInput): ComputedFeature[] {
  const now = new Date()
  const features: ComputedFeature[] = []

  const push = (
    key: string,
    value: FeatureValue,
    evidenceSource: string,
    evidence: Record<string, unknown>,
    confidence: number | null,
  ): void => {
    features.push({ key, value, evidenceSource, evidence, confidence, observedAt: now })
  }

  // ---------------------------------------------------------------------
  // Business features
  // ---------------------------------------------------------------------
  if (input.prospect.rating !== null) {
    push('rating', { kind: 'numeric', value: input.prospect.rating }, 'provider', { rating: input.prospect.rating }, 0.9)
  }
  if (input.prospect.reviewCount !== null) {
    push('review_count', { kind: 'numeric', value: input.prospect.reviewCount }, 'provider', { review_count: input.prospect.reviewCount }, 0.9)
  }
  push('source_count', { kind: 'numeric', value: input.sourceCount }, 'computed', { sources: input.sourceCount }, 1)
  push('shop_type', { kind: 'text', value: input.prospect.type }, 'computed', {}, 1)

  // Barber headcount: the website team page is the only direct evidence we
  // ever have. Absent that, UNKNOWN — never "1".
  const crawlSucceeded = input.crawl?.succeeded === true
  const teamCounts = (input.crawl?.pages ?? []).map((p) => p.teamMemberCount).filter((c): c is number => c !== null)
  const observedBarberCount = teamCounts.length > 0 ? Math.max(...teamCounts) : input.prospect.estimatedBarberCount

  if (observedBarberCount !== null && observedBarberCount !== undefined) {
    push(
      'estimated_barber_count',
      { kind: 'numeric', value: observedBarberCount },
      teamCounts.length > 0 ? 'website' : 'provider',
      { team_page_counts: teamCounts },
      teamCounts.length > 0 ? 0.6 : 0.4,
    )
  }

  push(
    'multi_barber',
    {
      kind: 'bool',
      value:
        observedBarberCount === null || observedBarberCount === undefined
          ? 'UNKNOWN'
          : observedBarberCount >= 2
            ? 'TRUE'
            : 'FALSE',
    },
    teamCounts.length > 0 ? 'website' : 'provider',
    { barber_count: observedBarberCount ?? null },
    observedBarberCount === null ? null : 0.6,
  )

  push(
    'multi_location',
    { kind: 'bool', value: input.locationCount > 1 ? 'TRUE' : input.locationCount === 1 ? 'FALSE' : 'UNKNOWN' },
    'computed',
    { location_count: input.locationCount },
    input.locationCount > 0 ? 0.8 : null,
  )

  // ---------------------------------------------------------------------
  // Contactability
  // ---------------------------------------------------------------------
  push('phone_available', { kind: 'bool', value: input.prospect.hasPhone ? 'TRUE' : 'FALSE' }, 'computed', {}, 1)
  push('email_available', { kind: 'bool', value: input.prospect.hasEmail ? 'TRUE' : 'FALSE' }, 'computed', {}, 1)

  // ---------------------------------------------------------------------
  // Digital features — all gated on the crawl actually having succeeded
  // ---------------------------------------------------------------------
  const hasWebsiteUrl = input.prospect.websiteUrl !== null

  push(
    'has_website',
    {
      kind: 'bool',
      // A website URL we could not reach is NOT "no website" — it might be
      // a transient outage. Only a URL we successfully loaded proves TRUE;
      // no URL from any source at all is a genuine FALSE.
      value: crawlSucceeded ? 'TRUE' : hasWebsiteUrl ? 'UNKNOWN' : 'FALSE',
    },
    'website',
    { website_url: input.prospect.websiteUrl, crawl_failure: input.crawl?.failureReason ?? null },
    crawlSucceeded ? 1 : hasWebsiteUrl ? null : 0.7,
  )

  const homepage = input.crawl?.pages[0] ?? null

  push(
    'mobile_ready',
    { kind: 'bool', value: fromObservation(crawlSucceeded, homepage?.hasMobileViewport ?? null) },
    'website',
    { viewport_meta: homepage?.hasMobileViewport ?? null },
    crawlSucceeded ? 0.85 : null,
  )

  push(
    'https_enabled',
    { kind: 'bool', value: fromObservation(crawlSucceeded, input.crawl?.httpsSupported ?? null) },
    'website',
    { final_url: input.crawl?.finalUrl ?? null },
    crawlSucceeded ? 1 : null,
  )

  push(
    'contact_form',
    { kind: 'bool', value: fromObservation(crawlSucceeded, (input.crawl?.pages ?? []).some((p) => p.hasContactForm)) },
    'website',
    {},
    crawlSucceeded ? 0.8 : null,
  )

  push(
    'ecommerce_detected',
    { kind: 'bool', value: fromObservation(crawlSucceeded, (input.crawl?.pages ?? []).some((p) => p.hasEcommerceSignal)) },
    'website',
    {},
    crawlSucceeded ? 0.6 : null,
  )

  push(
    'gift_cards_detected',
    { kind: 'bool', value: fromObservation(crawlSucceeded, (input.crawl?.pages ?? []).some((p) => p.hasGiftCardSignal)) },
    'website',
    {},
    crawlSucceeded ? 0.6 : null,
  )

  push(
    'publishes_pricing',
    { kind: 'bool', value: fromObservation(crawlSucceeded, (input.crawl?.pages ?? []).some((p) => p.priceCount >= 3)) },
    'website',
    { max_prices_on_a_page: Math.max(0, ...(input.crawl?.pages ?? []).map((p) => p.priceCount)) },
    crawlSucceeded ? 0.7 : null,
  )

  const cms = input.crawl?.pages.find((p) => p.cms !== null)?.cms ?? null
  if (cms) {
    push('cms', { kind: 'text', value: cms }, 'website', {}, 0.8)
  }

  const analytics = [...new Set((input.crawl?.pages ?? []).flatMap((p) => p.analytics))]
  push(
    'analytics_installed',
    { kind: 'bool', value: fromObservation(crawlSucceeded, analytics.length > 0) },
    'website',
    { platforms: analytics },
    crawlSucceeded ? 0.85 : null,
  )

  if (crawlSucceeded) {
    const quality = websiteQualityScore(input.crawl!)
    push('website_quality_score', { kind: 'numeric', value: quality.score }, 'website', quality.breakdown, 0.75)

    const medianResponseMs = median((input.crawl?.pages ?? []).map((p) => p.responseTimeMs))
    if (medianResponseMs !== null) {
      push('website_response_ms', { kind: 'numeric', value: medianResponseMs }, 'website', {}, 0.9)
    }

    push(
      'broken_links_detected',
      { kind: 'bool', value: (input.crawl?.brokenLinks.length ?? 0) > 0 ? 'TRUE' : 'FALSE' },
      'website',
      { broken: input.crawl?.brokenLinks.slice(0, 10) ?? [] },
      0.7,
    )
  }

  // ---------------------------------------------------------------------
  // Social
  // ---------------------------------------------------------------------
  const instagram = input.socialProfiles.find((s) => s.platform === 'instagram')
  push(
    'instagram_presence',
    { kind: 'bool', value: instagram ? 'TRUE' : crawlSucceeded ? 'FALSE' : 'UNKNOWN' },
    instagram ? 'social' : 'website',
    { handle: instagram?.handle ?? null },
    instagram ? 0.95 : crawlSucceeded ? 0.6 : null,
  )

  push(
    'social_presence',
    {
      kind: 'bool',
      value: input.socialProfiles.length > 0 ? 'TRUE' : crawlSucceeded ? 'FALSE' : 'UNKNOWN',
    },
    'social',
    { platforms: input.socialProfiles.map((s) => s.platform) },
    input.socialProfiles.length > 0 ? 0.9 : crawlSucceeded ? 0.6 : null,
  )

  // ---------------------------------------------------------------------
  // Booking / competitor
  // ---------------------------------------------------------------------
  const strongest = input.competitorDetections[0] ?? null
  const bookingKnown = crawlSucceeded || strongest !== null
  const hasRealProvider = strongest !== null && strongest.providerKey !== 'NO_BOOKING' && strongest.providerKey !== 'UNKNOWN'

  push(
    'booking_detected',
    { kind: 'bool', value: bookingKnown ? (hasRealProvider ? 'TRUE' : 'FALSE') : 'UNKNOWN' },
    'website',
    { provider: strongest?.providerKey ?? null, method: strongest?.detectionMethod ?? null },
    strongest?.confidence ?? (crawlSucceeded ? 0.7 : null),
  )

  push(
    'booking_provider',
    { kind: 'text', value: hasRealProvider ? strongest!.providerKey : bookingKnown ? 'NO_BOOKING' : 'UNKNOWN' },
    'website',
    { evidence: strongest?.evidence ?? null, evidence_url: strongest?.evidenceUrl ?? null },
    strongest?.confidence ?? null,
  )

  push(
    'competitor_switch_candidate',
    {
      kind: 'bool',
      value:
        !bookingKnown
          ? 'UNKNOWN'
          : hasRealProvider && strongest!.providerKey !== 'CUSTOM_BOOKING'
            ? 'TRUE'
            : 'FALSE',
    },
    'computed',
    { provider: strongest?.providerKey ?? null },
    strongest?.confidence ?? null,
  )

  // ---------------------------------------------------------------------
  // FadeUp product-fit features
  // ---------------------------------------------------------------------
  // The core acquisition thesis: a business with real demand and no modern
  // booking is the highest-value prospect. UNKNOWN booking means UNKNOWN
  // gap — we cannot claim a gap we did not observe.
  push(
    'online_booking_gap',
    {
      kind: 'bool',
      value: !bookingKnown ? 'UNKNOWN' : hasRealProvider ? 'FALSE' : 'TRUE',
    },
    'computed',
    { booking_known: bookingKnown, provider: strongest?.providerKey ?? null },
    bookingKnown ? 0.8 : null,
  )

  push(
    'live_queue_fit',
    { kind: 'numeric', value: liveQueueFit(input, observedBarberCount) },
    'computed',
    { barber_count: observedBarberCount ?? null, review_count: input.prospect.reviewCount },
    0.6,
  )

  push(
    'marketplace_fit',
    { kind: 'numeric', value: marketplaceFit(input) },
    'computed',
    { rating: input.prospect.rating, review_count: input.prospect.reviewCount },
    0.6,
  )

  push(
    'shop_management_fit',
    { kind: 'numeric', value: shopManagementFit(input, observedBarberCount) },
    'computed',
    { barber_count: observedBarberCount ?? null, location_count: input.locationCount },
    0.6,
  )

  push(
    'digital_gap_score',
    { kind: 'numeric', value: digitalGapScore(input, crawlSucceeded, hasRealProvider, bookingKnown) },
    'computed',
    { crawl_succeeded: crawlSucceeded },
    crawlSucceeded ? 0.7 : 0.3,
  )

  return features
}

/**
 * 0-100 website quality. Purely structural signals we can actually
 * observe — no subjective "design quality" guessing.
 */
function websiteQualityScore(crawl: CrawlResult): { score: number; breakdown: Record<string, unknown> } {
  const homepage = crawl.pages[0]
  if (!homepage) return { score: 0, breakdown: { reason: 'no_pages' } }

  const checks: { key: string; points: number; met: boolean }[] = [
    { key: 'https', points: 20, met: crawl.httpsSupported === true },
    { key: 'mobile_viewport', points: 20, met: homepage.hasMobileViewport },
    { key: 'has_title', points: 10, met: (homepage.title?.length ?? 0) > 0 },
    { key: 'has_meta_description', points: 10, met: (homepage.metaDescription?.length ?? 0) > 0 },
    { key: 'structured_data', points: 10, met: homepage.hasStructuredData },
    { key: 'contact_reachable', points: 10, met: homepage.emails.length > 0 || homepage.phones.length > 0 || homepage.hasContactForm },
    { key: 'multi_page', points: 10, met: crawl.pages.length > 1 },
    { key: 'fast_response', points: 10, met: homepage.responseTimeMs < 1500 },
  ]

  const score = checks.reduce((sum, c) => sum + (c.met ? c.points : 0), 0)
  return { score, breakdown: Object.fromEntries(checks.map((c) => [c.key, c.met])) }
}

/**
 * Live-queue relevance. Walk-in queue management matters most where there
 * are multiple chairs and real footfall. Returns 0-100.
 */
function liveQueueFit(input: FeatureInput, barberCount: number | null): number {
  let score = 0
  if (barberCount !== null && barberCount >= 2) score += 40
  else if (barberCount !== null && barberCount >= 4) score += 50
  if ((input.prospect.reviewCount ?? 0) >= 100) score += 30
  else if ((input.prospect.reviewCount ?? 0) >= 30) score += 15
  if (input.prospect.type === 'barbershop') score += 20
  // Publishing prices without a booking system is a strong walk-in signal.
  const publishesPricing = (input.crawl?.pages ?? []).some((p) => p.priceCount >= 3)
  if (publishesPricing) score += 10
  return Math.min(100, score)
}

/** Marketplace value: reputation the marketplace can surface. Returns 0-100. */
function marketplaceFit(input: FeatureInput): number {
  const rating = input.prospect.rating
  const reviews = input.prospect.reviewCount

  // No reputation data at all is a genuine 0 for MARKETPLACE fit (there is
  // nothing to surface), not a missing value — this is a real, defensible
  // zero rather than an imputed one.
  if (rating === null && reviews === null) return 0

  let score = 0
  if (rating !== null) {
    if (rating >= 4.7) score += 45
    else if (rating >= 4.4) score += 35
    else if (rating >= 4.0) score += 20
    else score += 5
  }
  if (reviews !== null) {
    if (reviews >= 300) score += 45
    else if (reviews >= 100) score += 35
    else if (reviews >= 30) score += 22
    else if (reviews >= 5) score += 10
  }
  if (input.socialProfiles.length > 0) score += 10
  return Math.min(100, score)
}

/** Shop-OS fit: staff/chair/multi-location complexity. Returns 0-100. */
function shopManagementFit(input: FeatureInput, barberCount: number | null): number {
  let score = 0
  if (barberCount !== null) {
    if (barberCount >= 5) score += 50
    else if (barberCount >= 3) score += 38
    else if (barberCount >= 2) score += 25
  }
  if (input.locationCount > 1) score += 30
  if (input.prospect.type === 'barbershop') score += 15
  if ((input.crawl?.pages ?? []).some((p) => p.hasEcommerceSignal)) score += 5
  return Math.min(100, score)
}

/**
 * How far behind the business's digital presence is. High gap = high
 * opportunity. Returns 0-100; when the crawl failed it returns a
 * deliberately mid-range value and the accompanying confidence is low,
 * because we genuinely do not know.
 */
function digitalGapScore(input: FeatureInput, crawlSucceeded: boolean, hasRealProvider: boolean, bookingKnown: boolean): number {
  if (!crawlSucceeded && input.prospect.websiteUrl === null) {
    // No website found by any source: that is a real, observed gap.
    return 85
  }
  if (!crawlSucceeded) return 50

  let gap = 0
  if (bookingKnown && !hasRealProvider) gap += 40
  const homepage = input.crawl?.pages[0]
  if (homepage && !homepage.hasMobileViewport) gap += 20
  if (input.crawl?.httpsSupported === false) gap += 15
  if (homepage && !homepage.hasStructuredData) gap += 10
  if (input.socialProfiles.length === 0) gap += 10
  if (homepage && (homepage.metaDescription?.length ?? 0) === 0) gap += 5
  return Math.min(100, gap)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2) : (sorted[mid] ?? 0)
}
