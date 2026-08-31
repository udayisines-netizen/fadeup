/**
 * FadeUp V3 — Pro calendar: mature scheduling software.
 *
 * The audited machinery is intact — `useCalendarRange` (server-filtered,
 * realtime invalidation), `lib/calendar/time` for DST-safe boundaries and
 * zone math, and the no-optimistic-move drag rule (a card moves only after
 * `reschedule_appointment` lands and the refetch confirms it). V3 renders
 * it dense: tight time rail with 15-minute ticks, compact two-line blocks
 * with a status edge, per-professional columns, and a real current-time
 * line that does not animate — it just is. Mobile is a vertical timeline
 * with compact quick actions.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { useProV3Scope } from '@/pro-v3/shell/pro-v3-shell'

const DAY_START_MIN = 7 * 60
const DAY_END_MIN = 21 * 60
const SLOT_MINUTES = 30
const PX_PER_MINUTE = 64 / 60

export function ProV3CalendarPage() {
  const { t, i18n } = useTranslation('v3')
  const scope = useProV3Scope()

  const timezone =
    scope.locations.find((l) => l.id === scope.locationId)?.timezone ??
    scope.locations[0]?.timezone ??
    'UTC'

  const [dateKey, setDateKey] = useState(() => todayInZone(timezone))
  const range = useMemo(() => rangeForDays(dateKey, 1, timezone), [dateKey, timezone])
  const calendar = useCalendarRange(scope.organizationId, range, { locationId: scope.locationId })

  const barbers = useOrgBarbers(scope.organizationId)
  const staffProfiles = useOrgStaffProfiles(scope.organizationId)
  const reschedule = useRescheduleAppointment(scope.organizationId)
  const complete = useCompleteAppointment(scope.organizationId)
  const noShow = useMarkAppointmentNoShow(scope.organizationId)

  const [draggingId, setDraggingId] = useState<string | null>(null)

  /* The now-line rechecks each minute; it renders only on today. */
  const [nowMinutes, setNowMinutes] = useState(() => minutesSinceMidnight(new Date().toISOString(), timezone))
  useEffect(() => {
    const tick = () => setNowMinutes(minutesSinceMidnight(new Date().toISOString(), timezone))
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [timezone])
  const isToday = dateKey === todayInZone(timezone)

  useDocumentMeta({ title: t('pro.calendar.metaTitle'), description: t('pro.calendar.metaDescription'), noIndex: true })

  const columns = useMemo(() => {
    const profiles = staffProfiles.data ?? []
    return (barbers.data ?? [])
      .filter((barber) => barber.isBookable)
      .map((barber) => ({
        barberId: barber.id,
        name:
          profiles.find((profile) => profile.id === barber.staffProfileId)?.displayName ??
          t('pro.calendar.unnamed'),
      }))
  }, [barbers.data, staffProfiles.data, t])

  const appointments = calendar.appointments.filter((a) => a.status !== 'cancelled')

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

  const block = (appointment: CalendarAppointment) => {
    const startMin = minutesSinceMidnight(appointment.startsAt, timezone)
    const endMin = minutesSinceMidnight(appointment.endsAt, timezone)
    const top = (startMin - DAY_START_MIN) * PX_PER_MINUTE
    const height = Math.max(22, (endMin - startMin) * PX_PER_MINUTE)
    const live = appointment.status === 'confirmed' || appointment.status === 'pending'
    const oneLine = endMin - startMin < 30

    return (
      <div
        key={appointment.id}
        draggable={live}
        onDragStart={() => setDraggingId(appointment.id)}
        onDragEnd={() => setDraggingId(null)}
        style={{ top, height }}
        className="v3cal-block"
        data-status={appointment.status}
        data-dragging={draggingId === appointment.id || reschedule.isPending}
      >
        <p>
          <span className="v3-num">{timeFormat.format(new Date(appointment.startsAt))}</span>{' '}
          <bdi>{appointment.customerName}</bdi>
          {oneLine && appointment.serviceName ? <> · {appointment.serviceName}</> : null}
        </p>
        {!oneLine && appointment.serviceName ? <p>{appointment.serviceName}</p> : null}
      </div>
    )
  }

  const hours: number[] = []
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hours.push(m)
  const ticks: number[] = []
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 15) ticks.push(m)

  const gridHeight = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE

  return (
    <div>
      <div className="v3pro-head">
        <h1 className="v3-h1">{t('pro.nav.calendar')}</h1>
        <div className="v3cal-controls">
          <button
            type="button"
            className="v3-btn v3-btn--quiet v3-press"
            aria-label={t('pro.calendar.previousDay')}
            onClick={() => setDateKey((current) => addDays(current, -1))}
          >
            <Chevron direction="back" />
          </button>
          <button
            type="button"
            className="v3-btn v3-btn--quiet v3-press"
            onClick={() => setDateKey(todayInZone(timezone))}
          >
            {t('pro.calendar.today')}
          </button>
          <button
            type="button"
            className="v3-btn v3-btn--quiet v3-press"
            aria-label={t('pro.calendar.nextDay')}
            onClick={() => setDateKey((current) => addDays(current, 1))}
          >
            <Chevron direction="forward" />
          </button>
        </div>
      </div>

      <p className="v3cal-daylabel">{dayLabel}</p>

      {reschedule.isError ? (
        <p role="alert" className="v3a-error" style={{ marginBlockEnd: '0.75rem' }}>
          {t('pro.calendar.rescheduleFailed')}
        </p>
      ) : null}

      {calendar.isError ? (
        <p className="v3a-error" role="alert">
          {t('app.errors.load')}
        </p>
      ) : (
        <>
          {/* Mobile: vertical day timeline with quick actions. */}
          <section className="v3pro-panel v3cal-mobile">
            {appointments.length > 0 ? (
              appointments
                .slice()
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                .map((appointment) => (
                  <div key={appointment.id} className="v3cal-mrow">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <span className="v3-num" style={{ fontSize: '1rem' }}>
                        {timeFormat.format(new Date(appointment.startsAt))}
                      </span>
                      <span className="v3-meta">{t(`pro.status.${appointment.status}`)}</span>
                    </div>
                    <span style={{ fontSize: '0.9063rem' }}>
                      <bdi>{appointment.customerName}</bdi>
                      {appointment.barberDisplayName ? (
                        <span style={{ color: 'var(--v3-ink-soft)' }}>
                          {' · '}
                          <bdi>{appointment.barberDisplayName}</bdi>
                        </span>
                      ) : null}
                      {appointment.serviceName ? (
                        <span style={{ color: 'var(--v3-ink-soft)' }}> · {appointment.serviceName}</span>
                      ) : null}
                    </span>
                    {appointment.status === 'confirmed' || appointment.status === 'pending' ? (
                      <div className="v3cal-mrow-actions">
                        <button
                          type="button"
                          className="v3-btn v3-btn--book v3-press"
                          disabled={complete.isPending}
                          onClick={() => complete.mutate(appointment.id)}
                        >
                          {t('pro.calendar.complete')}
                        </button>
                        <button
                          type="button"
                          className="v3-btn v3-btn--quiet v3-press"
                          disabled={noShow.isPending}
                          onClick={() => noShow.mutate(appointment.id)}
                        >
                          {t('pro.calendar.noShow')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
            ) : (
              <p className="v3pro-empty">{t('pro.dashboard.noAppointmentsToday')}</p>
            )}
          </section>

          {/* Desktop: dense per-professional grid. */}
          <section className="v3pro-panel v3cal-scroll v3cal-desktop">
            <div className="v3cal-grid">
              <div className="v3cal-rail">
                <div className="v3cal-colhead" />
                <div style={{ position: 'relative', height: gridHeight }}>
                  {hours.map((m) => (
                    <p key={m} className="v3cal-hour" style={{ top: (m - DAY_START_MIN) * PX_PER_MINUTE }}>
                      {String(Math.floor(m / 60)).padStart(2, '0')}:00
                    </p>
                  ))}
                </div>
              </div>

              {columns.map((column) => {
                const mine = appointments.filter((entry) => entry.barberId === column.barberId)
                return (
                  <div key={column.barberId} className="v3cal-col">
                    <p className="v3cal-colhead">
                      <bdi>{column.name}</bdi>
                    </p>
                    <div style={{ position: 'relative', height: gridHeight }}>
                      {ticks.map((m) => (
                        <div
                          key={m}
                          className="v3cal-tick"
                          data-minor={m % 60 !== 0 ? '' : undefined}
                          onDragOver={(event) => {
                            if (draggingId) event.preventDefault()
                          }}
                          onDrop={() => onDropSlot(column.barberId, m)}
                          style={{
                            top: (m - DAY_START_MIN) * PX_PER_MINUTE,
                            height: SLOT_MINUTES * PX_PER_MINUTE,
                          }}
                        />
                      ))}
                      {isToday && nowMinutes >= DAY_START_MIN && nowMinutes <= DAY_END_MIN ? (
                        <div
                          className="v3cal-now"
                          style={{ top: (nowMinutes - DAY_START_MIN) * PX_PER_MINUTE }}
                          aria-hidden="true"
                        />
                      ) : null}
                      {mine.map(block)}
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

function Chevron({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      data-direction={direction}
    >
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
