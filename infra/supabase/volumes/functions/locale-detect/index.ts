// FadeUp — first-party country/locale detection endpoint.
//
// ============================================================================
// WHAT THIS IS FOR
// ============================================================================
//
//   ONE trusted server-side answer to "where is this visitor, roughly, and
//   what language should FadeUp open in" — instead of scattering third-party
//   IP-geolocation calls across React components, which would leak a provider
//   credential into the browser and cost a network round trip per page.
//
// ============================================================================
// WHY THIS IS NOT navigator.language
// ============================================================================
//
//   Accept-Language and IP geolocation answer different questions. A French
//   expatriate in London has Accept-Language: fr and is standing in a GBP
//   market; a British tourist in Paris is the reverse. FadeUp needs BOTH
//   signals and must not pretend one is the other:
//
//       country  -> currency and timezone defaults for a NEW business
//       language -> which words to render
//
//   Until LOT E this function only ever read Accept-Language, because the VPS
//   sets no country header. That made "GeoIP" a label on a browser-language
//   lookup. It now genuinely resolves the client IP.
//
// ============================================================================
// RESOLUTION ORDER
// ============================================================================
//
//   1. A trusted country header from the edge (CF-IPCountry, X-Country-Code).
//      Free, instant and authoritative when a CDN or a geoip-enabled nginx is
//      in front. Nothing sets one on this VPS today; the branch stays because
//      the day one does, it must win without a code change.
//
//   2. Server-side IP -> country lookup, from X-Real-IP / X-Forwarded-For
//      (nginx already sets both). Cached, time-boxed, and never fatal.
//
//   3. Accept-Language. A real signal about the reader, just not about the
//      market — so it sets the language and deliberately leaves country null.
//
//   4. English.
//
// ============================================================================
// PRIVACY
// ============================================================================
//
//   * Nothing is written to any database. This function has no DB client.
//   * The full IP is never stored. The in-memory cache is keyed by a TRUNCATED
//     prefix (/24 for IPv4, /48 for IPv6) — enough to reuse a lookup for a
//     neighbourhood, not enough to identify a visitor.
//   * The response carries a country code and never coordinates, city or ASN,
//     even when the provider returns them.
//   * This is personalization. It is never consulted for authorization — see
//     the LOT E report; roles come from memberships and nothing else.
//
// ============================================================================
// CONFIGURATION (names only — never put a value in source or in a report)
// ============================================================================
//
//   FADEUP_GEOIP_URL      Optional. Provider endpoint with {ip} as the
//                         placeholder. Defaults to a keyless provider.
//   FADEUP_GEOIP_TOKEN    Optional. Sent as a bearer token when the chosen
//                         provider needs one.
//   FADEUP_GEOIP_DISABLED Optional. Set to "1" to skip IP lookup entirely and
//                         fall through to Accept-Language.
//
//   With none of these set, the function still works: it uses the keyless
//   default, and if that is unreachable it degrades to Accept-Language.

const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'zh-CN', 'ja', 'ru'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

interface CountryDefaults {
  locale: SupportedLocale
  currency: string
  timezone: string
}

