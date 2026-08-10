import { getSupabaseClient } from '@/lib/supabase'

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
function getDetectedLocale(): SupportedLocale | null {
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
 * Best-effort server-side geo/Accept-Language detection (see
 * infra/supabase/volumes/functions/locale-detect). Only meaningful when the
 * user has no explicit choice yet — callers must check that themselves
 * before applying the result, so a slow/failed lookup never overrides a
 * choice the user already made.
 */
export async function detectLocale(): Promise<SupportedLocale> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.functions.invoke<{ locale: string }>('locale-detect')
    if (error) throw error
    const detected = normalizeLocale(data?.locale) ?? localeFromBrowser()
    setDetectedLocale(detected)
    return detected
  } catch {
    const fallback = localeFromBrowser()
    setDetectedLocale(fallback)
    return fallback
  }
}
