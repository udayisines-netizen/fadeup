import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { addDays, todayInZone } from '@/lib/calendar/time'

/**
 * Horizontal dates instead of a month grid.
 *
 * This is the single highest-leverage decision in the booking flow. A month
 * calendar asks the customer to comprehend thirty cells, most of which are
 * irrelevant, before they can pick tomorrow — and on a 375px screen those
 * cells are 40px wide. People booking a haircut overwhelmingly want today,
 * tomorrow, or this weekend, and a strip puts all three within one thumb
 * movement.
 *
 * The strip shows a rolling window from today. There is deliberately no
 * "jump to month" control: it would be a second date paradigm for a case
 * that, in this product, barely exists.
 *
 * AVAILABILITY DOTS are real. A day only gets one when the caller has actually
 * checked that day and found slots — `availableDates` is a set the caller
 * fills from the availability engine. A day that has not been checked shows
 * nothing rather than a hopeful dot, because a dot that turns out to be a lie
 * costs the customer a tap and some trust.
 */

export interface DateStripProps {
  /** `YYYY-MM-DD` in the business's timezone. */
  value: string
  onChange: (dateKey: string) => void
  timeZone: string
  /** How many days forward to offer. */
  days?: number
  /**
   * Days known to have at least one free slot. Undefined means "not checked" —
   * which renders no indicator at all, not a negative one.
   */
  availableDates?: Set<string>
  /** Days known to have NO availability, rendered dimmed but still selectable. */
  fullDates?: Set<string>
  className?: string
}

export function DateStrip({
  value,
  onChange,
  timeZone,
  days = 21,
  availableDates,
  fullDates,
  className,
}: DateStripProps) {
  const { t, i18n } = useTranslation()
  const today = todayInZone(timeZone)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  // Keep the chosen day on screen when it changes from outside (a deep link,
  // or the customer moving forward a week). `nearest` so it does not yank the
  // strip when the date is already comfortably visible.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [value])

  const dateKeys = Array.from({ length: days }, (_, index) => addDays(today, index))

  return (
    <div
      ref={containerRef}
      className={cn('fu-scroll-x -mx-1 flex gap-2 px-1 pb-1', className)}
      role="group"
      aria-label={t('common:field.date')}
    >
      {dateKeys.map((dateKey, index) => {
        const selected = dateKey === value
        const isFull = fullDates?.has(dateKey) ?? false
        const hasSlots = availableDates?.has(dateKey) ?? false
        // Midday avoids any chance of a DST edge rolling the label to the
        // previous day; only the calendar date is being formatted here.
        const asDate = new Date(`${dateKey}T12:00:00Z`)

        const weekday =
          index === 0
            ? t('common:date.today')
            : index === 1
              ? t('common:date.tomorrow')
              : asDate.toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })

        return (
          <button
            key={dateKey}
            ref={selected ? selectedRef : undefined}
            type="button"
            onClick={() => onChange(dateKey)}
            aria-pressed={selected}
            className={cn(
              'flex min-w-[4.5rem] shrink-0 flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5',
              'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
              selected
                ? 'border-accent-600 bg-accent-100 text-ink-950'
                : 'border-border bg-paper-0 text-ink-700 hover:border-border-strong',
              isFull && !selected && 'opacity-55',
            )}
          >
            <span className="text-[11px] font-medium capitalize leading-none">{weekday}</span>
            <span className="text-xl font-semibold leading-tight tabular-nums">{Number(dateKey.slice(8))}</span>
            <span className="text-[10px] uppercase leading-none text-ink-500">
              {asDate.toLocaleDateString(i18n.language, { month: 'short', timeZone: 'UTC' })}
            </span>
            {/* Availability is shown by a dot AND, for a full day, by dimming
                the whole cell — never by colour alone. */}
            <span className="mt-1 flex h-1.5 items-center" aria-hidden="true">
              {hasSlots ? <span className="h-1.5 w-1.5 rounded-full bg-accent-600" /> : null}
            </span>
            {isFull ? <span className="sr-only">{t('booking:slots.dayFull')}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
