import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarX } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  bookingStage,
  isLiveStage,
  useCancelMyAppointment,
  useMyAppointments,
  type MyAppointment,
} from '@/lib/queries/customer-app'
import { BookingProgress, BookingStatusBadge, ExpiryCountdown } from '@/components/booking/booking-status'
import { RescheduleDialog } from '@/components/booking/reschedule-dialog'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { PageHeader } from '@/components/ui/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { useMoney, useDateTime } from '@/lib/intl/use-intl'

/**
 * `/app/customer/appointments` — upcoming and past, cancel, move, rebook.
 *
 * Every time on this screen is rendered in the SHOP's timezone, from
 * `locationTimezone`. It used to use the device's, which is wrong in the one
 * situation a customer list is most likely to contain: an appointment made in
 * one country and read in another. A 14:00 cut in Paris is at 14:00 in Paris
 * whether or not the customer has since flown to London, and showing 13:00
 * there is how somebody misses it.
 */
export function CustomerAppointmentsPage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const toast = useToast()
  // Live: every booking transition writes this customer a notification row,
  // and useMyAppointments subscribes to those and refetches. A shop accepting
  // or declining reaches this screen without a refresh.
  const appointmentsQuery = useMyAppointments(Boolean(user), user?.id)
  const cancelAppointment = useCancelMyAppointment()
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const { upcoming, past } = useMemo(() => {
    const all = appointmentsQuery.data ?? []
    // Status alone is not enough to mean "upcoming". Public bookings are
    // created `pending` and only apply_appointment_no_show_rule moves
    // `confirmed` rows on, so a request a shop never got round to
    // confirming would otherwise sit here forever with a live Cancel
    // button — while Home, which does check the date, showed nothing
    // upcoming at all. Same predicate as customer-home-page.tsx.
    // "Upcoming" means still going somewhere — waiting for an answer, or
    // confirmed — and not already in the past. A declined or expired request
    // belongs in history, however recent it is.
    const isUpcoming = (a: MyAppointment) =>
      isLiveStage(bookingStage(a)) && new Date(a.startsAt).getTime() > Date.now()
    return {
      upcoming: all.filter(isUpcoming).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      past: all.filter((a) => !isUpcoming(a)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    }
  }, [appointmentsQuery.data])

  const cancellingAppointment = upcoming.find((a) => a.id === cancellingId) ?? null

  async function handleConfirmCancel() {
    if (!cancellingAppointment) return
    try {
      await cancelAppointment.mutateAsync(cancellingAppointment.id)
      setCancellingId(null)
    } catch (error) {
      toast.toast({ variant: 'error', title: t('appointments.cancelError'), description: getErrorMessage(error) ?? undefined })
    }
  }

  if (appointmentsQuery.isPending) {
    return <PageSpinner label={t('common:state.loadingEllipsis')} />
  }

  if (appointmentsQuery.isError) {
    return (
      <ErrorState
        title={t('appointments.errorTitle')}
        description={appointmentsQuery.error.message}
        action={
          <Button variant="secondary" onClick={() => void appointmentsQuery.refetch()}>
            {t('common:action.tryAgain')}
          </Button>
        }
      />
    )
  }

  return (
    // No Container: the customer shell already owns the page's width and
    // padding. Nesting a second one gave this page a narrower measure than
    // every other tab, which is why the app read as a set of screens.
    <div className="flex flex-col gap-5">
      <PageHeader title={t('appointments.title')} />

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">{t('appointments.upcomingTab')}</TabsTrigger>
          <TabsTrigger value="past">{t('appointments.pastTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('appointments.emptyUpcomingTitle')} description={t('appointments.emptyUpcomingDescription')} />
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {upcoming.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    onCancel={() => setCancellingId(appointment.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="past">
          {past.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('appointments.emptyPastTitle')} description={t('appointments.emptyPastDescription')} />
          ) : (
            <div className="flex flex-col gap-3">
              {past.map((appointment) => (
                <AppointmentCard key={appointment.id} appointment={appointment} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={cancellingAppointment !== null} onOpenChange={(open) => !open && setCancellingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('appointments.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('appointments.cancelConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t('appointments.cancelConfirmDismiss')}</Button>
            </DialogClose>
            <Button variant="danger" onClick={() => void handleConfirmCancel()} isLoading={cancelAppointment.isPending}>
              {t('appointments.cancelConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AppointmentCard({ appointment, onCancel }: { appointment: MyAppointment; onCancel?: () => void }) {
  const money = useMoney()
  const dateTime = useDateTime()
  const { t } = useTranslation('customer-app')
  const reduced = useReducedMotion()
  const [moveOpen, setMoveOpen] = useState(false)
  const stage = bookingStage(appointment)

  const rebookHref =
    appointment.barberId && appointment.serviceId
      ? `/s/${appointment.organizationSlug}?barber=${appointment.barberId}&service=${appointment.serviceId}`
      : `/s/${appointment.organizationSlug}`

  /**
   * No dead ends. Every finished state offers the thing the customer most
   * likely wants next — which after a decline or an expiry is another time,
   * not a shrug.
   */
  const showFindAnother = stage === 'declined' || stage === 'expired' || stage === 'cancelled'
  const showRebook = stage === 'completed' || stage === 'missed'

  return (
    <motion.div
      layout={!reduced}
      transition={{ duration: reduced ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="rounded-xl border border-border bg-paper-0 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-ink-950">{appointment.organizationName}</p>
            <p className="text-sm text-ink-500">
              {appointment.serviceName ?? ''}
              {appointment.barberDisplayName ? ` · ${appointment.barberDisplayName}` : ''}
            </p>
            {/* The shop's clock, not the phone's. */}
            <p className="mt-1 text-sm font-medium text-ink-700">
              {dateTime.dateTime(appointment.startsAt, appointment.locationTimezone)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <BookingStatusBadge stage={stage} />
            {appointment.priceCents !== null ? (
              <span className="text-sm font-medium text-ink-950">{money(appointment.priceCents, appointment.currency)}</span>
            ) : null}
          </div>
        </div>

        {/*
          The rail now appears ONLY while a request is genuinely in flight.
          Since LOT E a normal booking is confirmed the moment it is made, so
          drawing a three-step journey next to it would narrate a wait that
          never happened — the same fake-progress problem the success screen
          had. A confirmed appointment says so with its badge and stops there.

          `waiting` still occurs: legacy pending rows created before LOT E, and
          any future workflow that genuinely requires approval.
        */}
        {stage === 'waiting' ? (
          <div className="mt-4 border-t border-border pt-4">
            <BookingProgress stage={stage} />
            <p className="mt-3 text-sm text-ink-500">
              {t('booking.waitingExplainer')}{' '}
              <ExpiryCountdown expiresAt={appointment.expiresAt} prefix={t('booking.expiresPrefix')} />
            </p>
          </div>
        ) : null}

        {/* The shop's own words, when they left any. */}
        {appointment.resolutionNote ? (
          <p className="mt-3 rounded-md bg-paper-50 px-3 py-2 text-sm text-ink-700">
            “{appointment.resolutionNote}”
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {onCancel ? (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              {stage === 'waiting' ? t('appointments.withdraw') : t('appointments.cancel')}
            </Button>
          ) : null}
          {showFindAnother ? (
            <Link to={rebookHref} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              {t('appointments.findAnotherTime')}
            </Link>
          ) : null}
          {/*
            Moving is offered only while the appointment is still going
            somewhere. It needs a professional and a service to compute real
            availability against.
          */}
          {onCancel && appointment.barberId && appointment.serviceId ? (
            <Button variant="secondary" size="sm" onClick={() => setMoveOpen(true)}>
              {t('appointments.move')}
            </Button>
          ) : null}
          {showRebook ? (
            <Link to={rebookHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              {t('appointments.rebook')}
            </Link>
          ) : null}
        </div>

        {/*
          Mounted only while open. Rendering it alongside every card would run
          a live availability query per appointment the moment the list loads —
          twenty cards, twenty slot lookups nobody asked for.
        */}
        {moveOpen && appointment.barberId && appointment.serviceId ? (
          <RescheduleDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            appointment={{
              id: appointment.id,
              organizationSlug: appointment.organizationSlug,
              locationId: appointment.locationId,
              barberId: appointment.barberId,
              serviceId: appointment.serviceId,
            }}
          />
        ) : null}
      </div>
    </motion.div>
  )
}

