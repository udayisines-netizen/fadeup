import type { SupportedLocale } from '@/lib/locale'

/**
 * Country metadata — the one place that knows what a country implies.
 *
 * Without this, "if (country === 'FR')" spreads through onboarding, pricing,
 * the locale resolver and the currency picker, and the four copies disagree
 * within a release. Everything that needs a default for a country asks here.
 *
 * Deliberately NOT exhaustive over all 249 ISO codes: a country earns an entry
 * when FadeUp can say something TRUE about it. Anything unlisted falls back
 * explicitly rather than being guessed, because a wrong default currency is
 * worse than an obvious one the owner has to set.
 *
 * `locale` is the language FadeUp would SUGGEST — never impose. Several of
 * these countries are multilingual, and the suggestion is only ever the
 * starting point of a choice the user can change in one tap.
 */

export interface CountryMeta {
  /** ISO 3166-1 alpha-2. */
  code: string
  /** English name. Display names come from Intl.DisplayNames in the user's own locale. */
  name: string
  /** Suggested UI language. A suggestion, never a lock. */
  locale: SupportedLocale
  /** ISO 4217. The default for a NEW business here; an existing one keeps what it chose. */
  currency: string
  /** IANA timezone offered first during onboarding. Large countries have several; this is the most populous. */
  timezone: string
}

const COUNTRIES: CountryMeta[] = [
  // Europe — francophone
  { code: 'FR', name: 'France', locale: 'fr', currency: 'EUR', timezone: 'Europe/Paris' },
  { code: 'BE', name: 'Belgium', locale: 'fr', currency: 'EUR', timezone: 'Europe/Brussels' },
  { code: 'LU', name: 'Luxembourg', locale: 'fr', currency: 'EUR', timezone: 'Europe/Luxembourg' },
  { code: 'MC', name: 'Monaco', locale: 'fr', currency: 'EUR', timezone: 'Europe/Monaco' },
  // Switzerland: French is the FadeUp suggestion (Geneva/Lausanne are the
  // launch cities) but the currency is emphatically not the euro.
  { code: 'CH', name: 'Switzerland', locale: 'fr', currency: 'CHF', timezone: 'Europe/Zurich' },

  // Europe — other
  { code: 'GB', name: 'United Kingdom', locale: 'en', currency: 'GBP', timezone: 'Europe/London' },
  { code: 'IE', name: 'Ireland', locale: 'en', currency: 'EUR', timezone: 'Europe/Dublin' },
  { code: 'DE', name: 'Germany', locale: 'de', currency: 'EUR', timezone: 'Europe/Berlin' },
  { code: 'AT', name: 'Austria', locale: 'de', currency: 'EUR', timezone: 'Europe/Vienna' },
  { code: 'ES', name: 'Spain', locale: 'es', currency: 'EUR', timezone: 'Europe/Madrid' },
  { code: 'IT', name: 'Italy', locale: 'it', currency: 'EUR', timezone: 'Europe/Rome' },
  { code: 'PT', name: 'Portugal', locale: 'pt', currency: 'EUR', timezone: 'Europe/Lisbon' },
  { code: 'NL', name: 'Netherlands', locale: 'en', currency: 'EUR', timezone: 'Europe/Amsterdam' },
  { code: 'SE', name: 'Sweden', locale: 'en', currency: 'SEK', timezone: 'Europe/Stockholm' },
  { code: 'NO', name: 'Norway', locale: 'en', currency: 'NOK', timezone: 'Europe/Oslo' },
  { code: 'DK', name: 'Denmark', locale: 'en', currency: 'DKK', timezone: 'Europe/Copenhagen' },
  { code: 'PL', name: 'Poland', locale: 'en', currency: 'PLN', timezone: 'Europe/Warsaw' },
  { code: 'RU', name: 'Russia', locale: 'ru', currency: 'RUB', timezone: 'Europe/Moscow' },
  { code: 'BY', name: 'Belarus', locale: 'ru', currency: 'BYN', timezone: 'Europe/Minsk' },
  { code: 'KZ', name: 'Kazakhstan', locale: 'ru', currency: 'KZT', timezone: 'Asia/Almaty' },
  { code: 'TR', name: 'Türkiye', locale: 'en', currency: 'TRY', timezone: 'Europe/Istanbul' },

  // Americas
  { code: 'US', name: 'United States', locale: 'en', currency: 'USD', timezone: 'America/New_York' },
  { code: 'CA', name: 'Canada', locale: 'en', currency: 'CAD', timezone: 'America/Toronto' },
  { code: 'MX', name: 'Mexico', locale: 'es', currency: 'MXN', timezone: 'America/Mexico_City' },
  { code: 'BR', name: 'Brazil', locale: 'pt', currency: 'BRL', timezone: 'America/Sao_Paulo' },
  { code: 'AR', name: 'Argentina', locale: 'es', currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires' },
  { code: 'CL', name: 'Chile', locale: 'es', currency: 'CLP', timezone: 'America/Santiago' },
  { code: 'CO', name: 'Colombia', locale: 'es', currency: 'COP', timezone: 'America/Bogota' },
  { code: 'PE', name: 'Peru', locale: 'es', currency: 'PEN', timezone: 'America/Lima' },

  // Middle East & North Africa
  { code: 'MA', name: 'Morocco', locale: 'ar', currency: 'MAD', timezone: 'Africa/Casablanca' },
  { code: 'DZ', name: 'Algeria', locale: 'ar', currency: 'DZD', timezone: 'Africa/Algiers' },
  { code: 'TN', name: 'Tunisia', locale: 'ar', currency: 'TND', timezone: 'Africa/Tunis' },
  { code: 'EG', name: 'Egypt', locale: 'ar', currency: 'EGP', timezone: 'Africa/Cairo' },
  { code: 'AE', name: 'United Arab Emirates', locale: 'ar', currency: 'AED', timezone: 'Asia/Dubai' },
  { code: 'SA', name: 'Saudi Arabia', locale: 'ar', currency: 'SAR', timezone: 'Asia/Riyadh' },
  { code: 'QA', name: 'Qatar', locale: 'ar', currency: 'QAR', timezone: 'Asia/Qatar' },
  { code: 'KW', name: 'Kuwait', locale: 'ar', currency: 'KWD', timezone: 'Asia/Kuwait' },
  { code: 'JO', name: 'Jordan', locale: 'ar', currency: 'JOD', timezone: 'Asia/Amman' },
  { code: 'LB', name: 'Lebanon', locale: 'ar', currency: 'LBP', timezone: 'Asia/Beirut' },

  // Asia-Pacific
  { code: 'JP', name: 'Japan', locale: 'ja', currency: 'JPY', timezone: 'Asia/Tokyo' },
  { code: 'CN', name: 'China', locale: 'zh-CN', currency: 'CNY', timezone: 'Asia/Shanghai' },
  { code: 'HK', name: 'Hong Kong', locale: 'zh-CN', currency: 'HKD', timezone: 'Asia/Hong_Kong' },
  { code: 'SG', name: 'Singapore', locale: 'en', currency: 'SGD', timezone: 'Asia/Singapore' },
  { code: 'AU', name: 'Australia', locale: 'en', currency: 'AUD', timezone: 'Australia/Sydney' },
  { code: 'NZ', name: 'New Zealand', locale: 'en', currency: 'NZD', timezone: 'Pacific/Auckland' },
  { code: 'IN', name: 'India', locale: 'en', currency: 'INR', timezone: 'Asia/Kolkata' },

  // Africa
  { code: 'ZA', name: 'South Africa', locale: 'en', currency: 'ZAR', timezone: 'Africa/Johannesburg' },
  { code: 'NG', name: 'Nigeria', locale: 'en', currency: 'NGN', timezone: 'Africa/Lagos' },
  { code: 'KE', name: 'Kenya', locale: 'en', currency: 'KES', timezone: 'Africa/Nairobi' },
  { code: 'SN', name: 'Senegal', locale: 'fr', currency: 'XOF', timezone: 'Africa/Dakar' },
  { code: 'CI', name: "Côte d'Ivoire", locale: 'fr', currency: 'XOF', timezone: 'Africa/Abidjan' },
]

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]))

