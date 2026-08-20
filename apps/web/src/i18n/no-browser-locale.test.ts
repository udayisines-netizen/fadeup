import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `toLocaleString(undefined, …)` is a bug, and it is a quiet one.
 *
 * ============================================================================
 * WHY THIS IS A TEST AND NOT A CODE REVIEW NOTE
 * ============================================================================
 *
 * Passing `undefined` as the locale asks the BROWSER which language it is.
 * That is never the question FadeUp is asking. The app has already resolved a
 * locale — from an explicit choice, then GeoIP, then the browser — and an
 * owner who picked Japanese must not read French dates because their laptop
 * is French.
 *
 * It is quiet because it looks right to everyone who builds it: a developer
 * whose browser is set to the same language as the app sees correct output
 * forever. It only breaks for the users who most needed the language picker,
 * and they cannot report "the date format is subtly wrong" as a bug.
 *
 * It also came back. LOT E translated the interface and this file did not
 * exist, so seventeen call sites across the calendar, the requests screen, the
 * notification bell and the customer's reschedule dialog kept formatting in
 * the browser's locale while every visible string around them was translated.
 *
 * The fix is one of:
 *   - `useDateTime()` / `useMoney()` from `lib/intl/use-intl`
 *   - `formatX(value, locale, timeZone)` from `lib/intl/datetime`
 *   - `i18n.language` passed explicitly, where the shape is one-off
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `lib/intl` is where the correct implementations live, and its own doc
 * comments quote the wrong pattern in order to name it.
 */
const EXEMPT = new Set([
  'lib/intl/money.ts',
  'lib/intl/datetime.ts',
  'i18n/no-browser-locale.test.ts',
  // FROZEN for the V2 rebuild: the acquisition Platform screens are explicitly
  // out of scope, so their two call sites are recorded here rather than
  // touched. They are internal, English-only staff tooling, which is why this
  // is a deferral and not a shipped defect. Remove this line when that freeze
  // lifts — the fix is one argument each.
  'pages/platform-acquisition-prospect-detail-page.tsx',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('date and money formatting', () => {
  it('never asks the browser which language the app is in', () => {
    // Both routes to the same bug: the `toLocale*String` convenience methods,
    // and constructing an Intl formatter directly. The second is easy to miss
    // in review because it usually sits in a module-level helper, far from any
    // component that knows what language the app is in.
    const pattern = /(?:toLocale(?:Date|Time)?String|new Intl\.\w+Format)\(\s*undefined\b/

    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (EXEMPT.has(rel)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (pattern.test(line)) offenders.push(`${rel}:${index + 1}`)
      })
    }

    expect(
      offenders,
      'Pass the resolved locale: useDateTime()/useMoney(), lib/intl/datetime, or i18n.language',
    ).toEqual([])
  })

  it('never formats an appointment without saying which timezone it is in', () => {
    // The appointment formatters in lib/intl/datetime REQUIRE a timeZone
    // argument, which is the real guard. This catches the other route to the
    // same bug: a raw Intl call on a booking time with no zone at all, which
    // silently uses the device's. See reschedule-dialog, where it offered a
    // customer in London times an hour out for a Paris salon.
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (EXEMPT.has(rel)) continue
      const source = readFileSync(file, 'utf8')
      // A `new Date(<something>At)` immediately formatted, with no timeZone
      // anywhere in the same call.
      const calls = source.matchAll(/new Date\((\w*(?:startsAt|endsAt|slotStart|slotEnd)\w*)\)\.toLocale\w*\(([^)]*)\)/g)
      for (const call of calls) {
        if (!call[2].includes('timeZone')) {
          offenders.push(`${rel}: ${call[0].slice(0, 80)}`)
        }
      }
    }

    expect(offenders, 'An appointment time needs the BUSINESS timezone, never the device default').toEqual([])
  })
})
