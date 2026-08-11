import { describe, expect, it } from 'vitest'
import { computeProspectScore, bucketFor, type ScoringInput } from '../src/scoring/score.js'

const baseline: ScoringInput = {
  categoryMatch: 'none',
  hasPhone: false,
  hasEmail: false,
  hasWebsite: false,
  hasSocialProfile: false,
  isBusinessSocialAccount: false,
  barberCount: null,
  isMultiLocation: false,
  isDenseUrbanMarket: false,
  bookingProviderDetected: false,
  sourceConfidenceAvg: 0,
  hasActivePublicPresence: false,
  hasWalkInIndicator: false,
}

describe('computeProspectScore', () => {
  it('scores a bare-minimum prospect as LOW with score 0', () => {
    const result = computeProspectScore(baseline)
    expect(result.score).toBe(0)
    expect(result.bucket).toBe('LOW')
  })

  it('every factor sums to exactly 100 max points', () => {
    const result = computeProspectScore(baseline)
    const maxTotal = result.factors.reduce((sum, f) => sum + f.maxPoints, 0)
    expect(maxTotal).toBe(100)
  })

  it('is deterministic — same input always produces the same output', () => {
    const a = computeProspectScore(baseline)
    const b = computeProspectScore(baseline)
    expect(a).toEqual(b)
  })

  it('a fully-qualified prospect scores HOT', () => {
    const result = computeProspectScore({
      categoryMatch: 'exact',
      hasPhone: true,
      hasEmail: true,
      hasWebsite: true,
      hasSocialProfile: true,
      isBusinessSocialAccount: true,
      barberCount: 4,
      isMultiLocation: true,
      isDenseUrbanMarket: true,
      bookingProviderDetected: true,
      sourceConfidenceAvg: 0.95,
      hasActivePublicPresence: true,
      hasWalkInIndicator: true,
    })
    expect(result.score).toBe(100)
    expect(result.bucket).toBe('HOT')
  })

  it('a partial category match earns partial category points, not zero', () => {
    const result = computeProspectScore({ ...baseline, categoryMatch: 'partial' })
    const categoryFactor = result.factors.find((f) => f.factor === 'category_match')
    expect(categoryFactor?.points).toBe(8)
    expect(categoryFactor?.points).toBeLessThan(categoryFactor?.maxPoints ?? 0)
  })

  it('every factor carries a human-readable explanation', () => {
    const result = computeProspectScore(baseline)
    for (const factor of result.factors) {
      expect(factor.explanation.length).toBeGreaterThan(0)
    }
  })
})

describe('bucketFor', () => {
  it('maps score ranges to the exact spec buckets', () => {
    expect(bucketFor(0)).toBe('LOW')
    expect(bucketFor(39)).toBe('LOW')
    expect(bucketFor(40)).toBe('MEDIUM')
    expect(bucketFor(69)).toBe('MEDIUM')
    expect(bucketFor(70)).toBe('HIGH')
    expect(bucketFor(84)).toBe('HIGH')
    expect(bucketFor(85)).toBe('HOT')
    expect(bucketFor(100)).toBe('HOT')
  })
})
