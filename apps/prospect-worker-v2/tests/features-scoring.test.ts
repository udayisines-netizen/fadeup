import { describe, expect, it } from 'vitest'
import { fromObservation, isFalse, isKnown, isTrue, toModelValue } from '../src/features/tribool.js'
import { computeFeatures, type FeatureInput } from '../src/features/compute.js'
import {
  computeFadeUpFitScore,
  computeMigrationPotentialScore,
  classify,
  type ScoringFeatures,
} from '../src/scoring/fit-scores.js'
import { computeSegments } from '../src/scoring/segments.js'
import { resolveLocale } from '../src/locale/resolve.js'
import type { CrawlResult } from '../src/crawler/crawl.js'

describe('tribool', () => {
  it('never treats UNKNOWN as false', () => {
    expect(isTrue('UNKNOWN')).toBe(false)
    // The asymmetry is the entire point: not-true is not the same as false.
    expect(isFalse('UNKNOWN')).toBe(false)
    expect(isKnown('UNKNOWN')).toBe(false)
  })

  it('treats NOT_APPLICABLE as neither true nor false', () => {
    expect(isTrue('NOT_APPLICABLE')).toBe(false)
    expect(isFalse('NOT_APPLICABLE')).toBe(false)
  })

  it('returns UNKNOWN when the observation never happened, regardless of the value', () => {
    expect(fromObservation(false, true)).toBe('UNKNOWN')
    expect(fromObservation(false, false)).toBe('UNKNOWN')
    expect(fromObservation(true, true)).toBe('TRUE')
    expect(fromObservation(true, false)).toBe('FALSE')
    expect(fromObservation(true, null)).toBe('UNKNOWN')
  })

  it('encodes UNKNOWN as NaN for ML, not 0', () => {
    expect(toModelValue('TRUE')).toBe(1)
    expect(toModelValue('FALSE')).toBe(0)
    expect(Number.isNaN(toModelValue('UNKNOWN'))).toBe(true)
    expect(Number.isNaN(toModelValue('NOT_APPLICABLE'))).toBe(true)
  })
})

function baseFeatureInput(overrides: Partial<FeatureInput> = {}): FeatureInput {
  return {
    prospect: {
      id: 'p1',
      type: 'barbershop',
      country: 'FR',
      city: 'Paris',
      rating: 4.6,
      reviewCount: 120,
      estimatedBarberCount: null,
      hasPhone: true,
      hasEmail: false,
      websiteUrl: 'https://barbier.fr',
    },
    crawl: null,
    competitorDetections: [],
    socialProfiles: [],
    sourceCount: 2,
    locationCount: 1,
    ...overrides,
  }
}

/** A fully-populated CrawledPage — the shape crawl.ts always produces. */
function crawledPage(overrides: Partial<CrawlResult['pages'][number]> = {}): CrawlResult['pages'][number] {
  return {
    url: 'https://barbier.fr/',
    statusCode: 200,
    contentType: 'text/html',
    byteSize: 2048,
    responseTimeMs: 400,
    depth: 0,
    title: 'Barbier',
    metaDescription: null,
    lang: 'fr',
    internalLinks: [],
    outboundLinks: [],
    scriptSrcs: [],
    iframeSrcs: [],
    formActions: [],
    bookingLinks: [],
    bookingButtonTargets: [],
    structuredDataUrls: [],
    emails: [],
    phones: [],
    instagramHandles: [],
    facebookUrls: [],
    tiktokHandles: [],
    hasContactForm: false,
    hasMobileViewport: true,
    hasStructuredData: false,
    hasEcommerceSignal: false,
    hasGiftCardSignal: false,
    cms: null,
    analytics: [],
    teamMemberCount: null,
    priceCount: 0,
    ...overrides,
  }
}

function crawl(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    succeeded: true,
    startUrl: 'https://barbier.fr',
    finalUrl: 'https://barbier.fr/',
    pages: [],
    redirectChain: [],
    httpsSupported: true,
    failureReason: null,
    brokenLinks: [],
    totalDurationMs: 500,
    ...overrides,
  }
}

