import type { Tribool } from '../features/tribool.js'
import { isFalse, isTrue } from '../features/tribool.js'

/**
 * The two DISTINCT deterministic scores (spec §19/§20).
 *
 * These are separate on purpose and must never be blended: "how valuable
 * is this business to FadeUp" and "how likely is this business to switch
 * away from its current provider" answer different questions and drive
 * different sales motions. A shop with no booking at all can be a perfect
 * fadeup_fit and have literally no migration potential, because there is
 * nothing to migrate from.
 *
 * Both are pure functions of a feature snapshot: no AI, no hidden weights,
 * and every point awarded appears in the returned breakdown. `score` is
 * always exactly the sum of the breakdown's points.
 */

export type FitClass = 'HOT' | 'WARM' | 'COLD'

export interface ScoreFactor {
  group: string
  factor: string
  points: number
  maxPoints: number
  explanation: string
}

export interface FitScoreResult {
  score: number
  classification: FitClass
  breakdown: ScoreFactor[]
  rulesetVersion: string
}

export const FADEUP_FIT_RULESET_VERSION = 'fadeup-fit-v1'
export const MIGRATION_POTENTIAL_RULESET_VERSION = 'migration-potential-v1'

/** Feature snapshot both scores read. Tribools keep UNKNOWN distinct from FALSE all the way into scoring. */
export interface ScoringFeatures {
  rating: number | null
  reviewCount: number | null
  barberCount: number | null
  shopType: 'barbershop' | 'independent_barber'
  locationCount: number
  hasWebsite: Tribool
  websiteQualityScore: number | null
  mobileReady: Tribool
  bookingDetected: Tribool
  bookingProviderKey: string
  onlineBookingGap: Tribool
  instagramPresence: Tribool
  socialPresence: Tribool
  phoneAvailable: Tribool
  emailAvailable: Tribool
  liveQueueFit: number
  marketplaceFit: number
  shopManagementFit: number
  digitalGapScore: number
  /** Days since the competitor provider was first observed. Null when unknown or when there is no provider. */
  competitorTenureDays: number | null
}

export function classify(score: number): FitClass {
  if (score >= 70) return 'HOT'
  if (score >= 40) return 'WARM'
  return 'COLD'
}

/**
 * FadeUp fit — 0-100 across four groups, each with a fixed maximum:
 *   BUSINESS VALUE   35
 *   DIGITAL GAP      25
 *   FADEUP FIT       25
 *   CONTACTABILITY   15
 * The four maxima sum to exactly 100.
 */
export function computeFadeUpFitScore(f: ScoringFeatures): FitScoreResult {
  const breakdown: ScoreFactor[] = [
    // --- BUSINESS VALUE (35) ------------------------------------------
    ratingFactor(f),
    reviewVolumeFactor(f),
    barberCountFactor(f, 'BUSINESS VALUE', 8),
    multiLocationFactor(f, 'BUSINESS VALUE', 5),

    // --- DIGITAL GAP (25) ---------------------------------------------
    bookingGapFactor(f),
    websiteGapFactor(f),
    mobileGapFactor(f),

    // --- FADEUP FIT (25) ----------------------------------------------
    scaledFactor('FADEUP FIT', 'live_queue_fit', 10, f.liveQueueFit, 'Suitability for the FadeUp live walk-in queue.'),
    scaledFactor('FADEUP FIT', 'marketplace_fit', 10, f.marketplaceFit, 'Value this business would bring to the FadeUp marketplace.'),
    scaledFactor('FADEUP FIT', 'shop_management_fit', 5, f.shopManagementFit, 'Complexity that the FadeUp shop OS addresses.'),

    // --- CONTACTABILITY (15) ------------------------------------------
    triboolFactor('CONTACTABILITY', 'phone_available', 7, f.phoneAvailable, 'A business phone number is on record.'),
    triboolFactor('CONTACTABILITY', 'email_available', 4, f.emailAvailable, 'A professional email address is on record.'),
    triboolFactor('CONTACTABILITY', 'social_presence', 4, f.socialPresence, 'A public social profile provides an additional contact route.'),
  ]

  const score = clamp(breakdown.reduce((sum, factor) => sum + factor.points, 0))
  return { score, classification: classify(score), breakdown, rulesetVersion: FADEUP_FIT_RULESET_VERSION }
}

/**
 * Migration potential — 0-100.
 *
 * Only meaningful for a business already on a third-party booking
 * provider. When there is no competitor to migrate FROM, the score is 0
 * with an explicit explanation, NOT a null or a low-but-nonzero number
 * that would let a no-booking prospect drift into a migration campaign.
 */
