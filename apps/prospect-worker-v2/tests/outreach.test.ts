import { describe, expect, it } from 'vitest'
import {
  extractPlaceholders,
  renderTemplate,
  sanitizeValue,
  TemplateRenderError,
  validateTemplateBody,
} from '../src/outreach/template-engine.js'
import { candidateSalesAngles, rankByRules, type CandidateTemplate, type SelectionContext } from '../src/outreach/selector.js'
import { assignmentBucket, pickArm, type ExperimentArm } from '../src/outreach/experiments.js'
import { buildIdempotencyKey } from '../src/whatsapp/sender.js'
import { MockProvider } from '../src/whatsapp/provider.js'

describe('renderTemplate', () => {
  const allowed = ['business_name', 'city', 'competitor', 'shop_type']

  it('substitutes whitelisted variables', () => {
    const result = renderTemplate({
      body: 'Bonjour {{business_name}}, vous êtes à {{city}} ?',
      allowedVariables: allowed,
      variables: { business_name: 'Le Barbier', city: 'Lyon' },
    })
    expect(result.body).toBe('Bonjour Le Barbier, vous êtes à Lyon ?')
    expect(result.usedVariables).toEqual({ business_name: 'Le Barbier', city: 'Lyon' })
  })

  it('tolerates whitespace inside the placeholder', () => {
    const result = renderTemplate({
      body: 'Hi {{ business_name }}',
      allowedVariables: allowed,
      variables: { business_name: 'Fade Co' },
    })
    expect(result.body).toBe('Hi Fade Co')
  })

  it('refuses a variable the template is not authorised to use', () => {
    expect(() =>
      renderTemplate({
        body: 'Hello {{competitor}}',
        allowedVariables: ['business_name'],
        variables: { competitor: 'Planity' },
      }),
    ).toThrow(/not permitted/)
  })

  it('refuses an unknown variable outright', () => {
    expect(() =>
      renderTemplate({
        body: 'Hello {{secret_internal_field}}',
        allowedVariables: allowed,
        variables: {},
      }),
    ).toThrow(/unknown variable/)
  })

  it('refuses to send rather than leaving a placeholder visible', () => {
    // Shipping "Bonjour, à {{city}} ?" to a real barber is worse than not
    // sending at all.
    expect(() =>
      renderTemplate({
        body: 'Bonjour {{business_name}}, à {{city}} ?',
        allowedVariables: allowed,
        variables: { business_name: 'Le Barbier' },
      }),
    ).toThrow(TemplateRenderError)
  })

  it('has no code-execution path — a value containing template syntax is neutralised', () => {
    const result = renderTemplate({
      body: 'Hi {{business_name}}',
      allowedVariables: allowed,
      variables: { business_name: '{{city}}' },
    })
    // The injected placeholder must NOT be re-expanded.
    expect(result.body).not.toContain('{{')
    expect(result.body).toBe('Hi (city)')
  })

  it('does not evaluate expressions', () => {
    const result = renderTemplate({
      body: 'Hi {{business_name}}',
      allowedVariables: allowed,
      variables: { business_name: '${process.env.DB_PASSWORD}' },
    })
    // Substituted literally, never interpolated.
    expect(result.body).toBe('Hi ${process.env.DB_PASSWORD}')
  })

  it('rejects an empty value rather than sending a gap', () => {
    expect(() =>
      renderTemplate({ body: 'Hi {{business_name}}', allowedVariables: allowed, variables: { business_name: '   ' } }),
    ).toThrow(/no value available/)
  })
})

describe('sanitizeValue', () => {
  it('strips newlines and tabs, which Meta rejects in template parameters', () => {
    expect(sanitizeValue('Le\nBarbier\tParis')).toBe('Le Barbier Paris')
  })

  it('strips zero-width and bidirectional formatting characters', () => {
    // These can make a rendered message display differently from the copy
    // that was approved.
    expect(sanitizeValue('Le​Barbier‮')).toBe('LeBarbier')
  })

  it('truncates an over-long value instead of failing the whole send', () => {
    expect(sanitizeValue('x'.repeat(500)).length).toBeLessThanOrEqual(120)
  })

  it('collapses runs of whitespace', () => {
    expect(sanitizeValue('Le     Barbier')).toBe('Le Barbier')
  })
})

