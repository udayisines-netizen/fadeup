import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'
import { downloadIcs } from '@/lib/calendar/ics'
import {
  bookingStage,
  isLiveStage,
  useCancelMyAppointment,
  useMyAppointments,
  useMyQueueStatus,
  type BookingStage,
  type MyAppointment,
} from '@/lib/queries/customer-app'
import { useDelayedFlag } from '@/customer-v2/hooks/use-delayed'
import { Notice } from '@/customer-v2/ui/notice'
import { V2_ROUTES, v2BookingPath, v2ShopProfilePath } from '@/customer-v2/routes'

/**
 * The customer's appointments — everything upcoming, everything past, and the
 * retention loop out of the past.
 *
 * ============================================================================
 * THE SPLIT IS STAGE-DRIVEN, NOT DATE-DRIVEN
 * ============================================================================
 *
 * `bookingStage` already folds status + resolution into the seven stages the
 * domain actually has, and `isLiveStage` says which of them still bind anyone.
 * UPCOMING is a live stage whose end is still ahead; everything else is PAST —
 * including a "confirmed" appointment whose time slipped by without a
 * completion, which a pure status split would wrongly keep pinned to the top
 * of the list forever.
 *
 * ============================================================================
 * BOOK AGAIN PRESERVES EXACTLY WHAT IS STILL TRUE
 * ============================================================================
 *
 * A past appointment knows its shop, its location and its barber, and Book
 * again carries all three into the booking flow — so the flow opens with the
 * barber preselected and asks only for service and time. The SERVICE is
 * deliberately not preselected: prices and durations drift, the flow must
 * quote today's real ones, and `serviceId` may reference a retired service.
 * Context is preserved; stale facts are not.
 *
 * ============================================================================
 * EVERY TIME IS THE SHOP'S TIME
 * ============================================================================
 *
 * The list can genuinely span countries, which is why the contract carries
 * `locationTimezone` per row. Every rendered time formats in that zone: an
 * appointment at 17:00 in Lisbon is 17:00 wherever the customer's phone
 * happens to be when they read it.
 */
