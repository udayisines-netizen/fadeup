import type { PlanId } from '@/lib/commerce/plans'
import { PLAN_IDS } from '@/lib/commerce/plans'

/**
 * What FadeUp charges, per plan, per commercial region — the single source of
 * truth for money.
 *
 * Three rules this module exists to enforce.
 *
 * 1. No price is ever written into JSX or into a translation file. Copy is
 *    translated; money is data. A number living in `fr/landing.json` would make
 *    French the authority on what FadeUp charges, which is nonsense, and would
 *    drift the moment one locale is updated and nine are not.
 *
 * 2. Pricing region is decided by COMMERCIAL GEOGRAPHY, never by language. A
 *    visitor in Paris reading the site in English is billed in EUR at the France
 *    price; a visitor in Texas reading it in French is billed in USD. Currency
 *    follows where you are, not what you speak.
 *
 * 3. No live FX. Every amount below is an explicit commercial decision written
 *    as a literal. Nothing here multiplies the euro price by a rate, because a
 *    price that moves with the currency market is not a price, it is a quote.
 *
 * Unrelated, and worth stating because the confusion is easy: a barbershop's
 * OWN service prices are the shop's, in the shop's currency, and are never
 * converted for a visitor. A Paris shop charging 25 € shows 25 € to someone
 * browsing from Chicago. Only FadeUp's own subscription follows the table below.
 */

export type PricingRegion = 'eu' | 'uk' | 'us' | 'ca' | 'ch' | 'intl'

export interface RegionCurrency {
  region: PricingRegion
  currency: string
  /** Locale hint for Intl grouping/symbol placement when the UI locale is unhelpful. */
  formatLocale: string
}

const REGION_CURRENCY: Record<PricingRegion, RegionCurrency> = {
  eu: { region: 'eu', currency: 'EUR', formatLocale: 'fr-FR' },
  uk: { region: 'uk', currency: 'GBP', formatLocale: 'en-GB' },
  us: { region: 'us', currency: 'USD', formatLocale: 'en-US' },
  ca: { region: 'ca', currency: 'CAD', formatLocale: 'en-CA' },
  ch: { region: 'ch', currency: 'CHF', formatLocale: 'de-CH' },
  intl: { region: 'intl', currency: 'EUR', formatLocale: 'en-150' },
}

/**
 * Monthly price in MINOR units (cents), so no float arithmetic ever touches a
 * price.
 *
 * `eu` is the authoritative catalog — those seven amounts are the commercially
 * agreed France reference prices. The other regions are explicit commercial
 * prices anchored on FadeUp's pre-existing UK/US/CA/CH positioning; they are
 * round local numbers chosen once, not conversions, and they are listed in
 * `docs/design-2026/for-business.md` as awaiting a formal commercial sign-off
 * per region. `intl` deliberately mirrors `eu` in EUR: billing an unlisted
 * country in euros at the European price is an honest default, where inventing
 * "$29" because the euro price is 29 would not be.
 */
const PLAN_PRICES: Record<PricingRegion, Record<PlanId, number>> = {
  eu: {
    solo: 1900,
    shop_essential: 2900,
    shop_pro: 4900,
    shop_business: 7900,
    multi_growth: 9900,
    multi_pro: 14900,
    multi_scale: 24900,
  },
  uk: {
    solo: 1700,
    shop_essential: 2500,
    shop_pro: 4200,
    shop_business: 6900,
    multi_growth: 8500,
    multi_pro: 12900,
    multi_scale: 21500,
  },
  us: {
    solo: 2100,
    shop_essential: 3200,
    shop_pro: 5400,
    shop_business: 8900,
    multi_growth: 10900,
    multi_pro: 16900,
    multi_scale: 27900,
  },
  ca: {
    solo: 2700,
    shop_essential: 3900,
    shop_pro: 6900,
    shop_business: 10900,
    multi_growth: 13900,
    multi_pro: 20900,
    multi_scale: 34900,
  },
  ch: {
    solo: 1900,
    shop_essential: 2900,
    shop_pro: 4900,
    shop_business: 7900,
    multi_growth: 9900,
    multi_pro: 14900,
    multi_scale: 24900,
  },
  intl: {
    solo: 1900,
    shop_essential: 2900,
    shop_pro: 4900,
    shop_business: 7900,
    multi_growth: 9900,
    multi_pro: 14900,
    multi_scale: 24900,
  },
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

export function currencyForRegion(region: PricingRegion): RegionCurrency {
  return REGION_CURRENCY[region] ?? REGION_CURRENCY.intl
}

/** Monthly price of a plan in a region, in minor units. */
export function planPriceMinor(planId: PlanId, region: PricingRegion): number {
  return (PLAN_PRICES[region] ?? PLAN_PRICES.intl)[planId]
}

/**
 * Formats a plan's monthly price for display.
 *
 * `uiLocale` controls grouping and symbol placement so a French reader sees
 * "49 €" and an American "$49" — but it never changes WHICH currency is shown.
 * That comes from the region alone.
 *
 * Whole amounts drop the decimals: "49 €" reads like a price, "49,00 €" reads
 * like an invoice line.
 */
export function formatPlanPrice(planId: PlanId, region: PricingRegion, uiLocale: string): string {
  return formatMinor(planPriceMinor(planId, region), region, uiLocale)
}

export function formatMinor(amountMinor: number, region: PricingRegion, uiLocale: string): string {
  const { currency, formatLocale } = currencyForRegion(region)
  const amount = amountMinor / 100
  const hasCents = amountMinor % 100 !== 0
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }
  try {
    return new Intl.NumberFormat(uiLocale, options).format(amount)
  } catch {
    // Unknown/invalid locale tag — fall back to the region's own formatting
    // rather than letting the whole pricing section throw.
    return new Intl.NumberFormat(formatLocale, options).format(amount)
  }
}

export const PRICING_REGIONS = Object.keys(REGION_CURRENCY) as PricingRegion[]

/**
 * Every region prices every plan. Exported for the test suite: a region added
 * without a full price column would otherwise silently render `undefined` as a
 * price, which is the one failure mode a pricing page cannot survive.
 */
export function missingPlanPrices(): string[] {
  const missing: string[] = []
  for (const region of PRICING_REGIONS) {
    for (const planId of PLAN_IDS) {
      const amount = PLAN_PRICES[region]?.[planId]
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        missing.push(`${region}/${planId}`)
      }
    }
  }
  return missing
}
