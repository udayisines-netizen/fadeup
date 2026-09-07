import { useTranslation } from 'react-i18next'
import {
  formatWallTime,
  isOpenNow,
  orderedWeek,
  wallClockIn,
  type PublicLocationHoursRow,
} from '@/shared/lib/openingHours'
import { cn } from '@/shared/lib/cn'

interface HoursSectionProps {
  rows: readonly PublicLocationHoursRow[]
  /** Fuseau du LIEU — l'état ouvert/fermé se calcule là-bas, pas ici. */
  timezone: string
}

/** Nom localisé d'un jour (0 = dimanche) — via Intl, jamais codé en dur. */
function weekdayName(day: number, locale: string): string {
  // Le 4 janvier 2026 est un dimanche : jour 0 + décalage = le bon nom.
  const reference = new Date(Date.UTC(2026, 0, 4 + day))
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(reference)
}

/**
 * Les horaires du salon (F2 §4) : la semaine, plus l'état ouvert ou fermé
 * MAINTENANT — calculé dans le fuseau du lieu. Sans lignes d'horaires,
 * l'état n'est pas inventé : la section dit qu'ils ne sont pas renseignés.
 */
export function HoursSection({ rows, timezone }: HoursSectionProps) {
  const { t, i18n } = useTranslation('v2')
  const locale = i18n.language

  if (rows.length === 0) {
    return <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('profile.shop.hoursUnknown')}</p>
  }

  const open = isOpenNow(rows, timezone)
  const today = wallClockIn(timezone, new Date())?.day ?? null

  const interval = (openTime: string | null, closeTime: string | null): string | null =>
    openTime && closeTime ? `${formatWallTime(openTime, locale)}–${formatWallTime(closeTime, locale)}` : null

  return (
    <div data-testid="hours-section">
      {open !== null && (
        <p className="mt-2 text-fu-sm font-medium" data-testid="open-now">
          {open ? t('states.opening.open') : t('states.opening.closed')}
        </p>
      )}
      <dl className="mt-3">
        {orderedWeek(rows).map(({ day, row }) => {
          const first = row ? interval(row.open_time, row.close_time) : null
          const second = row ? interval(row.second_open_time, row.second_close_time) : null
          const isToday = day === today
          return (
            <div
              key={day}
              className={cn(
                'flex items-baseline justify-between gap-4 border-b border-[var(--fu-border)] py-2 last:border-b-0',
                isToday && 'font-medium text-[var(--fu-text-primary)]',
              )}
            >
              <dt className={cn('text-fu-sm capitalize', !isToday && 'text-[var(--fu-text-secondary)]')}>
                {weekdayName(day, locale)}
              </dt>
              <dd className="font-fu-mono text-fu-sm tabular-nums">
                {/* Jour absent = NON RENSEIGNÉ — jamais affiché « fermé ». */}
                {row === null
                  ? t('profile.shop.hoursUnknownDay')
                  : row.is_closed || !first
                    ? t('profile.shop.hoursClosedDay')
                    : second
                      ? `${first}, ${second}`
                      : first}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
