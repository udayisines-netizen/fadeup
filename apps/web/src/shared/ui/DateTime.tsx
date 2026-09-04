import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { deviceTimezone, formatDateTime, timezoneLabel, timezonesDiffer, type DateTimeStyle } from '@/shared/lib/format'

export interface DateTimeProps {
  /** ISO UTC (la base ne stocke rien d'autre). */
  value: string | Date
  /** IANA — le fuseau du LIEU (`locations.timezone`) pour toute heure de service. */
  timezone: string
  format: DateTimeStyle
  /**
   * Force la mention du fuseau. Sans elle, la mention apparaît
   * automatiquement dès que le fuseau du lieu diffère de celui de
   * l'appareil — l'écart ne doit jamais être silencieux.
   */
  showTimezone?: boolean
  className?: string
}

export function DateTime({ value, timezone, format, showTimezone = false, className }: DateTimeProps) {
  const { t, i18n } = useTranslation('v2')
  const locale = i18n.language
  const date = typeof value === 'string' ? new Date(value) : value
  const text = formatDateTime(date, timezone, format, locale)

  const differs = timezonesDiffer(timezone, deviceTimezone(), date)
  const withNote = showTimezone || (differs && format !== 'relative' && format !== 'date' && format !== 'weekday')

  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <time dateTime={date.toISOString()} className="font-fu-mono tabular-nums">
        {text}
      </time>
      {withNote && (
        <span className="text-fu-xs text-[var(--fu-text-secondary)]">
          {t('common.datetime.timezoneNote', { timezone: timezoneLabel(timezone, date, locale) })}
        </span>
      )}
    </span>
  )
}
