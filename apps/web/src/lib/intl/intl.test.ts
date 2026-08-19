import { describe, expect, it } from 'vitest'
import { currencyExponent, formatMoney, toMajorUnits, toMinorUnits } from '@/lib/intl/money'
import {
  countryMeta,
  currencyForCountry,
  localeForCountry,
  timezoneForCountry,
  FALLBACK_COUNTRY,
  KNOWN_COUNTRIES,
} from '@/lib/intl/countries'
import { formatDate, formatDuration, formatTime, foreignTimezoneNote } from '@/lib/intl/datetime'
import { normalizeLocale, resolveLocale, isRtl, SUPPORTED_LOCALES } from '@/lib/locale'

/**
 * Normalizes the various no-break spaces Intl inserts between a number and a
 * currency symbol. Which one appears depends on the ICU version, and asserting
 * on a specific invisible character would make these tests fail on a Node
 * upgrade for no product reason.
 */
function normalizeSpaces(value: string): string {
  return value.replace(/[   ]/g, ' ')
}

describe('formatMoney — which currency comes from the business', () => {
  it('formats EUR the French way', () => {
    expect(normalizeSpaces(formatMoney(2500, 'EUR', 'fr-FR'))).toBe('25,00 €')
  })

  it('formats GBP the English way', () => {
    expect(formatMoney(2500, 'GBP', 'en-GB')).toBe('£25.00')
  })

  it('formats USD the American way', () => {
    expect(formatMoney(2500, 'USD', 'en-US')).toBe('$25.00')
  })

  it('formats CHF', () => {
    const result = normalizeSpaces(formatMoney(2500, 'CHF', 'de-CH'))
    expect(result).toContain('25')
    expect(result.toUpperCase()).toContain('CHF')
  })

  it('shows a London price in POUNDS to a French reader', () => {
    // The whole point. FadeUp has no conversion engine, so the currency is the
    // shop's and only the grouping/symbol placement follows the reader.
    const result = normalizeSpaces(formatMoney(2500, 'GBP', 'fr-FR'))
    expect(result).toContain('25,00')
    expect(result).not.toContain('€')
  })
})

describe('formatMoney — minor units are not always hundredths', () => {
  it('treats JPY as zero-decimal', () => {
    // ¥2500 is 2500 minor units. Dividing by 100 would price a Tokyo salon's
    // haircut at ¥25.
    expect(currencyExponent('JPY')).toBe(0)
    expect(formatMoney(2500, 'JPY', 'ja-JP')).toBe('￥2,500')
  })

  it('treats KWD as three-decimal', () => {
    expect(currencyExponent('KWD')).toBe(3)
    expect(normalizeSpaces(formatMoney(2500, 'KWD', 'en'))).toContain('2.500')
  })

  it('round-trips major and minor units per currency', () => {
    expect(toMajorUnits(2500, 'EUR')).toBe(25)
    expect(toMajorUnits(2500, 'JPY')).toBe(2500)
    expect(toMinorUnits(25, 'EUR')).toBe(2500)
    expect(toMinorUnits(2500, 'JPY')).toBe(2500)
    // The float trap this avoids: 19.99 * 100 is 1998.9999... in binary.
    expect(toMinorUnits(19.99, 'EUR')).toBe(1999)
  })
})

describe('formatMoney — never throws inside a price list', () => {
  it('survives an unknown currency code', () => {
    expect(formatMoney(2500, 'XYZ', 'en')).toContain('XYZ')
  })

  it('survives a malformed locale tag', () => {
    expect(formatMoney(2500, 'EUR', 'not-a-locale!!')).toContain('25')
  })

  it('renders nothing for a missing price rather than "NaN"', () => {
    expect(formatMoney(null, 'EUR', 'fr')).toBe('')
    expect(formatMoney(undefined, 'EUR', 'fr')).toBe('')
  })

  it('can trim the decimals on a whole amount', () => {
    expect(normalizeSpaces(formatMoney(2500, 'EUR', 'fr-FR', { trimWholeAmounts: true }))).toBe('25 €')
    // ...but never on an amount that actually has cents.
    expect(normalizeSpaces(formatMoney(2550, 'EUR', 'fr-FR', { trimWholeAmounts: true }))).toBe('25,50 €')
  })
})

