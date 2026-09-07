import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'

/**
 * La bande de jours du tunnel — 90 jours (MASTER_SPEC §6), défilement
 * horizontal, mobile d'abord. Proposer un JOUR n'affirme aucune
 * disponibilité : c'est `get_public_available_slots` qui répond, jour par
 * jour, quand le jour est choisi.
 *
 * Les libellés se calculent dans le fuseau du LIEU (les jours d'un salon de
 * Tokyo ne sont pas ceux de Paris).
 */
export function DayStrip({
  days,
  value,
  onChange,
  timeZone,
  className,
}: {
  /** AAAA-MM-JJ, fuseau du lieu (bookableDays). */
  days: readonly string[]
  value: string | null
  onChange: (day: string) => void
  timeZone: string
  className?: string
}) {
  const { t, i18n } = useTranslation('v2')

  const labels = useMemo(() => {
    const weekday = new Intl.DateTimeFormat(i18n.language, { timeZone, weekday: 'short' })
    const dayNum = new Intl.DateTimeFormat(i18n.language, { timeZone, day: 'numeric' })
    const month = new Intl.DateTimeFormat(i18n.language, { timeZone, month: 'short' })
    return days.map((day, index) => {
      // Midi UTC du jour civil : évite tout basculement de date au formatage.
      const at = new Date(`${day}T12:00:00Z`)
      return {
        day,
        top: index === 0 ? t('booking.slots.today') : index === 1 ? t('booking.slots.tomorrow') : weekday.format(at),
        num: dayNum.format(at),
        month: month.format(at),
      }
    })
  }, [days, i18n.language, t, timeZone])

  return (
    <div
      role="group"
      aria-label={t('booking.slots.pickDay')}
      className={cn('flex gap-2 overflow-x-auto pb-1', className)}
      data-testid="day-strip"
    >
      {labels.map(({ day, top, num, month }) => {
        const selected = value === day
        return (
          <button
            key={day}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(day)}
            className={cn(
              'flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-[var(--radius-control)] border px-2 py-1.5',
              'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)] motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2',
              selected
                ? 'border-[var(--fu-accent)] bg-[var(--fu-accent-soft)]'
                : 'border-[var(--fu-border)] bg-[var(--fu-canvas)] hover:border-[var(--fu-border-strong)]',
            )}
          >
            <span className="text-fu-xs text-[var(--fu-text-secondary)]">{top}</span>
            <span className="font-fu-mono text-fu-base font-semibold tabular-nums text-[var(--fu-text-primary)]">{num}</span>
            <span className="text-fu-xs text-[var(--fu-text-secondary)]">{month}</span>
          </button>
        )
      })}
    </div>
  )
}
