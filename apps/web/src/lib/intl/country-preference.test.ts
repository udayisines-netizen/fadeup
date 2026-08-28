import { beforeEach, describe, expect, it } from 'vitest'
import {
  ANYWHERE,
  effectiveCountry,
  getExplicitCountry,
  setExplicitCountry,
} from '@/lib/intl/country-preference'

describe('country preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists an explicit choice across reads — criterion AC', () => {
    setExplicitCountry('FR')
    expect(getExplicitCountry()).toBe('FR')
  })

  it('normalizes case, so a link carrying ?country=fr is not a different choice', () => {
    setExplicitCountry('fr')
    expect(getExplicitCountry()).toBe('FR')
  })

  it('refuses a country FadeUp knows nothing about, rather than storing it', () => {
    // A stored code with no metadata would later be used as a filter that
    // silently matches nothing, and the customer would see an empty
    // marketplace with no discoverable cause.
    setExplicitCountry('ZZ')
    expect(getExplicitCountry()).toBeNull()
  })

  it('treats "anywhere" as a stored CHOICE, not as the absence of one', () => {
    setExplicitCountry(ANYWHERE)
    expect(getExplicitCountry()).toBe(ANYWHERE)
  })

  it('lets an explicit choice outrank GeoIP', () => {
    setExplicitCountry('GB')
    expect(effectiveCountry('FR')).toBe('GB')
  })

  it('keeps "anywhere" switched off on the next visit, which is the whole point', () => {
    // Clearing the key instead would resurrect the GeoIP filter the customer
    // just turned off — they would re-fight it on every visit.
    setExplicitCountry(ANYWHERE)
    expect(effectiveCountry('FR')).toBeNull()
    expect(getExplicitCountry()).toBe(ANYWHERE)
  })

  it('falls back to GeoIP when the customer has never chosen', () => {
    expect(effectiveCountry('FR')).toBe('FR')
  })

  it('filters by nothing when neither a choice nor a detection exists', () => {
    expect(effectiveCountry(null)).toBeNull()
  })

  it('clearing the choice returns to automatic, which is a THIRD state', () => {
    setExplicitCountry('GB')
    setExplicitCountry(null)
    expect(getExplicitCountry()).toBeNull()
    expect(effectiveCountry('FR')).toBe('FR')
  })
})
