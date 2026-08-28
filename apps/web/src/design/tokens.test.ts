import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ============================================================================
 * THE TOKEN GATE
 * ============================================================================
 *
 * Tailwind v4 decides which utility classes to EMIT from the values inside
 * `@theme`. A class naming a step that was never defined there — `text-ink-400`
 * when the ramp is 300/500/700/800/950 — is not an error, and it is not a
 * fallback either. Tailwind simply generates no rule, the attribute survives in
 * the DOM looking entirely deliberate, and the element inherits its parent's
 * colour.
 *
 * That failure is invisible in review (the class name reads correctly), invisible
 * in typecheck (it is a string), and invisible in tests that assert on text. It
 * is only visible to someone looking at the running product who happens to know
 * what the colour was supposed to be.
 *
 * R5 found sixty-nine of them across thirty-two files. The worst was the heart
 * on FavoriteButton: `text-ink-400` on an unfavourited heart meant it rendered
 * at full `ink-950` body weight, so "saved" and "not saved" were the same
 * visual weight on every marketplace card.
 *
 * This test is why that cannot happen twice. It reads the ramps out of
 * `index.css` itself rather than restating them, so adding a real token to the
 * palette makes it legal here on the same commit — there is no second list to
 * keep in sync.
 */

const SRC = join(__dirname, '..')
const CSS = join(SRC, 'index.css')

/** The colour families whose steps are FadeUp's, not Tailwind's built-ins. */
const FADEUP_FAMILIES = [
  'ink',
  'paper',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
] as const

/**
 * Every `--color-<family>-<step>` actually defined in `@theme`.
 *
 * Deliberately parsed from the light-mode `@theme` block's declarations rather
 * than from the whole file: the dark-mode and scoped blocks only REASSIGN
 * properties that `@theme` already registered, so a token that exists solely
 * under `[data-fu-pro]` generates no utility and must not count as defined.
 */
function definedSteps(css: string): Set<string> {
  const themeStart = css.indexOf('@theme {')
  expect(themeStart, 'index.css must contain an @theme block').toBeGreaterThan(-1)

  // The first @theme block ends at the first line that is exactly `}`.
  const rest = css.slice(themeStart)
  const end = rest.indexOf('\n}')
  const block = rest.slice(0, end)

  const defined = new Set<string>()
  for (const match of block.matchAll(/--color-([a-z]+)-(\d{1,3}):/g)) {
    defined.add(`${match[1]}-${match[2]}`)
  }
  return defined
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

/**
 * Matches a Tailwind colour utility naming a FadeUp family and a numeric step,
 * with any prefix chain (`hover:`, `focus-visible:`, `sm:`, `rtl:`) and any
 * property (`text-`, `bg-`, `border-`, `ring-`, `from-`, `outline-`, …), and
 * tolerating an opacity suffix (`/40`).
 */
const UTILITY = new RegExp(
  String.raw`\b[a-z][a-z-]*-(${FADEUP_FAMILIES.join('|')})-(\d{1,3})\b`,
  'g',
)

describe('design tokens', () => {
  const css = readFileSync(CSS, 'utf8')
  const defined = definedSteps(css)

  it('defines every FadeUp colour family in @theme', () => {
    for (const family of FADEUP_FAMILIES) {
      const steps = [...defined].filter((token) => token.startsWith(`${family}-`))
      expect(steps.length, `no --color-${family}-* tokens found in @theme`).toBeGreaterThan(0)
    }
  })

  it('never references a colour step that @theme does not define', () => {
    const offences: string[] = []

    for (const file of sourceFiles(SRC)) {
      // The gate would otherwise flag its own regex and its own prose.
      if (file === __filename) continue
      const contents = readFileSync(file, 'utf8')
      const lines = contents.split('\n')

      lines.forEach((line, index) => {
        for (const match of line.matchAll(UTILITY)) {
          const token = `${match[1]}-${match[2]}`
          if (!defined.has(token)) {
            offences.push(
              `${file.slice(SRC.length + 1)}:${index + 1} — "${match[0]}" (no --color-${token} in @theme)`,
            )
          }
        }
      })
    }

    expect(
      offences,
      [
        'These utilities name a colour step that @theme never defines.',
        'Tailwind emits no rule for them, so the element silently inherits its',
        "parent's colour. Either use a defined step, or add the token to @theme.",
        '',
        ...offences,
      ].join('\n'),
    ).toEqual([])
  })

  it('keeps the dark theme complete — every @theme colour is re-stated for dark mode', () => {
    const darkStart = css.indexOf("[data-theme='dark']")
    expect(darkStart, 'index.css must define a dark theme').toBeGreaterThan(-1)
    const darkBlock = css.slice(darkStart, darkStart + css.slice(darkStart).indexOf('\n}'))

    const darkDefined = new Set<string>()
    for (const match of darkBlock.matchAll(/--color-([a-z]+)-(\d{1,3}):/g)) {
      darkDefined.add(`${match[1]}-${match[2]}`)
    }

    // A light-mode value that is never re-stated for dark mode is a token that
    // keeps its LIGHT value on a dark ground — the single most common way a
    // dark theme develops an unreadable patch.
    const missing = [...defined].filter((token) => !darkDefined.has(token))
    expect(
      missing,
      `these colour tokens have no dark-mode value and would keep their light one:\n${missing.join('\n')}`,
    ).toEqual([])
  })
})
