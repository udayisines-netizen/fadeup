/** The 10 locales FadeUp ships translations for. Order matches the FADEUP master prompt. */
export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'zh-CN', 'ja', 'ru'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  ar: 'العربية',
  'zh-CN': '简体中文',
  ja: '日本語',
  ru: 'Русский',
}

const RTL_LOCALES = new Set<SupportedLocale>(['ar'])

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale as SupportedLocale)
}

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale.toLowerCase() === value?.toLowerCase())
}

/** Normalizes a loosely-cased tag ("EN", "zh-cn") to its canonical supported form, or null. */
export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null
  const match = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === value.toLowerCase())
  return match ?? null
}

const EXPLICIT_KEY = 'fadeup-locale-explicit'
const DETECTED_KEY = 'fadeup-locale-detected'

/** The user manually picked this locale (language switcher) — outranks profile/geo/browser forever, until changed again. */
export function getExplicitLocale(): SupportedLocale | null {
  try {
    return normalizeLocale(localStorage.getItem(EXPLICIT_KEY))
  } catch {
    return null
  }
}

export function setExplicitLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(EXPLICIT_KEY, locale)
  } catch {
    // localStorage unavailable (private mode / disabled) — locale still applies for this session via i18next state.
  }
}

/** A previously auto-detected (geo/browser) locale, cached so we don't re-hit the detection endpoint on every load. */
export function getDetectedLocale(): SupportedLocale | null {
  try {
    return normalizeLocale(localStorage.getItem(DETECTED_KEY))
  } catch {
    return null
  }
}

function setDetectedLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(DETECTED_KEY, locale)
  } catch {
    // Non-fatal — detection just re-runs next load.
  }
}

function localeFromBrowser(): SupportedLocale {
  const candidates = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.toLowerCase().startsWith('zh')) return 'zh-CN'
    const primary = candidate.split('-')[0]
    const match = normalizeLocale(primary)
    if (match) return match
  }
  return 'en'
}

/**
 * Synchronous first pass — safe to call before first paint (no network).
 * Priority: explicit selection > cached detection > browser language > English.
 * Authenticated profile preference is applied afterward, once loaded (see
 * `useSyncProfileLocale` in `lib/queries/profile.ts`) — it is not knowable
 * synchronously at boot.
 */
export function resolveInitialLocale(): SupportedLocale {
  return getExplicitLocale() ?? getDetectedLocale() ?? localeFromBrowser()
}

/**
 * Server-side country/language detection, applied only where it is allowed to
 * matter (see `resolveLocale` below for the full order).
 *
 * The country resolution itself lives in the `locale-detect` Edge Function and
 * is reached through `lib/intl/geo.ts`, which caches it for 24 hours — this is
 * a hint about a first visit, not something to ask on every page.
 *
 * Callers must check for an explicit choice themselves before applying the
 * result, so a slow lookup finishing late can never override a language the
 * user picked while it was in flight.
 */
export async function detectLocale(): Promise<SupportedLocale> {
  // Imported lazily: this pulls in the Supabase client and the geo cache, and
  // nothing on a first paint needs either.
  const { fetchGeoSuggestion } = await import('@/lib/intl/geo')
  const suggestion = await fetchGeoSuggestion()
  const detected = suggestion.suggestedLocale ?? localeFromBrowser()
  setDetectedLocale(detected)
  return detected
}

/**
 * THE LOCALE PRIORITY, in one place.
 *
 *   1. EXPLICIT — the user used the language switcher on this device.
 *      Outranks everything, forever, until they change it again. A product
 *      that keeps re-guessing after being told is worse than one that never
 *      guessed.
 *   2. ACCOUNT — profiles.locale, so a choice made on a laptop follows the
 *      user to their phone. Applied by PreferencesSync once auth resolves,
 *      because it cannot be known synchronously at boot.
 *   3. ANONYMOUS CACHE — a previously detected locale on this device.
 *      Keeps the second visit instant and stable.
 *   4. GEOIP — the country the visitor is actually in.
 *   5. BROWSER — Accept-Language / navigator.languages.
 *   6. ENGLISH.
 *
 * Steps 1, 3 and 5 are synchronous and resolve before first paint
 * (`resolveInitialLocale`). Steps 2 and 4 arrive later and are applied only if
 * nothing higher has spoken — which is why both of their call sites re-check
 * `getExplicitLocale()` at the moment they apply, not when they started.
 */
export function resolveLocale(input: {
  explicit?: SupportedLocale | null
  account?: SupportedLocale | null
  detected?: SupportedLocale | null
  geo?: SupportedLocale | null
  browser?: SupportedLocale | null
}): SupportedLocale {
  return input.explicit ?? input.account ?? input.detected ?? input.geo ?? input.browser ?? 'en'
}

/** Exported so the resolver can be tested against a real browser signal. */
export { localeFromBrowser }
