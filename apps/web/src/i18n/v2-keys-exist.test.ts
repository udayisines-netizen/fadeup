import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { V2_SECTIONS } from '@/shared/i18n/namespaces'

/**
 * Garde de l'existence des clés V2 — écrite pendant OS-2, après un
 * signalement de la session PLAT-2 : une clé absente s'affichait EN BRUT
 * sur une page publique, et RIEN ne l'avait vue.
 *
 * Pourquoi rien ne la voit :
 *  · i18next replie en SILENCE sur le nom de la clé — pas d'erreur, pas de
 *    console, la page rend « pro.catalog.sheet.prce » comme du texte ;
 *  · `locale-completeness.test.ts` compare les locales ENTRE ELLES : deux
 *    locales également incomplètes sont d'accord, donc vertes ;
 *  · le typecheck ne connaît pas les clés, `t()` prend une chaîne ;
 *  · `no-hardcoded-strings` cherche l'inverse (du texte SANS `t()`).
 *
 * Cette garde ferme le trou par l'autre bout : chaque littéral passé à
 * `t('…')` dans le code V2 doit EXISTER dans les deux locales. Les clés
 * calculées (`t(variable)`, gabarits) sont hors de portée d'une analyse
 * statique et sont ignorées — c'est dit plutôt que caché.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE_DIRS = ['src/shared', 'src/features', 'src/app'].map((d) => join(ROOT, d))
const LOCALES = ['fr', 'en'] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function loadBundle(locale: string): Record<string, unknown> {
  const bundle: Record<string, unknown> = {}
  for (const section of V2_SECTIONS) {
    bundle[section] = JSON.parse(
      readFileSync(join(ROOT, 'src/shared/i18n/locales', locale, `${section}.json`), 'utf8'),
    ) as unknown
  }
  return bundle
}

/** Une clé existe si elle résout, ou si l'une de ses formes plurielles résout. */
function resolves(bundle: Record<string, unknown>, key: string): boolean {
  const direct = (candidate: string): boolean => {
    let node: unknown = bundle
    for (const part of candidate.split('.')) {
      if (typeof node !== 'object' || node === null) return false
      node = (node as Record<string, unknown>)[part]
      if (node === undefined) return false
    }
    return typeof node === 'string'
  }
  return direct(key) || ['_one', '_other', '_zero', '_many'].some((suffix) => direct(`${key}${suffix}`))
}

/* `t('a.b.c')` et `t("a.b.c")` — jamais `t(variable)` ni un gabarit, qu'une
   analyse statique ne peut pas résoudre honnêtement. */
const CALL = /\bt\(\s*(['"])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1/g

describe('les clés V2 employées existent réellement', () => {
  const bundles = Object.fromEntries(LOCALES.map((l) => [l, loadBundle(l)]))
  const files = SOURCE_DIRS.flatMap(walk)
  const sections = new Set<string>(V2_SECTIONS)

  const used = new Map<string, string[]>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(CALL)) {
      const key = match[2]!
      // Seules les clés du namespace v2 : un premier segment qui n'est pas
      // une section est autre chose (un chemin, une clé /platform…).
      if (!sections.has(key.split('.')[0]!)) continue
      used.set(key, [...(used.get(key) ?? []), file.slice(ROOT.length + 1)])
    }
  }

  it('le scan trouve bien des clés (sinon la garde ne garde rien)', () => {
    expect(used.size).toBeGreaterThan(200)
  })

  for (const locale of LOCALES) {
    it(`aucune clé manquante en ${locale}`, () => {
      const missing = [...used.entries()]
        .filter(([key]) => !resolves(bundles[locale]!, key))
        .map(([key, where]) => `${key} (${where[0]})`)
      expect(missing, missing.join('\n')).toEqual([])
    })
  }
})
