import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import type { AgendaAppointmentRow, TimeBlockRow } from '@/features/pro-agenda/api/agenda'
import { AppointmentCard } from '@/features/pro-agenda/components/AppointmentCard'
import { TimeBlockCard } from '@/features/pro-agenda/components/TimeBlockCard'
import type { DragItem, DragState } from '@/features/pro-agenda/hooks/useDragMove'
import { assignLanes, blockedInterval, holdsSlot, positionInDay, type Interval } from '@/features/pro-agenda/lib/layout'
import { clampMinutes, dayKeyInZone, minutesOfDayInZone, snapMinutes, zonedDayStart, type DayKey } from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — la vue JOUR : heures en ordonnée, une colonne par barber, les
 * rendez-vous positionnés à leur hauteur. Régime DENSE (contrat §3) tempéré
 * par la décision fondateur « aéré, quitte à défiler » : 96 px par heure —
 * une prestation de 30 min fait 48 px, huit heures tiennent dans un écran
 * de 900 px, le reste défile.
 *
 * Chaque colonne porte `data-drop-barber` / `data-drop-day` /
 * `data-drop-kind="time"` : c'est ce que le glisser-déposer lit. Un clic sur
 * du vide ouvre la création à cette heure, pour ce barber.
 */

export const HOUR_HEIGHT = 96
export const GUTTER_WIDTH = 56
export const MIN_COLUMN_WIDTH = 160

export interface DayGridProps {
  dayKey: DayKey
  timezone: string
  barbers: OrganizationBarber[]
  appointments: AgendaAppointmentRow[]
  blocks: TimeBlockRow[]
  hourRange: { start: number; end: number }
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
  onCreateAt: (barberId: string, minutes: number) => void
}

type Placed =
  | { kind: 'appointment'; row: AgendaAppointmentRow; interval: Interval }
  | { kind: 'block'; block: TimeBlockRow; interval: Interval }

