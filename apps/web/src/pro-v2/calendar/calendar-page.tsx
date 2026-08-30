import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  useCalendarRange,
  useCompleteAppointment,
  useMarkAppointmentNoShow,
  type CalendarAppointment,
} from '@/lib/queries/calendar'
import { useRescheduleAppointment } from '@/lib/queries/booking-requests'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import {
  addDays,
  minutesSinceMidnight,
  rangeForDays,
  todayInZone,
  zonedTimeToInstant,
} from '@/lib/calendar/time'
import { Notice } from '@/customer-v2/ui/notice'
import { useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * The operational calendar — one day, every professional, in the shop's own
 * timezone.
 *
 * ============================================================================
 * WHAT IS REUSED, BECAUSE IT WAS ALREADY CORRECT
 * ============================================================================
 *
 * `useCalendarRange` (server-filtered by org/location/barber, realtime
 * invalidation built in) and the `lib/calendar/time` helpers, which already
 * solve the two problems calendars actually have — DST-safe day boundaries
 * (`rangeForDays`) and "what instant is 14:30 on this date in this zone"
 * (`zonedTimeToInstant`). None of that is reimplemented here; this file is a
 * projection of those answers onto a grid.
 *
 * ============================================================================
 * DRAG AND DROP NEVER LIES
 * ============================================================================
 *
 * Dropping a card on a (barber, time) cell calls the real
 * `reschedule_appointment` contract — which enforces conflicts and permissions
 * server-side — and the card DOES NOT MOVE until the mutation lands and the
 * realtime invalidation refetches the range. While in flight the dragged card
 * dims; on rejection it simply stays where the truth says it is and the error
 * strip names the failure. An optimistic move that snaps back is the calendar
 * equivalent of a fabricated value.
 *
 * DAY VIEW ONLY, deliberately: it is the operational view the blueprint leads
 * with, week/month are additive projections over the same range hook, and the
 * master brief's visual-scope rule says structure now, breadth later.
 */

const DAY_START_MIN = 7 * 60
const DAY_END_MIN = 21 * 60
const SLOT_MINUTES = 30
const PX_PER_MINUTE = 56 / 60

export function ProV2CalendarPage() {
  const { t, i18n } = useTranslation()
  const scope = useProScope()

  const timezone =
    scope.locations.find((l) => l.id === scope.locationId)?.timezone ??
    scope.locations[0]?.timezone ??
    'UTC'

  const [dateKey, setDateKey] = useState(() => todayInZone(timezone))

  const range = useMemo(() => rangeForDays(dateKey, 1, timezone), [dateKey, timezone])
  const calendar = useCalendarRange(scope.organizationId, range, {
    locationId: scope.locationId,
  })

  const barbers = useOrgBarbers(scope.organizationId)
  const staffProfiles = useOrgStaffProfiles(scope.organizationId)
  const reschedule = useRescheduleAppointment(scope.organizationId)
  const complete = useCompleteAppointment(scope.organizationId)
  const noShow = useMarkAppointmentNoShow(scope.organizationId)

  const [draggingId, setDraggingId] = useState<string | null>(null)

  useDocumentMeta({
    title: t('app:v2pro.calendar.documentTitle'),
    description: t('app:v2pro.calendar.documentDescription'),
    noIndex: true,
  })

  /* Columns: every bookable placement, named through its staff profile. */
  const columns = useMemo(() => {
    const profiles = staffProfiles.data ?? []
    return (barbers.data ?? [])
      .filter((barber) => barber.isBookable)
      .map((barber) => ({
        barberId: barber.id,
        name:
          profiles.find((profile) => profile.id === barber.staffProfileId)?.displayName ??
          t('app:v2pro.calendar.unnamed'),
      }))
  }, [barbers.data, staffProfiles.data, t])

  const appointments = calendar.appointments.filter(
    (appointment) => appointment.status !== 'cancelled',
  )

  const dayLabel = new Intl.DateTimeFormat(i18n.language, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(range.from))

  const timeFormat = new Intl.DateTimeFormat(i18n.language, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })

  const onDropSlot = (barberId: string, minutes: number) => {
    if (!draggingId) return
    const startsAt = zonedTimeToInstant(dateKey, minutes, timezone).toISOString()
    reschedule.mutate({ appointmentId: draggingId, startsAt, barberId })
    setDraggingId(null)
  }

  const card = (appointment: CalendarAppointment, positioned: boolean) => {
    const top =
      (minutesSinceMidnight(appointment.startsAt, timezone) - DAY_START_MIN) * PX_PER_MINUTE
    const height = Math.max(
      24,
      (minutesSinceMidnight(appointment.endsAt, timezone) -
        minutesSinceMidnight(appointment.startsAt, timezone)) *
        PX_PER_MINUTE,
    )
    const live = appointment.status === 'confirmed' || appointment.status === 'pending'

    return (
      <div
        key={appointment.id}
        draggable={live}
        onDragStart={() => setDraggingId(appointment.id)}
        onDragEnd={() => setDraggingId(null)}
        style={positioned ? { top, height } : undefined}
        className={`${positioned ? 'absolute inset-x-1' : ''} overflow-hidden rounded-v2-1 border px-2 py-1 text-start ${
          appointment.status === 'completed'
            ? 'border-v2-hairline bg-v2-fill text-v2-ink-soft'
            : appointment.status === 'no_show'
              ? 'border-v2-hairline bg-v2-paper text-v2-ink-mute line-through'
              : 'border-v2-green/30 bg-v2-green-tint text-v2-green-ink'
        } ${draggingId === appointment.id || reschedule.isPending ? 'opacity-60' : ''} ${live ? 'cursor-grab' : ''}`}
      >
        <p className="truncate text-v2-caption font-semibold">
          {timeFormat.format(new Date(appointment.startsAt))} ·{' '}
          <bdi>{appointment.customerName}</bdi>
        </p>
        {appointment.serviceName ? (
          <p className="truncate text-v2-caption">{appointment.serviceName}</p>
        ) : null}
      </div>
    )
  }

  const hours = []
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hours.push(m)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
          {t('app:v2pro.nav.calendar')}
        </h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('app:v2pro.calendar.previousDay')}
            onClick={() => setDateKey((current) => addDays(current, -1))}
            className="v2-press flex h-11 w-11 items-center justify-center rounded-v2-2 text-v2-ink hover:bg-v2-fill"
          >
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDateKey(todayInZone(timezone))}
            className="v2-press inline-flex h-9 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink"
          >
            {t('app:v2pro.calendar.today')}
          </button>
          <button
            type="button"
            aria-label={t('app:v2pro.calendar.nextDay')}
            onClick={() => setDateKey((current) => addDays(current, 1))}
            className="v2-press flex h-11 w-11 items-center justify-center rounded-v2-2 text-v2-ink hover:bg-v2-fill"
          >
            <ChevronRight className="h-5 w-5 rtl:rotate-180" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="text-v2-body font-medium text-v2-ink-soft">{dayLabel}</p>

      {reschedule.isError ? (
        <p role="alert" className="text-v2-meta font-medium text-v2-alert">
          {t('app:v2pro.calendar.rescheduleFailed')}
        </p>
      ) : null}

      {calendar.isError ? (
        <Notice
          tone="failure"
          title={t('customer-app:v2.discovery.errorTitle')}
          body={t('customer-app:v2.discovery.errorBody')}
          actionLabel={t('customer-app:v2.discovery.retry')}
          onAction={calendar.refetch}
        />
      ) : (
        <>
          {/* ── Mobile: vertical timeline ─────────────────────────────────── */}
          <section className="v2-plate overflow-hidden md:hidden">
            {appointments.length > 0 ? (
              <ul>
                {appointments
                  .slice()
                  .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                  .map((appointment) => (
                    <li
                      key={appointment.id}
                      className="border-t border-v2-hairline px-4 py-3 first:border-t-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-v2-body font-semibold tabular-nums text-v2-ink">
                          {timeFormat.format(new Date(appointment.startsAt))}
                        </p>
                        <p className="shrink-0 text-v2-caption font-medium text-v2-ink-mute">
                          {t(`app:v2pro.dashboard.status.${appointment.status}`)}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-v2-meta text-v2-ink">
                        <bdi>{appointment.customerName}</bdi>
                        {appointment.barberDisplayName ? (
                          <span className="text-v2-ink-soft">
                            {' · '}
                            <bdi>{appointment.barberDisplayName}</bdi>
                          </span>
                        ) : null}
                      </p>
                      {appointment.status === 'confirmed' || appointment.status === 'pending' ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={complete.isPending}
                            onClick={() => complete.mutate(appointment.id)}
                            className="v2-press inline-flex h-9 items-center rounded-v2-2 bg-v2-green px-3 text-v2-meta font-semibold text-v2-paper"
                          >
                            {t('app:v2pro.calendar.complete')}
                          </button>
                          <button
                            type="button"
                            disabled={noShow.isPending}
                            onClick={() => noShow.mutate(appointment.id)}
                            className="v2-press inline-flex h-9 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft"
                          >
                            {t('app:v2pro.calendar.noShow')}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-v2-meta text-v2-ink-soft">
                {t('app:v2pro.dashboard.noAppointmentsToday')}
              </p>
            )}
          </section>

          {/* ── Desktop: per-professional columns, drop targets everywhere ── */}
          <section className="v2-plate hidden overflow-x-auto md:block">
            <div className="flex min-w-[40rem]">
              {/* Hour rail */}
              <div className="w-14 shrink-0 border-e border-v2-hairline">
                <div className="h-10 border-b border-v2-hairline" />
                <div
                  className="relative"
                  style={{ height: (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE }}
                >
                  {hours.map((m) => (
                    <p
                      key={m}
                      style={{ top: (m - DAY_START_MIN) * PX_PER_MINUTE }}
                      className="absolute -translate-y-1/2 px-2 text-v2-caption tabular-nums text-v2-ink-mute"
                    >
                      {String(Math.floor(m / 60)).padStart(2, '0')}:00
                    </p>
                  ))}
                </div>
              </div>

              {columns.map((column) => {
                const mine = appointments.filter((entry) => entry.barberId === column.barberId)
                return (
                  <div
                    key={column.barberId}
                    className="min-w-40 flex-1 border-e border-v2-hairline last:border-e-0"
                  >
                    <p className="flex h-10 items-center justify-center truncate border-b border-v2-hairline px-2 text-v2-meta font-semibold text-v2-ink">
                      <bdi>{column.name}</bdi>
                    </p>
                    <div
                      className="relative"
                      style={{ height: (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE }}
                    >
                      {/* Drop slots */}
                      {Array.from(
                        { length: (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES },
                        (_, index) => DAY_START_MIN + index * SLOT_MINUTES,
                      ).map((minutes) => (
                        <div
                          key={minutes}
                          onDragOver={(event) => {
                            if (draggingId) event.preventDefault()
                          }}
                          onDrop={() => onDropSlot(column.barberId, minutes)}
                          style={{
                            top: (minutes - DAY_START_MIN) * PX_PER_MINUTE,
                            height: SLOT_MINUTES * PX_PER_MINUTE,
                          }}
                          className="absolute inset-x-0 border-t border-dashed border-v2-hairline/60"
                        />
                      ))}
                      {mine.map((appointment) => card(appointment, true))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