describe('country defaults', () => {
  it('knows France', () => {
    expect(localeForCountry('FR')).toBe('fr')
    expect(currencyForCountry('FR')).toBe('EUR')
    expect(timezoneForCountry('FR')).toBe('Europe/Paris')
  })

  it('knows the United Kingdom — English, but NOT the euro', () => {
    expect(localeForCountry('GB')).toBe('en')
    expect(currencyForCountry('GB')).toBe('GBP')
  })

  it('knows the United States', () => {
    expect(localeForCountry('US')).toBe('en')
    expect(currencyForCountry('US')).toBe('USD')
    expect(timezoneForCountry('US')).toBe('America/New_York')
  })

  it('knows Japan', () => {
    expect(localeForCountry('JP')).toBe('ja')
    expect(currencyForCountry('JP')).toBe('JPY')
    expect(timezoneForCountry('JP')).toBe('Asia/Tokyo')
  })

  it('does not assume a French-speaking country uses the euro', () => {
    // Switzerland is the case that catches a lazy "francophone => EUR" map.
    expect(localeForCountry('CH')).toBe('fr')
    expect(currencyForCountry('CH')).toBe('CHF')
  })

  it('is case-insensitive about the code', () => {
    expect(currencyForCountry('fr')).toBe('EUR')
  })

  it('falls back explicitly for a country it has no opinion about', () => {
    expect(countryMeta('ZZ')).toBeNull()
    expect(currencyForCountry('ZZ')).toBe(FALLBACK_COUNTRY.currency)
    expect(localeForCountry('ZZ')).toBeNull()
  })

  it('suggests only locales FadeUp actually ships', () => {
    for (const country of KNOWN_COUNTRIES) {
      expect(SUPPORTED_LOCALES, `${country.code} suggests an unshipped locale`).toContain(country.locale)
    }
  })

  it('gives every known country a usable timezone and a 3-letter currency', () => {
    for (const country of KNOWN_COUNTRIES) {
      expect(country.currency, `${country.code}`).toMatch(/^[A-Z]{3}$/)
      expect(() => new Intl.DateTimeFormat('en', { timeZone: country.timezone })).not.toThrow()
    }
  })
})

describe('locale resolution priority', () => {
  it('lets an explicit choice beat everything, including GeoIP', () => {
    expect(resolveLocale({ explicit: 'ja', account: 'de', detected: 'es', geo: 'fr', browser: 'it' })).toBe('ja')
  })

  it('lets a persisted account preference beat GeoIP', () => {
    expect(resolveLocale({ account: 'de', geo: 'fr', browser: 'it' })).toBe('de')
  })

  it('uses GeoIP when nothing has been chosen or cached', () => {
    expect(resolveLocale({ geo: 'fr', browser: 'it' })).toBe('fr')
  })

  it('falls back to the browser when GeoIP said nothing', () => {
    expect(resolveLocale({ browser: 'it' })).toBe('it')
  })

  it('falls back to English when every signal is missing', () => {
    expect(resolveLocale({})).toBe('en')
  })

  it('prefers a device-cached detection over re-asking GeoIP', () => {
    expect(resolveLocale({ detected: 'es', geo: 'fr' })).toBe('es')
  })
})

describe('locale normalization', () => {
  it('accepts loose casing', () => {
    expect(normalizeLocale('FR')).toBe('fr')
    expect(normalizeLocale('zh-cn')).toBe('zh-CN')
  })

  it('rejects an unsupported locale rather than guessing', () => {
    expect(normalizeLocale('kl')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale(null)).toBeNull()
  })
})

describe('RTL', () => {
  it('marks Arabic as right-to-left', () => {
    expect(isRtl('ar')).toBe(true)
  })

  it('marks every other shipped locale as left-to-right', () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'ar')) {
      expect(isRtl(locale), locale).toBe(false)
    }
  })
})

describe('date and time formatting', () => {
  const instant = '2026-08-19T07:45:00.000Z' // 09:45 in Paris

  it('renders the shop timezone, not the device one', () => {
    // Same instant, two shops: the time shown is the one each SHOP means.
    expect(formatTime(instant, 'fr-FR', 'Europe/Paris')).toMatch(/9.45/)
    expect(formatTime(instant, 'fr-FR', 'America/New_York')).toMatch(/3.45/)
    // ...and the 12/24-hour convention follows the READER.
    expect(formatTime(instant, 'en-US', 'America/New_York')).toMatch(/AM/i)
    expect(formatTime(instant, 'fr-FR', 'Europe/Paris')).not.toMatch(/AM/i)
  })

  it('follows the reader\'s date convention', () => {
    expect(formatDate(instant, 'fr-FR', 'Europe/Paris')).toBe('19/08/2026')
    expect(formatDate(instant, 'en-US', 'Europe/Paris')).toBe('08/19/2026')
  })

  it('formats durations in the reader\'s number system', () => {
    expect(formatDuration(30, 'fr')).toBe('30 min')
    expect(formatDuration(90, 'fr')).toBe('1 h 30')
    expect(formatDuration(120, 'en')).toBe('2 h')
  })

  it('stays silent about the reader\'s timezone when it agrees with the shop', () => {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(foreignTimezoneNote(instant, deviceZone, 'en')).toBeNull()
  })
})
