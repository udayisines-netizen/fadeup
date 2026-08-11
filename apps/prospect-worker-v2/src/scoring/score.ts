export type ScoreBucket = 'LOW' | 'MEDIUM' | 'HIGH' | 'HOT'

export interface ScoreFactor {
  factor: string
  points: number
  maxPoints: number
  explanation: string
}

export interface ScoringInput {
  /** 'exact' = source tagged this as a hairdresser/barber category directly (OSM shop=hairdresser, Sirene NAF 9602A, Google barber_shop type). 'partial' = a looser/fallback match. 'none' = no category signal at all. */
  categoryMatch: 'exact' | 'partial' | 'none'
  hasPhone: boolean
  hasEmail: boolean
  hasWebsite: boolean
  hasSocialProfile: boolean
  isBusinessSocialAccount: boolean
  barberCount: number | null
  isMultiLocation: boolean
  isDenseUrbanMarket: boolean
  bookingProviderDetected: boolean
  /** Average confidence (0-1) across every prospect_source_records row contributing to this prospect. */
  sourceConfidenceAvg: number
  /** Recent social media_count/posting activity observed. */
  hasActivePublicPresence: boolean
  /** Any legitimately-observed walk-in signal (e.g. OSM opening_hours present, or "walk-ins welcome" found on the website). */
  hasWalkInIndicator: boolean
}

export interface ScoringResult {
  score: number
  bucket: ScoreBucket
  factors: ScoreFactor[]
}

/**
 * Deterministic 0-100 scoring — NO AI, per spec. Every factor's max_points
 * is fixed and the 13 factors sum to exactly 100, so `score` is always
 * `sum(factors[].points)` clamped to [0, 100] — never a black box. Bucket
 * thresholds match the spec exactly: 0-39 LOW, 40-69 MEDIUM, 70-84 HIGH,
 * 85-100 HOT.
 */
export function computeProspectScore(input: ScoringInput): ScoringResult {
  const factors: ScoreFactor[] = [
    categoryMatchFactor(input),
    boolFactor('has_phone', 8, input.hasPhone, 'Business phone number on record.'),
    boolFactor('has_email', 7, input.hasEmail, 'Business email address on record.'),
    boolFactor('has_website', 12, input.hasWebsite, 'Has a working business website.'),
    socialPresenceFactor(input),
    barberCountFactor(input),
    boolFactor('multi_location', 5, input.isMultiLocation, 'Operates more than one location.'),
    boolFactor('dense_urban_market', 5, input.isDenseUrbanMarket, 'Located in a dense urban market.'),
    boolFactor('booking_provider', 10, input.bookingProviderDetected, 'A known online booking provider was detected on the website.'),
    digitalMaturityFactor(input),
    sourceConfidenceFactor(input),
    boolFactor('active_public_presence', 5, input.hasActivePublicPresence, 'Recent, active public social presence observed.'),
    boolFactor('walk_in_indicator', 2, input.hasWalkInIndicator, 'A legitimate walk-in signal was observed (posted hours, on-site text).'),
  ]

  const score = Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.points, 0)))

  return { score, bucket: bucketFor(score), factors }
}

export function bucketFor(score: number): ScoreBucket {
  if (score >= 85) return 'HOT'
  if (score >= 70) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

function boolFactor(factor: string, maxPoints: number, met: boolean, explanation: string): ScoreFactor {
  return { factor, points: met ? maxPoints : 0, maxPoints, explanation }
}

function categoryMatchFactor(input: ScoringInput): ScoreFactor {
  const maxPoints = 18
  const points = input.categoryMatch === 'exact' ? 18 : input.categoryMatch === 'partial' ? 8 : 0
  return {
    factor: 'category_match',
    points,
    maxPoints,
    explanation:
      input.categoryMatch === 'exact'
        ? 'A source directly categorized this business as a barbershop/hairdresser.'
        : input.categoryMatch === 'partial'
          ? 'A source loosely/indirectly suggested a barber/hairdresser category.'
          : 'No source provided a category signal for this business.',
  }
}

function socialPresenceFactor(input: ScoringInput): ScoreFactor {
  const maxPoints = 10
  const points = input.isBusinessSocialAccount ? 10 : input.hasSocialProfile ? 5 : 0
  return {
    factor: 'social_presence',
    points,
    maxPoints,
    explanation: input.isBusinessSocialAccount
      ? 'Has a verified business social media account.'
      : input.hasSocialProfile
        ? 'Has a personal/unverified social media presence.'
        : 'No social media presence found.',
  }
}

function barberCountFactor(input: ScoringInput): ScoreFactor {
  const maxPoints = 7
  const points = (input.barberCount ?? 0) >= 2 ? 7 : 0
  return {
    factor: 'multiple_barbers',
    points,
    maxPoints,
    explanation:
      input.barberCount === null
        ? 'Barber headcount unknown.'
        : input.barberCount >= 2
          ? `${input.barberCount} barbers observed at this location.`
          : 'Appears to be a single-barber operation.',
  }
}

function digitalMaturityFactor(input: ScoringInput): ScoreFactor {
  const maxPoints = 5
  const mature = input.hasWebsite && input.hasSocialProfile && input.bookingProviderDetected
  return {
    factor: 'digital_maturity',
    points: mature ? 5 : 0,
    maxPoints,
    explanation: mature
      ? 'Website, social presence, and online booking are all present — high digital maturity.'
      : 'Missing one or more of website/social/online-booking — limited digital maturity.',
  }
}

function sourceConfidenceFactor(input: ScoringInput): ScoreFactor {
  const maxPoints = 6
  const points = input.sourceConfidenceAvg >= 0.8 ? 6 : input.sourceConfidenceAvg >= 0.5 ? 3 : 0
  return {
    factor: 'source_confidence',
    points,
    maxPoints,
    explanation: `Average source confidence across contributing records: ${(input.sourceConfidenceAvg * 100).toFixed(0)}%.`,
  }
}