export function computeMigrationPotentialScore(f: ScoringFeatures): FitScoreResult {
  const onCompetitor =
    isTrue(f.bookingDetected) &&
    f.bookingProviderKey !== 'NO_BOOKING' &&
    f.bookingProviderKey !== 'UNKNOWN' &&
    f.bookingProviderKey !== 'CUSTOM_BOOKING'

  if (!onCompetitor) {
    const reason = isTrue(f.bookingDetected)
      ? `Booking is handled in-house (${f.bookingProviderKey}) — there is no third-party contract to migrate from.`
      : isFalse(f.bookingDetected)
        ? 'No online booking provider was observed — this is a net-new booking opportunity, not a migration.'
        : 'Booking provider is UNKNOWN — migration potential cannot be assessed until enrichment succeeds.'

    return {
      score: 0,
      classification: 'COLD',
      breakdown: [
        {
          group: 'ELIGIBILITY',
          factor: 'on_competitor_platform',
          points: 0,
          maxPoints: 100,
          explanation: reason,
        },
      ],
      rulesetVersion: MIGRATION_POTENTIAL_RULESET_VERSION,
    }
  }

  const breakdown: ScoreFactor[] = [
    // Being on a competitor at all is the precondition, and it carries
    // real weight: this business has already decided it wants software.
    {
      group: 'COMPETITOR',
      factor: 'on_competitor_platform',
      points: 20,
      maxPoints: 20,
      explanation: `Currently using ${f.bookingProviderKey} — already pays for booking software and has proven willingness to adopt.`,
    },
    competitorTenureFactor(f),

    // --- BUSINESS SCALE (30) ------------------------------------------
    barberCountFactor(f, 'BUSINESS SCALE', 12),
    multiLocationFactor(f, 'BUSINESS SCALE', 8),
    reviewVolumeFactor({ ...f, reviewCount: f.reviewCount }, 'BUSINESS SCALE', 10),

    // --- FADEUP DIFFERENTIATION (25) ----------------------------------
    // Where FadeUp offers something the incumbent does not, the switch
    // argument is strongest.
    scaledFactor('DIFFERENTIATION', 'live_queue_fit', 12, f.liveQueueFit, 'Live walk-in queue is a capability most incumbents do not offer.'),
    scaledFactor('DIFFERENTIATION', 'marketplace_fit', 13, f.marketplaceFit, 'Marketplace demand generation is a switch incentive beyond feature parity.'),

    // --- DIGITAL MATURITY (15) ----------------------------------------
    // Counterintuitively, a digitally MATURE business migrates more
    // readily: it already runs on software and can evaluate a
    // replacement. A business with no website at all rarely switches
    // platforms on a cold approach.
    digitalMaturityFactor(f),
  ]

  const score = clamp(breakdown.reduce((sum, factor) => sum + factor.points, 0))
  return { score, classification: classify(score), breakdown, rulesetVersion: MIGRATION_POTENTIAL_RULESET_VERSION }
}

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

function ratingFactor(f: ScoringFeatures): ScoreFactor {
  const maxPoints = 10
  if (f.rating === null) {
    return {
      group: 'BUSINESS VALUE',
      factor: 'rating',
      points: 0,
      maxPoints,
      explanation: 'No rating available from any source — scored as unknown, not as a poor rating.',
    }
  }
  const points = f.rating >= 4.7 ? 10 : f.rating >= 4.4 ? 8 : f.rating >= 4.0 ? 5 : f.rating >= 3.5 ? 2 : 0
  return {
    group: 'BUSINESS VALUE',
    factor: 'rating',
    points,
    maxPoints,
    explanation: `Public rating of ${f.rating.toFixed(1)}/5.`,
  }
}

function reviewVolumeFactor(f: ScoringFeatures, group = 'BUSINESS VALUE', maxPoints = 12): ScoreFactor {
  if (f.reviewCount === null) {
    return {
      group,
      factor: 'review_volume',
      points: 0,
      maxPoints,
      explanation: 'Review volume unknown — scored as unknown, not as zero reviews.',
    }
  }
  const ratio = f.reviewCount >= 300 ? 1 : f.reviewCount >= 100 ? 0.8 : f.reviewCount >= 30 ? 0.55 : f.reviewCount >= 10 ? 0.3 : 0.1
  return {
    group,
    factor: 'review_volume',
    points: Math.round(maxPoints * ratio),
    maxPoints,
    explanation: `${f.reviewCount} public reviews — a proxy for real customer volume.`,
  }
}

function barberCountFactor(f: ScoringFeatures, group: string, maxPoints: number): ScoreFactor {
  if (f.barberCount === null) {
    return {
      group,
      factor: 'barber_count',
      points: 0,
      maxPoints,
      explanation: 'Barber headcount not observed — scored as unknown, not as a single-barber shop.',
    }
  }
  const ratio = f.barberCount >= 6 ? 1 : f.barberCount >= 4 ? 0.85 : f.barberCount >= 2 ? 0.6 : 0.15
  return {
    group,
    factor: 'barber_count',
    points: Math.round(maxPoints * ratio),
    maxPoints,
    explanation: `${f.barberCount} barber(s) observed.`,
  }
}

function multiLocationFactor(f: ScoringFeatures, group: string, maxPoints: number): ScoreFactor {
  return {
    group,
    factor: 'multi_location',
    points: f.locationCount > 1 ? maxPoints : 0,
    maxPoints,
    explanation: f.locationCount > 1 ? `Operates ${f.locationCount} locations.` : 'Single location.',
  }
}

