import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'

export interface MoneyProps {
  /** TOUJOURS des centimes (`price_cents`). Un non-entier lève en dev. */
  cents: number
  /** ISO 4217, depuis `organizations.currency`. */
  currency: string
  locale?: string
  /** Préfixe « à partir de ». */
  from?: boolean
  className?: string
}

/** Monetary value — Geist Mono, tabular digits, Intl formatting. */
export function Money({ cents, currency, locale, from = false, className }: MoneyProps) {
  const { t, i18n } = useTranslation('v2')
  const resolvedLocale = locale ?? i18n.language
  const amount = formatMoney(cents, currency, resolvedLocale)

  return (
    <span className={cn('font-fu-mono tabular-nums', className)}>
      {from ? t('common.money.from', { amount }) : amount}
    </span>
  )
}
