import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Arabic, without a second stylesheet.
 *
 * ============================================================================
 * WHY THIS IS A TEST
 * ============================================================================
 *
 * FadeUp ships in Arabic. `<html dir>` is set from the language (see
 * direction.test.ts), and every logical Tailwind utility — `ms-`, `me-`,
 * `ps-`, `pe-`, `start-`, `end-`, `text-start`, `border-s` — mirrors itself
 * for free. Their physical twins do not.
 *
 * That difference is invisible to everyone building the product. A close
 * button pinned `right-4` looks perfect in all nine left-to-right languages
 * and lands on the wrong edge in the tenth, on top of the title. Nobody
 * developing in English will ever see it, and it is not the kind of thing an
 * Arabic-speaking customer reports as a bug — they just find the product
 * slightly broken.
 *
 * It had happened: the dialog's close button, the select's chevron, the toast
 * viewport, the drawer's edges and a dozen table cells were all physical, in
 * shared primitives used on every screen.
 *
 * ============================================================================
 * THE EXCEPTION
 * ============================================================================
 *
 * `left-1/2` with `-translate-x-1/2` is not a direction — it is symmetric
 * centring, and its logical twin genuinely breaks it: `start-1/2` flips the
 * offset under RTL while the transform still moves left, so the dialog lands
 * off-centre. Physical is correct there, which is why the pattern is allowed
 * by name rather than the file being exempted wholesale.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Internal, English-only staff tooling that is frozen for the V2 rebuild.
 * Listed rather than ignored, so the debt is visible.
 */
const EXEMPT_PREFIXES = ['components/acquisition/', 'pages/platform-']

/** Utilities with a logical equivalent that mirrors under `dir="rtl"`. */
const PHYSICAL = [
  { pattern: /(?<![\w-])(?:sm:|md:|lg:|xl:|2xl:)?m[lr]-[\d.]+(?![\w/])/g, use: 'ms-/me-' },
  { pattern: /(?<![\w-])(?:sm:|md:|lg:|xl:|2xl:)?p[lr]-[\d.]+(?![\w/])/g, use: 'ps-/pe-' },
  { pattern: /(?<![\w-])(?:sm:|md:|lg:|xl:|2xl:)?-?(?:left|right)-[\d.]+(?![\w/])/g, use: 'start-/end-' },
  { pattern: /(?<![\w-])text-(?:left|right)(?![\w-])/g, use: 'text-start/text-end' },
  { pattern: /(?<![\w-])border-[lr](?![\w-])/g, use: 'border-s/border-e' },
  { pattern: /(?<![\w-])rounded-[lr]-/g, use: 'rounded-s-/rounded-e-' },
]

/**
 * Symmetric centring, which must stay physical. Matched on the whole idiom,
 * not just the offset, so a bare `left-1/2` still fails.
 */
const CENTRING = /left-1\/2[^'"`]*-translate-x-1\/2|-translate-x-1\/2[^'"`]*left-1\/2/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : []
  })
}

describe('right-to-left layout', () => {
  it('uses logical properties, so Arabic mirrors without a second stylesheet', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue

      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (CENTRING.test(line)) return
          for (const { pattern, use } of PHYSICAL) {
            for (const match of line.matchAll(pattern)) {
              offenders.push(`${rel}:${index + 1} "${match[0]}" — use ${use}`)
            }
          }
        })
    }

    expect(offenders, 'Physical direction utilities do not mirror under dir="rtl"').toEqual([])
  })
})
