import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatDuration } from '@/shared/lib/format'

export interface DurationProps {
  minutes: number
  /** « 45 min » | « 45 minutes ». Au-delà de 60 : toujours « 1 h 15 ». */
  format?: 'short' | 'long'
  locale?: string
  className?: string
}

export function Duration({ minutes, format = 'short', locale, className }: DurationProps) {
  const { i18n } = useTranslation('v2')
  const resolvedLocale = locale ?? i18n.language
  return <span className={cn('font-fu-mono tabular-nums', className)}>{formatDuration(minutes, resolvedLocale, format)}</span>
}
