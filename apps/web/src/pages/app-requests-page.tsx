import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CalendarCheck2, Inbox, WifiOff } from 'lucide-react'
import { useCurrentOrg } from '@/lib/current-org-context'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { ExpiryCountdown } from '@/components/booking/booking-status'
import {
  bookingErrorKey,
  useBookingRequests,
  useConfirmBookingRequest,
  useDeclineBookingRequest,
  type BookingRequest,
} from '@/lib/queries/booking-requests'
import { useOrgLocations } from '@/lib/queries/locations'
import { useTranslation } from 'react-i18next'

/**
 * /app/requests — the shop's booking inbox.
 *
 * This is the surface the audit found missing. A public booking arrived as
 * `pending`, the exclusion constraint held the slot, and there was nowhere for
 * a shop to see it — so it held that slot forever and the customer heard
 * nothing.
 *
 * Designed for the person actually holding the phone between two clients:
 *
 * - Accept is the primary action and reachable in ONE tap. Declining is the
 *   rarer, heavier answer, so it costs a confirmation — the asymmetry is the
 *   point, not an oversight.
 * - Everything needed to decide is on the card. Nobody should open a detail
 *   page to answer a request that is obviously fine.
 * - Full-width stacked actions on mobile, inline on larger screens. Targets are
 *   comfortably past 44px because this gets tapped one-handed, standing up.
 * - Requests are ordered by how soon they expire, because that is the order in
 *   which they stop being answerable.
 *
 * Deliberately its own route rather than a tab on the schedule: the schedule is
 * scoped to one day, and requests span every future date. It is NOT the LOT D
 * dashboard and does not try to be.
 */
