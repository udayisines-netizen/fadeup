import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/shared/lib/format'
import { MonoText, type MonoTextProps } from '@/shared/ui/MonoText'

/**
 * Prix — TOUJOURS des centimes entiers (`price_cents`), formatés par Intl
 * dans la devise RÉSOLUE. Sans devise, l'appelant n'affiche pas de prix
 * (« — ») — jamais une estimation.
 */
export interface MoneyProps extends Omit<MonoTextProps, 'children'> {
  cents: number
  currency: string
  /** « à partir de » — le prix minimum réel des services actifs. */
  from?: boolean
}

export function Money({ cents, currency, from = false, ...rest }: MoneyProps) {
  const { t, i18n } = useTranslation('v2')
  const amount = formatMoney(cents, currency, i18n.language)
  return <MonoText {...rest}>{from ? t('common.money.from', { amount }) : amount}</MonoText>
}
