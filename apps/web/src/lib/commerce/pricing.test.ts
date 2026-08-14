import { describe, expect, it } from 'vitest'
import { formatPrice, pricingForRegion, regionForCountry } from '@/lib/commerce/pricing'

describe('commercial pricing', () => {
  it('bills by where the visitor is, not what they read', () => {
    expect(regionForCountry('FR')).toBe('eu')
    expect(regionForCountry('DE')).toBe('eu')
    expect(regionForCountry('GB')).toBe('uk')
    expect(regionForCountry('US')).toBe('us')
    expect(regionForCountry('CA')).toBe('ca')
    expect(regionForCountry('CH')).toBe('ch')
  })

  it('falls back to the international region rather than guessing a local currency', () => {
    expect(regionForCountry(null)).toBe('intl')
    expect(regionForCountry(undefined)).toBe('intl')
    expect(regionForCountry('ZZ')).toBe('intl')
  })

  it('accepts a lower-case country code, because headers are not consistent', () => {
    expect(regionForCountry('fr')).toBe('eu')
  })

  it('gives each region its own currency', () => {
    expect(pricingForRegion('eu').currency).toBe('EUR')
    expect(pricingForRegion('uk').currency).toBe('GBP')
    expect(pricingForRegion('us').currency).toBe('USD')
    expect(pricingForRegion('ca').currency).toBe('CAD')
    expect(pricingForRegion('ch').currency).toBe('CHF')
  })

  it('keeps the currency of the REGION when the interface language differs', () => {
    // A French speaker in Texas: French words, dollars. Language chooses the
    // wording and the grouping; geography chooses the money.
    const us = pricingForRegion('us')
    expect(formatPrice(us, 'fr')).toContain('$')
    expect(formatPrice(us, 'fr')).not.toContain('€')

    // And the reverse: English in Paris is still euros.
    const eu = pricingForRegion('eu')
    expect(formatPrice(eu, 'en')).toContain('€')
    expect(formatPrice(eu, 'en')).not.toContain('$')
  })

  it('formats a whole amount without decimals, so it reads as a price', () => {
    expect(formatPrice(pricingForRegion('eu'), 'en')).toBe('€49')
  })

  it('survives a nonsense locale tag instead of throwing on the pricing section', () => {
    expect(() => formatPrice(pricingForRegion('eu'), 'not-a-locale!!')).not.toThrow()
    expect(formatPrice(pricingForRegion('eu'), 'not-a-locale!!')).toContain('49')
  })

  it('stores money in minor units so no float arithmetic touches a price', () => {
    for (const region of ['eu', 'uk', 'us', 'ca', 'ch', 'intl'] as const) {
      expect(Number.isInteger(pricingForRegion(region).monthlyAmountMinor)).toBe(true)
    }
  })
})
