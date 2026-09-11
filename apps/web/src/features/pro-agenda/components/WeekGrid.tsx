import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import type { AgendaAppointmentRow, TimeBlockRow } from '@/features/pro-agenda/api/agenda'
import { AppointmentCard } from '@/features/pro-agenda/components/AppointmentCard'
import { TimeBlockCard } from '@/features/pro-agenda/components/TimeBlockCard'
import type { DragItem, DragState } from '@/features/pro-agenda/hooks/useDragMove'
import { dayKeyInZone, minutesOfDayInZone, zonedDayStart, type DayKey } from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — la vue SEMAINE PAR RESSOURCE, et la résolution de la tension
 * « aéré » / « plusieurs barbers côte à côte » :
 *
 * Les barbers sont des COLONNES côte à côte (la décision fondateur), les
 * sept jours sont des BANDES empilées (« quitte à défiler »), et chaque
 * cellule (barber × jour) liste ses rendez-vous en RANGÉES compactes
 * triées par heure — pas de grille horaire à 7 × N colonnes de 60 px. Une
 * colonne a une largeur minimale de 200 px : au-delà de ce que l'écran
 * contient, ça défile horizontalement, et le patron peut LIMITER les
 * barbers affichés (filtre). Le glisser vers une autre cellule déplace le
 * rendez-vous à ce jour et ce barber, à la MÊME heure ; changer l'heure se
 * fait en vue jour (axe horaire) ou par « Déplacer » dans la fiche.
 */

export const WEEK_MIN_COLUMN = 200
export const WEEK_LABEL_WIDTH = 64

export interface WeekGridProps {
  days: DayKey[]
  timezone: string
  barbers: OrganizationBarber[]
  appointments: AgendaAppointmentRow[]
  blocks: TimeBlockRow[]
  now: Date
  seesRevenue: boolean
  isSolo: boolean
  changed: Map<string, string>
  drag: DragState | null
  canDrag: (row: AgendaAppointmentRow) => boolean
  canCreateFor: (barberId: string) => boolean
  onStartDrag: (event: React.PointerEvent<HTMLElement>, item: DragItem) => void
  onOpenAppointment: (row: AgendaAppointmentRow) => void
  onOpenBlock: (block: TimeBlockRow) => void
  /** « Terminé » en un geste sur la carte ; null = pas de bouton pour cette ligne. */
  quickComplete: (row: AgendaAppointmentRow) => ((row: AgendaAppointmentRow) => void) | undefined
  onCreateAt: (barberId: string, dayKey: DayKey) => void
}

export function WeekGrid({
  days,
  timezone,
  barbers,
  appointments,
  blocks,
  now,
  seesRevenue,
  isSolo,
  changed,
  drag,
  canDrag,
  canCreateFor,
  onStartDrag,
  onOpenAppointment,
  onOpenBlock,
  quickComplete,
  onCreateAt,
}: WeekGridProps) {
  const { t, i18n } = useTranslation('v2')
  const todayKey = dayKeyInZone(now, timezone)
  const dayLabel = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric' })

  return (
    <div className="overflow-x-auto" data-testid="agenda-week-grid">
      <div
        role="group"
        aria-label={t('pro.agenda.grid.label')}
        className="grid"
        style={{
          gridTemplateColumns: `${WEEK_LABEL_WIDTH}px repeat(${barbers.length}, minmax(${WEEK_MIN_COLUMN}px, 1fr))`,
          minWidth: WEEK_LABEL_WIDTH + barbers.length * WEEK_MIN_COLUMN,
        }}
      >
        {!isSolo && (
          <>
            <div aria-hidden="true" className="border-b border-[var(--fu-border)]" />
            {barbers.map((barber) => (
              <div key={barber.id} className="truncate border-b border-s border-[var(--fu-border)] px-2 py-2 text-fu-sm font-semibold text-[var(--fu-text-primary)]">
                {barber.display_name}
              </div>
            ))}
          </>
        )}
        {days.map((day) => {
          const isToday = day === todayKey
          const dayStart = zonedDayStart(day, timezone).getTime()
          const dayEnd = dayStart + 86_400_000
          return (
            <div key={day} className="contents">
              <div
                className={cn(
                  'border-b border-[var(--fu-border)] px-2 py-2 text-fu-xs',
                  isToday ? 'font-semibold text-[var(--fu-text-primary)]' : 'text-[var(--fu-text-secondary)]',
                )}
              >
                <span className="block capitalize">{dayLabel.format(new Date(dayStart + 43_200_000))}</span>
                {isToday && (
                  <span aria-hidden="true" className="mt-1 block size-1.5 rounded-[var(--radius-avatar)] bg-[var(--fu-accent)]" />
                )}
              </div>
              {barbers.map((barber) => {
                const rows = appointments
                  .filter((row) => row.barber_id === barber.id && row.status !== 'cancelled')
                  .filter((row) => {
                    const s = Date.parse(row.starts_at)
                    return s >= dayStart && s < dayEnd
                  })
                const dayBlocks = blocks.filter((block) => {
                  const s = Date.parse(block.starts_at)
                  const e = Date.parse(block.ends_at)
                  return block.barber_id === barber.id && s < dayEnd && e > dayStart
                })
                const items = [
                  ...rows.map((row) => ({ kind: 'appointment' as const, at: Date.parse(row.starts_at), row })),
                  ...dayBlocks.map((block) => ({ kind: 'block' as const, at: Date.parse(block.starts_at), block })),
                ].sort((a, b) => a.at - b.at)
                const isTarget = drag?.target?.barberId === barber.id && drag.target.dayKey === day
                return (
                  <div
                    key={`${day}:${barber.id}`}
                    data-drop-barber={barber.id}
                    data-drop-day={day}
                    data-testid="agenda-week-cell"
                    onClick={() => canCreateFor(barber.id) && onCreateAt(barber.id, day)}
                    className={cn(
                      'flex min-h-16 flex-col gap-1 border-b border-s border-[var(--fu-border)] p-1',
                      isToday && 'bg-[var(--fu-surface-subtle)]',
                      isTarget && 'bg-[var(--fu-accent-soft)]',
                    )}
                  >
                    {items.map((item) => {
                      if (item.kind === 'block') {
                        return <TimeBlockCard key={item.block.id} block={item.block} timezone={timezone} variant="chip" onOpen={onOpenBlock} />
                      }
                      const row = item.row
                      const token = changed.get(row.id)
                      const starts = new Date(row.starts_at)
                      const dragItem: DragItem = {
                        id: row.id,
                        startMinutes: minutesOfDayInZone(starts, timezone),
                        durationMinutes: Math.round((Date.parse(row.ends_at) - starts.getTime()) / 60_000),
                        barberId: barber.id,
                        dayKey: day,
                        label: row.customer_name,
                      }
                      return (
                        <AppointmentCard
                          key={token ? `${row.id}:${token}` : row.id}
                          row={row}
                          timezone={timezone}
                          seesRevenue={seesRevenue}
                          variant="chip"
                          draggable={canDrag(row)}
                          dragging={drag?.item.id === row.id}
                          animateToken={token}
                          onOpen={onOpenAppointment}
                          onComplete={quickComplete(row)}
                          onPointerDown={(event) => onStartDrag(event, dragItem)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
