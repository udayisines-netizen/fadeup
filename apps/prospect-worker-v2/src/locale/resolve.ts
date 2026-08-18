/**
 * Deterministic locale resolution (spec §22).
 *
 * The one rule that matters: the business NAME is never evidence. "Le
 * Barbier" in London is an English-speaking business, and "Gentlemen's
 * Cut" in Lyon is a French-speaking one. Guessing language from a name is
 * how a French barber receives an English cold message.
 *
 * Evidence is consulted in a fixed priority order. When the top-priority
 * evidence is missing, we fall to the next; when the surviving evidence is
 * weak or contradictory, `reviewRequired` is set and outreach is BLOCKED
 * until a human resolves it (enforced in SQL by
 * public.outreach_block_reason).
 */

export type LocaleSource =
  | 'verified_business_country'
  | 'business_address'
  | 'website_language'
  | 'provider_locale'
  | 'phone_country'
  | 'dominant_website_language'
  | 'manual_override'
  | 'default_fallback'

export interface LocaleEvidence {
  /** Country from an authoritative registry (e.g. an INSEE SIRENE record). Strongest signal. */
  verifiedCountry: string | null
  /** Country from the postal address recorded on the prospect. */
  addressCountry: string | null
  /** `lang` attribute on the crawled homepage's <html> element. */
  websiteHtmlLang: string | null
  /** Locale reported by a discovery provider for this listing. */
  providerLocale: string | null
  /** E.164 phone number, used only for its country calling code. */
  phoneE164: string | null
  /** Language inferred from crawled page text, when available. */
  dominantWebsiteLanguage: string | null
}

export interface ResolvedLocale {
  detectedCountry: string | null
  detectedLanguage: string | null
  locale: string | null
  languageSource: LocaleSource | null
  languageConfidence: number
  reviewRequired: boolean
  evidence: Record<string, unknown>
}

/**
 * The locales FadeUp actually has approved templates for. A prospect
 * resolving to anything else is flagged for review rather than being
 * quietly mapped onto the nearest supported language.
 */
