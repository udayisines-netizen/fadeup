import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@/lib/locale'
import { BUSINESS_TYPES } from '@/lib/queries/onboarding'
import { SERVICE_TEMPLATES } from '@/lib/onboarding/templates'

/**
 * Onboarding must not be English-only.
 *
 * `i18n/locale-completeness.test.ts` already proves every locale carries the
 * same KEYS. What it cannot see is whether the wizard's code still contains
 * hardcoded copy that never reaches a translation file at all — which is
 * exactly how the LOT B wizard shipped. These tests check the source itself,
 * and check that the ids the code looks up genuinely exist.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function onboardingCopy(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SRC, 'locales', locale, 'onboarding.json'), 'utf8'))
}

function get(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
    return undefined
  }, tree)
}

describe('onboarding translation coverage', () => {
  it('ships an onboarding namespace for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(() => onboardingCopy(locale), `${locale} is missing onboarding.json`).not.toThrow()
    }
  })

  it('registers the namespace with a loader for every locale', () => {
    const index = readFileSync(join(SRC, 'i18n', 'index.ts'), 'utf8')
    expect(index).toContain("'onboarding'")
    for (const locale of SUPPORTED_LOCALES) {
      expect(index, `${locale} has no onboarding loader`).toContain(`@/locales/${locale}/onboarding.json`)
    }
  })

  it('translates every business type the enum can hold', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = onboardingCopy(locale)
      for (const businessType of BUSINESS_TYPES) {
        expect(get(copy, `type.options.${businessType}.label`), `${locale}/${businessType}`).toBeTruthy()
        expect(get(copy, `type.options.${businessType}.hint`), `${locale}/${businessType}`).toBeTruthy()
      }
    }
  })

  it('translates every starter service the templates can offer', () => {
    // These names become real `services` rows, so a missing one would seed a
    // shop's live price list with a raw key.
    const ids = new Set(BUSINESS_TYPES.flatMap((type) => SERVICE_TEMPLATES[type].map((s) => s.id)))
    for (const locale of SUPPORTED_LOCALES) {
      const copy = onboardingCopy(locale)
      for (const id of ids) {
        expect(get(copy, `services.templates.${id}`), `${locale}/${id}`).toBeTruthy()
      }
    }
  })

  it('translates every readiness requirement the server can return', () => {
    // Mirrors get_organization_readiness()'s missing_requirements[] values.
    const requirements = [
      'business_type', 'currency', 'location', 'location_address', 'timezone',
      'professional', 'service', 'service_at_location', 'service_for_professional',
      'location_hours', 'professional_hours', 'public_profile',
    ]
    for (const locale of SUPPORTED_LOCALES) {
      const copy = onboardingCopy(locale)
      for (const requirement of requirements) {
        expect(get(copy, `review.requirements.${requirement}`), `${locale}/${requirement}`).toBeTruthy()
      }
    }
  })

  it('translates every auth error the account flows can surface', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const auth = JSON.parse(readFileSync(join(SRC, 'locales', locale, 'auth.json'), 'utf8'))
      for (const key of ['alreadyRegistered', 'alreadyRegisteredCta', 'useAnotherEmail', 'invalidCredentials']) {
        expect(get(auth, `errors.${key}`), `${locale}/${key}`).toBeTruthy()
      }
    }
  })
})

/*
 * The wizard-page scan that lived here was removed with `pages/onboarding-page.tsx`
 * in the 2026-09-01 web UI purge (docs/frontend/WEB_UI_PURGE_INVENTORY.md). It
 * asserted that ONE deleted screen carried no English literals; the equivalent
 * rule for whatever screen replaces it is enforced globally by
 * src/i18n/no-hardcoded-strings.test.ts. The onboarding TEMPLATE and namespace
 * coverage above is business truth and stays.
 */

describe('French terminology', () => {
  it('never uses "barbier"', () => {
    // The FadeUp vocabulary is barber / coiffeur / professionnel /
    // spécialiste / barbershop / salon / équipe.
    const french = readFileSync(join(SRC, 'locales', 'fr', 'onboarding.json'), 'utf8')
    expect(french.toLowerCase()).not.toContain('barbier')
  })

  it('uses the approved vocabulary instead', () => {
    const french = readFileSync(join(SRC, 'locales', 'fr', 'onboarding.json'), 'utf8').toLowerCase()
    expect(french).toContain('professionnel')
    expect(french).toContain('barbershop')
    expect(french).toContain('salon')
  })

  it('keeps the key phrases the brief called out', () => {
    const fr = onboardingCopy('fr')
    expect(get(fr, 'professional.title')).toBe('Qui reçoit les clients ?')
    expect(get(fr, 'professional.nameLabel')).toBe('Votre nom affiché aux clients')
    expect(get(fr, 'professional.submit')).toBe('Je reçois des clients — continuer')
  })
})

describe('Arabic', () => {
  it('is translated', () => {
    const arabic = onboardingCopy('ar')
    expect(get(arabic, 'professional.title')).toBeTruthy()
    expect(get(arabic, 'shell.titleGeneric')).toBeTruthy()
  })

  /*
   * The two assertions that used to live here scanned `pages/onboarding-page.tsx`
   * for `dir=` and `text-left/right`. That page was deleted in the 2026-09-01 web
   * UI purge (docs/frontend/WEB_UI_PURGE_INVENTORY.md). Both rules are enforced
   * tree-wide and survive: direction is asserted centrally by
   * src/i18n/direction.test.ts, and physical-property usage by
   * src/i18n/logical-properties.test.ts. Nothing was weakened — the checks moved
   * from one screen to every file.
   */
})
