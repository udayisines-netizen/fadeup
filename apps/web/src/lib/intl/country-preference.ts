import { isKnownCountry } from '@/lib/intl/countries'

/**
 * ============================================================================
 * THE COUNTRY THE CUSTOMER CHOSE
 * ============================================================================
 *
 * §31, and criterion AC: a customer may change LANGUAGE and COUNTRY after
 * automatic detection, and BOTH must persist.
 *
 * Language already did — `lib/locale.ts` has kept an explicit choice in
 * `fadeup-locale-explicit` since Lot E, outranking profile, geo and browser
 * forever until changed again. Country did not. GeoIP was cached for 24 hours
 * in `fadeup-geo` and the only way to override it was a `?country=` parameter
 * that died with the tab, so someone travelling — or behind a VPN, or simply
 * living somewhere their IP disagrees with — re-fought the same filter on
 * every visit.
 *
 * This module is deliberately the same shape as the locale one, key for key,
 * because the two answer the same kind of question and a customer who learns
 * how one behaves has learned both.
 *
 * ============================================================================
 * "ANYWHERE" IS A CHOICE, NOT AN ABSENCE
 * ============================================================================
 *
 * `ANYWHERE` is stored as a real value rather than by clearing the key. The
 * difference matters: a cleared key means "never chose, use the detection",
 * and clearing it would resurrect the GeoIP filter on the next visit — which
 * is exactly the behaviour the customer just switched off. They must be
 * distinguishable, so they are two different stored states.
 */

const EXPLICIT_KEY = 'fadeup-country-explicit'

/** The customer searched everywhere on purpose. */
export const ANYWHERE = 'any' as const

export type CountryPreference = string | typeof ANYWHERE

function normalize(value: string | null | undefined): CountryPreference | null {
  if (!value) return null
  if (value === ANYWHERE) return ANYWHERE
  const upper = value.toUpperCase()
  // A code FadeUp knows nothing about is treated as no choice at all rather
  // than stored and later used as a filter that silently matches nothing.
  return isKnownCountry(upper) ? upper : null
}

/** The country the customer picked themselves, or null if they never have. */
export function getExplicitCountry(): CountryPreference | null {
  try {
    return normalize(localStorage.getItem(EXPLICIT_KEY))
  } catch {
    // Private mode or storage disabled. The choice still applies for this
    // render; it just will not survive a reload.
    return null
  }
}

export function setExplicitCountry(value: CountryPreference | null): void {
  try {
    if (value === null) localStorage.removeItem(EXPLICIT_KEY)
    else localStorage.setItem(EXPLICIT_KEY, value)
  } catch {
    // Non-fatal by design — see above.
  }
}

/**
 * What the marketplace should actually filter by.
 *
 * The precedence is the whole point, and it is the same as the locale's:
 *
 *   1. an explicit choice, including "anywhere"   — outranks everything
 *   2. GeoIP detection                            — a suggestion
 *   3. nothing                                    — search everywhere
 *
 * Returns null for both "chose anywhere" and "nothing known", because the
 * marketplace treats them identically. The DIFFERENCE between them lives in
 * storage, where it belongs: it decides what happens on the next visit, not
 * what happens to this query.
 */
export function effectiveCountry(detected: string | null | undefined): string | null {
  const explicit = getExplicitCountry()
  if (explicit === ANYWHERE) return null
  if (explicit) return explicit
  return detected ?? null
}