export function DayGrid({
  dayKey,
  timezone,
  barbers,
  appointments,
  blocks,
  hourRange,
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
}: DayGridProps) {
  const { t, i18n } = useTranslation('v2')
  const dayStart = useMemo(() => zonedDayStart(dayKey, timezone), [dayKey, timezone])
  const hours = useMemo(
    () => Array.from({ length: hourRange.end - hourRange.start }, (_, i) => hourRange.start + i),
    [hourRange.end, hourRange.start],
  )
  const gridHeight = (hourRange.end - hourRange.start) * HOUR_HEIGHT

  const isToday = dayKey === dayKeyInZone(now, timezone)
  const nowMinutes = minutesOfDayInZone(now, timezone)
  const nowTop = (nowMinutes - hourRange.start * 60) * (HOUR_HEIGHT / 60)
  const showNow = isToday && nowTop >= 0 && nowTop <= gridHeight

  const hourLabel = (hour: number) =>
    new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      new Date(Date.UTC(2000, 0, 1, hour, 0)),
    )

  const clickToCreate = (event: React.MouseEvent<HTMLDivElement>, barberId: string) => {
    if (!canCreateFor(barberId)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const raw = hourRange.start * 60 + ((event.clientY - rect.top) / HOUR_HEIGHT) * 60
    onCreateAt(barberId, clampMinutes(snapMinutes(raw, 15), hourRange.start * 60, hourRange.end * 60 - 15))
  }

  return (
    <div className="overflow-x-auto" data-testid="agenda-day-grid">
      <div
        role="group"
        aria-label={t('pro.agenda.grid.label')}
        data-hour-start={hourRange.start}
        data-hour-height={HOUR_HEIGHT}
        style={{ minWidth: GUTTER_WIDTH + barbers.length * MIN_COLUMN_WIDTH }}
      >
        {/* En-têtes de colonnes : le nom, rien d'autre. Absent en solo, et
            inutile quand une seule colonne est affichée (le sélecteur le dit). */}
        {!isSolo && barbers.length > 1 && (
          <div className="flex border-b border-[var(--fu-border)]" aria-hidden="true">
            <div style={{ width: GUTTER_WIDTH }} className="shrink-0" />
            {barbers.map((barber) => (
              <div key={barber.id} className="min-w-0 flex-1 truncate px-2 py-2 text-fu-sm font-semibold text-[var(--fu-text-primary)]">
                {barber.display_name}
              </div>
            ))}
          </div>
        )}

        <div className="relative flex pt-2.5 pb-3">
          {/* La gouttière des heures. */}
          <div style={{ width: GUTTER_WIDTH, height: gridHeight }} className="relative shrink-0">
            {hours.map((hour) => (
              <span
                key={hour}
                style={{ top: (hour - hourRange.start) * HOUR_HEIGHT }}
                className="absolute -translate-y-1/2 pe-2 text-end font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]"
                aria-hidden="true"
              >
                {hourLabel(hour)}
              </span>
            ))}
          </div>

          {/* Les colonnes, lignes horaires en fond (répétition CSS, pas de DOM). */}
          <div
            className="relative flex flex-1"
            style={{
              height: gridHeight,
              backgroundImage: 'linear-gradient(to bottom, var(--fu-border) 1px, transparent 1px)',
              backgroundSize: `100% ${HOUR_HEIGHT}px`,
            }}
          >
            {barbers.map((barber) => {
              const columnItems: Placed[] = [
                ...appointments
                  .filter((row) => row.barber_id === barber.id && row.status !== 'cancelled')
                  .map((row) => ({ kind: 'appointment' as const, row, interval: holdsSlot(row.status) ? blockedInterval(row) : { start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) } })),
                ...blocks
                  .filter((block) => block.barber_id === barber.id)
                  .map((block) => ({ kind: 'block' as const, block, interval: { start: Date.parse(block.starts_at), end: Date.parse(block.ends_at) } })),
              ]
              const laned = assignLanes(columnItems, (item) => item.interval)
              const isTarget = drag?.target?.barberId === barber.id && drag.target.dayKey === dayKey
              return (
                <div
                  key={barber.id}
                  data-drop-barber={barber.id}
                  data-drop-day={dayKey}
                  data-drop-kind="time"
                  data-testid="agenda-column"
                  /* Clic sur du vide = créer ici (souris/tactile) ; le chemin
                     clavier est le bouton « Créer » de l'en-tête — pas de rôle
                     factice sur une surface qui contient déjà des boutons. */
                  onClick={(event) => clickToCreate(event, barber.id)}
                  className={cn(
                    'relative min-w-0 flex-1 border-s border-[var(--fu-border)]',
                    isTarget && 'bg-[var(--fu-surface-subtle)]',
                  )}
                >
                  {laned.map(({ item, lane, lanes }) => {
                    const starts = new Date(item.kind === 'appointment' ? item.row.starts_at : item.block.starts_at)
                    const ends = new Date(item.kind === 'appointment' ? item.row.ends_at : item.block.ends_at)
                    const placement = positionInDay(starts, ends, timezone, hourRange.start, hourRange.end, HOUR_HEIGHT, dayStart)
                    if (placement.height === 0) return null
                    const style: React.CSSProperties = {
                      top: placement.top,
                      height: Math.max(placement.height, 20),
                      insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }
                    if (item.kind === 'block') {
                      return (
                        <TimeBlockCard key={item.block.id} block={item.block} timezone={timezone} variant="grid" height={placement.height} style={style} onOpen={onOpenBlock} />
                      )
                    }
                    const row = item.row
                    const token = changed.get(row.id)
                    const dragItem: DragItem = {
                      id: row.id,
                      startMinutes: minutesOfDayInZone(starts, timezone),
                      durationMinutes: Math.round((ends.getTime() - starts.getTime()) / 60_000),
                      barberId: barber.id,
                      dayKey,
                      label: row.customer_name,
                    }
                    return (
                      <AppointmentCard
                        key={token ? `${row.id}:${token}` : row.id}
                        row={row}
                        timezone={timezone}
                        seesRevenue={seesRevenue}
                        variant="grid"
                        height={placement.height}
                        draggable={canDrag(row)}
                        dragging={drag?.item.id === row.id}
                        animateToken={token}
                        style={style}
                        onOpen={onOpenAppointment}
                        onComplete={quickComplete(row)}
                        onPointerDown={(event) => onStartDrag(event, dragItem)}
                      />
                    )
                  })}

                  {/* L'aperçu de dépôt : la position CIBLE dans cette colonne. */}
                  {isTarget && drag?.target && (
                    <div
                      aria-hidden="true"
                      data-testid="agenda-drop-preview"
                      style={{
                        top: (drag.target.minutes - hourRange.start * 60) * (HOUR_HEIGHT / 60),
                        height: drag.item.durationMinutes * (HOUR_HEIGHT / 60),
                      }}
                      className="pointer-events-none absolute inset-x-0.5 rounded-[var(--radius-control)] border-2 border-dashed border-[var(--fu-accent)] bg-[var(--fu-accent-soft)]"
                    />
                  )}
                </div>
              )
            })}

            {/* La ligne « maintenant » — seulement aujourd'hui. */}
            {showNow && (
              <div
                aria-label={t('pro.agenda.grid.now')}
                data-testid="agenda-now-line"
                style={{ top: nowTop }}
                className="pointer-events-none absolute inset-x-0 z-[1] flex items-center"
              >
                <span aria-hidden="true" className="-ms-1 size-2 rounded-[var(--radius-avatar)] bg-[var(--fu-accent)]" />
                <span aria-hidden="true" className="h-0.5 flex-1 bg-[var(--fu-accent)]" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
