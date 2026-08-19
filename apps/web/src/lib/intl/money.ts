/**
 * Money, formatted once, correctly.
 *
 * ============================================================================
 * THE BUG THIS REPLACES
 * ============================================================================
 *
 *   FadeUp had FIVE copies of this:
 *
 *       function formatPrice(cents: number): string {
 *         return (cents / 100).toLocaleString(undefined, {
 *           style: 'currency', currency: 'USD',
 *         })
 *       }
 *
 *   in the booking flow, the public professional profile, the marketplace
 *   card, the services editor and the customer's appointment list. Every
 *   service price in the product was rendered in US dollars — a Paris shop
 *   charging 25 € showed "$25.00" to its own customers.
 *
 * ============================================================================
 * THE TWO RULES
 * ============================================================================
 *
 *   1. WHICH currency comes from the BUSINESS. A London salon charges pounds.
 *      A visitor's IP, browser or language never changes that, because it is
 *      not a display preference — it is what the customer will actually be
 *      asked to pay. FadeUp has no conversion engine and must not imply one.
 *
 *   2. HOW it is written comes from the READER's locale. A French reader sees
 *      "25,00 £GB", an English one "£25.00". Same money, same currency, the
 *      grouping and symbol placement each reader expects.
 *
 * ============================================================================
 * MINOR UNITS ARE NOT ALWAYS HUNDREDTHS
 * ============================================================================
 *
 *   Prices are stored as integers (price_cents) to keep float arithmetic out
 *   of money. But "cents" is a misnomer for a third of the world:
 *
 *       EUR, GBP, USD   2 decimals   2500 -> 25.00
 *       JPY, KRW        0 decimals   2500 -> 2500
 *       KWD, JOD, TND   3 decimals   2500 -> 2.500
 *
 *   Dividing by 100 unconditionally would price a Tokyo salon's ¥2500 cut at
 *   ¥25, and a Kuwaiti one's 2.500 KWD at 25 KWD. The exponent is read from
 *   Intl itself rather than kept in a table here — the platform already ships
 *   the ISO 4217 data, and a hand-maintained copy would go stale.
 */

/** Formatters are genuinely expensive to construct; a marketplace page builds hundreds of prices. */
const formatterCache = new Map<string, Intl.NumberFormat>()
const exponentCache = new Map<string, number>()

function formatterFor(locale: string, currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${currency}|${options.minimumFractionDigits}|${options.maximumFractionDigits}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, ...options })
    formatterCache.set(key, formatter)
  }
  return formatter
}

/**
 * How many decimal places this currency actually has, per ISO 4217.
 *
 * Asked of Intl rather than stored, so a currency FadeUp has never heard of
 * still formats correctly the day a shop in that country signs up.
 */
export function currencyExponent(currency: string): number {
  const key = currency.toUpperCase()
  const cached = exponentCache.get(key)
  if (cached !== undefined) return cached

  let exponent = 2
  try {
    const resolved = new Intl.NumberFormat('en', { style: 'currency', currency: key }).resolvedOptions()
    exponent = resolved.maximumFractionDigits ?? 2
  } catch {
    // Not a currency this runtime knows. Two decimals is the commonest shape
    // and, more importantly, matches how the amount was stored.
    exponent = 2
  }
  exponentCache.set(key, exponent)
  return exponent
}

/** Minor units -> major units, using the currency's real exponent. */
export function toMajorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyExponent(currency)
}

/** Major units -> minor units, for writing a typed price back to the database. */
export function toMinorUnits(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyExponent(currency))
}

export interface FormatMoneyOptions {
  /**
   * Drop ".00" on whole amounts. "25 €" reads like a price; "25,00 €" reads
   * like an invoice line. Off by default because totals and receipts want the
   * decimals; the price lists that read better without them opt in.
   */
  trimWholeAmounts?: boolean
}

/**
 * The one money formatter.
 *
 * @param amountMinor integer minor units, exactly as stored (services.price_cents)
 * @param currency    ISO 4217, from the BUSINESS — never from the visitor
 * @param locale      the reader's UI locale, for grouping and symbol placement
 */
export function formatMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
  options: FormatMoneyOptions = {},
): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) return ''

  const resolvedCurrency = (currency || 'EUR').toUpperCase()
  const exponent = currencyExponent(resolvedCurrency)
  const amount = amountMinor / 10 ** exponent

  const isWhole = amountMinor % 10 ** exponent === 0
  const digits = options.trimWholeAmounts && isWhole ? 0 : exponent

  try {
    return formatterFor(locale, resolvedCurrency, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    // An invalid locale tag, or a currency this runtime rejects. Falling back
    // to a bare number with the code is ugly but honest — far better than
    // throwing inside a price list, or silently showing the wrong symbol.
    try {
      return `${new Intl.NumberFormat('en', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount)} ${resolvedCurrency}`
    } catch {
      return `${amount} ${resolvedCurrency}`
    }
  }
}

/**
 * The currency symbol alone, for compact inputs where a label already says
 * what the field is. Falls back to the code, which is never wrong — only long.
 */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0)
    return parts.find((part) => part.type === 'currency')?.value ?? currency.toUpperCase()
  } catch {
    return currency.toUpperCase()
  }
}
