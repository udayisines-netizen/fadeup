import { describe, expect, it } from 'vitest'
import {
  BUSINESS_MODES,
  CAPABILITIES,
  PLANS,
  PLAN_IDS,
  RETENTION_SUITE,
  cycleMode,
  familyForPlan,
  hasFadePassport,
  hasRetentionSuite,
  liveCapabilities,
  parsePlanId,
  plannedCapabilities,
  plansForFamily,
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
    free: false,
    solo: false,
    salon_essential: false,
    salon_pro: true,
    salon_business: true,
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
    for (const planId of ['solo', 'salon_essential', 'multi_growth'] as PlanId[]) {
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
      'salon_essential',
      'salon_pro',
      'salon_business',
    ])
    expect(plansForMode('multi_location').map((p) => p.id)).toEqual([
      'multi_growth',
      'multi_pro',
      'multi_scale',
    ])
  })

  it('recommends exactly one plan wherever there is a choice, and none where there is not', () => {
    // Independent offers one plan, so there is nothing to recommend it against
    // and marking it "recommended" would be a badge with no comparison behind
    // it. The database asserts the same rule in 20260826110000.
    for (const mode of BUSINESS_MODES) {
      const plans = plansForMode(mode)
      const recommended = plans.filter((p) => p.recommended)
      expect(recommended).toHaveLength(plans.length > 1 ? 1 : 0)
    }
    expect(recommendedPlanFor('independent').id).toBe('solo')
    expect(recommendedPlanFor('barbershop').id).toBe('salon_pro')
    expect(recommendedPlanFor('multi_location').id).toBe('multi_pro')
  })

  it('keeps salon_pro and multi_pro distinct even though both read "Pro"', () => {
    // The single most dangerous ambiguity in the catalog. Anything that
    // branches on the display word conflates a 49 € single salon with a 149 €
    // five-salon group, so identity is the key and only the key.
    expect(PLANS.salon_pro.id).not.toBe(PLANS.multi_pro.id)
    expect(PLANS.salon_pro.family).toBe('salon')
    expect(PLANS.multi_pro.family).toBe('multi_salon')
    expect(PLANS.salon_pro.maxEstablishments).toBe(1)
    expect(PLANS.multi_pro.maxEstablishments).toBe(5)
  })

  it('maps every plan onto exactly one commercial family', () => {
    expect(plansForFamily('free').map((p) => p.id)).toEqual(['free'])
    expect(plansForFamily('independent').map((p) => p.id)).toEqual(['solo'])
    expect(plansForFamily('salon').map((p) => p.id)).toEqual([
      'salon_essential',
      'salon_pro',
      'salon_business',
    ])
    expect(plansForFamily('multi_salon').map((p) => p.id)).toEqual([
      'multi_growth',
      'multi_pro',
      'multi_scale',
    ])
    for (const planId of PLAN_IDS) {
      expect(familyForPlan(planId)).toBe(PLANS[planId].family)
    }
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
    const essential = PLANS.salon_essential.capabilities
    for (const capability of ['booking', 'walkIns', 'team', 'customers', 'passport'] as const) {
      expect(essential).toContain(capability)
    }
  })

  it('reserves multiple establishments for the Multi family', () => {
    for (const planId of ['free', 'solo', 'salon_essential', 'salon_pro', 'salon_business'] as PlanId[]) {
      expect(PLANS[planId].capabilities).not.toContain('multiLocation')
      expect(PLANS[planId].maxEstablishments).toBe(1)
    }
    expect(PLANS.multi_growth.maxEstablishments).toBe(2)
    expect(PLANS.multi_pro.maxEstablishments).toBe(5)
    expect(PLANS.multi_scale.maxEstablishments).toBe(10)
    for (const planId of ['multi_growth', 'multi_pro', 'multi_scale'] as PlanId[]) {
      expect(PLANS[planId].capabilities).toContain('multiLocation')
    }
  })

  it('caps the one-person plans at one professional and includes the team everywhere else', () => {
    // The Solo invariant, and the reason "team is included" is spelled as null
    // rather than as a large number: a large number is a multiplier waiting to
    // be discovered. The database enforces the same two facts.
    expect(PLANS.free.maxOperationalProfessionals).toBe(1)
    expect(PLANS.solo.maxOperationalProfessionals).toBe(1)
    for (const planId of [
      'salon_essential',
      'salon_pro',
      'salon_business',
      'multi_growth',
      'multi_pro',
      'multi_scale',
    ] as PlanId[]) {
      expect(PLANS[planId].maxOperationalProfessionals).toBeNull()
    }
  })

  it('makes Free network presence rather than a free operating system', () => {
    // If Free ever packaged as much as Solo, the 19 € upgrade would be a
    // formality and the free tier would quietly become the product.
    expect(PLANS.free.capabilities).toContain('passport')
    expect(PLANS.free.capabilities).toContain('marketplace')
    expect(PLANS.free.capabilities).toContain('publicProfile')
    for (const withheld of ['booking', 'customers', 'customerHistory', 'team', 'liveQueue'] as const) {
      expect(PLANS.free.capabilities).not.toContain(withheld)
    }
    expect(PLANS.free.capabilities.length).toBeLessThan(PLANS.solo.capabilities.length)
  })

  it('puts Free on no marketing rail', () => {
    // It is the network state beneath the rail, not a fourth column competing
    // with the paid plans.
    expect(PLANS.free.mode).toBeNull()
    for (const mode of BUSINESS_MODES) {
      expect(plansForMode(mode).map((p) => p.id)).not.toContain('free')
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
    expect(liveCapabilities('salon_pro')).not.toContain('returnCycles')
    expect(plannedCapabilities('salon_pro')).toEqual(expect.arrayContaining([...RETENTION_SUITE]))
  })

  it('still gives every plan real, shipped functionality to sell', () => {
    for (const planId of PLAN_IDS) {
      // Free is presence, so it is deliberately the smallest set in the
      // catalog; every PAID plan carries the whole shipped foundation.
      expect(liveCapabilities(planId).length).toBeGreaterThanOrEqual(planId === 'free' ? 5 : 10)
      expect(liveCapabilities(planId)).toContain('passport')
    }
  })

  it('gives Pro a live differentiator over Essential, not only a planned one', () => {
    // If the only difference between two plans were unbuilt, the upgrade would
    // be a promise rather than a product.
    const essential = new Set(liveCapabilities('salon_essential'))
    const extra = liveCapabilities('salon_pro').filter((id) => !essential.has(id))
    expect(extra).toEqual(expect.arrayContaining(['liveQueue', 'chairs', 'queueDisplay']))
  })
})

describe('plan intent from an untrusted string', () => {
  it('accepts the canonical identifiers', () => {
    expect(parsePlanId('salon_pro')).toBe('salon_pro')
    expect(parsePlanId('multi_scale')).toBe('multi_scale')
    expect(parsePlanId('free')).toBe('free')
  })

  it('maps the pre-R2 shop_* keys forward instead of dropping the visitor intent', () => {
    // /pro/register?plan=shop_pro links exist in the wild. Returning null for
    // them would silently discard a stated intent; they are aliases, and they
    // are valid nowhere else in the system.
    expect(parsePlanId('shop_essential')).toBe('salon_essential')
    expect(parsePlanId('shop_pro')).toBe('salon_pro')
    expect(parsePlanId('shop_business')).toBe('salon_business')
  })

  it('rejects anything else rather than passing it through', () => {
    expect(parsePlanId('enterprise')).toBeNull()
    expect(parsePlanId('SALON_PRO')).toBeNull()
    expect(parsePlanId('')).toBeNull()
    expect(parsePlanId(null)).toBeNull()
    expect(parsePlanId('salon_pro; drop table plans')).toBeNull()
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
