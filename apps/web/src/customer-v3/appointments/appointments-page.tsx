/**
 * FadeUp V3 — Appointments, designed around chronology.
 *
 * NEXT is a distinct object (the one plate on the page, realtime stage);
 * the remaining upcoming bookings are compact rows; PAST is denser still,
 * with Book again carrying location + barber — never a stale service.
 * Cancellation stays two-tap with an error surface. An active queue entry
 * surfaces as a banner into the Queue scene.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import {
  useMyAppointments,
  useMyQueueStatus,
  useCancelMyAppointment,
  bookingStage,
  isLiveStage,
  type MyAppointment,
} from '@/lib/queries/customer-app'
import { useDateTime } from '@/lib/intl/use-intl'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { V3_ROUTES, v3BookingPath } from '@/customer-v3/routes'

export function CustomerV3AppointmentsPage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('appointments.metaTitle'), description: t('appointments.metaDescription'), noIndex: true })

  const { user, loading } = useAuth()
  const appointments = useMyAppointments(Boolean(user), user?.id)
  const queue = useMyQueueStatus(Boolean(user))

  const { next, upcoming, past } = useMemo(() => {
    const rows = appointments.data ?? []
    const now = Date.now()
    const live = rows
      .filter((a) => isLiveStage(bookingStage(a)) && new Date(a.startsAt).getTime() > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const done = rows
      .filter((a) => !isLiveStage(bookingStage(a)) || new Date(a.startsAt).getTime() <= now)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    return { next: live[0] ?? null, upcoming: live.slice(1), past: done }
  }, [appointments.data])

  if (!loading && !user) {
    return (
      <div className="v3a-empty">
        <h1 className="v3a-empty-title">{t('appointments.signedOutTitle')}</h1>
        <p className="v3-meta">{t('appointments.signedOutBody')}</p>
        <Link to="/login" className="v3-btn v3-btn--primary-ink v3-press">
          {t('landing.nav.signIn')}
        </Link>
      </div>
    )
  }

  const activeQueue = (queue.data ?? []).length > 0

  return (
    <div className="v3ap-page">
      <header className="v3a-page-head">
        <h1 className="v3-h1">{t('appointments.title')}</h1>
      </header>

      {activeQueue ? (
        <Link to={V3_ROUTES.queue} className="v3ap-queue-banner v3-press">
          <span>
            <span className="v3-live-dot" aria-hidden="true" style={{ marginInlineEnd: '0.5rem' }} />
            {t('appointments.queueBanner')}
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}

      {appointments.isError ? (
        <p className="v3a-error" role="alert">
          {t('app.errors.load')}
        </p>
      ) : appointments.isPending ? (
        <div className="v3-skeleton" style={{ blockSize: '6rem' }} aria-hidden="true" />
      ) : (
        <>
          {next ? <NextCard appointment={next} /> : null}

          {upcoming.length > 0 ? (
            <section className="v3a-section" aria-labelledby="v3ap-upcoming">
              <div className="v3a-section-head">
                <h2 id="v3ap-upcoming" className="v3a-section-title">
                  {t('appointments.upcoming')}
                </h2>
              </div>
              <div className="v3a-results">
                {upcoming.map((appointment) => (
                  <AppointmentRow key={appointment.id} appointment={appointment} kind="upcoming" />
                ))}
              </div>
            </section>
          ) : null}

          {!next && upcoming.length === 0 && past.length === 0 ? (
            <div className="v3a-empty">
              <p className="v3a-empty-title">{t('appointments.emptyTitle')}</p>
              <p className="v3-meta">{t('appointments.emptyBody')}</p>
              <Link to={V3_ROUTES.marketplace} className="v3-btn v3-btn--book v3-press">
                {t('app.home.seeAll')}
              </Link>
            </div>
          ) : null}

          {past.length > 0 ? (
            <section className="v3a-section" aria-labelledby="v3ap-past">
              <div className="v3a-section-head">
                <h2 id="v3ap-past" className="v3a-section-title">
                  {t('appointments.past')}
                </h2>
              </div>
              <div className="v3a-results">
                {past.map((appointment) => (
                  <AppointmentRow key={appointment.id} appointment={appointment} kind="past" />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function stageLabelKey(appointment: MyAppointment): { key: string; tone: 'confirmed' | 'waiting' } {
  const stage = bookingStage(appointment)
  if (stage === 'confirmed') return { key: 'app.home.stageConfirmed', tone: 'confirmed' }
  return { key: 'app.home.stageWaiting', tone: 'waiting' }
}

function NextCard({ appointment }: { appointment: MyAppointment }) {
  const { t } = useTranslation('v3')
  const dt = useDateTime()
  const stage = stageLabelKey(appointment)

  const what = [appointment.serviceName, appointment.barberDisplayName, appointment.locationName]
    .filter(Boolean)
    .join(' · ')

  return (
    <section aria-labelledby="v3ap-next">
      <div className="v3a-section-head">
        <h2 id="v3ap-next" className="v3a-section-title">
          {t('appointments.next')}
        </h2>
      </div>
      <div className="v3ap-next v3-float">
        <span className="v3ap-stage" data-tone={stage.tone}>
          {t(stage.key)}
        </span>
        <time className="v3-num" style={{ fontSize: '1.375rem' }} dateTime={appointment.startsAt}>
          {dt.dateTime(appointment.startsAt, appointment.locationTimezone)}
        </time>
        <span className="v3a-next-what">{what}</span>
        <CancelControl appointmentId={appointment.id} />
      </div>
    </section>
  )
}

function AppointmentRow({ appointment, kind }: { appointment: MyAppointment; kind: 'upcoming' | 'past' }) {
  const { t } = useTranslation('v3')
  const dt = useDateTime()

  const what = [appointment.serviceName, appointment.barberDisplayName].filter(Boolean).join(' · ')
  const completed = bookingStage(appointment) === 'completed'

  return (
    <div className="v3ap-row">
      <time dateTime={appointment.startsAt}>
        <span>{dt.date(appointment.startsAt, appointment.locationTimezone)}</span>
        <span className="v3-num">{dt.time(appointment.startsAt, appointment.locationTimezone)}</span>
      </time>
      <div style={{ minInlineSize: 0 }}>
        <p className="v3a-row-name" style={{ fontSize: '0.9688rem' }}>
          <bdi>{appointment.locationName}</bdi>
        </p>
        {what ? <p className="v3a-row-meta">{what}</p> : null}
      </div>
      {kind === 'past' && completed ? (
        <Link
          to={v3BookingPath(appointment.organizationSlug, {
            locationId: appointment.locationId,
            barberId: appointment.barberId,
          })}
          className="v3-btn v3-btn--quiet v3-press"
        >
          {t('app.home.bookAgainCta')}
        </Link>
      ) : kind === 'upcoming' ? (
        <CancelControl appointmentId={appointment.id} />
      ) : (
        <span className="v3-meta">{t(`appointments.status.${appointment.status}`)}</span>
      )}
    </div>
  )
}

/** Two-tap cancel: first tap arms, second confirms; errors surface inline. */
function CancelControl({ appointmentId }: { appointmentId: string }) {
  const { t } = useTranslation('v3')
  const cancel = useCancelMyAppointment()
  const [arming, setArming] = useState(false)

  return (
    <span style={{ display: 'grid', justifyItems: 'start', gap: '0.125rem' }}>
      <button
        type="button"
        className="v3ap-cancel v3-press"
        data-arming={arming}
        disabled={cancel.isPending}
        onClick={() => {
          if (!arming) {
            setArming(true)
            return
          }
          cancel.mutate(appointmentId, { onSettled: () => setArming(false) })
        }}
        onBlur={() => setArming(false)}
      >
        {cancel.isPending
          ? t('appointments.cancelling')
          : arming
            ? t('appointments.cancelConfirm')
            : t('appointments.cancel')}
      </button>
      {cancel.isError ? (
        <span role="alert" className="v3-meta" style={{ color: 'var(--v3-alert)' }}>
          {t('appointments.cancelFailed')}
        </span>
      ) : null}
    </span>
  )
}
