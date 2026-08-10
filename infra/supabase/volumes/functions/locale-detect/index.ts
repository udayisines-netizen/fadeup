// FadeUp — first-party locale detection endpoint.
//
// Purpose: give the frontend ONE trusted server-side call for "what locale
// should an anonymous visitor start in", instead of scattering IP-geolocation
// calls to third-party APIs across React components (see CLAUDE.md /
// FADEUP master prompt, section 21).
//
// Country resolution: reads a country-code header if the reverse proxy in
// front of Kong sets one (e.g. an nginx `geoip2` module setting
// `X-Country-Code`, or a CDN's `CF-IPCountry`). No such header is configured
// on this VPS yet — until it is, this always falls through to
// Accept-Language, which is still resolved SERVER-SIDE here rather than
// duplicated per-component. Wiring a real GeoIP header is a reverse-proxy
// change, not a frontend change: once `X-Country-Code` (or `CF-IPCountry`)
// is present, this function starts using it with no frontend deploy needed.
//
// This never blocks: worst case, source is "fallback" and the client just
// uses its own Accept-Language/English fallback instead.

const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'zh-CN', 'ja', 'ru'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

// Only the countries where a supported locale is the clear primary language.
// Anything else (or an unrecognized/missing country) falls back to English.
const COUNTRY_TO_LOCALE: Record<string, SupportedLocale> = {
  FR: 'fr',
  BE: 'fr',
  LU: 'fr',
  MC: 'fr',
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CO: 'es',
  CL: 'es',
  PE: 'es',
  DE: 'de',
  AT: 'de',
  CH: 'de',
  IT: 'it',
  PT: 'pt',
  BR: 'pt',
  SA: 'ar',
  AE: 'ar',
  EG: 'ar',
  QA: 'ar',
  KW: 'ar',
  MA: 'ar',
  DZ: 'ar',
  TN: 'ar',
  JO: 'ar',
  CN: 'zh-CN',
  JP: 'ja',
  RU: 'ru',
  BY: 'ru',
  KZ: 'ru',
}

function localeFromCountry(countryCode: string | null): SupportedLocale | null {
  if (!countryCode) return null
  return COUNTRY_TO_LOCALE[countryCode.toUpperCase()] ?? null
}

/** Coarse Accept-Language parse: first tag whose primary subtag matches a supported locale. */
function localeFromAcceptLanguage(header: string | null): SupportedLocale | null {
  if (!header) return null
  const tags = header
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .filter(Boolean)

  for (const tag of tags) {
    if (tag.toLowerCase() === 'zh-cn' || tag.toLowerCase().startsWith('zh-hans')) return 'zh-CN'
    const primary = tag.split('-')[0].toLowerCase()
    const match = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === primary)
    if (match) return match
  }
  return null
}

Deno.serve((req: Request) => {
  const countryCode = req.headers.get('x-country-code') ?? req.headers.get('cf-ipcountry')
  const acceptLanguage = req.headers.get('accept-language')

  const byCountry = localeFromCountry(countryCode)
  if (byCountry) {
    return json({ locale: byCountry, source: 'country-header', country: countryCode })
  }

  const byAcceptLanguage = localeFromAcceptLanguage(acceptLanguage)
  if (byAcceptLanguage) {
    return json({ locale: byAcceptLanguage, source: 'accept-language', country: null })
  }

  return json({ locale: 'en', source: 'fallback', country: null })
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