describe('validateTemplateBody', () => {
  it('accepts a well-formed body', () => {
    expect(validateTemplateBody('Bonjour {{business_name}}', ['business_name'])).toEqual([])
  })

  it('reports an unknown variable at authoring time', () => {
    const problems = validateTemplateBody('Hi {{nope}}', ['business_name'])
    expect(problems.join(' ')).toContain('Unknown variable')
  })

  it('catches a malformed placeholder that would otherwise ship literally', () => {
    const problems = validateTemplateBody('Hi {{business name}}', ['business_name'])
    expect(problems.join(' ')).toContain('Malformed')
  })

  it('rejects an empty body', () => {
    expect(validateTemplateBody('   ', [])).toContain('Body is empty.')
  })
})

describe('extractPlaceholders', () => {
  it('lists each distinct placeholder once', () => {
    expect(extractPlaceholders('{{a_b}} {{c}} {{a_b}}')).toEqual(['a_b', 'c'])
  })
})

function template(overrides: Partial<CandidateTemplate>): CandidateTemplate {
  return {
    id: 't1',
    key: 'generic_fr_v1',
    locale: 'fr-FR',
    segmentKey: null,
    bookingProviderId: null,
    bookingProviderKey: null,
    salesAngle: null,
    allowedVariables: ['business_name'],
    body: 'Bonjour {{business_name}}',
    ...overrides,
  }
}

function context(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    prospectId: 'p1',
    locale: 'fr-FR',
    bookingProviderKey: 'NO_BOOKING',
    segmentKeys: [],
    fadeUpFitScore: 70,
    migrationPotentialScore: 0,
    campaignId: 'c1',
    ...overrides,
  }
}

describe('candidateSalesAngles', () => {
  it('leads with ONLINE_BOOKING when there is no booking', () => {
    expect(candidateSalesAngles(context())[0]).toBe('ONLINE_BOOKING')
  })

  it('leads with COMPETITOR_MIGRATION for a competitor user', () => {
    expect(candidateSalesAngles(context({ bookingProviderKey: 'PLANITY' }))[0]).toBe('COMPETITOR_MIGRATION')
  })

  it('does not offer ONLINE_BOOKING to a business that already books online', () => {
    expect(candidateSalesAngles(context({ bookingProviderKey: 'BOOKSY' }))).not.toContain('ONLINE_BOOKING')
  })

  it('offers no booking-gap angle when the provider is UNKNOWN', () => {
    // We must not pitch "you have no online booking" to a business whose
    // booking status we failed to determine.
    const angles = candidateSalesAngles(context({ bookingProviderKey: 'UNKNOWN' }))
    expect(angles).not.toContain('ONLINE_BOOKING')
    expect(angles).not.toContain('COMPETITOR_MIGRATION')
  })

  it('adds team angles for a multi-barber shop', () => {
    const angles = candidateSalesAngles(context({ segmentKeys: ['MULTI_BARBER_SHOP'] }))
    expect(angles).toContain('BARBER_MANAGEMENT')
    expect(angles).toContain('LIVE_QUEUE')
  })

  it('always ends with a usable fallback angle', () => {
    expect(candidateSalesAngles(context({ bookingProviderKey: 'UNKNOWN' }))).toContain('SHOP_OS')
  })
})

describe('rankByRules', () => {
  it('prefers a competitor-targeted template over a generic one', () => {
    const candidates = [
      template({ id: 'generic', key: 'generic_fr_v1' }),
      template({ id: 'planity', key: 'planity_switch_fr_v1', bookingProviderKey: 'PLANITY', salesAngle: 'COMPETITOR_MIGRATION' }),
    ]
    const ranked = rankByRules(candidates, context({ bookingProviderKey: 'PLANITY' }))
    expect(ranked[0]?.templateId).toBe('planity')
  })

  it('prefers a segment-targeted template over an untargeted one', () => {
    const candidates = [
      template({ id: 'generic' }),
      template({ id: 'multi', key: 'multi_barber_fr_v1', segmentKey: 'MULTI_BARBER_SHOP' }),
    ]
    const ranked = rankByRules(candidates, context({ segmentKeys: ['MULTI_BARBER_SHOP'] }))
    expect(ranked[0]?.templateId).toBe('multi')
  })

  it('is fully reproducible for identical inputs', () => {
    const candidates = [template({ id: 'b' }), template({ id: 'a' }), template({ id: 'c' })]
    const first = rankByRules(candidates, context())
    const second = rankByRules([...candidates].reverse(), context())
    expect(first.map((r) => r.templateId)).toEqual(second.map((r) => r.templateId))
  })
})

