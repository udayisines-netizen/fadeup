import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@/lib/locale'

/**
 * FadeUp's product vocabulary, enforced.
 *
 * A translation memory will happily render "barber" as "barbier" in French. It
 * is not wrong as a dictionary entry and it is wrong as product copy: it reads
 * as dated and it excludes the salons and coiffeurs FadeUp also serves. The
 * right words are coiffeur / professionnel / équipe, chosen by context.
 *
 * This is a test rather than a style note because the failure mode is a
 * translator's reflex, and a reflex needs a gate.
 */

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')

function flatten(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]]
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

function entriesFor(locale: string): Array<[string, string, string]> {
  const dir = join(LOCALES_DIR, locale)
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) =>
      flatten(JSON.parse(readFileSync(join(dir, file), 'utf8'))).map(
        ([key, value]) => [file, key, value] as [string, string, string],
      ),
    )
}

describe('French product terminology', () => {
  it('never uses "barbier"', () => {
    const offenders = entriesFor('fr')
      .filter(([, , value]) => /barbier/i.test(value))
      .map(([file, key, value]) => `fr/${file} → ${key}: "${value}"`)

    expect(offenders, 'Use coiffeur / professionnel / équipe instead').toEqual([])
  })

  it('keeps the product name as FadeUp', () => {
    // "FadeUp" is a brand, not a phrase to localize. Catching a stray
    // "Fade Up" / "Fadeup" here keeps it consistent across ten languages.
    const offenders = entriesFor('fr')
      .filter(([, , value]) => /\bFade\s+Up\b|\bFadeup\b/.test(value))
      .map(([file, key, value]) => `fr/${file} → ${key}: "${value}"`)

    expect(offenders).toEqual([])
  })
})

describe('every locale', () => {
  it('leaves no empty translated string', () => {
    // An empty string is worse than a missing key: i18next falls back for a
    // missing key and renders nothing at all for an empty one.
    for (const locale of SUPPORTED_LOCALES) {
      const empty = entriesFor(locale)
        .filter(([, , value]) => value.trim() === '')
        .map(([file, key]) => `${locale}/${file} → ${key}`)
      expect(empty, `${locale} has empty strings`).toEqual([])
    }
  })

  /**
   * A placeholder a locale INVENTS is always a bug: "{{organisation}}" where
   * English says "{{organization}}" renders the literal braces on screen, and
   * no key-completeness check would catch it.
   *
   * A placeholder a locale OMITS is not always a bug. In an explicit plural
   * category the quantity can be carried by the words themselves — Arabic's
   * `_one` form says "شخص واحد أمامك" ("one person ahead of you") rather than
   * repeating the numeral, which is how the language actually works. Demanding
   * {{count}} there would force translators to write something unnatural.
   *
   * So: unknown placeholders fail everywhere; omissions fail everywhere except
   * an explicit plural category.
   */
  const PLURAL_CATEGORY = /_(zero|one|two|few|many|other)$/

  it('never invents a placeholder English does not have', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort()

    const english = new Map(entriesFor('en').map(([file, key, value]) => [`${file}:${key}`, placeholders(value)]))

    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
      const unknown: string[] = []
      for (const [file, key, value] of entriesFor(locale)) {
        const reference = english.get(`${file}:${key}`)
        if (!reference) continue
        for (const name of placeholders(value)) {
          if (!reference.includes(name)) {
            unknown.push(`${locale}/${file} → ${key}: "{{${name}}}" is not in the English string`)
          }
        }
      }
      expect(unknown, `${locale} interpolates something English never provides`).toEqual([])
    }
  })

  it('only omits a placeholder inside an explicit plural category', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort()

    const english = new Map(entriesFor('en').map(([file, key, value]) => [`${file}:${key}`, placeholders(value)]))

    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
      const dropped: string[] = []
      for (const [file, key, value] of entriesFor(locale)) {
        const reference = english.get(`${file}:${key}`)
        if (!reference || PLURAL_CATEGORY.test(key)) continue
        const actual = placeholders(value)
        for (const name of reference) {
          if (!actual.includes(name)) {
            dropped.push(`${locale}/${file} → ${key}: dropped "{{${name}}}"`)
          }
        }
      }
      expect(dropped, `${locale} drops a placeholder outside a plural form`).toEqual([])
    }
  })
})
