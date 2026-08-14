import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@/lib/locale'

/**
 * Every namespace must carry the same key set in every supported locale.
 *
 * i18next falls back silently when a key is missing, so a half-translated
 * namespace looks fine in development and then shows English inside a French
 * page in production. This turns that into a failing test instead — the
 * reason language switching only changed part of the product was exactly this
 * kind of silent gap.
 *
 * English is the reference because it is the fallback language.
 */

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

function keysOf(locale: string, namespace: string): string[] {
  const raw = readFileSync(join(LOCALES_DIR, locale, namespace), 'utf8')
  return flatten(JSON.parse(raw)).sort()
}

const namespaces = readdirSync(join(LOCALES_DIR, 'en')).filter((file) => file.endsWith('.json'))
const otherLocales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en')

describe('locale completeness', () => {
  it('ships every namespace that English defines', () => {
    expect(namespaces.length).toBeGreaterThan(0)

    for (const locale of otherLocales) {
      const present = readdirSync(join(LOCALES_DIR, locale)).filter((file) => file.endsWith('.json'))
      expect(present.sort(), `${locale} is missing namespace files`).toEqual([...namespaces].sort())
    }
  })

  for (const namespace of namespaces) {
    it(`has no missing or stray keys in ${namespace}`, () => {
      const reference = keysOf('en', namespace)

      for (const locale of otherLocales) {
        const actual = keysOf(locale, namespace)
        const missing = reference.filter((key) => !actual.includes(key))
        const stray = actual.filter((key) => !reference.includes(key))

        expect(missing, `${locale}/${namespace} is missing keys`).toEqual([])
        expect(stray, `${locale}/${namespace} has keys English does not`).toEqual([])
      }
    })
  }

  it('never ships an empty string where a translation should be', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const namespace of namespaces) {
        const parsed = JSON.parse(readFileSync(join(LOCALES_DIR, locale, namespace), 'utf8'))
        const blanks: string[] = []
        const walk = (value: unknown, path: string) => {
          if (typeof value === 'string') {
            if (value.trim() === '') blanks.push(path)
            return
          }
          if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
              walk(child, path ? `${path}.${key}` : key)
            }
          }
        }
        walk(parsed, '')
        expect(blanks, `${locale}/${namespace} has blank translations`).toEqual([])
      }
    }
  })
})
