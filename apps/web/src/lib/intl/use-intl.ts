import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { formatMoney, type FormatMoneyOptions } from '@/lib/intl/money'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatLongDate,
  formatTime,
  formatTimeRange,
} from '@/lib/intl/datetime'

/**
 * Formatting bound to the reader's current language.
 *
 * These exist so a component never has to reach for `i18n.language` itself and
 * never has to remember which of the two locales is in play. Every one of them
 * takes the BUSINESS's currency or timezone as an argument and supplies only
 * the reader's locale — which is exactly the separation the whole intl layer
 * is built on:
 *
 *     what is true about the appointment  -> comes from the business
 *     how it is written down              -> comes from the reader
 */

/** `money(2500, 'GBP')` -> "£25.00" for an English reader, "25,00 £GB" for a French one. */
export function useMoney() {
  const { i18n } = useTranslation()
  return useCallback(
    (amountMinor: number | null | undefined, currency: string | null | undefined, options?: FormatMoneyOptions) =>
      formatMoney(amountMinor, currency, i18n.language, options),
    [i18n.language],
  )
}

/**
 * Date/time formatters bound to the reader's locale.
 *
 * Every one still REQUIRES a timezone. That is deliberate: an overload
 * defaulting to the device's zone would be used by accident and would silently
 * reintroduce the bug where a Paris salon's 09:00 shows as 08:00 to an owner
 * in London.
 */
export function useDateTime() {
  const { i18n } = useTranslation()
  const locale = i18n.language

  return useMemo(
    () => ({
      time: (value: Date | string, timeZone: string) => formatTime(value, locale, timeZone),
      date: (value: Date | string, timeZone: string) => formatDate(value, locale, timeZone),
      longDate: (value: Date | string, timeZone: string) => formatLongDate(value, locale, timeZone),
      dateTime: (value: Date | string, timeZone: string) => formatDateTime(value, locale, timeZone),
      timeRange: (start: Date | string, end: Date | string, timeZone: string) =>
        formatTimeRange(start, end, locale, timeZone),
      duration: (minutes: number) => formatDuration(minutes, locale),
    }),
    [locale],
  )
}

/**
 * The organization's own currency, for professional surfaces.
 *
 * The public surfaces get currency from the read that already fetched the
 * shop; the pro app has a membership but no organization row, so this is the
 * one small extra query. Cached hard — a shop's currency changes roughly
 * never, and refetching it per navigation would be silly.
 *
 * Falls back to EUR rather than throwing, so a service list never fails to
 * render because a currency lookup did.
 */
export function useOrganizationCurrency(organizationId: string | undefined): string {
  const query = useQuery({
    queryKey: ['organization-currency', organizationId],
    queryFn: async (): Promise<string> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('organizations')
        .select('currency')
        .eq('id', organizationId!)
        .maybeSingle()
      if (error) throw error
      return (data?.currency as string | undefined) ?? 'EUR'
    },
    enabled: Boolean(organizationId),
    staleTime: 30 * 60_000,
    retry: false,
  })

  return query.data ?? 'EUR'
}
