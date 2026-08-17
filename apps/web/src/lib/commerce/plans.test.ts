import { describe, expect, it } from 'vitest'
import {
  BUSINESS_MODES,
  CAPABILITIES,
  PLANS,
  PLAN_IDS,
  RETENTION_SUITE,
  cycleMode,
  hasFadePassport,
  hasRetentionSuite,
  liveCapabilities,
  parsePlanId,
  plannedCapabilities,
  plansForMode,
  recommendedPlanFor,
  type PlanId,
} from '@/lib/commerce/plans'

describe('Fade Passport belongs to everyone', () => {
  // The single most important commercial invariant in the product. A Passport
  // is customer-owned and travels between shops; a plan that does not include
  // it would break the network for the customer, not just the shop. If this
  // test ever fails, the fix is the catalog, never the test.
  for (const planId of PLAN_IDS) {
    it(`includes Fade Passport in ${planId}`, () => {
      expect(hasFadePassport(planId)).toBe(true)
    })
  }

  it('never treats Passport as an upgrade', () => {
    expect(CAPABILITIES.passport.status).toBe('live')
    expect(RETENTION_SUITE).not.toContain('passport')
  })
})

describe('the Retention Suite is Pro-level value', () => {
  const EXPECTED: Record<PlanId, boolean> = {
    solo: false,
    shop_essential: false,
    shop_pro: true,
    shop_business: true,
    multi_growth: false,
    multi_pro: true,
    multi_scale: true,
  }

  for (const [planId, expected] of Object.entries(EXPECTED) as [PlanId, boolean][]) {
    it(`${expected ? 'includes' : 'excludes'} retention for ${planId}`, () => {
      expect(hasRetentionSuite(planId)).toBe(expected)
    })
  }

  it('separates remembering a customer from chasing one', () => {
    // Passport, history and manual rebooking are the "we remember" half and are
    // in every plan. Everything that analyses, predicts or automates is the
    // other half, and is what Pro pays for.
    for (const planId of ['solo', 'shop_essential', 'multi_growth'] as PlanId[]) {
      expect(PLANS[planId].capabilities).toContain('customerHistory')
      expect(PLANS[planId].capabilities).toContain('manualRebook')
      for (const retention of RETENTION_SUITE) {
        expect(PLANS[planId].capabilities).not.toContain(retention)
      }
    }
  })

  it('is all-or-nothing — no plan gets half a suite', () => {
    for (const planId of PLAN_IDS) {
      const present = RETENTION_SUITE.filter((id) => PLANS[planId].capabilities.includes(id))
      expect(present.length === 0 || present.length === RETENTION_SUITE.length).toBe(true)
    }
  })
})

describe('the plan ladder', () => {
  it('offers exactly one Independent plan, three Barbershop and three Multi', () => {
    expect(plansForMode('independent').map((p) => p.id)).toEqual(['solo'])
    expect(plansForMode('barbershop').map((p) => p.id)).toEqual([
      'shop_essential',
      'shop_pro',
      'shop_business',
    ])
    expect(plansForMode('multi_location').map((p) => p.id)).toEqual([
      'multi_growth',
      'multi_pro',
      'multi_scale',
    ])
  })

  it('recommends exactly one plan per business mode', () => {
    for (const mode of BUSINESS_MODES) {
      const recommended = plansForMode(mode).filter((p) => p.recommended)
      expect(recommended).toHaveLength(1)
    }
    expect(recommendedPlanFor('independent').id).toBe('solo')
    expect(recommendedPlanFor('barbershop').id).toBe('shop_pro')
    expect(recommendedPlanFor('multi_location').id).toBe('multi_pro')
  })

  it('never removes a capability as the price goes up', () => {
    // Within a family, each tier is a superset of the one below. An "upgrade"
    // that silently drops something is the fastest way to lose a shop.
    for (const mode of BUSINESS_MODES) {
      const plans = plansForMode(mode)
      for (let i = 1; i < plans.length; i += 1) {
        for (const capability of plans[i - 1]!.capabilities) {
          expect(plans[i]!.capabilities).toContain(capability)
        }
      }
    }
  })

  it('gives Solo a genuinely useful product rather than a crippled salon plan', () => {
    // Solo is smaller on purpose, not worse on purpose: a barber working alone
    // still gets discovery, booking, walk-ins, the live queue and Passport.
    const solo = PLANS.solo.capabilities
    for (const capability of ['marketplace', 'booking', 'walkIns', 'liveQueue', 'passport'] as const) {
      expect(solo).toContain(capability)
    }
  })

  it('keeps Essential a real shop product', () => {
    const essential = PLANS.shop_essential.capabilities
    for (const capability of ['booking', 'walkIns', 'team', 'customers', 'passport'] as const) {
      expect(essential).toContain(capability)
    }
  })

  it('reserves multiple locations for the Multi family', () => {
    for (const planId of ['solo', 'shop_essential', 'shop_pro', 'shop_business'] as PlanId[]) {
      expect(PLANS[planId].capabilities).not.toContain('multiLocation')
      expect(PLANS[planId].locationLimit).toBe(1)
    }
    for (const planId of ['multi_growth', 'multi_pro', 'multi_scale'] as PlanId[]) {
      expect(PLANS[planId].capabilities).toContain('multiLocation')
      expect(PLANS[planId].locationLimit).toBeGreaterThan(1)
    }
  })
})

