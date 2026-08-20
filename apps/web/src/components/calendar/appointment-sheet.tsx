import { useState } from 'react'
import { Check, Clock, MapPin, Phone, Scissors, User, UserX } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { AppointmentStatusBadge, isLive } from '@/components/calendar/appointment-status'
import { MoveAppointmentDialog } from '@/components/calendar/move-appointment-dialog'
import {
  calendarErrorMessage,
  useCompleteAppointment,
  useMarkAppointmentNoShow,
  type CalendarAppointment,
} from '@/lib/queries/calendar'
import {
  useCancelAppointmentAsBusiness,
  useConfirmBookingRequest,
  useDeclineBookingRequest,
} from '@/lib/queries/booking-requests'
import type { CalendarProfessional } from '@/lib/calendar/professionals'
import { useMoney, useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import { useTranslation } from 'react-i18next'

/**
 * One appointment, and everything that can be done to it.
 *
 * A bottom sheet on phones and a side drawer from `sm` up — the same content,
 * placed where the hand is. On a phone the primary action sits at the bottom,
 * inside the thumb's reach; a side drawer would put it at the top of a 6-inch
 * screen, which is the single most common mobile design mistake in scheduling
 * software.
 *
 * WHAT IS OFFERED DEPENDS ON WHO IS ASKING, and mirrors the server exactly
 * rather than inventing a second rule:
 *   * answering a request (accept/decline) is front-of-house, matching
 *     private.can_manage_appointments;
 *   * completing and marking a no-show is front-of-house OR the professional
 *     whose appointment it is, matching complete_appointment's own check —
 *     because marking your own client done from the chair is the entire point.
 *
 * Hiding a control the server would refuse is a courtesy, never the
 * enforcement. Every action here goes through an RPC that re-checks.
 */
export function AppointmentSheet({
  appointment,
  open,
  onOpenChange,
  organizationId,
  canManage,
  currentUserId,
  professionals,
}: {
  appointment: CalendarAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  canManage: boolean
  currentUserId: string | undefined
  professionals: CalendarProfessional[]
}) {
  const { t } = useTranslation()
  const dateTime = useDateTime()
  const { toast } = useToast()
  const money = useMoney()
  const [error, setError] = useState<string | null>(null)
  const [confirmingAction, setConfirmingAction] = useState<'decline' | 'cancel' | 'noShow' | null>(null)
  const [note, setNote] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)

  const confirmRequest = useConfirmBookingRequest(organizationId)
  const declineRequest = useDeclineBookingRequest(organizationId)
  const cancelAppointment = useCancelAppointmentAsBusiness(organizationId)
  const completeAppointment = useCompleteAppointment(organizationId)
  const markNoShow = useMarkAppointmentNoShow(organizationId)

  if (!appointment) return null

  const professional = appointment.barberId
    ? professionals.find((candidate) => candidate.barberId === appointment.barberId)
    : undefined
  const isOwnChair = Boolean(currentUserId && professional?.userId === currentUserId)
  const canDecide = canManage
  const canRunService = canManage || isOwnChair

  const timeZone = appointment.locationTimezone
  // The APP's locale, not the browser's — an owner who chose Japanese should
  // not read a French date because their laptop is French.
  const formatTime = (iso: string) => dateTime.time(iso, timeZone)
  const formatDay = (iso: string) => dateTime.longDate(iso, timeZone)

  function close() {
    setError(null)
    setConfirmingAction(null)
    setNote('')
    onOpenChange(false)
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setError(null)
    try {
      await action()
      toast({ title: successMessage, variant: 'success' })
      close()
    } catch (cause) {
      setError(calendarErrorMessage(cause))
    }
  }

  const busy =
    confirmRequest.isPending ||
    declineRequest.isPending ||
    cancelAppointment.isPending ||
    completeAppointment.isPending ||
    markNoShow.isPending

  return (
    <>
      <Drawer open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
        <DrawerContent side="bottom" className="sm:inset-y-0 sm:end-0 sm:max-h-none sm:max-w-md sm:rounded-none">
          <DrawerHeader>
            <div className="flex flex-wrap items-center gap-2">
              <AppointmentStatusBadge status={appointment.status} resolution={appointment.resolution} />
              {appointment.status === 'pending' && appointment.expiresAt ? (
                <span className="text-xs text-ink-500">
                  Expires {formatTime(appointment.expiresAt)}
                </span>
              ) : null}
            </div>
            <DrawerTitle>{appointment.customerName}</DrawerTitle>
            <DrawerDescription>
              {formatDay(appointment.startsAt)} · {formatTime(appointment.startsAt)}–{formatTime(appointment.endsAt)}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto">
            <dl className="flex flex-col gap-3 text-sm">
              <DetailRow icon={Scissors} label={t('common:entity.service')}>
                {appointment.serviceName ?? 'No service recorded'}
                {appointment.priceCents !== null ? (
                  <span className="text-ink-500"> · {money(appointment.priceCents, appointment.currency)}</span>
                ) : null}
              </DetailRow>
              <DetailRow icon={User} label={t('common:entity.professional')}>
                {appointment.barberDisplayName ?? 'Unassigned'}
                {isOwnChair ? <span className="text-ink-500"> {t('app:appointmentSheet.you')}</span> : null}
              </DetailRow>
              <DetailRow icon={MapPin} label={t('common:entity.location')}>
                {appointment.locationName}
              </DetailRow>
              {appointment.customerPhone ? (
                <DetailRow icon={Phone} label={t('common:field.phone')}>
                  {/* Tap to call: on a shop phone this is the fastest way to
                      sort out a late or missing customer. */}
                  <a
                    href={`tel:${appointment.customerPhone}`}
                    className="font-medium text-accent-700 underline underline-offset-2"
                  >
                    {appointment.customerPhone}
                  </a>
                </DetailRow>
              ) : null}
              {appointment.notes ? (
                <DetailRow icon={Clock} label={t('app:appointmentSheet.noteFromTheCustomer')}>
                  <span className="whitespace-pre-wrap">{appointment.notes}</span>
                </DetailRow>
              ) : null}
            </dl>

            {error ? (
              <Alert variant="error" className="mt-4">
                {error}
              </Alert>
            ) : null}

            {confirmingAction ? (
              <div className="mt-4 rounded-md border border-border bg-paper-50 p-3">
                <p className="text-sm font-medium text-ink-950">
                  {confirmingAction === 'decline'
                    ? 'Decline this request?'
                    : confirmingAction === 'cancel'
                      ? 'Cancel this appointment?'
                      : 'Mark this as a no-show?'}
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  {confirmingAction === 'noShow'
                    ? 'The slot goes back on sale straight away. This cannot be undone.'
                    : 'The customer is told, and the slot goes back on sale. This cannot be undone.'}
                </p>
                {confirmingAction !== 'noShow' ? (
                  <div className="mt-3">
                    <Textarea
                      label={t('app:appointmentSheet.messageToTheCustomer')}
                      rows={2}
                      value={note}
                      maxLength={280}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t('app:appointmentSheet.optionalAReasonHelpsThem')}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DrawerFooter>
            {confirmingAction ? (
              <>
                <Button
                  variant="danger"
                  isLoading={busy}
                  onClick={() => {
                    if (confirmingAction === 'decline') {
                      void run(
                        () => declineRequest.mutateAsync({ appointmentId: appointment.id, note }),
                        'Request declined',
                      )
                    } else if (confirmingAction === 'cancel') {
                      void run(
                        () => cancelAppointment.mutateAsync({ appointmentId: appointment.id, note }),
                        'Appointment cancelled',
                      )
                    } else {
                      void run(() => markNoShow.mutateAsync(appointment.id), 'Marked as a no-show')
                    }
                  }}
                >
                  {confirmingAction === 'decline'
                    ? 'Decline request'
                    : confirmingAction === 'cancel'
                      ? 'Cancel appointment'
                      : 'Mark no-show'}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingAction(null)}>
                  {t('app:appointmentSheet.goBack')}
                </Button>
              </>
            ) : (
              <>
                {/* PENDING — the one-tap answer is the primary action. */}
                {appointment.status === 'pending' && canDecide ? (
                  <Button
                    isLoading={confirmRequest.isPending}
                    onClick={() => void run(() => confirmRequest.mutateAsync(appointment.id), 'Request accepted')}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {t('app:appointmentSheet.acceptRequest')}
                  </Button>
                ) : null}

                {/* CONFIRMED — the two things that happen at the end of a cut. */}
                {appointment.status === 'confirmed' && canRunService ? (
                  <Button
                    isLoading={completeAppointment.isPending}
                    onClick={() => void run(() => completeAppointment.mutateAsync(appointment.id), 'Marked as done')}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {t('app:appointmentSheet.markAsDone')}
                  </Button>
                ) : null}

                {appointment.status === 'confirmed' && canRunService ? (
                  <Button variant="secondary" onClick={() => setConfirmingAction('noShow')}>
                    <UserX className="h-4 w-4" aria-hidden="true" />
                    Didn&apos;t show up
                  </Button>
                ) : null}

                {isLive(appointment.status) && canDecide ? (
                  <Button variant="secondary" onClick={() => setMoveOpen(true)}>
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    {t('app:appointmentSheet.moveToAnotherTime')}
                  </Button>
                ) : null}

                {isLive(appointment.status) && canDecide ? (
                  <Button
                    variant="ghost"
                    className="text-danger-700"
                    onClick={() => setConfirmingAction(appointment.status === 'pending' ? 'decline' : 'cancel')}
                  >
                    {appointment.status === 'pending' ? 'Decline request' : 'Cancel appointment'}
                  </Button>
                ) : null}

                {!isLive(appointment.status) ? (
                  <p className="text-center text-sm text-ink-500">
                    {t('app:appointmentSheet.thisAppointmentIsFinishedNothing')}
                  </p>
                ) : null}

                {isLive(appointment.status) && !canDecide && !canRunService ? (
                  <p className="text-center text-sm text-ink-500">
                    {t('app:appointmentSheet.bookingDecisionsAreHandledBy')}
                  </p>
                ) : null}
              </>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Mounted only while open, so the availability query it runs does not
          fire for every appointment the calendar happens to be showing. */}
      {moveOpen ? (
        <MoveAppointmentDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          appointment={appointment}
          organizationId={organizationId}
          professionals={professionals}
          onMoved={() => {
            toast({ title: t('app:appointmentSheet.appointmentMoved'), variant: 'success' })
            close()
          }}
        />
      ) : null}
    </>
  )
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
      <div className={cn('min-w-0 flex-1')}>
        <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
        <dd className="text-ink-950">{children}</dd>
      </div>
    </div>
  )
}
