/**
 * FadeUp's OWN subscription pricing — the single commercial source of truth.
 *
 * Two rules this module exists to enforce:
 *
 * 1. No price is ever written into JSX or into a translation file. Copy is
 *    translated; money is data. A number living in `fr/marketing.json` would
 *    make French the authority on what FadeUp charges, which is nonsense, and
 *    would drift the moment one locale is updated and nine are not.
 *
 * 2. Pricing region is decided by COMMERCIAL GEOGRAPHY, never by language. A
 *    visitor in Paris reading the site in English is still billed in EUR at
 *    the France price; a visitor in Texas reading it in French is billed in
 *    USD. Currency follows where you are, not what you speak.
 *
 * Unrelated: a barbershop's own service prices are the shop's, in the shop's
 * currency, and are never converted for a visitor. Only FadeUp's own
 * subscription follows the regions below.
 */

export type PricingRegion = 'eu' | 'uk' | 'us' | 'ca' | 'ch' | 'intl'

export interface RegionPricing {
  region: PricingRegion
  currency: string
  /** Minor units (cents) so no float arithmetic ever touches a price. */
  monthlyAmountMinor: number
  /** Locale hint for Intl grouping/symbol placement when the UI locale is unhelpful. */
  formatLocale: string
}

/**
 * One plan today. FadeUp does not currently sell tiers — the product has a
 * single subscription — and inventing Starter/Growth/Enterprise columns to
 * fill a pricing table would be marketing fiction.
 */
const REGIONS: Record<PricingRegion, RegionPricing> = {
  eu: { region: 'eu', currency: 'EUR', monthlyAmountMinor: 4900, formatLocale: 'fr-FR' },
  uk: { region: 'uk', currency: 'GBP', monthlyAmountMinor: 4200, formatLocale: 'en-GB' },
  us: { region: 'us', currency: 'USD', monthlyAmountMinor: 5400, formatLocale: 'en-US' },
  ca: { region: 'ca', currency: 'CAD', monthlyAmountMinor: 6900, formatLocale: 'en-CA' },
  ch: { region: 'ch', currency: 'CHF', monthlyAmountMinor: 4900, formatLocale: 'de-CH' },
  intl: { region: 'intl', currency: 'EUR', monthlyAmountMinor: 4900, formatLocale: 'en-150' },
}

/** ISO-3166 alpha-2 -> commercial region. Anything unlisted bills in the international default. */
const COUNTRY_TO_REGION: Record<string, PricingRegion> = {
  FR: 'eu', BE: 'eu', LU: 'eu', MC: 'eu', ES: 'eu', PT: 'eu', DE: 'eu', AT: 'eu',
  IT: 'eu', NL: 'eu', IE: 'eu', FI: 'eu', GR: 'eu', SK: 'eu', SI: 'eu', EE: 'eu',
  LV: 'eu', LT: 'eu', CY: 'eu', MT: 'eu', HR: 'eu',
  GB: 'uk',
  US: 'us',
  CA: 'ca',
  CH: 'ch', LI: 'ch',
}

export function regionForCountry(countryCode: string | null | undefined): PricingRegion {
  if (!countryCode) return 'intl'
  return COUNTRY_TO_REGION[countryCode.toUpperCase()] ?? 'intl'
}

export function pricingForRegion(region: PricingRegion): RegionPricing {
  return REGIONS[region] ?? REGIONS.intl
}

/**
 * Formats a price for display.
 *
 * `uiLocale` controls grouping and symbol placement so a French reader sees
 * "49,00 €" and an American "$54.00" — but it never changes WHICH currency is
 * shown. That comes from the region alone.
 *
 * Whole amounts drop the decimals: "49 €" reads like a price, "49,00 €" reads
 * like an invoice line.
 */
export function formatPrice(pricing: RegionPricing, uiLocale: string): string {
  const amount = pricing.monthlyAmountMinor / 100
  const hasCents = pricing.monthlyAmountMinor % 100 !== 0
  try {
    return new Intl.NumberFormat(uiLocale, {
      style: 'currency',
      currency: pricing.currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    }).format(amount)
  } catch {
    // Unknown/invalid locale tag — fall back to the region's own formatting.
    return new Intl.NumberFormat(pricing.formatLocale, {
      style: 'currency',
      currency: pricing.currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    }).format(amount)
  }
}
