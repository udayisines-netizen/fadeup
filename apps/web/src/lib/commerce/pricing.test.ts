import { describe, expect, it } from 'vitest'
import {
  currencyForRegion,
  formatPlanPrice,
  missingPlanPrices,
  planPriceMinor,
  regionForCountry,
  PRICING_REGIONS,
} from '@/lib/commerce/pricing'
import { PLAN_IDS, type PlanId } from '@/lib/commerce/plans'

describe('commercial region', () => {
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
    expect(currencyForRegion('eu').currency).toBe('EUR')
    expect(currencyForRegion('uk').currency).toBe('GBP')
    expect(currencyForRegion('us').currency).toBe('USD')
    expect(currencyForRegion('ca').currency).toBe('CAD')
    expect(currencyForRegion('ch').currency).toBe('CHF')
    expect(currencyForRegion('intl').currency).toBe('EUR')
  })
})

describe('the France reference catalog', () => {
  // These seven numbers are the commercially agreed France prices. If this test
  // fails, someone changed what FadeUp charges — which is allowed, but it is a
  // commercial decision and not a refactor, so it has to be made deliberately
  // here rather than noticed later on a live pricing page.
  const FRANCE_EUROS: Record<PlanId, number> = {
    solo: 19,
    shop_essential: 29,
    shop_pro: 49,
    shop_business: 79,
    multi_growth: 99,
    multi_pro: 149,
    multi_scale: 249,
  }

  const region = regionForCountry('FR')

  for (const [planId, euros] of Object.entries(FRANCE_EUROS) as [PlanId, number][]) {
    it(`charges ${euros} € per month for ${planId} in France`, () => {
      expect(planPriceMinor(planId, region)).toBe(euros * 100)
    })
  }

  it('reads as a price, not an invoice line', () => {
    expect(formatPlanPrice('shop_pro', 'eu', 'en')).toBe('€49')
  })
})

describe('language never changes the currency', () => {
  it('keeps euros for a French shop read in English', () => {
    const formatted = formatPlanPrice('shop_pro', 'eu', 'en')
    expect(formatted).toContain('€')
    expect(formatted).not.toContain('$')
  })

  it('keeps dollars for an American shop read in French', () => {
    // A French speaker in Texas: French words, dollars. Language chooses the
    // wording and the grouping; geography chooses the money.
    const formatted = formatPlanPrice('shop_pro', 'us', 'fr')
    expect(formatted).toContain('$')
    expect(formatted).not.toContain('€')
  })

  it('shows the same France amount whichever language the page is in', () => {
    for (const locale of ['fr', 'en', 'ar', 'ja', 'zh-CN']) {
      expect(formatPlanPrice('multi_scale', 'eu', locale)).toContain('249')
    }
  })

  it('survives a nonsense locale tag instead of throwing on the pricing section', () => {
    expect(() => formatPlanPrice('solo', 'eu', 'not-a-locale!!')).not.toThrow()
    expect(formatPlanPrice('solo', 'eu', 'not-a-locale!!')).toContain('19')
  })
})

describe('the price table itself', () => {
  it('prices every plan in every region', () => {
    expect(missingPlanPrices()).toEqual([])
  })

  it('stores money in minor units so no float arithmetic touches a price', () => {
    for (const region of PRICING_REGIONS) {
      for (const planId of PLAN_IDS) {
        expect(Number.isInteger(planPriceMinor(planId, region))).toBe(true)
      }
    }
  })

  it('keeps the ladder ascending within each family, everywhere', () => {
    // A cheaper plan that costs more than the one above it is a commercial bug
    // no amount of design can hide, and it is easy to introduce by editing one
    // region and not the rest.
    const families: PlanId[][] = [
      ['shop_essential', 'shop_pro', 'shop_business'],
      ['multi_growth', 'multi_pro', 'multi_scale'],
    ]
    for (const region of PRICING_REGIONS) {
      for (const family of families) {
        for (let i = 1; i < family.length; i += 1) {
          expect(planPriceMinor(family[i]!, region)).toBeGreaterThan(planPriceMinor(family[i - 1]!, region))
        }
      }
      expect(planPriceMinor('shop_essential', region)).toBeGreaterThan(planPriceMinor('solo', region))
      expect(planPriceMinor('multi_growth', region)).toBeGreaterThan(planPriceMinor('shop_business', region))
    }
  })

  it('never converts one region into another', () => {
    // Not a rate check — a shape check. Every region is its own literal column,
    // so no two regions should be derivable from each other by a single factor.
    const eu = PLAN_IDS.map((id) => planPriceMinor(id, 'eu'))
    const us = PLAN_IDS.map((id) => planPriceMinor(id, 'us'))
    const ratios = eu.map((amount, index) => us[index]! / amount)
    expect(new Set(ratios.map((r) => r.toFixed(4))).size).toBeGreaterThan(1)
  })
})