describe('computeFeatures — UNKNOWN semantics', () => {
  it('marks booking UNKNOWN when the crawl failed, NOT false', () => {
    const features = computeFeatures(
      baseFeatureInput({
        crawl: crawl({ succeeded: false, pages: [], failureReason: 'timeout' }),
      }),
    )

    const booking = features.find((f) => f.key === 'booking_detected')
    expect(booking?.value).toEqual({ kind: 'bool', value: 'UNKNOWN' })

    // And therefore the derived gap is UNKNOWN too — we cannot claim a
    // booking gap we never observed.
    const gap = features.find((f) => f.key === 'online_booking_gap')
    expect(gap?.value).toEqual({ kind: 'bool', value: 'UNKNOWN' })
  })

  it('marks has_website UNKNOWN when a URL exists but could not be reached', () => {
    const features = computeFeatures(
      baseFeatureInput({ crawl: crawl({ succeeded: false, failureReason: 'timeout' }) }),
    )
    expect(features.find((f) => f.key === 'has_website')?.value).toEqual({ kind: 'bool', value: 'UNKNOWN' })
  })

  it('marks has_website FALSE only when no source ever found a URL', () => {
    const input = baseFeatureInput()
    input.prospect.websiteUrl = null
    const features = computeFeatures({ ...input, crawl: null })
    expect(features.find((f) => f.key === 'has_website')?.value).toEqual({ kind: 'bool', value: 'FALSE' })
  })

  it('marks booking FALSE when the crawl succeeded and found a NO_BOOKING result', () => {
    const features = computeFeatures(
      baseFeatureInput({
        crawl: crawl({ pages: [crawledPage()] }),
        competitorDetections: [
          { providerKey: 'NO_BOOKING', detectionMethod: 'domain_pattern', evidence: 'x', evidenceUrl: null, confidence: 0.7 },
        ],
      }),
    )
    expect(features.find((f) => f.key === 'booking_detected')?.value).toEqual({ kind: 'bool', value: 'FALSE' })
    expect(features.find((f) => f.key === 'online_booking_gap')?.value).toEqual({ kind: 'bool', value: 'TRUE' })
  })

  it('never invents a barber headcount', () => {
    const features = computeFeatures(baseFeatureInput())
    expect(features.find((f) => f.key === 'multi_barber')?.value).toEqual({ kind: 'bool', value: 'UNKNOWN' })
  })

  it('records evidence and confidence on every feature', () => {
    for (const feature of computeFeatures(baseFeatureInput())) {
      expect(feature.evidenceSource).toBeTruthy()
      expect(feature.observedAt).toBeInstanceOf(Date)
      expect(feature.evidence).toBeTypeOf('object')
    }
  })
})

function scoringFeatures(overrides: Partial<ScoringFeatures> = {}): ScoringFeatures {
  return {
    rating: 4.6,
    reviewCount: 150,
    barberCount: 4,
    shopType: 'barbershop',
    locationCount: 1,
    hasWebsite: 'TRUE',
    websiteQualityScore: 60,
    mobileReady: 'TRUE',
    bookingDetected: 'FALSE',
    bookingProviderKey: 'NO_BOOKING',
    onlineBookingGap: 'TRUE',
    instagramPresence: 'TRUE',
    socialPresence: 'TRUE',
    phoneAvailable: 'TRUE',
    emailAvailable: 'TRUE',
    liveQueueFit: 80,
    marketplaceFit: 75,
    shopManagementFit: 70,
    digitalGapScore: 55,
    competitorTenureDays: null,
    ...overrides,
  }
}

describe('computeFadeUpFitScore', () => {
  it('produces a score equal to the sum of its own breakdown', () => {
    const result = computeFadeUpFitScore(scoringFeatures())
    const sum = result.breakdown.reduce((total, factor) => total + factor.points, 0)
    expect(result.score).toBe(Math.max(0, Math.min(100, sum)))
  })

  it('has a breakdown whose maxima total exactly 100', () => {
    const result = computeFadeUpFitScore(scoringFeatures())
    const maxTotal = result.breakdown.reduce((total, factor) => total + factor.maxPoints, 0)
    expect(maxTotal).toBe(100)
  })

  it('awards no points for an UNKNOWN booking status, in either direction', () => {
    const unknown = computeFadeUpFitScore(scoringFeatures({ onlineBookingGap: 'UNKNOWN', bookingDetected: 'UNKNOWN' }))
    const factor = unknown.breakdown.find((f) => f.factor === 'online_booking_gap')
    expect(factor?.points).toBe(0)
    expect(factor?.explanation).toContain('UNKNOWN')
  })

  it('scores a high-value shop with no booking above one already on a competitor', () => {
    const noBooking = computeFadeUpFitScore(scoringFeatures())
    const onCompetitor = computeFadeUpFitScore(
      scoringFeatures({ bookingDetected: 'TRUE', bookingProviderKey: 'PLANITY', onlineBookingGap: 'FALSE' }),
    )
    expect(noBooking.score).toBeGreaterThan(onCompetitor.score)
  })

  it('does not penalise a missing rating as if it were a bad rating', () => {
    const missing = computeFadeUpFitScore(scoringFeatures({ rating: null }))
    const bad = computeFadeUpFitScore(scoringFeatures({ rating: 2.0 }))
    const missingFactor = missing.breakdown.find((f) => f.factor === 'rating')
    const badFactor = bad.breakdown.find((f) => f.factor === 'rating')
    expect(missingFactor?.points).toBe(0)
    expect(badFactor?.points).toBe(0)
    // Both score 0 points, but the explanations must be different so a
    // human reading the breakdown is not misled.
    expect(missingFactor?.explanation).toContain('unknown')
    expect(badFactor?.explanation).not.toContain('unknown')
  })

  it('classifies into HOT/WARM/COLD at the documented thresholds', () => {
    expect(classify(85)).toBe('HOT')
    expect(classify(70)).toBe('HOT')
    expect(classify(69)).toBe('WARM')
    expect(classify(40)).toBe('WARM')
    expect(classify(39)).toBe('COLD')
  })
})

