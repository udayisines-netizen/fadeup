import { describe, expect, it } from 'vitest'
import { computeFreshness } from '@/lib/personalization'

const NOW = new Date('2026-08-13T12:00:00Z')

describe('computeFreshness', () => {
  it('returns all-null when there is no completed appointment yet — never fabricates a first-use fact', () => {
    const result = computeFreshness(null, 'every_2_weeks', NOW)
    expect(result).toEqual({ daysSinceLastCut: null, preferredIntervalDays: 14, isOverdue: false })
  })

  it('computes days since last cut and flags overdue once the preferred interval has passed', () => {
    const eighteenDaysAgo = new Date(NOW.getTime() - 18 * 86_400_000).toISOString()
    const result = computeFreshness(eighteenDaysAgo, 'every_2_weeks', NOW)
    expect(result.daysSinceLastCut).toBe(18)
    expect(result.preferredIntervalDays).toBe(14)
    expect(result.isOverdue).toBe(true)
  })

  it('is not overdue when within the preferred interval', () => {
    const fiveDaysAgo = new Date(NOW.getTime() - 5 * 86_400_000).toISOString()
    const result = computeFreshness(fiveDaysAgo, 'every_2_weeks', NOW)
    expect(result.isOverdue).toBe(false)
  })

  it('is overdue exactly at the boundary (days since cut equals the interval)', () => {
    const fourteenDaysAgo = new Date(NOW.getTime() - 14 * 86_400_000).toISOString()
    const result = computeFreshness(fourteenDaysAgo, 'every_2_weeks', NOW)
    expect(result.isOverdue).toBe(true)
  })

  it('never claims overdue when the customer answered "depends" — no honest number to compare against', () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 86_400_000).toISOString()
    const result = computeFreshness(thirtyDaysAgo, 'depends', NOW)
    expect(result.preferredIntervalDays).toBeNull()
    expect(result.isOverdue).toBe(false)
  })

  it('never claims overdue when the customer never answered the frequency question', () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 86_400_000).toISOString()
    const result = computeFreshness(thirtyDaysAgo, null, NOW)
    expect(result.preferredIntervalDays).toBeNull()
    expect(result.isOverdue).toBe(false)
  })
})
