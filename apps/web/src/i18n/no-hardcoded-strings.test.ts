import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findHardcoded } from '../../scripts/find-hardcoded-strings.mjs'

/**
 * The other half of "translation completeness".
 *
 * `locale-completeness.test.ts` checks that every locale has every key English
 * defines. That is necessary and it is not sufficient: it says nothing about
 * strings that never entered the translation system at all, and before this
 * pass the entire Professional workspace and Platform were exactly that — 900
 * English literals sitting in TSX, invisible to any locale check.
 *
 * So this looks at SOURCE files and fails when a user-facing English string is
 * not going through t(). It is what stops the next feature from quietly
 * reintroducing the problem one label at a time.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Directories whose English is deliberately not translated.
 *
 * ACQUISITION / OUTREACH / DATA SCIENCE — Worker V2 is feature frozen. These
 * are FadeUp's own internal acquisition tooling, they are explicitly out of
 * scope, and touching them at all is forbidden. 423 strings live here and
 * that number is expected to stay put until Worker V2 is unfrozen.
 *
 * MARKETING — the marketing site has its own `landing` namespace and its own
 * in-progress work; the pages listed here are the ones still being designed.
 */
const EXEMPT = [
  /platform-acquisition-/,
  /platform-outreach-/,
  /platform-data-science-/,
  /components[/\\]acquisition[/\\]/,
  /components[/\\]marketing[/\\]product-previews/,
  /components[/\\]for-business[/\\]/,
  /components[/\\]brand[/\\]/,
]

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.test.')) return []
    return [full]
  })
}

describe('no hardcoded user-facing English', () => {
  const files = walk(SRC).filter((file) => !EXEMPT.some((pattern) => pattern.test(file)))

  it('scans a meaningful number of files (guards against this test passing vacuously)', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  it('finds none in the Professional workspace', () => {
    const offenders = files
      .filter((file) => /pages[/\\]app-/.test(file))
      .flatMap((file) => findHardcoded(file))
      .map((f) => `${relative(SRC, f.file)}:${f.line} — ${JSON.stringify(f.value)}`)

    expect(offenders, 'Move these into the `app` namespace').toEqual([])
  })

  it('finds none in Platform core', () => {
    const offenders = files
      .filter((file) => /pages[/\\]platform-/.test(file))
      .flatMap((file) => findHardcoded(file))
      .map((f) => `${relative(SRC, f.file)}:${f.line} — ${JSON.stringify(f.value)}`)

    expect(offenders, 'Move these into the `platform` namespace').toEqual([])
  })

  it('finds none in shared components, routes or the public/customer product', () => {
    const offenders = files
      .filter((file) => !/pages[/\\](app|platform)-/.test(file))
      .flatMap((file) => findHardcoded(file))
      .map((f) => `${relative(SRC, f.file)}:${f.line} — ${JSON.stringify(f.value)}`)

    expect(offenders).toEqual([])
  })
})
