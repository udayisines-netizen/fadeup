/**
 * Locale-aware names for the two things onboarding shows that are NOT product
 * copy: weekdays and countries.
 *
 * Hand-translating "Tuesday" and "Netherlands" into ten locales would be a few
 * hundred strings to maintain, and the platform already knows them —
 * correctly, including for locales we have not thought about, and with the
 * right capitalisation conventions per language (French lowercases weekdays,
 * German does not). Intl is the right source here; the translation files stay
 * for copy that is actually ours.
 *
 * Both fall back to something usable rather than throwing: an environment
 * without full ICU data is rare but not impossible, and a missing weekday name
 * must not take down the hours step.
 */

/** Weekday names indexed 0=Sunday..6=Saturday, matching Postgres `extract(dow)`. */
export function weekdayLabels(locale: string): string[] {
  const fallback = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  try {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'long' })
    // 2024-01-07 was a Sunday, so +index lands on each weekday in order. Any
    // known Sunday works; this one is chosen only for being unambiguous.
    return Array.from({ length: 7 }, (_, index) =>
      formatter.format(new Date(Date.UTC(2024, 0, 7 + index))),
    )
  } catch {
    return fallback
  }
}

/** A country's name in the reader's language, or the raw code if unavailable. */
export function countryLabel(locale: string, code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