// Mirrors apps/web/src/lib/intl/countries.ts. Two runtimes cannot share a
// module, so the duplication is unavoidable — but it is NOT silent:
// src/lib/intl/countries.geoip-parity.test.ts parses this file and fails the
// build if the two tables ever disagree about a country.
const COUNTRY_DEFAULTS: Record<string, CountryDefaults> = {
  FR: { locale: 'fr', currency: 'EUR', timezone: 'Europe/Paris' },
  BE: { locale: 'fr', currency: 'EUR', timezone: 'Europe/Brussels' },
  LU: { locale: 'fr', currency: 'EUR', timezone: 'Europe/Luxembourg' },
  MC: { locale: 'fr', currency: 'EUR', timezone: 'Europe/Monaco' },
  CH: { locale: 'fr', currency: 'CHF', timezone: 'Europe/Zurich' },
  GB: { locale: 'en', currency: 'GBP', timezone: 'Europe/London' },
  IE: { locale: 'en', currency: 'EUR', timezone: 'Europe/Dublin' },
  DE: { locale: 'de', currency: 'EUR', timezone: 'Europe/Berlin' },
  AT: { locale: 'de', currency: 'EUR', timezone: 'Europe/Vienna' },
  ES: { locale: 'es', currency: 'EUR', timezone: 'Europe/Madrid' },
  IT: { locale: 'it', currency: 'EUR', timezone: 'Europe/Rome' },
  PT: { locale: 'pt', currency: 'EUR', timezone: 'Europe/Lisbon' },
  NL: { locale: 'en', currency: 'EUR', timezone: 'Europe/Amsterdam' },
  SE: { locale: 'en', currency: 'SEK', timezone: 'Europe/Stockholm' },
  NO: { locale: 'en', currency: 'NOK', timezone: 'Europe/Oslo' },
  DK: { locale: 'en', currency: 'DKK', timezone: 'Europe/Copenhagen' },
  PL: { locale: 'en', currency: 'PLN', timezone: 'Europe/Warsaw' },
  RU: { locale: 'ru', currency: 'RUB', timezone: 'Europe/Moscow' },
  BY: { locale: 'ru', currency: 'BYN', timezone: 'Europe/Minsk' },
  KZ: { locale: 'ru', currency: 'KZT', timezone: 'Asia/Almaty' },
  TR: { locale: 'en', currency: 'TRY', timezone: 'Europe/Istanbul' },
  US: { locale: 'en', currency: 'USD', timezone: 'America/New_York' },
  CA: { locale: 'en', currency: 'CAD', timezone: 'America/Toronto' },
  MX: { locale: 'es', currency: 'MXN', timezone: 'America/Mexico_City' },
  BR: { locale: 'pt', currency: 'BRL', timezone: 'America/Sao_Paulo' },
  AR: { locale: 'es', currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires' },
  CL: { locale: 'es', currency: 'CLP', timezone: 'America/Santiago' },
  CO: { locale: 'es', currency: 'COP', timezone: 'America/Bogota' },
  PE: { locale: 'es', currency: 'PEN', timezone: 'America/Lima' },
  MA: { locale: 'ar', currency: 'MAD', timezone: 'Africa/Casablanca' },
  DZ: { locale: 'ar', currency: 'DZD', timezone: 'Africa/Algiers' },
  TN: { locale: 'ar', currency: 'TND', timezone: 'Africa/Tunis' },
  EG: { locale: 'ar', currency: 'EGP', timezone: 'Africa/Cairo' },
  AE: { locale: 'ar', currency: 'AED', timezone: 'Asia/Dubai' },
  SA: { locale: 'ar', currency: 'SAR', timezone: 'Asia/Riyadh' },
  QA: { locale: 'ar', currency: 'QAR', timezone: 'Asia/Qatar' },
  KW: { locale: 'ar', currency: 'KWD', timezone: 'Asia/Kuwait' },
  JO: { locale: 'ar', currency: 'JOD', timezone: 'Asia/Amman' },
  LB: { locale: 'ar', currency: 'LBP', timezone: 'Asia/Beirut' },
  JP: { locale: 'ja', currency: 'JPY', timezone: 'Asia/Tokyo' },
  CN: { locale: 'zh-CN', currency: 'CNY', timezone: 'Asia/Shanghai' },
  HK: { locale: 'zh-CN', currency: 'HKD', timezone: 'Asia/Hong_Kong' },
  SG: { locale: 'en', currency: 'SGD', timezone: 'Asia/Singapore' },
  AU: { locale: 'en', currency: 'AUD', timezone: 'Australia/Sydney' },
  NZ: { locale: 'en', currency: 'NZD', timezone: 'Pacific/Auckland' },
  IN: { locale: 'en', currency: 'INR', timezone: 'Asia/Kolkata' },
  ZA: { locale: 'en', currency: 'ZAR', timezone: 'Africa/Johannesburg' },
  NG: { locale: 'en', currency: 'NGN', timezone: 'Africa/Lagos' },
  KE: { locale: 'en', currency: 'KES', timezone: 'Africa/Nairobi' },
  SN: { locale: 'fr', currency: 'XOF', timezone: 'Africa/Dakar' },
  CI: { locale: 'fr', currency: 'XOF', timezone: 'Africa/Abidjan' },
}

const FALLBACK: CountryDefaults = { locale: 'en', currency: 'USD', timezone: 'America/New_York' }

const GEOIP_URL = Deno.env.get('FADEUP_GEOIP_URL') ?? 'https://ipwho.is/{ip}'
const GEOIP_TOKEN = Deno.env.get('FADEUP_GEOIP_TOKEN') ?? ''
const GEOIP_DISABLED = Deno.env.get('FADEUP_GEOIP_DISABLED') === '1'
const LOOKUP_TIMEOUT_MS = 1200
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 5000

/**
 * Cache keyed by a TRUNCATED prefix, never a full address.
 *
 * Two purposes at once: it collapses a whole street onto one upstream lookup
 * (the provider has a rate limit and every page load would otherwise spend
 * one), and it means the process never holds anything that identifies a
 * single visitor.
 */
const cache = new Map<string, { country: string | null; expires: number }>()

function cacheKey(ip: string): string | null {
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean)
    if (groups.length < 3) return null
    return `${groups.slice(0, 3).join(':')}::/48`
  }
  const octets = ip.split('.')
  if (octets.length !== 4) return null
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