describe('computeMigrationPotentialScore', () => {
  it('is exactly 0 for a prospect with no booking at all', () => {
    const result = computeMigrationPotentialScore(scoringFeatures())
    expect(result.score).toBe(0)
    expect(result.classification).toBe('COLD')
    expect(result.breakdown[0]?.explanation).toContain('net-new')
  })

  it('is exactly 0, with a distinct explanation, when booking is UNKNOWN', () => {
    const result = computeMigrationPotentialScore(
      scoringFeatures({ bookingDetected: 'UNKNOWN', bookingProviderKey: 'UNKNOWN' }),
    )
    expect(result.score).toBe(0)
    // Crucially different from "no booking" — this one is "we don't know yet".
    expect(result.breakdown[0]?.explanation).toContain('UNKNOWN')
  })

  it('is 0 for in-house booking, which is not a third-party contract', () => {
    const result = computeMigrationPotentialScore(
      scoringFeatures({ bookingDetected: 'TRUE', bookingProviderKey: 'CUSTOM_BOOKING' }),
    )
    expect(result.score).toBe(0)
    expect(result.breakdown[0]?.explanation).toContain('in-house')
  })

  it('scores a large, long-tenured competitor user highly', () => {
    const result = computeMigrationPotentialScore(
      scoringFeatures({
        bookingDetected: 'TRUE',
        bookingProviderKey: 'PLANITY',
        onlineBookingGap: 'FALSE',
        competitorTenureDays: 900,
        barberCount: 6,
        locationCount: 2,
      }),
    )
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.classification).toBe('HOT')
  })

  it('is genuinely independent of the FadeUp fit score', () => {
    // The same prospect gets a high migration score and a lower fit score,
    // proving the two are not the same number wearing different labels.
    const features = scoringFeatures({
      bookingDetected: 'TRUE',
      bookingProviderKey: 'BOOKSY',
      onlineBookingGap: 'FALSE',
      competitorTenureDays: 800,
      barberCount: 6,
      locationCount: 2,
    })
    const fit = computeFadeUpFitScore(features)
    const migration = computeMigrationPotentialScore(features)
    expect(migration.score).not.toBe(fit.score)
    expect(migration.rulesetVersion).not.toBe(fit.rulesetVersion)
  })

  it('sums to its own breakdown', () => {
    const result = computeMigrationPotentialScore(
      scoringFeatures({ bookingDetected: 'TRUE', bookingProviderKey: 'FRESHA', competitorTenureDays: 400 }),
    )
    const sum = result.breakdown.reduce((total, factor) => total + factor.points, 0)
    expect(result.score).toBe(Math.max(0, Math.min(100, sum)))
  })
})