describe('nothing unbuilt is advertised as available', () => {
  it('marks every capability either live or planned, with evidence', () => {
    for (const capability of Object.values(CAPABILITIES)) {
      expect(['live', 'planned']).toContain(capability.status)
      expect(capability.evidence.length).toBeGreaterThan(20)
    }
  })

  it('keeps the whole Retention Suite out of the live set until it is built', () => {
    // The packaging decision is made; the product is not shipped. Marketing may
    // say "coming to Pro", never "included".
    for (const id of RETENTION_SUITE) {
      expect(CAPABILITIES[id].status).toBe('planned')
    }
    expect(liveCapabilities('shop_pro')).not.toContain('returnCycles')
    expect(plannedCapabilities('shop_pro')).toEqual(expect.arrayContaining([...RETENTION_SUITE]))
  })

  it('still gives every plan real, shipped functionality to sell', () => {
    for (const planId of PLAN_IDS) {
      expect(liveCapabilities(planId).length).toBeGreaterThanOrEqual(10)
      expect(liveCapabilities(planId)).toContain('passport')
    }
  })

  it('gives Pro a live differentiator over Essential, not only a planned one', () => {
    // If the only difference between two plans were unbuilt, the upgrade would
    // be a promise rather than a product.
    const essential = new Set(liveCapabilities('shop_essential'))
    const extra = liveCapabilities('shop_pro').filter((id) => !essential.has(id))
    expect(extra).toEqual(expect.arrayContaining(['liveQueue', 'chairs', 'queueDisplay']))
  })
})

describe('plan intent from an untrusted string', () => {
  it('accepts the canonical identifiers', () => {
    expect(parsePlanId('shop_pro')).toBe('shop_pro')
    expect(parsePlanId('multi_scale')).toBe('multi_scale')
  })

  it('rejects anything else rather than passing it through', () => {
    expect(parsePlanId('enterprise')).toBeNull()
    expect(parsePlanId('SHOP_PRO')).toBeNull()
    expect(parsePlanId('')).toBeNull()
    expect(parsePlanId(null)).toBeNull()
    expect(parsePlanId('shop_pro; drop table plans')).toBeNull()
  })
})

describe('business mode cycling', () => {
  it('loops forwards through all three', () => {
    expect(cycleMode('independent', 1)).toBe('barbershop')
    expect(cycleMode('barbershop', 1)).toBe('multi_location')
    expect(cycleMode('multi_location', 1)).toBe('independent')
  })

  it('loops backwards too', () => {
    expect(cycleMode('independent', -1)).toBe('multi_location')
    expect(cycleMode('multi_location', -1)).toBe('barbershop')
    expect(cycleMode('barbershop', -1)).toBe('independent')
  })
})
