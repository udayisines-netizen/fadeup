import type { ScoringFeatures } from './fit-scores.js'
import { isFalse, isTrue } from '../features/tribool.js'

/**
 * Deterministic prospect segmentation. A prospect may belong to many
 * segments at once (spec §21), and each membership carries a rationale so
 * the /platform segment board is explainable rather than a black box.
 *
 * Mirrors the seeded keys in public.prospect_segment_definitions.
 */

export const SEGMENTER_VERSION = 'segments-v1'

export type SegmentKey =
  | 'NO_BOOKING'
  | 'COMPETITOR_USER'
  | 'COMPETITOR_SWITCH_HIGH'
  | 'INDEPENDENT_BARBER'
  | 'MULTI_BARBER_SHOP'
  | 'HIGH_REPUTATION'
  | 'HIGH_DIGITAL_GAP'
  | 'HIGH_FADEUP_FIT'
  | 'HIGH_MIGRATION_POTENTIAL'
  | 'REVIEW_REQUIRED'

export interface SegmentMembership {
  segmentKey: SegmentKey
  rationale: Record<string, unknown>
}

export interface SegmentationInput {
  features: ScoringFeatures
  fadeUpFitScore: number
  migrationPotentialScore: number
  /** True when an identity match or locale determination needs a human decision. */
  needsHumanReview: boolean
  reviewReasons: string[]
}

export function computeSegments(input: SegmentationInput): SegmentMembership[] {
  const { features: f } = input
  const segments: SegmentMembership[] = []

  const add = (segmentKey: SegmentKey, rationale: Record<string, unknown>): void => {
    segments.push({ segmentKey, rationale })
  }

  // NO_BOOKING requires an OBSERVED absence. UNKNOWN booking must never
  // land a prospect in a "they have no booking" campaign — that would send
  // a barber who has used Planity for three years a message telling them
  // they cannot take bookings online.
  if (isFalse(f.bookingDetected) && f.bookingProviderKey === 'NO_BOOKING') {
    add('NO_BOOKING', {
      booking_detected: f.bookingDetected,
      provider: f.bookingProviderKey,
      note: 'Enrichment completed and found no booking affordance.',
    })
  }

  const onCompetitor =
    isTrue(f.bookingDetected) &&
    !['NO_BOOKING', 'UNKNOWN', 'CUSTOM_BOOKING'].includes(f.bookingProviderKey)

  if (onCompetitor) {
    add('COMPETITOR_USER', { provider: f.bookingProviderKey, tenure_days: f.competitorTenureDays })

    if (input.migrationPotentialScore >= 70) {
      add('COMPETITOR_SWITCH_HIGH', {
        provider: f.bookingProviderKey,
        migration_potential_score: input.migrationPotentialScore,
      })
    }
  }

  if (f.shopType === 'independent_barber') {
    add('INDEPENDENT_BARBER', { shop_type: f.shopType })
  }

  if (f.barberCount !== null && f.barberCount >= 2) {
    add('MULTI_BARBER_SHOP', { barber_count: f.barberCount })
  }

  if (f.rating !== null && f.reviewCount !== null && f.rating >= 4.5 && f.reviewCount >= 50) {
    add('HIGH_REPUTATION', { rating: f.rating, review_count: f.reviewCount })
  }

  if (f.digitalGapScore >= 60) {
    add('HIGH_DIGITAL_GAP', { digital_gap_score: f.digitalGapScore })
  }

  if (input.fadeUpFitScore >= 70) {
    add('HIGH_FADEUP_FIT', { fadeup_fit_score: input.fadeUpFitScore })
  }

  if (input.migrationPotentialScore >= 70) {
    add('HIGH_MIGRATION_POTENTIAL', { migration_potential_score: input.migrationPotentialScore })
  }

  if (input.needsHumanReview) {
    add('REVIEW_REQUIRED', { reasons: input.reviewReasons })
  }

  return segments
}