/**
 * What FadeUp assumes when it knows nothing at all.
 *
 * English and USD rather than French and EUR: FadeUp launched in France, and
 * the temptation is to make France the fallback. But a fallback is what a
 * visitor gets when we have NO idea where they are, and silently telling a
 * Nigerian shop its prices are in euros is a worse failure than showing a
 * French one an English screen it can switch in one tap.
 */
export const FALLBACK_COUNTRY: CountryMeta = {
  code: 'US',
  name: 'United States',
  locale: 'en',
  currency: 'USD',
  timezone: 'America/New_York',
}

export function countryMeta(countryCode: string | null | undefined): CountryMeta | null {
  if (!countryCode) return null
  return BY_CODE.get(countryCode.toUpperCase()) ?? null
}

/** The locale to SUGGEST for a country. Null when we have nothing honest to say. */
export function localeForCountry(countryCode: string | null | undefined): SupportedLocale | null {
  return countryMeta(countryCode)?.locale ?? null
}

/** The default currency for a NEW business in a country. An existing business keeps its own. */
export function currencyForCountry(countryCode: string | null | undefined): string {
  return countryMeta(countryCode)?.currency ?? FALLBACK_COUNTRY.currency
}

/** The timezone offered first during onboarding. Never applied to an existing location. */
export function timezoneForCountry(countryCode: string | null | undefined): string {
  return countryMeta(countryCode)?.timezone ?? FALLBACK_COUNTRY.timezone
}

export function isKnownCountry(countryCode: string | null | undefined): boolean {
  return countryMeta(countryCode) !== null
}

/** Every country FadeUp can speak about, for pickers. */
export const KNOWN_COUNTRIES: readonly CountryMeta[] = COUNTRIES

const displayNamesCache = new Map<string, Intl.DisplayNames>()

/**
 * A country's name in the READER's language — "Allemagne" for a French user,
 * "Germany" for an English one. Falls back to the English name rather than
 * showing a bare code, which is what an unsupported runtime would produce.
 */
export function countryName(countryCode: string, locale: string): string {
  try {
    let formatter = displayNamesCache.get(locale)
    if (!formatter) {
      formatter = new Intl.DisplayNames([locale], { type: 'region' })
      displayNamesCache.set(locale, formatter)
    }
    return formatter.of(countryCode.toUpperCase()) ?? countryMeta(countryCode)?.name ?? countryCode
  } catch {
    return countryMeta(countryCode)?.name ?? countryCode
  }
}
