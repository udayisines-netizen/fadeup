import { describe, expect, it } from 'vitest'
import { STEPS, firstIncompleteStep, isStepComplete } from '@/pages/onboarding-page'
import type { OrganizationReadiness } from '@/lib/queries/onboarding'
import { DEFAULT_WEEK, SERVICE_TEMPLATES, templateFor } from '@/lib/onboarding/templates'
import { BUSINESS_TYPES } from '@/lib/queries/onboarding'

/**
 * The resume behaviour.
 *
 * Onboarding progress is DERIVED from server-side readiness, never stored in
 * the browser — which is the whole reason someone can close the tab at step 6
 * and come back tomorrow. These functions are that derivation, so they are
 * tested directly rather than through ten renders of the wizard.
 */

function readiness(overrides: Partial<OrganizationReadiness> = {}): OrganizationReadiness {
  return {
    organizationId: 'org-1',
    businessType: null,
    currency: null,
    hasBusinessType: false,
    hasCurrency: false,
    hasLocation: false,
    hasLocationAddress: false,
    hasTimezone: false,
    hasProfessional: false,
    hasService: false,
    hasServiceAtLocation: false,
    hasServiceForProfessional: false,
    hasLocationHours: false,
    hasProfessionalHours: false,
    hasPublicProfile: false,
    readyToBook: false,
    readyToPublish: false,
    isPublished: false,
    missingRequirements: [],
    ...overrides,
  }
}

/** A freshly approved application: organization + location exist, nothing else. */
const freshlyApproved = readiness({
  hasLocation: true,
  hasLocationAddress: true,
  hasTimezone: true,
  hasBusinessType: true,
  hasCurrency: true,
})

const fullySetUp = readiness({
  businessType: 'hair_salon',
  currency: 'EUR',
  hasBusinessType: true,
  hasCurrency: true,
  hasLocation: true,
  hasLocationAddress: true,
  hasTimezone: true,
  hasProfessional: true,
  hasService: true,
  hasServiceAtLocation: true,
  hasServiceForProfessional: true,
  hasLocationHours: true,
  hasProfessionalHours: true,
  hasPublicProfile: true,
  readyToBook: true,
  readyToPublish: true,
})

describe('firstIncompleteStep', () => {
  it('starts a brand-new organization at the business type', () => {
    expect(firstIncompleteStep(readiness())).toBe('type')
  })

  it('sends a freshly approved application straight to services', () => {
    // Approval already created the location from the application address and
    // seeded business_type/currency, so setup opens where work is actually
    // needed rather than re-asking for what FadeUp already holds.
    expect(firstIncompleteStep(freshlyApproved)).toBe('services')
  })

  it('resumes at the professional step once services exist', () => {
    expect(firstIncompleteStep({ ...freshlyApproved, hasService: true, hasServiceAtLocation: true })).toBe(
      'professional',
    )
  })

  it('resumes at opening hours once a professional exists', () => {
    expect(
      firstIncompleteStep({
        ...freshlyApproved,
        hasService: true,
        hasServiceAtLocation: true,
        hasProfessional: true,
        hasServiceForProfessional: true,
      }),
    ).toBe('hours')
  })

  it('resumes at working hours once opening hours exist', () => {
    expect(
      firstIncompleteStep({
        ...freshlyApproved,
        hasService: true,
        hasServiceAtLocation: true,
        hasProfessional: true,
        hasServiceForProfessional: true,
        hasLocationHours: true,
      }),
    ).toBe('pro-hours')
  })

  it('lands a completed business on review', () => {
    expect(firstIncompleteStep(fullySetUp)).toBe('review')
  })

  it('re-opens an address step when the address was never filled in', () => {
    // A location row exists (approval always makes one) but with no street
    // address — the applicant left it blank. Readiness sees that, so setup
    // asks rather than assuming.
    expect(firstIncompleteStep(readiness({ hasBusinessType: true, hasLocation: true }))).toBe('location')
  })
})

describe('isStepComplete', () => {
  it('marks nothing complete for a brand-new organization except the name', () => {
    const done = STEPS.filter((step) => isStepComplete(step, readiness()))
    expect(done).toEqual(['identity'])
  })

  it('marks every step complete for a fully set-up business', () => {
    const notDone = STEPS.filter((step) => !isStepComplete(step, fullySetUp))
    expect(notDone).toEqual([])
  })

  it('does not call services complete when they are not offered at a location', () => {
    // A service that exists but is offered nowhere produces no bookable slot,
    // so ticking the step would be a lie.
    expect(isStepComplete('services', readiness({ hasService: true, hasServiceAtLocation: false }))).toBe(false)
  })

  it('does not call the professional step complete when they perform no service', () => {
    expect(
      isStepComplete('professional', readiness({ hasProfessional: true, hasServiceForProfessional: false })),
    ).toBe(false)
  })

  it('recognises a business configured entirely outside the wizard', () => {
    // Someone who set everything up through /app/services and
    // /app/availability never touched onboarding. Readiness reads persisted
    // rows, so they are correctly complete rather than being asked to redo it.
    expect(isStepComplete('review', fullySetUp)).toBe(true)
  })
})

describe('starter templates', () => {
  it('offers a template for every business type', () => {
    for (const businessType of BUSINESS_TYPES) {
      expect(SERVICE_TEMPLATES[businessType].length).toBeGreaterThan(0)
    }
  })

  it('preselects at least one service for every business type', () => {
    for (const businessType of BUSINESS_TYPES) {
      expect(templateFor(businessType).some((service) => service.recommended)).toBe(true)
    }
  })

  it('falls back to the barber set when no type is chosen yet', () => {
    expect(templateFor(null)).toEqual(SERVICE_TEMPLATES.barbershop)
  })

  it('gives a salon a salon template, not a barbershop one', () => {
    expect(templateFor('hair_salon').map((service) => service.name)).toContain('Brushing')
    expect(templateFor('barbershop').map((service) => service.name)).not.toContain('Brushing')
  })

  it('quotes every price in whole cents and every duration as positive minutes', () => {
    for (const businessType of BUSINESS_TYPES) {
      for (const service of SERVICE_TEMPLATES[businessType]) {
        expect(Number.isInteger(service.priceCents)).toBe(true)
        expect(service.priceCents).toBeGreaterThan(0)
        expect(service.durationMinutes).toBeGreaterThan(0)
      }
    }
  })

  it('uses no French copy containing "barbier"', () => {
    // Product rule: the French vocabulary is barber/coiffeur/professionnel/
    // spécialiste/barbershop/salon/équipe.
    const allNames = BUSINESS_TYPES.flatMap((type) => SERVICE_TEMPLATES[type].map((service) => service.name))
    expect(allNames.join(' ').toLowerCase()).not.toContain('barbier')
  })

  it('defaults to a week that is actually open on some days', () => {
    expect(DEFAULT_WEEK).toHaveLength(7)
    expect(DEFAULT_WEEK.filter((day) => !day.isClosed).length).toBeGreaterThan(0)
    for (const day of DEFAULT_WEEK) {
      if (day.isClosed) continue
      expect(day.openTime).toBeTruthy()
      expect(day.closeTime).toBeTruthy()
      expect(day.openTime! < day.closeTime!).toBe(true)
    }
  })
})