export const SUPPORTED_LOCALES = ['fr-FR', 'en-GB', 'en-US'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** Default language per country, for countries FadeUp targets. */
const COUNTRY_DEFAULT_LANGUAGE: Record<string, string> = {
  FR: 'fr',
  BE: 'fr',
  CH: 'fr',
  MC: 'fr',
  LU: 'fr',
  GB: 'en',
  IE: 'en',
  US: 'en',
  CA: 'en',
  AU: 'en',
  NZ: 'en',
}

/** Country from an E.164 calling code. Only unambiguous prefixes are listed — +1 covers both US and CA, so it maps to neither. */
const CALLING_CODE_COUNTRY: { prefix: string; country: string }[] = [
  { prefix: '+33', country: 'FR' },
  { prefix: '+44', country: 'GB' },
  { prefix: '+32', country: 'BE' },
  { prefix: '+41', country: 'CH' },
  { prefix: '+352', country: 'LU' },
  { prefix: '+353', country: 'IE' },
  { prefix: '+377', country: 'MC' },
  { prefix: '+61', country: 'AU' },
  { prefix: '+64', country: 'NZ' },
]

export function resolveLocale(evidence: LocaleEvidence): ResolvedLocale {
  const trail: Record<string, unknown> = {}

  // --- Country ---------------------------------------------------------
  let country: string | null = null
  let countrySource: LocaleSource | null = null

  if (evidence.verifiedCountry) {
    country = normalizeCountry(evidence.verifiedCountry)
    countrySource = 'verified_business_country'
    trail['verified_country'] = evidence.verifiedCountry
  } else if (evidence.addressCountry) {
    country = normalizeCountry(evidence.addressCountry)
    countrySource = 'business_address'
    trail['address_country'] = evidence.addressCountry
  } else if (evidence.phoneE164) {
    const fromPhone = countryFromPhone(evidence.phoneE164)
    if (fromPhone) {
      country = fromPhone
      countrySource = 'phone_country'
      trail['phone_country'] = fromPhone
    }
  }

  // --- Language --------------------------------------------------------
  let language: string | null = null
  let languageSource: LocaleSource | null = null
  let confidence = 0

  // 1. The website explicitly declaring its language is the most direct
  //    evidence of how this business talks to its own customers.
  const htmlLang = normalizeLanguage(evidence.websiteHtmlLang)
  if (htmlLang) {
    language = htmlLang
    languageSource = 'website_language'
    confidence = 0.9
    trail['website_html_lang'] = evidence.websiteHtmlLang
  }

  // 2. A provider-reported locale.
  if (!language && evidence.providerLocale) {
    const providerLang = normalizeLanguage(evidence.providerLocale)
    if (providerLang) {
      language = providerLang
      languageSource = 'provider_locale'
      confidence = 0.7
      trail['provider_locale'] = evidence.providerLocale
    }
  }

  // 3. Language detected from page text.
  if (!language && evidence.dominantWebsiteLanguage) {
    const dominant = normalizeLanguage(evidence.dominantWebsiteLanguage)
    if (dominant) {
      language = dominant
      languageSource = 'dominant_website_language'
      confidence = 0.6
      trail['dominant_website_language'] = evidence.dominantWebsiteLanguage
    }
  }

  // 4. The country's default language. Weakest, but genuinely informative
  //    for the markets FadeUp targets.
  if (!language && country) {
    const fallback = COUNTRY_DEFAULT_LANGUAGE[country]
    if (fallback) {
      language = fallback
      languageSource = countrySource === 'phone_country' ? 'phone_country' : 'business_address'
      // Deliberately below the review threshold: a country default is an
      // assumption, not an observation.
      confidence = 0.45
      trail['country_default_language'] = fallback
    }
  }

  if (!country || !language) {
    return {
      detectedCountry: country,
      detectedLanguage: language,
      locale: null,
      languageSource,
      languageConfidence: confidence,
      reviewRequired: true,
      evidence: { ...trail, review_reason: !country ? 'country_undetermined' : 'language_undetermined' },
    }
  }

  const locale = buildLocale(language, country)

  // A locale we have no approved templates for must be reviewed, not
  // silently coerced onto the closest supported one.
  const supported = (SUPPORTED_LOCALES as readonly string[]).includes(locale)

  // Contradiction check: an explicit website language that disagrees with
  // the country's default is legitimate (a Turkish barber in Paris with a
  // Turkish site) but it means the right template is not obvious.
  const countryDefault = COUNTRY_DEFAULT_LANGUAGE[country]
  const contradicts = countryDefault !== undefined && countryDefault !== language && languageSource === 'website_language'

  const reviewRequired = !supported || contradicts || confidence < 0.5

  return {
    detectedCountry: country,
    detectedLanguage: language,
    locale,
    languageSource,
    languageConfidence: confidence,
    reviewRequired,
    evidence: {
      ...trail,
      country_source: countrySource,
      supported_locale: supported,
      contradicts_country_default: contradicts,
      ...(reviewRequired
        ? {
            review_reason: !supported
              ? 'unsupported_locale'
              : contradicts
                ? 'website_language_contradicts_country'
                : 'low_confidence',
          }
        : {}),
    },
  }
}

/**
 * Maps a language + country onto a supported locale. en-GB vs en-US
 * matters for copy, so the country genuinely selects between them.
 */
function buildLocale(language: string, country: string): string {
  if (language === 'en') {
    if (country === 'US') return 'en-US'
    if (country === 'CA') return 'en-US'
    return 'en-GB'
  }
  if (language === 'fr') return 'fr-FR'
  return `${language}-${country}`
}

function normalizeCountry(value: string | null): string | null {
  if (!value) return null
  const upper = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(upper) ? upper : null
}

/** Takes the primary subtag: 'fr-CA' -> 'fr', 'EN_GB' -> 'en'. */
function normalizeLanguage(value: string | null): string | null {
  if (!value) return null
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return /^[a-z]{2}$/.test(primary) ? primary : null
}

function countryFromPhone(phoneE164: string): string | null {
  const normalized = phoneE164.replace(/[^\d+]/g, '')
  // Longest prefix first, so +352 is not shadowed by +35.
  const sorted = [...CALLING_CODE_COUNTRY].sort((a, b) => b.prefix.length - a.prefix.length)
  return sorted.find((entry) => normalized.startsWith(entry.prefix))?.country ?? null
}