export function CustomerV2AppointmentsPage() {
  const { t, i18n } = useTranslation()
  const { user, loading } = useAuth()
  const money = useMoney()

  const appointments = useMyAppointments(Boolean(user), user?.id)
  const myQueue = useMyQueueStatus(Boolean(user))
  const cancel = useCancelMyAppointment()
  const showSkeletons = useDelayedFlag(Boolean(user) && appointments.isPending)

  useDocumentMeta({
    title: t('customer-app:v2.appointments.documentTitle'),
    description: t('customer-app:v2.appointments.documentDescription'),
    noIndex: true,
  })

  const { upcoming, past } = useMemo(() => {
    const now = Date.now()
    const rows = appointments.data ?? []
    const up: MyAppointment[] = []
    const done: MyAppointment[] = []
    for (const appointment of rows) {
      const stage = bookingStage(appointment)
      if (isLiveStage(stage) && new Date(appointment.endsAt).getTime() > now) up.push(appointment)
      else done.push(appointment)
    }
    up.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    done.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    return { upcoming: up, past: done }
  }, [appointments.data])

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-[30rem]">
        <h1 className="mb-4 text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
          {t('customer-app:v2.appointments.title')}
        </h1>
        <Notice
          tone="empty"
          title={t('customer-app:v2.appointments.signInTitle')}
          body={t('customer-app:v2.appointments.signInBody')}
          actionLabel={null}
          onAction={null}
        />
        <Link
          to={`/login?redirect=${encodeURIComponent(V2_ROUTES.appointments)}`}
          className="v2-press mt-3 inline-flex h-11 w-full items-center justify-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90"
        >
          {t('customer-app:v2.appointments.signInAction')}
        </Link>
      </div>
    )
  }

  if (appointments.isError) {
    return (
      <Notice
        tone="failure"
        title={t('customer-app:v2.discovery.errorTitle')}
        body={t('customer-app:v2.discovery.errorBody')}
        actionLabel={t('customer-app:v2.discovery.retry')}
        onAction={() => void appointments.refetch()}
      />
    )
  }

  if (loading || appointments.isPending) {
    return showSkeletons ? (
      <div className="v2-plate mx-auto max-w-[36rem] p-5">
        <div className="v2-skeleton h-5 w-1/3 rounded-v2-1" />
        <div className="v2-skeleton mt-3 h-16 w-full rounded-v2-2" />
      </div>
    ) : (
      <div className="min-h-64" />
    )
  }

  const stageLabel = (stage: BookingStage) => t(`customer-app:v2.appointments.stage.${stage}`)

  const card = (appointment: MyAppointment, live: boolean) => {
    const stage = bookingStage(appointment)
    const dayFormat = new Intl.DateTimeFormat(i18n.language, {
      timeZone: appointment.locationTimezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    const timeFormat = new Intl.DateTimeFormat(i18n.language, {
      timeZone: appointment.locationTimezone,
      hour: '2-digit',
      minute: '2-digit',
    })
    const start = new Date(appointment.startsAt)

    return (
      <li
        key={appointment.id}
        className="border-t border-v2-hairline px-4 py-3.5 first:border-t-0 md:px-5"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-v2-body font-semibold tabular-nums text-v2-ink">
            {dayFormat.format(start)} · {timeFormat.format(start)}
          </p>
          <p
            className={
              stage === 'confirmed'
                ? 'shrink-0 text-v2-caption font-semibold text-v2-green-ink'
                : stage === 'waiting'
                  ? 'shrink-0 text-v2-caption font-semibold text-v2-ink-soft'
                  : 'shrink-0 text-v2-caption font-medium text-v2-ink-mute'
            }
          >
            {stageLabel(stage)}
          </p>
        </div>

        <p className="mt-1 truncate text-v2-meta text-v2-ink-soft">
          {appointment.barberDisplayName ? <bdi>{appointment.barberDisplayName}</bdi> : null}
          {appointment.barberDisplayName ? ' · ' : ''}
          <Link
            to={v2ShopProfilePath(appointment.organizationSlug, appointment.locationId)}
            className="font-semibold text-v2-green hover:underline"
          >
            <bdi>{appointment.organizationName}</bdi>
          </Link>
        </p>

        {appointment.serviceName ? (
          <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
            {appointment.serviceName}
            {appointment.priceCents !== null
              ? ` · ${money(appointment.priceCents, appointment.currency)}`
              : ''}
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {live ? (
            <>
              <button
                type="button"
                onClick={() =>
                  downloadIcs({
                    title: [appointment.serviceName, appointment.organizationName]
                      .filter(Boolean)
                      .join(' · '),
                    description: appointment.barberDisplayName ?? undefined,
                    location: appointment.locationName,
                    startsAt: appointment.startsAt,
                    endsAt: appointment.endsAt,
                    uid: appointment.id,
                  })
                }
                className="v2-press inline-flex h-9 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft hover:border-v2-edge hover:text-v2-ink"
              >
                {t('customer-app:v2.booking.addToCalendar')}
              </button>
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(appointment.id)}
                className="v2-press inline-flex h-9 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft hover:border-v2-edge hover:text-v2-ink disabled:text-v2-ink-mute"
              >
                {t('customer-app:v2.appointments.cancel')}
              </button>
            </>
          ) : (
            <Link
              to={v2BookingPath(appointment.organizationSlug, {
                locationId: appointment.locationId,
                barberId: appointment.barberId,
              })}
              className="v2-press inline-flex h-9 items-center rounded-v2-2 bg-v2-green px-3.5 text-v2-meta font-semibold text-v2-paper hover:bg-v2-green-deep"
            >
              {t('customer-app:v2.appointments.bookAgain')}
            </Link>
          )}
        </div>
      </li>
    )
  }

  const empty = upcoming.length === 0 && past.length === 0

  return (
    <div className="mx-auto flex max-w-[36rem] flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('customer-app:v2.appointments.title')}
      </h1>

      {/*
        A live queue entry outranks everything below it: someone standing in a
        shop right now needs their ticket, not their history.
      */}
      {(myQueue.data ?? []).length > 0 ? (
        <Link
          to={V2_ROUTES.queue}
          className="v2-press flex items-center justify-between gap-3 rounded-v2-3 bg-v2-green-tint px-4 py-3 text-v2-body font-semibold text-v2-green-ink"
        >
          {t('customer-app:v2.queue.activeBanner')}
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}

      {empty ? (
        <>
          <Notice
            tone="empty"
            title={t('customer-app:v2.appointments.emptyTitle')}
            body={t('customer-app:v2.appointments.emptyBody')}
            actionLabel={null}
            onAction={null}
          />
          <Link
            to={V2_ROUTES.marketplace}
            className="v2-press inline-flex h-11 w-full items-center justify-center rounded-v2-2 bg-v2-green px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-green-deep"
          >
            {t('customer-app:v2.appointments.findSomeone')}
          </Link>
        </>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <section aria-labelledby="v2-appointments-upcoming" className="v2-plate overflow-hidden">
              <h2
                id="v2-appointments-upcoming"
                className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5"
              >
                {t('customer-app:v2.appointments.upcoming')}
              </h2>
              <ul className="border-t border-v2-hairline">
                {upcoming.map((appointment) => card(appointment, true))}
              </ul>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section aria-labelledby="v2-appointments-past" className="v2-plate overflow-hidden">
              <h2
                id="v2-appointments-past"
                className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5"
              >
                {t('customer-app:v2.appointments.past')}
              </h2>
              <ul className="border-t border-v2-hairline">
                {past.map((appointment) => card(appointment, false))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
