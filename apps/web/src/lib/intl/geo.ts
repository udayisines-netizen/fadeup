import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { normalizeLocale, type SupportedLocale } from '@/lib/locale'

/**
 * The browser's side of country detection.
 *
 * Everything that matters happens in the `locale-detect` Edge Function: it
 * reads the client address nginx forwarded, resolves a country server-side,
 * and never lets a provider credential near a browser. This module's whole job
 * is to call that once, cache it hard, and make failure boring.
 *
 * CACHING IS THE POINT. A country does not change between two route
 * transitions. Without a cache this becomes a network round trip per page,
 * which is exactly the "external GeoIP API on every render" failure mode:
 *
 *   * localStorage, 24h  — survives reloads and new tabs
 *   * TanStack, Infinity — one call per session even on a cold cache
 *
 * FAILURE IS NOT AN ERROR. Every path returns a usable object. A visitor
 * behind a VPN, an ad blocker eating the request, or the provider being down
 * must all produce a working FadeUp in a reasonable language — never a
 * loading state that does not resolve, and never a thrown error.
 */

export interface GeoSuggestion {
  /** ISO 3166-1 alpha-2, or null when the country genuinely could not be resolved. */
  countryCode: string | null
  suggestedLocale: SupportedLocale | null
  /** ISO 4217. Only a SUGGESTION for a new business — never applied to an existing one. */
  suggestedCurrency: string | null
  suggestedTimezone: string | null
  source: 'country-header' | 'ip-lookup' | 'accept-language' | 'fallback' | 'cache' | 'unavailable'
}

const CACHE_KEY = 'fadeup-geo'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Nothing known. Callers can use this without branching. */
export const UNKNOWN_GEO: GeoSuggestion = {
  countryCode: null,
  suggestedLocale: null,
  suggestedCurrency: null,
  suggestedTimezone: null,
  source: 'unavailable',
}

function readCache(): GeoSuggestion | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { value: GeoSuggestion; expires: number }
    if (!parsed?.expires || parsed.expires < Date.now()) return null
    return { ...parsed.value, source: 'cache' }
  } catch {
    return null
  }
}

function writeCache(value: GeoSuggestion): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ value, expires: Date.now() + CACHE_TTL_MS }))
  } catch {
    // Private mode or a full quota. The lookup simply repeats next session.
  }
}

/**
 * Validates the Edge Function's answer before any of it is trusted.
 *
 * A malformed provider response must not become a malformed FadeUp: an
 * unexpected shape is treated as "no answer", not passed through as a country
 * code that later ends up in a currency lookup or a country picker.
 */
function parseSuggestion(data: unknown): GeoSuggestion {
  if (!data || typeof data !== 'object') return UNKNOWN_GEO
  const body = data as Record<string, unknown>

  const rawCountry = typeof body.countryCode === 'string' ? body.countryCode.toUpperCase() : null
  const countryCode = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null

  const rawCurrency = typeof body.suggestedCurrency === 'string' ? body.suggestedCurrency.toUpperCase() : null
  const suggestedCurrency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null

  const rawTimezone = typeof body.suggestedTimezone === 'string' ? body.suggestedTimezone : null
  // A timezone we cannot construct a formatter for is worse than none: it
  // would throw somewhere far from here.
  let suggestedTimezone: string | null = null
  if (rawTimezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: rawTimezone })
      suggestedTimezone = rawTimezone
    } catch {
      suggestedTimezone = null
    }
  }

  const source =
    body.source === 'country-header' || body.source === 'ip-lookup' || body.source === 'accept-language'
      ? body.source
      : 'fallback'

  return {
    countryCode,
    suggestedLocale: normalizeLocale(typeof body.suggestedLocale === 'string' ? body.suggestedLocale : null),
    suggestedCurrency,
    suggestedTimezone,
    source,
  }
}

let inFlight: Promise<GeoSuggestion> | null = null

/**
 * One country lookup, ever, per cache window.
 *
 * `inFlight` deduplicates the case where several components mount at once on
 * a cold cache — without it, a first paint that renders the header, the
 * booking page and the onboarding wizard fires three identical requests.
 */
export async function fetchGeoSuggestion(): Promise<GeoSuggestion> {
  const cached = readCache()
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.functions.invoke('locale-detect')
      if (error) throw error
      const suggestion = parseSuggestion(data)
      writeCache(suggestion)
      return suggestion
    } catch {
      // Cached as unavailable too, deliberately: an ad blocker or an offline
      // visitor should not retry a doomed request on every page for 24 hours.
      writeCache(UNKNOWN_GEO)
      return UNKNOWN_GEO
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

export const geoQueryKey = ['geo-suggestion'] as const

/**
 * The country suggestion, for surfaces that want it (onboarding defaults, a
 * country picker's initial value).
 *
 * Never `enabled: false` and never in an error state: a failed lookup resolves
 * to UNKNOWN_GEO, so callers write `geo.countryCode ?? somethingSensible`
 * rather than handling a query lifecycle for a hint.
 */
export function useGeoSuggestion() {
  const query = useQuery({
    queryKey: geoQueryKey,
    queryFn: fetchGeoSuggestion,
    // A country does not change while someone books a haircut. This is what
    // stops a route change from becoming a lookup.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return query.data ?? UNKNOWN_GEO
}

/** Test seam: forget the cached answer. */
export function clearGeoCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Nothing to clear.
  }
  inFlight = null
}
