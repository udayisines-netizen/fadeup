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

describe('no hardcoded English left in the wizard', () => {
  const wizard = readFileSync(join(SRC, 'pages', 'onboarding-page.tsx'), 'utf8')

  /** Strips comments so prose ABOUT the code is not mistaken for UI copy. */
  const code = wizard
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('has no English literals in translatable JSX props', () => {
    const offenders = [...code.matchAll(/\b(label|hint|title|description|placeholder|aria-label)=["'][A-Za-z][^"']*["']/g)]
    expect(offenders.map((m) => m[0])).toEqual([])
  })

  it('does not pass English literals to setError/setFormError', () => {
    // setError('slug', {...}) is react-hook-form's FIELD NAME, not a message,
    // so the pattern deliberately requires a space — real sentences have one.
    const offenders = [...code.matchAll(/set(?:Form)?Error\(['"][A-Za-z][^'"]*\s[^'"]*['"]\)/g)]
    expect(offenders.map((m) => m[0])).toEqual([])
  })

  it('reaches the onboarding namespace', () => {
    expect(code).toContain("useTranslation('onboarding')")
  })
})

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
  it('is translated, and adds no manual RTL styling of its own', () => {
    // Direction is handled once, centrally (lib/locale.ts isRtl + the
    // pre-paint bootstrap in index.html). A `dir=` in this wizard would be a
    // second, competing mechanism.
    const arabic = onboardingCopy('ar')
    expect(get(arabic, 'professional.title')).toBeTruthy()
    expect(get(arabic, 'shell.titleGeneric')).toBeTruthy()

    const wizard = readFileSync(join(SRC, 'pages', 'onboarding-page.tsx'), 'utf8')
    expect(wizard).not.toContain('dir="rtl"')
    expect(wizard).not.toContain("dir={")
  })

  it('uses direction-agnostic text alignment', () => {
    // text-left would pin copy to the left even in Arabic; text-start follows
    // the document direction.
    const wizard = readFileSync(join(SRC, 'pages', 'onboarding-page.tsx'), 'utf8')
    expect(wizard).not.toContain('text-left')
    expect(wizard).not.toContain('text-right')
  })
})