function isPrivateAddress(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')) return true
  const octets = ip.split('.').map(Number)
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false
  if (octets[0] === 10 || octets[0] === 127) return true
  if (octets[0] === 192 && octets[1] === 168) return true
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
  if (octets[0] === 169 && octets[1] === 254) return true
  return false
}

/**
 * The client's address as nginx reported it.
 *
 * X-Real-IP first: nginx sets it to $remote_addr, the address it actually
 * accepted the connection from, so a client cannot forge it. X-Forwarded-For
 * is a fallback and its LEFTMOST entry is client-supplied — fine for choosing
 * a language, and the reason this value is never used for anything else.
 */
function clientIp(req: Request): string | null {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp && !isPrivateAddress(realIp)) return realIp

  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    for (const candidate of forwarded.split(',').map((part) => part.trim())) {
      if (candidate && !isPrivateAddress(candidate)) return candidate
    }
  }
  return null
}

/** Two letters, A-Z. Anything else from a provider is treated as no answer. */
function sanitizeCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

async function lookupCountry(ip: string): Promise<string | null> {
  if (GEOIP_DISABLED) return null

  const key = cacheKey(ip)
  if (key) {
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.country
  }

  let country: string | null = null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
    const response = await fetch(GEOIP_URL.replace('{ip}', encodeURIComponent(ip)), {
      signal: controller.signal,
      headers: GEOIP_TOKEN ? { Authorization: `Bearer ${GEOIP_TOKEN}` } : {},
    })
    clearTimeout(timer)

    if (response.ok) {
      const body = await response.json()
      // Providers disagree on the field name; accept the common shapes and
      // reject anything that is not two letters. A malformed response must
      // produce "no answer", never a corrupt one.
      country =
        sanitizeCountry(body?.country_code) ??
        sanitizeCountry(body?.countryCode) ??
        sanitizeCountry(body?.country?.iso_code) ??
        null
    }
  } catch {
    // Timeout, DNS failure, rate limit, provider outage. All the same to us:
    // no country, carry on with Accept-Language. GeoIP must never be able to
    // break FadeUp.
    country = null
  }

  if (key) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      // Crude but bounded: drop the oldest insertion. A precise LRU is not
      // worth the memory in an edge function whose whole job is one lookup.
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    cache.set(key, { country, expires: Date.now() + CACHE_TTL_MS })
  }

  return country
}