function bookingGapFactor(f: ScoringFeatures): ScoreFactor {
  const maxPoints = 12
  if (isTrue(f.onlineBookingGap)) {
    return {
      group: 'DIGITAL GAP',
      factor: 'online_booking_gap',
      points: maxPoints,
      maxPoints,
      explanation: 'No online booking was found — the single strongest FadeUp opportunity signal.',
    }
  }
  if (isFalse(f.onlineBookingGap)) {
    return {
      group: 'DIGITAL GAP',
      factor: 'online_booking_gap',
      points: 0,
      maxPoints,
      explanation: `Already booking online via ${f.bookingProviderKey} — no booking gap (see the migration potential score instead).`,
    }
  }
  return {
    group: 'DIGITAL GAP',
    factor: 'online_booking_gap',
    points: 0,
    maxPoints,
    explanation: 'Booking status UNKNOWN — enrichment has not successfully assessed this business. No points awarded either way.',
  }
}

function websiteGapFactor(f: ScoringFeatures): ScoreFactor {
  const maxPoints = 8
  if (isFalse(f.hasWebsite)) {
    return {
      group: 'DIGITAL GAP',
      factor: 'website_gap',
      points: maxPoints,
      maxPoints,
      explanation: 'No website found by any source — a large, clearly-addressable digital gap.',
    }
  }
  if (isTrue(f.hasWebsite)) {
    const quality = f.websiteQualityScore ?? 100
    // A poor website is still a gap, just a smaller one than none at all.
    const points = quality < 40 ? 5 : quality < 70 ? 3 : 0
    return {
      group: 'DIGITAL GAP',
      factor: 'website_gap',
      points,
      maxPoints,
      explanation: `Website quality scored ${quality}/100.`,
    }
  }
  return {
    group: 'DIGITAL GAP',
    factor: 'website_gap',
    points: 0,
    maxPoints,
    explanation: 'Website status UNKNOWN — the crawl did not complete, so no gap is claimed.',
  }
}

function mobileGapFactor(f: ScoringFeatures): ScoreFactor {
  const maxPoints = 5
  if (isFalse(f.mobileReady)) {
    return {
      group: 'DIGITAL GAP',
      factor: 'mobile_gap',
      points: maxPoints,
      maxPoints,
      explanation: 'The website is not mobile-ready, where most barber customers browse.',
    }
  }
  return {
    group: 'DIGITAL GAP',
    factor: 'mobile_gap',
    points: 0,
    maxPoints,
    explanation: isTrue(f.mobileReady) ? 'Website is mobile-ready.' : 'Mobile readiness UNKNOWN — no points awarded.',
  }
}

function competitorTenureFactor(f: ScoringFeatures): ScoreFactor {
  const maxPoints = 10
  if (f.competitorTenureDays === null) {
    return {
      group: 'COMPETITOR',
      factor: 'competitor_tenure',
      points: 0,
      maxPoints,
      explanation: 'Time on the current provider is unknown — FadeUp has not observed this business long enough yet.',
    }
  }
  // A business two-plus years into an incumbent is more open to change
  // than one that just finished onboarding.
  const points = f.competitorTenureDays >= 730 ? 10 : f.competitorTenureDays >= 365 ? 7 : f.competitorTenureDays >= 180 ? 4 : 1
  return {
    group: 'COMPETITOR',
    factor: 'competitor_tenure',
    points,
    maxPoints,
    explanation: `Observed on the current provider for ${Math.round(f.competitorTenureDays)} days.`,
  }
}

function digitalMaturityFactor(f: ScoringFeatures): ScoreFactor {
  const maxPoints = 15
  let points = 0
  const reasons: string[] = []

  if (isTrue(f.hasWebsite)) {
    points += 6
    reasons.push('has a website')
  }
  if (isTrue(f.mobileReady)) {
    points += 4
    reasons.push('mobile-ready')
  }
  if (isTrue(f.instagramPresence)) {
    points += 5
    reasons.push('active on Instagram')
  }

  return {
    group: 'DIGITAL MATURITY',
    factor: 'digital_maturity',
    points,
    maxPoints,
    explanation:
      reasons.length > 0
        ? `Digitally mature (${reasons.join(', ')}) — better equipped to evaluate and adopt a replacement.`
        : 'Limited observed digital maturity, or enrichment has not completed.',
  }
}

function triboolFactor(group: string, factor: string, maxPoints: number, value: Tribool, explanation: string): ScoreFactor {
  return {
    group,
    factor,
    points: isTrue(value) ? maxPoints : 0,
    maxPoints,
    explanation: isTrue(value)
      ? explanation
      : isFalse(value)
        ? `Not present: ${explanation.toLowerCase()}`
        : 'UNKNOWN — not observed, so no points awarded in either direction.',
  }
}

/** Maps a 0-100 sub-score onto a factor's point allocation. */
function scaledFactor(group: string, factor: string, maxPoints: number, value0to100: number, explanation: string): ScoreFactor {
  const clamped = Math.max(0, Math.min(100, value0to100))
  return {
    group,
    factor,
    points: Math.round((clamped / 100) * maxPoints),
    maxPoints,
    explanation: `${explanation} (sub-score ${clamped}/100)`,
  }
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}
