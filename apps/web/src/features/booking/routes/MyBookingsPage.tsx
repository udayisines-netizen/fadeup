import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import {
  useMyAppointments,
  useMyInterestRequests,
  useMyQueueStatus,
  type MyAppointment,
} from '@/features/booking/api/booking'
import { isExpired, remainingParts } from '@/features/booking/lib/deadline'
import { AlternativesSheet } from '@/features/booking/components/AlternativesSheet'
import { BookingDetailSheet } from '@/features/booking/components/BookingDetailSheet'

/**
 * L'onglet Réservations (F4 §7) : demandes en attente avec leur échéance qui
 * défile, file active, à venir, demandes d'intérêt, historique.
 *
 * Une demande expirée n'est NI un no-show NI un refus : « La demande n'a pas
 * été confirmée à temps », puis les alternatives. « Réserver à nouveau »
 * renvoie dans le tunnel avec barber et service préremplis — le prochain
 * créneau réellement disponible s'y affiche.
 */
export function MyBookingsPage() {
  const { t, i18n } = useTranslation('v2')
  const navigate = useNavigate()
  const { session, loading: sessionLoading } = useSession()
  const now = useNow(30_000)

  const appointments = useMyAppointments(Boolean(session))
  const queue = useMyQueueStatus(Boolean(session))
  const interests = useMyInterestRequests(Boolean(session))

  const [detail, setDetail] = useState<MyAppointment | null>(null)
  const [alternativesFor, setAlternativesFor] = useState<MyAppointment | null>(null)

  const partitioned = useMemo(() => {
    const requests: MyAppointment[] = []
    const upcoming: MyAppointment[] = []
    const history: MyAppointment[] = []
    for (const row of appointments.data ?? []) {
      const future = Date.parse(row.starts_at) > now.getTime()
      if (row.status === 'pending' && row.resolution === null) requests.push(row)
      else if (row.status === 'confirmed' && future) upcoming.push(row)
      else history.push(row)
    }
    requests.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    history.sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    return { requests, upcoming, history }
  }, [appointments.data, now])

  if (!sessionLoading && !session) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <EmptyState
          title={t('booking.bookings.loginTitle')}
          description={t('booking.bookings.loginBody')}
          action={
            <Button variant="primary" onClick={() => void navigate('/auth/login?redirect=/bookings')}>
              {t('booking.bookings.loginAction')}
            </Button>
          }
        />
      </main>
    )
  }

  const loading = sessionLoading || appointments.isLoading
  const queueRows = queue.data ?? []
  const interestRows = interests.data ?? []
  const nothing =
    !loading &&
    partitioned.requests.length === 0 &&
    partitioned.upcoming.length === 0 &&
    partitioned.history.length === 0 &&
    queueRows.length === 0 &&
    interestRows.length === 0

  const rebook = (row: MyAppointment) => {
    void navigate(
      `/book/${encodeURIComponent(row.organization_slug)}?l=${row.location_id}&b=${row.barber_id}&s=${row.service_id}`,
    )
  }

  const requestCountdown = (row: MyAppointment) => {
    if (!row.expires_at) return null
    if (isExpired(row.expires_at, now)) return t('booking.bookings.resolutionExpired')
    const remaining = remainingParts(row.expires_at, now)
    if (!remaining) return null
    return t('booking.request.expiresIn', {
      time:
        remaining.hours > 0
          ? t('booking.request.hoursMinutes', { hours: remaining.hours, minutes: remaining.minutes })
          : t('booking.request.minutesOnly', { minutes: remaining.minutes }),
    })
  }

  const resolutionLabel = (row: MyAppointment): string | null => {
    switch (row.resolution) {
      case 'declined':
        return t('booking.bookings.resolutionDeclined')
      case 'expired':
        return t('booking.bookings.resolutionExpired')
      case 'cancelled_by_customer':
        return t('booking.bookings.resolutionCancelledByCustomer')
      case 'cancelled_by_business':
        return t('booking.bookings.resolutionCancelledByBusiness')
      case 'rescheduled':
        return t('booking.bookings.resolutionRescheduled')
      default:
        if (row.status === 'completed') return t('booking.bookings.statusCompleted')
        if (row.status === 'no_show') return t('booking.bookings.statusNoShow')
        return null
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-28 pt-5 md:pb-10" data-testid="my-bookings">
      <h1 className="text-fu-2xl font-semibold text-[var(--fu-text-primary)]">{t('booking.bookings.title')}</h1>

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <SkeletonRect className="h-14 w-full" />
          <SkeletonRect className="h-14 w-full" />
          <SkeletonRect className="h-14 w-2/3" />
        </div>
      ) : nothing ? (
        <EmptyState
          title={t('booking.bookings.emptyTitle')}
          description={t('booking.bookings.emptyBody')}
          action={
            <Button variant="primary" onClick={() => void navigate('/search')}>
              {t('booking.bookings.emptyAction')}
            </Button>
          }
        />
      ) : (
        <>
          {partitioned.requests.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="bookings-requests">
              <h2 className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">
                {t('booking.bookings.sectionRequests')}
              </h2>
              <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
                {partitioned.requests.map((row) => {
                  const expired = row.expires_at !== null && isExpired(row.expires_at, now)
                  return (
                    <Row
                      key={row.id}
                      as="button"
                      onClick={() => setDetail(row)}
                      title={row.organization_name}
                      subtitle={
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span>{row.service_name}</span>
                          <DateTime value={row.starts_at} timezone={row.location_timezone} format="datetime" />
                        </span>
                      }
                      trailing={
                        expired ? undefined : <StateBadge state="pending-request" size="sm" />
                      }
                      chevron
                    >
                      {/* L'échéance a sa propre ligne : le sous-titre tronque. */}
                      <p
                        className="mt-0.5 font-fu-mono text-fu-sm tabular-nums text-[var(--fu-text-secondary)]"
                        data-testid="request-row-countdown"
                      >
                        {requestCountdown(row)}
                      </p>
                    </Row>
                  )
                })}
              </div>
            </section>
          )}

          {queueRows.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="bookings-queue">
              <h2 className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">{t('booking.bookings.sectionQueue')}</h2>
              <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
                {queueRows.map((entry) => (
                  <Row
                    key={entry.id}
                    as="link"
                    to={`/q/${encodeURIComponent(entry.organization_slug)}?l=${entry.location_id}`}
                    aria-label={t('booking.bookings.queueRowAria', { name: entry.organization_name })}
                    title={entry.organization_name}
                    subtitle={
                      entry.queue_position !== null
                        ? t('booking.bookings.queuePosition', { position: entry.queue_position })
                        : entry.location_name
                    }
                    trailing={<span className="text-fu-sm text-[var(--fu-accent-text)]">{t('booking.bookings.viewQueue')}</span>}
                    chevron
                  />
                ))}
              </div>
            </section>
          )}

          {partitioned.upcoming.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="bookings-upcoming">
              <h2 className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">
                {t('booking.bookings.sectionUpcoming')}
              </h2>
              <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
                {partitioned.upcoming.map((row) => (
                  <Row
                    key={row.id}
                    as="button"
                    onClick={() => setDetail(row)}
                    title={row.organization_name}
                    subtitle={
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>{row.service_name}</span>
                        <DateTime value={row.starts_at} timezone={row.location_timezone} format="datetime" />
                      </span>
                    }
                    trailing={
                      row.price_cents !== null ? <Money cents={row.price_cents} currency={row.currency} /> : undefined
                    }
                    chevron
                  />
                ))}
              </div>
            </section>
          )}

          {interestRows.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="bookings-interest">
              <h2 className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">
                {t('booking.bookings.sectionInterest')}
              </h2>
              <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
                {interestRows.map((row) => (
                  <Row
                    key={row.id}
                    title={row.professional_display_name}
                    subtitle={
                      row.status === 'pending'
                        ? t('booking.bookings.interestPending', {
                            date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                              new Date(row.expires_at),
                            ),
                          })
                        : row.status === 'expired'
                          ? t('booking.bookings.interestExpired')
                          : t('booking.bookings.interestWithdrawn')
                    }
                    trailing={row.status === 'pending' ? <StateBadge state="pending-request" size="sm" /> : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          {partitioned.history.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="bookings-history">
              <h2 className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">
                {t('booking.bookings.sectionHistory')}
              </h2>
              <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
                {partitioned.history.map((row) => (
                  <Row
                    key={row.id}
                    title={row.organization_name}
                    subtitle={
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>{row.service_name}</span>
                        <DateTime value={row.starts_at} timezone={row.location_timezone} format="date" />
                        {resolutionLabel(row) && <span>{resolutionLabel(row)}</span>}
                      </span>
                    }
                    trailing={
                      <span className="flex items-center gap-2">
                        {row.status === 'pending' && row.resolution === 'expired' && (
                          <Button variant="tertiary" size="sm" onClick={() => setAlternativesFor(row)}>
                            {t('booking.request.findAlternative')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={t('booking.bookings.rebookAria', { service: row.service_name })}
                          onClick={() => rebook(row)}
                        >
                          {t('booking.bookings.rebook')}
                        </Button>
                      </span>
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {detail && (
        <BookingDetailSheet
          appointment={detail}
          open
          onOpenChange={(next) => {
            if (!next) setDetail(null)
          }}
          onFindAlternative={() => {
            setAlternativesFor(detail)
            setDetail(null)
          }}
        />
      )}

      <AlternativesSheet
        open={alternativesFor !== null}
        onOpenChange={(next) => {
          if (!next) setAlternativesFor(null)
        }}
        excludeOrganizationId={alternativesFor?.organization_id ?? null}
        serviceQuery={alternativesFor?.service_name ?? null}
      />
    </main>
  )
}

export default MyBookingsPage