export function AppRequestsPage() {
  const { t } = useTranslation()
  const { currentMembership } = useCurrentOrg()
  const organizationId = currentMembership?.organizationId
  const canDecide =
    currentMembership?.role === 'owner' ||
    currentMembership?.role === 'manager' ||
    currentMembership?.role === 'receptionist'

  const requestsQuery = useBookingRequests(canDecide ? organizationId : undefined)
  const locationsQuery = useOrgLocations(organizationId)

  const requests = requestsQuery.data ?? []
  const timeZone = locationsQuery.data?.[0]?.timezone ?? 'UTC'

  if (!canDecide) {
    return (
      <Container size="lg" className="py-8">
        <EmptyState
          icon={Inbox}
          title={t('app:requests.bookingRequests')}
          description={t('app:requests.bookingRequestsAreHandledBy')}
        />
      </Container>
    )
  }

  return (
    <Container size="lg" className="py-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-950">
            Booking requests
            {requests.length > 0 ? <Badge variant="accent">{requests.length}</Badge> : null}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {t('app:requests.eachOneIsHoldingIts')}
          </p>
        </div>

        {/*
          Honesty about liveness. A screen that silently stopped updating looks
          exactly like one with nothing to show, and this is the screen where
          that mistake costs a booking.
        */}
        {requestsQuery.realtimeStatus === 'offline' ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-500">
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            {t('app:requests.reconnectingStillCheckingForNew')}
          </span>
        ) : null}
      </header>

      {requestsQuery.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : requestsQuery.isError ? (
        <ErrorState
          title={t('app:requests.couldntLoadBookingRequests')}
          description={requestsQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void requestsQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={CalendarCheck2}
          title={t('app:requests.noRequestsWaiting')}
          description={t('app:requests.newBookingRequestsAppearHere')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                organizationId={organizationId}
                timeZone={timeZone}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Container>
  )
}

function formatWhen(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

function RequestCard({
  request,
  organizationId,
  timeZone,
}: {
  request: BookingRequest
  organizationId: string | undefined
  timeZone: string
}) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const toast = useToast()
  const confirm = useConfirmBookingRequest(organizationId)
  const decline = useDeclineBookingRequest(organizationId)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [note, setNote] = useState('')

  const busy = confirm.isPending || decline.isPending

  /** Booking errors are normal (a colleague answered first). Say so plainly. */
  function reportFailure(error: unknown) {
    const key = bookingErrorKey(error)
    toast.toast({
      variant: 'error',
      title:
        key === 'requests.errors.alreadyAnswered'
          ? 'Already answered'
          : key === 'requests.errors.expired'
            ? 'This request expired'
            : 'Something went wrong',
      description:
        key === 'requests.errors.alreadyAnswered'
          ? 'Someone else answered this request first.'
          : key === 'requests.errors.expired'
            ? 'It was not answered in time, so the slot has been released.'
            : 'Please try again.',
    })
  }

  async function handleAccept() {
    try {
      await confirm.mutateAsync(request.id)
      toast.toast({ variant: 'success', title: 'Booking confirmed', description: request.customerName })
    } catch (error) {
      reportFailure(error)
    }
  }

  async function handleDecline() {
    try {
      await decline.mutateAsync({ appointmentId: request.id, note })
      setDeclineOpen(false)
      setNote('')
      toast.toast({ variant: 'success', title: 'Request declined', description: 'The slot is free again.' })
    } catch (error) {
      reportFailure(error)
    }
  }

  return (
    <motion.li
      layout={!reduced}
      // Enters from slightly above so a request arriving while someone is
      // looking reads as "this just came in" rather than appearing fully
      // formed. Leaving collapses rather than vanishing, so the list does not
      // jump under a thumb that is mid-tap.
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: reduced ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="overflow-hidden p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink-950">{request.customerName}</p>
            <p className="mt-0.5 text-sm text-ink-700">
              {request.serviceName ?? 'Service'}
              {request.durationMinutes ? ` · ${request.durationMinutes} min` : ''}
              {request.barberDisplayName ? ` · ${request.barberDisplayName}` : ''}
            </p>
          </div>
          <ExpiryCountdown expiresAt={request.expiresAt} prefix="Expires in" />
        </div>

        <p className="mt-3 text-sm font-medium text-ink-950">{formatWhen(request.startsAt, timeZone)}</p>
        <p className="text-sm text-ink-500">{request.locationName}</p>

        {request.notes ? (
          <p className="mt-3 rounded-md bg-paper-50 px-3 py-2 text-sm text-ink-700">“{request.notes}”</p>
        ) : null}

        {/*
          Contact details are one tap away rather than one copy-paste away —
          calling the customer back is the most common thing a receptionist
          does with an ambiguous request.
        */}
        {request.customerPhone ? (
          <a
            href={`tel:${request.customerPhone}`}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-accent-700 underline underline-offset-2"
          >
            {request.customerPhone}
          </a>
        ) : null}

        {/*
          Stacked and full-width on mobile, inline from `sm`. Accept is primary
          and first; Decline is secondary and opens a confirmation, because it
          is the answer that cannot be taken back.
        */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button size="lg" onClick={handleAccept} isLoading={confirm.isPending} disabled={busy} className="sm:min-w-32">
            {t('app:requests.accept')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setDeclineOpen(true)}
            disabled={busy}
            className="sm:min-w-32"
          >
            {t('app:requests.decline')}
          </Button>
        </div>
      </Card>

      <Dialog open={declineOpen} onOpenChange={(open) => !open && setDeclineOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('app:requests.declineThisRequest')}</DialogTitle>
            <DialogDescription>
              {request.customerName} will be told it was not accepted, and the slot becomes bookable again.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            label={t('app:requests.messageToTheCustomer')}
            hint={t('app:requests.optionalASentenceExplainingWhy')}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          {decline.isError ? <Alert variant="error">{t('app:requests.couldNotDeclinePleaseTry')}</Alert> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t('app:requests.keepIt')}
              </Button>
            </DialogClose>
            <Button type="button" variant="danger" onClick={handleDecline} isLoading={decline.isPending}>
              {t('app:requests.declineRequest')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.li>
  )
}