describe('computeSegments', () => {
  it('never assigns NO_BOOKING on an UNKNOWN booking status', () => {
    const segments = computeSegments({
      features: scoringFeatures({ bookingDetected: 'UNKNOWN', bookingProviderKey: 'UNKNOWN' }),
      fadeUpFitScore: 50,
      migrationPotentialScore: 0,
      needsHumanReview: false,
      reviewReasons: [],
    })
    expect(segments.map((s) => s.segmentKey)).not.toContain('NO_BOOKING')
  })

  it('assigns NO_BOOKING only on an observed absence', () => {
    const segments = computeSegments({
      features: scoringFeatures({ bookingDetected: 'FALSE', bookingProviderKey: 'NO_BOOKING' }),
      fadeUpFitScore: 50,
      migrationPotentialScore: 0,
      needsHumanReview: false,
      reviewReasons: [],
    })
    expect(segments.map((s) => s.segmentKey)).toContain('NO_BOOKING')
  })

  it('assigns multiple overlapping segments', () => {
    const segments = computeSegments({
      features: scoringFeatures({
        bookingDetected: 'TRUE',
        bookingProviderKey: 'PLANITY',
        barberCount: 5,
        rating: 4.8,
        reviewCount: 300,
        digitalGapScore: 70,
      }),
      fadeUpFitScore: 78,
      migrationPotentialScore: 82,
      needsHumanReview: false,
      reviewReasons: [],
    })
    const keys = segments.map((s) => s.segmentKey)
    expect(keys).toContain('COMPETITOR_USER')
    expect(keys).toContain('COMPETITOR_SWITCH_HIGH')
    expect(keys).toContain('MULTI_BARBER_SHOP')
    expect(keys).toContain('HIGH_REPUTATION')
    expect(keys).toContain('HIGH_FADEUP_FIT')
    expect(keys).toContain('HIGH_MIGRATION_POTENTIAL')
  })

  it('flags REVIEW_REQUIRED with its reasons', () => {
    const segments = computeSegments({
      features: scoringFeatures(),
      fadeUpFitScore: 50,
      migrationPotentialScore: 0,
      needsHumanReview: true,
      reviewReasons: ['locale_review_required'],
    })
    const review = segments.find((s) => s.segmentKey === 'REVIEW_REQUIRED')
    expect(review).toBeDefined()
    expect(review?.rationale['reasons']).toEqual(['locale_review_required'])
  })

  it('carries a rationale on every membership', () => {
    const segments = computeSegments({
      features: scoringFeatures(),
      fadeUpFitScore: 80,
      migrationPotentialScore: 0,
      needsHumanReview: false,
      reviewReasons: [],
    })
    for (const segment of segments) {
      expect(Object.keys(segment.rationale).length).toBeGreaterThan(0)
    }
  })
})

describe('resolveLocale', () => {
  const emptyEvidence = {
    verifiedCountry: null,
    addressCountry: null,
    websiteHtmlLang: null,
    providerLocale: null,
    phoneE164: null,
    dominantWebsiteLanguage: null,
  }

  it('resolves fr-FR from a French address', () => {
    const result = resolveLocale({ ...emptyEvidence, addressCountry: 'FR' })
    expect(result.locale).toBe('fr-FR')
    expect(result.detectedLanguage).toBe('fr')
  })

  it('prefers the website’s declared language over the country default', () => {
    const result = resolveLocale({ ...emptyEvidence, addressCountry: 'FR', websiteHtmlLang: 'en-GB' })
    expect(result.detectedLanguage).toBe('en')
    expect(result.languageSource).toBe('website_language')
    // A French business with an English site is legitimate but ambiguous
    // for template selection, so a human must decide.
    expect(result.reviewRequired).toBe(true)
  })

  it('distinguishes en-GB from en-US by country', () => {
    expect(resolveLocale({ ...emptyEvidence, addressCountry: 'GB' }).locale).toBe('en-GB')
    expect(resolveLocale({ ...emptyEvidence, addressCountry: 'US' }).locale).toBe('en-US')
  })

  it('uses the phone country code when no address is available', () => {
    const result = resolveLocale({ ...emptyEvidence, phoneE164: '+33612345678' })
    expect(result.detectedCountry).toBe('FR')
    expect(result.locale).toBe('fr-FR')
  })

  it('does not resolve +1, which is ambiguous between US and CA', () => {
    const result = resolveLocale({ ...emptyEvidence, phoneE164: '+15551234567' })
    expect(result.detectedCountry).toBeNull()
    expect(result.reviewRequired).toBe(true)
  })

  it('requires review when nothing at all is known', () => {
    const result = resolveLocale(emptyEvidence)
    expect(result.locale).toBeNull()
    expect(result.reviewRequired).toBe(true)
  })

  it('flags an unsupported locale for review instead of coercing it', () => {
    // A German business must not be silently mapped onto fr-FR or en-GB.
    const result = resolveLocale({ ...emptyEvidence, addressCountry: 'DE', websiteHtmlLang: 'de' })
    expect(result.locale).toBe('de-DE')
    expect(result.reviewRequired).toBe(true)
    expect(result.evidence['review_reason']).toBe('unsupported_locale')
  })

  it('prefers a verified registry country over a postal address', () => {
    const result = resolveLocale({ ...emptyEvidence, verifiedCountry: 'FR', addressCountry: 'GB' })
    expect(result.detectedCountry).toBe('FR')
  })
})
