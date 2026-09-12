import { describe, expect, it } from 'vitest'
import {
  annualMonthsFree,
  billingSituation,
  canStartTrial,
  daysUntil,
  intervalAvailable,
  needsQuote,
  parseBillingRefusal,
  plansFor,
  priceFor,
  tierFor,
  type BillingRow,
  type CatalogPlan,
  type TrialRow,
} from '@/features/pro-billing/lib/billing'

const NOW = new Date('2026-09-12T12:00:00.000Z')

const billing = (overrides: Partial<BillingRow> = {}): BillingRow => ({
  subscription_status: 'active',
  plan_key: 'salon_pro',
  billing_interval: 'month',
  current_period_start: '2026-09-01T00:00:00.000Z',
  current_period_end: '2026-10-01T00:00:00.000Z',
  cancel_at_period_end: false,
  grace_until: null,
  scheduled_plan_key: null,
  scheduled_interval: null,
  scheduled_effective_at: null,
  stripe_customer_id: 'cus_x',
  stripe_subscription_id: 'sub_x',
  ...overrides,
})

const trial = (overrides: Partial<TrialRow> = {}): TrialRow => ({
  plan_key: 'salon_pro',
  started_at: '2026-09-05T00:00:00.000Z',
  ends_at: '2026-09-19T00:00:00.000Z',
  status: 'active',
  ...overrides,
})

const plan = (overrides: Partial<CatalogPlan> = {}): CatalogPlan => ({
  plan_key: 'salon_pro',
  commercial_family: 'salon',
  display_name: 'Pro',
  tier: 2,
  is_recommended: true,
  is_available: true,
  price_minor: 4900,
  annual_price_minor: 49000,
  annual_months_charged: 10,
  price_currency: 'EUR',
  min_establishments: 1,
  max_establishments: 1,
  max_operational_professionals: null,
  monthly_stripe_price_id: 'price_m',
  annual_stripe_price_id: 'price_y',
  live_capabilities: [],
  ...overrides,
})

describe('daysUntil', () => {
  it('compte des jours entiers et jamais un négatif', () => {
    expect(daysUntil('2026-09-19T00:00:00.000Z', NOW)).toBe(7)
    expect(daysUntil('2026-09-12T13:00:00.000Z', NOW)).toBe(1)
    expect(daysUntil('2026-09-01T00:00:00.000Z', NOW)).toBe(0)
    expect(daysUntil(null, NOW)).toBe(0)
  })
})

describe('billingSituation — la grâce passe avant « actif »', () => {
  it('un salon sans abonnement ni essai est au Free', () => {
    expect(billingSituation(null, null, NOW)).toEqual({ kind: 'free' })
  })

  it('un essai actif est un essai, avec ses jours restants', () => {
    expect(billingSituation(null, trial(), NOW)).toEqual({
      kind: 'trial',
      endsAt: '2026-09-19T00:00:00.000Z',
      daysLeft: 7,
      planKey: 'salon_pro',
    })
  })

  it('un essai échu est nommé comme tel — rien n’a été supprimé', () => {
    expect(billingSituation(null, trial({ status: 'expired' }), NOW)).toEqual({
      kind: 'trial-expired',
      endsAt: '2026-09-19T00:00:00.000Z',
    })
  })

  it('un abonnement sain est actif, avec son intervalle et son échéance', () => {
    expect(billingSituation(billing(), null, NOW)).toEqual({
      kind: 'active',
      planKey: 'salon_pro',
      interval: 'month',
      renewsAt: '2026-10-01T00:00:00.000Z',
    })
  })

  it('la GRÂCE prime sur « actif » : c’est la seule chose à faire', () => {
    const situation = billingSituation(
      billing({ subscription_status: 'past_due', grace_until: '2026-09-17T00:00:00.000Z' }),
      null,
      NOW,
    )
    expect(situation).toEqual({
      kind: 'grace',
      planKey: 'salon_pro',
      graceUntil: '2026-09-17T00:00:00.000Z',
      daysLeft: 5,
    })
  })

  it('past_due sans date de grâce ne FABRIQUE pas de date', () => {
    const situation = billingSituation(billing({ subscription_status: 'past_due' }), null, NOW)
    expect(situation).toEqual({ kind: 'grace', planKey: 'salon_pro', graceUntil: '', daysLeft: 0 })
  })

  it('une grâce ÉCHUE ne masque plus l’état réel', () => {
    const situation = billingSituation(
      billing({ subscription_status: 'canceled', grace_until: '2026-09-01T00:00:00.000Z' }),
      null,
      NOW,
    )
    expect(situation).toEqual({ kind: 'canceled', planKey: 'salon_pro' })
  })

  it('une résiliation programmée est dite avant « actif »', () => {
    expect(billingSituation(billing({ cancel_at_period_end: true }), null, NOW)).toEqual({
      kind: 'cancelling',
      planKey: 'salon_pro',
      endsAt: '2026-10-01T00:00:00.000Z',
    })
  })

  it('un abonnement en cours prime sur un essai converti', () => {
    expect(billingSituation(billing(), trial({ status: 'converted' }), NOW).kind).toBe('active')
  })
})

