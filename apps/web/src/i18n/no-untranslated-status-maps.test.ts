import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The blind spot that let the Professional status vocabulary stay English.
 *
 * ============================================================================
 * WHY THE EXISTING AUDIT MISSED IT
 * ============================================================================
 *
 * `scripts/find-hardcoded-strings.mjs` looks for user-facing text in JSX. That
 * is where most untranslated copy lives, and it found and fixed hundreds of
 * strings in LOT E. It reported ZERO for the Professional pages here — while
 * every badge on the calendar, the dashboard, the queue, the waitlist and the
 * schedule was rendering English from constants like:
 *
 *     const STATUS_LABELS: Record<QueueStatus, string> = {
 *       waiting: 'Waiting',
 *       called: 'Called',
 *       ...
 *     }
 *
 * The render site looks perfectly innocent — `{STATUS_LABELS[entry.status]}`
 * is an identifier, not text — and the English is one file away. Reviewing the
 * page that displays it will never catch this.
 *
 * A constant map of user-facing words CANNOT be translated: it is evaluated
 * once at module load, before any language is known. So the rule is not "these
 * particular maps were wrong", it is that the shape itself is wrong, and this
 * test rejects the shape.
 *
 * The fix is a hook that calls `t()` per lookup — see
 * `components/calendar/appointment-status.tsx`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Maps of CSS classes, icons, variants and other non-text values are fine —
 * only human-readable words are a problem. These names are how the codebase
 * already distinguishes the two.
 */
const NON_TEXT = /(VARIANT|CLASS|COLOR|COLOUR|ICON|TONE|STYLE|KEY|PATH|ROUTE|FIELD|COLUMN|ORDER|SET)/i

/** Not user-facing: internal staff tooling, and test fixtures. */
const EXEMPT_DIRS = [
  // The acquisition Platform screens are frozen for the V2 rebuild and are
  // internal English-only staff tooling. Recorded, not silently ignored.
  'components/acquisition/',
  'pages/platform-',
]

/**
 * The one map that MUST stay a constant.
 *
 * A language switcher lists each language in its OWN language — "Français",
 * never "French" and never "Französisch". Running these through `t()` would
 * translate them into the language the user is trying to leave, which is
 * precisely the language they cannot read. This is the exception that proves
 * the rule, so it is named rather than pattern-matched away.
 */
const EXEMPT_MAPS = new Set(['lib/locale.ts → LOCALE_LABELS'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

/** Two or more letters, i.e. a word rather than a symbol, punctuation or a code. */
const LOOKS_LIKE_PROSE = /[A-Za-z]{2,}/

describe('status vocabularies', () => {
  it('never hardcodes user-facing words in a Record<..., string> constant', () => {
    // `const NAME: Record<Something, string> = { … }` — the exact shape that
    // cannot be translated, because it is built before a language exists.
    const declaration = /const\s+([A-Z_][A-Z0-9_]*)\s*:\s*(?:Partial<)?Record<[^,>]+,\s*string>\s*(?:>)?\s*=\s*\{([^}]*)\}/g

    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (EXEMPT_DIRS.some((prefix) => rel.startsWith(prefix))) continue

      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(declaration)) {
        const [, name, body] = match
        if (NON_TEXT.test(name) || EXEMPT_MAPS.has(`${rel} → ${name}`)) continue

        // Values that are quoted prose. A value built from t(), a template
        // referencing a variable, or an identifier is fine.
        const values = [...body.matchAll(/:\s*'([^']*)'/g)].map((value) => value[1])
        const prose = values.filter((value) => LOOKS_LIKE_PROSE.test(value))
        if (prose.length > 0) {
          offenders.push(`${rel} → ${name}: ${prose.slice(0, 3).map((value) => `"${value}"`).join(', ')}`)
        }
      }
    }

    expect(
      offenders,
      'A constant map cannot be translated — expose a hook that calls t() per lookup',
    ).toEqual([])
  })
})
