import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PLAT-2 — LA PARITÉ DES CLÉS DE L'ÉCRAN DE SCAN.
 *
 * Ce test existe parce qu'une clé manquante — `poster.inactive.signedOut` —
 * a été livrée et s'est affichée EN BRUT sur la page publique, sous les yeux
 * d'un client qui scanne une affiche. Rien ne l'a attrapée : i18next replie
 * en silence sur la clé elle-même, `locale-completeness` ne compare que les
 * locales ENTRE ELLES (elles étaient toutes deux incomplètes, donc d'accord),
 * et le rendu était vert.
 *
 * Il a fallu REGARDER une capture. Ce test remplace le regard.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = join(HERE, 'PosterScanPage.tsx')
const LOCALES = join(HERE, '..', '..', '..', 'shared', 'i18n', 'locales')

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

const source = readFileSync(PAGE, 'utf8')
/** Les clés littérales `t('poster.x.y')` ; les clés calculées sont traitées à part. */
const literalKeys = [...source.matchAll(/t\('poster\.([a-zA-Z0-9_.]+)'/g)].map((m) => m[1])
/** Les cinq motifs de refus construits par interpolation. */
const REFUSAL_KEYS = [
  'already_assigned',
  'revoked',
  'location_not_mine',
  'unknown_code',
  'not_authenticated',
].map((code) => `assign.refusal.${code}`)

describe("les clés de l'écran de scan d'affiche", () => {
  for (const locale of ['fr', 'en']) {
    it(`existent toutes en ${locale}`, () => {
      const bundle = JSON.parse(readFileSync(join(LOCALES, locale, 'poster.json'), 'utf8'))
      const available = flatten(bundle)
      const missing = [...new Set([...literalKeys, ...REFUSAL_KEYS])].filter((k) => !available.includes(k))
      expect(missing, `${locale}/poster.json`).toEqual([])
    })

    it(`n'en porte aucune que la page n'emploie pas, en ${locale}`, () => {
      const bundle = JSON.parse(readFileSync(join(LOCALES, locale, 'poster.json'), 'utf8'))
      const used = new Set([...literalKeys, ...REFUSAL_KEYS])
      expect(flatten(bundle).filter((k) => !used.has(k))).toEqual([])
    })
  }

  it('emploie au moins une clé — sinon le test ne prouve rien', () => {
    expect(literalKeys.length).toBeGreaterThan(8)
  })
})
