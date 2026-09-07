import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatDateTime } from '@/shared/lib/format'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { partOfDayFor, type PartOfDay } from '@/features/booking/lib/slots'
import type { PublicSlot } from '@/features/booking/api/booking'

/**
 * Choisir une heure sans dérouler quarante boutons. Un salon chargé au pas de
 * 15 minutes produit ~40 créneaux par jour : en grille plate c'est un mur.
 * Le découpage matin / après-midi / soir répond « y a-t-il quelque chose
 * après le travail ? » avant tout défilement.
 *
 * Porté de l'arbre legacy (src/components/ui/time-slot-grid.tsx, orphelin)
 * vers les primitives V2 : tokens fu, i18n v2, fuseau du LIEU (un client de
 * Paris qui réserve à Tokyo voit le matin de Tokyo).
 *
 * AUCUN créneau n'est fabriqué : `slots` vient de get_public_available_slots
 * telle quelle, et un jour sans créneau affiche un état vide honnête.
 */
export function TimeSlotGrid({
  slots,
  value,
  onChange,
  timeZone,
  part,
  onPartChange,
  className,
}: {
  slots: readonly PublicSlot[]
  value: string | null
  onChange: (slotStart: string) => void
  timeZone: string
  part: PartOfDay
  onPartChange: (part: PartOfDay) => void
  className?: string
}) {
  const { t, i18n } = useTranslation('v2')

  const byPart = useMemo(() => {
    const groups: Record<PartOfDay, PublicSlot[]> = { morning: [], afternoon: [], evening: [] }
    for (const slot of slots) groups[partOfDayFor(slot.slot_start, timeZone)].push(slot)
    return groups
  }, [slots, timeZone])

  const options = useMemo(
    () =>
      (['morning', 'afternoon', 'evening'] as const).map((key) => ({
        value: key,
        label: t(`booking.slots.${key}`),
      })),
    [t],
  )

  const visible = byPart[part]

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <SegmentedControl
        label={t('booking.slots.partOfDay')}
        options={options}
        value={part}
        onValueChange={(next) => onPartChange(next as PartOfDay)}
      />

      {visible.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--fu-border)] px-4 py-6 text-center text-fu-sm text-[var(--fu-text-secondary)]">
          {t('booking.slots.nonePart')}
        </p>
      ) : (
        <div
          role="group"
          aria-label={t('booking.slots.available')}
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          data-testid="slot-grid"
        >
          {visible.map((slot) => {
            const selected = value === slot.slot_start
            const time = formatDateTime(slot.slot_start, timeZone, 'time', i18n.language)
            return (
              <button
                key={slot.slot_start}
                type="button"
                aria-pressed={selected}
                aria-label={t('booking.slots.slotAria', { time })}
                onClick={() => onChange(slot.slot_start)}
                className={cn(
                  'min-h-11 rounded-[var(--radius-control)] border font-fu-mono text-fu-sm font-medium tabular-nums',
                  'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)] motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2',
                  selected
                    ? 'border-[var(--fu-accent)] bg-[var(--fu-accent-soft)] text-[var(--fu-text-primary)]'
                    : 'border-[var(--fu-border)] bg-[var(--fu-canvas)] text-[var(--fu-text-primary)] hover:border-[var(--fu-border-strong)] hover:bg-[var(--fu-surface-subtle)]',
                )}
              >
                {time}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