describe('canStartTrial — jamais relançable', () => {
  it('refuse dès qu’une ligne d’essai existe, quel que soit son état', () => {
    expect(canStartTrial(trial(), { kind: 'free' })).toBe(false)
    expect(canStartTrial(trial({ status: 'expired' }), { kind: 'free' })).toBe(false)
    expect(canStartTrial(trial({ status: 'converted' }), { kind: 'free' })).toBe(false)
  })

  it('refuse quand un abonnement existe', () => {
    expect(canStartTrial(null, { kind: 'active', planKey: 'salon_pro', interval: 'month', renewsAt: null })).toBe(false)
  })

  it('accepte un salon Free qui n’a jamais essayé', () => {
    expect(canStartTrial(null, { kind: 'free' })).toBe(true)
  })
})

describe('plansFor / tierFor / needsQuote — jamais de blocage à la croissance', () => {
  const catalog = [
    plan({ plan_key: 'salon_essential', display_name: 'Essential', price_minor: 2900, tier: 1 }),
    plan({ plan_key: 'salon_pro', price_minor: 4900 }),
    plan({ plan_key: 'salon_business', display_name: 'Business', price_minor: 7900, tier: 3 }),
    plan({
      plan_key: 'multi_growth',
      commercial_family: 'multi_salon',
      display_name: 'Growth',
      price_minor: 9900,
      min_establishments: 2,
      max_establishments: 3,
    }),
    plan({
      plan_key: 'multi_pro',
      commercial_family: 'multi_salon',
      display_name: 'Pro',
      price_minor: 14900,
      min_establishments: 4,
      max_establishments: 6,
    }),
    plan({
      plan_key: 'multi_scale',
      commercial_family: 'multi_salon',
      display_name: 'Scale',
      price_minor: 24900,
      min_establishments: 7,
      max_establishments: 15,
    }),
    plan({ plan_key: 'free', commercial_family: 'free', display_name: 'Free', price_minor: 0 }),
  ]

  it('un établissement voit les plans mono, jamais le Free ni les multi', () => {
    expect(plansFor(catalog, 1).map((p) => p.plan_key)).toEqual(['salon_essential', 'salon_pro', 'salon_business'])
  })

  it('deux établissements voient la famille multi, triée par prix', () => {
    expect(plansFor(catalog, 2).map((p) => p.plan_key)).toEqual(['multi_growth', 'multi_pro', 'multi_scale'])
  })

  it('un plan indisponible n’est pas proposé', () => {
    const hidden = catalog.map((p) => (p.plan_key === 'salon_pro' ? { ...p, is_available: false } : p))
    expect(plansFor(hidden, 1).map((p) => p.plan_key)).toEqual(['salon_essential', 'salon_business'])
  })

  it('le palier couvrant est trouvé par ses bornes', () => {
    expect(tierFor(catalog, 3)?.plan_key).toBe('multi_growth')
    expect(tierFor(catalog, 5)?.plan_key).toBe('multi_pro')
    expect(tierFor(catalog, 15)?.plan_key).toBe('multi_scale')
    expect(tierFor(catalog, 16)).toBeNull()
  })

  it('au-delà du dernier palier, c’est un DEVIS — pas un refus', () => {
    expect(needsQuote(catalog, 15)).toBe(false)
    expect(needsQuote(catalog, 16)).toBe(true)
    expect(needsQuote(catalog, 1)).toBe(false)
  })
})

describe('les prix viennent de la base', () => {
  it('l’annuel est LU, jamais recalculé', () => {
    expect(priceFor(plan(), 'month')).toBe(4900)
    expect(priceFor(plan(), 'year')).toBe(49000)
    expect(priceFor(plan({ annual_price_minor: null }), 'year')).toBeNull()
  })

  it('les mois offerts se déduisent de annual_months_charged seul', () => {
    expect(annualMonthsFree(plan())).toBe(2)
    expect(annualMonthsFree(plan({ annual_months_charged: 12 }))).toBe(0)
  })

  it('un intervalle sans prix Stripe n’est pas proposable', () => {
    expect(intervalAvailable(plan(), 'month')).toBe(true)
    expect(intervalAvailable(plan({ annual_stripe_price_id: null }), 'year')).toBe(false)
  })
})

describe('parseBillingRefusal', () => {
  it('lit le refus de vue empruntée relayé par l’Edge', () => {
    expect(parseBillingRefusal({ detail: 'fadeup_support_view_refusal=payment_forbidden' })).toBe('payment_forbidden')
    expect(parseBillingRefusal({ details: 'fadeup_billing_refusal=not_owner' })).toBe('not_owner')
  })

  it('rend null sans motif nommé', () => {
    expect(parseBillingRefusal(new Error('network'))).toBeNull()
    expect(parseBillingRefusal(null)).toBeNull()
  })
})