/** Coarse Accept-Language parse: first tag whose primary subtag is supported. */
function localeFromAcceptLanguage(header: string | null): SupportedLocale | null {
  if (!header) return null
  for (const tag of header.split(',').map((part) => part.trim().split(';')[0]).filter(Boolean)) {
    const lower = tag.toLowerCase()
    if (lower === 'zh-cn' || lower.startsWith('zh-hans') || lower === 'zh') return 'zh-CN'
    const primary = lower.split('-')[0]
    const match = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === primary)
    if (match) return match
  }
  return null
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const headerCountry =
    sanitizeCountry(req.headers.get('cf-ipcountry')) ?? sanitizeCountry(req.headers.get('x-country-code'))

  let country = headerCountry
  let source: 'country-header' | 'ip-lookup' | 'accept-language' | 'fallback' = 'country-header'

  if (!country) {
    const ip = clientIp(req)
    if (ip) {
      country = await lookupCountry(ip)
      if (country) source = 'ip-lookup'
    }
  }

  if (country) {
    const defaults = COUNTRY_DEFAULTS[country] ?? null
    if (defaults) {
      return json({
        countryCode: country,
        suggestedLocale: defaults.locale,
        suggestedCurrency: defaults.currency,
        suggestedTimezone: defaults.timezone,
        source,
      })
    }
    // A real country FadeUp has no opinion about. Report it honestly — the
    // client can still use it for a country picker — but let the language come
    // from the reader's own browser rather than being guessed.
    const byLanguage = localeFromAcceptLanguage(req.headers.get('accept-language'))
    return json({
      countryCode: country,
      suggestedLocale: byLanguage ?? FALLBACK.locale,
      suggestedCurrency: FALLBACK.currency,
      suggestedTimezone: null,
      source,
    })
  }

  const byLanguage = localeFromAcceptLanguage(req.headers.get('accept-language'))
  if (byLanguage) {
    // No country: the language is knowable, the market is not. Returning a
    // currency here would be inventing one.
    return json({
      countryCode: null,
      suggestedLocale: byLanguage,
      suggestedCurrency: null,
      suggestedTimezone: null,
      source: 'accept-language',
    })
  }

  return json({
    countryCode: null,
    suggestedLocale: FALLBACK.locale,
    suggestedCurrency: null,
    suggestedTimezone: null,
    source: 'fallback',
  })
})

/**
 * BACKWARD COMPATIBILITY, and why it is not optional.
 *
 * infra/supabase/volumes/functions is BIND-MOUNTED into the running
 * edge-functions container, so editing this file changes production the moment
 * it is saved — there is no build or deploy step to gate it. The web bundle,
 * by contrast, is baked into an image and only changes when that image is
 * rebuilt.
 *
 * That means this function is always potentially serving a client that is
 * older than it is. The currently deployed bundle reads `country` and
 * `locale`; LOT E renamed those to `countryCode` and `suggestedLocale`. Emitting
 * only the new names silently broke regional pricing detection on the live
 * marketing site until this was added.
 *
 * So the response carries BOTH shapes. The legacy pair costs a few bytes and
 * removes a whole class of deploy-ordering bug.
 */
function withLegacyFields(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    country: body.countryCode ?? null,
    locale: body.suggestedLocale ?? 'en',
  }
}

function json(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(withLegacyFields(body)), {
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      // Private: the answer depends on the caller's address, so a shared cache
      // must never reuse it. An hour is long enough to stop a page-per-lookup
      // and short enough that travelling is reflected the same day.
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

// Exported for the parity test. Deno ignores this; the Vitest parser reads the
// table above by source, so this only documents intent.
export { COUNTRY_DEFAULTS }
