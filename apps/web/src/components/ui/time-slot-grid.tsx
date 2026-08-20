import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun, CloudSun, Moon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { minutesSinceMidnight } from '@/lib/calendar/time'
import { useDateTime } from '@/lib/intl/use-intl'

/**
 * Choosing a time, without scrolling through forty buttons.
 *
 * A busy shop with a 15-minute step and a ten-hour day produces ~40 slots. As
 * one flat grid that is a wall; the customer scrolls, loses their place, and
 * cannot tell "is there anything after work?" without reading every cell.
 *
 * Splitting by part of day answers that question before any scrolling happens,
 * and the segmented control doubles as a summary: a period with nothing free
 * is visibly disabled, so "no evenings here" is legible in one glance.
 *
 * The boundaries are wall-clock in the BUSINESS's timezone, not the device's —
 * a customer booking a Tokyo salon from Paris must see Tokyo's morning.
 */

export type PartOfDay = 'morning' | 'afternoon' | 'evening'

/** Noon and 17:00. Not configurable: an unfamiliar split is worse than a slightly wrong one. */
const AFTERNOON_FROM = 12 * 60
const EVENING_FROM = 17 * 60

export interface Slot {
  slotStart: string
  slotEnd: string
}

export function partOfDayFor(slotStart: string, timeZone: string): PartOfDay {
  const minute = minutesSinceMidnight(slotStart, timeZone)
  if (minute < AFTERNOON_FROM) return 'morning'
  if (minute < EVENING_FROM) return 'afternoon'
  return 'evening'
}

export function TimeSlotGrid({
  slots,
  value,
  onChange,
  timeZone,
  part,
  onPartChange,
  className,
}: {
  slots: Slot[]
  value: string | null
  onChange: (slotStart: string) => void
  timeZone: string
  part: PartOfDay
  onPartChange: (part: PartOfDay) => void
  className?: string
}) {
  const { t } = useTranslation()
  const dt = useDateTime()

  const byPart = useMemo(() => {
    const groups: Record<PartOfDay, Slot[]> = { morning: [], afternoon: [], evening: [] }
    // One pass — this runs on every availability refetch.
    for (const slot of slots) groups[partOfDayFor(slot.slotStart, timeZone)].push(slot)
    return groups
  }, [slots, timeZone])

  const options = useMemo(
    () =>
      (['morning', 'afternoon', 'evening'] as const).map((key) => ({
        value: key,
        label: t(`booking:slots.${key}`),
        icon:
          key === 'morning' ? (
            <Sun className="h-3.5 w-3.5" />
          ) : key === 'afternoon' ? (
            <CloudSun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          ),
      })),
    [t],
  )

  const visible = byPart[part]

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <SegmentedControl
        options={options}
        value={part}
        onChange={onPartChange}
        ariaLabel={t('booking:slots.partOfDay')}
      />

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-500">
          {t('booking:slots.nonePart')}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={t('booking:slots.available')}
          // Three across at 375px keeps every target well past 44px; four from
          // the small breakpoint up, where there is room for it.
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {visible.map((slot) => {
            const selected = value === slot.slotStart
            return (
              <button
                key={slot.slotStart}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(slot.slotStart)}
                className={cn(
                  'min-h-11 rounded-lg border text-sm font-medium tabular-nums',
                  'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
                  selected
                    ? 'border-accent-600 bg-accent-100 text-ink-950'
                    : 'border-border bg-paper-0 text-ink-950 hover:border-border-strong hover:bg-paper-100',
                )}
              >
                {dt.time(slot.slotStart, timeZone)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The part of day that actually has slots — so the screen never opens on an empty tab. */
export function firstPopulatedPart(slots: Slot[], timeZone: string): PartOfDay {
  for (const key of ['morning', 'afternoon', 'evening'] as const) {
    if (slots.some((slot) => partOfDayFor(slot.slotStart, timeZone) === key)) return key
  }
  return 'morning'
}