describe('experiment assignment', () => {
  it('is deterministic for the same seed and prospect', () => {
    const a = assignmentBucket('seed-1', 'prospect-abc')
    const b = assignmentBucket('seed-1', 'prospect-abc')
    expect(a.bucket).toBe(b.bucket)
    expect(a.hash).toBe(b.hash)
  })

  it('produces different buckets for different prospects', () => {
    const a = assignmentBucket('seed-1', 'prospect-abc')
    const b = assignmentBucket('seed-1', 'prospect-xyz')
    expect(a.bucket).not.toBe(b.bucket)
  })

  it('produces a bucket in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const { bucket } = assignmentBucket('seed', `prospect-${i}`)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThanOrEqual(1)
    }
  })

  const arms: ExperimentArm[] = [
    { id: 'a1', armKey: 'A', templateId: 'tA', weight: 1, isControl: true },
    { id: 'a2', armKey: 'B', templateId: 'tB', weight: 1, isControl: false },
  ]

  it('assigns the same prospect to the same arm every time', () => {
    const first = pickArm(arms, 'seed', 'prospect-1')
    const second = pickArm(arms, 'seed', 'prospect-1')
    expect(first?.armKey).toBe(second?.armKey)
  })

  it('splits a population across both arms', () => {
    const counts = { A: 0, B: 0 }
    for (let i = 0; i < 500; i++) {
      const arm = pickArm(arms, 'seed', `prospect-${i}`)
      counts[arm!.armKey as 'A' | 'B']++
    }
    // Both arms must actually receive traffic; an exact 50/50 is not
    // expected from a hash, but a wild skew would indicate a bug.
    expect(counts.A).toBeGreaterThan(150)
    expect(counts.B).toBeGreaterThan(150)
  })

  it('respects arm weights', () => {
    const weighted: ExperimentArm[] = [
      { id: 'a1', armKey: 'A', templateId: 'tA', weight: 9, isControl: true },
      { id: 'a2', armKey: 'B', templateId: 'tB', weight: 1, isControl: false },
    ]
    let aCount = 0
    for (let i = 0; i < 1000; i++) {
      if (pickArm(weighted, 'seed', `p-${i}`)?.armKey === 'A') aCount++
    }
    expect(aCount).toBeGreaterThan(800)
  })

  it('returns null when there are no arms', () => {
    expect(pickArm([], 'seed', 'p1')).toBeNull()
  })
})

describe('WhatsApp idempotency and mock provider', () => {
  it('produces a stable key for the same recipient and template', () => {
    // A retry after an ambiguous timeout must collide, not double-send.
    expect(buildIdempotencyKey('r1', 't1')).toBe(buildIdempotencyKey('r1', 't1'))
  })

  it('produces different keys for different recipients or templates', () => {
    expect(buildIdempotencyKey('r1', 't1')).not.toBe(buildIdempotencyKey('r2', 't1'))
    expect(buildIdempotencyKey('r1', 't1')).not.toBe(buildIdempotencyKey('r1', 't2'))
  })

  it('is not time-dependent', () => {
    const key = buildIdempotencyKey('r1', 't1')
    expect(key).toMatch(/^[a-f0-9]{40}$/)
  })

  it('mock provider sends nothing and marks its ids unmistakably', async () => {
    const provider = new MockProvider()
    const result = await provider.sendTemplateMessage({
      toPhoneE164: '+33600000000',
      metaTemplateName: 'no_booking_fr_v1',
      metaTemplateLanguage: 'fr',
      bodyParameters: ['Le Barbier'],
      idempotencyKey: 'key-1',
    })

    expect(result.simulated).toBe(true)
    // A mocked message must never be mistakable for a real one in the
    // database, in analytics, or in a report.
    expect(result.providerMessageId).toContain('MOCK')
    expect(provider.sent).toHaveLength(1)
    expect(provider.mode).toBe('mock')
  })

  it('mock provider reports healthy without any credentials', async () => {
    const health = await new MockProvider().healthCheck()
    expect(health.healthy).toBe(true)
  })
})
